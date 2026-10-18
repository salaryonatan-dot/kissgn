// M1-A3 policy-carriage guard. PROPOSED inspection successor of M1-A2 carrying the accepted net OT4 -> DP4 policy delta.
// Authored by Codex from Claude's approved reference (2026-10-18). Not integration, release or real-store acceptance. The assembler fills
// HOLDER_PIN with the literal blob id of the final holder module; the source-derived predicate assertion is corrected under the owner-authorized A3G-01 resolution.
//   A3G-01  identity: sole parent M1-A2, exact A3 scope, A1/A2 record still holds, no DP candidate ancestry; the broad DP1 predicate is true but its pin provider is not selected
//   A3G-02  product: exactly the four DP4 runtime files move from A2 (exact DP4 bytes); DP4 differs only by A2's carriage;
//           Rules unchanged
//   A3G-03  closed provenance partition of the A3 scope: 24 DP4-verbatim, 4 historical adapters at DP4, 4 recorded edits,
//           3 holder files
//   A3G-04  independent literal pin of the holder module
//   A3G-05  A3 policy pins replace DP1..DP4 layering for exactly the DP pin-table file set, and reach the effective tables
//   A3G-06  exclusions: PBD and UC2 are not ancestors
//   A3G-07  tamper controls in disposable shared clones
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync, appendFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { REPO } from '../support/fincore-load.mjs';
import { verifyA1Head, isA3Tree, a3PolicyPins, a1Blob, A3_PARENT, A3_SOURCE, A3_SCOPE, A3_RUNTIME, A3_EDITED, A3_POLICY_PIN_FILES, isA3T1Tree, A3T1_PARENT } from '../support/m1-a1-inspection.mjs';
import { m1EffectivePins } from '../support/m1-r1-remediation.mjs';
import { isDP1Tree, DP1_PARENT, DP1_PINS } from '../support/dp1-daily-policy.mjs';
import { isDP2Tree } from '../support/dp2-daily-policy.mjs';
import { isDP3Tree } from '../support/dp3-daily-policy.mjs';
import { isDP4Tree } from '../support/dp4-daily-policy.mjs';

const HOLDER_PIN = '6955727d99d157cf6a1ba6988bf70412d309cf52';
const A2 = '43387d824e539fe5233c3b4112e6bf47a80366bb';
const DP4 = '079fe656779eb6f922d2e3bfe3a567a6a73545ef';
const A2_RUNTIME = ['lib/repositories/bizDataRepo.js', 'scripts/backfill-biz-access.mjs', 'src/analytics/dailyBuilder.ts', 'src/utils/dates.ts'];
const HOLDER = ['test/finance/m1-a3-policy-carriage-guard.test.mjs', 'test/support/m1-a1-inspection.json', 'test/support/m1-a1-inspection.mjs'];
const r = JSON.parse(readFileSync(join(REPO, 'test/support/m1-a1-inspection.json'), 'utf8'));
const git = (...args) => { const p = spawnSync('git', ['-C', REPO, ...args], { encoding: 'utf8', timeout: 30000, maxBuffer: 64 * 1024 * 1024 }); assert.equal(p.status, 0, p.stderr); return p.stdout.trim(); };
const lines = (s) => s.split('\n').filter(Boolean).sort();

