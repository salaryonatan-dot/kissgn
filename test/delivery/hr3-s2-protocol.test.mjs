import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,cpSync,writeFileSync,symlinkSync,realpathSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import * as E from '../../lib/emailDelivery.js';
import { seedWorld, sdkTransactions, releasedHoldRecord, HOLD_PATH, REPO } from '../support/daily-email-harness.mjs';
const D='2026-09-08', N='2026-09-09', nowMs=Date.parse(D+'T04:05:00Z');
const op={actor:'local.review',reason:'protocol verification',nowMs};
const fresh=()=>{const db=seedWorld();sdkTransactions(db,'delivery_control');return db;};
const held=async()=>{const db=fresh();assert.equal((await E.changeDeliveryHold(db,{...op,action:'hold',expectVersion:2})).ok,true);return db;};
const view=(db)=>E.deliveryInventoryView(db.read(HOLD_PATH));
const confirm=(db,over={})=>E.confirmDeliveryInventory(db,{...op,generation:view(db).generation,digest:view(db).digest,...over});
const release=(db,over={})=>E.changeDeliveryHold(db,{...op,action:'release',expectVersion:db.read(HOLD_PATH).version,...over});

test('S2-01 atomic refusal, duplicate no-op, exact confirmation and sealed release',async()=>{
 const db=await held();assert.equal((await E.makeDailyDeliveryGate(db,D)('g1')).code,'delivery_held');
 const raw=structuredClone(db.read(HOLD_PATH)),p=raw.refusedDates[D];
 assert.equal(p.decision,'committed_hold_refusal');assert.equal(raw.inventory.entries[p.intent].state,'refused');
 await E.makeDailyDeliveryGate(db,D)('g0');assert.deepEqual(db.read(HOLD_PATH),raw);
 assert.equal((await release(db)).code,'inventory_confirmation_required');assert.equal((await confirm(db)).ok,true);
 assert.equal(view(db).complete,true);const v=view(db),confirmation=structuredClone(db.read(HOLD_PATH).inventory.confirmation),r=await release(db);
 assert.equal(r.code,'applied');assert.deepEqual(r.seal,{generation:v.generation,digest:v.digest,refusedDates:[D],confirmation});
 assert.equal((await E.readDailyDeliveryGate(db,D)).code,'held_day');assert.equal((await E.readDailyDeliveryGate(db,N)).open,true);
});

test('S2-02 failed decision has no refusal, marker or permanent exclusion',async()=>{
 const db=await held(),ref=db.ref;db.ref=(p,q)=>p===HOLD_PATH?{...ref(p,q),transaction:async()=>{throw Error('down');}}:ref(p,q);
 const g=await E.makeDailyDeliveryGate(db,D)('g1');assert.deepEqual([g.open,g.code,g.heldDate],[false,'delivery_hold_unavailable','not_recorded']);
 db.ref=ref;assert.equal(db.read(HOLD_PATH).refusedDates,undefined);assert.equal(db.read(E.heldDatePath(D)),null);
 assert.equal((await confirm(db)).ok,true);assert.equal((await release(db)).ok,true);
 assert.equal((await E.readDailyDeliveryGate(db,D)).open,true);
});

test('S2-03 committed refusal with lost acknowledgement survives restart',async()=>{
 const db=await held(),ref=db.ref;db.ref=(p,q)=>p===HOLD_PATH?{...ref(p,q),transaction:async(fn)=>{await ref(p,q).transaction(fn);throw Error('ack lost');}}:ref(p,q);
 assert.equal((await E.makeDailyDeliveryGate(db,D)('g1')).open,false);db.ref=ref;
 const saved=structuredClone(db.read(HOLD_PATH));assert.equal(saved.refusedDates[D].decision,'committed_hold_refusal');
 const restarted=fresh();restarted.seed(HOLD_PATH,saved);assert.equal((await confirm(restarted)).ok,true);
 assert.equal((await release(restarted)).ok,true);assert.equal((await E.readDailyDeliveryGate(restarted,D)).code,'held_day');
});

test('S2-04 error marker is not refusal; failed marker read closes only the current invocation',async()=>{
 const db=fresh();for(const marker of [{businessDate:D,uncertain:true,code:'delivery_hold_unavailable'},
   {businessDate:D,code:'held_day_unverifiable'}]){
   db.seed(E.heldDatePath(D),marker);assert.equal((await E.makeDailyDeliveryGate(db,D)('g1')).open,true);
   assert.equal(db.read(HOLD_PATH).refusedDates,undefined);
 }
 const ref=db.ref;db.ref=(p,q)=>p===E.heldDatePath(D)?{...ref(p,q),once:async()=>{throw Error('down');}}:ref(p,q);
 assert.equal((await E.makeDailyDeliveryGate(db,D)('g1')).code,'held_day_unverifiable');db.ref=ref;
 assert.equal((await E.makeDailyDeliveryGate(db,D)('g1')).open,true);
});

