// M1 integration R5 remediation (LOCAL; pending independent Codex review) — the identity of the successor of the REJECTED
// M1 R4 candidate (M1_INTEGRATION_R4 independent review: CHANGES_REQUIRED). Never derived from HEAD: every identity below is a
// literal recorded in m1-r5-remediation.json by the author tool (tools/gen-r5-record.py in the R5 package).
//
//   M1_R5_PARENT   the rejected R4 candidate — the SOLE parent of the R5 commit. Its tree is held to the M1 ⊕ R1 ⊕ R2 ⊕ R3 ⊕ R4
//                  pins, read from git objects (R4G on an R5 tree).
//   M1_R5_PINS     the literal blob of EVERY protected file the R5 commit changes relative to its parent. Every other
//                  protected file keeps its R4 / R3 / R2 / R1 / M1 / approved pin.
//   M1_R5_EDITS    the recorded, exact { from, to } edits that turn each changed parent blob into its R5 pin (each `from`
//                  occurring EXACTLY ONCE when it applies).
//
// Scope (R5G-03): review blocker A1/A2 of the R4 review — the nightly discovery key of a (tenantId, bizId) pair
// (src/analytics/dailyBuilder.ts: the `discovered` de-duplication key, the ambiguity key and the ambiguity filter). The ids,
// the shared registry module, the endpoint, Rules, configuration, Core, P1 supplier credits, e-mail and the page are
// unchanged. A changed pin is a new candidate and inherits no approval.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const RECORD = JSON.parse(readFileSync(new URL("./m1-r5-remediation.json", import.meta.url), "utf8"));
export const M1_R5_PARENT = RECORD.parent;
export const M1_R5_STATUS = "CANDIDATE (M1 integration R5 remediation) — pending independent Codex review";
export const M1_R5_PINS = Object.freeze({ ...RECORD.pins });
export const M1_R5_NEW_FILES = Object.freeze([...RECORD.newFiles]);
export const M1_R5_EDITS = Object.freeze(RECORD.edits);
export const M1_R5_SCOPE = Object.freeze(["src/analytics/dailyBuilder.ts"]);

const git = (repo, args, opts = {}) => spawnSync("git", ["-C", repo, ...args], { encoding: "utf8", maxBuffer: 1 << 28, ...opts });
/** The R5 tree: the rejected R4 candidate is a STRICT ancestor of HEAD (and this module — R5's own — is in the tree). */
export function isM1R5Tree(repo) {
  if (git(repo, ["merge-base", "--is-ancestor", M1_R5_PARENT, "HEAD"]).status !== 0) return false;
  return git(repo, ["rev-parse", "HEAD"]).stdout.trim() !== M1_R5_PARENT;
}
const parentBytes = (repo, f) => { const r = git(repo, ["cat-file", "blob", `${M1_R5_PARENT}:${f}`], { encoding: "buffer" }); if (r.status !== 0) throw new Error(`${M1_R5_PARENT}:${f}`); return r.stdout; };

/** Apply the recorded R5 edits of `file` to `bytes` (Buffer|string); each `from` must occur exactly once when it applies. */
export function applyR5Edits(file, bytes, edits = M1_R5_EDITS) {
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
/** Re-derive the R5 blob of `file` from the parent's (R4's) git objects. */
export function deriveR5(repo, file, edits = M1_R5_EDITS) { return applyR5Edits(file, parentBytes(repo, file), edits); }
