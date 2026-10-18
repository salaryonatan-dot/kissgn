// DP1 — the 1.0 owner delivery policies on the manual Daily (owner decisions P4 / E4 approved 2026-10-17; P7 recorded, not
// implemented), successor of accepted OT4 f34eec92 (LOCAL candidate; pending independent Codex review; T-DP1-*).
// Runtime: lib/emailDelivery.js deliverManualDaily (G3 = the scheduled gate of the business date; the P4 evidence of the exact
// identity; one transaction on the business's manual-record collection), its declaration, and the route's refusal mapping.
// Tests whose expectations encoded the superseded manual contract are re-recorded (T-DP1-TEST-EXPECTATIONS); the OT4 guard is
// layered on the literal OT4 object; the B2 route-pin test gains this layer.
import { readFileSync } from 'node:fs';
import { gitIn } from './git-context.mjs';
const record = JSON.parse(readFileSync(new URL('./dp1-daily-policy.json', import.meta.url), 'utf8'));
export const DP1_PARENT = 'f34eec92aed4851c2da8a8dfd8f1f353b1d582d7';   // accepted OT4 (→ OT3 770c0659 → OT2 → OT1 → accepted S3 7fa1b6e1)
// Scope is fixed here; a changed JSON record cannot widen it.
export const DP1_SCOPE = Object.freeze([
  'api/daily-snapshot/run.ts',
  'lib/emailDelivery.d.ts',
  'lib/emailDelivery.js',
  'test/delivery/daily-email-delivery.test.mjs',
  'test/delivery/dp1-manual-delivery-policy.test.mjs',
  'test/delivery/hr1-daily-hold.test.mjs',
  'test/emulator/dp1-manual-policy-emulator.mjs',
  'test/emulator/hr1-daily-hold-emulator.mjs',
  'test/finance/b2-guard-mutations.test.mjs',
  'test/finance/b2-snapshot.test.mjs',
  'test/finance/dp1-daily-policy-guard.test.mjs',
  'test/finance/hr3-ot4-daily-hold-guard.test.mjs',
  'test/support/dp1-daily-policy.mjs',
  'test/support/m1-r1-remediation.mjs',
]);
// the files that exist in OT4 and are changed by recorded exact edits (the others are new)
export const DP1_EDITED = Object.freeze([
  'api/daily-snapshot/run.ts', 'lib/emailDelivery.d.ts', 'lib/emailDelivery.js',
  'test/delivery/daily-email-delivery.test.mjs', 'test/delivery/hr1-daily-hold.test.mjs', 'test/emulator/hr1-daily-hold-emulator.mjs',
  'test/finance/b2-guard-mutations.test.mjs', 'test/finance/b2-snapshot.test.mjs', 'test/finance/hr3-ot4-daily-hold-guard.test.mjs',
  'test/support/m1-r1-remediation.mjs',
]);
export const DP1_PINS = Object.freeze(record.pins);
export function isDP1Tree(repo) {
  return gitIn(repo, ['merge-base', '--is-ancestor', DP1_PARENT, 'HEAD']).status === 0 &&
    gitIn(repo, ['rev-parse', 'HEAD']).stdout.trim() !== DP1_PARENT;
}
/** Re-derive a scoped file from the literal OT4 blob by the recorded exact edits (each anchor must occur exactly once). */
export function deriveDP1(repo, file, edits = record.edits) {
  const parent = gitIn(repo, ['cat-file', 'blob', `${DP1_PARENT}:${file}`]);
  if (parent.status !== 0) return { ok: false, reason: 'missing_parent_blob' };
  let text = parent.stdout;
  if (!Array.isArray(edits?.[file]) || !edits[file].length) return { ok: false, reason: 'missing_edits' };
  for (const e of edits[file]) {
    if (typeof e.from !== 'string' || !e.from || typeof e.to !== 'string' || text.split(e.from).length !== 2) return { ok: false, reason: 'edit_anchor_not_unique' };
    text = text.replace(e.from, () => e.to);
  }
  return { ok: true, bytes: Buffer.from(text) };
}
