// M1 integration R1 remediation (LOCAL; pending independent Codex review) — the identity of the successor of the REJECTED
// M1 candidate. Never derived from HEAD: every identity below is a literal recorded in m1-r1-remediation.json.
//
//   M1_R1_PARENT   the rejected M1 integration candidate (M1_INTEGRATION_VERDICT: CHANGES_REQUIRED). It is the SOLE parent
//                  of the R1 commit; its tree is held to the M1 pins (M1G-01/02 read it from git objects).
//   M1_R1_PINS     the literal blob of EVERY protected runtime file the R1 commit changes relative to the parent. Every
//                  other protected file keeps its M1 pin.
//   M1_R1_EDITS    the recorded, exact edits that turn each changed parent blob into its R1 pin: an ordered list of
//                  { from, to } replacements, each `from` occurring EXACTLY ONCE in the parent bytes. A new file has no
//                  edits (its pin is its identity). R1G-02 re-derives every pin from the parent's git objects.
//
// A changed pin is a new candidate and inherits no approval.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { M1_PINS } from "./m1-integration-pin.mjs";
import { m1PageVerdict } from "./m1-index-scope.mjs";

const RECORD = JSON.parse(readFileSync(new URL("./m1-r1-remediation.json", import.meta.url), "utf8"));
export const M1_R1_PARENT = RECORD.parent;
export const M1_R1_STATUS = "CANDIDATE (M1 integration R1 remediation) — pending independent Codex review";
export const M1_R1_PINS = Object.freeze({ ...RECORD.pins });
export const M1_R1_NEW_FILES = Object.freeze([...RECORD.newFiles]);
export const M1_R1_EDITS = Object.freeze(RECORD.edits);

const git = (repo, args, opts = {}) => spawnSync("git", ["-C", repo, ...args], { encoding: "utf8", maxBuffer: 1 << 28, ...opts });
/** The R1 successor tree: the rejected candidate is a STRICT ancestor of HEAD. */
export function isM1R1Tree(repo) {
  if (git(repo, ["merge-base", "--is-ancestor", M1_R1_PARENT, "HEAD"]).status !== 0) return false;
  return git(repo, ["rev-parse", "HEAD"]).stdout.trim() !== M1_R1_PARENT;
}
/** The pins that hold the tree under test: the M1 pins, with the R1 pins (and new files) overlaid on an R1 tree. */
export function m1EffectivePins(repo) {
  return isM1R1Tree(repo) ? { ...M1_PINS.blobs, ...M1_R1_PINS } : { ...M1_PINS.blobs };
}
export const gitBlobId = (buf) => { const h = createHash("sha1"); h.update(`blob ${buf.length}\0`); h.update(buf); return h.digest("hex"); };
const parentBytes = (repo, f) => { const r = git(repo, ["cat-file", "blob", `${M1_R1_PARENT}:${f}`], { encoding: "buffer" }); if (r.status !== 0) throw new Error(`${M1_R1_PARENT}:${f}`); return r.stdout; };

/**
 * Apply the recorded R1 edits of `file` to `bytes` (Buffer|string). Every `from` must occur exactly once at application time.
 * Returns { ok:true, bytes } or { ok:false, reason, detail }.
 */
export function applyR1Edits(file, bytes, edits = M1_R1_EDITS) {
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
/** Re-derive the R1 blob of `file` from the parent's git objects. */
export function deriveR1(repo, file, edits = M1_R1_EDITS) {
  return applyR1Edits(file, parentBytes(repo, file), edits);
}

/**
 * The page contract of the tree under test. On a plain M1 tree: the M1 contract (m1PageVerdict). On an R1 tree: the parent page
 * must satisfy the M1 contract (it is the recorded derivation, with both lines' invariants), and the candidate bytes must be
 * EXACTLY that page with the recorded R1 page edits applied — nothing else.
 */
export function m1EffectivePageVerdict(repo, candidateBytes, edits = M1_R1_EDITS) {
  if (!isM1R1Tree(repo)) return m1PageVerdict(repo, candidateBytes);
  const parent = parentBytes(repo, "index.html");
  const base = m1PageVerdict(repo, parent);
  if (!base.ok) return { ok: false, reason: "r1_parent_page_not_m1", detail: base };
  const d = applyR1Edits("index.html", parent, edits);
  if (!d.ok) return d;
  const B = Buffer.isBuffer(candidateBytes) ? candidateBytes : Buffer.from(String(candidateBytes), "utf8");
  if (!d.bytes.equals(B)) return { ok: false, reason: "not_the_recorded_derivation" };
  return { ok: true };
}
