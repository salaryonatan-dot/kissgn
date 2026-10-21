// Author-side current composition guard. No independent or release acceptance.
import {historicalTest} from "../support/m1-a1-inspection.mjs";const test=historicalTest(new URL("../../",import.meta.url),"dffe0d60f36ddca2b8f7370b10ac1e0c24d5f175","test/finance/pbn-sfd-composition-guard.test.mjs");
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,rmSync,writeFileSync,appendFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {REPO} from '../support/fincore-load.mjs';
import {verifyA1Head,a1Blob,COMPOSE_PARENT,COMPOSE_SOURCE,COMPOSE_SCOPE,COMPOSE_TRANSFERS,COMPOSE_EDITED} from '../support/m1-a1-inspection.mjs';
import {readerBackfillProjection} from '../support/server-reader-authorized-delta.mjs';
const PARENT="d963532287f5390df9baef5c7a18a109400233b8",SOURCE="31fb9c43505c253ce2dc8a195fc7b9b16efe4dc1",N22="e9d9566c1fb1802cef158c05991d7d47d8c9182f",HOLDER="test/support/m1-a1-inspection.mjs",RECORD="test/support/m1-a1-inspection.json",PBD="test/analytics/entries-reader-decimal-aggregation.test.mjs";
const HOLDER_PIN="cf0316550e62dab6945436bbf8db77f981e99f9b",HELPER_PIN="fb7bd1071b8ff760289a27e1e0aa5594c58e5869",PBD_PIN="b611191b31cb1293e9dbffeb25dbce6308497fbe",SCOPE=["test/analytics/entries-reader-d1-downstream.test.mjs", "test/emulator/server-readers-matrix.mjs", "test/finance/m1-pbn-fixture-carriage-guard.test.mjs", "test/finance/pbn-sfd-composition-guard.test.mjs", "test/finance/sr11-d1-clock-guard.test.mjs", "test/support/israel-scenario-clock.mjs", "test/support/m1-a1-inspection.json", "test/support/m1-a1-inspection.mjs"],TRANSFERS=["test/analytics/entries-reader-d1-downstream.test.mjs", "test/emulator/server-readers-matrix.mjs", "test/support/israel-scenario-clock.mjs"],EDITED=["test/finance/m1-pbn-fixture-carriage-guard.test.mjs", "test/finance/sr11-d1-clock-guard.test.mjs", "test/support/m1-a1-inspection.mjs"];
const git=(...args)=>{const r=spawnSync('git',['-C',REPO,...args],{encoding:'utf8',timeout:60000,maxBuffer:64*1024*1024});assert.equal(r.status,0,r.stderr);return r.stdout;};
const r=JSON.parse(readFileSync(join(REPO,RECORD))),prior=JSON.parse(git('show',PARENT+':'+RECORD));

