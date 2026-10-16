// Real RTDB regression, LOCAL DEMO ONLY. Requires the committed emulator runner; never run against hosted data.
import admin from 'firebase-admin';
import assert from 'node:assert/strict';
import * as E from '../../lib/emailDelivery.js';
if(process.env.FIREBASE_DATABASE_EMULATOR_HOST!=='127.0.0.1:9000'||process.env.GCLOUD_PROJECT!=='demo-marjin-rules'||process.env.GOOGLE_APPLICATION_CREDENTIALS||process.env.FIREBASE_DATABASE_URL)throw Error('SAFETY ABORT: local demo emulator only');
const op={actor:'s3.emulator',reason:'roundtrip verification'},P=E.DELIVERY_HOLD_PATH,D='2026-09-08',N='2026-09-09';
let next=0;const apps=[],results=[];
const cold=()=>{const a=admin.initializeApp({databaseURL:'http://127.0.0.1:9000?ns=demo-marjin-rules-default-rtdb'},'s3-'+next++);apps.push(a);return a.database();};
const read=async()=> (await cold().ref(P).once('value')).val();
const init=async()=>{await cold().ref('/').set(null);assert.equal((await E.changeDeliveryHold(cold(),{...op,action:'init'})).ok,true);};
const confirm=async()=>{const v=E.deliveryInventoryView(await read());return E.confirmDeliveryInventory(cold(),{...op,generation:v.generation,digest:v.digest});};
const release=async(db=cold())=>E.changeDeliveryHold(db,{...op,action:'release',expectVersion:(await read()).version});
async function check(id,fn){try{await fn();results.push({id,ok:true});console.log('ok '+id);}catch(e){results.push({id,ok:false});console.log('FAIL '+id+' '+e.stack);}}
try{
 await check('S3E-01 zero-refusal writer/persisted record/reader/Daily gate, repeated cold clients',async()=>{
  await init();assert.equal((await confirm()).ok,true);const r=await release();assert.equal(r.ok,true);const raw=await read();
  console.log('ZERO_STORED '+JSON.stringify(raw));assert.deepEqual(r.seal,raw.log.v000000002.seal);assert.equal(raw.log.v000000002.seal.refusedDates,undefined);assert.equal(raw.refusedDates,undefined);
  for(let i=0;i<3;i++){assert.equal((await E.readDeliveryHold(cold())).state,'released');assert.equal((await E.readDailyDeliveryGate(cold(),D)).open,true);assert.equal((await E.makeDailyDeliveryGate(cold(),D)('g1')).open,true);assert.equal((await E.readManualDeliveryGate(cold())).open,true);}
  assert.deepEqual(await read(),raw);
 });
 await check('S3E-02 nonzero seal survives serialization and cold-client restart',async()=>{
  await init();assert.equal((await E.makeDailyDeliveryGate(cold(),D)('g1')).code,'delivery_held');assert.equal((await confirm()).ok,true);const r=await release();assert.equal(r.ok,true);
  const raw=await read();console.log('NONZERO_STORED '+JSON.stringify(raw));assert.deepEqual(r.seal,raw.log.v000000002.seal);assert.deepEqual(r.seal.refusedDates,[D]);
  assert.equal((await E.makeDailyDeliveryGate(cold(),D)('g1')).code,'held_day');assert.equal((await E.makeDailyDeliveryGate(cold(),N)('g1')).open,true);
 });
 await check('S3E-03 lost nonempty seal list and malformed scalar stay closed with no new refusal',async()=>{
  const saved=await read();for(const value of [null,'bad']){const raw=structuredClone(saved);raw.log.v000000002.seal.refusedDates=value;await cold().ref(P).set(raw);
   assert.equal((await E.readDeliveryHold(cold())).code,'delivery_hold_unreadable');assert.equal((await E.makeDailyDeliveryGate(cold(),N)('g1')).open,false);assert.equal((await read()).refusedDates[N],undefined);}
  const orphan=structuredClone(saved);delete orphan.refusedDates;delete orphan.log.v000000002.seal.refusedDates;
  await cold().ref(P).set(orphan);console.log('ORPHAN_STORED '+JSON.stringify(await read()));
  assert.equal((await E.readDeliveryHold(cold())).code,'delivery_hold_unreadable');assert.equal((await E.makeDailyDeliveryGate(cold(),N)('g1')).open,false);
  assert.deepEqual((await read()).inventory.entries,saved.inventory.entries);
 });
 await check('S3E-04 empty historical seal remains valid across later nonempty generations',async()=>{
  await init();assert.equal((await confirm()).ok,true);assert.equal((await release()).ok,true);assert.equal((await E.changeDeliveryHold(cold(),{...op,action:'hold',expectVersion:2})).ok,true);
  await E.makeDailyDeliveryGate(cold(),D)('g1');assert.equal((await confirm()).ok,true);assert.equal((await release()).ok,true);
  assert.equal((await E.readDeliveryHold(cold())).state,'released');assert.equal((await E.makeDailyDeliveryGate(cold(),D)('g1')).code,'held_day');assert.equal((await E.makeDailyDeliveryGate(cold(),N)('g1')).open,true);
 });
 await check('S3E-05 empty release acknowledgement lost: return failure, durable re-read opens',async()=>{
  await init();assert.equal((await confirm()).ok,true);const db=cold(),ref=db.ref.bind(db);
  const wrapped={ref:p=>{const x=ref(p);return {transaction:async fn=>{await x.transaction(fn);throw Error('synthetic acknowledgement loss after real commit');}};}};
  assert.equal((await release(wrapped)).code,'transaction_failed');assert.equal((await E.readDeliveryHold(cold())).state,'released');assert.equal((await E.makeDailyDeliveryGate(cold(),D)('g1')).open,true);
 });
 await check('S3E-06 concurrent empty releases and stale confirmation after refusal',async()=>{
  await init();assert.equal((await confirm()).ok,true);const rs=await Promise.all(Array.from({length:4},()=>E.changeDeliveryHold(cold(),{...op,action:'release',expectVersion:1})));
  assert.equal(rs.filter(r=>r.ok).length,1);assert.equal((await E.makeDailyDeliveryGate(cold(),D)('g1')).open,true);
  assert.equal((await E.changeDeliveryHold(cold(),{...op,action:'hold',expectVersion:2})).ok,true);assert.equal((await confirm()).ok,true);await E.makeDailyDeliveryGate(cold(),D)('g1');
  assert.equal((await release()).code,'inventory_confirmation_required');assert.equal((await read()).state,'held');
 });
}finally{for(const app of apps)await app.delete();}
const failed=results.filter(r=>!r.ok).length;console.log('HR3_S3_RTDB '+JSON.stringify({total:results.length,pass:results.length-failed,fail:failed,results}));process.exit(failed||results.length!==6?1:0);
