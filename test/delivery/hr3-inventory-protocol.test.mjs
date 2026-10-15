// Owner 2026-10-15: no operator declaration is a substitute for unavailable completeness evidence.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../../lib/emailDelivery.js';
import { seedWorld, sdkTransactions, releasedHoldRecord, HOLD_PATH } from '../support/daily-email-harness.mjs';
const D='2026-09-08', now=Date.parse(D+'T04:05:00Z');
const op={ actor:'local.review', reason:'local protocol verification', nowMs:now };
async function held() { const db=seedWorld(); sdkTransactions(db,'delivery_control');
  assert.equal((await E.changeDeliveryHold(db,{...op,action:'hold',expectVersion:2})).ok,true);return db; }
const release=(db)=>E.changeDeliveryHold(db,{...op,action:'release',expectVersion:db.read(HOLD_PATH).version});
const confirm=(db,over={})=>{const v=E.deliveryInventoryView(db.read(HOLD_PATH));return E.confirmDeliveryInventory(db,{...op,generation:v.generation,digest:v.digest,...over});};
test('HR3 double refusal-write failure after durable intent and process loss retains pending date and blocks release',async()=>{
 const db=await held(),ref=db.ref;let n=0;
 db.ref=(p,q)=>{const r=ref(p,q);return p===HOLD_PATH?{...r,transaction:async(fn)=>{if(++n===2)throw Error('refusal stamp down');return r.transaction(fn);}}:
  String(p).startsWith(E.HELD_DATES_ROOT)?{...r,transaction:async()=>{throw Error('marker down');}}:r;};
 const g=await E.makeDailyDeliveryGate(db,D)('g1');assert.equal(g.open,false);assert.equal(g.heldDate,'not_recorded');
 const snapshot=structuredClone(db.read(HOLD_PATH));assert.equal(Object.values(snapshot.inventory.entries)[0].state,'pending');
 assert.equal(snapshot.refusedDates,undefined,'uncertain must not claim a proven refusal');
 const restarted=seedWorld();sdkTransactions(restarted,'delivery_control');restarted.seed(HOLD_PATH,snapshot);
 assert.equal((await release(restarted)).code,'inventory_incomplete');
 assert.equal((await confirm(restarted)).code,'inventory_incomplete');
 assert.equal((await E.readDailyDeliveryGate(restarted,D)).open,false);
});
test('HR3 first-intent write failure plus lost process cannot be cleared by an unsupported empty-inventory claim',async()=>{
 const db=await held(),ref=db.ref;db.ref=(p,q)=>p===HOLD_PATH||String(p).startsWith(E.HELD_DATES_ROOT)?{...ref(p,q),transaction:async()=>{throw Error('all evidence down');}}:ref(p,q);
 assert.equal((await E.makeDailyDeliveryGate(db,D)('g1')).open,false);db.ref=ref;
 const before=structuredClone(db.read(HOLD_PATH));assert.deepEqual(Object.keys(before.inventory.entries??{}),[]);
 assert.equal((await confirm(db)).ok,true,'records review only, explicitly not proof');
 assert.equal((await release(db)).code,'inventory_coverage_unverified');
 assert.equal(db.read(HOLD_PATH).state,'held');
});
test('HR3 operator confirmation binds exact content and generation, and changes invalidate it',async()=>{
 const db=await held();await E.makeDailyDeliveryGate(db,D)('g1');
 const v=E.deliveryInventoryView(db.read(HOLD_PATH));
 assert.equal((await confirm(db,{generation:'00000000-0000-4000-8000-000000000000'})).code,'inventory_confirmation_mismatch');
 assert.equal((await confirm(db,{digest:'0'.repeat(64)})).code,'inventory_confirmation_mismatch');
 assert.equal((await confirm(db)).releaseBlocked,true);assert.equal((await release(db)).code,'inventory_coverage_unverified');
 await E.makeDailyDeliveryGate(db,'2026-09-10')('g0');assert.equal(db.read(HOLD_PATH).inventory.confirmation,null);
 assert.equal((await E.confirmDeliveryInventory(db,{...op,generation:v.generation,digest:v.digest})).code,'inventory_confirmation_mismatch');
 assert.equal((await release(db)).code,'inventory_confirmation_required');
 const raw=db.read(HOLD_PATH);raw.state='released';raw.version=4;raw.log.v000000004={...op,action:'release',state:'released',version:4,prevVersion:3,at:now};db.seed(HOLD_PATH,raw);
 assert.equal((await E.changeDeliveryHold(db,{...op,action:'hold',expectVersion:4})).ok,true);
 assert.notEqual(db.read(HOLD_PATH).inventory.generation,v.generation);
 assert.equal((await E.confirmDeliveryInventory(db,{...op,generation:v.generation,digest:v.digest})).code,'inventory_confirmation_mismatch');
});
test('HR3 exact dates retain holes and ignore the legacy blanket fence; released fixture is not an implemented release proof',async()=>{
 const db=await held();await E.makeDailyDeliveryGate(db,D)('g3');const raw=db.read(HOLD_PATH);
 // Model an externally supplied released snapshot ONLY to test date matching, not claim that this writer can release it.
 raw.state='released';raw.version=4;raw.excludedThrough='2099-01-01';raw.log.v000000004={action:'release',state:'released',version:4,prevVersion:3,actor:op.actor,reason:op.reason,at:now};db.seed(HOLD_PATH,raw);
 assert.equal((await E.readDailyDeliveryGate(db,D)).code,'held_day');
 for(const day of ['2026-09-06','2026-09-07','2026-09-09'])assert.equal((await E.readDailyDeliveryGate(db,day)).open,true,day);
 assert.equal(E.deliveryInventoryView(raw).complete,false);
});
test('HR3 contradictory inventory or unavailable release evidence never releases',async()=>{
 const db=await held();await E.makeDailyDeliveryGate(db,D)('g1');const raw=structuredClone(db.read(HOLD_PATH));
 Object.values(raw.inventory.entries)[0].state='allowed';assert.equal(E.classifyHoldRecord(raw).code,'delivery_hold_unreadable');
 const ref=db.ref;db.ref=(p,q)=>p===HOLD_PATH?{...ref(p,q),once:async()=>{throw Error('read down');}}:ref(p,q);
 assert.equal((await release(db)).code,'inventory_read_unavailable');db.ref=ref;
 const missing=structuredClone(db.read(HOLD_PATH));delete missing.inventory;delete missing.refusedDates;db.seed(HOLD_PATH,missing);assert.equal((await release(db)).code,'inventory_missing_or_unreadable');
});

