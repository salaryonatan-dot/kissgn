// M1-A3-T1 guard. PROPOSED test-only successor of accepted A3 2dae86d4 (Claude, author, 2026-10-18; pending independent
// Codex review). Not integration, release or real-store acceptance; A3's scoped acceptance does not extend to this commit.
//   A3T1G-01  identity: sole parent exact A3; exact closed test-only scope; fixed record entry; A3 itself unchanged
//   A3T1G-02  test only: no file outside test/ moves; runtime, Rules, package and lockfile are A3 bytes; the 28 A3 policy pins
//             are A3's and still reach the effective M1 table
//   A3T1G-03  provenance: the four edited files re-derive from A3 by the recorded edits; the DE1 wrappers change only their
//             return shape (reads forwarded, `transaction` still the faulted member); exactly two new files
//   A3T1G-04  independent literal pin of the successor holder module
//   A3T1G-05  the DP4E gate is a real-store gate: safety preamble, the actual routes, a cold reader, no in-memory store
//   A3T1G-06  tamper controls in disposable shared clones
import { historicalTest } from "../support/m1-a1-inspection.mjs";
const test = historicalTest(new URL("../../", import.meta.url), "0c70b41209ed2388e1cd2dea911657ab7e620b2a", "test/finance/m1-a3t1-test-successor-guard.test.mjs");
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync, appendFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { REPO } from '../support/fincore-load.mjs';
import { verifyA1Head, isA3Tree, isA3T1Tree, a3PolicyPins, a1Blob, A3_POLICY_PIN_FILES, A3T1_PARENT, A3T1_SCOPE, A3T1_EDITED } from '../support/m1-a1-inspection.mjs';
import { m1EffectivePins } from '../support/m1-r1-remediation.mjs';

const A3 = '2dae86d4c8362212cd7633f05156a257adca7419', A3_TREE = '162bbdf208a53fe2710c2d91b815e6c0329dede7';
const HOLDER = 'test/support/m1-a1-inspection.mjs', HOLDER_PIN = '77a920c0db4fddb371e4789be08eb3a26cec2a76';
const NEW_FILES = ['test/emulator/dp4-legacy-date-emulator.mjs', 'test/finance/m1-a3t1-test-successor-guard.test.mjs'];
const DE1 = ['test/emulator/de1-r1-receipt-emulator.mjs', 'test/emulator/de1-r2-receipt-emulator.mjs'];
const r = JSON.parse(readFileSync(join(REPO, 'test/support/m1-a1-inspection.json'), 'utf8'));
const git = (...args) => { const p = spawnSync('git', ['-C', REPO, ...args], { encoding: 'utf8', timeout: 30000, maxBuffer: 64 * 1024 * 1024 }); assert.equal(p.status, 0, p.stderr); return p.stdout.trim(); };
const lines = (s) => s.split('\n').filter(Boolean).sort();

test('A3T1G-01 identity: sole parent exact A3, closed test-only scope, fixed record entry, A3 unchanged', () => {
  assert.equal(A3T1_PARENT, A3); assert.equal(git('rev-parse', A3 + '^{tree}'), A3_TREE, 'A3 is the accepted object');
  assert.ok(isA3Tree(REPO) && isA3T1Tree(REPO)); assert.equal(verifyA1Head(REPO).ok, true);
  assert.deepEqual(git('rev-list', '--parents', '-n1', 'HEAD').split(' ').slice(1), [A3], 'exact sole parent');
  assert.deepEqual(lines(git('diff', '--name-only', A3, 'HEAD', '--')), [...A3T1_SCOPE], 'exact A3-T1 delta');
  assert.equal(A3T1_SCOPE.length, 7); assert.ok(A3T1_SCOPE.every((f) => f.startsWith('test/')));
  const { edits, ...identity } = r.testSuccessor;
  assert.deepEqual(identity, { parent: A3, kind: 'test_only', scope: [...A3T1_SCOPE], status: 'PROPOSED_FOR_INDEPENDENT_REVIEW' });
});

test('A3T1G-02 test only: nothing outside test/ moves; runtime, Rules, package and lockfile are A3 bytes; A3 policy pins hold', () => {
  assert.equal(git('diff', '--name-only', A3, 'HEAD', '--', '.', ':!test'), '');
  for (const f of ['api/daily-snapshot/run.ts', 'lib/emailDelivery.js', 'lib/emailDelivery.d.ts', 'tools/daily-delivery/hold.mjs', 'lib/repositories/bizDataRepo.js',
    'scripts/backfill-biz-access.mjs', 'src/analytics/dailyBuilder.ts', 'src/utils/dates.ts', 'database.rules.json', 'test/emulator/database.rules.json', 'package.json', 'package-lock.json'])
    assert.equal(git('rev-parse', 'HEAD:' + f), git('rev-parse', A3 + ':' + f), f + ' is the A3 blob');
  const a3Record = JSON.parse(git('show', A3 + ':test/support/m1-a1-inspection.json'));
  const pins = a3PolicyPins(REPO), eff = m1EffectivePins(REPO);
  assert.deepEqual(Object.keys(pins).sort(), [...A3_POLICY_PIN_FILES]);
  for (const f of A3_POLICY_PIN_FILES) { assert.equal(pins[f], a3Record.treePins[f], f + ' A3 pin'); assert.equal(eff[f], pins[f], f + ' effective'); }
  for (const [f, pin] of Object.entries(a3Record.treePins)) if (!A3T1_SCOPE.includes(f)) assert.equal(r.treePins[f], pin, f + ' outside the scope keeps its A3 pin');
});

