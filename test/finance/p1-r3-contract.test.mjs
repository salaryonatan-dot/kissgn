import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import * as SC from '../../lib/supplierCredits.js';
import * as Repo from '../../lib/repositories/supplierCreditsRepo.js';
import {creditSha256,creditEvidence} from '../../fincore/v1/finance/creditEvidence.js';
import {bothCores} from '../support/fincore-load.mjs';
import {creditNode,spec,view,resolve} from '../support/p1-credit-fixtures.mjs';
import {apiHarness,memoryDb,clone,T,B,NODE,cid,oid,env,createBody} from '../support/p1-r3-api-harness.mjs';
const cores=await bothCores(), bind={tenantId:T,bizId:B};
const node=(state='flagged')=>creditNode([spec(1,'s1','2026-10-01','10',{review:state})]);
const command=(n=1,extra={})=>{const c={action:'create',...bind,creditId:cid(n),operationId:oid(n),actorUid:'mgr',actorRole:'manager',now:10000,
 input:SC.validateCreditInput({supplierId:'s1',issueDate:'2026-10-01',amount:'10',documentNumber:'CR-'+n}),...extra};c.requestHash=SC.requestHash(c);return c;};

test('R3 canonical lifecycle acceptance is cleared + accepted; refused fifth state never authoritative',()=>{
 const n=node('accepted'),r=n.review[oid(1)];assert.equal(r.state,'cleared');assert.equal(r.decisionAudit.decision,'accepted');
 for(const[,c]of cores){const d=c.finance.supplierCredits.decodeSupplierCredits(view(n),bind);assert.equal(d.credits.length,1);
  for(const field of ['state','decision']){const bad=clone(n);if(field==='state')bad.review[oid(1)].state='acknowledged';else bad.review[oid(1)].decisionAudit.decision='acknowledged';assert.equal(c.finance.supplierCredits.decodeSupplierCredits(view(bad),bind).state,'unreadable');}}
});

test('R3 fixed document rule ignores every old case switch and keeps meaningful separators',()=>{
 for(const[,c]of cores){const norm=c.finance.supplierCredits.normalizeDocumentNumber;
  for(const [a,b]of [['CR-001','cr-001'],['ＣＲ－００１','cr-001'],[' א  ב ','א\u00a0ב'],['cr\u2009 001','CR 001']])assert.equal(norm(a).key,norm(b).key);
  for(const [a,b]of [['CR001','CR-001'],['12-3','1-23'],['א-1','a-1'],['CR-1','CR-001'],['א־1','א-1'],['a.b','a/b']])assert.notEqual(norm(a).key,norm(b).key);
  assert.equal(norm('CR-001',true).key,norm('cr-001',false).key);
 }
 const a=command(1),n=SC.applyCreditOperation(null,a).node;
 const input=SC.validateCreditInput({supplierId:'s1',issueDate:'2026-10-01',amount:'10',documentNumber:'CR-1',documentCaseSensitive:true,documentNumberCaseSensitive:true});
 assert.ok(!('documentCaseSensitive'in input));assert.equal(SC.applyCreditOperation(n,command(2,{input})).code,'duplicate_document');
 assert.equal(SC.applyCreditOperation(n,command(2,{input:SC.validateCreditInput({supplierId:'s2',issueDate:'2026-10-01',amount:'10',documentNumber:'CR-1'})})).outcome,'applied');
});

test('R3 SHA-256 canonical UTF-8 parity with independent crypto oracle',()=>{
 for(const s of ['', 'abc','אבג עברית CR-001','😀\ud800',...'a'.repeat(140).split('').map((_,i)=>'a'.repeat(i)),JSON.stringify(node('accepted'))])
 assert.equal(creditSha256(s),createHash('sha256').update(s).digest('hex'));
});

