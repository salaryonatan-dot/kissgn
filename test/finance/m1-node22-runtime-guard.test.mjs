// N22: configuration-only successor of accepted T1. Author evidence; independent review required.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync, writeFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { REPO } from '../support/fincore-load.mjs';
import { verifyA1Head, a1Blob, a3PolicyPins, A3_POLICY_PIN_FILES, N22_PARENT, N22_SCOPE, N22_EDITED } from '../support/m1-a1-inspection.mjs';
import { m1EffectivePins } from '../support/m1-r1-remediation.mjs';
import { collectServerReaderScopeInputs, readerBackfillProjection } from '../support/server-reader-authorized-delta.mjs';
const T1='0c70b41209ed2388e1cd2dea911657ab7e620b2a';
const TREE='08123d907b62cfd55b76cec76caec1c68922a693';
const HOLDER='test/support/m1-a1-inspection.mjs';
const HOLDER_PIN='6b4ac21e72493002140382dbe026952dee86dbfd';
const RECORD='test/support/m1-a1-inspection.json';
const HISTORY=['test/finance/m1-a1-inspection-guard.test.mjs','test/finance/m1-a3-policy-carriage-guard.test.mjs','test/finance/m1-a3t1-test-successor-guard.test.mjs'];
const SCOPE=['package-lock.json','package.json',...HISTORY,'test/finance/m1-node22-runtime-guard.test.mjs',RECORD,HOLDER].sort();
const git=(...args)=>{const r=spawnSync('git',['-C',REPO,...args],{encoding:'utf8',timeout:30000,maxBuffer:64*1024*1024});assert.equal(r.status,0,r.stderr);return r.stdout;};
const r=JSON.parse(readFileSync(join(REPO,RECORD),'utf8'));
const prior=JSON.parse(git('show',T1+':'+RECORD));
const names=(...args)=>git(...args).trim().split('\n').filter(Boolean).sort();

test('N22G-01 exact T1 sole parent, bounded eight-file scope, complete HEAD/index/worktree protection',()=>{
 assert.equal(N22_PARENT,T1);assert.equal(git('rev-parse',T1+'^{tree}').trim(),TREE);
 assert.deepEqual(git('rev-list','--parents','-n1','HEAD').trim().split(' ').slice(1),[T1]);
 assert.deepEqual([...N22_SCOPE],SCOPE);assert.deepEqual(names('diff','--name-only',T1,'HEAD','--'),SCOPE);
 const {edits,...identity}=r.node22Successor;
 assert.deepEqual(identity,{parent:T1,kind:'node22_configuration_only',scope:SCOPE,status:'PROPOSED_FOR_INDEPENDENT_REVIEW'});
 assert.deepEqual(Object.keys(edits).sort(),[...N22_EDITED]);assert.equal(verifyA1Head(REPO).ok,true);
});

test('N22G-02 only explicit engines pinning; lock dependencies and every non-scope blob unchanged',()=>{
 const pkg=JSON.parse(git('show',T1+':package.json'));pkg.engines.node='22.x';
 assert.deepEqual(JSON.parse(readFileSync(join(REPO,'package.json'),'utf8')),pkg);
 const lock=JSON.parse(git('show',T1+':package-lock.json'));lock.packages[''].engines.node='22.x';
 assert.deepEqual(JSON.parse(readFileSync(join(REPO,'package-lock.json'),'utf8')),lock,'all dependency versions, resolved URLs, integrity hashes and other metadata unchanged');
 for(const f of ['package.json','package-lock.json']){
  const before=git('show',T1+':'+f),now=readFileSync(join(REPO,f),'utf8');
  const expected=f==='package.json'?before.replace('"node": ">=20"','"node": "22.x"'):before.replace('"typescript": "^5.4.0"\n      },\n      "engines": {\n        "node": ">=20"','"typescript": "^5.4.0"\n      },\n      "engines": {\n        "node": "22.x"');
  assert.equal(now,expected,f+' one literal engine-value replacement only');
 }
 assert.deepEqual(names('diff','--name-only',T1,'HEAD','--','.',':!test'),['package-lock.json','package.json']);
 for(const [f,pin] of Object.entries(prior.treePins))if(!SCOPE.includes(f))assert.equal(r.treePins[f],pin,f+' unchanged full-tree coverage');
 assert.equal(Object.keys(r.treePins).length,Object.keys(prior.treePins).length+1,'only new guard added');
});

test('N22G-03 preserve historical records, predicates, pins and effective policy coverage',()=>{
 assert.deepEqual(r.scope,[...new Set([...prior.scope,...SCOPE])].sort());
 assert.deepEqual(r.allowedScope,[...new Set([...prior.allowedScope,...r.scope])].sort());
 for(const key of Object.keys(prior))if(!['scope','allowedScope','treePins','historicalGuards'].includes(key))assert.deepEqual(r[key],prior[key],key+' historical record unchanged');
 assert.deepEqual(r.historicalGuards,{...prior.historicalGuards,...Object.fromEntries(HISTORY.map(f=>[f,T1]))});
 const before=git('show',T1+':'+HOLDER),now=readFileSync(join(REPO,HOLDER),'utf8');
 const body=(s,name)=>{const start=s.indexOf('export function '+name+'(');assert.ok(start>=0);return s.slice(start,s.indexOf('\n}',start)+2);};
 for(const name of ['isA1Tree','isA3Tree','isA3T1Tree'])assert.equal(body(now,name),body(before,name),name+' behavior and body unchanged');
 const pins=a3PolicyPins(REPO),effective=m1EffectivePins(REPO);
 assert.deepEqual(Object.keys(pins).sort(),[...A3_POLICY_PIN_FILES]);
 for(const [f,pin] of Object.entries(pins)){assert.equal(pin,r.treePins[f]);assert.equal(effective[f],pin);assert.equal(git('rev-parse','HEAD:'+f).trim(),pin);}
});

