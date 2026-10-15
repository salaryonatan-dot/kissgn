// HR3 proposed layer: independent acceptance is pending. Historical HR2 protections remain bound to immutable HR2.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO } from '../support/fincore-load.mjs';
import { gitIn } from '../support/git-context.mjs';
import { gitBlobId, m1EffectivePins } from '../support/m1-r1-remediation.mjs';
import { isProtectedPath } from '../support/server-reader-authorized-delta.mjs';
import { HR3_PARENT, HR3_SCOPE, HR3_PINS, HR3_EDITS, deriveHR3, isHR3Tree } from '../support/hr3-daily-hold.mjs';
import { isHR3S1Tree, HR3S1_PARENT } from '../support/hr3-s1-daily-hold.mjs';
const SKIP = !isHR3Tree(REPO) && 'not an HR3 commit';
const LAYERED = isHR3S1Tree(REPO), SOURCE = LAYERED ? HR3S1_PARENT : 'HEAD';
const read = (f) => LAYERED ? gitIn(REPO,['cat-file','blob',`${SOURCE}:${f}`]).stdout : readFileSync(join(REPO,f),'utf8');
const git = (args) => { const r = gitIn(REPO, args); assert.equal(r.status, 0, r.stderr); return r.stdout.trim(); };
const names = (args) => git(args).split('\n').filter(Boolean);
const protectedPath = (f) => /^(src\/|fincore\/|api\/|lib\/|tools\/daily-delivery\/|database\.rules\.json$|test\/support\/rules-authorized-delta\.mjs$|test\/emulator\/database\.rules\.json$|index\.html$|vercel\.json$|package(-lock)?\.json$)/.test(f) || isProtectedPath(f);
test('HR3G-01 sole HR2 parent and exact committed/index/checkout protected scope, including untracked paths', { skip: SKIP }, () => {
  assert.equal(HR3_PARENT, '6aac2683b614d367b5963670d44fa79f31b709c8');
  assert.deepEqual(git(['rev-list','--parents','-n1',SOURCE]).split(' ').slice(1), [HR3_PARENT]);
  const changed = names(['diff','--name-only',HR3_PARENT,SOURCE,'--']).filter(protectedPath).sort();
  assert.deepEqual(changed, [...HR3_SCOPE].sort());
  const indexScope = names(LAYERED ? ['diff','--name-only',HR3_PARENT,SOURCE,'--'] : ['diff','--cached','--name-only',HR3_PARENT,'--']).filter(protectedPath).sort();
  assert.deepEqual(indexScope, [...HR3_SCOPE].sort());
  const checkoutScope = LAYERED ? names(['diff','--name-only',HR3_PARENT,SOURCE,'--']).filter(protectedPath).sort() : [...new Set([...names(['diff','--name-only',HR3_PARENT,'--']), ...names(['ls-files','--others','--exclude-standard'])])].filter(protectedPath).sort();
  assert.deepEqual(checkoutScope, [...HR3_SCOPE].sort());
  for (const f of HR3_SCOPE) {
    assert.equal(git(['rev-parse',`${SOURCE}:${f}`]), HR3_PINS[f], f+' committed');
    assert.equal(git(['rev-parse',LAYERED ? `${SOURCE}:${f}` : `:${f}`]), HR3_PINS[f], f+' index');
    assert.equal(gitBlobId(Buffer.from(read(f),'utf8')), HR3_PINS[f], f+' checkout');
    assert.equal(m1EffectivePins(REPO, { withHR3S1: false })[f], HR3_PINS[f], f+' effective layer');
  }
});
test('HR3G-02 unique recorded edits derive proposed pins from immutable HR2', { skip: SKIP }, () => {
  assert.deepEqual(Object.keys(HR3_PINS).sort(), [...HR3_SCOPE].sort());
  for (const f of HR3_SCOPE) {
    const r = deriveHR3(REPO,f); assert.ok(r.ok, r.reason); assert.equal(gitBlobId(r.bytes), HR3_PINS[f]);
    const bad = structuredClone(HR3_EDITS); bad[f][0].from += '\u0000';
    assert.equal(deriveHR3(REPO,f,bad).reason,'edit_anchor_not_unique');
  }
});
test('HR3G-03 receipt/provider/manual/route/Rules boundaries remain exact HR2 bytes', { skip: SKIP }, () => {
  for (const f of ['api/daily-snapshot/run.ts','lib/sendEmail.js','database.rules.json','api/admin.js','index.html','src/snapshot/snapshotBuilder.ts'])
    assert.equal(git(['rev-parse',`${SOURCE}:${f}`]),git(['rev-parse',`${HR3_PARENT}:${f}`]),f);
  const current = read('lib/emailDelivery.js');
  const parent = gitIn(REPO,['cat-file','blob',`${HR3_PARENT}:lib/emailDelivery.js`]).stdout;
  // No receipt or provider change is authorized by this layer. Compare both sides of the named Daily-hold section.
  const split = (s) => { const a=s.indexOf('// ── HR1: the Daily-only delivery hold'); const b=s.indexOf('/** The manual-attempt record path'); return [s.slice(s.indexOf("import "),a),s.slice(b)]; };
  assert.notEqual(current.indexOf('export const DELIVERY_HOLD_PATH'),-1);
  assert.notEqual(current.indexOf('export const MANUAL_ATTEMPT_ROOT'),-1);
  assert.deepEqual(split(current),split(parent));
});