for(const state of ['flagged','accepted','rejected'])for(const audit of state==='flagged'?['flagAudit']:['flagAudit','decisionAudit']){
 for(const field of ['tenantId','bizId','supplierId','creditId','versionId','documentKey','payloadDigest','intentDigest','operationId','contract','state','decision',audit==='flagAudit'?'actor':'by',audit==='flagAudit'?'detectedAt':'at']){
  test(`R3 strict ${state} ${audit} binds ${field}`,()=>{const n=node(state);n.review[oid(1)][audit][field]=field.endsWith('At')||field==='at'?999999:'wrong-field';
   for(const[,c]of cores)assert.equal(c.finance.supplierCredits.decodeSupplierCredits(view(n),bind).state,'unreadable');});
 }
}
test('R3 numeric operationId rejected even when decision reference matches',()=>{const n=node('accepted');n.review[oid(1)].decisionAudit.operationId=12345678;n.review[oid(1)].decisionOperationId=12345678;
 for(const[,c]of cores)assert.equal(c.finance.supplierCredits.decodeSupplierCredits(view(n),bind).state,'unreadable');
 assert.equal(SC.applyCreditOperation(null,command(1,{operationId:12345678})).code,'invalid_operation_id');
});
test('R3 payload corruption and coherent forged digest fail closed on all engines',()=>{
 for(const change of [n=>n.records[cid(1)].amount='9999',n=>{n.review[oid(1)].intentDigest='c'.repeat(64);n.review[oid(1)].flagAudit.intentDigest='c'.repeat(64)},n=>delete n.review[oid(1)].flagAudit]){
  const n=node();change(n);for(const[,c]of cores)assert.equal(c.finance.supplierCredits.decodeSupplierCredits(view(n),bind).state,'unreadable');}
});

test('R3 repository lost ack requires full request payload; ledger existence and self-consistent different payload are insufficient',async()=>{
 const cmd=command(),db=memoryDb();let fired=false;db.afterTransaction=async(p)=>{if(!fired){fired=true;throw Error('ack lost')}};
 const ok=await Repo.runSupplierCreditTxn(cmd,db);assert.equal(ok.resolvedBy,'readback');assert.equal(ok.outcome,'applied');
 const n=db.read(NODE);n.records[cid(1)].amount='9999';const digest=SC.storedIntentDigest(n,oid(1));n.review[oid(1)].intentDigest=digest;n.operations[oid(1)].intentDigest=digest;db.put(NODE,n);
 assert.equal((await Repo.readbackOperation(cmd,db)).code,'stored_payload_mismatch');
 const empty=memoryDb();empty.beforeTransaction=()=>{throw Error('not committed')};assert.equal((await Repo.runSupplierCreditTxn(cmd,empty)).outcome,'unknown');
});

for(const action of ['create-supplier-credit','list-supplier-credits','void-supplier-credit','replace-supplier-credit','decide-supplier-credit-review','reconcile-supplier-credit-reviews'])
 test('R3 registry denial on '+action,async()=>{const h=await apiHarness();const before=h.db.value();const res=await h.call(action,createBody(1,{bizId:'ghost',newCreditId:cid(2),expectedSeq:1,targetOperationId:oid(1),intentDigest:'a'.repeat(64),decision:'accept'}),'own',action.startsWith('list')?'GET':'POST');
 assert.equal(res.code,403);assert.equal(res.body.error,'business_not_in_tenant');assert.deepEqual(h.db.value(),before);});

test('R3 current membership/tenant owner registry, transport and malformed registry',async()=>{
 const h=await apiHarness();assert.equal((await h.call('create-supplier-credit',createBody(1,{bizId:'bizB'}),'own')).code,200);
 for(const actor of ['foreign',null])assert.ok([401,403].includes((await h.call('list-supplier-credits',{...bind},actor,'GET')).code));
 h.db.put(`tenants/${T}/members/own`,null);assert.equal((await h.call('create-supplier-credit',createBody(2),'own')).code,403);
 h.db.put(`tenants/${T}/members/own`,true);h.db.put(`tenants/${T}/app/business`,env([{id:B},{id:B}]));assert.equal((await h.call('create-supplier-credit',createBody(2),'own')).code,503);
 h.db.beforeGet=p=>{if(p.endsWith('/app/business'))throw Error('down')};assert.equal((await h.call('list-supplier-credits',bind,'own','GET')).code,503);
});

