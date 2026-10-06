// M1 integration R2 remediation (LOCAL; pending independent Codex review) — the identity of the successor of the REJECTED
// M1 R1 candidate (M1_INTEGRATION_R1_VERDICT: CHANGES_REQUIRED). Never derived from HEAD: every identity below is a literal
// recorded in m1-r2-remediation.json by the author tool (probes/gen-r2-record.py in the R2 package).
//
//   M1_R2_PARENT   the rejected R1 candidate — the SOLE parent of the R2 commit. Its tree is held to the M1 ⊕ R1 pins, read
//                  from git objects (R1G-01/02 on an R2 tree).
//   M1_R2_PINS     the literal blob of EVERY protected file the R2 commit changes relative to its parent — the R1G protected
//                  set (api/, lib/, index.html, the financial-core roots …) plus the S0 server-reader roots (src/analytics/,
//                  src/repositories/, src/snapshot/ …). Every other protected file keeps its R1 / M1 / approved pin.
//   M1_R2_EDITS    the recorded, exact { from, to } edits that turn each changed parent blob into its R2 pin (each `from`
//                  occurring EXACTLY ONCE when it applies). A new file has no edits (its pin is its identity).
//
// Scope (R2G-03): review P1 — the page's business-list load / selection path (index.html); review P2 — the analytics
// builder's target identity (api/analytics/daily-builder.ts, src/analytics/dailyBuilder.ts); review P3 — the bare-null
// collision prose (lib/businessRegistry.js), which also gains resolveRegistryTarget (+ its declarations). A changed pin is a
// new candidate and inherits no approval.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const RECORD = JSON.parse(readFileSync(new URL("./m1-r2-remediation.json", import.meta.url), "utf8"));
export const M1_R2_PARENT = RECORD.parent;
export const M1_R2_STATUS = "CANDIDATE (M1 integration R2 remediation) — pending independent Codex review";
export const M1_R2_PINS = Object.freeze({ ...RECORD.pins });
export const M1_R2_NEW_FILES = Object.freeze([...RECORD.newFiles]);
export const M1_R2_EDITS = Object.freeze(RECORD.edits);
export const M1_R2_SCOPE = Object.freeze(["api/analytics/daily-builder.ts", "index.html", "lib/businessRegistry.d.ts", "lib/businessRegistry.js", "src/analytics/dailyBuilder.ts"]);
/** The R1G protected set widened by the S0 server-reader roots — the set R2's change is measured on. */
export const M1_R2_PROTECTED = /^(src\/(finance|metrics|policy|presenters|browser|finance-server|analytics|repositories|snapshot|agent|forecast)\/|fincore\/|api\/|lib\/|database\.rules\.json$|test\/support\/rules-authorized-delta\.mjs$|index\.html$|vercel\.json$|package(-lock)?\.json$)/;

const git = (repo, args, opts = {}) => spawnSync("git", ["-C", repo, ...args], { encoding: "utf8", maxBuffer: 1 << 28, ...opts });
/** The R2 tree: the rejected R1 candidate is a STRICT ancestor of HEAD (and this module — R2's own — is in the tree). */
export function isM1R2Tree(repo) {
  if (git(repo, ["merge-base", "--is-ancestor", M1_R2_PARENT, "HEAD"]).status !== 0) return false;
  return git(repo, ["rev-parse", "HEAD"]).stdout.trim() !== M1_R2_PARENT;
}
const parentBytes = (repo, f) => { const r = git(repo, ["cat-file", "blob", `${M1_R2_PARENT}:${f}`], { encoding: "buffer" }); if (r.status !== 0) throw new Error(`${M1_R2_PARENT}:${f}`); return r.stdout; };

/** Apply the recorded R2 edits of `file` to `bytes` (Buffer|string); each `from` must occur exactly once when it applies. */
export function applyR2Edits(file, bytes, edits = M1_R2_EDITS) {
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
/** Re-derive the R2 blob of `file` from the parent's (R1's) git objects. */
export function deriveR2(repo, file, edits = M1_R2_EDITS) { return applyR2Edits(file, parentBytes(repo, file), edits); }
