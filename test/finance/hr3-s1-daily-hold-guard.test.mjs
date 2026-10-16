// Proposed successor layer: pins local bytes while preserving immutable HR3 evidence.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO } from '../support/fincore-load.mjs';
import { gitIn } from '../support/git-context.mjs';
import { gitBlobId,m1EffectivePins } from '../support/m1-r1-remediation.mjs';
import { isProtectedPath } from '../support/server-reader-authorized-delta.mjs';
import { HR3S1_PARENT,HR3S1_SCOPE,HR3S1_PINS,HR3S1_EDITS,deriveHR3S1,isHR3S1Tree } from '../support/hr3-s1-daily-hold.mjs';
const SKIP=!isHR3S1Tree(REPO)&&'not an HR3 S1 successor';
const S1='83893b5fc04dc7eae85b2aa279fcfbe925f08906';
const LAYERED=gitIn(REPO,['merge-base','--is-ancestor',S1,'HEAD']).status===0 && gitIn(REPO,['rev-parse','HEAD']).stdout.trim()!==S1;
const SOURCE=LAYERED?S1:'HEAD';
const git=(args)=>{const r=gitIn(REPO,args);assert.equal(r.status,0,r.stderr);return r.stdout.trim();};
const names=(args)=>{const r=gitIn(REPO,[args[0],'-z',...args.slice(1)]);assert.equal(r.status,0,r.stderr);return r.stdout.split('\0').filter(Boolean);};
const protectedPath=(f)=>/^(src\/|fincore\/|api\/|lib\/|tools\/daily-delivery\/|database\.rules\.json$|test\/support\/rules-authorized-delta\.mjs$|test\/emulator\/database\.rules\.json$|index\.html$|vercel\.json$|package(-lock)?\.json$)/.test(f)||isProtectedPath(f);
test('HR3S1G-01 exact sole checkpoint parent, protected scope and HEAD/index/checkout pins', {skip:SKIP},()=>{
  assert.deepEqual(git(['rev-list','--parents','-n1',SOURCE]).split(' ').slice(1),[HR3S1_PARENT]);
  assert.deepEqual(Object.keys(HR3S1_PINS).sort(),[...HR3S1_SCOPE].sort());
  for(const args of [['diff','--name-only',HR3S1_PARENT,SOURCE,'--'],...(!LAYERED?[['diff','--cached','--name-only',HR3S1_PARENT,'--']]:[])])
    assert.deepEqual(names(args).filter(protectedPath).sort(),[...HR3S1_SCOPE].sort());
  // Include ignored application files. Installed dependency trees are not application sources;
  // their nested scripts must not become candidate protected paths after npm ci.
  if(!LAYERED){const checkout=[...new Set([...names(['diff','--name-only',HR3S1_PARENT,'--']),...names(['ls-files','--others','--',':(exclude)node_modules',':(exclude)test/historical/.deps'])])];
  assert.deepEqual(checkout.filter(protectedPath).sort(),[...HR3S1_SCOPE].sort());}
  for(const f of HR3S1_SCOPE) {
    assert.equal(git(['rev-parse',`${SOURCE}:${f}`]),HR3S1_PINS[f],f+' source');
    if(!LAYERED){assert.equal(git(['rev-parse',`:${f}`]),HR3S1_PINS[f],f+' index');
      assert.equal(gitBlobId(readFileSync(join(REPO,f))),HR3S1_PINS[f],f+' checkout');
      assert.equal(m1EffectivePins(REPO)[f],HR3S1_PINS[f],f+' effective');}
  }
});
test('HR3S1G-02 unique edits reproduce the sole changed runtime blob from immutable checkpoint', {skip:SKIP},()=>{
  for(const f of HR3S1_SCOPE) {
    const r=deriveHR3S1(REPO,f);assert.ok(r.ok,r.reason);assert.equal(gitBlobId(r.bytes),HR3S1_PINS[f]);
    const bad=structuredClone(HR3S1_EDITS);bad[f][0].from+='\u0000';
    assert.equal(deriveHR3S1(REPO,f,bad).reason,'edit_anchor_not_unique');
  }
});
test('HR3S1G-03 historical records, original assertions, Rules, route and transport remain checkpoint bytes', {skip:SKIP},()=>{
  for(const f of ['test/support/hr3-daily-hold.json','test/support/hr3-daily-hold.mjs','test/support/hr2-daily-hold.json',
    'test/delivery/hr1-daily-hold.test.mjs','test/delivery/hr1-operator-and-compat.test.mjs','test/delivery/hr2-review-findings.test.mjs',
    'test/delivery/hr3-review-findings.test.mjs','test/delivery/hr3-inventory-protocol.test.mjs',
    'test/security/cron-auth-hardening.test.mjs','test/security/scheduled-auth-matrix.test.mjs',
    'api/daily-snapshot/run.ts','tools/daily-delivery/hold.mjs','lib/emailDelivery.d.ts','lib/sendEmail.js','database.rules.json',
    'api/admin.js','index.html','src/snapshot/snapshotBuilder.ts']) {
    const pin=git(['rev-parse',`${HR3S1_PARENT}:${f}`]);
    assert.equal(git(['rev-parse',`${SOURCE}:${f}`]),pin,f+' source');
    if(!LAYERED){assert.equal(git(['rev-parse',`:${f}`]),pin,f+' index');
      assert.equal(gitBlobId(readFileSync(join(REPO,f))),pin,f+' checkout');}
  }
  const split=(s)=>{const a=s.indexOf('// ── HR1: the Daily-only delivery hold');const b=s.indexOf('/** The manual-attempt record path');return [s.slice(0,a),s.slice(b)];};
  const before=gitIn(REPO,['cat-file','blob',`${HR3S1_PARENT}:lib/emailDelivery.js`]).stdout;
  const source=gitIn(REPO,['cat-file','blob',`${SOURCE}:lib/emailDelivery.js`]).stdout;
  assert.deepEqual(split(source),split(before));
});
