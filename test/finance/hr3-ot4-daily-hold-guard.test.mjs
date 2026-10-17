// HR3 OT4 guard (LOCAL successor of OT3 770c0659; pending independent Codex review; T-OT4-GUARD).
//   HR3OT4G-01  OT3 is the sole parent; the committed delta is exactly the fixed scope + this record; every scoped file is pinned
//               in HEAD, index, checkout and the effective overlay; index / working tree clean; no untracked file
//   HR3OT4G-02  the three EDITED files re-derive from the literal OT3 blobs by the recorded edits; the OT3 guard is layered
//   HR3OT4G-03  nothing outside the scope moves (runtime, route, provider, Rules, build = S3 bytes); the tool's executable change
//               is exactly the grammar lines; OT1's reporting lines and OT3's raw recognition / stray rule are retained
//   HR3OT4G-04  regression control: the literal OT3 tool turns `--max-duration-ms1` into a 1 ms bound and completes the report;
//               this tree leaves C4 not_evaluable
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { REPO } from '../support/fincore-load.mjs';
import { gitIn } from '../support/git-context.mjs';
import { gitBlobId, m1EffectivePins } from '../support/m1-r1-remediation.mjs';
import { HR3OT4_PARENT, HR3OT4_GRANDPARENT, HR3OT4_SCOPE, HR3OT4_PINS, isHR3OT4Tree, deriveHR3OT4 } from '../support/hr3-ot4-daily-hold.mjs';
import { HR3OT3_PINS } from '../support/hr3-ot3-daily-hold.mjs';
import { releasedHoldRecord } from '../support/daily-email-harness.mjs';
const SKIP = !isHR3OT4Tree(REPO) && 'not an HR3 OT4 successor';
const S3 = '7fa1b6e130dd0cdd24e02657d69a073e93a3f767';
const RECORD = 'test/support/hr3-ot4-daily-hold.json';
const TOOL = 'tools/daily-delivery/hold.mjs';
const EDITED = [TOOL, 'test/finance/hr3-ot3-daily-hold-guard.test.mjs', 'test/support/m1-r1-remediation.mjs'];
const git = (args) => { const r = gitIn(REPO, args); assert.equal(r.status, 0, r.stderr); return r.stdout.trim(); };
const names = (args) => { const r = gitIn(REPO, [args[0], '-z', ...args.slice(1)]); assert.equal(r.status, 0, r.stderr); return r.stdout.split('\0').filter(Boolean); };
const parentBlob = (f) => { const r = gitIn(REPO, ['cat-file', 'blob', `${HR3OT4_PARENT}:${f}`]); assert.equal(r.status, 0, f); return r.stdout; };

test('HR3OT4G-01 OT3 sole parent, fixed scope, HEAD / index / checkout / overlay pins, clean tree', { skip: SKIP }, () => {
  assert.deepEqual(git(['rev-list', '--parents', '-n1', 'HEAD']).split(' ').slice(1), [HR3OT4_PARENT]);
  assert.equal(git(['rev-parse', `${HR3OT4_PARENT}^`]), HR3OT4_GRANDPARENT, 'OT3 is the sole child of OT2');
  assert.equal(git(['rev-parse', `${HR3OT4_GRANDPARENT}^^`]), S3, 'OT2 → OT1 → accepted S3');
  assert.deepEqual(names(['diff', '--name-only', HR3OT4_PARENT, 'HEAD', '--']).sort(), [...HR3OT4_SCOPE, RECORD].sort());
  assert.deepEqual(Object.keys(HR3OT4_PINS).sort(), [...HR3OT4_SCOPE].sort());
  for (const args of [['diff', '--cached', '--name-only', 'HEAD', '--'], ['diff', '--name-only', 'HEAD', '--'],
    ['ls-files', '--others', '--', ':(exclude)node_modules', ':(exclude)test/historical/.deps']]) assert.deepEqual(names(args), [], args.join(' '));
  for (const f of HR3OT4_SCOPE) {
    assert.match(HR3OT4_PINS[f], /^[0-9a-f]{40}$/, f);
    assert.equal(git(['rev-parse', `HEAD:${f}`]), HR3OT4_PINS[f], f + ' HEAD');
    assert.equal(git(['rev-parse', `:${f}`]), HR3OT4_PINS[f], f + ' index');
    assert.equal(gitBlobId(readFileSync(join(REPO, f))), HR3OT4_PINS[f], f + ' checkout');
    assert.equal(m1EffectivePins(REPO)[f], HR3OT4_PINS[f], f + ' overlay');
    if (HR3OT3_PINS[f]) assert.equal(m1EffectivePins(REPO, { withHR3OT4: false })[f], HR3OT3_PINS[f], f + ' overlay without this layer is OT3');
  }
});

