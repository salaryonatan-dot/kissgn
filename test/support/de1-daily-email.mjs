// DE1 — daily e-mail delivery reliability layer (LOCAL checkpoint; pending independent review). Never derived from HEAD: every
// identity is a literal in de1-daily-email.json (recorded by the author tool gen-layer-record.py).
//
//   DE1_PARENT   the M1 integration R1 author candidate the layer is built on (itself pending independent review)
//   DE1_PINS     the literal blob of EVERY protected runtime file the DE1 commit changes relative to its parent
//   DE1_EDITS    the exact { from, to } edits that turn each changed parent blob into its DE1 pin (each `from` unique when it
//                applies); a new file has no edits (its pin is its identity)
//
// Scope (DE1G-03): the scheduled snapshot route's delivery orchestration (api/daily-snapshot/run.ts), the SMTP transport
// wrapper (lib/sendEmail.js + .d.ts) and the new receipt module (lib/emailDelivery.js + .d.ts). A changed pin is a new
// candidate and inherits no approval.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
// DE1 R1 (the successor answering the DE1 review, built on the DE1 commit): its pins overlay the DE1 pins on an R1 tree.
import { isDE1R1Tree, DE1R1_PINS } from "./de1-r1-email.mjs";
// DE1 R2 (the successor answering the R1 review, built on the R1 commit): its pins overlay the R1 pins on an R2 tree.
import { isDE1R2Tree, DE1R2_PINS } from "./de1-r2-email.mjs";
// DE1 R3 (the successor answering the R2 review, built on the R2 commit): its pin overlays the R2 pins on an R3 tree.
import { isDE1R3Tree, DE1R3_PINS } from "./de1-r3-email.mjs";
// DE1 R4 (the successor answering the R3 review, built on the R3 commit): its pin overlays the R3 pins on an R4 tree.
import { isDE1R4Tree, DE1R4_PINS } from "./de1-r4-email.mjs";

const RECORD = JSON.parse(readFileSync(new URL("./de1-daily-email.json", import.meta.url), "utf8"));
export const DE1_PARENT = RECORD.parent;
export const DE1_STATUS = "CHECKPOINT (daily e-mail delivery reliability) — pending independent review";
export const DE1_PINS = Object.freeze({ ...RECORD.pins });
export const DE1_NEW_FILES = Object.freeze([...RECORD.newFiles]);
export const DE1_EDITS = Object.freeze(RECORD.edits);
export const DE1_SCOPE = Object.freeze(["api/daily-snapshot/run.ts", "lib/emailDelivery.d.ts", "lib/emailDelivery.js", "lib/sendEmail.d.ts", "lib/sendEmail.js"]);

const git = (repo, args, opts = {}) => spawnSync("git", ["-C", repo, ...args], { encoding: "utf8", maxBuffer: 1 << 28, ...opts });
/** The DE1 tree: its parent (the R1 candidate) is a STRICT ancestor of HEAD. */
export function isDE1Tree(repo) {
  if (git(repo, ["merge-base", "--is-ancestor", DE1_PARENT, "HEAD"]).status !== 0) return false;
  return git(repo, ["rev-parse", "HEAD"]).stdout.trim() !== DE1_PARENT;
}
const parentBytes = (repo, f) => { const r = git(repo, ["cat-file", "blob", `${DE1_PARENT}:${f}`], { encoding: "buffer" }); if (r.status !== 0) throw new Error(`${DE1_PARENT}:${f}`); return r.stdout; };

/** Apply the recorded DE1 edits of `file` to `bytes`; each `from` must occur exactly once when it applies. */
export function applyDE1Edits(file, bytes, edits = DE1_EDITS) {
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
export function deriveDE1(repo, file, edits = DE1_EDITS) { return applyDE1Edits(file, parentBytes(repo, file), edits); }
/** The delivery pins that hold the tree under test: DE1's, with the DE1 R1 successor's overlaid on an R1 tree and the R2
 *  successor's overlaid on an R2 tree (an R2 tree is always an R1 tree). */
export function de1EffectivePins(repo) {
  if (!isDE1R1Tree(repo)) return { ...DE1_PINS };
  if (isDE1R4Tree(repo)) return { ...DE1_PINS, ...DE1R1_PINS, ...DE1R2_PINS, ...DE1R3_PINS, ...DE1R4_PINS };
  if (isDE1R3Tree(repo)) return { ...DE1_PINS, ...DE1R1_PINS, ...DE1R2_PINS, ...DE1R3_PINS };
  return isDE1R2Tree(repo) ? { ...DE1_PINS, ...DE1R1_PINS, ...DE1R2_PINS } : { ...DE1_PINS, ...DE1R1_PINS };
}
/** The pins of the R3 commit itself (DE1 ⊕ R1 ⊕ R2 ⊕ R3), whatever later layer is checked out. */
export function de1R3Pins() { return { ...DE1_PINS, ...DE1R1_PINS, ...DE1R2_PINS, ...DE1R3_PINS }; }
/** The pins of the R2 commit itself (DE1 ⊕ R1 ⊕ R2), whatever later layer is checked out. */
export function de1R2Pins() { return { ...DE1_PINS, ...DE1R1_PINS, ...DE1R2_PINS }; }
/** The pins of the R1 commit itself (DE1 ⊕ R1), whatever later layer is checked out. */
export function de1R1Pins() { return { ...DE1_PINS, ...DE1R1_PINS }; }
