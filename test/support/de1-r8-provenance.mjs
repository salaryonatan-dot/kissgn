// DE1 R8 — the refusal-provenance successor of the notice-integrity R7 candidate (LOCAL author candidate; pending independent
// Codex review). It answers the independent review of the Builder carry-forward R5 (CF5-01, 2026-10-09): the R7 manual route
// attributed a builder throw by message equality alone, so an unrelated error with a message equal to a bounded code reached
// the owner as a registry refusal. The Builder successor 690a07d9 marks a genuine refusal (name "SnapshotIdentityRefusal", own
// `code` equal to the message, message in the six-code §3 set); R8 requires all three before mapping, guards every read, and
// maps everything else to 503 snapshot_build_failed. Everything of R7 (notice states, OD-01 class rule), R6 (provider
// structure) and R5 (identity rules, receiptPath, delivery target, authorization) is unchanged.
// Built on the R7 commit itself (DE1R8_PARENT), approved by the independent review for local carriage of its delta only: this
// successor inherits that scope and is not an approved integration base. Never derived from HEAD: every identity is a literal
// in de1-r8-provenance.json (recorded by the author tool gen-de1-r8-record.py in the R8 package).
//
//   DE1R8_PARENT  the R7 candidate d5e1f301
//   DE1R8_PINS    the literal blob of the ONE protected runtime file R8 changes relative to R7
//   DE1R8_EDITS   the exact { from, to } edits that turn the R7 blob into its R8 pin (each `from` unique when it applies)
//
// Scope (DE1R8G-03): the manual route's builderRefusal (and its comments) only. The receipt module, declarations, SMTP wrapper,
// builder, predicates, Rules, schedule, pins and generated assets are byte-identical to R7. A pin here is a candidate pin.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const RECORD = JSON.parse(readFileSync(new URL("./de1-r8-provenance.json", import.meta.url), "utf8"));
export const DE1R8_PARENT = RECORD.parent;
export const DE1R8_STATUS = "CANDIDATE (delivery refusal provenance R8) — pending independent Codex review; parent R7 approved for local carriage of its delta only";
export const DE1R8_PINS = Object.freeze({ ...RECORD.pins });
export const DE1R8_NEW_FILES = Object.freeze([...RECORD.newFiles]);
export const DE1R8_EDITS = Object.freeze(RECORD.edits);
export const DE1R8_SCOPE = Object.freeze(["api/daily-snapshot/run.ts"]);

const git = (repo, args, opts = {}) => spawnSync("git", ["-C", repo, ...args], { encoding: "utf8", maxBuffer: 1 << 28, ...opts });
/** The R8 successor tree: the R7 candidate is a STRICT ancestor of HEAD. */
export function isDE1R8Tree(repo) {
  if (git(repo, ["merge-base", "--is-ancestor", DE1R8_PARENT, "HEAD"]).status !== 0) return false;
  return git(repo, ["rev-parse", "HEAD"]).stdout.trim() !== DE1R8_PARENT;
}
const parentBytes = (repo, f) => { const r = git(repo, ["cat-file", "blob", `${DE1R8_PARENT}:${f}`], { encoding: "buffer" }); if (r.status !== 0) throw new Error(`${DE1R8_PARENT}:${f}`); return r.stdout; };

/** Apply the recorded R8 edits of `file` to `bytes`; each `from` must occur exactly once when it applies. */
export function applyDE1R8Edits(file, bytes, edits = DE1R8_EDITS) {
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
export function deriveDE1R8(repo, file, edits = DE1R8_EDITS) { return applyDE1R8Edits(file, parentBytes(repo, file), edits); }
