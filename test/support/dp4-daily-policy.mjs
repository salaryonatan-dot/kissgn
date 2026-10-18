// DP4 — correction successor of DP3 a125824c after the independent DP3 review (Codex, DP3_VERDICT: CHANGES_REQUIRED; finding
// DP3-R01, the remaining DP2-R02 path). LOCAL candidate; DP1, DP2 and DP3 are NOT independently accepted, so the review covers
// the whole OT4 → DP1 → DP2 → DP3 → DP4 policy chain (T-DP4-*). Owner policies unchanged (P4 across both routes, E4, P7 without
// a mechanism). Runtime: the DP1 manual-record reader excuses a record whose business date cannot be read only by the complete
// definitive failure a same-date record needs (no guessed date, no repaired record); a valid other date stays another delivery.
// The DP3 guard is layered on the literal DP3 object.
import { readFileSync } from 'node:fs';
import { gitIn } from './git-context.mjs';
const record = JSON.parse(readFileSync(new URL('./dp4-daily-policy.json', import.meta.url), 'utf8'));
export const DP4_PARENT = 'a125824cdf1b824da3e60c6a85f43b73d5ee4e68';   // DP3 (→ DP2 78b6f057 → DP1 b2b7dd08 → accepted OT4 f34eec92 → … → accepted S3 7fa1b6e1)
// Scope is fixed here; a changed JSON record cannot widen it.
export const DP4_SCOPE = Object.freeze([
  'lib/emailDelivery.js',
  'test/delivery/dp1-manual-delivery-policy.test.mjs',
  'test/delivery/dp4-legacy-date-scope.test.mjs',
  'test/finance/b2-guard-mutations.test.mjs',
  'test/finance/dp3-daily-policy-guard.test.mjs',
  'test/finance/dp4-daily-policy-guard.test.mjs',
  'test/support/dp4-daily-policy.mjs',
  'test/support/m1-r1-remediation.mjs',
]);
// the files that exist in DP3 and are changed by recorded exact edits (the others are new)
export const DP4_EDITED = Object.freeze([
  'lib/emailDelivery.js', 'test/delivery/dp1-manual-delivery-policy.test.mjs', 'test/finance/b2-guard-mutations.test.mjs',
  'test/finance/dp3-daily-policy-guard.test.mjs', 'test/support/m1-r1-remediation.mjs',
]);
export const DP4_PINS = Object.freeze(record.pins);
export function isDP4Tree(repo) {
  return gitIn(repo, ['merge-base', '--is-ancestor', DP4_PARENT, 'HEAD']).status === 0 &&
    gitIn(repo, ['rev-parse', 'HEAD']).stdout.trim() !== DP4_PARENT;
}
/** Re-derive a scoped file from the literal DP3 blob by the recorded exact edits (each anchor must occur exactly once). */
export function deriveDP4(repo, file, edits = record.edits) {
  const parent = gitIn(repo, ['cat-file', 'blob', `${DP4_PARENT}:${file}`]);
  if (parent.status !== 0) return { ok: false, reason: 'missing_parent_blob' };
  let text = parent.stdout;
  if (!Array.isArray(edits?.[file]) || !edits[file].length) return { ok: false, reason: 'missing_edits' };
  for (const e of edits[file]) {
    if (typeof e.from !== 'string' || !e.from || typeof e.to !== 'string' || text.split(e.from).length !== 2) return { ok: false, reason: 'edit_anchor_not_unique' };
    text = text.replace(e.from, () => e.to);
  }
  return { ok: true, bytes: Buffer.from(text) };
}
