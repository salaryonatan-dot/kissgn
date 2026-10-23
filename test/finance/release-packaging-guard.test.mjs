// Marjin 1.0 release packaging successor guard (author evidence only; independent review pending). Sole parent: the
// subscription correction C1 c0433c45 (pending review). Owner decision: WhatsApp is not part of Marjin 1.0; Hobby
// deploys at most 12 functions. The only product-packaging change: `.vercelignore` stops uploading api/whatsapp.js.
//   RPG-01  exact closed scope over the sole parent; complete current holder; no runtime source, route, cron, Rules,
//           package or page byte changes — the WhatsApp stub itself stays in the source tree
//   RPG-02  `.vercelignore` = the parent bytes + exactly one appended section whose only rule is /api/whatsapp.js
//   RPG-03  the C1 guard runs its original assertions against literal c0433c45; earlier historical guards unchanged
//   RPG-04  warmed projection rejects holder / record / guard tampering, including staged-then-restored bytes
//   RPG-05  `.vercelignore`, surface-model and product tampering refuse in the full holder; the parent `.vercelignore`
//           (13 functions) refuses as the current file
//   RPG-06  a wrong parent and a repinned `.vercelignore` forgery refuse in the full holder and the projection
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,appendFileSync,mkdtempSync,rmSync,symlinkSync,existsSync} from 'node:fs';
import {join} from 'node:path';import {tmpdir} from 'node:os';import {spawnSync} from 'node:child_process';
import {REPO} from '../support/fincore-load.mjs';
import {verifyA1Head,a1Blob,RP_PARENT,RP_GUARD,DSC_GUARD} from '../support/m1-a1-inspection.mjs';
import {readerBackfillProjection} from '../support/server-reader-authorized-delta.mjs';
import {BF2_FILE} from '../support/bf2-backfill-layer.mjs';
const PARENT='c0433c456164c53503bd2b9a4553b887ec13b6f8';
const H='test/support/m1-a1-inspection.mjs',R='test/support/m1-a1-inspection.json',G='test/finance/release-packaging-guard.test.mjs',DSCG='test/finance/daily-subscription-correction-guard.test.mjs';
const VI='.vercelignore',SURF='test/security/vercel-deployment-surface.test.mjs';
const SCOPE=[VI,G,DSCG,SURF,R,H].sort();
const git=(root,...args)=>{const r=spawnSync('git',['-C',root,...args],{encoding:'utf8',timeout:60000,maxBuffer:256*1024*1024});assert.equal(r.status,0,r.stderr);return r.stdout;};
const read=(f,root=REPO)=>readFileSync(join(root,f),'utf8');
const at=(sha,f)=>git(REPO,'show',sha+':'+f);
const P=['lib/helpers.js','api/admin.js','src/finance/labor.ts'];
const projected=p=>readerBackfillProjection(p,[BF2_FILE,'package.json','package-lock.json',...P]);
function fixture(fn){const p=mkdtempSync(join(tmpdir(),'rp-control-'));try{git(REPO,'clone','--shared','--quiet',REPO,p);for(const d of ['node_modules','test/historical/.deps'])if(existsSync(join(REPO,d)))symlinkSync(join(REPO,d),join(p,d),'dir');fn(p);}finally{rmSync(p,{recursive:true,force:true});}}
const APPENDED=`
# 4. Marjin 1.0 release scope (owner decision: WhatsApp is not part of 1.0; Hobby allows at most 12
#    functions per deployment). The disabled 410 stub stays in the source tree with its PR2A test,
#    but is not uploaded, so it is neither a function nor a file of the deployment. No shared module
#    is excluded. Guarded by test/security/vercel-deployment-surface.test.mjs (tests 5, 7 and 12).
/api/whatsapp.js
`;

