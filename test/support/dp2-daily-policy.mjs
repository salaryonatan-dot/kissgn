// DP2 — owner decision P4 extended (2026-10-17): no second provider hand-off for one exact (tenant, business, business date)
// across the scheduled and manual routes, including concurrent attempts. Successor of DP1 b2b7dd08 (LOCAL candidate; DP1 is NOT
// independently accepted, so the review covers the whole OT4 → DP2 policy delta; T-DP2-*).
// Runtime: the shared hand-off admission (lib/emailDelivery.js admitHandoff / settleAdmission / decideAdmission, record
// email_delivery_admission/{kind}/{tenant}/{business}/{date}) taken by BOTH routes as the last step before their own hand-off
// transition; the route's settlement / refusal mapping; the operator evidence report reads the admissions. The DP1 guard is
// layered on the literal DP1 object.
import { readFileSync } from 'node:fs';
import { gitIn } from './git-context.mjs';
const record = JSON.parse(readFileSync(new URL('./dp2-daily-policy.json', import.meta.url), 'utf8'));
export const DP2_PARENT = 'b2b7dd08c2de55b7103e5e0bdbfe10446368e2a6';   // DP1 (→ accepted OT4 f34eec92 → … → accepted S3 7fa1b6e1)
// Scope is fixed here; a changed JSON record cannot widen it.
export const DP2_SCOPE = Object.freeze([
  'api/daily-snapshot/run.ts',
  'lib/emailDelivery.d.ts',
  'lib/emailDelivery.js',
  'test/delivery/dp1-manual-delivery-policy.test.mjs',
  'test/delivery/dp2-shared-admission.test.mjs',
  'test/delivery/hr3-ot1-drain-evidence-store-shape.test.mjs',
  'test/emulator/dp1-manual-policy-emulator.mjs',
  'test/emulator/dp2-admission-worker.mjs',
  'test/emulator/dp2-shared-admission-emulator.mjs',
  'test/finance/b2-guard-mutations.test.mjs',
  'test/finance/b2-snapshot.test.mjs',
  'test/finance/dp1-daily-policy-guard.test.mjs',
  'test/finance/dp2-daily-policy-guard.test.mjs',
  'test/support/dp2-daily-policy.mjs',
  'test/support/m1-r1-remediation.mjs',
  'tools/daily-delivery/hold.mjs',
]);
// the files that exist in DP1 and are changed by recorded exact edits (the others are new)
export const DP2_EDITED = Object.freeze([
  'api/daily-snapshot/run.ts', 'lib/emailDelivery.d.ts', 'lib/emailDelivery.js', 'test/delivery/dp1-manual-delivery-policy.test.mjs',
  'test/delivery/hr3-ot1-drain-evidence-store-shape.test.mjs', 'test/emulator/dp1-manual-policy-emulator.mjs', 'test/finance/b2-guard-mutations.test.mjs', 'test/finance/b2-snapshot.test.mjs',
  'test/finance/dp1-daily-policy-guard.test.mjs', 'test/support/m1-r1-remediation.mjs', 'tools/daily-delivery/hold.mjs',
]);
export const DP2_PINS = Object.freeze(record.pins);
export function isDP2Tree(repo) {
  return gitIn(repo, ['merge-base', '--is-ancestor', DP2_PARENT, 'HEAD']).status === 0 &&
    gitIn(repo, ['rev-parse', 'HEAD']).stdout.trim() !== DP2_PARENT;
}
/** Re-derive a scoped file from the literal DP1 blob by the recorded exact edits (each anchor must occur exactly once). */
export function deriveDP2(repo, file, edits = record.edits) {
  const parent = gitIn(repo, ['cat-file', 'blob', `${DP2_PARENT}:${file}`]);
  if (parent.status !== 0) return { ok: false, reason: 'missing_parent_blob' };
  let text = parent.stdout;
  if (!Array.isArray(edits?.[file]) || !edits[file].length) return { ok: false, reason: 'missing_edits' };
  for (const e of edits[file]) {
    if (typeof e.from !== 'string' || !e.from || typeof e.to !== 'string' || text.split(e.from).length !== 2) return { ok: false, reason: 'edit_anchor_not_unique' };
    text = text.replace(e.from, () => e.to);
  }
  return { ok: true, bytes: Buffer.from(text) };
}
