// M1 integration R3 remediation (LOCAL; pending independent Codex review) — the identity of the successor of the REJECTED
// M1 R2 candidate (M1_INTEGRATION_R2_VERDICT: CHANGES_REQUIRED). Never derived from HEAD: every identity below is a literal
// recorded in m1-r3-remediation.json by the author tool (probes/gen-r3-record.py in the R3 package).
//
//   M1_R3_PARENT   the rejected R2 candidate — the SOLE parent of the R3 commit. Its tree is held to the M1 ⊕ R1 ⊕ R2 pins,
//                  read from git objects (R1G / R2G on an R3 tree).
//   M1_R3_PINS     the literal blob of EVERY protected file the R3 commit changes relative to its parent (the R2 protected
//                  set: the R1G set widened by the S0 server-reader roots). Every other protected file keeps its R2 / R1 / M1 /
//                  approved pin.
//   M1_R3_EDITS    the recorded, exact { from, to } edits that turn each changed parent blob into its R3 pin (each `from`
//                  occurring EXACTLY ONCE when it applies).
//
// Scope (R3G-03): review R2-01 / R2-03 — the page judges the STORED registry node (raw-node read, node view, setup
// eligibility, the compare-and-swap first-business setup write) in index.html; review R2-02 — the nightly analytics run
// decodes each tenant's stored node by the shared rule, builds only exact registered targets, re-checks the identity at build
// time and reports every refused registry / target / discovery failure (src/analytics/dailyBuilder.ts). The shared module,
// the endpoint, Rules, configuration, Core, P1 and e-mail are unchanged. A changed pin is a new candidate and inherits no
// approval.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const RECORD = JSON.parse(readFileSync(new URL("./m1-r3-remediation.json", import.meta.url), "utf8"));
export const M1_R3_PARENT = RECORD.parent;
export const M1_R3_STATUS = "CANDIDATE (M1 integration R3 remediation) — pending independent Codex review";
export const M1_R3_PINS = Object.freeze({ ...RECORD.pins });
export const M1_R3_NEW_FILES = Object.freeze([...RECORD.newFiles]);
export const M1_R3_EDITS = Object.freeze(RECORD.edits);
export const M1_R3_SCOPE = Object.freeze(["index.html", "src/analytics/dailyBuilder.ts"]);

const git = (repo, args, opts = {}) => spawnSync("git", ["-C", repo, ...args], { encoding: "utf8", maxBuffer: 1 << 28, ...opts });
/** The R3 tree: the rejected R2 candidate is a STRICT ancestor of HEAD (and this module — R3's own — is in the tree). */
export function isM1R3Tree(repo) {
  if (git(repo, ["merge-base", "--is-ancestor", M1_R3_PARENT, "HEAD"]).status !== 0) return false;
  return git(repo, ["rev-parse", "HEAD"]).stdout.trim() !== M1_R3_PARENT;
}
const parentBytes = (repo, f) => { const r = git(repo, ["cat-file", "blob", `${M1_R3_PARENT}:${f}`], { encoding: "buffer" }); if (r.status !== 0) throw new Error(`${M1_R3_PARENT}:${f}`); return r.stdout; };

/** Apply the recorded R3 edits of `file` to `bytes` (Buffer|string); each `from` must occur exactly once when it applies. */
export function applyR3Edits(file, bytes, edits = M1_R3_EDITS) {
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
/** Re-derive the R3 blob of `file` from the parent's (R2's) git objects. */
export function deriveR3(repo, file, edits = M1_R3_EDITS) { return applyR3Edits(file, parentBytes(repo, file), edits); }
