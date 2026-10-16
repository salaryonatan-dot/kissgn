import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { seedWorld,sdkTransactions,HOLD_PATH as P,releasedHoldRecord,REPO,buildSandbox,installSmtp,freezeClock,runCron,captureConsole,RECEIPTS } from '../support/daily-email-harness.mjs';
import { withRtdbHoldSerialization,rtdbHoldValue } from '../support/hr3-rtdb-hold-model.mjs';
// The same production-writer/read-back regression can run against immutable S2 without changing that checkout.
const E=await import(pathToFileURL((process.env.HR3_TARGET_ROOT||REPO)+'/lib/emailDelivery.js'));
const D='2026-09-08',N='2026-09-09',id='00000000-0000-4000-8000-000000000099';
const op={actor:'s3.review',reason:'bounded evidence check',nowMs:Date.parse(D+'T04:05:00Z')};
const fresh=()=>{const db=withRtdbHoldSerialization(seedWorld({hold:'absent'}));sdkTransactions(db,'delivery_control');return db;};
const init=async()=>{const db=fresh();assert.equal((await E.changeDeliveryHold(db,{...op,action:'init'})).ok,true);return db;};
const view=db=>E.deliveryInventoryView(db.read(P));
const confirm=db=>E.confirmDeliveryInventory(db,{...op,generation:view(db).generation,digest:view(db).digest});
const release=db=>E.changeDeliveryHold(db,{...op,action:'release',expectVersion:db.read(P).version});
const roundTrip=raw=>JSON.parse(JSON.stringify(rtdbHoldValue(raw)));
async function released(nonempty=false){const db=await init();if(nonempty)await E.makeDailyDeliveryGate(db,D)('g1');assert.equal((await confirm(db)).ok,true);const r=await release(db);assert.equal(r.ok,true);return {db,r};}

test('S3-01 F0 production writer -> elided persisted record -> reader -> repeated scheduled/manual gates, zero refusals',async()=>{
 const {db,r}=await released(),raw=roundTrip(db.read(P));
 assert.equal(raw.log.v000000002.seal.refusedDates,undefined);assert.deepEqual(r.seal,raw.log.v000000002.seal);
 assert.equal(raw.refusedDates,undefined);assert.equal(raw.inventory.entries,undefined);
 const restart=fresh();restart.seed(P,raw);
 for(let n=0;n<3;n++){
  assert.deepEqual(await E.readDeliveryHold(restart),{state:'released',code:null,version:2});
  assert.equal((await E.readDailyDeliveryGate(restart,D)).open,true);
  assert.equal((await E.makeDailyDeliveryGate(restart,D)('g1')).open,true);
  assert.equal((await E.readManualDeliveryGate(restart)).open,true);
 }
 assert.deepEqual(restart.read(P),raw,'reads and decisions add no evidence');
 assert.equal((await E.changeDeliveryHold(restart,{...op,action:'hold',expectVersion:2})).ok,true);
 assert.equal((await confirm(restart)).ok,true);assert.equal((await release(restart)).ok,true);
 assert.equal((await E.makeDailyDeliveryGate(restart,D)('g1')).open,true);
});

test('S3-02 nonempty seal round-trips; retained refusal survives later empty generations and restart',async()=>{
 const {db,r}=await released(true);assert.deepEqual(r.seal.refusedDates,[D]);
 assert.deepEqual(roundTrip(db.read(P)).log.v000000002.seal,r.seal);
 assert.equal((await E.readDailyDeliveryGate(db,D)).code,'held_day');assert.equal((await E.makeDailyDeliveryGate(db,N)('g1')).open,true);
 assert.equal((await E.changeDeliveryHold(db,{...op,action:'hold',expectVersion:2})).ok,true);
 assert.equal((await confirm(db)).ok,true);assert.equal((await release(db)).ok,true);
 const restart=fresh();restart.seed(P,roundTrip(db.read(P)));
 assert.deepEqual(restart.read(P).log.v000000004.seal.refusedDates,[D]);
 assert.equal((await E.makeDailyDeliveryGate(restart,D)('g1')).code,'held_day');
});

test('S3-03 missing nonempty seal, explicit null/object/scalar, wrong/duplicate dates remain unreadable',async()=>{
 const {db}=await released(true),saved=roundTrip(db.read(P));
 for(const value of [undefined,null,{},'bad',[],[N],[D,D]]){
  const raw=structuredClone(saved);if(value===undefined)delete raw.log.v000000002.seal.refusedDates;else raw.log.v000000002.seal.refusedDates=value;
  db.seed(P,raw);assert.equal((await E.readDeliveryHold(db)).code,'delivery_hold_unreadable');
  assert.equal((await E.makeDailyDeliveryGate(db,N)('g1')).open,false);
 }
 // A direct reader still rejects explicit malformed values even when persistence would remove an empty object.
 for(const value of [null,{},'bad',Array(1)]){const raw=structuredClone(saved);raw.log.v000000002.seal.refusedDates=value;assert.equal(E.classifyHoldRecord(raw).code,'delivery_hold_unreadable');}
});

