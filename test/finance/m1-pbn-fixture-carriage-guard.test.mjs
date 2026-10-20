// PBN: the accepted PBD fixture row (UC2-P-01; T-PBD-ROW / T-PBD-ASSERT, Codex fixture 9550569f, accepted by Claude 2026-10-16)
// carried onto exact N22 e9d9566c. Claude carriage author; independent Codex review required. Test-only: no UC2 ancestry,
// UC2 runtime or UC2-bound carriage (7ae41336's UC2G layering / pbd-carriage support are NOT carried).
//   PBNG-01  identity: sole parent exact N22, closed five-file scope, fixed record entry, sources are never ancestors
//   PBNG-02  test only: nothing outside test/ moves; runtime, Node22 package/lock, Rules and every non-scope pin are N22 bytes
//   PBNG-03  exact transfer: the fixture is the accepted blob; only the positive persistence row differs from N22, verbatim
//   PBNG-04  independent literal pin of the current holder module; N22 layer and predicates unchanged
//   PBNG-05  the N22 guard is adapted only by the existing literal-history import line
//   PBNG-06  N22's exact configuration projection still projects only the two package files on this child
//   PBNG-07  tamper controls in disposable shared clones
import { historicalTest } from "../support/m1-a1-inspection.mjs";
const test = historicalTest(new URL("../../", import.meta.url), "d963532287f5390df9baef5c7a18a109400233b8", "test/finance/m1-pbn-fixture-carriage-guard.test.mjs");
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync, writeFileSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { REPO } from '../support/fincore-load.mjs';
import { verifyA1Head, a1Blob, a3PolicyPins, A3_POLICY_PIN_FILES, isA1Tree, isA3Tree, isA3T1Tree, N22_PARENT, PBN_PARENT, PBN_FIXTURE, PBN_FIXTURE_PIN, PBN_SOURCE, PBN_SCOPE, PBN_EDITED } from '../support/m1-a1-inspection.mjs';
import { m1EffectivePins } from '../support/m1-r1-remediation.mjs';
import { readerBackfillProjection } from '../support/server-reader-authorized-delta.mjs';

const N22 = 'e9d9566c1fb1802cef158c05991d7d47d8c9182f', N22_TREE = '681bcf166c5419ab326940fa7f845d5839ddd203', T1 = '0c70b41209ed2388e1cd2dea911657ab7e620b2a';
const FIX = 'test/analytics/entries-reader-decimal-aggregation.test.mjs', ACCEPTED = 'b611191b31cb1293e9dbffeb25dbce6308497fbe', BASE = 'f22047cd79f8ce5e7c71b5d42b7200372529b083';
const HOLDER = 'test/support/m1-a1-inspection.mjs', HOLDER_PIN = 'e9bb1b01200e30970f3bad9aaa1416816016828d';
const N22G = 'test/finance/m1-node22-runtime-guard.test.mjs', RECORD = 'test/support/m1-a1-inspection.json';
const SCOPE = [FIX, N22G, 'test/finance/m1-pbn-fixture-carriage-guard.test.mjs', RECORD, HOLDER].sort();
const SOURCES = { fixture: '9550569f0bdc9b6a1ff88e3ff95cc3253285291c', carriage: '7ae41336b7c2f02b953b9267768b90f97e39278f', uc2: '46e17525e88af9da357b72c5624fe5bfdc0608ce' };
const git = (...args) => { const r = spawnSync('git', ['-C', REPO, ...args], { encoding: 'utf8', timeout: 30000, maxBuffer: 64 * 1024 * 1024 }); assert.equal(r.status, 0, r.stderr); return r.stdout; };
const names = (...args) => git(...args).trim().split('\n').filter(Boolean).sort();
const r = JSON.parse(readFileSync(join(REPO, RECORD), 'utf8'));
const prior = JSON.parse(git('show', N22 + ':' + RECORD));
const START = 'test("positive persistence control:', END = 'test("NEGATIVE CONTROL — the parent (c46c2727)';
const split = (s) => { assert.equal(s.split(START).length, 2); assert.equal(s.split(END).length, 2); const a = s.indexOf(START), b = s.indexOf(END); return [s.slice(0, a), s.slice(a, b), s.slice(b)]; };