test('A3G-01 identity: sole parent M1-A2, exact A3 scope, A1/A2 record holds, no DP ancestry', () => {
  assert.equal(A3_PARENT, A2); assert.deepEqual({ ...A3_SOURCE }, { dp4: DP4 }); assert.equal(A3_SCOPE.length, 35);
  assert.ok(isA3Tree(REPO)); assert.equal(verifyA1Head(REPO).ok, true);
  // A3-T1 (T-A3T1-A3G): on the test-only successor these A3 statements are judged on the fixed A3 commit object; A3T1G-* holds HEAD.
  const A3C = isA3T1Tree(REPO) ? A3T1_PARENT : 'HEAD';
  assert.deepEqual(git('rev-list', '--parents', '-n1', A3C).split(' ').slice(1), [A2], 'exact sole parent');
  assert.deepEqual(lines(git('diff', '--name-only', A2, A3C, '--')), [...A3_SCOPE], 'exact A3 delta');
  // DP1's predicate recognizes OT4 descendants, not descendants of the DP1 candidate.
  // Preserve that legacy behavior. Pin-provider selection is tested separately below.
  assert.equal(DP1_PARENT, 'f34eec92aed4851c2da8a8dfd8f1f353b1d582d7');
  assert.deepEqual([isDP1Tree, isDP2Tree, isDP3Tree, isDP4Tree].map((p) => p(REPO)), [true, false, false, false]);
  const ancestry = new Set(lines(git('rev-list', 'HEAD')));
  for (const sha of ['b2b7dd08c2de55b7103e5e0bdbfe10446368e2a6', '78b6f05775cdbbad8de161c1377de79aafa41e96', 'a125824cdf1b824da3e60c6a85f43b73d5ee4e68', DP4])
    assert.equal(ancestry.has(sha), false, sha + ' is a content source, not an ancestor');
});

test('A3G-02 product: exactly the DP4 runtime moves from A2; DP4 differs only by the A2 carriage; Rules unchanged', () => {
  const product = (a, b) => lines(git('diff', '--name-only', a, b, '--', '.', ':!test'));
  assert.deepEqual(product(A2, 'HEAD'), [...A3_RUNTIME]);
  assert.deepEqual(product(DP4, 'HEAD'), A2_RUNTIME);
  for (const f of A3_RUNTIME) {
    const pin = git('rev-parse', DP4 + ':' + f);
    assert.equal(git('rev-parse', 'HEAD:' + f), pin, f + ' committed'); assert.equal(git('rev-parse', ':' + f), pin, f + ' index');
    assert.equal(a1Blob(readFileSync(join(REPO, f))), pin, f + ' checkout');
  }
  for (const f of ['database.rules.json', 'test/emulator/database.rules.json']) assert.equal(git('rev-parse', 'HEAD:' + f), git('rev-parse', A2 + ':' + f), f + ' unchanged');
});

test('A3G-03 closed provenance partition of the A3 scope', () => {
  const verbatim = A3_SCOPE.filter((f) => r.verbatim[f] === DP4);
  const adapters = A3_SCOPE.filter((f) => r.historicalGuards[f] === DP4);
  const edited = A3_SCOPE.filter((f) => f in r.successor.edits);
  assert.deepEqual([verbatim.length, adapters.length, edited.length], [24, 4, 4]);
  assert.deepEqual([...verbatim, ...adapters, ...edited, ...HOLDER].sort(), [...A3_SCOPE], 'every A3 file has exactly one provenance class');
  assert.deepEqual(Object.keys(r.successor.edits).sort(), [...A3_EDITED]);
  for (const [f, { base }] of Object.entries(r.successor.edits)) assert.ok(base === A2 || base === DP4, f + ' fixed base');
  for (const f of adapters) assert.ok(!(f in r.successor.edits) && r.verbatim[f] === undefined, f + ' adapter only');
});

test('A3G-04 independent literal pin of the holder module', () => {
  const f = 'test/support/m1-a1-inspection.mjs';
  assert.match(HOLDER_PIN, /^[a-f0-9]{40}$/);
  // A3-T1 (T-A3T1-A3G): the A3 holder module is judged on the fixed A3 object; the successor's holder is pinned literally by A3T1G-04.
  if (isA3T1Tree(REPO)) assert.equal(git('rev-parse', A3T1_PARENT + ':' + f), HOLDER_PIN);
  else { assert.equal(a1Blob(readFileSync(join(REPO, f))), HOLDER_PIN); assert.equal(git('rev-parse', 'HEAD:' + f), HOLDER_PIN); assert.equal(git('rev-parse', ':' + f), HOLDER_PIN); }
});