test('S3-04 empty-list omission is scoped to dates already refused at that seal, later refusals do not invalidate history',async()=>{
 const {db}=await released();assert.equal((await E.changeDeliveryHold(db,{...op,action:'hold',expectVersion:2})).ok,true);
 await E.makeDailyDeliveryGate(db,D)('g1');assert.equal((await E.readDeliveryHold(db)).code,'delivery_held');
 assert.equal((await confirm(db)).ok,true);assert.equal((await release(db)).ok,true);
 assert.equal((await E.readDailyDeliveryGate(db,N)).open,true);assert.equal((await E.readDailyDeliveryGate(db,D)).code,'held_day');
});

test('S3-05 Z02 atomic proofs bind code and observed held audit version',async()=>{
 const {db}=await released(true),saved=roundTrip(db.read(P)),intent=saved.refusedDates[D].intent;
 for(const change of [r=>{r.inventory.entries[intent].code='held_day';},r=>{r.inventory.entries[intent].observedVersion=2;}]){
  const raw=structuredClone(saved);change(raw);db.seed(P,raw);
  assert.equal((await E.makeDailyDeliveryGate(db,N)('g1')).code,'delivery_hold_unreadable');
 }
});

test('S3-06 F2/Z03 pending released observation resolves gate only on unchanged released audit, without deleting evidence',async()=>{
 const db=fresh(),raw=releasedHoldRecord();raw.inventory={schema:1,generation:id,holdVersion:2,revision:1,coverage:'unverified',entries:{[id]:{businessDate:D,observedVersion:2,generation:id,state:'pending',stage:'g1'}}};
 db.seed(P,raw);const saved=roundTrip(db.read(P));
 assert.equal((await E.readDailyDeliveryGate(db,D)).open,true);assert.equal((await E.makeDailyDeliveryGate(db,D)('g1')).open,true);
 assert.deepEqual(db.read(P),saved);assert.equal(db.read(P).refusedDates,undefined);
 // A held observation or a later transition cannot be resolved by this narrow audit proof.
 raw.inventory.entries[id].observedVersion=1;db.seed(P,raw);
 assert.equal((await E.makeDailyDeliveryGate(db,D)('g1')).code,'legacy_evidence_unresolved');
 raw.inventory.entries[id].observedVersion=2;db.seed(P,raw);
 assert.equal((await E.changeDeliveryHold(db,{...op,action:'hold',expectVersion:2})).ok,true);
 assert.equal((await confirm(db)).code,'inventory_incomplete');assert.equal((await release(db)).code,'inventory_incomplete');
 assert.deepEqual(db.read(P).inventory.entries[id],raw.inventory.entries[id]);
});

test('S3-07 Z07/Z08 exact digest binds proof extension and audit content after confirmation',async()=>{
 const db=await init();await E.makeDailyDeliveryGate(db,D)('g1');assert.equal((await confirm(db)).ok,true);
 const saved=roundTrip(db.read(P));
 for(const change of [r=>{r.refusedDates[D].extra='changed';},r=>{r.log.v000000001.reason='changed audit';},r=>{r.log.v000000001.actor='another.actor';},r=>{r.log.v000000001.at++;}]){
  const raw=structuredClone(saved);change(raw);db.seed(P,raw);assert.notEqual(view(db).digest,saved.inventory.confirmation.digest);
  assert.equal((await release(db)).code,'inventory_confirmation_mismatch');assert.equal(db.read(P).state,'held');
 }
});

test('S3-08 Z10 legacy held lazy inventory never acquires S2 origin',async()=>{
 const db=fresh(),raw=releasedHoldRecord();raw.state='held';raw.version=1;delete raw.log.v000000002;db.seed(P,raw);
 assert.equal((await E.makeDailyDeliveryGate(db,D)('g1')).code,'delivery_held');
 assert.equal(db.read(P).inventory.openedBy,undefined);assert.equal(db.read(P).inventory.decisionProtocol,undefined);
 assert.equal((await confirm(db)).code,'inventory_coverage_unverified');assert.equal((await release(db)).code,'inventory_coverage_unverified');
});

test('S3-09 Z11 recorded origin action must match audited action',async()=>{
 const db=await init(),raw=roundTrip(db.read(P));raw.inventory.openedBy.action='hold';db.seed(P,raw);
 assert.equal((await confirm(db)).code,'inventory_coverage_unverified');assert.equal((await release(db)).code,'inventory_coverage_unverified');
});

