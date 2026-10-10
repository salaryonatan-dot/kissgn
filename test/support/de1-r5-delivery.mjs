// DE1 R5 — the delivery owner-decisions successor of the Daily Email reliability R4 candidate (LOCAL author candidate;
// pending independent Codex review). It implements the owner decisions of 2026-10-09 (delivery-contract resolution):
//   G4   a registered business without a name is a FAILED row `business_name_unavailable` with an owner notice — preserved,
//        never given a placeholder name, never e-mailed until repaired; a business genuinely named "Unknown" is valid;
//   G10  manual POST refusals BEFORE any provider hand-off: 400 invalid identity / 404 not registered / 422 ambiguous or
//        malformed registry / 503 registry read or build failure, bounded bodies, never raw error text;
//   control characters: RTDB-forbidden control characters are refused in both identity slots before any Reference is built;
//   receiptPath: tenant slot = the approved isValidId (`:` permitted), business slot = the approved isRegistryBizId
//        (`:` refused); the path format is unchanged, no receipt moves.
// Built on the R4 commit itself (DE1R5_PARENT), which is still under independent review: this successor inherits that
// dependency and is not an approved integration base. Never derived from HEAD: every identity is a literal in
// de1-r5-delivery.json (recorded by the author tool gen-de1-r5-record.py in the R5 package).
//
//   DE1R5_PARENT  the R4 candidate cdb74e4d (independent review pending)
//   DE1R5_PINS    the literal blob of EVERY protected runtime file the R5 commit changes relative to R4
//   DE1R5_EDITS   the exact { from, to } edits that turn each R4 blob into its R5 pin (each `from` unique when it applies)
//
// Scope (DE1R5G-03): the delivery files only — lib/emailDelivery.js (identity rules, delivery target, notice), its
// declarations, and api/daily-snapshot/run.ts (the pre-send gate, the manual refusal table, the owner notice read). The SMTP
// wrapper, the builder, the presenter, financial code, authorization, Rules, schedule, pins and generated assets are
// byte-identical to R4. A pin here is a candidate pin and inherits no approval.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const RECORD = JSON.parse(readFileSync(new URL("./de1-r5-delivery.json", import.meta.url), "utf8"));
export const DE1R5_PARENT = RECORD.parent;
export const DE1R5_STATUS = "CANDIDATE (delivery owner decisions R5) — pending independent Codex review; parent R4 under review";
export const DE1R5_PINS = Object.freeze({ ...RECORD.pins });
export const DE1R5_NEW_FILES = Object.freeze([...RECORD.newFiles]);
export const DE1R5_EDITS = Object.freeze(RECORD.edits);
export const DE1R5_SCOPE = Object.freeze(["api/daily-snapshot/run.ts", "lib/emailDelivery.d.ts", "lib/emailDelivery.js"]);

const git = (repo, args, opts = {}) => spawnSync("git", ["-C", repo, ...args], { encoding: "utf8", maxBuffer: 1 << 28, ...opts });
/** The R5 successor tree: the R4 candidate is a STRICT ancestor of HEAD. */
export function isDE1R5Tree(repo) {
  if (git(repo, ["merge-base", "--is-ancestor", DE1R5_PARENT, "HEAD"]).status !== 0) return false;
  return git(repo, ["rev-parse", "HEAD"]).stdout.trim() !== DE1R5_PARENT;
}
const parentBytes = (repo, f) => { const r = git(repo, ["cat-file", "blob", `${DE1R5_PARENT}:${f}`], { encoding: "buffer" }); if (r.status !== 0) throw new Error(`${DE1R5_PARENT}:${f}`); return r.stdout; };

/** Apply the recorded R5 edits of `file` to `bytes`; each `from` must occur exactly once when it applies. */
export function applyDE1R5Edits(file, bytes, edits = DE1R5_EDITS) {
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
export function deriveDE1R5(repo, file, edits = DE1R5_EDITS) { return applyDE1R5Edits(file, parentBytes(repo, file), edits); }
