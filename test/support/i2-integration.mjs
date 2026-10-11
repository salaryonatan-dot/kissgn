// Agent/Daily integration I2 — the page layer of the successor of the rejected I1 candidate (LOCAL author candidate; pending
// independent Codex review and the page owner's acceptance). Built on I1 (968155d6, its SOLE parent), it answers the
// independent I1 review (2026-10-10, CHANGES_REQUIRED):
//   I1-R-03  index.html: the entries hydration function `__entriesHydrate` is DEFINED BEFORE the entries listener is
//            registered. Firebase delivers an already-cached value synchronously inside onValue(); with the I1 order the
//            listener callback ran while the later `const` was still in its temporal dead zone (ReferenceError — the
//            integrated rendered UN-08 crash). The function body is unchanged; the listener body is unchanged; only their order
//            (+ a two-line comment) changes — recorded as ONE exact { from, to } edit of the I1 page bytes.
//   I1-R-01  test/historical/.deps (a tracked absolute symbolic link to an author scratch directory) is removed and `.deps`
//            itself is ignored; the pinned historical-page dependencies are installed by test/historical/install-deps.sh.
//            Not a protected runtime file; held by I2G-04.
// Never derived from HEAD: every identity is a literal in i2-integration.json (author tool gen-i2-record.py in the I2 package).
// A pin here is a candidate pin and inherits no approval.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const RECORD = JSON.parse(readFileSync(new URL("./i2-integration.json", import.meta.url), "utf8"));
export const I2_STATUS = "CANDIDATE (Agent/Daily integration I2) — pending independent Codex review; page-layer transition PROPOSED for the page owner";
export const I2_PARENT = RECORD.parent;
export const I2_PINS = Object.freeze({ ...RECORD.pins });
export const I2_NEW_FILES = Object.freeze([...RECORD.newFiles]);
export const I2_EDITS = Object.freeze(RECORD.edits);
export const I2_SCOPE = Object.freeze(["index.html"]);

const git = (repo, args, opts = {}) => spawnSync("git", ["-C", repo, ...args], { encoding: "utf8", maxBuffer: 1 << 28, ...opts });
/** The I2 tree: the I1 candidate is a STRICT ancestor of HEAD. */
export function isI2Tree(repo) {
  if (git(repo, ["merge-base", "--is-ancestor", I2_PARENT, "HEAD"]).status !== 0) return false;
  return git(repo, ["rev-parse", "HEAD"]).stdout.trim() !== I2_PARENT;
}
const parentBytes = (repo, f) => { const r = git(repo, ["cat-file", "blob", `${I2_PARENT}:${f}`], { encoding: "buffer" }); if (r.status !== 0) throw new Error(`${I2_PARENT}:${f}`); return r.stdout; };

/** Apply the recorded I2 edits of `file` to `bytes`; each `from` must occur exactly once when it applies. */
export function applyI2Edits(file, bytes, edits = I2_EDITS) {
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
export function deriveI2(repo, file, edits = I2_EDITS) { return applyI2Edits(file, parentBytes(repo, file), edits); }
