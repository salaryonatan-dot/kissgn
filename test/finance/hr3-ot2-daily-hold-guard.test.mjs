// HR3 OT2 guard (LOCAL successor of OT1 0576cfda; pending independent Codex review; T-OT2-GUARD).
//   HR3OT2G-01  OT1 is the sole parent; the committed delta is exactly the fixed scope + this record; every scoped file is pinned
//               in HEAD, index, checkout and the effective overlay; index / working tree clean; no untracked file
//   HR3OT2G-02  the three EDITED files re-derive from the literal OT1 blobs by the recorded edits; the OT1 guard is layered
//   HR3OT2G-03  nothing outside the scope moves (OT1 bytes = S3 bytes for runtime, route, provider, Rules, build, receipt writer);
//               the tool's executable change is exactly the duration-input lines; OT1's two reporting lines are retained
//   HR3OT2G-04  regression control: the literal OT1 tool turns `--max-duration-ms 300000` into a 1 ms bound and completes the
//               report early; this tree leaves C4 not_evaluable
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { REPO } from '../support/fincore-load.mjs';
import { gitIn } from '../support/git-context.mjs';
import { gitBlobId, m1EffectivePins } from '../support/m1-r1-remediation.mjs';
import { HR3OT2_PARENT, HR3OT2_GRANDPARENT, HR3OT2_SCOPE, HR3OT2_PINS, isHR3OT2Tree, deriveHR3OT2 } from '../support/hr3-ot2-daily-hold.mjs';
import { HR3OT1_PINS } from '../support/hr3-ot1-daily-hold.mjs';
import { releasedHoldRecord } from '../support/daily-email-harness.mjs';
const SKIP = !isHR3OT2Tree(REPO) && 'not an HR3 OT2 successor';
const RECORD = 'test/support/hr3-ot2-daily-hold.json';
const TOOL = 'tools/daily-delivery/hold.mjs';
const EDITED = [TOOL, 'test/finance/hr3-ot1-daily-hold-guard.test.mjs', 'test/support/m1-r1-remediation.mjs'];
const git = (args) => { const r = gitIn(REPO, args); assert.equal(r.status, 0, r.stderr); return r.stdout.trim(); };
const names = (args) => { const r = gitIn(REPO, [args[0], '-z', ...args.slice(1)]); assert.equal(r.status, 0, r.stderr); return r.stdout.split('\0').filter(Boolean); };
const parentBlob = (f) => { const r = gitIn(REPO, ['cat-file', 'blob', `${HR3OT2_PARENT}:${f}`]); assert.equal(r.status, 0, f); return r.stdout; };

test('HR3OT2G-01 OT1 sole parent, fixed scope, HEAD / index / checkout / overlay pins, clean tree', { skip: SKIP }, () => {
  assert.deepEqual(git(['rev-list', '--parents', '-n1', 'HEAD']).split(' ').slice(1), [HR3OT2_PARENT]);
  assert.equal(git(['rev-parse', `${HR3OT2_PARENT}^`]), HR3OT2_GRANDPARENT, 'OT1 is the sole child of accepted S3');
  assert.deepEqual(names(['diff', '--name-only', HR3OT2_PARENT, 'HEAD', '--']).sort(), [...HR3OT2_SCOPE, RECORD].sort());
  assert.deepEqual(Object.keys(HR3OT2_PINS).sort(), [...HR3OT2_SCOPE].sort());
  for (const args of [['diff', '--cached', '--name-only', 'HEAD', '--'], ['diff', '--name-only', 'HEAD', '--'],
    ['ls-files', '--others', '--', ':(exclude)node_modules', ':(exclude)test/historical/.deps']]) assert.deepEqual(names(args), [], args.join(' '));
  for (const f of HR3OT2_SCOPE) {
    assert.match(HR3OT2_PINS[f], /^[0-9a-f]{40}$/, f);
    assert.equal(git(['rev-parse', `HEAD:${f}`]), HR3OT2_PINS[f], f + ' HEAD');
    assert.equal(git(['rev-parse', `:${f}`]), HR3OT2_PINS[f], f + ' index');
    assert.equal(gitBlobId(readFileSync(join(REPO, f))), HR3OT2_PINS[f], f + ' checkout');
    assert.equal(m1EffectivePins(REPO)[f], HR3OT2_PINS[f], f + ' overlay');
    if (HR3OT1_PINS[f]) assert.equal(m1EffectivePins(REPO, { withHR3OT2: false })[f], HR3OT1_PINS[f], f + ' overlay without this layer is OT1');
  }
});