test('PBNG-01 identity: sole parent exact N22, closed five-file scope, fixed record entry, sources never ancestors', () => {
  assert.equal(PBN_PARENT, N22); assert.equal(git('rev-parse', N22 + '^{tree}').trim(), N22_TREE); assert.equal(N22_PARENT, T1);
  assert.deepEqual(git('rev-list', '--parents', '-n1', 'HEAD').trim().split(' ').slice(1), [N22], 'exact sole parent');
  assert.deepEqual([...PBN_SCOPE], SCOPE); assert.deepEqual(names('diff', '--name-only', N22, 'HEAD', '--'), SCOPE, 'exact PBN delta');
  assert.deepEqual({ ...PBN_SOURCE }, SOURCES); assert.deepEqual([...PBN_EDITED], [FIX, N22G, HOLDER].sort());
  const { edits, ...identity } = r.pbnSuccessor;
  assert.deepEqual(identity, { parent: N22, kind: 'pbd_fixture_test_carriage', source: SOURCES, fixture: { path: FIX, pin: ACCEPTED }, scope: SCOPE, status: 'PROPOSED_FOR_INDEPENDENT_REVIEW' });
  assert.deepEqual(Object.keys(edits).sort(), [FIX, N22G, HOLDER].sort());
  for (const sha of Object.values(SOURCES)) assert.notEqual(spawnSync('git', ['-C', REPO, 'merge-base', '--is-ancestor', sha, 'HEAD']).status, 0, sha + ' is provenance only, never an ancestor');
  assert.equal(verifyA1Head(REPO).ok, true);
});

test('PBNG-02 test only: runtime, Node22 package/lock, Rules and every non-scope pin are exactly N22', () => {
  assert.equal(git('diff', '--name-only', N22, 'HEAD', '--', '.', ':!test'), '');
  for (const f of ['package.json', 'package-lock.json', 'database.rules.json', 'test/emulator/database.rules.json', 'vercel.json', '.vercelignore', 'lib/emailDelivery.js', 'lib/sendEmail.js',
    'api/daily-snapshot/run.ts', 'api/admin.js', 'api/alerts/run.ts', 'src/agent/proactive/runProactiveJob.ts', 'src/utils/dates.ts', 'lib/proactiveCore.js'])
    assert.equal(git('rev-parse', 'HEAD:' + f).trim(), git('rev-parse', N22 + ':' + f).trim(), f + ' is the N22 blob');
  for (const [f, pin] of Object.entries(prior.treePins)) if (!SCOPE.includes(f)) assert.equal(r.treePins[f], pin, f + ' keeps its N22 pin');
  assert.equal(Object.keys(r.treePins).length, Object.keys(prior.treePins).length + 1, 'only the PBN guard is added');
  for (const key of Object.keys(prior)) if (!['scope', 'allowedScope', 'treePins', 'historicalGuards'].includes(key)) assert.deepEqual(r[key], prior[key], key + ' historical record entry unchanged');
  assert.deepEqual(r.scope, [...new Set([...prior.scope, ...SCOPE])].sort());
  assert.deepEqual(r.allowedScope, [...new Set([...prior.allowedScope, ...r.scope])].sort());
  assert.deepEqual(r.historicalGuards, { ...prior.historicalGuards, [N22G]: N22 });
});

test('PBNG-03 exact transfer: the accepted fixture bytes; only the positive persistence row differs from N22', () => {
  assert.equal(PBN_FIXTURE, FIX); assert.equal(PBN_FIXTURE_PIN, ACCEPTED);
  assert.equal(git('rev-parse', N22 + ':' + FIX).trim(), BASE, 'N22 carries the pre-correction (I7) fixture');
  const now = readFileSync(join(REPO, FIX)); assert.equal(a1Blob(now), ACCEPTED); assert.equal(git('rev-parse', 'HEAD:' + FIX).trim(), ACCEPTED); assert.equal(git('rev-parse', ':' + FIX).trim(), ACCEPTED);
  const [b0, , b2] = split(git('show', N22 + ':' + FIX)), [n0, row, n2] = split(now.toString('utf8'));
  assert.equal(n0, b0, 'everything before the row (imports, helpers, other rows) is N22 verbatim');
  assert.equal(n2, b2, 'everything after the row is N22 verbatim');
  assert.equal([...row.matchAll(/\["(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z)", "(\d{4}-\d\d-\d\d)"\]/g)].length, 21, 'the 21 accepted clock cases');
  for (const needle of ['globalThis.Date = FixtureDate', 'finally { globalThis.Date = HostDate; }', 'await PJ.runForBiz(T, B)', 'assert.deepEqual([ru.periodEnd, ru.baselineValue], [yesterday, 1000]',
    '.filter((i) => i.type === "revenue_underperformance").length, 1', 'ru.currentValue === 600', 'for (const s of snaps) assert.deepEqual(s, snaps[0]);'])
    assert.ok(row.includes(needle), 'accepted assertion retained: ' + needle);
});

test('PBNG-04 independent literal pin of the current holder; prior predicates and policy pins unchanged', () => {
  assert.equal(a1Blob(readFileSync(join(REPO, HOLDER))), HOLDER_PIN); assert.equal(git('rev-parse', 'HEAD:' + HOLDER).trim(), HOLDER_PIN); assert.equal(git('rev-parse', ':' + HOLDER).trim(), HOLDER_PIN);
  assert.equal(r.treePins[HOLDER], HOLDER_PIN);
  const before = git('show', N22 + ':' + HOLDER), now = readFileSync(join(REPO, HOLDER), 'utf8');
  const body = (s, name) => { const a = s.indexOf('export function ' + name + '('); assert.ok(a >= 0); return s.slice(a, s.indexOf('\n}', a) + 2); };
  for (const name of ['isA1Tree', 'isA3Tree', 'isA3T1Tree', 'a3PolicyPins', 'historicalTest', 'a1LocalPins']) assert.equal(body(now, name), body(before, name), name + ' unchanged');
  assert.ok(isA1Tree(REPO) && isA3Tree(REPO) && isA3T1Tree(REPO));
  const pins = a3PolicyPins(REPO), eff = m1EffectivePins(REPO);
  assert.deepEqual(Object.keys(pins).sort(), [...A3_POLICY_PIN_FILES]);
  for (const [f, pin] of Object.entries(pins)) { assert.equal(pin, prior.treePins[f], f + ' N22 policy pin'); assert.equal(eff[f], pin, f + ' effective'); }
});

