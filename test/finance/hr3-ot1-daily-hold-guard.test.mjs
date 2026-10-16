// HR3 OT1 guard (LOCAL successor of accepted S3 7fa1b6e1; pending independent Codex review; T-OT1-GUARD).
//   HR3OT1G-01  S3 is the sole parent; the committed delta is exactly the fixed scope + this record; every scoped file is
//               pinned in HEAD, index, checkout and the effective overlay; index / working tree clean; no untracked file
//   HR3OT1G-02  the three EDITED files re-derive from the literal S3 blobs by the recorded exact edits; the S3 guard is layered
//   HR3OT1G-03  nothing outside the scope moves: runtime, route, provider, Rules, build and the receipt writer are S3 bytes;
//               the tool's executable change is exactly the two recorded lines
//   HR3OT1G-04  regression control: the literal S3 tool reads the real-store `sending` receipt as unreadable; this tree names it
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { REPO } from '../support/fincore-load.mjs';
import { gitIn } from '../support/git-context.mjs';
import { gitBlobId, m1EffectivePins } from '../support/m1-r1-remediation.mjs';
import { HR3OT1_PARENT, HR3OT1_SCOPE, HR3OT1_PINS, isHR3OT1Tree, deriveHR3OT1 } from '../support/hr3-ot1-daily-hold.mjs';
import { HR3S3_PINS } from '../support/hr3-s3-daily-hold.mjs';
const SKIP = !isHR3OT1Tree(REPO) && 'not an HR3 OT1 successor';
const RECORD = 'test/support/hr3-ot1-daily-hold.json';
const EDITED = ['tools/daily-delivery/hold.mjs', 'test/finance/hr3-s3-daily-hold-guard.test.mjs', 'test/support/m1-r1-remediation.mjs'];
const git = (args) => { const r = gitIn(REPO, args); assert.equal(r.status, 0, r.stderr); return r.stdout.trim(); };
const names = (args) => { const r = gitIn(REPO, [args[0], '-z', ...args.slice(1)]); assert.equal(r.status, 0, r.stderr); return r.stdout.split('\0').filter(Boolean); };
const parentBlob = (f) => { const r = gitIn(REPO, ['cat-file', 'blob', `${HR3OT1_PARENT}:${f}`]); assert.equal(r.status, 0, f); return r.stdout; };

test('HR3OT1G-01 S3 sole parent, fixed scope, HEAD / index / checkout / overlay pins, clean tree', { skip: SKIP }, () => {
  assert.deepEqual(git(['rev-list', '--parents', '-n1', 'HEAD']).split(' ').slice(1), [HR3OT1_PARENT]);
  assert.deepEqual(names(['diff', '--name-only', HR3OT1_PARENT, 'HEAD', '--']).sort(), [...HR3OT1_SCOPE, RECORD].sort());
  assert.deepEqual(Object.keys(HR3OT1_PINS).sort(), [...HR3OT1_SCOPE].sort());
  for (const args of [['diff', '--cached', '--name-only', 'HEAD', '--'], ['diff', '--name-only', 'HEAD', '--'],
    ['ls-files', '--others', '--', ':(exclude)node_modules', ':(exclude)test/historical/.deps']]) assert.deepEqual(names(args), [], args.join(' '));
  for (const f of HR3OT1_SCOPE) {
    assert.match(HR3OT1_PINS[f], /^[0-9a-f]{40}$/, f);
    assert.equal(git(['rev-parse', `HEAD:${f}`]), HR3OT1_PINS[f], f + ' HEAD');
    assert.equal(git(['rev-parse', `:${f}`]), HR3OT1_PINS[f], f + ' index');
    assert.equal(gitBlobId(readFileSync(join(REPO, f))), HR3OT1_PINS[f], f + ' checkout');
    assert.equal(m1EffectivePins(REPO)[f], HR3OT1_PINS[f], f + ' overlay');
    if (HR3S3_PINS[f]) assert.equal(m1EffectivePins(REPO, { withHR3OT1: false })[f], HR3S3_PINS[f], f + ' overlay without this layer is S3');
  }
});

test('HR3OT1G-02 edited files re-derive from literal S3 by the recorded edits; the S3 guard is layered on the S3 object', { skip: SKIP }, () => {
  for (const f of EDITED) {
    const r = deriveHR3OT1(REPO, f); assert.ok(r.ok, f + ': ' + r.reason);
    assert.equal(gitBlobId(r.bytes), HR3OT1_PINS[f], f + ' re-derived');
    assert.equal(deriveHR3OT1(REPO, f, { [f]: [{ from: 'not a parent anchor', to: '' }] }).reason, 'edit_anchor_not_unique');
  }
  assert.equal(deriveHR3OT1(REPO, 'lib/emailDelivery.js').reason, 'missing_edits', 'no recorded edit touches the runtime');
  const s3guard = readFileSync(join(REPO, 'test/finance/hr3-s3-daily-hold-guard.test.mjs'), 'utf8');
  assert.ok(s3guard.includes("const SOURCE=LAYERED?S3:'HEAD'"));
  assert.ok(s3guard.includes(`const S3='${HR3OT1_PARENT}'`));
  assert.equal(git(['rev-parse', HR3OT1_PARENT]), HR3OT1_PARENT, 'the S3 object is present and immutable');
});

