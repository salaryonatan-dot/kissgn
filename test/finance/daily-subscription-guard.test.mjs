// Daily e-mail subscription successor guard (owner requirement 2026-10-22). Author evidence only; independent review pending.
//   DSG-01  exact closed scope over the sole parent (accepted IV-T1 head), complete current holder; product change limited to
//           the route, the page and the new preference module; Rules, deployment config, packages and delivery libraries unchanged
//   DSG-02  the route's authorization section and every removed line are exactly the recorded ones; the page change is additive
//   DSG-03  the IV-T1 guard's original assertions are registered against its literal accepted commit
//   DSG-04  warmed projections reject holder / record / guard tampering, including staged-then-restored bytes
//   DSG-05  semantic VAT / reader targets stay visible; product, preference and Rules tampering refuse in the full holder
//   DSG-06  a wrong parent and a repinned protected-content forgery refuse in the full holder and the projection
//   DSG-07  the page layer: HEAD's page is the I3 page + exactly the recorded edits and the effective M1 page pin; the pre-DS page
//           passes only as an EARLIER commit's page, never as the current page (committed / staged / checked out)
import {historicalTest} from "../support/m1-a1-inspection.mjs";const test=historicalTest(new URL("../../",import.meta.url),"51f00aa92355d9aee1b6dcfa27f3d74e4dd16bdd","test/finance/daily-subscription-guard.test.mjs");
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,appendFileSync,mkdtempSync,rmSync,symlinkSync,existsSync} from 'node:fs';
import {join} from 'node:path';import {tmpdir} from 'node:os';import {spawnSync} from 'node:child_process';
import {REPO} from '../support/fincore-load.mjs';
import {verifyA1Head,a1Blob,DS_PARENT,DS_GUARD} from '../support/m1-a1-inspection.mjs';
import {readerBackfillProjection} from '../support/server-reader-authorized-delta.mjs';
import {BF2_FILE} from '../support/bf2-backfill-layer.mjs';
import {m1EffectivePageVerdict,m1EffectivePins,gitBlobId} from '../support/m1-r1-remediation.mjs';
const BASE='6786b80377252d77d6bc2b7b9defa2c7d40dc434',H='test/support/m1-a1-inspection.mjs',R='test/support/m1-a1-inspection.json',G='test/finance/daily-subscription-guard.test.mjs',OLD='test/finance/marjin-1.0-iv-t1-fixture-guard.test.mjs';
const PRODUCT=['api/daily-snapshot/run.ts','index.html','src/server/dailyEmailSubscription.ts'];
const NEW_FILES=['src/server/dailyEmailSubscription.ts','test/delivery/daily-email-subscription.test.mjs','test/emulator/daily-subscription-emulator.mjs','test/emulator/daily-subscription-rendered.mjs',G,'test/finance/daily-subscription-ui-seam.test.mjs','test/support/daily-subscription-layer.mjs'].sort();
const UNCHANGED=['database.rules.json','test/emulator/database.rules.json','vercel.json','.vercelignore','package.json','package-lock.json','lib/emailDelivery.js','lib/emailDelivery.d.ts','lib/sendEmail.js',
  'lib/securityContext.js','lib/bizAccess.js','lib/businessRegistry.js','src/server/dailyRecipientConfig.ts','src/snapshot/snapshotEmail.ts','src/snapshot/snapshotBuilder.ts','api/admin.js','api/alerts/run.ts','tools/daily-delivery/hold.mjs'];
const git=(root,...args)=>{const r=spawnSync('git',['-C',root,...args],{encoding:'utf8',timeout:60000,maxBuffer:256*1024*1024});assert.equal(r.status,0,r.stderr);return r.stdout;};
const read=(f,root=REPO)=>readFileSync(join(root,f),'utf8');
const prior=f=>git(REPO,'show',BASE+':'+f);
const removed=f=>git(REPO,'diff','--unified=0',BASE,'HEAD','--',f).split('\n').filter(l=>l.startsWith('-')&&!l.startsWith('---')).map(l=>l.slice(1));
const P=['lib/helpers.js','api/admin.js','src/finance/labor.ts'];
const projected=p=>readerBackfillProjection(p,[BF2_FILE,'package.json','package-lock.json',...P]);
function fixture(fn){const p=mkdtempSync(join(tmpdir(),'ds-control-'));try{git(REPO,'clone','--shared','--quiet',REPO,p);for(const d of ['node_modules','test/historical/.deps'])if(existsSync(join(REPO,d)))symlinkSync(join(REPO,d),join(p,d),'dir');fn(p);}finally{rmSync(p,{recursive:true,force:true});}}

