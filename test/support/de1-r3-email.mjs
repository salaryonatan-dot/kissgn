// DE1 R3 — the successor of the REJECTED Daily Email reliability R2 candidate (LOCAL author candidate; pending independent
// Codex review). It answers the independent R2 review's blocking finding (E2 continuation: a contradictory RESOLVED provider
// result — the recipient rejected beside the 250 end-of-DATA reply — was recorded as a definite rejection), and is built on the
// R2 commit itself (DE1R3_PARENT). Never derived from HEAD: every identity is a literal in de1-r3-email.json (recorded by the
// author tool gen-de1-r3-record.py in the R3 package).
//
//   DE1R3_PARENT  the rejected R2 candidate 3a66397c (independent review: CHANGES_REQUIRED)
//   DE1R3_PINS    the literal blob of EVERY protected runtime file the R3 commit changes relative to R2
//   DE1R3_EDITS   the exact { from, to } edits that turn each R2 blob into its R3 pin (each `from` unique when it applies)
//
// Scope (DE1R3G-03): the resolved-result classifier of the receipt module only (lib/emailDelivery.js classifyTransportInfo).
// The declarations, the route, the SMTP wrapper, the builder, the presenter, financial code, authorization, Rules, schedule,
// pins and generated assets are byte-identical to R2. A pin here is a candidate pin and inherits no approval.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const RECORD = JSON.parse(readFileSync(new URL("./de1-r3-email.json", import.meta.url), "utf8"));
export const DE1R3_PARENT = RECORD.parent;
export const DE1R3_STATUS = "CANDIDATE (Daily Email reliability R3 remediation) — pending independent Codex review";
export const DE1R3_PINS = Object.freeze({ ...RECORD.pins });
export const DE1R3_NEW_FILES = Object.freeze([...RECORD.newFiles]);
export const DE1R3_EDITS = Object.freeze(RECORD.edits);
export const DE1R3_SCOPE = Object.freeze(["lib/emailDelivery.js"]);

const git = (repo, args, opts = {}) => spawnSync("git", ["-C", repo, ...args], { encoding: "utf8", maxBuffer: 1 << 28, ...opts });
/** The R3 successor tree: the rejected R2 candidate is a STRICT ancestor of HEAD. */
export function isDE1R3Tree(repo) {
  if (git(repo, ["merge-base", "--is-ancestor", DE1R3_PARENT, "HEAD"]).status !== 0) return false;
  return git(repo, ["rev-parse", "HEAD"]).stdout.trim() !== DE1R3_PARENT;
}
const parentBytes = (repo, f) => { const r = git(repo, ["cat-file", "blob", `${DE1R3_PARENT}:${f}`], { encoding: "buffer" }); if (r.status !== 0) throw new Error(`${DE1R3_PARENT}:${f}`); return r.stdout; };

/** Apply the recorded R3 edits of `file` to `bytes`; each `from` must occur exactly once when it applies. */
export function applyDE1R3Edits(file, bytes, edits = DE1R3_EDITS) {
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
export function deriveDE1R3(repo, file, edits = DE1R3_EDITS) { return applyDE1R3Edits(file, parentBytes(repo, file), edits); }
