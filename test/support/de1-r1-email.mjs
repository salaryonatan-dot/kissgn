// DE1 R1 — the successor of the rejected Daily Email reliability candidate DE1 (LOCAL author candidate; pending independent
// Codex review). It answers the independent review's findings D1–D4 and is built on the DE1 commit itself (DE1R1_PARENT).
// Never derived from HEAD: every identity is a literal in de1-r1-email.json (recorded by the author tool gen-layer-record.py).
//
//   DE1R1_PARENT  the rejected DE1 candidate 9baf695c (DAILY_EMAIL_RELIABILITY_VERDICT: CHANGES_REQUIRED)
//   DE1R1_PINS    the literal blob of EVERY protected runtime file the R1 commit changes relative to DE1
//   DE1R1_EDITS   the exact { from, to } edits that turn each DE1 blob into its R1 pin (each `from` unique when it applies)
//
// Scope (DE1R1G-03): the same delivery files as DE1 — the scheduled snapshot route's delivery orchestration
// (api/daily-snapshot/run.ts; its authorization section stays byte-identical to P0), lib/emailDelivery.{js,d.ts} and
// lib/sendEmail.{js,d.ts}. No builder, presenter, financial, Rules, schedule, pin or page change. A pin here is a candidate
// pin and inherits no approval.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const RECORD = JSON.parse(readFileSync(new URL("./de1-r1-email.json", import.meta.url), "utf8"));
export const DE1R1_PARENT = RECORD.parent;
export const DE1R1_STATUS = "CANDIDATE (Daily Email reliability R1 remediation) — pending independent Codex review";
export const DE1R1_PINS = Object.freeze({ ...RECORD.pins });
export const DE1R1_NEW_FILES = Object.freeze([...RECORD.newFiles]);
export const DE1R1_EDITS = Object.freeze(RECORD.edits);
export const DE1R1_SCOPE = Object.freeze(["api/daily-snapshot/run.ts", "lib/emailDelivery.d.ts", "lib/emailDelivery.js", "lib/sendEmail.d.ts", "lib/sendEmail.js"]);

const git = (repo, args, opts = {}) => spawnSync("git", ["-C", repo, ...args], { encoding: "utf8", maxBuffer: 1 << 28, ...opts });
/** The R1 successor tree: the rejected DE1 candidate is a STRICT ancestor of HEAD. */
export function isDE1R1Tree(repo) {
  if (git(repo, ["merge-base", "--is-ancestor", DE1R1_PARENT, "HEAD"]).status !== 0) return false;
  return git(repo, ["rev-parse", "HEAD"]).stdout.trim() !== DE1R1_PARENT;
}
const parentBytes = (repo, f) => { const r = git(repo, ["cat-file", "blob", `${DE1R1_PARENT}:${f}`], { encoding: "buffer" }); if (r.status !== 0) throw new Error(`${DE1R1_PARENT}:${f}`); return r.stdout; };

/** Apply the recorded R1 edits of `file` to `bytes`; each `from` must occur exactly once when it applies. */
export function applyDE1R1Edits(file, bytes, edits = DE1R1_EDITS) {
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
export function deriveDE1R1(repo, file, edits = DE1R1_EDITS) { return applyDE1R1Edits(file, parentBytes(repo, file), edits); }
