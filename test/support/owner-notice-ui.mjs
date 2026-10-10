// Owner-notice UI R1 — the owner-visible alert of owner decision D-G4 (2026-10-09) on the approved M1 R5 page (LOCAL author
// candidate; pending independent Codex review and the page owner's M1 layer transition). The page asks the owner-authorized
// delivery route (POST /api/daily-snapshot/run, action: "notice" — the delivery R7 contract, candidate d5e1f30102ff88db98…)
// and shows «לא ניתן להכין את הסיכום היומי כי חסר שם העסק. נדרש תיקון פרטי העסק.» to an owner / super_owner of the selected
// business when the server confirms the business has no usable name; a failed / refused / unreachable read changes nothing.
// Base: the approved M1 R5 commit cfa7e801 (OWNUI_PARENT) — the page owner's lineage; this base carries NO DE1 layer, so the
// route the page depends on is not in this tree: the integrated SHA must carry delivery R7 (see test/finance/
// owner-notice-ui-guard.test.mjs UIG-05). Never derived from HEAD: every identity is a literal in owner-notice-ui.json
// (recorded by the author tool gen-owner-notice-ui-record.py in the UI package).
//
//   OWNUI_PARENT  the approved M1 R5 commit cfa7e801
//   OWNUI_PINS    the literal blob of index.html after the patch
//   OWNUI_EDITS   the exact { from, to } edits (4, purely additive) that turn the M1 R5 index.html into the UI R1 pin
//
// Scope (UIG-03): index.html only — one plain-script decision seam (window.MarjinDailyNotice), one state, one selection-bound
// effect, one banner. No route, library, Rules, schedule, pin or guard changes. A pin here is a candidate pin and inherits no
// approval; the M1 page pins (m1-integration-pin, m1-index-scope, the M1 R2..R5 guards) are NOT re-recorded here: that is the
// page owner's transition.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const RECORD = JSON.parse(readFileSync(new URL("./owner-notice-ui.json", import.meta.url), "utf8"));
export const OWNUI_PARENT = RECORD.parent;
export const OWNUI_STATUS = "CANDIDATE (owner-notice UI R1) — pending independent Codex review and the page owner's M1 layer transition; depends on delivery R7 (d5e1f301) for the notice contract";
export const OWNUI_PINS = Object.freeze({ ...RECORD.pins });
export const OWNUI_NEW_FILES = Object.freeze([...RECORD.newFiles]);
export const OWNUI_EDITS = Object.freeze(RECORD.edits);
export const OWNUI_SCOPE = Object.freeze(["index.html"]);

const git = (repo, args, opts = {}) => spawnSync("git", ["-C", repo, ...args], { encoding: "utf8", maxBuffer: 1 << 28, ...opts });
/** The UI R1 successor tree: the approved M1 R5 commit is a STRICT ancestor of HEAD. */
export function isOwnerNoticeUiTree(repo) {
  if (git(repo, ["merge-base", "--is-ancestor", OWNUI_PARENT, "HEAD"]).status !== 0) return false;
  return git(repo, ["rev-parse", "HEAD"]).stdout.trim() !== OWNUI_PARENT;
}
const parentBytes = (repo, f) => { const r = git(repo, ["cat-file", "blob", `${OWNUI_PARENT}:${f}`], { encoding: "buffer" }); if (r.status !== 0) throw new Error(`${OWNUI_PARENT}:${f}`); return r.stdout; };

/** Apply the recorded UI R1 edits of `file` to `bytes`; each `from` must occur exactly once when it applies. */
export function applyOwnerNoticeUiEdits(file, bytes, edits = OWNUI_EDITS) {
  const list = edits[file];
  if (!Array.isArray(list) || list.length === 0) return { ok: false, reason: "no_recorded_edits", detail: file };
  let s = Buffer.isBuffer(bytes) ? bytes.toString("utf8") : String(bytes);
  for (const [k, e] of list.entries()) {
    if (typeof e.from !== "string" || typeof e.to !== "string" || e.from === "") return { ok: false, reason: "edit_shape", detail: `${file}#${k}` };
    if (s.split(e.from).length !== 2) return { ok: false, reason: "edit_anchor_not_unique", detail: `${file}#${k}` };
    s = s.replace(e.from, () => e.to);
  }
  return { ok: true, bytes: Buffer.from(s, "utf8") };
}
export function deriveOwnerNoticeUi(repo, file, edits = OWNUI_EDITS) { return applyOwnerNoticeUiEdits(file, parentBytes(repo, file), edits); }
