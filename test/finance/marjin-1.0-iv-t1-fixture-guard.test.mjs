// IV-T1 author evidence only; transport and independent acceptance remain separate.
import {after} from 'node:test';import {historicalTest} from "../support/m1-a1-inspection.mjs";const test=historicalTest(new URL("../../",import.meta.url),"6786b80377252d77d6bc2b7b9defa2c7d40dc434","test/finance/marjin-1.0-iv-t1-fixture-guard.test.mjs");
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,appendFileSync,mkdtempSync,rmSync,symlinkSync,existsSync} from 'node:fs';
import {join} from 'node:path';import {tmpdir} from 'node:os';import {spawnSync} from 'node:child_process';
import {REPO} from '../support/fincore-load.mjs';
import {verifyA1Head,a1Blob,IV_T1_PARENT,IV_T1_SCOPE} from '../support/m1-a1-inspection.mjs';
import {readerBackfillProjection} from '../support/server-reader-authorized-delta.mjs';
import {BF2_FILE} from '../support/bf2-backfill-layer.mjs';
import {buildSandbox,T,B,B2,T2,B3} from '../support/daily-email-harness.mjs';
const BASE='b85c8b2879e1e57a3837a364bbadea07fd205a8f',H='test/support/m1-a1-inspection.mjs',R='test/support/m1-a1-inspection.json',G='test/finance/marjin-1.0-iv-t1-fixture-guard.test.mjs',OLD='test/finance/marjin-1.0-iv-correction-guard.test.mjs';
const F=['test/emulator/owner-notice-rendered.mjs','test/emulator/i1-integration-emulator.mjs'];
const SCOPE=[...F,H,R,G,OLD].sort();
const git=(root,...args)=>{const r=spawnSync('git',['-C',root,...args],{encoding:'utf8',timeout:60000,maxBuffer:64*1024*1024});assert.equal(r.status,0,r.stderr);return r.stdout;};
const read=(f,root=REPO)=>readFileSync(join(root,f),'utf8');
const prior=f=>git(REPO,'show',BASE+':'+f);
const CONFIG='process.env.MARJIN_DAILY_RECIPIENTS_JSON = JSON.stringify([[T, B, "owner-a@example.test"], [T, B2, "owner-a@example.test"], [T2, B3, "owner-b@example.test"]]);';
const INSERT='\n  // IV-T1: explicit synthetic server recipients; keep the real resolver and every refusal/assertion.\n  '+CONFIG;
const P=['lib/helpers.js','api/admin.js','src/finance/labor.ts'];
const projected=p=>readerBackfillProjection(p,[BF2_FILE,'package.json','package-lock.json',...P]);
function fixture(fn){const p=mkdtempSync(join(tmpdir(),'iv-t1-control-'));try{git(REPO,'clone','--shared','--quiet',REPO,p);for(const d of ['node_modules','test/historical/.deps'])if(existsSync(join(REPO,d)))symlinkSync(join(REPO,d),join(p,d),'dir');fn(p);}finally{rmSync(p,{recursive:true,force:true});}}
test('IVT1G-01 exact six-file correction, sole accepted parent and complete holder',()=>{
 assert.equal(IV_T1_PARENT,BASE);assert.deepEqual([...IV_T1_SCOPE],SCOPE);
 assert.deepEqual(git(REPO,'rev-list','--parents','-n1','HEAD').trim().split(' ').slice(1),[BASE]);
 assert.deepEqual(git(REPO,'diff','--name-only',BASE,'HEAD').trim().split('\n').sort(),SCOPE);
 assert.equal(verifyA1Head(REPO).ok,true);
 assert.equal(git(REPO,'diff','--name-only',BASE,'HEAD','--','.',':!test').trim(),'');
});
test('IVT1G-02 both original emulator files and every assertion retained except explicit setup insertion',()=>{
 for(const f of F){const s=read(f);assert.equal(s.split(INSERT).length,2);assert.equal(s.replace(INSERT,''),prior(f),f);}
 const adapter='\nimport {historicalTest} from "../support/m1-a1-inspection.mjs";const test=historicalTest(new URL("../../",import.meta.url),"'+BASE+'","'+OLD+'");';
 assert.equal(read(OLD),prior(OLD).replace("\nimport {test} from 'node:test';",adapter));
 for(const f of ['test/delivery/daily-recipient-server-config.test.mjs','test/emulator/daily-recipient-server-config-emulator.mjs','test/support/daily-email-harness.mjs','api/daily-snapshot/run.ts','src/server/dailyRecipientConfig.ts','lib/emailDelivery.js','database.rules.json'])assert.equal(read(f),prior(f),f);
});
test('IVT1G-03 exact fixture tuple statements exercise the real resolver; unmapped, missing and malformed still refuse',async()=>{
 const S=await buildSandbox(),M=await S.import('src/server/dailyRecipientConfig.js'),key='MARJIN_DAILY_RECIPIENTS_JSON',saved=process.env[key];
 try{for(const f of F){const s=read(f);assert.equal(s.split(CONFIG).length,2);new Function('T','B','B2','T2','B3',CONFIG)(T,B,B2,T2,B3);
  assert.deepEqual(JSON.parse(process.env[key]),[[T,B,'owner-a@example.test'],[T,B2,'owner-a@example.test'],[T2,B3,'owner-b@example.test']]);
  for(const [t,b,email]of JSON.parse(process.env[key]))assert.deepEqual(M.resolveDailyRecipient(t,b),{ok:true,email,selection:'server_configured'});
  assert.deepEqual(M.resolveDailyRecipient(T2,B),{ok:false,code:'no_recipient'});
  delete process.env[key];assert.deepEqual(M.resolveDailyRecipient(T,B),{ok:false,code:'recipient_unavailable'});
  process.env[key]='[';assert.deepEqual(M.resolveDailyRecipient(T,B),{ok:false,code:'recipient_data_invalid'});
 }}finally{if(saved===undefined)delete process.env[key];else process.env[key]=saved;rmSync(S.dir,{recursive:true,force:true});}
});
test('IVT1G-04 warmed projection checks all current scaffold bytes including staged then restored content',()=>{
 assert.equal(projected(REPO).ok,true);
 for(const f of [H,R,G,OLD])for(const staged of [false,true])fixture(p=>{assert.equal(projected(p).ok,true);const b=readFileSync(join(p,f));appendFileSync(join(p,f),'\n// tamper\n');if(staged){git(p,'add',f);writeFileSync(join(p,f),b);}assert.equal(projected(p).ok,false,f);assert.throws(()=>verifyA1Head(p));});
});
test('IVT1G-05 semantic VAT/reader targets remain visible; altered fixture and protected product bytes refuse',()=>{
 const out=projected(REPO);assert.equal(out.ok,true);assert.deepEqual(out.projected,P);
 for(const f of [...F,'src/server/dailyRecipientConfig.ts','lib/emailDelivery.js','database.rules.json',BF2_FILE,'package.json'])fixture(p=>{appendFileSync(join(p,f),'\n// tamper\n');assert.throws(()=>verifyA1Head(p));});
 fixture(p=>{appendFileSync(join(p,P[0]),'\n// semantic edit\n');assert.deepEqual(projected(p).projected,P);assert.throws(()=>verifyA1Head(p));});
});
test('IVT1G-06 wrong parent and repinned protected-content forgery refuse in full holder and projection',()=>{
 for(const forged of [false,true])fixture(p=>{if(forged){const f='src/server/dailyRecipientConfig.ts';appendFileSync(join(p,f),'\n// forged\n');const r=JSON.parse(read(R,p));r.treePins[f]=a1Blob(readFileSync(join(p,f)));writeFileSync(join(p,R),JSON.stringify(r,null,2)+'\n');git(p,'add',f,R);}
 git(p,'-c','user.name=control','-c','user.email=control@invalid','commit',...(forged?['--amend']:['--allow-empty']),'-qm','negative control');assert.throws(()=>verifyA1Head(p));assert.equal(projected(p).ok,false);});
});
