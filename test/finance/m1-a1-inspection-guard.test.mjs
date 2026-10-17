import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { REPO } from '../support/fincore-load.mjs';
import { verifyA1Head, A1_PARENT, A1_SOURCES, a1Blob } from '../support/m1-a1-inspection.mjs';
const r=JSON.parse(readFileSync(join(REPO,'test/support/m1-a1-inspection.json'),'utf8'));
const git=(...args)=>{const p=spawnSync('git',['-C',REPO,...args],{encoding:'utf8',timeout:30000});assert.equal(p.status,0,p.stderr);return p.stdout.trim();};
test('A1G-01 exact sole parent, complete HEAD/index/worktree scope and source objects',()=>{assert.equal(r.parent,A1_PARENT);assert.deepEqual(r.sources,A1_SOURCES);assert.deepEqual(verifyA1Head(REPO).ok,true);});
test('A1G-02 independent current-holder pins and fixed source payloads',()=>{
 for(const f of ['test/support/m1-a1-inspection.mjs','test/finance/m1-a1-inspection-guard.test.mjs','test/finance/m1-a1-carriage-regressions.test.mjs']) {
  assert.ok(r.treePins[f]);assert.equal(a1Blob(readFileSync(join(REPO,f))),r.treePins[f]);assert.equal(git('rev-parse',':'+f),r.treePins[f]);
 }
 for(const [f,sha] of Object.entries(r.verbatim))assert.equal(git('rev-parse','HEAD:'+f),git('rev-parse',sha+':'+f),f);
});
test('A1G-03 unchanged approved pins, excluded runtime and complete parent-derived content',()=>{
 const fixed=['database.rules.json','test/emulator/database.rules.json','index.html','package.json','package-lock.json','api/admin.js','lib/emailDelivery.js','lib/emailDelivery.d.ts','api/daily-snapshot/run.ts','tools/daily-delivery/hold.mjs'];
 for(const f of fixed)assert.equal(git('rev-parse','HEAD:'+f),git('rev-parse',A1_PARENT+':'+f),f);
 const dt=JSON.parse(readFileSync(join(REPO,'test/support/dt-o1-runtime.json'),'utf8'));assert.equal(dt.parent,A1_PARENT);
 for(const [f,pin] of Object.entries(dt.pins)){
  let s=spawnSync('git',['-C',REPO,'show',A1_PARENT+':'+f],{encoding:'utf8',timeout:30000}).stdout;
  assert.equal(a1Blob(Buffer.from(s)),dt.previousPins[f]);for(const e of dt.edits[f]){assert.equal(s.split(e.from).length,2);s=s.replace(e.from,()=>e.to);}
  assert.equal(a1Blob(Buffer.from(s)),pin);assert.equal(pin,git('rev-parse',A1_SOURCES.dt+':'+f));assert.ok(!/from ["'].*finance\//.test(s));
 }
});
test('A1G-04 historical adapters retain every original assertion body without source edits',()=>{
 for(const [file,sha] of Object.entries(r.historicalGuards)) {
  const original=spawnSync('git',['-C',REPO,'show',sha+':'+file],{encoding:'utf8',timeout:30000,maxBuffer:32*1024*1024});assert.equal(original.status,0);
  const match=/import\s+\{\s*test\s*\}\s+from\s+["']node:test["'];/.exec(original.stdout);assert.ok(match);
  const current=readFileSync(join(REPO,file),'utf8');
  const normalized=current.replace(/import \{ historicalTest \} from "\.\.\/support\/m1-a1-inspection\.mjs";\nconst test = historicalTest\([^\n]+\);/,match[0]);
  assert.equal(normalized,original.stdout,file+' every original body retained verbatim');
 }
});
