// Author correction guard. Passing tests are evidence, not independent acceptance.
import {historicalTest} from "../support/m1-a1-inspection.mjs";const test=historicalTest(new URL("../../",import.meta.url),"b85c8b2879e1e57a3837a364bbadea07fd205a8f","test/finance/marjin-1.0-iv-correction-guard.test.mjs");
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,appendFileSync,mkdtempSync,rmSync,symlinkSync,existsSync} from 'node:fs';
import {join} from 'node:path';import {tmpdir} from 'node:os';import {spawnSync} from 'node:child_process';
import {REPO} from '../support/fincore-load.mjs';
import {verifyA1Head,a1Blob,IV_PARENT,IV_SCOPE} from '../support/m1-a1-inspection.mjs';
import {readerBackfillProjection} from '../support/server-reader-authorized-delta.mjs';
const BASE='24a8ccc4da38cdc39373742df38e4df4ff365385',H='test/support/m1-a1-inspection.mjs',R='test/support/m1-a1-inspection.json',G='test/finance/marjin-1.0-iv-correction-guard.test.mjs',OLD='test/finance/marjin-1.0-composition-guard.test.mjs',HOLDER_PIN='3b6afd75081a5eb0c91af0940a722829bddbeb56';
const SCOPE=["test/acceptance/builder-delivery-acceptance.test.mjs", "test/finance/marjin-1.0-composition-guard.test.mjs", "test/finance/marjin-1.0-iv-correction-guard.test.mjs", "test/security/cron-auth-hardening.test.mjs", "test/security/scheduled-auth-matrix.test.mjs", "test/support/m1-a1-inspection.json", "test/support/m1-a1-inspection.mjs"];
const git=(root,...args)=>{const r=spawnSync('git',['-C',root,...args],{encoding:'utf8',timeout:60000,maxBuffer:64*1024*1024});assert.equal(r.status,0,r.stderr);return r.stdout;};
const read=(f,root=REPO)=>readFileSync(join(root,f),'utf8');
const parent=f=>git(REPO,'show',BASE+':'+f);
function fixture(fn){const p=mkdtempSync(join(tmpdir(),'iv-correction-control-'));try{git(REPO,'clone','--shared','--quiet',REPO,p);for(const d of ['node_modules','test/historical/.deps'])if(existsSync(join(REPO,d)))symlinkSync(join(REPO,d),join(p,d),'dir');fn(p);}finally{rmSync(p,{recursive:true,force:true});}}
const paths=['tools/backfill-registry.mjs','package.json','package-lock.json','lib/helpers.js','api/admin.js','src/finance/labor.ts'];
// The BF path is deliberately obtained from the inherited layer instead of widening an allowlist.
import {BF2_FILE} from '../support/bf2-backfill-layer.mjs';
const projected=(p,extra=[])=>readerBackfillProjection(p,[BF2_FILE,...paths.slice(1),...extra]);
test('IVG-01 exact seven-file sole-parent correction and complete current holder',()=>{
 assert.equal(IV_PARENT,BASE);assert.deepEqual([...IV_SCOPE],SCOPE);
 assert.deepEqual(git(REPO,'rev-list','--parents','-n1','HEAD').trim().split(' ').slice(1),[BASE]);
 assert.deepEqual(git(REPO,'diff','--name-only',BASE,'HEAD').trim().split('\n').sort(),SCOPE);
 assert.equal(verifyA1Head(REPO).ok,true);assert.equal(a1Blob(readFileSync(join(REPO,H))),HOLDER_PIN);
 const r=JSON.parse(read(R)),prior=JSON.parse(parent(R));assert.equal(r.treePins[H],HOLDER_PIN);
 for(const [f,pin]of Object.entries(prior.treePins))if(!SCOPE.includes(f))assert.equal(r.treePins[f],pin,f);
 assert.equal(git(REPO,'diff','--name-only',BASE,'HEAD','--','.',':!test').trim(),'');
});
test('IVG-02 original VAT/GO probes, P0 assertion bodies and historical composition assertions retained',()=>{
 for(const f of ['test/finance/m1-r1-vat-git-output.test.mjs','test/finance/vat-invariant.test.mjs','test/delivery/daily-recipient-server-config.test.mjs','test/emulator/daily-recipient-server-config-emulator.mjs'])assert.equal(read(f),parent(f),f);
 for(const f of ['test/security/cron-auth-hardening.test.mjs','test/security/scheduled-auth-matrix.test.mjs']){
  const s=read(f),old=parent(f),i=old.indexOf('\ntest(');assert.ok(i>0);assert.equal(s.slice(s.indexOf('\ntest(')),old.slice(i),f+' every original test body');
  assert.ok(s.includes('copyFileSync(join(REPO, "src/server/dailyRecipientConfig.ts"), join(dir, "src/server/dailyRecipientConfig.ts"));'));
 }
 const adapter='\nimport {historicalTest} from "../support/m1-a1-inspection.mjs";const test=historicalTest(new URL("../../",import.meta.url),"'+BASE+'","'+OLD+'");';
 assert.equal(read(OLD),parent(OLD).replace("\nimport {test} from 'node:test';",adapter));
 const body=(s,n)=>{const i=s.indexOf('export function '+n+'(');assert.ok(i>=0);return s.slice(i,s.indexOf('\n}',i)+2);};
 for(const n of ['isA1Tree','isA3Tree','isA3T1Tree','a3PolicyPins','historicalTest','a1LocalPins'])assert.equal(body(read(H),n),body(parent(H),n),n);
});
test('IVG-03 committed projection removes only exact BF/N22 paths and leaves all semantic targets visible',()=>{
 const p=projected(REPO);assert.equal(p.ok,true);assert.deepEqual(p.projected,paths.slice(3));
 for(const f of paths.slice(3))fixture(p=>{appendFileSync(join(p,f),'\n// semantic target remains protected\n');const v=projected(p);assert.equal(v.ok,true);assert.deepEqual(v.projected,paths.slice(3));assert.throws(()=>verifyA1Head(p));});
});
test('IVG-04 warmed projection rejects holder, record and guard tampering, including staged restored bytes',()=>{
 assert.equal(projected(REPO).ok,true);
 for(const f of [H,R,G])for(const staged of [false,true])fixture(p=>{assert.equal(projected(p).ok,true);const b=readFileSync(join(p,f));appendFileSync(join(p,f),'\n// corrupt scaffold\n');if(staged){git(p,'add',f);writeFileSync(join(p,f),b);}assert.equal(projected(p).ok,false,f);assert.throws(()=>verifyA1Head(p));});
 fixture(p=>{const r=JSON.parse(read(R,p));delete r.integrationCorrection;writeFileSync(join(p,R),JSON.stringify(r));assert.equal(projected(p).ok,false);assert.throws(()=>verifyA1Head(p));});
});
test('IVG-05 BF/N22 working and staged bytes cannot use the projection as an allowlist',()=>{
 for(const f of [BF2_FILE,'package.json','package-lock.json'])for(const staged of [false,true])fixture(p=>{assert.equal(projected(p).ok,true);const b=readFileSync(join(p,f));appendFileSync(join(p,f),'\n');if(staged){git(p,'add',f);writeFileSync(join(p,f),b);}assert.equal(projected(p).ok,false,f);assert.throws(()=>verifyA1Head(p));});
});
test('IVG-06 full holder still rejects runtime, fixture, untracked and ignored changes',()=>{
 for(const f of ['api/daily-snapshot/run.ts','src/server/dailyRecipientConfig.ts','lib/emailDelivery.js','test/emulator/daily-recipient-server-config-emulator.mjs','test/acceptance/builder-delivery-acceptance.test.mjs'])fixture(p=>{appendFileSync(join(p,f),'\n// tamper\n');assert.throws(()=>verifyA1Head(p));});
 for(const f of ['stray-iv-file.txt','.env.local'])fixture(p=>{writeFileSync(join(p,f),'SYNTHETIC=1\n');assert.throws(()=>verifyA1Head(p));});
});
test('IVG-07 wrong parent and forged same-parent protected content refuse in holder and projection',()=>{
 for(const kind of ['child','forged'])fixture(p=>{
  if(kind==='forged'){const f='src/server/dailyRecipientConfig.ts';appendFileSync(join(p,f),'\n// forged\n');const r=JSON.parse(read(R,p));r.treePins[f]=a1Blob(readFileSync(join(p,f)));writeFileSync(join(p,R),JSON.stringify(r,null,2)+'\n');git(p,'add',f,R);}
  git(p,'-c','user.name=control','-c','user.email=control@invalid','commit',...(kind==='child'?['--allow-empty']:['--amend']),'-qm',kind);
  assert.throws(()=>verifyA1Head(p));assert.equal(projected(p).ok,false);
 });
});
