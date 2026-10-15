// HR3 is a separate child of immutable HR2; these candidate identities await Claude's independent acceptance.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
const RECORD = JSON.parse(readFileSync(new URL("./hr3-daily-hold.json", import.meta.url), "utf8"));
export const HR3_PARENT = "6aac2683b614d367b5963670d44fa79f31b709c8";
export const HR3_PINS = Object.freeze({ ...RECORD.pins });
export const HR3_SCOPE = Object.freeze(["lib/emailDelivery.js", "lib/emailDelivery.d.ts", "tools/daily-delivery/hold.mjs"]);
export const HR3_EDITS = Object.freeze(RECORD.edits);
const git = (repo, args, opts = {}) => spawnSync("git", ["-C", repo, ...args], { encoding: "utf8", maxBuffer: 1 << 28, ...opts });
export function isHR3Tree(repo) {
  return git(repo, ["merge-base", "--is-ancestor", HR3_PARENT, "HEAD"]).status === 0 && git(repo, ["rev-parse", "HEAD"]).stdout.trim() !== HR3_PARENT;
}
export function deriveHR3(repo, file, edits = HR3_EDITS) {
  const r = git(repo, ["cat-file", "blob", `${HR3_PARENT}:${file}`], { encoding: "buffer" });
  if (r.status !== 0) return { ok: false, reason: "missing_parent_blob" };
  const list = edits[file];
  if (!Array.isArray(list) || !list.length) return { ok: false, reason: "no_recorded_edits" };
  let text = r.stdout.toString("utf8");
  for (const e of list) {
    if (typeof e.from !== "string" || !e.from || typeof e.to !== "string" || text.split(e.from).length !== 2) return { ok: false, reason: "edit_anchor_not_unique" };
    text = text.replace(e.from, () => e.to);
  }
  return { ok: true, bytes: Buffer.from(text, "utf8") };
}
