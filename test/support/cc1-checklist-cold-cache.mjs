// CC1 — the checklist cold-cache successor (LOCAL author candidate; pending independent Codex review and the checklist / bizDataRepo
// owner's acceptance, T-CC1). Sole parent: I7 (5bae812c, preserved unchanged; itself pending review). It corrects the recorded
// observation I7-O1 / I7E-O1 / R7-5: on a cold server instance an edit of an EXISTING checklist document with its correct version token
// was refused with 409 checklist_conflict, because setBizDocGuarded aborted on the instance's LOCAL cache (null) without consulting the
// server. The APPROVED contracts only — the checklist version contract (lib/checklistVersion.js: "the server recomputes the current
// token inside the write transaction"; a stale token → 409 checklist_conflict) and the reviewed CD-M2 cold-cache transaction pattern
// (lib/repositories/entryExceptionsRepo.js runEntryExceptionTxn); no new policy:
//   lib/repositories/bizDataRepo.js   (protected: lib/) setBizDocGuarded's FIRST transaction run re-submits the value it saw, unchanged,
//                                     when the token does not match it, so RTDB compares it with the server's value; every later run
//                                     (the server's value) aborts on a mismatch exactly as before. No handler, route, authorization,
//                                     registry, token, response, Rules or configuration byte moves.
// The change is a list of exact { from, to } edits of the I7 bytes recorded in cc1-checklist-cold-cache.json (author tool
// gen-cc1-record.py). A pin here is a candidate pin and inherits no approval.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const RECORD = JSON.parse(readFileSync(new URL("./cc1-checklist-cold-cache.json", import.meta.url), "utf8"));
export const CC1_STATUS = "CANDIDATE (checklist cold-cache successor CC1 on I7) — pending independent Codex review; checklist / bizDataRepo owner acceptance (T-CC1) PROPOSED";
export const CC1_PARENT = RECORD.parent;
export const CC1_PINS = Object.freeze({ ...RECORD.pins });
export const CC1_NEW_FILES = Object.freeze([...RECORD.newFiles]);
export const CC1_EDITS = Object.freeze(RECORD.edits);
export const CC1_SCOPE = Object.freeze(["lib/repositories/bizDataRepo.js"]);

const git = (repo, args, opts = {}) => spawnSync("git", ["-C", repo, ...args], { encoding: "utf8", maxBuffer: 1 << 28, ...opts });
/** The CC1 tree: the I7 candidate is a STRICT ancestor of HEAD. */
export function isCC1Tree(repo) {
  if (git(repo, ["merge-base", "--is-ancestor", CC1_PARENT, "HEAD"]).status !== 0) return false;
  return git(repo, ["rev-parse", "HEAD"]).stdout.trim() !== CC1_PARENT;
}
const parentBytes = (repo, f) => { const r = git(repo, ["cat-file", "blob", `${CC1_PARENT}:${f}`], { encoding: "buffer" }); if (r.status !== 0) throw new Error(`${CC1_PARENT}:${f}`); return r.stdout; };

/** Apply the recorded CC1 edits of `file` to `bytes`, in order; each `from` must occur exactly once when it applies. */
export function applyCC1Edits(file, bytes, edits = CC1_EDITS) {
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
export function deriveCC1(repo, file, edits = CC1_EDITS) { return applyCC1Edits(file, parentBytes(repo, file), edits); }
