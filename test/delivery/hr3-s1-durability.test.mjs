// HR3 S1 durability contracts transitioned to the owner's committed-refusal definition.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../../lib/emailDelivery.js';
import { seedWorld, sdkTransactions, HOLD_PATH } from '../support/daily-email-harness.mjs';
const D='2026-09-08', nowMs=Date.parse(D+'T04:05:00Z');
const op={actor:'local.review',reason:'durability verification',nowMs};
const fresh=()=>{const db=seedWorld();sdkTransactions(db,'delivery_control');return db;};
async function held(){const db=fresh();assert.equal((await E.changeDeliveryHold(db,{...op,action:'hold',expectVersion:2})).ok,true);return db;}
async function confirm(db){const v=E.deliveryInventoryView(db.read(HOLD_PATH));return E.confirmDeliveryInventory(db,{...op,generation:v.generation,digest:v.digest});}
const release=(db)=>E.changeDeliveryHold(db,{...op,action:'release',expectVersion:db.read(HOLD_PATH).version});

test('HR3-S1-01 first-write loss and no invocation leave identical durable state; neither is a refusal',async()=>{
 const db=await held(),before=structuredClone(db.read(HOLD_PATH)),ref=db.ref;
 db.ref=(p,q)=>p===HOLD_PATH?{...ref(p,q),transaction:async()=>{throw Error('no commit');}}:ref(p,q);
 assert.equal((await E.makeDailyDeliveryGate(db,D)('g1')).open,false);db.ref=ref;
 assert.deepEqual(db.read(HOLD_PATH),before);assert.equal(db.read(E.heldDatePath(D)),null);
 for(const snapshot of [before,structuredClone(db.read(HOLD_PATH))]){
   const restarted=fresh();restarted.seed(HOLD_PATH,snapshot);assert.equal((await confirm(restarted)).ok,true);
   assert.equal((await release(restarted)).ok,true);assert.equal((await E.readDailyDeliveryGate(restarted,D)).open,true);
 }
});

test('HR3-S1-02 a callback-local open result with committed=false grants no access',async()=>{
 const db=fresh(),ref=db.ref;db.ref=(p,q)=>p===HOLD_PATH?{...ref(p,q),transaction:async(fn)=>{
   fn(structuredClone(db.read(p)));return {committed:false,snapshot:{val:()=>db.read(p)}};}}:ref(p,q);
 const g=await E.makeDailyDeliveryGate(db,D)('g3');assert.deepEqual([g.open,g.code],[false,'delivery_hold_unavailable']);
 assert.equal(db.read(HOLD_PATH).inventory,undefined);
});

test('HR3-S1-03 a contradictory audit before decision cannot open or create refusal evidence',async()=>{
 const db=fresh(),ref=db.ref;db.ref=(p,q)=>p===HOLD_PATH?{...ref(p,q),transaction:async(fn)=>{
   const raw=structuredClone(db.read(p));delete raw.log.v000000002.actor;db.seed(p,raw);return ref(p,q).transaction(fn);}}:ref(p,q);
 const g=await E.makeDailyDeliveryGate(db,D)('g3');assert.deepEqual([g.open,g.code],[false,'delivery_hold_unreadable']);
 assert.equal(db.read(HOLD_PATH).refusedDates,undefined);
});

test('HR3-S1-04 a hold transition racing a released gate is decided on the held server value',async()=>{
 const db=fresh(),ref=db.ref;let changed=false;
 db.ref=(p,q)=>p===HOLD_PATH?{...ref(p,q),transaction:async(fn)=>{
   if(!changed){changed=true;const saved=db.ref;db.ref=ref;
     try{assert.equal((await E.changeDeliveryHold(db,{...op,action:'hold',expectVersion:2})).ok,true);}finally{db.ref=saved;}}
   return ref(p,q).transaction(fn);}}:ref(p,q);
 const g=await E.makeDailyDeliveryGate(db,D)('g3');assert.equal(g.open,false);assert.equal(g.code,'delivery_held');
 assert.equal(db.read(HOLD_PATH).refusedDates[D].decision,'committed_hold_refusal');
});

test('HR3-S1-05 an S1 pending entry is retained and cannot be silently finalized or released over',async()=>{
 const db=await held(),raw=structuredClone(db.read(HOLD_PATH)),id='00000000-0000-4000-8000-000000000099';
 raw.inventory.entries[id]={businessDate:D,observedVersion:3,generation:raw.inventory.generation,stage:'g1',state:'pending'};db.seed(HOLD_PATH,raw);
 assert.equal((await confirm(db)).code,'inventory_incomplete');assert.equal((await release(db)).code,'inventory_incomplete');
 assert.deepEqual(db.read(HOLD_PATH).inventory.entries[id],raw.inventory.entries[id]);
});

test('HR3-S1-06 a late commit after gate timeout cannot retroactively open that invocation',async()=>{
 const db=await held(),ref=db.ref;let finish;
 db.ref=(p,q)=>p===HOLD_PATH?{...ref(p,q),transaction:async(fn)=>{await new Promise(r=>{finish=r;});return ref(p,q).transaction(fn);}}:ref(p,q);
 const g=await E.makeDailyDeliveryGate(db,D,{timeoutMs:20})('g3');
 assert.deepEqual([g.open,g.code],[false,'delivery_hold_unavailable']);assert.equal(typeof finish,'function');
 finish();await new Promise(r=>setImmediate(r));db.ref=ref;
 assert.equal(db.read(HOLD_PATH).refusedDates[D].decision,'committed_hold_refusal');
 assert.equal((await confirm(db)).ok,true);assert.equal((await release(db)).ok,true);
 assert.equal((await E.readDailyDeliveryGate(db,D)).code,'held_day');assert.equal(g.open,false);
});
