import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO } from '../support/fincore-load.mjs';
import { gitIn } from '../support/git-context.mjs';
import { gitBlobId,m1EffectivePins } from '../support/m1-r1-remediation.mjs';
import { HR3S3_PARENT,HR3S3_SCOPE,HR3S3_PINS,isHR3S3Tree,deriveHR3S3 } from '../support/hr3-s3-daily-hold.mjs';
const SKIP=!isHR3S3Tree(REPO)&&'not an HR3 S3 successor';
// HR3 OT1 (T-OT1-LAYERING): on a successor of S3 this guard judges the literal, immutable S3 object; HEAD / index / checkout
// move to the successor's own guard (the S2-on-S3 pattern one layer up).
const S3='7fa1b6e130dd0cdd24e02657d69a073e93a3f767';
const LAYERED=gitIn(REPO,['merge-base','--is-ancestor',S3,'HEAD']).status===0 && gitIn(REPO,['rev-parse','HEAD']).stdout.trim()!==S3;
const SOURCE=LAYERED?S3:'HEAD';
const git=args=>{const r=gitIn(REPO,args);assert.equal(r.status,0,r.stderr);return r.stdout.trim();};
const names=args=>{const r=gitIn(REPO,[args[0],'-z',...args.slice(1)]);assert.equal(r.status,0,r.stderr);return r.stdout.split('\0').filter(Boolean);};
test('HR3S3G-01 exact S2 sole parent, fixed scope and HEAD/index/checkout pins',{skip:SKIP},()=>{
 assert.deepEqual(git(['rev-list','--parents','-n1',SOURCE]).split(' ').slice(1),[HR3S3_PARENT]);
 assert.deepEqual(names(['diff','--name-only',HR3S3_PARENT,SOURCE,'--']).sort(),[...HR3S3_SCOPE,'test/support/hr3-s3-daily-hold.json'].sort());
 assert.deepEqual(Object.keys(HR3S3_PINS).sort(),[...HR3S3_SCOPE].sort());
 if(!LAYERED){for(const args of [['diff','--cached','--name-only','HEAD','--'],['diff','--name-only','HEAD','--'],['ls-files','--others','--',':(exclude)node_modules',':(exclude)test/historical/.deps']])assert.deepEqual(names(args),[]);}
 for(const f of HR3S3_SCOPE){assert.equal(git(['rev-parse',`${SOURCE}:${f}`]),HR3S3_PINS[f],f+' HEAD');
  if(!LAYERED){assert.equal(git(['rev-parse',`:${f}`]),HR3S3_PINS[f],f+' index');assert.equal(gitBlobId(readFileSync(join(REPO,f))),HR3S3_PINS[f],f+' checkout');assert.equal(m1EffectivePins(REPO)[f],HR3S3_PINS[f],f+' overlay');}
  else assert.equal(m1EffectivePins(REPO,{withHR3OT1:false})[f],HR3S3_PINS[f],f+' overlay without the successor layer');}
});
test('HR3S3G-02 recorded edits derive runtime from immutable S2 and prior guard reads literal S2',{skip:SKIP},()=>{
 for(const f of ['lib/emailDelivery.js','api/daily-snapshot/run.ts']){const r=deriveHR3S3(REPO,f);assert.ok(r.ok,r.reason);assert.equal(gitBlobId(r.bytes),HR3S3_PINS[f]);assert.equal(deriveHR3S3(REPO,f,{[f]:[{from:'missing anchor',to:''}]}).reason,'edit_anchor_not_unique');}
 assert.ok(readFileSync(join(REPO,'test/finance/hr3-s2-daily-hold-guard.test.mjs'),'utf8').includes("const SOURCE=LAYERED?S2:'HEAD'"));
});
test('HR3S3G-03 hold-only runtime change and route comment-only; provider, receipt, Rules, Core and build contracts unchanged',{skip:SKIP},()=>{
 for(const f of ['lib/sendEmail.js','database.rules.json','test/emulator/database.rules.json','test/support/rules-authorized-delta.mjs','lib/emailDelivery.d.ts','tools/daily-delivery/hold.mjs','api/admin.js','vercel.json','package.json','package-lock.json','index.html'])assert.equal(git(['rev-parse',`${SOURCE}:${f}`]),git(['rev-parse',`${HR3S3_PARENT}:${f}`]),f);
 const before=f=>gitIn(REPO,['cat-file','blob',`${HR3S3_PARENT}:${f}`]).stdout;
 const strip=s=>s.split('\n').filter(l=>!l.trimStart().startsWith('//')).join('\n');
 assert.equal(strip(gitIn(REPO,['cat-file','blob',`${SOURCE}:api/daily-snapshot/run.ts`]).stdout),strip(before('api/daily-snapshot/run.ts')));
 const split=s=>[s.slice(0,s.indexOf('// ── HR1: the Daily-only delivery hold')),s.slice(s.indexOf('/** The manual-attempt record path'))];
 assert.deepEqual(split(gitIn(REPO,['cat-file','blob',`${SOURCE}:lib/emailDelivery.js`]).stdout),split(before('lib/emailDelivery.js')));
 assert.deepEqual(names(['diff','--name-only',HR3S3_PARENT,SOURCE,'--','src','fincore']),[]);
});