test('N22G-04 independent literal current-holder pin and complete recorded derivations',()=>{
 assert.match(HOLDER_PIN,/^[a-f0-9]{40}$/);
 assert.equal(a1Blob(readFileSync(join(REPO,HOLDER))),HOLDER_PIN);
 assert.equal(git('rev-parse','HEAD:'+HOLDER).trim(),HOLDER_PIN);assert.equal(git('rev-parse',':'+HOLDER).trim(),HOLDER_PIN);assert.equal(r.treePins[HOLDER],HOLDER_PIN);
 assert.equal(verifyA1Head(REPO).ok,true);
});

test('N22G-05 three literal T1 guard adapters preserve every historical assertion body',()=>{
 for(const f of HISTORY){
  const before=git('show',T1+':'+f),now=readFileSync(join(REPO,f),'utf8');
  const expected=before.replace("import { test } from 'node:test';",'import { historicalTest } from "../support/m1-a1-inspection.mjs";\nconst test = historicalTest(new URL("../../", import.meta.url), "'+T1+'", "'+f+'");');
  assert.equal(now,expected,f+' only existing historical adapter replaces node:test import');
 }
});

test('N22G-06 engine, dependency, runtime, layer and ignored nested-file tampering fail closed',()=>{
 const tamper=(label,mutate)=>{const p=mkdtempSync(join(tmpdir(),'n22-tamper-'));try{
  const c=spawnSync('git',['clone','--shared','--quiet',REPO,p],{encoding:'utf8',timeout:60000});assert.equal(c.status,0,c.stderr);
  mutate(p);assert.throws(()=>verifyA1Head(p),undefined,label);
 }finally{rmSync(p,{recursive:true,force:true});}};
 tamper('engine widened',p=>{const f=join(p,'package.json');writeFileSync(f,readFileSync(f,'utf8').replace('"node": "22.x"','"node": ">=20"'));});
 tamper('dependency churn',p=>{const f=join(p,'package-lock.json');writeFileSync(f,readFileSync(f,'utf8').replace('"firebase-admin": "^12.0.0"','"firebase-admin": "^13.0.0"'));});
 tamper('runtime dirt',p=>appendFileSync(join(p,'lib/emailDelivery.js'),'\n// tamper\n'));
 tamper('layer removed',p=>{const f=join(p,RECORD),j=JSON.parse(readFileSync(f,'utf8'));delete j.node22Successor;writeFileSync(f,JSON.stringify(j));});
 tamper('ignored nested protected file',p=>{appendFileSync(join(p,'.git/info/exclude'),'\nvendor/\n');const d=join(p,'vendor/nested');mkdirSync(join(d,'scripts'),{recursive:true});assert.equal(spawnSync('git',['init','--quiet',d]).status,0);writeFileSync(join(d,'scripts/run.mjs'),'// protected\n');});
 assert.equal(verifyA1Head(REPO).ok,true);
});

test('N22G-07 exact config projection preserves every other protected path and fails closed on engine/dependency/index tampering',()=>{
 const all=['package.json','package-lock.json','vercel.json','src/agent/extra.ts'];
 const p=readerBackfillProjection(REPO,all);assert.equal(p.ok,true);assert.equal(p.layer,'A1-exact-BF3+N22');
 assert.deepEqual(p.projected,['vercel.json','src/agent/extra.ts']);
 const c=collectServerReaderScopeInputs(REPO);
 for(const f of ['package.json','package-lock.json']){assert.ok(c.changedProtectedPathsUnprojected.includes(f));assert.ok(!c.changedProtectedPaths.includes(f));}
 const tamper=(file,from,to,staged=false)=>{const p=mkdtempSync(join(tmpdir(),'n22-projection-'));try{
  assert.equal(spawnSync('git',['clone','--shared','--quiet',REPO,p]).status,0);
  const f=join(p,file),before=readFileSync(f,'utf8');assert.ok(before.includes(from));writeFileSync(f,before.replace(from,to));
  if(staged)assert.equal(spawnSync('git',['-C',p,'add',file]).status,0);
  const v=readerBackfillProjection(p,all);assert.deepEqual([v.ok,v.reason,v.detail],[false,'node22_configuration_mismatch',file]);
 }finally{rmSync(p,{recursive:true,force:true});}};
 tamper('package.json','"node": "22.x"','"node": ">=20"');
 tamper('package-lock.json','"firebase-admin": "^12.0.0"','"firebase-admin": "^13.0.0"');
 tamper('package.json','"node": "22.x"','"node": "24.x"',true);
});
