// Agent/Daily integration I1 — the integrated candidate's own layer (LOCAL author candidate; pending independent Codex review).
// Built on the explicit merge commit I1_PARENT whose first parent is the reviewed Builder CF5-01 successor 690a07d9 (on the
// approved M1 R5 entry base cfa7e801) and whose second parent is the delivery R8 candidate 3d48398 (approved for local carriage
// of its delta only). This layer changes exactly two protected runtime files relative to I1_PARENT:
//   api/daily-snapshot/run.ts  the scheduled path consumes buildSnapshotRun (G1–G7, X1–X3, DR1-C1, scheduled G4): recorded as
//                              exact { from, to } edits of the merge-commit bytes (= the delivery R8 bytes)
//   index.html                 the owner-notice UI R1 page (2a9df535) carried TOGETHER with the route it depends on: the
//                              merge-commit page (= the M1 R5 page) + exactly the four recorded edits of owner-notice-ui.json
// Never derived from HEAD: every identity is a literal in i1-integration.json (author tool gen-i1-records.py). A pin here is a
// candidate pin and inherits no approval.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { applyOwnerNoticeUiEdits } from "./owner-notice-ui.mjs";

const RECORD = JSON.parse(readFileSync(new URL("./i1-integration.json", import.meta.url), "utf8"));
export const I1_STATUS = "CANDIDATE (Agent/Daily integration I1) — pending independent Codex review; ownership transitions PROPOSED (ADB-06, M1, page, DE1)";
export const I1_PARENT = RECORD.parent;
export const I1_ENTRY = RECORD.entryBase;
export const I1_BUILDER = RECORD.builder;
export const I1_DELIVERY = RECORD.delivery;
export const I1_UI = RECORD.ui;
export const I1_PINS = Object.freeze({ ...RECORD.pins });
export const I1_NEW_FILES = Object.freeze([...RECORD.newFiles]);
export const I1_EDITS = Object.freeze(RECORD.edits);
export const I1_SCOPE = Object.freeze(["api/daily-snapshot/run.ts", "index.html"]);

const git = (repo, args, opts = {}) => spawnSync("git", ["-C", repo, ...args], { encoding: "utf8", maxBuffer: 1 << 28, ...opts });
/** The I1 tree: the merge commit is a STRICT ancestor of HEAD. */
export function isI1Tree(repo) {
  if (git(repo, ["merge-base", "--is-ancestor", I1_PARENT, "HEAD"]).status !== 0) return false;
  return git(repo, ["rev-parse", "HEAD"]).stdout.trim() !== I1_PARENT;
}
const parentBytes = (repo, f) => { const r = git(repo, ["cat-file", "blob", `${I1_PARENT}:${f}`], { encoding: "buffer" }); if (r.status !== 0) throw new Error(`${I1_PARENT}:${f}`); return r.stdout; };

/** Apply the recorded I1 edits of `file` to `bytes` (the page through the owner-notice UI record); each `from` unique. */
export function applyI1Edits(file, bytes, edits = I1_EDITS) {
  if (file === "index.html") return applyOwnerNoticeUiEdits(file, bytes);
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
export function deriveI1(repo, file, edits = I1_EDITS) { return applyI1Edits(file, parentBytes(repo, file), edits); }