test('CPG-01 exact sole PBN parent, closed current scope and complete HEAD/index/checkout protection',()=>{
 assert.equal(COMPOSE_PARENT,PARENT);assert.equal(COMPOSE_SOURCE,SOURCE);assert.deepEqual([...COMPOSE_SCOPE],SCOPE);assert.deepEqual([...COMPOSE_TRANSFERS],TRANSFERS);assert.deepEqual([...COMPOSE_EDITED],EDITED);
 assert.deepEqual(git('rev-list','--parents','-n1','HEAD').trim().split(' ').slice(1),[PARENT]);assert.deepEqual(git('diff','--name-only',PARENT,'HEAD').trim().split('\n').sort(),SCOPE);assert.equal(verifyA1Head(REPO).ok,true);
});
test('CPG-02 exact accepted transfers, PBD fixture and unchanged non-scope pins',()=>{
 for(const f of TRANSFERS)assert.equal(git('rev-parse','HEAD:'+f).trim(),git('rev-parse',SOURCE+':'+f).trim(),f);
 assert.equal(git('rev-parse','HEAD:'+PBD).trim(),PBD_PIN);assert.equal(a1Blob(readFileSync(join(REPO,PBD))),PBD_PIN);
 for(const [f,pin]of Object.entries(prior.treePins))if(!SCOPE.includes(f))assert.equal(r.treePins[f],pin,f);
 assert.equal(Object.keys(r.treePins).length,Object.keys(prior.treePins).length+3);
 assert.equal(git('diff','--name-only',PARENT,'HEAD','--','.',':!test').trim(),'');
});
test('CPG-03 literal holder/helper pins and preserved historical predicates/policy selectors',()=>{
 for(const [f,pin]of [[HOLDER,HOLDER_PIN],['test/support/israel-scenario-clock.mjs',HELPER_PIN]]){assert.equal(r.treePins[f],pin);assert.equal(git('rev-parse','HEAD:'+f).trim(),pin);assert.equal(git('rev-parse',':'+f).trim(),pin);assert.equal(a1Blob(readFileSync(join(REPO,f))),pin);}
 const before=git('show',PARENT+':'+HOLDER),now=readFileSync(join(REPO,HOLDER),'utf8');const body=(s,n)=>{const a=s.indexOf('export function '+n+'(');assert.ok(a>=0);return s.slice(a,s.indexOf('\n}',a)+2);};
 for(const name of ['isA1Tree','isA3Tree','isA3T1Tree','a3PolicyPins','historicalTest','a1LocalPins'])assert.equal(body(now,name),body(before,name),name);
 for(const line of git('show',SOURCE+':'+HOLDER).split('\n').filter(x=>/^export const SFD_(PARENT|SCOPE|EDITED) = /.test(x)))assert.ok(now.includes(line),'exact historical import binding');
});
test('CPG-04 both historical guards have import-only adapters; existing N22 guard stays PBN verbatim',()=>{
 for(const [f,sha]of [['test/finance/m1-pbn-fixture-carriage-guard.test.mjs',PARENT],['test/finance/sr11-d1-clock-guard.test.mjs',SOURCE]]){
  const before=git('show',sha+':'+f),old="import { test } from 'node:test';\n";assert.equal(before.split(old).length,2);
  assert.equal(readFileSync(join(REPO,f),'utf8'),before.replace(old,'import { historicalTest } from "../support/m1-a1-inspection.mjs";\nconst test = historicalTest(new URL("../../", import.meta.url), "'+sha+'", "'+f+'");\n'));
 }
 const f='test/finance/m1-node22-runtime-guard.test.mjs';assert.equal(readFileSync(join(REPO,f),'utf8'),git('show',PARENT+':'+f));
});
test('CPG-05 accepted fixture assertions/periods/values/representations retained; optional rows untouched',()=>{
 for(const f of ['test/analytics/entries-reader-d1-downstream.test.mjs','test/emulator/server-readers-matrix.mjs']){
  const accepted=git('show',SOURCE+':'+f),now=readFileSync(join(REPO,f),'utf8');assert.equal(now,accepted);
  const original=git('show',N22+':'+f);const lines=s=>s.split('\n').filter(x=>/^\s*(assert\.|expect\(|eq\(|deq\()/.test(x));assert.deepEqual(lines(now),lines(original));
 }
 assert.equal(readFileSync(join(REPO,PBD),'utf8'),git('show',PARENT+':'+PBD));
});
test('CPG-06 exact PBN and N22 record derivations retained; no historical pin removal',()=>{
 for(const key of Object.keys(prior))if(!['treePins','scope','allowedScope','historicalGuards'].includes(key))assert.deepEqual(r[key],prior[key],key);
 for(const key of Object.keys(prior.treePins))assert.ok(Object.hasOwn(r.treePins,key),key);
 assert.deepEqual(r.historicalGuards,{...prior.historicalGuards,'test/finance/m1-pbn-fixture-carriage-guard.test.mjs':PARENT,'test/finance/sr11-d1-clock-guard.test.mjs':SOURCE});
 for(const sha of [PARENT,SOURCE,N22])assert.equal(git('cat-file','-t',sha).trim(),'commit');
 assert.equal(git('rev-parse',PARENT+'^').trim(),N22);assert.equal(git('rev-parse',SOURCE+'^').trim(),N22);
});
test('CPG-07 package projection still excludes only the exact two packages and existing BF script',()=>{
 const paths=['package.json','package-lock.json','vercel.json','src/agent/stray.ts',PBD];const p=readerBackfillProjection(REPO,paths);assert.equal(p.ok,true);assert.deepEqual(p.projected,paths.slice(2));
});
test('CPG-08 current composition rejects runtime, fixture, record, staged and child tampering',()=>{
 const clone=()=>{const p=mkdtempSync(join(tmpdir(),'pbn-sfd-tamper-'));const q=spawnSync('git',['clone','--shared','--quiet',REPO,p],{encoding:'utf8',timeout:60000});assert.equal(q.status,0,q.stderr);return p;};
 const refused=(label,mutate)=>{const p=clone();try{mutate(p);assert.throws(()=>verifyA1Head(p),undefined,label);}finally{rmSync(p,{recursive:true,force:true});}};
 for(const f of ['lib/emailDelivery.js',PBD,'test/emulator/server-readers-matrix.mjs','test/support/israel-scenario-clock.mjs'])refused(f,p=>appendFileSync(join(p,f),'\n// tamper\n'));
 refused('staged helper restored in checkout',p=>{const f=join(p,'test/support/israel-scenario-clock.mjs'),b=readFileSync(f);appendFileSync(f,'\n// staged\n');assert.equal(spawnSync('git',['-C',p,'add','test/support/israel-scenario-clock.mjs']).status,0);writeFileSync(f,b);});
 refused('composition identity removed',p=>{const f=join(p,RECORD),v=JSON.parse(readFileSync(f));delete v.fixtureComposition;writeFileSync(f,JSON.stringify(v));});
 refused('ignored untracked',p=>writeFileSync(join(p,'.env.local'),'SYNTHETIC=1\n'));
 const p=clone();try{assert.equal(spawnSync('git',['-C',p,'-c','user.name=control','-c','user.email=control@invalid','commit','--allow-empty','-qm','child']).status,0);assert.throws(()=>verifyA1Head(p));assert.deepEqual([readerBackfillProjection(p,['package.json']).ok,readerBackfillProjection(p,['package.json']).reason],[false,'composition_parent']);}finally{rmSync(p,{recursive:true,force:true});}
});
