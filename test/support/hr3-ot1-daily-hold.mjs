// HR3 OT1 — operational-tools successor of accepted S3 7fa1b6e1 (LOCAL candidate; pending independent Codex review; T-OT1-*).
// One operator-tool reading change (tools/daily-delivery/hold.mjs drainEvidence: an ABSENT receipt history is the empty
// array the real store elides; live claims are named) with its committed real-store-shape test, this record and its guard.
// No runtime, route, Rules, provider, receipt-writer or release-pin byte moves: lib/emailDelivery.js, api/daily-snapshot/run.ts
// and every file outside the scope below are S3's bytes (HR3OT1G-03). The S3 guard is layered on the literal S3 object.
import { readFileSync } from 'node:fs';
import { gitIn } from './git-context.mjs';
const record = JSON.parse(readFileSync(new URL('./hr3-ot1-daily-hold.json', import.meta.url), 'utf8'));
export const HR3OT1_PARENT = '7fa1b6e130dd0cdd24e02657d69a073e93a3f767';   // accepted S3
// Scope is fixed here; a changed JSON record cannot widen it.
export const HR3OT1_SCOPE = Object.freeze([
  'test/delivery/hr3-ot1-drain-evidence-store-shape.test.mjs',
  'test/finance/hr3-ot1-daily-hold-guard.test.mjs',
  'test/finance/hr3-s3-daily-hold-guard.test.mjs',
  'test/support/hr3-ot1-daily-hold.mjs',
  'test/support/m1-r1-remediation.mjs',
  'tools/daily-delivery/hold.mjs',
]);
export const HR3OT1_PINS = Object.freeze(record.pins);
export function isHR3OT1Tree(repo) {
  return gitIn(repo, ['merge-base', '--is-ancestor', HR3OT1_PARENT, 'HEAD']).status === 0 &&
    gitIn(repo, ['rev-parse', 'HEAD']).stdout.trim() !== HR3OT1_PARENT;
}
/** Re-derive a scoped file from the literal S3 blob by the recorded exact edits (each anchor must occur exactly once). */
export function deriveHR3OT1(repo, file, edits = record.edits) {
  const parent = gitIn(repo, ['cat-file', 'blob', `${HR3OT1_PARENT}:${file}`]);
  if (parent.status !== 0) return { ok: false, reason: 'missing_parent_blob' };
  let text = parent.stdout;
  if (!Array.isArray(edits?.[file]) || !edits[file].length) return { ok: false, reason: 'missing_edits' };
  for (const e of edits[file]) {
    if (typeof e.from !== 'string' || !e.from || typeof e.to !== 'string' || text.split(e.from).length !== 2) return { ok: false, reason: 'edit_anchor_not_unique' };
    text = text.replace(e.from, () => e.to);
  }
  return { ok: true, bytes: Buffer.from(text) };
}
