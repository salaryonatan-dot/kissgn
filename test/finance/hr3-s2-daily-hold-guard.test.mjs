import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO } from '../support/fincore-load.mjs';
import { gitIn } from '../support/git-context.mjs';
import { gitBlobId } from '../support/m1-r1-remediation.mjs';
import { HR3S2_PARENT,HR3S2_SCOPE,HR3S2_PINS,isHR3S2Tree,deriveHR3S2 } from '../support/hr3-s2-daily-hold.mjs';
const SKIP=!isHR3S2Tree(REPO)&&'not an HR3 S2 successor';
const S2='f4fa07619d8389f0b45c196d2f76a5f6cbe97f6d';
const LAYERED=gitIn(REPO,['merge-base','--is-ancestor',S2,'HEAD']).status===0 && gitIn(REPO,['rev-parse','HEAD']).stdout.trim()!==S2;
const SOURCE=LAYERED?S2:'HEAD';
const git=(args)=>{const r=gitIn(REPO,args);assert.equal(r.status,0,r.stderr);return r.stdout.trim();};
const names=(args)=>{const r=gitIn(REPO,[args[0],'-z',...args.slice(1)]);assert.equal(r.status,0,r.stderr);return r.stdout.split('\0').filter(Boolean);};

test('HR3S2G-01 S1 is sole parent and every changed source byte is pinned in HEAD, index and checkout',{skip:SKIP},()=>{
 assert.deepEqual(git(['rev-list','--parents','-n1',SOURCE]).split(' ').slice(1),[HR3S2_PARENT]);
 const changed=names(['diff','--name-only',HR3S2_PARENT,SOURCE,'--']);
 assert.deepEqual(changed.sort(),[...HR3S2_SCOPE,'test/support/hr3-s2-daily-hold.json'].sort());
 assert.deepEqual(Object.keys(HR3S2_PINS).sort(),[...HR3S2_SCOPE].sort());
 if(!LAYERED){
 assert.deepEqual(names(['diff','--cached','--name-only','HEAD','--']),[]);
 assert.deepEqual(names(['diff','--name-only','HEAD','--']),[]);
 const untracked=names(['ls-files','--others','--',':(exclude)node_modules',':(exclude)test/historical/.deps']);
 assert.deepEqual(untracked,[]);
 }
 for(const f of HR3S2_SCOPE){assert.equal(git(['rev-parse',`${SOURCE}:${f}`]),HR3S2_PINS[f],f+' HEAD');
   if(!LAYERED){assert.equal(git(['rev-parse',`:${f}`]),HR3S2_PINS[f],f+' index');
   assert.equal(gitBlobId(readFileSync(join(REPO,f))),HR3S2_PINS[f],f+' checkout');}}
});

test('HR3S2G-02 S1 guard is layered on the literal unchanged S1 object',{skip:SKIP},()=>{
 assert.equal(git(['rev-parse',HR3S2_PARENT]),HR3S2_PARENT);
 const source=readFileSync(join(REPO,'test/finance/hr3-s1-daily-hold-guard.test.mjs'),'utf8');
 assert.ok(source.includes('const SOURCE=LAYERED?S1:\'HEAD\''));
 assert.equal(git(['rev-parse',`${HR3S2_PARENT}:lib/emailDelivery.js`]),'494ef58435b6a8bf36417b9e12f3f3d31b3e747c');
 for(const f of ['lib/emailDelivery.js','lib/emailDelivery.d.ts','tools/daily-delivery/hold.mjs']){
   const r=deriveHR3S2(REPO,f);assert.ok(r.ok,r.reason);assert.equal(gitBlobId(r.bytes),HR3S2_PINS[f],f+' re-derived');
   assert.equal(deriveHR3S2(REPO,f,{[f]:[{from:'not a parent anchor',to:''}]}).reason,'edit_anchor_not_unique');
 }
});

test('HR3S2G-03 route, receipt, provider and Rules bytes remain S1 bytes',{skip:SKIP},()=>{
 for(const f of ['api/daily-snapshot/run.ts','lib/sendEmail.js','database.rules.json','api/admin.js','index.html',
   'test/emulator/database.rules.json','test/support/rules-authorized-delta.mjs','test/support/m1-run-gates.sh'])
   assert.equal(git(['rev-parse',`${SOURCE}:${f}`]),git(['rev-parse',`${HR3S2_PARENT}:${f}`]),f);
 const split=(s)=>{const a=s.indexOf('// ── HR1: the Daily-only delivery hold');const b=s.indexOf('/** The manual-attempt record path');return [s.slice(0,a),s.slice(b)];};
 const before=gitIn(REPO,['cat-file','blob',`${HR3S2_PARENT}:lib/emailDelivery.js`]).stdout;
 assert.deepEqual(split(gitIn(REPO,['cat-file','blob',`${SOURCE}:lib/emailDelivery.js`]).stdout),split(before));
});
