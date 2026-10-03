import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeDb } from '../../tools/storage-v2/reader-sandbox.mjs';
import { loadWriter } from '../support/f1-writer-harness.mjs';
import { loadCommitted, REPO } from '../support/fincore-load.mjs';

const W = await loadWriter(REPO), F = await loadCommitted();
const T='tenantA', B='bizA', A='00000000-0000-4000-8000-0000000000a1';
const OP='00000000-0000-4000-8000-0000000000aa';
const NODE=`tenants/${T}/biz:${B}:cost_history`;
const NOW=Date.parse('2026-10-02T09:00:00Z');
const body={versionId:A,expectedHead:null,effectiveFrom:'2026-10-02',basis:'recorded',globalEmployees:[],fixedItems:[{itemKey:'f1',monthlyAmount:'3100'}],rent:{mode:'none'},royalty:{mode:'none'}};
const clone=x=>JSON.parse(JSON.stringify(x));
function world() {
  const db=makeDb();
  for (const [uid,role,biz] of [['manager','manager',B],['owner','owner',B],['super','super_owner',B],['other','owner','else']]) {
    db.seed(`tenants/${T}/members/${uid}`,true);db.seed(`tenants/${T}/roles/${uid}`,role);
    db.seed(`tenants/${T}/biz_access/${biz}/${uid}`,true);
  }
  db.seed(`tenants/${T}/app/business`, { _v: JSON.stringify([{ id: B, name: "A" }]) });   // R3: business registry
  globalThis.__DB=db;globalThis.__CLAIMS={uid:'manager',email:'m@x'};
  return db;
}
const actor=uid=>{globalThis.__CLAIMS={uid,email:uid+'@x'};};
const refHook=(db,wrap)=>{const orig=db.ref;db.ref=p=>p===NODE?wrap(orig(p)):orig(p);return()=>{db.ref=orig;};};
async function flagged(db,{fault=null,deadline=5000}={}) {
  let calls=0;
  refHook(db,r=>({...r,transaction:async(...args)=>{
    calls++;
    if(calls===2&&fault==='reject') throw Error('flag transaction rejected');
    if(calls===2&&fault==='hang') return new Promise(()=>{});
    const out=await r.transaction(...args);
    if(calls===1) db.seed(`tenants/${T}/members/manager`,false);
    if(calls===2&&fault==='lost-ack') throw Error('ack lost');
    return out;
  }}));
  const writer=W.createCostHistoryWriter({db,clock:()=>NOW,hooks:{reviewDeadlineMs:deadline}});
  const result=await writer.saveCostVersion({headers:{}},{tenantId:T,bizId:B,body});
  return {writer,result,node:db.read(NODE)};
}
const accept=(w,d,operationId=OP)=>w.acknowledgeFlaggedVersion({headers:{}},{tenantId:T,bizId:B,versionId:A,intentDigest:d,operationId});
const structure=db=>F.costHistory.codec.decodeHistoryStructure({exists:true,value:db.read(NODE)});

test('R2-01 one atomic commit binds flag audit and review; no external flag node',async()=>{
  const db=world(), {result,node}=await flagged(db);
  assert.deepEqual([result.review,result.audit,node.review[A].state],['flagged','flag_persisted','flagged']);
  assert.equal(node.review[A].flagAudit.versionId,A);
  assert.equal(node.review[A].flagAudit.intentDigest,node.review[A].intentDigest);
  assert.equal(db.read(`tenants/${T}/audit/cost_history_flags/${A}`),null);
  assert.equal(structure(db).state,'present');
  assert.equal(F.costHistory.codec.decodeHistory({exists:true,value:node}).reason,'authorization_review_flagged');
});

test('R2-02 failed flag transaction and finite timeout both preserve pending and no audit',async()=>{
  for(const fault of ['reject','hang']) {
    const db=world(), {result,node}=await flagged(db,{fault,deadline:5});
    assert.equal(result.review,'pending',fault);assert.equal(result.audit,'flag_unconfirmed',fault);
    assert.equal(node.review[A].state,'pending',fault);assert.equal(node.review[A].flagAudit,undefined,fault);
  }
});