test('R3 registry removal before pre-check denies; in-window removal flags atomically; failure stays pending',async()=>{
 for(const when of ['before','during','audit-fail']){const h=await apiHarness();let transactions=0;
 if(when==='before')h.db.beforeGet=p=>{if(p.endsWith(':suppliers'))h.db.put(`tenants/${T}/app/business`,env([]))};
 else h.db.beforeTransaction=p=>{if(p===NODE){transactions++;h.db.put(`tenants/${T}/app/business`,env([]));if(when==='audit-fail'&&transactions>1)throw Error('audit unavailable')}};
 const res=await h.call('create-supplier-credit',createBody());
 if(when==='before'){assert.equal(res.code,403);assert.equal(h.db.read(NODE),null)}else {assert.equal(res.code,200);assert.equal(h.db.read(NODE).review[oid(1)].state,when==='during'?'flagged':'pending');assert.deepEqual(res.body.affectedDates,[]);}}
});

for(const role of ['super_owner','manager','viewer','removed'])test('R3 only current tenant owner decides, denies '+role,async()=>{
 const h=await apiHarness();h.db.put(NODE,node());h.db.put(`tenants/${T}/roles/own`,role==='removed'?'owner':role);if(role==='removed')h.db.put(`tenants/${T}/members/own`,null);
 const before=h.db.read(NODE),r=await h.call('decide-supplier-credit-review',{...bind,operationId:oid(90),targetOperationId:oid(1),intentDigest:before.review[oid(1)].intentDigest,decision:'accept'},'own');assert.equal(r.code,403);assert.deepEqual(h.db.read(NODE),before);
});

test('R3 owner decision proposal window, retry, lost acknowledgement and idempotent exact acceptance',async()=>{
 const h=await apiHarness();h.db.put(NODE,node());h.db.put(`tenants/${T}/biz_access/${B}/own`,true);const body={...bind,operationId:oid(90),targetOperationId:oid(1),intentDigest:h.db.read(NODE).review[oid(1)].intentDigest,decision:'accept'};
 let once=false;h.db.afterTransaction=p=>{if(p===NODE&&!once){once=true;h.db.put(`tenants/${T}/roles/own`,'manager')}};
 const pending=await h.call('decide-supplier-credit-review',body,'own');assert.equal(pending.body.decisionPending,true);assert.equal(h.db.read(NODE).review[oid(1)].state,'flagged');
 h.db.put(`tenants/${T}/roles/own`,'owner');h.db.afterTransaction=()=>{throw Error('ack lost')};
 const accepted=await h.call('decide-supplier-credit-review',body,'own');assert.equal(accepted.code,200);assert.equal(h.db.read(NODE).review[oid(1)].state,'cleared');assert.equal(h.db.read(NODE).review[oid(1)].decisionAudit.decision,'accepted');
 h.db.afterTransaction=null;const before=h.db.read(NODE);assert.equal((await h.call('decide-supplier-credit-review',body,'own')).code,200);assert.deepEqual(h.db.read(NODE),before);
 assert.equal((await h.call('decide-supplier-credit-review',{...body,decision:'reject'},'own')).body.error,'idempotency_conflict');
});

test('R3 lost acknowledgement compares replacement and void payloads, not only a create record',async()=>{
 for(const action of ['replace','void']){
  const initial=node('cleared'),cmd=command(2,{action,creditId:cid(1),expectedSeq:1,...(action==='replace'?{newCreditId:cid(2),input:SC.validateCreditInput({supplierId:'s1',issueDate:'2026-10-02',amount:'20',documentNumber:'CR-1'})}:{voidReason:'duplicate'})});
  const db=memoryDb();db.put(NODE,initial);db.afterTransaction=()=>{throw Error('lost ack')};
  const r=await Repo.runSupplierCreditTxn(cmd,db);assert.equal(r.outcome,'applied');assert.equal(r.resolvedBy,'readback');
  const n=db.read(NODE);if(action==='replace')n.records[cid(2)].note='different';else n.voids[oid(2)].reasonText='different';
  const digest=SC.storedIntentDigest(n,oid(2));n.review[oid(2)].intentDigest=digest;n.operations[oid(2)].intentDigest=digest;db.put(NODE,n);
  assert.equal((await Repo.readbackOperation(cmd,db)).code,'stored_payload_mismatch');
 }
});
