import {test} from 'node:test';
import assert from 'node:assert/strict';
import {makeDb} from '../../tools/storage-v2/reader-sandbox.mjs';
import {loadWriter} from '../support/f1-writer-harness.mjs';
import {loadCommitted, loadCompiled, REPO} from '../support/fincore-load.mjs';
import {attestationDigest} from '../../lib/finance/costHistoryWriter.js';

const W=await loadWriter(REPO), F=await loadCommitted();
const T='tenantA', B='bizA', NODE=`tenants/${T}/biz:${B}:cost_history`;
const A='00000000-0000-4000-8000-0000000000a1', C='00000000-0000-4000-8000-0000000000c3';
const D='00000000-0000-4000-8000-0000000000d4';
const NOW=Date.parse('2026-10-02T09:00:00Z');
const head=(id,revision)=>({revision,headVersionId:id});
const body=(versionId,expectedHead,effectiveFrom='2026-10-02',basis='recorded')=>({versionId,expectedHead,effectiveFrom,basis,
  globalEmployees:[{employeeKey:'g1',monthlyEmployerCost:'10000'}],fixedItems:[{itemKey:'f1',monthlyAmount:'3000'}],
  rent:{mode:'fixed',monthlyAmount:'2000'},royalty:{mode:'pct',ratePct:'3'}});
const clone=x=>JSON.parse(JSON.stringify(x));
function world({role='owner',now=NOW,module=W}={}){
  const db=makeDb();
  for(const [uid,r] of [['owner',role],['manager','manager']]){
    db.seed(`tenants/${T}/members/${uid}`,true);db.seed(`tenants/${T}/roles/${uid}`,r);
    db.seed(`tenants/${T}/biz_access/${B}/${uid}`,true);
  }
  db.seed(`tenants/${T}/app/business`, { _v: JSON.stringify([{ id: B, name: "A" }]) });   // R3: business registry
  globalThis.__DB=db;globalThis.__CLAIMS={uid:'owner',email:'owner@x'};
  const writer=module.createCostHistoryWriter({db,clock:()=>now});
  return {db,writer,advance:(ms=10)=>{now+=ms;}};
}
const req={headers:{}};
const act=(w,b)=>w.activateCostHistory(req,{tenantId:T,bizId:B,body:b});
const edit=(w,b)=>w.recordCostEdit(req,{tenantId:T,bizId:B,body:b});
const attest=(w,b)=>w.attestHistoricalCostEdit(req,{tenantId:T,bizId:B,body:b});
async function first(w){const r=await act(w,body(A,null));assert.equal(r.status,'committed_current');assert.equal(r.review,'cleared');return r;}

test('F2-01 activation is explicit, owner-only, server-today, and exactly once',async()=>{
  const {db,writer}=world();
  assert.equal(db.read(NODE),null);
  assert.equal((await writer.readCostHistory(req,{tenantId:T,bizId:B})).status,'absent');
  globalThis.__CLAIMS={uid:'manager',email:'manager@x'};
  assert.equal((await act(writer,body(A,null))).status,'role_not_allowed');
  assert.equal(db.read(NODE),null);
  globalThis.__CLAIMS={uid:'owner',email:'owner@x'};
  db.seed(`tenants/${T}/roles/owner`,'super_owner');
  assert.equal((await act(writer,body(A,null))).status,'role_not_allowed');
  assert.equal(db.read(NODE),null);
  db.seed(`tenants/${T}/roles/owner`,'owner');
  db.seed(`tenants/${T}/members/owner`,false);
  assert.notEqual((await act(writer,body(A,null))).status,'committed_current');
  assert.equal(db.read(NODE),null);
  db.seed(`tenants/${T}/members/owner`,true);
  assert.equal((await act(writer,body(A,null,'2026-10-01'))).status,'activation_date_mismatch');
  await first(writer);
  const stored=clone(db.read(NODE));
  assert.equal(F.costHistory.codec.decodeHistory({exists:true,value:stored}).state,'present');
  assert.equal(stored.head.revision,1);
  assert.equal((await act(writer,body(A,null))).status,'committed_current');
  assert.deepEqual(db.read(NODE),stored);
  assert.equal((await act(writer,body(C,null))).status,'already_activated');   // R3: activation over an effective history is refused by name
  assert.deepEqual(db.read(NODE),stored);
});

test('F2-02 normal edit uses today/future, rejects past and cannot silently activate',async()=>{
  const {db,writer,advance}=world();
  assert.equal((await edit(writer,body(A,null))).status,'edit_shape');
  assert.equal(db.read(NODE),null);
  await first(writer);advance();
  const past=await edit(writer,body(C,head(A,1),'2026-10-01'));
  assert.equal(past.status,'recorded_past_date');
  assert.equal(Object.keys(db.read(NODE).versions).length,1);
  globalThis.__CLAIMS={uid:'manager',email:'manager@x'};
  const r=await edit(writer,body(C,head(A,1),'2026-10-05'));
  assert.equal(r.status,'committed_current');assert.equal(r.review,'cleared');
  assert.equal(db.read(NODE).versions[C].predecessorVersionId,A);
  assert.equal(F.costHistory.codec.decodeHistory({exists:true,value:db.read(NODE)}).state,'present');
});