test('PBNG-05 the N22 guard is adapted only by the existing literal-history import line', () => {
  const before = git('show', N22 + ':' + N22G), now = readFileSync(join(REPO, N22G), 'utf8');
  const from = "import { test } from 'node:test';\nimport assert from 'node:assert/strict';";
  assert.equal(before.split(from).length, 2);
  assert.equal(now, before.replace(from, 'import { historicalTest } from "../support/m1-a1-inspection.mjs";\nconst test = historicalTest(new URL("../../", import.meta.url), "' + N22 + '", "' + N22G + '");\nimport assert from \'node:assert/strict\';'));
});

test('PBNG-06 N22 exact configuration projection still projects only the two package files on this child', () => {
  const all = ['package.json', 'package-lock.json', 'vercel.json', 'src/agent/extra.ts', FIX];
  const p = readerBackfillProjection(REPO, all); assert.equal(p.ok, true, JSON.stringify(p)); assert.equal(p.layer, 'A1-exact-BF3+N22');
  assert.deepEqual(p.projected, ['vercel.json', 'src/agent/extra.ts', FIX]);
});

test('PBNG-07 tamper controls in disposable shared clones', () => {
  const clone = () => { const p = mkdtempSync(join(tmpdir(), 'pbn-tamper-')); const c = spawnSync('git', ['clone', '--shared', '--quiet', REPO, p], { encoding: 'utf8', timeout: 60000 }); assert.equal(c.status, 0, c.stderr); return p; };
  const refused = (label, mutate) => { const p = clone(); try { mutate(p); assert.throws(() => verifyA1Head(p), undefined, label + ' must be refused'); } finally { rmSync(p, { recursive: true, force: true }); } };
  refused('fixture reverted to the N22 (pre-correction) row', (p) => assert.equal(spawnSync('git', ['-C', p, 'checkout', N22, '--', FIX]).status, 0));
  refused('one accepted clock case removed from the row', (p) => { const f = join(p, FIX), s = readFileSync(f, 'utf8'); const x = '    ["2028-02-29T22:00:00.000Z", "2028-02-29"], // leap-day calendar history\n'; assert.ok(s.includes(x)); writeFileSync(f, s.replace(x, '')); });
  refused('accepted business-date assertion weakened', (p) => { const f = join(p, FIX), s = readFileSync(f, 'utf8'); const x = 'assert.deepEqual([ru.periodEnd, ru.baselineValue], [yesterday, 1000]'; assert.ok(s.includes(x)); writeFileSync(f, s.replace(x, 'assert.ok(true || [ru.periodEnd, ru.baselineValue], [yesterday, 1000]')); });
  refused('runtime dirt', (p) => appendFileSync(join(p, 'src/utils/dates.ts'), '\n// tamper\n'));
  refused('Node22 engine widened', (p) => { const f = join(p, 'package.json'); writeFileSync(f, readFileSync(f, 'utf8').replace('"node": "22.x"', '"node": ">=20"')); });
  refused('PBN layer removed', (p) => { const f = join(p, RECORD), j = JSON.parse(readFileSync(f, 'utf8')); delete j.pbnSuccessor; writeFileSync(f, JSON.stringify(j)); });
  refused('child commit on top of the carriage', (p) => { appendFileSync(join(p, 'test/finance/pbn-extra.test.mjs'), '// extra\n'); assert.equal(spawnSync('git', ['-C', p, 'add', '-A']).status, 0); assert.equal(spawnSync('git', ['-C', p, '-c', 'user.name=t', '-c', 'user.email=t@invalid', 'commit', '-qm', 'tamper']).status, 0); });
  // projection fails closed on a mismatched PBN parent (a child commit) and on a removed layer identity
  const p = clone();
  try {
    assert.equal(spawnSync('git', ['-C', p, '-c', 'user.name=t', '-c', 'user.email=t@invalid', 'commit', '--allow-empty', '-qm', 'child']).status, 0);
    assert.deepEqual([readerBackfillProjection(p, ['package.json']).ok, readerBackfillProjection(p, ['package.json']).reason], [false, 'pbn_parent']);
  } finally { rmSync(p, { recursive: true, force: true }); }
  assert.equal(verifyA1Head(REPO).ok, true);
});