test('A3G-05 A3 policy pins replace DP layering for exactly the DP pin-table file set', () => {
  const dpFiles = new Set();
  for (const n of [1, 2, 3, 4]) for (const f of Object.keys(JSON.parse(readFileSync(join(REPO, `test/support/dp${n}-daily-policy.json`), 'utf8')).pins)) dpFiles.add(f);
  assert.deepEqual([...dpFiles].sort(), [...A3_POLICY_PIN_FILES]); assert.equal(A3_POLICY_PIN_FILES.length, 28);
  const pins = a3PolicyPins(REPO), eff = m1EffectivePins(REPO);
  assert.deepEqual(Object.keys(pins).sort(), [...A3_POLICY_PIN_FILES]);
  // A broad true legacy predicate must not select its historical table on this composition.
  const witness = 'lib/emailDelivery.js';
  assert.equal(isDP1Tree(REPO), true);
  assert.notEqual(DP1_PINS[witness], pins[witness], 'historical DP1 is a discriminating wrong-table control');
  assert.equal(eff[witness], pins[witness], 'actual M1 path selects A3 despite true DP1 predicate');
  assert.notEqual(m1EffectivePins(REPO, { withDTO1: false })[witness], pins[witness], 'A1 opt-out still disables A3');
  assert.notEqual(m1EffectivePins(REPO, { withHR3OT4: false })[witness], pins[witness], 'OT4 opt-out still disables A3');
  for (const f of ['test/support/m1-r1-remediation.mjs', 'test/finance/b2-guard-mutations.test.mjs']) {
    const source = readFileSync(join(REPO, f), 'utf8');
    assert.doesNotMatch(source, /\b(?:isDP[1-4]Tree|DP[1-4]_PINS)\b/, f + ' consumes no standalone DP selector or table');
    assert.match(source, /a3PolicyPins\((?:repo|root)\)/, f + ' explicitly consumes A3 policy pins');
  }
  for (const [f, pin] of Object.entries(pins)) { assert.equal(git('rev-parse', 'HEAD:' + f), pin, f + ' committed'); assert.equal(eff[f], pin, f + ' effective'); }
  const sameAsDP4 = A3_POLICY_PIN_FILES.filter((f) => pins[f] === git('rev-parse', DP4 + ':' + f));
  assert.equal(sameAsDP4.length, 20, 'the 8 others are the recorded edits, the adapters and the A2-kept OT4 guard adapter');
});

test('A3G-06 exclusions: PBD and UC2 are not ancestors', () => {
  // A verified complete bundle may legitimately omit excluded objects. Inspect the complete HEAD history rather than
  // mistaking a missing-object exit128 for ancestry evidence or requiring an excluded object to be imported.
  const ancestry = new Set(lines(git('rev-list', 'HEAD')));
  for (const sha of ['7ae41336b7c2f02b953b9267768b90f97e39278f', '46e17525e88af9da357b72c5624fe5bfdc0608ce'])
    assert.equal(ancestry.has(sha), false, sha + ' not carried');
});

test('A3G-07 tamper controls in disposable shared clones', () => {
  const tamper = (label, mutate) => {
    const p = mkdtempSync(join(tmpdir(), 'a3-tamper-'));
    try {
      const c = spawnSync('git', ['clone', '--shared', '--quiet', REPO, p], { encoding: 'utf8', timeout: 60000 }); assert.equal(c.status, 0, c.stderr);
      mutate(p); assert.throws(() => verifyA1Head(p), undefined, label + ' must be refused');
    } finally { rmSync(p, { recursive: true, force: true }); }
  };
  tamper('runtime dirt', (p) => appendFileSync(join(p, 'lib/emailDelivery.js'), '\n// A3 negative control\n'));
  tamper('runtime reverted to A2 bytes', (p) => { const r2 = spawnSync('git', ['-C', p, 'checkout', A2, '--', 'lib/emailDelivery.js']); assert.equal(r2.status, 0); });
  tamper('untracked extra file', (p) => writeFileSync(join(p, 'test/finance/a3-extra.test.mjs'), '// extra\n'));
  tamper('successor entry removed', (p) => { const f = join(p, 'test/support/m1-a1-inspection.json'); const j = JSON.parse(readFileSync(f, 'utf8')); delete j.successor; writeFileSync(f, JSON.stringify(j)); });
  assert.equal(verifyA1Head(REPO).ok, true);
});