test('RPG-01 exact closed scope over the sole parent; complete current holder; no runtime byte changes',()=>{
 assert.equal(RP_PARENT,PARENT);assert.equal(RP_GUARD,G);assert.equal(DSC_GUARD,DSCG);
 assert.deepEqual(git(REPO,'rev-list','--parents','-n1','HEAD').trim().split(' ').slice(1),[PARENT]);
 const rec=JSON.parse(read(R)),r=rec.releasePackagingSuccessor,changed=git(REPO,'diff','--name-only',PARENT,'HEAD').trim().split('\n').sort();
 assert.deepEqual(changed,SCOPE);assert.deepEqual(r.scope,SCOPE);assert.deepEqual(r.newFiles,[G]);
 const prior=JSON.parse(at(PARENT,R));for(const k of ['dailySubscriptionSuccessor','dailySubscriptionCorrection'])assert.deepEqual(rec[k],prior[k],k+' carried unchanged');
 assert.equal(verifyA1Head(REPO).ok,true);
 assert.deepEqual(changed.filter(f=>!f.startsWith('test/')),[VI],'the only non-test change');
 for(const f of git(REPO,'ls-tree','-r','--name-only','HEAD').split('\n').filter(f=>/^(api|src|lib|fincore)\//.test(f)||['index.html','landing.html','vercel.json','package.json','package-lock.json','tsconfig.json','database.rules.json'].includes(f)))
  assert.equal(git(REPO,'rev-parse','HEAD:'+f).trim(),git(REPO,'rev-parse',PARENT+':'+f).trim(),f+' unchanged');
 assert.ok(read('api/whatsapp.js').includes('res.status(410)'),'the stub stays in source');
});
test('RPG-02 .vercelignore is the parent bytes plus exactly one appended section with one rule',()=>{
 assert.equal(read(VI),at(PARENT,VI)+APPENDED);
 const added=APPENDED.split('\n').map(l=>l.trim()).filter(l=>l&&!l.startsWith('#'));assert.deepEqual(added,['/api/whatsapp.js']);
});
test('RPG-03 the C1 guard runs against literal c0433c45; earlier historical guards unchanged',()=>{
 const adapter="\nimport {historicalTest} from \"../support/m1-a1-inspection.mjs\";const test=historicalTest(new URL(\"../../\",import.meta.url),\""+PARENT+"\",\""+DSCG+"\");\n";
 assert.equal(read(DSCG),at(PARENT,DSCG).replace("\nimport {test} from 'node:test';\n",adapter));
 const g=JSON.parse(read(R)).historicalGuards,pg=JSON.parse(at(PARENT,R)).historicalGuards;
 assert.deepEqual(g,{...pg,[DSCG]:PARENT});
});
test('RPG-04 warmed projection rejects holder, record and guard tampering, including staged restored bytes',()=>{
 assert.equal(projected(REPO).ok,true);
 for(const f of [H,R,G,DSCG])for(const staged of [false,true])fixture(p=>{assert.equal(projected(p).ok,true);const b=readFileSync(join(p,f));appendFileSync(join(p,f),'\n// tamper\n');if(staged){git(p,'add',f);writeFileSync(join(p,f),b);}assert.equal(projected(p).ok,false,f);assert.throws(()=>verifyA1Head(p));});
});
test('RPG-05 packaging, surface-model and product tampering refuse; the parent .vercelignore refuses as the current file',()=>{
 for(const f of [VI,SURF,'test/support/vercel-surface.mjs','vercel.json','api/whatsapp.js','api/cost-history.js','index.html'])fixture(p=>{appendFileSync(join(p,f),'\n# tamper\n');assert.throws(()=>verifyA1Head(p),f);});
 for(const staged of [false,true])fixture(p=>{writeFileSync(join(p,VI),at(PARENT,VI));if(staged)git(p,'add',VI);assert.throws(()=>verifyA1Head(p),'parent .vercelignore');});
});
test('RPG-06 wrong parent and repinned .vercelignore forgery refuse in full holder and projection',()=>{
 for(const forged of [false,true])fixture(p=>{if(forged){writeFileSync(join(p,VI),at(PARENT,VI));const r=JSON.parse(read(R,p));r.treePins[VI]=a1Blob(readFileSync(join(p,VI)));writeFileSync(join(p,R),JSON.stringify(r,null,2)+'\n');git(p,'add',VI,R);}
 git(p,'-c','user.name=control','-c','user.email=control@invalid','commit',...(forged?['--amend']:['--allow-empty']),'-qm','negative control');assert.throws(()=>verifyA1Head(p));assert.equal(projected(p).ok,false);});
});
