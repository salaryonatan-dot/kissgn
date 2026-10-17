// HR3 OT2 — successor of OT1 0576cfda (LOCAL candidate; pending independent Codex review; T-OT2-*).
// One operator-tool input correction (tools/daily-delivery/hold.mjs: the C4 duration flag is accepted only as ONE `=`-joined
// positive decimal integer; OT2-F1) with its committed interface test, this record and its guard. OT1's reporting lines, the
// delivery runtime, routes, Rules and every file outside the scope below are OT1's bytes (HR3OT2G-03). The OT1 guard is layered
// on the literal OT1 object.
import { readFileSync } from 'node:fs';
import { gitIn } from './git-context.mjs';
const record = JSON.parse(readFileSync(new URL('./hr3-ot2-daily-hold.json', import.meta.url), 'utf8'));
export const HR3OT2_PARENT = '0576cfdad6cf8b6404f134a697219c6b0f9647cf';   // OT1
export const HR3OT2_GRANDPARENT = '7fa1b6e130dd0cdd24e02657d69a073e93a3f767';   // accepted S3
// Scope is fixed here; a changed JSON record cannot widen it.
export const HR3OT2_SCOPE = Object.freeze([
  'test/delivery/hr3-ot2-duration-input.test.mjs',
  'test/finance/hr3-ot1-daily-hold-guard.test.mjs',
  'test/finance/hr3-ot2-daily-hold-guard.test.mjs',
  'test/support/hr3-ot2-daily-hold.mjs',
  'test/support/m1-r1-remediation.mjs',
  'tools/daily-delivery/hold.mjs',
]);
export const HR3OT2_PINS = Object.freeze(record.pins);
export function isHR3OT2Tree(repo) {
  return gitIn(repo, ['merge-base', '--is-ancestor', HR3OT2_PARENT, 'HEAD']).status === 0 &&
    gitIn(repo, ['rev-parse', 'HEAD']).stdout.trim() !== HR3OT2_PARENT;
}
/** Re-derive a scoped file from the literal OT1 blob by the recorded exact edits (each anchor must occur exactly once). */
export function deriveHR3OT2(repo, file, edits = record.edits) {
  const parent = gitIn(repo, ['cat-file', 'blob', `${HR3OT2_PARENT}:${file}`]);
  if (parent.status !== 0) return { ok: false, reason: 'missing_parent_blob' };
  let text = parent.stdout;
  if (!Array.isArray(edits?.[file]) || !edits[file].length) return { ok: false, reason: 'missing_edits' };
  for (const e of edits[file]) {
    if (typeof e.from !== 'string' || !e.from || typeof e.to !== 'string' || text.split(e.from).length !== 2) return { ok: false, reason: 'edit_anchor_not_unique' };
    text = text.replace(e.from, () => e.to);
  }
  return { ok: true, bytes: Buffer.from(text) };
}
