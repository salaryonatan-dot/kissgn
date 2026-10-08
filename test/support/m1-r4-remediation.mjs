// M1 integration R4 remediation (LOCAL; pending independent Codex review) — the identity of the successor of the REJECTED
// M1 R3 candidate (M1_INTEGRATION_R3_VERDICT: CHANGES_REQUIRED). Never derived from HEAD: every identity below is a literal
// recorded in m1-r4-remediation.json by the author tool (probes/gen-r4-record.py in the R4 package).
//
//   M1_R4_PARENT   the rejected R3 candidate — the SOLE parent of the R4 commit. Its tree is held to the M1 ⊕ R1 ⊕ R2 ⊕ R3
//                  pins, read from git objects (R3G on an R4 tree).
//   M1_R4_PINS     the literal blob of EVERY protected file the R4 commit changes relative to its parent. Every other
//                  protected file keeps its R3 / R2 / R1 / M1 / approved pin.
//   M1_R4_EDITS    the recorded, exact { from, to } edits that turn each changed parent blob into its R4 pin (each `from`
//                  occurring EXACTLY ONCE when it applies).
//
// Scope (R4G-03): review A1 — one exact request / discovery identity for the analytics entrypoints (api/analytics/
// daily-builder.ts, src/analytics/dailyBuilder.ts); review A2 — the nightly run's outcome, HTTP status and durable run record,
// and the insights-persistence accounting (the same two files); review S1 — the page's add-only setup write and fresh id
// (index.html) and the collision-safe client creation (api/admin.js create-client); review S2 — the atomic, data-aware
// bootstrap-self claim and its resume (api/admin.js) and the page's bootstrap gate / unknown-outcome re-read (index.html).
// The shared registry module, Rules, configuration, Core, P1 supplier credits and e-mail are unchanged. A changed pin is a new
// candidate and inherits no approval.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const RECORD = JSON.parse(readFileSync(new URL("./m1-r4-remediation.json", import.meta.url), "utf8"));
export const M1_R4_PARENT = RECORD.parent;
export const M1_R4_STATUS = "CANDIDATE (M1 integration R4 remediation) — pending independent Codex review";
export const M1_R4_PINS = Object.freeze({ ...RECORD.pins });
export const M1_R4_NEW_FILES = Object.freeze([...RECORD.newFiles]);
export const M1_R4_EDITS = Object.freeze(RECORD.edits);
export const M1_R4_SCOPE = Object.freeze(["api/admin.js", "api/analytics/daily-builder.ts", "index.html", "src/analytics/dailyBuilder.ts"]);

const git = (repo, args, opts = {}) => spawnSync("git", ["-C", repo, ...args], { encoding: "utf8", maxBuffer: 1 << 28, ...opts });
/** The R4 tree: the rejected R3 candidate is a STRICT ancestor of HEAD (and this module — R4's own — is in the tree). */
export function isM1R4Tree(repo) {
  if (git(repo, ["merge-base", "--is-ancestor", M1_R4_PARENT, "HEAD"]).status !== 0) return false;
  return git(repo, ["rev-parse", "HEAD"]).stdout.trim() !== M1_R4_PARENT;
}
const parentBytes = (repo, f) => { const r = git(repo, ["cat-file", "blob", `${M1_R4_PARENT}:${f}`], { encoding: "buffer" }); if (r.status !== 0) throw new Error(`${M1_R4_PARENT}:${f}`); return r.stdout; };

/** Apply the recorded R4 edits of `file` to `bytes` (Buffer|string); each `from` must occur exactly once when it applies. */
export function applyR4Edits(file, bytes, edits = M1_R4_EDITS) {
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
/** Re-derive the R4 blob of `file` from the parent's (R3's) git objects. */
export function deriveR4(repo, file, edits = M1_R4_EDITS) { return applyR4Edits(file, parentBytes(repo, file), edits); }
