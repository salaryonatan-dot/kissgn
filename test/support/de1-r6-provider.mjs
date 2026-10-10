// DE1 R6 — the provider-structure successor of the delivery owner-decisions R5 candidate (LOCAL author candidate; pending
// independent Codex review). It answers the independent Email R4 review's blocking finding E4-01: a resolved provider result
// of the wrong top-level TYPE (an array decorated with accepted / rejected / response / envelope) passed
// `typeof info === "object"` and was recorded as a final acceptance. R6 validates the STRUCTURE of the whole resolved result
// (a plain record; a plain-record envelope; record-shaped refusal details) before any field is read as evidence; everything
// else of the R4 evidence rules, the R5 identity rules, the delivery target and the notice is unchanged.
// Built on the R5 commit itself (DE1R6_PARENT), which is itself under independent review (and whose parent R4 was rejected
// for this very finding): this successor inherits both dependencies and is not an approved integration base. Never derived
// from HEAD: every identity is a literal in de1-r6-provider.json (recorded by the author tool gen-de1-r6-record.py in the
// R6 package).
//
//   DE1R6_PARENT  the R5 candidate 054fd873 (independent review pending)
//   DE1R6_PINS    the literal blob of EVERY protected runtime file the R6 commit changes relative to R5
//   DE1R6_EDITS   the exact { from, to } edits that turn each R5 blob into its R6 pin (each `from` unique when it applies)
//
// Scope (DE1R6G-03): the resolved-result classifier of the receipt module only (lib/emailDelivery.js classifyTransportInfo).
// The route, the declarations, the SMTP wrapper, the builder, the presenter, financial code, authorization, Rules, schedule,
// pins and generated assets are byte-identical to R5. A pin here is a candidate pin and inherits no approval.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const RECORD = JSON.parse(readFileSync(new URL("./de1-r6-provider.json", import.meta.url), "utf8"));
export const DE1R6_PARENT = RECORD.parent;
export const DE1R6_STATUS = "CANDIDATE (delivery provider structure R6) — pending independent Codex review; parent R5 under review";
export const DE1R6_PINS = Object.freeze({ ...RECORD.pins });
export const DE1R6_NEW_FILES = Object.freeze([...RECORD.newFiles]);
export const DE1R6_EDITS = Object.freeze(RECORD.edits);
export const DE1R6_SCOPE = Object.freeze(["lib/emailDelivery.js"]);

const git = (repo, args, opts = {}) => spawnSync("git", ["-C", repo, ...args], { encoding: "utf8", maxBuffer: 1 << 28, ...opts });
/** The R6 successor tree: the R5 candidate is a STRICT ancestor of HEAD. */
export function isDE1R6Tree(repo) {
  if (git(repo, ["merge-base", "--is-ancestor", DE1R6_PARENT, "HEAD"]).status !== 0) return false;
  return git(repo, ["rev-parse", "HEAD"]).stdout.trim() !== DE1R6_PARENT;
}
const parentBytes = (repo, f) => { const r = git(repo, ["cat-file", "blob", `${DE1R6_PARENT}:${f}`], { encoding: "buffer" }); if (r.status !== 0) throw new Error(`${DE1R6_PARENT}:${f}`); return r.stdout; };

/** Apply the recorded R6 edits of `file` to `bytes`; each `from` must occur exactly once when it applies. */
export function applyDE1R6Edits(file, bytes, edits = DE1R6_EDITS) {
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
export function deriveDE1R6(repo, file, edits = DE1R6_EDITS) { return applyDE1R6Edits(file, parentBytes(repo, file), edits); }
