// Daily e-mail subscription correction C1 guard (author evidence only; independent review pending). Sole parent: the
// subscription candidate 51f00aa9 (not accepted; preserved unchanged with its evidence).
//   DSCG-01  exact closed scope over the sole parent; complete current holder; the ONLY product change is the page; the route,
//            the preference module, Rules, deployment config, delivery / authorization libraries and the hold tool unchanged
//   DSCG-02  the page stays purely additive over the IV-T1 head (6786); every page line C1 removes is a line the candidate
//            added; the seam still names no route and no store path
//   DSCG-03  the candidate's guard runs its original assertions against literal 51f00aa; the IV-T1 guard stays at 6786
//   DSCG-04  warmed projection rejects holder / record / guard tampering, including staged-then-restored bytes
//   DSCG-05  product, preference, Rules and new-evidence tampering refuse in the full holder
//   DSCG-06  a wrong parent and a repinned page forgery refuse in the full holder and the projection
//   DSCG-07  the page layer: HEAD's page = I3 page + DS edits + C1 edits (and the effective M1 page pin); the candidate's page
//            (51f00aa) and the pre-DS page never pass as the current page
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,appendFileSync,mkdtempSync,rmSync,symlinkSync,existsSync} from 'node:fs';
import {join} from 'node:path';import {tmpdir} from 'node:os';import {spawnSync} from 'node:child_process';
import {REPO} from '../support/fincore-load.mjs';
import {verifyA1Head,a1Blob,DSC_PARENT,DSC_GUARD,DS_GUARD,DS_PARENT} from '../support/m1-a1-inspection.mjs';
import {readerBackfillProjection} from '../support/server-reader-authorized-delta.mjs';
import {BF2_FILE} from '../support/bf2-backfill-layer.mjs';
import {m1EffectivePageVerdict,m1EffectivePins,gitBlobId} from '../support/m1-r1-remediation.mjs';
const PARENT='51f00aa92355d9aee1b6dcfa27f3d74e4dd16bdd',IVT1='6786b80377252d77d6bc2b7b9defa2c7d40dc434';
const H='test/support/m1-a1-inspection.mjs',R='test/support/m1-a1-inspection.json',G='test/finance/daily-subscription-correction-guard.test.mjs',DSG='test/finance/daily-subscription-guard.test.mjs',IVT1G='test/finance/marjin-1.0-iv-t1-fixture-guard.test.mjs';
const NEW_FILES=[G,'test/delivery/daily-subscription-authority.test.mjs','test/emulator/daily-subscription-ordering-rendered.mjs'].sort();
const UNCHANGED=['api/daily-snapshot/run.ts','src/server/dailyEmailSubscription.ts','database.rules.json','test/emulator/database.rules.json','vercel.json','.vercelignore','package.json','package-lock.json',
  'lib/emailDelivery.js','lib/emailDelivery.d.ts','lib/sendEmail.js','lib/securityContext.js','lib/helpers.js','lib/bizAccess.js','lib/businessRegistry.js','lib/verifyToken.js','src/server/dailyRecipientConfig.ts',
  'src/snapshot/snapshotEmail.ts','src/snapshot/snapshotBuilder.ts','api/admin.js','api/alerts/run.ts','tools/daily-delivery/hold.mjs','test/support/daily-email-harness.mjs'];
const git=(root,...args)=>{const r=spawnSync('git',['-C',root,...args],{encoding:'utf8',timeout:60000,maxBuffer:256*1024*1024});assert.equal(r.status,0,r.stderr);return r.stdout;};
const read=(f,root=REPO)=>readFileSync(join(root,f),'utf8');
const at=(sha,f)=>git(REPO,'show',sha+':'+f);
const lines=(sha,a,b,f)=>git(REPO,'diff','--unified=0',a,b,'--',f).split('\n');
const removed=(a,b,f)=>lines(null,a,b,f).filter(l=>l.startsWith('-')&&!l.startsWith('---')).map(l=>l.slice(1));
const added=(a,b,f)=>lines(null,a,b,f).filter(l=>l.startsWith('+')&&!l.startsWith('+++')).map(l=>l.slice(1));
const P=['lib/helpers.js','api/admin.js','src/finance/labor.ts'];
const projected=p=>readerBackfillProjection(p,[BF2_FILE,'package.json','package-lock.json',...P]);
function fixture(fn){const p=mkdtempSync(join(tmpdir(),'dsc-control-'));try{git(REPO,'clone','--shared','--quiet',REPO,p);for(const d of ['node_modules','test/historical/.deps'])if(existsSync(join(REPO,d)))symlinkSync(join(REPO,d),join(p,d),'dir');fn(p);}finally{rmSync(p,{recursive:true,force:true});}}

