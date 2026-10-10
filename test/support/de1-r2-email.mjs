// DE1 R2 — the successor of the REJECTED Daily Email reliability R1 candidate (LOCAL author candidate; pending independent
// Codex review). It answers the independent R1 review's findings E1 (an uncertain send became an automatic retry) and E2 (an
// indeterminate provider result became a definitive refusal), and is built on the R1 commit itself (DE1R2_PARENT).
// Never derived from HEAD: every identity is a literal in de1-r2-email.json (recorded by the author tool gen-layer-record.py).
//
//   DE1R2_PARENT  the rejected R1 candidate 0576ced6 (DAILY_EMAIL_RELIABILITY_R1_VERDICT: CHANGES_REQUIRED)
//   DE1R2_PINS    the literal blob of EVERY protected runtime file the R2 commit changes relative to R1
//   DE1R2_EDITS   the exact { from, to } edits that turn each R1 blob into its R2 pin (each `from` unique when it applies)
//
// Scope (DE1R2G-03): the provider-outcome evidence of the receipt module only (lib/emailDelivery.js + its declarations).
// The route, the SMTP wrapper, the builder, the presenter, financial code, authorization, Rules, schedule, pins and generated
// assets are byte-identical to R1. A pin here is a candidate pin and inherits no approval.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const RECORD = JSON.parse(readFileSync(new URL("./de1-r2-email.json", import.meta.url), "utf8"));
export const DE1R2_PARENT = RECORD.parent;
export const DE1R2_STATUS = "CANDIDATE (Daily Email reliability R2 remediation) — pending independent Codex review";
export const DE1R2_PINS = Object.freeze({ ...RECORD.pins });
export const DE1R2_NEW_FILES = Object.freeze([...RECORD.newFiles]);
export const DE1R2_EDITS = Object.freeze(RECORD.edits);
export const DE1R2_SCOPE = Object.freeze(["lib/emailDelivery.d.ts", "lib/emailDelivery.js"]);

const git = (repo, args, opts = {}) => spawnSync("git", ["-C", repo, ...args], { encoding: "utf8", maxBuffer: 1 << 28, ...opts });
/** The R2 successor tree: the rejected R1 candidate is a STRICT ancestor of HEAD. */
export function isDE1R2Tree(repo) {
  if (git(repo, ["merge-base", "--is-ancestor", DE1R2_PARENT, "HEAD"]).status !== 0) return false;
  return git(repo, ["rev-parse", "HEAD"]).stdout.trim() !== DE1R2_PARENT;
}
const parentBytes = (repo, f) => { const r = git(repo, ["cat-file", "blob", `${DE1R2_PARENT}:${f}`], { encoding: "buffer" }); if (r.status !== 0) throw new Error(`${DE1R2_PARENT}:${f}`); return r.stdout; };

/** Apply the recorded R2 edits of `file` to `bytes`; each `from` must occur exactly once when it applies. */
export function applyDE1R2Edits(file, bytes, edits = DE1R2_EDITS) {
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
export function deriveDE1R2(repo, file, edits = DE1R2_EDITS) { return applyDE1R2Edits(file, parentBytes(repo, file), edits); }