test('R2-03 lost flag acknowledgement requires exact payload readback; replay preserves audit identity',async()=>{
  const db=world(), {writer,result,node}=await flagged(db,{fault:'lost-ack'});
  assert.deepEqual([result.review,result.audit],['flagged','flag_persisted']);
  const before=clone(node.review[A]);
  const retry=await writer.reconcilePendingReviews({tenantId:T,bizId:B});
  assert.deepEqual(retry.results,[]);assert.deepEqual(db.read(NODE).review[A],before);
});

test('R2-04 strict readers reject missing, partial, wrong-version, mismatched and orphan flag evidence',async()=>{
  const db=world(), {node}=await flagged(db);
  const cases=[
    x=>delete x.review[A].flagAudit,
    x=>delete x.review[A].flagAudit.detectedAt,
    x=>x.review[A].flagAudit.versionId='00000000-0000-4000-8000-0000000000b2',
    x=>x.review[A].flagAudit.intentDigest='b'.repeat(64),
    x=>x.review[A].flagAudit.outcome='other',
    x=>x.review[A].flagAudit.recordedBy='other',
    x=>x.review[A].flagAudit.detectedAt=NOW+1,
    x=>x.review[A].flagAudit.operationId='broken',
    x=>x.review[A].extraAudit={versionId:A},
  ];
  for(const [i,mutate] of cases.entries()){
    const raw=clone(node);mutate(raw);
    assert.equal(F.costHistory.codec.decodeHistory({exists:true,value:raw}).state,'unreadable','malformed '+i);
    assert.equal(F.costHistory.codec.decodeHistoryStructure({exists:true,value:raw}).state,'unreadable','structural '+i);
  }
  const pending=clone(node);pending.review[A].state='pending';
  assert.equal(F.costHistory.codec.decodeHistory({exists:true,value:pending}).state,'unreadable');
});

test('R2-05 only a current TENANT owner accepts (super_owner / manager / removed owner denied); duplicate operation is idempotent',async()=>{
  const db=world(), {writer,node}=await flagged(db), d=node.review[A].intentDigest;
  const before=clone(db.read(NODE));
  for(const uid of ['super','manager']){
    actor(uid);const r=await accept(writer,d);
    assert.notEqual(r.status,'resolved',uid);assert.deepEqual(db.read(NODE),before,uid);
  }
  db.seed(`tenants/${T}/members/owner`,false);actor('owner');
  assert.notEqual((await accept(writer,d)).status,'resolved');assert.deepEqual(db.read(NODE),before);
  db.seed(`tenants/${T}/members/owner`,true);
  assert.equal((await accept(writer,d)).status,'resolved');
  const accepted=clone(db.read(NODE));
  assert.equal(accepted.review[A].acknowledgedBy,'owner');assert.equal(accepted.review[A].acceptOperationId,OP);
  assert.deepEqual(accepted.review[A].flagAudit,before.review[A].flagAudit);
  assert.equal((await accept(writer,d)).status,'already_acknowledged');assert.deepEqual(db.read(NODE),accepted);
  assert.equal((await accept(writer,d,'00000000-0000-4000-8000-0000000000ab')).status,'operation_identity_reused');
  assert.deepEqual(db.read(NODE),accepted);
});

test('R2-06 lost acceptance acknowledgement resolves only through full payload readback',async()=>{
  const db=world(), {writer,node}=await flagged(db);actor('owner');
  let once=true;refHook(db,r=>({...r,transaction:async(...args)=>{const out=await r.transaction(...args);if(once&&out.committed){once=false;throw Error('ack lost');}return out;}}));
  const out=await accept(writer,node.review[A].intentDigest);
  assert.equal(out.status,'resolved');assert.equal(out.resolvedBy,'readback');
  assert.equal(db.read(NODE).review[A].state,'acknowledged');
});