test('F2-03 historical edit is a separate attested path with durable reason, actor and digest',async()=>{
  const {db,writer,advance}=world();await first(writer);advance();
  const b=body(C,head(A,1),'2026-09-29','attested_retroactive');
  b.attestationReason='invoice correction';
  b.attestation={confirmed:true,typedEffectiveFrom:b.effectiveFrom,confirmedSnapshotDigest:attestationDigest(b)};
  assert.equal((await edit(writer,b)).status,'edit_shape');
  assert.equal((await attest(writer,{...b,attestationReason:''})).status,'attestation_reason_missing');
  assert.equal((await attest(writer,{...b,attestation:{...b.attestation,typedEffectiveFrom:'2026-09-28'}})).status,'attestation_missing');
  assert.equal((await attest(writer,{...b,effectiveFrom:'2026-10-02'})).status,'attestation_missing');
  const r=await attest(writer,b);assert.equal(r.status,'committed_current');
  const v=db.read(NODE).versions[C];
  assert.deepEqual([v.schema,v.attestationReason,v.attestationDigest,v.attestedBy,v.attestedAt],
    ['MARJIN_COSTV/2','invoice correction',b.attestation.confirmedSnapshotDigest,'owner',v.recordedAt]);
  assert.equal(F.costHistory.codec.decodeHistory({exists:true,value:db.read(NODE)}).state,'present');
  const fresh=await loadCompiled();
  assert.deepEqual(fresh.costHistory.codec.decodeHistory({exists:true,value:db.read(NODE)}),
    F.costHistory.codec.decodeHistory({exists:true,value:db.read(NODE)}),'fresh/server and browser artifact decode the same attested node');
  const bad=clone(db.read(NODE));delete bad.versions[C].attestationReason;
  assert.equal(F.costHistory.codec.decodeHistory({exists:true,value:bad}).state,'unreadable');
  assert.equal((await attest(writer,b)).status,'committed_current');
  const reused={...b,fixedItems:[{itemKey:'f1',monthlyAmount:'9000'}]};
  reused.attestation.confirmedSnapshotDigest=attestationDigest(reused);
  assert.equal((await attest(writer,reused)).status,'identity_reused');
});

test('F2-04 concurrent same-head edits yield one winner, conflict and no orphan',async()=>{
  const {db,writer,advance}=world();await first(writer);advance();
  const out=await Promise.all([edit(writer,body(C,head(A,1))),edit(writer,body(D,head(A,1)))]);
  assert.equal(out.filter(x=>x.status==='committed_current').length,1,JSON.stringify(out));
  assert.equal(out.filter(x=>x.status==='head_conflict').length,1,JSON.stringify(out));
  assert.equal(Object.keys(db.read(NODE).versions).length,2);
  assert.equal(db.read(NODE).head.revision,2);
});

test('F2-05 pending and flagged versions withhold calculations and writer refuses a successor',async()=>{
  const {db,writer}=world();
  const root=db.ref;let committed=false;
  db.ref=p=>p===NODE?{...root(p),transaction:async(...args)=>{const out=await root(p).transaction(...args);if(out.committed&&!committed){committed=true;db.seed(`tenants/${T}/members/owner`,false);}return out;}}:root(p);
  const r=await act(writer,body(A,null));
  assert.equal(r.review,'flagged');
  const raw=db.read(NODE);
  assert.equal(F.costHistory.codec.decodeHistory({exists:true,value:raw}).reason,'authorization_review_flagged');
  db.seed(`tenants/${T}/members/owner`,true);
  assert.equal((await edit(writer,body(C,head(A,1)))).status,'review_unresolved');
});

test('F2-M01 meaningful writer mutations reopen owner activation and command-separation defects',async()=>{
  const PATH='lib/finance/costHistoryWriter.js';
  const ownerBypass=await loadWriter(REPO,{mutations:[[PATH,'return saveCostVersion(req, { tenantId, bizId, body, requiredRole: "owner", command: "activate" });','return saveCostVersion(req, { tenantId, bizId, body, command: "activate" });']]});
  {
    const {db,writer}=world({module:ownerBypass});
    globalThis.__CLAIMS={uid:'manager',email:'manager@x'};
    assert.equal((await act(writer,body(A,null))).status,'committed_current','mutant allows manager to activate');
    assert.equal(db.read(NODE).head.revision,1);
  }
  const SHAPE=['if (!body || body.expectedHead === null || body.basis !== "recorded") return { status: "edit_shape" };','if (!body || body.basis !== "recorded") return { status: "edit_shape" };'];
  const GATE=['if (command && command !== "activate" && (h.state !== "present" || effective === 0)) return "activation_required";','if (false) return "activation_required";'];
  const normalBypass=await loadWriter(REPO,{mutations:[[PATH,...SHAPE]]});
  {
    // R3 defence in depth: removing the edit-shape check alone is caught by the activation gate (an edit needs an EFFECTIVE version)
    const {db,writer}=world({module:normalBypass});
    globalThis.__CLAIMS={uid:'manager',email:'manager@x'};
    assert.equal((await edit(writer,body(A,null))).status,'activation_required','the activation gate still refuses a silent activation');
    assert.equal(db.read(NODE),null);
  }
  const doubleBypass=await loadWriter(REPO,{mutations:[[PATH,...SHAPE],[PATH,...GATE]]});
  {
    const {db,writer}=world({module:doubleBypass});
    globalThis.__CLAIMS={uid:'manager',email:'manager@x'};
    assert.equal((await edit(writer,body(A,null))).status,'committed_current','both lines removed ⇒ the mutant silently activates (each line is meaningful)');
    assert.equal(db.read(NODE).head.revision,1);
  }
  const attestBypass=await loadWriter(REPO,{mutations:[[PATH,'if (!body || body.expectedHead === null || body.basis !== "attested_retroactive") return { status: "attested_edit_shape" };','if (!body || body.expectedHead === null) return { status: "attested_edit_shape" };']]});
  {
    const {db,writer,advance}=world({module:attestBypass});await first(writer);advance();
    assert.equal((await attest(writer,body(C,head(A,1)))).status,'committed_current','mutant lets normal edit masquerade as attested');
    assert.equal(db.read(NODE).versions[C].basis,'recorded');
  }
});