test('HR3OT2G-02 edited files re-derive from literal OT1 by the recorded edits; the OT1 guard is layered on the OT1 object', { skip: SKIP }, () => {
  for (const f of EDITED) {
    const r = deriveHR3OT2(REPO, f); assert.ok(r.ok, f + ': ' + r.reason);
    assert.equal(gitBlobId(r.bytes), HR3OT2_PINS[f], f + ' re-derived');
    assert.equal(deriveHR3OT2(REPO, f, { [f]: [{ from: '\u0000anchor absent from every source file\u0000', to: '' }] }).reason, 'edit_anchor_not_unique');
  }
  assert.equal(deriveHR3OT2(REPO, 'lib/emailDelivery.js').reason, 'missing_edits', 'no recorded edit touches the runtime');
  const ot1guard = readFileSync(join(REPO, 'test/finance/hr3-ot1-daily-hold-guard.test.mjs'), 'utf8');
  assert.ok(ot1guard.includes("const SOURCE = LAYERED ? OT1 : 'HEAD';"));
  assert.ok(ot1guard.includes(`const OT1 = '${HR3OT2_PARENT}';`));
  assert.equal(git(['rev-parse', HR3OT2_PARENT]), HR3OT2_PARENT, 'the OT1 object is present and immutable');
});

test('HR3OT2G-03 runtime and everything outside the scope are OT1 bytes; the tool change is exactly the duration-input lines', { skip: SKIP }, () => {
  for (const f of ['lib/emailDelivery.js', 'lib/emailDelivery.d.ts', 'lib/sendEmail.js', 'api/daily-snapshot/run.ts', 'api/admin.js',
    'database.rules.json', 'test/emulator/database.rules.json', 'test/support/rules-authorized-delta.mjs', 'vercel.json', 'package.json',
    'package-lock.json', 'index.html', 'test/support/hr3-ot1-daily-hold.json', 'test/support/hr3-ot1-daily-hold.mjs',
    'test/delivery/hr3-ot1-drain-evidence-store-shape.test.mjs', 'test/finance/hr3-s3-daily-hold-guard.test.mjs',
    'test/emulator/hr1-daily-hold-emulator.mjs', 'test/emulator/hr3-s3-roundtrip-emulator.mjs', 'test/delivery/hr1-operator-and-compat.test.mjs']) {
    assert.equal(git(['rev-parse', `HEAD:${f}`]), git(['rev-parse', `${HR3OT2_PARENT}:${f}`]), f + ' is OT1 bytes');
  }
  for (const f of ['lib/emailDelivery.js', 'api/daily-snapshot/run.ts', 'lib/sendEmail.js', 'database.rules.json'])
    assert.equal(git(['rev-parse', `HEAD:${f}`]), git(['rev-parse', `${HR3OT2_GRANDPARENT}:${f}`]), f + ' is S3 bytes');
  assert.deepEqual(names(['diff', '--name-only', HR3OT2_PARENT, 'HEAD', '--', 'src', 'fincore', 'lib', 'api', 'scripts', 'migrations']), []);
  // executable lines only: line comments and JSDoc blocks are excluded
  const code = (s) => s.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('//') && !l.startsWith('*') && !l.startsWith('/*'));
  const before = new Set(code(parentBlob(TOOL))), after = new Set(code(readFileSync(join(REPO, TOOL), 'utf8')));
  assert.deepEqual([...before].filter((l) => !after.has(l)),
    ['const maxDurationMs = args["max-duration-ms"] === undefined ? null : Number(args["max-duration-ms"]);']);
  assert.deepEqual([...after].filter((l) => !before.has(l)).sort(), [
    'if (m[1] === "max-duration-ms" && Object.hasOwn(out, m[1])) out.ambiguousDuration = true;',
    'export function maxDurationInput(args) {',
    'const v = args["max-duration-ms"];',
    'if (args.ambiguousDuration || typeof v !== "string" || !/^[1-9][0-9]*$/.test(v)) return null;',
    'const n = Number(v);',
    'return Number.isSafeInteger(n) ? n : null;',
    'const maxDurationMs = maxDurationInput(args);',
  ].sort());
  for (const l of ['liveClaims: receipts.active,', 'typeof x.claimId !== "string" || !/^[a-f0-9]{64}$/.test(x.recipientHash) || (x.history !== undefined && !Array.isArray(x.history)) ||'])
    assert.ok(after.has(l), 'OT1 reporting line retained: ' + l.slice(0, 40));
});