test('S3-10 Z12 inventory-only legacy range survives hold; no silent reinterpretation as a refusal',async()=>{
 const db=fresh(),raw=releasedHoldRecord();raw.inventory={schema:1,generation:id,holdVersion:2,revision:0,coverage:'unverified',legacyUncertainThrough:D};db.seed(P,raw);
 assert.equal((await E.changeDeliveryHold(db,{...op,action:'hold',expectVersion:2})).ok,true);
 assert.equal(db.read(P).inventory.legacyUncertainThrough,D);assert.equal(db.read(P).refusedDates,undefined);
 assert.equal((await confirm(db)).code,'inventory_incomplete');assert.equal((await release(db)).code,'inventory_incomplete');
});

test('S3-11 Z06 malformed second copy stays closed even on an error marker',async()=>{
 const {db}=await released();db.seed(E.heldDatePath(D),{uncertain:true,code:'delivery_hold_unavailable',committedRefusal:{bad:true}});
 assert.equal((await E.makeDailyDeliveryGate(db,D)('g1')).code,'held_day_unverifiable');
});

test('S3-12 serialized empty release failure before commit vs lost acknowledgement remain distinguishable by durable read',async()=>{
 for(const committed of [false,true]){
  const db=await init();assert.equal((await confirm(db)).ok,true);const ref=db.ref;
  db.ref=(p,q)=>p===P?{...ref(p,q),transaction:async fn=>{if(committed)await ref(p,q).transaction(fn);throw Error('persistence failure');}}:ref(p,q);
  assert.equal((await release(db)).code,'transaction_failed');db.ref=ref;
  assert.equal((await E.readDeliveryHold(db)).state,committed?'released':'held');
  if(committed)assert.equal((await E.makeDailyDeliveryGate(db,D)('g1')).open,true);
  else assert.equal(db.read(P).log.v000000002,undefined);
 }
});

test('S3-13 serialized empty concurrent releases create one seal; refusal racing confirmation still closes release',async()=>{
 const db=await init();assert.equal((await confirm(db)).ok,true);
 const rs=await Promise.all([release(db),release(db)]);assert.equal(rs.filter(r=>r.ok).length,1);
 assert.equal((await E.makeDailyDeliveryGate(db,N)('g1')).open,true);
 assert.equal((await E.changeDeliveryHold(db,{...op,action:'hold',expectVersion:2})).ok,true);
 assert.equal((await confirm(db)).ok,true);await E.makeDailyDeliveryGate(db,D)('g1');
 assert.equal((await release(db)).code,'inventory_confirmation_required');assert.equal(db.read(P).state,'held');
});

test('S3-14 route evaluates normal Daily gate after zero-refusal release; malformed state still has no claim/provider/notice',
 {skip:!!process.env.HR3_TARGET_ROOT && 'parent trace targets S3-01; route sandbox is candidate-only'},async()=>{
 // Uses S3 route + production dependencies with controlled terminal seams, never a real provider.
 const {route}=await buildSandbox();const restore=freezeClock(op.nowMs);
 try{
  const {db}=await released();globalThis.__DB=db;const smtp=installSmtp();
  const {value:res}=await captureConsole(()=>runCron(route));assert.equal(res.statusCode,200);assert.ok(smtp.calls.length>0);
  const blocked=fresh();blocked.seed(P,{schema:1,state:'released'});globalThis.__DB=blocked;const noSend=installSmtp();
  const {value:closed}=await captureConsole(()=>runCron(route));assert.equal(closed.statusCode,503);assert.equal(noSend.calls.length,0);
  assert.equal(blocked.read(RECEIPTS),null);assert.equal(blocked.read('email_delivery/daily_snapshot_notices'),null);assert.equal(blocked.read(E.heldDatePath(D)),null);
 }finally{restore();}
});


test('S3-15 retained orphan refusal evidence cannot become an empty seal when proof map and seal list are missing',async()=>{
 const db=await init(),ref=db.ref;
 db.ref=(p,q)=>p===E.heldDatePath(D)?{...ref(p,q),transaction:async()=>{throw Error('second copy unavailable');}}:ref(p,q);
 const refusal=await E.makeDailyDeliveryGate(db,D)('g1');db.ref=ref;
 assert.equal(refusal.code,'delivery_held');assert.equal(refusal.heldDate,'not_recorded');
 assert.equal((await confirm(db)).ok,true);assert.equal((await release(db)).ok,true);
 const raw=roundTrip(db.read(P)),entries=structuredClone(raw.inventory.entries);
 delete raw.refusedDates;delete raw.log.v000000002.seal.refusedDates;db.seed(P,raw);
 assert.equal((await E.readDeliveryHold(db)).code,'delivery_hold_unreadable');
 for(const date of [D,N])assert.equal((await E.makeDailyDeliveryGate(db,date)('g1')).open,false);
 assert.equal((await E.readManualDeliveryGate(db)).open,false);
 assert.deepEqual(db.read(P).inventory.entries,entries);assert.equal(db.read(P).refusedDates,undefined);
 assert.equal(db.read(E.heldDatePath(N)),null,'malformed state creates no refusal');
});