test('HR3 release read hangs are bounded; a declaration cannot supply missing read evidence', {timeout:7000},async()=>{
 const db=await held(),ref=db.ref;db.ref=(p,q)=>p===HOLD_PATH?{...ref(p,q),once:()=>new Promise(()=>{})}:ref(p,q);
 const start=Date.now();assert.equal((await release(db)).code,'inventory_read_unavailable');assert.ok(Date.now()-start<6500);
});

test('HR3 failed hold read after durable intent retains uncertainty; an uncertain marker is never a proven held day',async()=>{
 const db=await held(),ref=db.ref;db.ref=(p,q)=>p===HOLD_PATH?{...ref(p,q),once:async()=>{throw Error('read unavailable');}}:ref(p,q);
 assert.equal((await E.makeDailyDeliveryGate(db,D)('g1')).open,false);db.ref=ref;
 const raw=db.read(HOLD_PATH);assert.equal(Object.values(raw.inventory.entries)[0].state,'pending');assert.equal(raw.refusedDates,undefined);
 assert.equal((await release(db)).code,'inventory_incomplete');
 const released=releasedHoldRecord();db.seed(HOLD_PATH,released);db.seed(E.heldDatePath(D),{businessDate:D,uncertain:true,code:'delivery_hold_unavailable'});
 assert.equal((await E.readDailyDeliveryGate(db,D)).code,'held_day_unverifiable');
});
test('HR3 an unchanged released audit resolves concurrent pre-read intents without claiming hold-generation completeness',async()=>{
 const db=seedWorld();sdkTransactions(db,'delivery_control');
 const results=await Promise.all([E.makeDailyDeliveryGate(db,D)('g1'),E.makeDailyDeliveryGate(db,D)('g1')]);
 assert.ok(results.every(r=>r.open));assert.ok(Object.values(db.read(HOLD_PATH).inventory.entries).every(x=>x.state==='allowed'));
 assert.equal(E.deliveryInventoryView(db.read(HOLD_PATH)).complete,false);
});

test('HR3 a legacy HR2 range with lost exact evidence stays uncertain, including after admission and generation change',async()=>{
 const db=seedWorld();sdkTransactions(db,'delivery_control');db.seed(HOLD_PATH,{...releasedHoldRecord(),excludedThrough:D});
 assert.equal((await E.readDailyDeliveryGate(db,D)).code,'held_day_unverifiable');
 assert.equal((await E.readDailyDeliveryGate(db,'2026-09-09')).open,true);
 assert.equal((await E.makeDailyDeliveryGate(db,D)('g1')).open,false);
 assert.equal(db.read(HOLD_PATH).refusedDates,undefined,'range is not evidence of a proven refused day');
 assert.equal(db.read(HOLD_PATH).inventory.legacyUncertainThrough,D);
 const before=E.deliveryInventoryView(db.read(HOLD_PATH)).digest;
 assert.equal((await E.changeDeliveryHold(db,{...op,action:'hold',expectVersion:2})).ok,true);
 assert.equal(db.read(HOLD_PATH).inventory.legacyUncertainThrough,D);
 assert.notEqual(E.deliveryInventoryView(db.read(HOLD_PATH)).digest,before);
 assert.equal((await release(db)).code,'inventory_incomplete');
});