test('HR3OT4G-02 edited files re-derive from literal OT3 by the recorded edits; the OT3 guard is layered on the OT3 object', { skip: SKIP }, () => {
  for (const f of EDITED) {
    const r = deriveHR3OT4(REPO, f); assert.ok(r.ok, f + ': ' + r.reason);
    assert.equal(gitBlobId(r.bytes), HR3OT4_PINS[f], f + ' re-derived');
    assert.equal(deriveHR3OT4(REPO, f, { [f]: [{ from: '\u0000anchor absent from every source file\u0000', to: '' }] }).reason, 'edit_anchor_not_unique');
  }
  assert.equal(deriveHR3OT4(REPO, 'lib/emailDelivery.js').reason, 'missing_edits', 'no recorded edit touches the runtime');
  const ot3guard = readFileSync(join(REPO, 'test/finance/hr3-ot3-daily-hold-guard.test.mjs'), 'utf8');
  assert.ok(ot3guard.includes("const SOURCE = LAYERED ? OT3 : 'HEAD';"));
  assert.ok(ot3guard.includes(`const OT3 = '${HR3OT4_PARENT}';`));
  assert.equal(git(['rev-parse', HR3OT4_PARENT]), HR3OT4_PARENT, 'the OT3 object is present and immutable');
});

test('HR3OT4G-03 runtime and everything outside the scope are OT3 bytes; the tool change is exactly the grammar lines', { skip: SKIP }, () => {
  for (const f of ['lib/emailDelivery.js', 'lib/emailDelivery.d.ts', 'lib/sendEmail.js', 'api/daily-snapshot/run.ts', 'api/admin.js',
    'database.rules.json', 'test/emulator/database.rules.json', 'test/support/rules-authorized-delta.mjs', 'vercel.json', 'package.json',
    'package-lock.json', 'index.html', 'test/support/hr3-ot3-daily-hold.json', 'test/support/hr3-ot3-daily-hold.mjs',
    'test/delivery/hr3-ot3-duration-raw-token.test.mjs', 'test/delivery/hr3-ot2-duration-input.test.mjs', 'test/delivery/hr3-ot1-drain-evidence-store-shape.test.mjs',
    'test/finance/hr3-ot2-daily-hold-guard.test.mjs', 'test/finance/hr3-ot1-daily-hold-guard.test.mjs', 'test/finance/hr3-s3-daily-hold-guard.test.mjs',
    'test/emulator/hr1-daily-hold-emulator.mjs', 'test/emulator/hr3-s3-roundtrip-emulator.mjs', 'test/delivery/hr1-operator-and-compat.test.mjs']) {
    assert.equal(git(['rev-parse', `HEAD:${f}`]), git(['rev-parse', `${HR3OT4_PARENT}:${f}`]), f + ' is OT3 bytes');
  }
  for (const f of ['lib/emailDelivery.js', 'api/daily-snapshot/run.ts', 'lib/sendEmail.js', 'database.rules.json'])
    assert.equal(git(['rev-parse', `HEAD:${f}`]), git(['rev-parse', `${S3}:${f}`]), f + ' is S3 bytes');
  assert.deepEqual(names(['diff', '--name-only', HR3OT4_PARENT, 'HEAD', '--', 'src', 'fincore', 'lib', 'api', 'scripts', 'migrations']), []);
  const code = (s) => s.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('//') && !l.startsWith('*') && !l.startsWith('/*'));
  const before = new Set(code(parentBlob(TOOL))), after = new Set(code(readFileSync(join(REPO, TOOL), 'utf8')));
  assert.deepEqual([...before].filter((l) => !after.has(l)).sort(), [
    'if (args.ambiguousDuration || typeof v !== "string" || !/^[1-9][0-9]*$/.test(v)) return null;',
    'return Number.isSafeInteger(n) ? n : null;',
  ].sort());
  assert.deepEqual([...after].filter((l) => !before.has(l)).sort(), [
    'if (rest !== "" && !rest.startsWith("=")) out.malformedDuration = true;',
    'if (args.ambiguousDuration || args.malformedDuration || typeof v !== "string" || !/^[1-9][0-9]*$/.test(v)) return null;',
    'return Number.isSafeInteger(n) && String(n) === v ? n : null;',
  ].sort());
  for (const l of ['liveClaims: receipts.active,', 'typeof x.claimId !== "string" || !/^[a-f0-9]{64}$/.test(x.recipientHash) || (x.history !== undefined && !Array.isArray(x.history)) ||',
    'if (a.startsWith(DURATION_FLAG) && !/^[a-z-]/.test(a.slice(DURATION_FLAG.length))) {', 'if (Object.hasOwn(out, "max-duration-ms")) out.ambiguousDuration = true;',
    'out["max-duration-ms"] = rest === "" ? true : rest.startsWith("=") ? rest.slice(1) : rest;', 'if (Array.isArray(args._) && args._.length > 1) return null;',
    'const maxDurationMs = maxDurationInput(args);'])
    assert.ok(after.has(l), 'OT1 / OT2 / OT3 line retained: ' + l.slice(0, 50));
});

