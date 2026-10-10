// DE1 R7 — the notice-integrity successor of the delivery provider-structure R6 candidate (LOCAL author candidate; pending
// independent Codex review). It answers the independent review of the owner-decisions R5 candidate (2026-10-09,
// DELIVERY_OWNER_DECISIONS_VERDICT: CHANGES_REQUIRED): OD-01 — the manual route classified a builder SyntaxError as a
// malformed registry by exception CLASS (a SyntaxError raised while the snapshot data is read, with a valid registry, was 422
// registry_unreadable); OD-02 — a failed notice read was answered with a synthesized `runs: 0` notice and HTTP 200, and a
// failed notice removal with HTTP 200 / notice: null while the notice stayed stored. R7 classifies a builder throw by the
// code the builder itself attributed (contract §3) or else snapshot_build_failed, and reports the business / name state, the
// notice STORE state and the clear state distinctly (503 `status: "unavailable"` when the store cannot be read or cleared;
// nothing manufactured; "cleared" only after an acknowledged removal). Everything of R6 (the resolved-result structure) and of
// R5 (identity rules, receiptPath, delivery target, notice recording, authorization) is unchanged.
// Built on the R6 commit itself (DE1R7_PARENT), which is itself under independent review: this successor inherits that
// dependency and is not an approved integration base. Never derived from HEAD: every identity is a literal in
// de1-r7-notice.json (recorded by the author tool gen-de1-r7-record.py in the R7 package).
//
//   DE1R7_PARENT  the R6 candidate ee52b1de (independent review pending)
//   DE1R7_PINS    the literal blob of EVERY protected runtime file the R7 commit changes relative to R6
//   DE1R7_EDITS   the exact { from, to } edits that turn each R6 blob into its R7 pin (each `from` unique when it applies)
//
// Scope (DE1R7G-03): the manual route (api/daily-snapshot/run.ts: builderRefusal and the action: "notice" branch), the receipt
// module (lib/emailDelivery.js: readDeliveryNoticeState added, nothing else) and its declarations. The SMTP wrapper, the
// builder, the presenter, financial code, authorization, Rules, schedule, pins and generated assets are byte-identical to R6.
// A pin here is a candidate pin and inherits no approval.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const RECORD = JSON.parse(readFileSync(new URL("./de1-r7-notice.json", import.meta.url), "utf8"));
export const DE1R7_PARENT = RECORD.parent;
export const DE1R7_STATUS = "CANDIDATE (delivery notice integrity R7) — pending independent Codex review; parent R6 under review; grandparent R5 CHANGES_REQUIRED (answered here)";
export const DE1R7_PINS = Object.freeze({ ...RECORD.pins });
export const DE1R7_NEW_FILES = Object.freeze([...RECORD.newFiles]);
export const DE1R7_EDITS = Object.freeze(RECORD.edits);
export const DE1R7_SCOPE = Object.freeze(["api/daily-snapshot/run.ts", "lib/emailDelivery.d.ts", "lib/emailDelivery.js"]);

const git = (repo, args, opts = {}) => spawnSync("git", ["-C", repo, ...args], { encoding: "utf8", maxBuffer: 1 << 28, ...opts });
/** The R7 successor tree: the R6 candidate is a STRICT ancestor of HEAD. */
export function isDE1R7Tree(repo) {
  if (git(repo, ["merge-base", "--is-ancestor", DE1R7_PARENT, "HEAD"]).status !== 0) return false;
  return git(repo, ["rev-parse", "HEAD"]).stdout.trim() !== DE1R7_PARENT;
}
const parentBytes = (repo, f) => { const r = git(repo, ["cat-file", "blob", `${DE1R7_PARENT}:${f}`], { encoding: "buffer" }); if (r.status !== 0) throw new Error(`${DE1R7_PARENT}:${f}`); return r.stdout; };

/** Apply the recorded R7 edits of `file` to `bytes`; each `from` must occur exactly once when it applies. */
export function applyDE1R7Edits(file, bytes, edits = DE1R7_EDITS) {
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
export function deriveDE1R7(repo, file, edits = DE1R7_EDITS) { return applyDE1R7Edits(file, parentBytes(repo, file), edits); }
