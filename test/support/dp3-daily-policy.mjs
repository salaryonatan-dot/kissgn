// DP3 — correction successor of DP2 78b6f057 after the independent DP2 review (Codex, DP2_VERDICT: CHANGES_REQUIRED; findings
// DP2-R01 / R02 / R03 / N01). LOCAL candidate; DP1 and DP2 are NOT independently accepted, so the review covers the whole
// OT4 → DP1 → DP2 → DP3 policy chain (T-DP3-*). Owner policies unchanged (P4 across both routes, E4, P7 without a mechanism).
// Runtime: the admission decision derives from the admission AND the other stored evidence (a failed admission never erases
// older blocking evidence); one state-specific admission validation (admissionRecordDefect) shared by the runtime and the
// operator evidence report; the DP1 legacy readers fail closed on present-but-incomplete evidence (no invented lease expiry);
// the declarations list the implemented `legacy` input. The DP2 guard is layered on the literal DP2 object.
import { readFileSync } from 'node:fs';
import { gitIn } from './git-context.mjs';
const record = JSON.parse(readFileSync(new URL('./dp3-daily-policy.json', import.meta.url), 'utf8'));
export const DP3_PARENT = '78b6f05775cdbbad8de161c1377de79aafa41e96';   // DP2 (→ DP1 b2b7dd08 → accepted OT4 f34eec92 → … → accepted S3 7fa1b6e1)
// Scope is fixed here; a changed JSON record cannot widen it.
export const DP3_SCOPE = Object.freeze([
  'lib/emailDelivery.d.ts',
  'lib/emailDelivery.js',
  'test/delivery/dp1-manual-delivery-policy.test.mjs',
  'test/delivery/dp2-shared-admission.test.mjs',
  'test/delivery/dp3-evidence-validation.test.mjs',
  'test/delivery/hr3-ot1-drain-evidence-store-shape.test.mjs',
  'test/emulator/dp3-evidence-emulator.mjs',
  'test/finance/b2-guard-mutations.test.mjs',
  'test/finance/dp2-daily-policy-guard.test.mjs',
  'test/finance/dp3-daily-policy-guard.test.mjs',
  'test/support/dp3-daily-policy.mjs',
  'test/support/m1-r1-remediation.mjs',
  'tools/daily-delivery/hold.mjs',
]);
// the files that exist in DP2 and are changed by recorded exact edits (the others are new)
export const DP3_EDITED = Object.freeze([
  'lib/emailDelivery.d.ts', 'lib/emailDelivery.js', 'test/delivery/dp1-manual-delivery-policy.test.mjs', 'test/delivery/dp2-shared-admission.test.mjs',
  'test/delivery/hr3-ot1-drain-evidence-store-shape.test.mjs', 'test/finance/b2-guard-mutations.test.mjs', 'test/finance/dp2-daily-policy-guard.test.mjs',
  'test/support/m1-r1-remediation.mjs', 'tools/daily-delivery/hold.mjs',
]);
export const DP3_PINS = Object.freeze(record.pins);
export function isDP3Tree(repo) {
  return gitIn(repo, ['merge-base', '--is-ancestor', DP3_PARENT, 'HEAD']).status === 0 &&
    gitIn(repo, ['rev-parse', 'HEAD']).stdout.trim() !== DP3_PARENT;
}
/** Re-derive a scoped file from the literal DP2 blob by the recorded exact edits (each anchor must occur exactly once). */
export function deriveDP3(repo, file, edits = record.edits) {
  const parent = gitIn(repo, ['cat-file', 'blob', `${DP3_PARENT}:${file}`]);
  if (parent.status !== 0) return { ok: false, reason: 'missing_parent_blob' };
  let text = parent.stdout;
  if (!Array.isArray(edits?.[file]) || !edits[file].length) return { ok: false, reason: 'missing_edits' };
  for (const e of edits[file]) {
    if (typeof e.from !== 'string' || !e.from || typeof e.to !== 'string' || text.split(e.from).length !== 2) return { ok: false, reason: 'edit_anchor_not_unique' };
    text = text.replace(e.from, () => e.to);
  }
  return { ok: true, bytes: Buffer.from(text) };
}