test('S2-05 absent and malformed hold close without a marker or refusal',async()=>{
 for(const raw of [null,{schema:1,state:'released'}]){const db=fresh();db.seed(HOLD_PATH,raw);
   const g=await E.makeDailyDeliveryGate(db,D)('g1');assert.deepEqual([g.open,g.code],[false,'delivery_hold_unreadable']);
   assert.equal(db.read(E.heldDatePath(D)),null);assert.equal(db.read(HOLD_PATH)?.refusedDates,undefined);}
});

test('S2-06 stale, missing and conflicting confirmation refuse release',async()=>{
 const db=await held();assert.equal((await release(db)).code,'inventory_confirmation_required');
 assert.equal((await confirm(db,{digest:'0'.repeat(64)})).code,'inventory_confirmation_mismatch');
 assert.equal((await confirm(db)).ok,true);await E.makeDailyDeliveryGate(db,D)('g1');
 assert.equal((await release(db)).code,'inventory_confirmation_required');assert.equal((await confirm(db)).ok,true);
 const raw=structuredClone(db.read(HOLD_PATH));raw.inventory.confirmation.digest='f'.repeat(64);db.seed(HOLD_PATH,raw);
 assert.equal((await release(db)).code,'inventory_confirmation_mismatch');
 raw.inventory.entries[raw.refusedDates[D].intent].state='allowed';db.seed(HOLD_PATH,raw);
 assert.equal((await release(db)).code,'unreadable_record');
});

test('S2-07 unresolved S1 pending and legacy range retain audit and block release',async()=>{
 const db=await held(),raw=structuredClone(db.read(HOLD_PATH)),id='00000000-0000-4000-8000-000000000099';
 raw.inventory.entries[id]={businessDate:D,observedVersion:3,generation:raw.inventory.generation,stage:'g1',state:'pending'};
 db.seed(HOLD_PATH,raw);assert.deepEqual(view(db).pending,[id]);assert.equal((await confirm(db)).code,'inventory_incomplete');
 assert.equal((await release(db)).code,'inventory_incomplete');assert.deepEqual(db.read(HOLD_PATH).inventory.entries[id],raw.inventory.entries[id]);
 delete raw.inventory.entries[id];raw.excludedThrough=D;db.seed(HOLD_PATH,raw);
 assert.equal((await confirm(db)).code,'inventory_incomplete');assert.equal((await release(db)).code,'inventory_incomplete');
 const old=releasedHoldRecord();old.excludedThrough=D;db.seed(HOLD_PATH,old);
 assert.equal((await E.readDailyDeliveryGate(db,D)).code,'legacy_evidence_unresolved');
 assert.equal((await E.readDailyDeliveryGate(db,N)).open,true);
});

test('S2-08 released decisions add nothing; concurrent releases serialize',async()=>{
 const db=await held();assert.equal((await confirm(db)).ok,true);
 const [a,b]=await Promise.all([release(db,{expectVersion:3}),release(db,{expectVersion:3})]);
 assert.deepEqual([a.code,b.code].sort(),['applied','version_conflict'].sort());
 const before=structuredClone(db.read(HOLD_PATH));for(let i=0;i<3;i++)assert.equal((await E.makeDailyDeliveryGate(db,N)('g1')).open,true);
 assert.deepEqual(db.read(HOLD_PATH),before);
});

test('S2-09 origin alone, lazy inventory, orphan refusals and repaired predecessor evidence cannot establish completeness',async()=>{
 const db=await held(),saved=structuredClone(db.read(HOLD_PATH));
 for(const change of [(r)=>{delete r.inventory.openedBy;},(r)=>{delete r.inventory.decisionProtocol;},
   (r)=>{r.inventory.holdVersion=1;},(r)=>{r.inventory.openedBy.version=1;}]){
   const r=structuredClone(saved);change(r);db.seed(HOLD_PATH,r);
   assert.equal((await confirm(db)).code,'inventory_coverage_unverified');assert.equal((await release(db)).code,'inventory_coverage_unverified');
 }
 const orphan=structuredClone(saved);orphan.inventory.entries['00000000-0000-4000-8000-000000000098']={
   businessDate:D,observedVersion:3,generation:orphan.inventory.generation,state:'refused',code:'delivery_held'};
 db.seed(HOLD_PATH,orphan);assert.equal((await confirm(db)).code,'inventory_incomplete');
 const broken={schema:1,state:'released',refusedDates:{evidence:'must survive repair'}};db.seed(HOLD_PATH,broken);
 assert.equal((await E.changeDeliveryHold(db,{...op,action:'init'})).ok,true);
 assert.deepEqual(db.read(HOLD_PATH).log.v000000001.replaced.value,broken);
 assert.equal((await confirm(db)).code,'inventory_incomplete');assert.equal((await release(db)).code,'inventory_incomplete');
});

test('S2-10 release timeout is an unknown persistence outcome; late commit is visible only by re-read',async()=>{
 const db=await held();assert.equal((await confirm(db)).ok,true);const ref=db.ref;let finish;
 db.ref=(p,q)=>p===HOLD_PATH?{...ref(p,q),transaction:async(fn)=>{await new Promise(r=>{finish=r;});return ref(p,q).transaction(fn);}}:ref(p,q);
 const r=await release(db,{timeoutMs:20});assert.equal(r.code,'transaction_failed');assert.equal(db.read(HOLD_PATH).state,'held');
 finish();await new Promise(r=>setImmediate(r));db.ref=ref;
 assert.equal(db.read(HOLD_PATH).state,'released');assert.ok(db.read(HOLD_PATH).log.v000000004.seal);
});