test('HR3OT1G-03 runtime, route, provider, Rules, build and receipt writer are S3 bytes; the tool change is the two recorded lines', { skip: SKIP }, () => {
  for (const f of ['lib/emailDelivery.js', 'lib/emailDelivery.d.ts', 'lib/sendEmail.js', 'api/daily-snapshot/run.ts', 'api/admin.js',
    'database.rules.json', 'test/emulator/database.rules.json', 'test/support/rules-authorized-delta.mjs', 'vercel.json', 'package.json',
    'package-lock.json', 'index.html', 'test/support/hr3-s3-daily-hold.json', 'test/support/hr3-s3-daily-hold.mjs',
    'test/emulator/hr1-daily-hold-emulator.mjs', 'test/emulator/hr3-s3-roundtrip-emulator.mjs', 'test/delivery/hr1-operator-and-compat.test.mjs'])
    assert.equal(git(['rev-parse', `HEAD:${f}`]), git(['rev-parse', `${HR3OT1_PARENT}:${f}`]), f);
  assert.deepEqual(names(['diff', '--name-only', HR3OT1_PARENT, 'HEAD', '--', 'src', 'fincore', 'lib', 'api', 'scripts', 'migrations']), []);
  const code = (s) => s.split('\n').filter((l) => !l.trimStart().startsWith('//')).map((l) => l.trim());
  const before = new Set(code(parentBlob('tools/daily-delivery/hold.mjs'))), after = new Set(code(readFileSync(join(REPO, 'tools/daily-delivery/hold.mjs'), 'utf8')));
  assert.deepEqual([...before].filter((l) => !after.has(l)),
    ['typeof x.claimId !== "string" || !/^[a-f0-9]{64}$/.test(x.recipientHash) || !Array.isArray(x.history) ||']);
  assert.deepEqual([...after].filter((l) => !before.has(l)).sort(),
    ['liveClaims: receipts.active,', 'typeof x.claimId !== "string" || !/^[a-f0-9]{64}$/.test(x.recipientHash) || (x.history !== undefined && !Array.isArray(x.history)) ||'].sort());
});

test('HR3OT1G-04 regression control: the literal S3 tool reads a real-store first-attempt receipt as unreadable; this tree names it', { skip: SKIP }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hr3-ot1-'));
  const lib = pathToFileURL(join(REPO, 'lib/emailDelivery.js')).href;
  const src = parentBlob('tools/daily-delivery/hold.mjs').replace('"../../lib/emailDelivery.js"', JSON.stringify(lib));
  assert.notEqual(src, parentBlob('tools/daily-delivery/hold.mjs'), 'the import was redirected to this tree\'s unchanged runtime');
  writeFileSync(join(dir, 'hold-s3.mjs'), src);
  const S3Tool = await import(pathToFileURL(join(dir, 'hold-s3.mjs')).href);
  const Tool = await import(pathToFileURL(join(REPO, 'tools/daily-delivery/hold.mjs')).href);
  const NOW = Date.UTC(2026, 9, 25, 6, 5);
  const holdRaw = { schema: 1, state: 'held', version: 1, log: { v000000001: { action: 'init', state: 'held', version: 1, prevVersion: 0, actor: 'op', reason: 'r', at: NOW - 60_000 } } };
  // the real store keeps no `history` key for a first attempt (lib writes `history: []`; RTDB elides the empty array)
  const stored = { v: 'MARJIN_EMAIL_RECEIPT/1', kind: 'daily_snapshot', tenantId: 't', bizId: 'b', businessDate: '2026-10-25', attempt: 1,
    claimId: 'c', recipientHash: '0'.repeat(64), state: 'sending', claimedAt: NOW, sendingAt: NOW, leaseUntil: NOW + 600_000, updatedAt: NOW };
  const args = (nowMs) => ({ holdRaw, receiptsRaw: { t: { b: { '2026-10-25': stored } } }, manualRaw: null, nowMs, maxDurationMs: 60_000 });
  const s3live = S3Tool.drainEvidence(args(NOW + 1)), s3expired = S3Tool.drainEvidence(args(NOW + 600_000));
  assert.deepEqual([s3live.criteria.C2_no_live_scheduled_claim, s3live.unreadable.receipts, s3live.liveClaims], ['not_met', ['t/b/2026-10-25'], undefined], 'S3: unreadable, unnamed');
  assert.deepEqual([s3expired.criteria.C2_no_live_scheduled_claim, s3expired.p7Population.scheduledSendingExpired, s3expired.unreadable.receipts], ['not_met', [], ['t/b/2026-10-25']], 'S3: the lost invocation never reaches the P7 population');
  const live = Tool.drainEvidence(args(NOW + 1)), expired = Tool.drainEvidence(args(NOW + 600_000));
  assert.deepEqual([live.criteria.C2_no_live_scheduled_claim, live.unreadable.receipts, live.liveClaims], ['not_met', [], [{ id: 't/b/2026-10-25', state: 'sending', attempt: 1 }]]);
  assert.deepEqual([expired.criteria.C2_no_live_scheduled_claim, expired.p7Population.scheduledSendingExpired, expired.unreadable.receipts], ['met', [{ id: 't/b/2026-10-25', attempt: 1 }], []]);
  for (const r of [s3live, s3expired, live, expired]) assert.equal(r.verdict, 'ABORT_D', 'no report here completes');
});