test('DSG-01 exact closed scope over the sole parent; complete current holder; product change limited and named',()=>{
 assert.equal(DS_PARENT,BASE);assert.equal(DS_GUARD,G);
 assert.deepEqual(git(REPO,'rev-list','--parents','-n1','HEAD').trim().split(' ').slice(1),[BASE]);
 const r=JSON.parse(read(R)).dailySubscriptionSuccessor,changed=git(REPO,'diff','--name-only',BASE,'HEAD').trim().split('\n').sort();
 assert.deepEqual(changed,r.scope);assert.deepEqual([...r.newFiles].sort(),NEW_FILES);
 assert.equal(verifyA1Head(REPO).ok,true);
 assert.deepEqual(changed.filter(f=>!f.startsWith('test/')),PRODUCT,'the only non-test changes');
 for(const f of UNCHANGED)assert.equal(read(f),prior(f),f+' unchanged');
});
test('DSG-02 the route authorization section and every removed line are exactly the recorded ones; the page change is additive',()=>{
 const section=s=>s.slice(s.indexOf('export default async function handler('),s.indexOf('  try {\n    // GET = cron trigger'));
 assert.ok(section(prior('api/daily-snapshot/run.ts')).length>500);
 assert.equal(section(read('api/daily-snapshot/run.ts')),section(prior('api/daily-snapshot/run.ts')),'authorization section byte-identical');
 assert.deepEqual(removed('api/daily-snapshot/run.ts'),[
  '//   no_send     reserved: no contract no-send condition remains (owner decision G4, 2026-10-09: a business without a name is a',
  '//               FAILED row `business_name_unavailable`, never a silent no-send); the class is kept for the response shape',
  '      if (action !== undefined && action !== "notice") return res.status(400).json({ error: "invalid_action" });']);
 assert.deepEqual(removed('index.html'),[],'the page change is purely additive');
 const s=read('api/daily-snapshot/run.ts');
 for(const needle of ['if (action === undefined) {\n        const g2 = await readManualDeliveryGate(db);','const recipient = await resolveDailyRecipient(tenantId, bizId);','const r = await deliverManualDaily({'])
  assert.equal(s.split(needle).length,2,'manual path retained: '+needle.slice(0,40));
 assert.ok(s.indexOf('readDailySubscription(db, snapshot.tenantId, snapshot.bizId)')<s.indexOf('const recipient = await resolveDailyRecipient(snapshot.tenantId, snapshot.bizId);'),'the scheduled gate precedes recipient resolution');
 assert.ok(s.indexOf('readDailySubscription(db, snapshot.tenantId, snapshot.bizId)')<s.indexOf('const r = await deliverWithReceipt({'),'the scheduled gate precedes every receipt / claim / admission step');
});
test('DSG-03 the IV-T1 guard original assertions are registered against literal 6786',()=>{
 const adapter="\nimport {after} from 'node:test';import {historicalTest} from \"../support/m1-a1-inspection.mjs\";const test=historicalTest(new URL(\"../../\",import.meta.url),\""+BASE+"\",\""+OLD+"\");\n";
 assert.equal(read(OLD),prior(OLD).replace("\nimport {test,after} from 'node:test';\n",adapter));
 assert.equal(JSON.parse(read(R)).historicalGuards[OLD],BASE);
});
test('DSG-04 warmed projection rejects holder, record and guard tampering, including staged restored bytes',()=>{
 assert.equal(projected(REPO).ok,true);
 for(const f of [H,R,G,OLD])for(const staged of [false,true])fixture(p=>{assert.equal(projected(p).ok,true);const b=readFileSync(join(p,f));appendFileSync(join(p,f),'\n// tamper\n');if(staged){git(p,'add',f);writeFileSync(join(p,f),b);}assert.equal(projected(p).ok,false,f);assert.throws(()=>verifyA1Head(p));});
});
test('DSG-05 semantic targets stay visible; product, preference, Rules and fixture tampering refuse in the full holder',()=>{
 const out=projected(REPO);assert.equal(out.ok,true);assert.deepEqual(out.projected,P);
 for(const f of [...PRODUCT,'database.rules.json','test/support/daily-email-harness.mjs','test/emulator/daily-subscription-emulator.mjs',BF2_FILE,'package.json'])fixture(p=>{appendFileSync(join(p,f),'\n// tamper\n');assert.throws(()=>verifyA1Head(p),f);});
 fixture(p=>{appendFileSync(join(p,P[0]),'\n// semantic edit\n');assert.deepEqual(projected(p).projected,P);assert.throws(()=>verifyA1Head(p));});
});
test('DSG-06 wrong parent and repinned protected-content forgery refuse in full holder and projection',()=>{
 for(const forged of [false,true])fixture(p=>{if(forged){const f='src/server/dailyEmailSubscription.ts';appendFileSync(join(p,f),'\n// forged\n');const r=JSON.parse(read(R,p));r.treePins[f]=a1Blob(readFileSync(join(p,f)));writeFileSync(join(p,R),JSON.stringify(r,null,2)+'\n');git(p,'add',f,R);}
 git(p,'-c','user.name=control','-c','user.email=control@invalid','commit',...(forged?['--amend']:['--allow-empty']),'-qm','negative control');assert.throws(()=>verifyA1Head(p));assert.equal(projected(p).ok,false);});
});
test('DSG-07 page layer: recorded edits over the I3 page; the pre-DS page never passes as the current page',()=>{
 const head=readFileSync(join(REPO,'index.html')),pre=Buffer.from(prior('index.html'),'utf8');
 assert.deepEqual(m1EffectivePageVerdict(REPO,head),{ok:true});assert.equal(m1EffectivePins(REPO)['index.html'],gitBlobId(head));
 assert.deepEqual(m1EffectivePageVerdict(REPO,pre),{ok:true},'the pre-DS page as the page of an earlier commit (CC1G-01 / HR1G-01)');
 assert.equal(m1EffectivePageVerdict(REPO,Buffer.concat([head,Buffer.from('\n')])).ok,false,'one added byte');
 for(const staged of [false,true])fixture(p=>{writeFileSync(join(p,'index.html'),pre);if(staged)git(p,'add','index.html');assert.equal(m1EffectivePageVerdict(p,pre).ok,false,'pre-DS page as the current page'+(staged?' (staged)':''));});
 fixture(p=>{writeFileSync(join(p,'index.html'),pre);git(p,'add','index.html');git(p,'-c','user.name=control','-c','user.email=control@invalid','commit','--amend','-qm','negative control');assert.equal(m1EffectivePageVerdict(p,pre).ok,false,'pre-DS page committed');});
});
