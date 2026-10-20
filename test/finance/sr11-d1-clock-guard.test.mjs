// Author's test-only fixture successor. No independent acceptance or RTDB claim.
import { historicalTest } from "../support/m1-a1-inspection.mjs";
const test = historicalTest(new URL("../../", import.meta.url), "31fb9c43505c253ce2dc8a195fc7b9b16efe4dc1", "test/finance/sr11-d1-clock-guard.test.mjs");
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync, appendFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { REPO } from '../support/fincore-load.mjs';
import { verifyA1Head, a1Blob, SFD_PARENT, SFD_SCOPE, SFD_EDITED, a1BackfillProjection } from '../support/m1-a1-inspection.mjs';
import { withIsraelScenario } from '../support/israel-scenario-clock.mjs';
const BASE="e9d9566c1fb1802cef158c05991d7d47d8c9182f", HOLDER="test/support/m1-a1-inspection.mjs", HELPER="test/support/israel-scenario-clock.mjs", RECORD="test/support/m1-a1-inspection.json";
const HOLDER_PIN="beb01b5cc2ff5e970b0160be3552c038eb36f1b2", HELPER_PIN="fb7bd1071b8ff760289a27e1e0aa5594c58e5869";
const SCOPE=["test/analytics/entries-reader-d1-downstream.test.mjs", "test/emulator/server-readers-matrix.mjs", "test/finance/m1-node22-runtime-guard.test.mjs", "test/finance/sr11-d1-clock-guard.test.mjs", "test/support/israel-scenario-clock.mjs", "test/support/m1-a1-inspection.json", "test/support/m1-a1-inspection.mjs"];
const git=(...args)=>{const p=spawnSync('git',['-C',REPO,...args],{encoding:'utf8',timeout:60000,maxBuffer:64*1024*1024});assert.equal(p.status,0,p.stderr);return p.stdout;};
const r=JSON.parse(readFileSync(join(REPO,RECORD),'utf8'));
const old=JSON.parse(git('show',BASE+':'+RECORD));

