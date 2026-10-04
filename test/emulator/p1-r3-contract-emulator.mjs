// Local-only R3 authority/identity/Rules proofs. Actual API/domain/repository and two Admin connections.
import admin from 'firebase-admin';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {apiHarness,seed,env,T,B,NODE,cid,oid,createBody,ROOT} from '../support/p1-r3-api-harness.mjs';
import {creditNode,spec} from '../support/p1-credit-fixtures.mjs';
const HOST='127.0.0.1:9000',NS='demo-marjin-rules-default-rtdb';
if(process.env.FIREBASE_DATABASE_EMULATOR_HOST!==HOST||process.env.GCLOUD_PROJECT!=='demo-marjin-rules'||process.env.GOOGLE_APPLICATION_CREDENTIALS||process.env.FIREBASE_DATABASE_URL)throw Error('local emulator only');
const rules=JSON.parse(readFileSync(ROOT+'/database.rules.json','utf8'));
const load=async r=>{const s=await fetch(`http://${HOST}/.settings/rules.json?ns=${NS}`,{method:'PUT',headers:{Authorization:'Bearer owner','Content-Type':'application/json'},body:JSON.stringify(r)});assert.ok(s.ok)};
const apps=[];const app=(name,auth)=>{const a=admin.initializeApp({databaseURL:`http://${HOST}?ns=${NS}`,...(auth?{databaseAuthVariableOverride:auth}:{})},name);apps.push(a);return a.database()};
const db=app('r3-seed'),dba=app('r3-a'),dbb=app('r3-b');
let hookA=null;const wrapped={ref:p=>new Proxy(dba.ref(p),{get(target,k){if(k==='transaction'&&hookA)return(...args)=>hookA(p,target,args);const v=target[k];return typeof v==='function'?v.bind(target):v}})};
const a=await apiHarness(wrapped),b=await apiHarness(dbb);
const reset=async()=>{hookA=null;await load(rules);await db.ref('/').set(seed())};
let failed=0,passed=0;
async function run(name,fn){try{await reset();await fn();passed++;console.log('PASS',name)}catch(e){failed++;console.error('FAIL',name,e.stack)}}
const stored=async()=> (await db.ref(NODE).get()).val();
const deny=async p=>{let error;try{await p}catch(e){error=e}assert.ok(error&&/permission/i.test(String(error.code||error.message)))};
try{
await run('R3E-01 all six routes refuse stale biz_access on unregistered business without writes',async()=>{
 for(const action of ['create-supplier-credit','list-supplier-credits','void-supplier-credit','replace-supplier-credit','decide-supplier-credit-review','reconcile-supplier-credit-reviews']){
  const r=await a.call(action,createBody(1,{bizId:'ghost',expectedSeq:1,newCreditId:cid(2),targetOperationId:oid(1),intentDigest:'a'.repeat(64),decision:'accept'}),'own',action.startsWith('list')?'GET':'POST');assert.equal(r.code,403);assert.equal(r.body.error,'business_not_in_tenant');}
 assert.equal((await db.ref(`tenants/${T}/biz:ghost:supplier_credits`).get()).exists(),false);
});
await run('R3E-02 two independent instances exact normalized duplicates have one record and reservation',async()=>{
 const variants=['CR-001','cr-001','ＣＲ－００１','  CR-001  '];
 const rr=await Promise.all(variants.map((documentNumber,i)=>(i%2?a:b).call('create-supplier-credit',createBody(i+1,{documentNumber}))));
 assert.equal(rr.filter(r=>r.code===200).length,1);assert.equal(rr.filter(r=>r.body.error==='duplicate_document').length,3);
 assert.equal(Object.keys((await stored()).records).length,1);assert.equal(Object.keys((await stored()).documents.s_s1).length,1);
 await db.ref(`tenants/${T}/biz:${B}:suppliers`).set(env([{id:'s1',documentNumberCaseSensitive:true},{id:'s2'}]));
 assert.equal((await a.call('create-supplier-credit',createBody(9,{documentNumber:'CR-001'}))).body.error,'duplicate_document');
 assert.equal((await b.call('create-supplier-credit',createBody(10,{documentNumber:'CR-001',supplierId:'s2'}))).code,200);
});
await run('R3E-03 registry removal during commit flags; audit failure leaves pending',async()=>{
 let calls=0;hookA=async(p,r,args)=>{if(p===NODE){calls++;if(calls===1)await db.ref(`tenants/${T}/app/business`).set(env([]));}return r.transaction(...args)};
 const res=await a.call('create-supplier-credit',createBody());assert.equal(res.body.review,'flagged');assert.equal((await stored()).review[oid(1)].flagAudit.bizId,B);
 await reset();calls=0;hookA=async(p,r,args)=>{if(p===NODE){calls++;if(calls===1)await db.ref(`tenants/${T}/app/business`).set(env([]));else throw Error('audit offline')}return r.transaction(...args)};
 const pending=await a.call('create-supplier-credit',createBody());assert.equal(pending.body.review,'pending');assert.equal((await stored()).review[oid(1)].flagAudit,undefined);
});
await run('R3E-04 two owners race accept/reject; one terminal audit, no fifth state',async()=>{
 const n=creditNode([spec(1,'s1','2026-10-01','10',{review:'flagged'})]);await db.ref(NODE).set(n);
 const body={tenantId:T,bizId:B,targetOperationId:oid(1),intentDigest:n.review[oid(1)].intentDigest};
 const results=await Promise.all([a.call('decide-supplier-credit-review',{...body,operationId:oid(90),decision:'accept'},'own'),b.call('decide-supplier-credit-review',{...body,operationId:oid(91),decision:'reject'},'own')]);
 assert.equal(results.filter(r=>r.code===200).length,1);assert.equal(results.filter(r=>r.code===409).length,1);
 const review=(await stored()).review[oid(1)];assert.ok(['cleared','rejected'].includes(review.state));assert.equal(review.decisionAudit.decision,review.state==='cleared'?'accepted':'rejected');
});
await run('R3E-05 decision proposal loses owner during window: remains flagged, retry/lost ack recovers',async()=>{
 await db.ref(`tenants/${T}/biz_access/${B}/own`).set(true);
 const n=creditNode([spec(1,'s1','2026-10-01','10',{review:'flagged'})]);await db.ref(NODE).set(n);
 const body={tenantId:T,bizId:B,targetOperationId:oid(1),intentDigest:n.review[oid(1)].intentDigest,operationId:oid(90),decision:'accept'};let fired=false;
 hookA=async(p,r,args)=>{const x=await r.transaction(...args);if(p===NODE&&!fired){fired=true;await db.ref(`tenants/${T}/roles/own`).set('manager')}return x};
 assert.equal((await a.call('decide-supplier-credit-review',body,'own')).body.decisionPending,true);assert.equal((await stored()).review[oid(1)].state,'flagged');
 await db.ref(`tenants/${T}/roles/own`).set('owner');hookA=async(p,r,args)=>{const x=await r.transaction(...args);if(p===NODE&&x.committed)throw Error('lost ack');return x};
 assert.equal((await a.call('decide-supplier-credit-review',body,'own')).code,200);assert.equal((await stored()).review[oid(1)].state,'cleared');
});
await run('R3E-06 lost ack full payload mismatch cannot be success',async()=>{
 let once=false;hookA=async(p,r,args)=>{const x=await r.transaction(...args);if(p===NODE&&!once&&x.committed){once=true;await db.ref(`${NODE}/records/${cid(1)}/amount`).set('9999');throw Error('lost ack')}return x};
 const r=await a.call('create-supplier-credit',createBody());assert.equal(r.code,409);assert.equal(r.body.error,'stored_payload_mismatch');
});
await run('R3E-07 Rules direct/ancestor/multipath, legacy and duplicate registry deny all client roles',async()=>{
 for(const uid of ['own','mgr','super','view','foreign']){const c=app('r3-client-'+uid,{uid});
  await deny(c.ref(NODE).set({forged:true}));await deny(c.ref(`${NODE}/documents/s_s1/d_x`).set({forged:true}));
  await deny(c.ref(`tenants/${T}`).update({[`biz:${B}:supplier_credits/review/fake`]:{state:'cleared'}}));
  await deny(c.ref(`tenants/${T}/biz:${B}:credits`).set(env([])));}
});
await run('R3E-08 weakened Rules each demonstrably permit the forbidden P1/legacy write',async()=>{
 const changes=[
 ['client-write',r=>r.rules.tenants.$tenantId.$dataKey['.write']="auth != null",NODE],
 ['ancestor',r=>r.rules.tenants.$tenantId['.write']="auth != null",NODE],
 ['multipath',r=>r.rules.tenants['.write']="auth != null",NODE],
 ['membership',r=>r.rules.tenants.$tenantId.$dataKey['.write']="root.child('tenants').child($tenantId).child('members').child(auth.uid).val() === true",NODE],
 ['stale-access',r=>r.rules.tenants.$tenantId.$dataKey['.write']="root.child('tenants').child($tenantId).child('biz_access').child('ghost').child(auth.uid).val() === true",`tenants/${T}/biz:ghost:supplier_credits`],
 ['role',r=>r.rules.tenants.$tenantId.$dataKey['.write']="root.child('tenants').child($tenantId).child('roles').child(auth.uid).val() === 'manager'",NODE],
 ['legacy',r=>r.rules.tenants.$tenantId.$dataKey['.write']="auth != null",`tenants/${T}/biz:${B}:credits`],
 ['duplicate-registry',r=>r.rules.tenants.$tenantId.$dataKey.documents={'.write':'auth != null'},`${NODE}/documents/s_s1/d_x`]];
 for(const [name,mut,path]of changes){const r=structuredClone(rules);mut(r);await load(r);const c=app('r3-mut-'+name,{uid:'mgr'});await c.ref(path).set(name==='legacy'?env([]):{forged:true});console.log('DETECTED weakened',name);await load(rules);}
});
}finally{await load(rules);await Promise.all(apps.map(x=>x.delete()))}
console.log(JSON.stringify({passed,failed}));process.exitCode=failed?1:0;
