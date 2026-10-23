// Daily e-mail subscription successor (owner requirement 2026-10-22; author candidate, pending independent review): the page
// layer for m1EffectivePageVerdict. On a tree whose sole-parent chain carries the IV-T1 head (6786b803) as a STRICT ancestor
// and whose holder record carries `dailySubscriptionSuccessor`, the candidate page is the I3-derived page + exactly the
// recorded { from, to } index.html edits of that record (each `from` occurring exactly once when it applies). The record is
// the holder-pinned test/support/m1-a1-inspection.json of THIS checkout; it is held by verifyA1Head / DSG-01..06.
import { spawnSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";

export const DS_LAYER_PARENT = "6786b80377252d77d6bc2b7b9defa2c7d40dc434";
const RECORD = JSON.parse(readFileSync(new URL("./m1-a1-inspection.json", import.meta.url), "utf8"));
const LAYER = RECORD.dailySubscriptionSuccessor || null;
// C1 (correction of the subscription candidate, sole parent 51f00aa9): its recorded index.html edits apply to the DS page, in
// order, after the DS edits (each list is an exact derivation of its own parent's bytes).
const CORRECTION = RECORD.dailySubscriptionCorrection || null;
const pageEdits = (layer) => (layer && layer.edits && Array.isArray(layer.edits["index.html"]) ? layer.edits["index.html"] : []);
export const DS_PAGE_EDITS = Object.freeze([...pageEdits(LAYER), ...(CORRECTION && CORRECTION.parent === "51f00aa92355d9aee1b6dcfa27f3d74e4dd16bdd" ? pageEdits(CORRECTION) : [])]);

const git = (repo, args) => spawnSync("git", ["-C", repo, ...args], { encoding: "utf8", maxBuffer: 1 << 28 });
/** The DS tree: the record carries the layer for the literal parent, and that parent is a STRICT ancestor of HEAD. */
export function isDailySubscriptionTree(repo) {
  if (!LAYER || LAYER.parent !== DS_LAYER_PARENT) return false;
  if (git(repo, ["merge-base", "--is-ancestor", DS_LAYER_PARENT, "HEAD"]).status !== 0) return false;
  return git(repo, ["rev-parse", "HEAD"]).stdout.trim() !== DS_LAYER_PARENT;
}
/** Apply the recorded DS page edits to `bytes`; each `from` must occur exactly once when it applies. */
export function applyDailySubscriptionPageEdits(bytes, edits = DS_PAGE_EDITS) {
  if (!Array.isArray(edits) || edits.length === 0) return { ok: false, reason: "no_recorded_edits", detail: "index.html" };
  let s = Buffer.isBuffer(bytes) ? bytes.toString("utf8") : String(bytes);
  for (const [k, e] of edits.entries()) {
    if (typeof e.from !== "string" || typeof e.to !== "string" || e.from === "") return { ok: false, reason: "edit_shape", detail: `index.html#${k}` };
    if (s.split(e.from).length !== 2) return { ok: false, reason: "edit_anchor_not_unique", detail: `index.html#${k}` };
    s = s.replace(e.from, () => e.to);
  }
  return { ok: true, bytes: Buffer.from(s, "utf8") };
}

const blobOf = (bytes) => createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
/** True when `bytes` are the page of the CURRENT tree in any state (committed, staged or checked out). */
export function isCurrentTreePage(repo, bytes) {
  const B = Buffer.isBuffer(bytes) ? bytes : Buffer.from(String(bytes), "utf8"), id = blobOf(B);
  const states = [git(repo, ["rev-parse", "HEAD:index.html"]).stdout.trim(), git(repo, ["rev-parse", ":index.html"]).stdout.trim()];
  if (existsSync(join(repo, "index.html"))) states.push(blobOf(readFileSync(join(repo, "index.html"))));
  return states.includes(id);
}
/** The DS overlay of the M1 effective pins: the page pin of the holder record of `root` (empty off the DS tree). */
export function dailySubscriptionPins(root) {
  if (!isDailySubscriptionTree(root)) return {};
  const record = JSON.parse(readFileSync(join(root, "test/support/m1-a1-inspection.json"), "utf8"));
  const pin = record.treePins && record.treePins["index.html"];
  if (!record.dailySubscriptionSuccessor || !/^[0-9a-f]{40}$/.test(String(pin))) throw new Error("daily subscription record: index.html pin required");
  return Object.freeze({ "index.html": pin });
}