test('SFDG-01 exact N22 sole parent, seven-file test scope and complete current holder',()=>{
 assert.equal(SFD_PARENT,BASE);assert.deepEqual([...SFD_SCOPE],SCOPE);
 assert.deepEqual(git('rev-list','--parents','-n1','HEAD').trim().split(' ').slice(1),[BASE]);
 assert.deepEqual(git('diff','--name-only',BASE,'HEAD').trim().split('\n').sort(),SCOPE);
 assert.equal(verifyA1Head(REPO).ok,true);
});
test('SFDG-02 no product, Rules, dependency, release-pin or PBD content changes',()=>{
 assert.equal(git('diff','--name-only',BASE,'HEAD','--','.',':!test').trim(),'');
 for(const [f,pin] of Object.entries(old.treePins))if(!SCOPE.includes(f))assert.equal(r.treePins[f],pin,f+' unchanged');
 assert.equal(Object.keys(r.treePins).length,Object.keys(old.treePins).length+2);
 assert.deepEqual(Object.keys(r.fixtureClockSuccessor.edits).sort(),[...SFD_EDITED]);
 for(const key of Object.keys(old))if(!['treePins','scope','allowedScope','historicalGuards'].includes(key))assert.deepEqual(r[key],old[key],key+' retained');
});
test('SFDG-03 literal holder/helper pins and unchanged historical predicates',()=>{
 for(const [f,pin] of [[HOLDER,HOLDER_PIN],[HELPER,HELPER_PIN]]){
  assert.equal(a1Blob(readFileSync(join(REPO,f))),pin);assert.equal(git('rev-parse','HEAD:'+f).trim(),pin);assert.equal(git('rev-parse',':'+f).trim(),pin);assert.equal(r.treePins[f],pin);
 }
 const before=git('show',BASE+':'+HOLDER),now=readFileSync(join(REPO,HOLDER),'utf8');
 for(const name of ['isA1Tree','isA3Tree','isA3T1Tree']){
  const body=s=>{const at=s.indexOf('export function '+name+'(');assert.ok(at>=0);return s.slice(at,s.indexOf('\n}',at)+2);};assert.equal(body(now),body(before));
 }
 const f='test/finance/m1-node22-runtime-guard.test.mjs';
 const prior=git('show',BASE+':'+f);
 assert.equal(readFileSync(join(REPO,f),'utf8'),prior.replace("\nimport { test } from 'node:test';\n",'\nimport { historicalTest } from "../support/m1-a1-inspection.mjs";\nconst test = historicalTest(new URL("../../", import.meta.url), "'+BASE+'", "'+f+'");\n'));
});
test('SFDG-04 fixture edits retain every original assertion and representation construction',()=>{
 for(const f of ['test/analytics/entries-reader-d1-downstream.test.mjs','test/emulator/server-readers-matrix.mjs']){
  const before=git('show',BASE+':'+f),now=readFileSync(join(REPO,f),'utf8');
  const lines=s=>s.split('\n').filter(x=>/^\s*(assert\.|expect\(|eq\(|deq\()/.test(x));
  assert.deepEqual(lines(now),lines(before),f+' original assertions verbatim');
  if(f.includes('/emulator/')){
   for(const line of before.split('\n').filter(x=>x.includes('reps.push(')||x.includes('const LO =')||x.includes('for (const [tag,')))assert.ok(now.includes(line));
  }
 }
});
test('SFDG-05 current protection and exact Node22 config projection fail closed',()=>{
 const projection=a1BackfillProjection(REPO,['package.json','package-lock.json','vercel.json','scripts/backfill-biz-access.mjs']);
 assert.equal(projection.ok,true);assert.deepEqual(projection.projected,['vercel.json']);
 const tamper=(label,fn)=>{const p=mkdtempSync(join(tmpdir(),'sfd-tamper-'));try{
  let q=spawnSync('git',['clone','--shared','--quiet',REPO,p],{encoding:'utf8',timeout:60000});assert.equal(q.status,0,q.stderr);fn(p);assert.throws(()=>verifyA1Head(p),undefined,label);
 }finally{rmSync(p,{recursive:true,force:true});}};
 tamper('runtime',p=>appendFileSync(join(p,'lib/emailDelivery.js'),'\n// tamper\n'));
 tamper('fixture',p=>appendFileSync(join(p,'test/emulator/server-readers-matrix.mjs'),'\n// tamper\n'));
 tamper('helper',p=>appendFileSync(join(p,HELPER),'\n// tamper\n'));
 tamper('staged restored checkout',p=>{const f=join(p,HELPER),b=readFileSync(f);appendFileSync(f,'\n// staged\n');assert.equal(spawnSync('git',['-C',p,'add',HELPER]).status,0);writeFileSync(f,b);});
 tamper('layer removed',p=>{const f=join(p,RECORD),j=JSON.parse(readFileSync(f));delete j.fixtureClockSuccessor;writeFileSync(f,JSON.stringify(j));});
});
test('SFDG-06 scenario calendar and frozen default Date cover Israel/UTC/year/leap boundaries',async()=>{
 const previous=Object.getOwnPropertyDescriptor(globalThis,'Date');
 const rows=[['2026-09-30T20:59:00Z','2026-09-30','2026-09-29'],['2026-09-30T21:00:00Z','2026-10-01','2026-09-30'],['2026-12-31T21:59:00Z','2026-12-31','2026-12-30'],['2026-12-31T22:00:00Z','2027-01-01','2026-12-31'],['2028-02-28T22:30:00Z','2028-02-29','2028-02-28'],['2028-02-29T22:30:00Z','2028-03-01','2028-02-29']];
 for(const [instant,today,yesterday] of rows){const ms=Date.parse(instant);await withIsraelScenario(async s=>{
  assert.equal(s.today,today);assert.equal(s.dayBefore(1),yesterday);assert.equal(s.nowMs,ms);assert.equal(Date.now(),ms);assert.equal(new Date().getTime(),ms);await Promise.resolve();assert.equal(new Date().getTime(),ms);assert.equal(new Date(0).getTime(),0);assert.equal(Date.parse(instant),ms);
 },ms);assert.deepEqual(Object.getOwnPropertyDescriptor(globalThis,'Date'),previous);}
});
test('SFDG-07 rejection and overlap restore the exact caller clock and allow the next scenario',async()=>{
 const previous=Object.getOwnPropertyDescriptor(globalThis,'Date');
 await assert.rejects(withIsraelScenario(async()=>{throw new Error('deliberate scenario failure');}),/deliberate scenario failure/);
 assert.deepEqual(Object.getOwnPropertyDescriptor(globalThis,'Date'),previous);
 let release;const wait=new Promise(r=>{release=r;});const first=withIsraelScenario(async()=>{await wait;});
 await assert.rejects(withIsraelScenario(async()=>{}),/must not overlap/);release();await first;
 assert.deepEqual(Object.getOwnPropertyDescriptor(globalThis,'Date'),previous);
 await withIsraelScenario(async()=>assert.ok(Number.isSafeInteger(Date.now())));
 assert.deepEqual(Object.getOwnPropertyDescriptor(globalThis,'Date'),previous);
});