test('A3T1G-03 provenance: recorded edits from A3, DE1 wrappers fault only `transaction`, exactly two new files', () => {
  assert.deepEqual(Object.keys(r.testSuccessor.edits).sort(), [...A3T1_EDITED]);
  assert.deepEqual(lines(git('diff', '--name-only', '--diff-filter=A', A3, 'HEAD', '--')), [...NEW_FILES]);
  for (const f of DE1) {
    const before = git('show', A3 + ':' + f), now = readFileSync(join(REPO, f), 'utf8');
    for (const marker of ['throw_before', 'throw_after', 'refuse && before && before.state === "claimed"', 'r.transaction(fn)'])
      assert.equal(now.split(marker).length, before.split(marker).length, f + ' fault logic unchanged: ' + marker);
    assert.match(now, /return Object\.assign\(Object\.create\(r\), \{ transaction: async \(fn\) => \{/, f + ' forwards every other member to the real reference');
    assert.doesNotMatch(now, /return \{ transaction: async \(fn\) => \{/, f + ' no transaction-only stub remains');
    const removed = spawnSync('git', ['-C', REPO, 'diff', '-U0', A3, 'HEAD', '--', f], { encoding: 'utf8' }).stdout.split('\n').filter((l) => /^-[^-]/.test(l));
    assert.ok(removed.length === 2 && removed.every((l) => /transaction: async \(fn\) => \{|\} \}; \} \};/.test(l)), f + ' only the wrapper shape lines are replaced');
  }
});

test('A3T1G-04 independent literal pin of the successor holder module', () => {
  assert.equal(a1Blob(readFileSync(join(REPO, HOLDER))), HOLDER_PIN); assert.equal(git('rev-parse', 'HEAD:' + HOLDER), HOLDER_PIN); assert.equal(git('rev-parse', ':' + HOLDER), HOLDER_PIN);
  assert.equal(r.treePins[HOLDER], HOLDER_PIN);
});

test('A3T1G-05 the DP4E gate is a real-store gate on the actual routes', () => {
  const s = readFileSync(join(REPO, 'test/emulator/dp4-legacy-date-emulator.mjs'), 'utf8');
  for (const needle of ['FIREBASE_DATABASE_EMULATOR_HOST !== "127.0.0.1:9000"', 'GOOGLE_APPLICATION_CREDENTIALS', 'import * as E from "../../lib/emailDelivery.js"',
    'import admin from "firebase-admin"', '"dp4e-cold"', 'E.deliverManualDaily(', 'E.deliverWithReceipt(', 'E.makeDailyDeliveryGate(', 'DP4E_EMULATOR total='])
    assert.ok(s.includes(needle), 'DP4E carries ' + needle);
  assert.doesNotMatch(s, /makeDb|reader-sandbox|daily-email-harness|fakeDb|new Map\(/, 'no in-memory store');
  for (const id of ['DP4E-01', 'DP4E-02', 'DP4E-03', 'DP4E-04', 'DP4E-05', 'DP4E-06', 'DP4E-07']) assert.ok(s.includes('"' + id), id);
});

test('A3T1G-06 tamper controls in disposable shared clones', () => {
  const tamper = (label, mutate) => {
    const p = mkdtempSync(join(tmpdir(), 'a3t1-tamper-'));
    try {
      const c = spawnSync('git', ['clone', '--shared', '--quiet', REPO, p], { encoding: 'utf8', timeout: 60000 }); assert.equal(c.status, 0, c.stderr);
      mutate(p); assert.throws(() => verifyA1Head(p), undefined, label + ' must be refused');
    } finally { rmSync(p, { recursive: true, force: true }); }
  };
  tamper('DE1 wrapper reverted to the A3 transaction-only stub', (p) => { const r2 = spawnSync('git', ['-C', p, 'checkout', A3, '--', DE1[0]]); assert.equal(r2.status, 0); });
  tamper('DP4E gate dirt', (p) => appendFileSync(join(p, NEW_FILES[0]), '\n// A3-T1 negative control\n'));
  tamper('runtime dirt', (p) => appendFileSync(join(p, 'lib/emailDelivery.js'), '\n// A3-T1 negative control\n'));
  tamper('test-only successor entry removed', (p) => { const f = join(p, 'test/support/m1-a1-inspection.json'); const j = JSON.parse(readFileSync(f, 'utf8')); delete j.testSuccessor; writeFileSync(f, JSON.stringify(j)); });
  assert.equal(verifyA1Head(REPO).ok, true);
});
