// HR3 OT3 — successor of OT2 c8fc3f83 (LOCAL candidate; pending independent Codex review; T-OT3-*).
// One operator-tool input correction (tools/daily-delivery/hold.mjs: every raw occurrence of the duration option is counted before
// the generic matcher can drop it, and `evidence` treats a stray positional as an unverifiable duration; OT2-R-01) with its
// committed regression, this record and its guard. The delivery runtime, routes, Rules and every file outside the scope below
// are OT2's bytes (HR3OT3G-03). The OT2 guard is layered on the literal OT2 object.
import { readFileSync } from 'node:fs';
import { gitIn } from './git-context.mjs';
const record = JSON.parse(readFileSync(new URL('./hr3-ot3-daily-hold.json', import.meta.url), 'utf8'));
export const HR3OT3_PARENT = 'c8fc3f832e31037589180c83611a5012dfca0853';   // OT2
export const HR3OT3_GRANDPARENT = '0576cfdad6cf8b6404f134a697219c6b0f9647cf';   // OT1 (sole child of accepted S3 7fa1b6e1)
// Scope is fixed here; a changed JSON record cannot widen it.
export const HR3OT3_SCOPE = Object.freeze([
  'test/delivery/hr3-ot3-duration-raw-token.test.mjs',
  'test/finance/hr3-ot2-daily-hold-guard.test.mjs',
  'test/finance/hr3-ot3-daily-hold-guard.test.mjs',
  'test/support/hr3-ot3-daily-hold.mjs',
  'test/support/m1-r1-remediation.mjs',
  'tools/daily-delivery/hold.mjs',
]);
export const HR3OT3_PINS = Object.freeze(record.pins);
export function isHR3OT3Tree(repo) {
  return gitIn(repo, ['merge-base', '--is-ancestor', HR3OT3_PARENT, 'HEAD']).status === 0 &&
    gitIn(repo, ['rev-parse', 'HEAD']).stdout.trim() !== HR3OT3_PARENT;
}
/** Re-derive a scoped file from the literal OT2 blob by the recorded exact edits (each anchor must occur exactly once). */
export function deriveHR3OT3(repo, file, edits = record.edits) {
  const parent = gitIn(repo, ['cat-file', 'blob', `${HR3OT3_PARENT}:${file}`]);
  if (parent.status !== 0) return { ok: false, reason: 'missing_parent_blob' };
  let text = parent.stdout;
  if (!Array.isArray(edits?.[file]) || !edits[file].length) return { ok: false, reason: 'missing_edits' };
  for (const e of edits[file]) {
    if (typeof e.from !== 'string' || !e.from || typeof e.to !== 'string' || text.split(e.from).length !== 2) return { ok: false, reason: 'edit_anchor_not_unique' };
    text = text.replace(e.from, () => e.to);
  }
  return { ok: true, bytes: Buffer.from(text) };
}