test('S2-11 committed marker is a second proof copy and preserves an earlier error marker',async()=>{
 const db=await held(),error={businessDate:D,uncertain:true,code:'delivery_hold_unavailable'};db.seed(E.heldDatePath(D),error);
 await E.makeDailyDeliveryGate(db,D)('g1');const marker=structuredClone(db.read(E.heldDatePath(D)));
 assert.equal(marker.code,error.code);assert.equal(marker.committedRefusal.decision,'committed_hold_refusal');
 assert.equal(marker.committedRefusal.holdVersion,3);
 db.seed(HOLD_PATH,releasedHoldRecord());
 assert.equal((await E.readDailyDeliveryGate(db,D)).code,'held_day','second copy survives main-record destruction');
});

test('S2-12 a gate calculated before release retries on the released server value',async()=>{
 const db=await held();assert.equal((await confirm(db)).ok,true);const ref=db.ref;let raced=false;
 db.ref=(p,q)=>p===HOLD_PATH?{...ref(p,q),transaction:async(fn)=>{
   if(!raced){raced=true;fn(structuredClone(db.read(p)));const saved=db.ref;db.ref=ref;
     try{assert.equal((await release(db)).ok,true);}finally{db.ref=saved;}}
   return ref(p,q).transaction(fn);}}:ref(p,q);
 const g=await E.makeDailyDeliveryGate(db,D)('g1');assert.equal(g.open,true);
 assert.equal(db.read(HOLD_PATH).refusedDates,undefined);assert.deepEqual(db.read(HOLD_PATH).log.v000000004.seal.refusedDates,[]);
});

test('S2-13 release retries after a concurrent refusal and refuses the now-stale confirmation',async()=>{
 const db=await held();assert.equal((await confirm(db)).ok,true);const ref=db.ref;let raced=false;
 db.ref=(p,q)=>p===HOLD_PATH?{...ref(p,q),transaction:async(fn)=>{
   if(!raced){raced=true;fn(structuredClone(db.read(p)));const saved=db.ref;db.ref=ref;
     try{assert.equal((await E.makeDailyDeliveryGate(db,D)('g1')).code,'delivery_held');}finally{db.ref=saved;}}
   return ref(p,q).transaction(fn);}}:ref(p,q);
 assert.equal((await release(db)).code,'inventory_confirmation_required');assert.equal(db.read(HOLD_PATH).state,'held');
});

test('S2-14 an actual S1 late finalizer cannot erase pending evidence carried by a new hold generation',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'hr3-s1-late-'));
 try{
   cpSync(join(REPO,'lib'),join(dir,'lib'),{recursive:true});
   writeFileSync(join(dir,'lib/emailDelivery.js'),execFileSync('git',['cat-file','blob','83893b5fc04dc7eae85b2aa279fcfbe925f08906:lib/emailDelivery.js'],{cwd:REPO}));
   symlinkSync(realpathSync(join(REPO,'node_modules')),join(dir,'node_modules'),'dir');
   const old=await import(pathToFileURL(join(dir,'lib/emailDelivery.js')).href),db=fresh(),ref=db.ref;let calls=0,finish,ready;
   const paused=new Promise(r=>{ready=r;});
   db.ref=(p,q)=>p===HOLD_PATH?{...ref(p,q),transaction:async(fn)=>{if(++calls===2){ready();await new Promise(r=>{finish=r;});}return ref(p,q).transaction(fn);}}:ref(p,q);
   const pending=old.makeDailyDeliveryGate(db,D)('g1');await paused;db.ref=ref;
   assert.equal((await E.changeDeliveryHold(db,{...op,action:'hold',expectVersion:2})).ok,true);
   const evidence=structuredClone(db.read(HOLD_PATH).inventory.entries);
   assert.equal((await confirm(db)).code,'inventory_incomplete');assert.equal((await release(db)).code,'inventory_incomplete');
   finish();assert.equal((await pending).open,false);assert.deepEqual(db.read(HOLD_PATH).inventory.entries,evidence);
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('S2-15 uncommitted release callbacks are never reported as an authoritative change or refusal',async()=>{
 for(const db of [await held(),fresh()]){
   if(db.read(HOLD_PATH).state==='held')assert.equal((await confirm(db)).ok,true);
   const before=structuredClone(db.read(HOLD_PATH)),ref=db.ref;
   db.ref=(p,q)=>p===HOLD_PATH?{...ref(p,q),transaction:async(fn)=>{fn(structuredClone(db.read(p)));
     return {committed:false,snapshot:{val:()=>db.read(p)}};}}:ref(p,q);
   assert.equal((await release(db)).code,'transaction_failed');assert.deepEqual(db.read(HOLD_PATH),before);
 }
});
