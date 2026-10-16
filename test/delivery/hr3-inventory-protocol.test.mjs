// HR3 S2: independent protocol edges beyond the main S2 matrix.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../../lib/emailDelivery.js';
import * as Tool from '../../tools/daily-delivery/hold.mjs';
import { seedWorld, sdkTransactions, HOLD_PATH } from '../support/daily-email-harness.mjs';
const D='2026-09-08', N='2026-09-09', nowMs=Date.parse(D+'T04:05:00Z');
const op={actor:'local.review',reason:'review exact evidence',nowMs};
const fresh=()=>{const db=seedWorld();sdkTransactions(db,'delivery_control');return db;};
async function held(){const db=fresh();assert.equal((await E.changeDeliveryHold(db,{...op,action:'hold',expectVersion:2})).ok,true);return db;}
async function confirm(db){const v=E.deliveryInventoryView(db.read(HOLD_PATH));return E.confirmDeliveryInventory(db,{...op,generation:v.generation,digest:v.digest});}
const release=(db)=>E.changeDeliveryHold(db,{...op,action:'release',expectVersion:db.read(HOLD_PATH).version});

test('HR3 release seal is visible through status and binds the exact reviewed generation',async()=>{
 const db=await held();await E.makeDailyDeliveryGate(db,D)('g1');const before=E.deliveryInventoryView(db.read(HOLD_PATH));
 assert.equal((await confirm(db)).ok,true);const confirmation=structuredClone(db.read(HOLD_PATH).inventory.confirmation);assert.equal((await release(db)).ok,true);
 assert.deepEqual(Tool.statusView(db.read(HOLD_PATH),null).latestSeal,
   {generation:before.generation,digest:before.digest,refusedDates:[D],confirmation});
 assert.equal((await E.readDailyDeliveryGate(db,N)).open,true);
});

test('HR3 release checks inside the transaction, even when an external hold read fails',async()=>{
 const db=await held();assert.equal((await confirm(db)).ok,true);const ref=db.ref;
 db.ref=(p,q)=>p===HOLD_PATH?{...ref(p,q),once:async()=>{throw Error('read down');}}:ref(p,q);
 assert.equal((await release(db)).ok,true);
 db.ref=ref;assert.equal(db.read(HOLD_PATH).state,'released');
});

test('HR3 transaction failure refuses release and a delayed acknowledged commit may succeed',async()=>{
 const db=await held();assert.equal((await confirm(db)).ok,true);const ref=db.ref;
 db.ref=(p,q)=>p===HOLD_PATH?{...ref(p,q),transaction:async()=>{throw Error('down');}}:ref(p,q);
 assert.equal((await release(db)).code,'transaction_failed');db.ref=ref;
 assert.equal(db.read(HOLD_PATH).state,'held');
 let finish;db.ref=(p,q)=>p===HOLD_PATH?{...ref(p,q),transaction:async(fn)=>{await new Promise(r=>{finish=r;});return ref(p,q).transaction(fn);}}:ref(p,q);
 const pending=E.changeDeliveryHold(db,{...op,action:'release',expectVersion:3});
 await new Promise(r=>setTimeout(r,10));assert.equal(typeof finish,'function');finish();
 assert.equal((await pending).code,'applied');db.ref=ref;
});

test('HR3 a new refusal after confirmation blocks release until the exact new digest is reviewed',async()=>{
 const db=await held();assert.equal((await confirm(db)).ok,true);
 assert.equal((await E.makeDailyDeliveryGate(db,D)('g1')).code,'delivery_held');
 assert.equal((await release(db)).code,'inventory_confirmation_required');
 assert.equal((await confirm(db)).ok,true);assert.equal((await release(db)).ok,true);
 assert.equal((await E.readDailyDeliveryGate(db,D)).code,'held_day');
});

test('HR3 legacy marker and range are unresolved evidence, not proof or a blanket refusal',async()=>{
 const db=fresh();db.seed(E.heldDatePath(D),{businessDate:D,code:'delivery_held'});
 assert.equal((await E.readDailyDeliveryGate(db,D)).code,'legacy_evidence_unresolved');
 assert.equal(db.read(HOLD_PATH).refusedDates,undefined);
 db.seed(E.heldDatePath(D),{businessDate:D,uncertain:true,code:'delivery_hold_unavailable'});
 assert.equal((await E.readDailyDeliveryGate(db,D)).open,true);
});