test('HR3OT4G-04 regression control: the literal OT3 tool reads `--max-duration-ms1` as 1 ms; this tree leaves C4 not_evaluable', { skip: SKIP }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hr3-ot4-'));
  const lib = pathToFileURL(join(REPO, 'lib/emailDelivery.js')).href;
  const src = parentBlob(TOOL).replace('"../../lib/emailDelivery.js"', JSON.stringify(lib));
  assert.notEqual(src, parentBlob(TOOL), 'the import was redirected to this tree\'s unchanged runtime');
  writeFileSync(join(dir, 'hold-ot3.mjs'), src);
  const OT3Tool = await import(pathToFileURL(join(dir, 'hold-ot3.mjs')).href);
  const Tool = await import(pathToFileURL(join(REPO, TOOL)).href);
  const T_HOLD = Date.UTC(2026, 9, 17, 6, 0);
  const holdRaw = { ...releasedHoldRecord(), state: 'held', version: 3, log: { ...releasedHoldRecord().log,
    v000000003: { action: 'hold', state: 'held', version: 3, prevVersion: 2, actor: 'op', reason: 'incident', at: T_HOLD } } };
  const db = { ref: (p) => ({ once: async () => ({ val: () => (p === 'delivery_control/daily_snapshot' ? holdRaw : null) }) }) };
  const nowMs = T_HOLD + 1 + Tool.SEND_DEADLINE_MS + 600_000 + Tool.DRAIN_MARGIN_MS + 1;
  const ATTEST = ['--inventory-attested', '--logs-attested', '--invocation-receipt-attested', '--provider-attested'];
  const runWith = async (T) => { const a = T.parseArgs(['evidence', '--max-duration-ms1', ...ATTEST]); return T.runCommand(db, a._[0], a, { project: 'demo-marjin-rules', nowMs }); };
  const old = await runWith(OT3Tool), now = await runWith(Tool);
  assert.deepEqual([old.result.timeBound.maxDurationMs, old.result.criteria.C4_time_bound_passed, old.result.verdict, old.exitCode],
    [1, 'met', 'EVIDENCE_COMPLETE_FOR_OWNER_REVIEW', 0], 'OT3: the missing separator was read as a value');
  assert.deepEqual([now.result.timeBound.maxDurationMs, now.result.criteria.C4_time_bound_passed, now.result.verdict, now.exitCode],
    [null, 'not_evaluable', 'ABORT_D', 5]);
});
