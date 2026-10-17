// HR3 OT4 — successor of OT3 770c0659 (LOCAL candidate; pending independent Codex review; T-OT4-*).
// One operator-tool input correction (tools/daily-delivery/hold.mjs: only the bare flag or `=` directly after the option name is
// its grammar — any other suffix is malformed; the value must be consumed entirely; OT3-R-01) with its committed regression, this
// record and its guard. The delivery runtime, routes, Rules and every file outside the scope below are OT3's bytes (HR3OT4G-03).
// The OT3 guard is layered on the literal OT3 object.
import { readFileSync } from 'node:fs';
import { gitIn } from './git-context.mjs';
const record = JSON.parse(readFileSync(new URL('./hr3-ot4-daily-hold.json', import.meta.url), 'utf8'));
export const HR3OT4_PARENT = '770c065946ebbce77ade4a80950698f9572526ff';   // OT3
export const HR3OT4_GRANDPARENT = 'c8fc3f832e31037589180c83611a5012dfca0853';   // OT2 (→ OT1 0576cfda → accepted S3 7fa1b6e1)
// Scope is fixed here; a changed JSON record cannot widen it.
export const HR3OT4_SCOPE = Object.freeze([
  'test/delivery/hr3-ot4-duration-grammar.test.mjs',
  'test/finance/hr3-ot3-daily-hold-guard.test.mjs',
  'test/finance/hr3-ot4-daily-hold-guard.test.mjs',
  'test/support/hr3-ot4-daily-hold.mjs',
  'test/support/m1-r1-remediation.mjs',
  'tools/daily-delivery/hold.mjs',
]);
export const HR3OT4_PINS = Object.freeze(record.pins);
export function isHR3OT4Tree(repo) {
  return gitIn(repo, ['merge-base', '--is-ancestor', HR3OT4_PARENT, 'HEAD']).status === 0 &&
    gitIn(repo, ['rev-parse', 'HEAD']).stdout.trim() !== HR3OT4_PARENT;
}
/** Re-derive a scoped file from the literal OT3 blob by the recorded exact edits (each anchor must occur exactly once). */
export function deriveHR3OT4(repo, file, edits = record.edits) {
  const parent = gitIn(repo, ['cat-file', 'blob', `${HR3OT4_PARENT}:${file}`]);
  if (parent.status !== 0) return { ok: false, reason: 'missing_parent_blob' };
  let text = parent.stdout;
  if (!Array.isArray(edits?.[file]) || !edits[file].length) return { ok: false, reason: 'missing_edits' };
  for (const e of edits[file]) {
    if (typeof e.from !== 'string' || !e.from || typeof e.to !== 'string' || text.split(e.from).length !== 2) return { ok: false, reason: 'edit_anchor_not_unique' };
    text = text.replace(e.from, () => e.to);
  }
  return { ok: true, bytes: Buffer.from(text) };
}