test('HR3OT2G-04 regression control: the literal OT1 tool reads `--max-duration-ms 300000` as 1 ms; this tree leaves C4 not_evaluable', { skip: SKIP }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hr3-ot2-'));
  const lib = pathToFileURL(join(REPO, 'lib/emailDelivery.js')).href;
  const src = parentBlob(TOOL).replace('"../../lib/emailDelivery.js"', JSON.stringify(lib));
  assert.notEqual(src, parentBlob(TOOL), 'the import was redirected to this tree\'s unchanged runtime');
  writeFileSync(join(dir, 'hold-ot1.mjs'), src);
  const OT1Tool = await import(pathToFileURL(join(dir, 'hold-ot1.mjs')).href);
  const Tool = await import(pathToFileURL(join(REPO, TOOL)).href);
  const T_HOLD = Date.UTC(2026, 9, 17, 6, 0);
  // a well-formed held record (C1 met), so C4 alone decides the verdict
  const holdRaw = { ...releasedHoldRecord(), state: 'held', version: 3, log: { ...releasedHoldRecord().log,
    v000000003: { action: 'hold', state: 'held', version: 3, prevVersion: 2, actor: 'op', reason: 'incident', at: T_HOLD } } };
  const argv = ['evidence', '--max-duration-ms', '300000', '--inventory-attested', '--logs-attested', '--invocation-receipt-attested', '--provider-attested'];
  const db = { ref: (p) => ({ once: async () => ({ val: () => (p === 'delivery_control/daily_snapshot' ? holdRaw : null) }), get: async () => ({ val: () => (p === 'delivery_control/daily_snapshot' ? holdRaw : null) }) }) };
  const nowMs = T_HOLD + 1 + Tool.SEND_DEADLINE_MS + 600_000 + Tool.DRAIN_MARGIN_MS + 1;      // past a 1 ms bound, 5 min before a 300000 ms one
  const runOT1 = async (T) => { const a = T.parseArgs(argv); return T.runCommand(db, a._[0], a, { project: 'demo-marjin-rules', nowMs }); };
  const old = await runOT1(OT1Tool), now = await runOT1(Tool);
  assert.deepEqual([old.result.timeBound.maxDurationMs, old.result.criteria.C4_time_bound_passed, old.result.verdict, old.exitCode],
    [1, 'met', 'EVIDENCE_COMPLETE_FOR_OWNER_REVIEW', 0], 'OT1: the space-separated value became a 1 ms bound and completed the report');
  assert.deepEqual([now.result.timeBound.maxDurationMs, now.result.criteria.C4_time_bound_passed, now.result.verdict, now.exitCode],
    [null, 'not_evaluable', 'ABORT_D', 5]);
});