test('R2-07 acceptance transaction failure keeps flagged and full audit unchanged',async()=>{
  const db=world(), {writer,node}=await flagged(db);actor('owner');
  refHook(db,r=>({...r,transaction:async()=>{throw Error('write down');}}));
  const out=await accept(writer,node.review[A].intentDigest);
  assert.equal(out.status,'outcome_unknown');assert.deepEqual(db.read(NODE),node);
});

test('R2-08 concurrent recovery writes at most one identical flag audit; an intervening head cannot retarget it',async()=>{
  const db=world(), {writer,node}=await flagged(db,{fault:'reject'});
  assert.equal(node.review[A].state,'pending');
  const [a,b]=await Promise.all([writer.reconcilePendingReviews({tenantId:T,bizId:B}),writer.reconcilePendingReviews({tenantId:T,bizId:B})]);
  const outcomes=[...a.results,...b.results].map(x=>x.status);
  assert.ok(outcomes.includes('resolved'));
  assert.ok(outcomes.every(x=>x==='resolved'||x==='already_flagged'));
  assert.equal(db.read(NODE).review[A].state,'flagged');
  assert.equal(Object.keys(db.read(NODE).review[A]).filter(k=>k==='flagAudit').length,1);
  const good=clone(db.read(NODE));
  const Bv='00000000-0000-4000-8000-0000000000b2';
  const later={...good.versions[A],versionId:Bv,recordedAt:NOW+1,predecessorVersionId:A,recordedBy:'owner'};
  db.seed(NODE,{head:{revision:2,headVersionId:Bv},versions:{...good.versions,[Bv]:later},review:{...good.review,[Bv]:{schema:'MARJIN_COSTR/2',state:'cleared',intentDigest:'b'.repeat(64),actor:'owner',committedAt:NOW+1,resolvedAt:NOW+1,resolution:'post_commit_authorized'}}});
  assert.equal(db.read(NODE).review[A].state,'flagged');
  assert.deepEqual(db.read(NODE).review[A].flagAudit,good.review[A].flagAudit);
});

test('R2-09 acceptance timeout leaves flagged, and same operation ID cannot be reused by another owner',async()=>{
  const db=world(), {writer,node}=await flagged(db,{deadline:5});actor('owner');
  const d=node.review[A].intentDigest;
  const before=clone(db.read(NODE));
  const restore=refHook(db,r=>({...r,transaction:async()=>new Promise(()=>{})}));
  const uncertain=await accept(writer,d);
  assert.equal(uncertain.status,'outcome_unknown');assert.deepEqual(db.read(NODE),before);
  restore();
  assert.equal((await accept(writer,d)).status,'resolved');
  db.seed(`tenants/${T}/members/owner2`,true);db.seed(`tenants/${T}/roles/owner2`,'owner');actor('owner2');
  assert.equal((await accept(writer,d)).status,'operation_identity_reused');
});

test('R2-10 owner role in another tenant cannot accept this tenant history',async()=>{
  const db=world(), {writer,node}=await flagged(db);
  db.seed('tenants/anotherTenant/members/foreign',true);db.seed('tenants/anotherTenant/roles/foreign','owner');
  actor('foreign');
  assert.notEqual((await accept(writer,node.review[A].intentDigest)).status,'resolved');
  assert.equal(db.read(NODE).review[A].state,'flagged');
});

test('R2-11 owner removed during history priming is denied by the immediate pre-transaction check',async()=>{
  const db=world(), {writer,node}=await flagged(db);actor('owner');
  const before=clone(db.read(NODE));
  refHook(db,r=>({...r,get:async()=>{const snap=await r.get();db.seed(`tenants/${T}/members/owner`,false);return snap;}}));
  const out=await accept(writer,node.review[A].intentDigest);
  assert.equal(out.status,'unauthorized');assert.deepEqual(db.read(NODE),before);
});