test('DSCG-01 exact closed scope over the sole parent; complete current holder; the page is the only product change',()=>{
 assert.equal(DSC_PARENT,PARENT);assert.equal(DSC_GUARD,G);assert.equal(DS_GUARD,DSG);assert.equal(DS_PARENT,IVT1);
 assert.deepEqual(git(REPO,'rev-list','--parents','-n1','HEAD').trim().split(' ').slice(1),[PARENT]);
 const rec=JSON.parse(read(R)),r=rec.dailySubscriptionCorrection,changed=git(REPO,'diff','--name-only',PARENT,'HEAD').trim().split('\n').sort();
 assert.deepEqual(changed,r.scope);assert.deepEqual([...r.newFiles].sort(),NEW_FILES);
 assert.deepEqual(rec.dailySubscriptionSuccessor,JSON.parse(at(PARENT,R)).dailySubscriptionSuccessor,'the candidate layer is carried unchanged');
 assert.equal(verifyA1Head(REPO).ok,true);
 assert.deepEqual(changed.filter(f=>!f.startsWith('test/')),['index.html'],'the only non-test change');
 for(const f of UNCHANGED)assert.equal(read(f),at(PARENT,f),f+' unchanged');
});
test('DSCG-02 the page stays additive over 6786; C1 removes only candidate lines; no route or store named by the seam',()=>{
 assert.deepEqual(removed(IVT1,'HEAD','index.html'),[],'purely additive over the IV-T1 head');
 const candidate=new Set(added(IVT1,PARENT,'index.html'));const gone=removed(PARENT,'HEAD','index.html');
 assert.ok(gone.length>0);for(const l of gone)assert.ok(candidate.has(l),'C1 removes only a candidate line: '+l.slice(0,80));
 const html=read('index.html'),i=html.indexOf('// ── Daily e-mail subscription (owner requirement 2026-10-22)'),seam=html.slice(i,html.indexOf('</script>',i));
 assert.ok(i>0&&!seam.includes('daily-snapshot/run')&&!html.includes('email_delivery_subscriptions'));
 assert.equal((html.match(/daily-snapshot\/run/g)||[]).length,(at(IVT1,'index.html').match(/daily-snapshot\/run/g)||[]).length,'no new route mention');
});
test('DSCG-03 the candidate guard runs against literal 51f00aa; the IV-T1 guard stays at 6786',()=>{
 const adapter="\nimport {historicalTest} from \"../support/m1-a1-inspection.mjs\";const test=historicalTest(new URL(\"../../\",import.meta.url),\""+PARENT+"\",\""+DSG+"\");\n";
 assert.equal(read(DSG),at(PARENT,DSG).replace("\nimport {test} from 'node:test';\n",adapter));
 const g=JSON.parse(read(R)).historicalGuards;assert.equal(g[DSG],PARENT);assert.equal(g[IVT1G],IVT1);
});
test('DSCG-04 warmed projection rejects holder, record and guard tampering, including staged restored bytes',()=>{
 assert.equal(projected(REPO).ok,true);
 for(const f of [H,R,G,DSG])for(const staged of [false,true])fixture(p=>{assert.equal(projected(p).ok,true);const b=readFileSync(join(p,f));appendFileSync(join(p,f),'\n// tamper\n');if(staged){git(p,'add',f);writeFileSync(join(p,f),b);}assert.equal(projected(p).ok,false,f);assert.throws(()=>verifyA1Head(p));});
});
test('DSCG-05 product, preference, Rules and new-evidence tampering refuse in the full holder',()=>{
 for(const f of ['index.html','api/daily-snapshot/run.ts','src/server/dailyEmailSubscription.ts','database.rules.json','test/support/daily-subscription-layer.mjs',...NEW_FILES])
  fixture(p=>{appendFileSync(join(p,f),'\n// tamper\n');assert.throws(()=>verifyA1Head(p),f);});
});
test('DSCG-06 wrong parent and repinned page forgery refuse in full holder and projection',()=>{
 for(const forged of [false,true])fixture(p=>{if(forged){const f='index.html';appendFileSync(join(p,f),'\n<!-- forged -->\n');const r=JSON.parse(read(R,p));r.treePins[f]=a1Blob(readFileSync(join(p,f)));writeFileSync(join(p,R),JSON.stringify(r,null,2)+'\n');git(p,'add',f,R);}
 git(p,'-c','user.name=control','-c','user.email=control@invalid','commit',...(forged?['--amend']:['--allow-empty']),'-qm','negative control');assert.throws(()=>verifyA1Head(p));assert.equal(projected(p).ok,false);});
});
test('DSCG-07 page layer: I3 + DS + C1 edits; the candidate page and the pre-DS page never pass as the current page',()=>{
 const head=readFileSync(join(REPO,'index.html')),cand=Buffer.from(at(PARENT,'index.html'),'utf8'),pre=Buffer.from(at(IVT1,'index.html'),'utf8');
 assert.deepEqual(m1EffectivePageVerdict(REPO,head),{ok:true});assert.equal(m1EffectivePins(REPO)['index.html'],gitBlobId(head));
 assert.equal(m1EffectivePageVerdict(REPO,cand).ok,false,'the candidate page is not the C1 derivation');
 assert.deepEqual(m1EffectivePageVerdict(REPO,pre),{ok:true},'the pre-DS page as an earlier commit page (CC1G-01 / HR1G-01)');
 for(const bytes of [cand,pre])for(const staged of [false,true])fixture(p=>{writeFileSync(join(p,'index.html'),bytes);if(staged)git(p,'add','index.html');assert.equal(m1EffectivePageVerdict(p,bytes).ok,false,'as the current page'+(staged?' (staged)':''));});
});
