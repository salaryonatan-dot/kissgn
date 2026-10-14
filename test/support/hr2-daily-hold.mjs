// HR2 is a local successor of immutable HR1. This record proves exact protected bytes; acceptance remains with Claude.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const RECORD = JSON.parse(readFileSync(new URL("./hr2-daily-hold.json", import.meta.url), "utf8"));
export const HR2_PARENT = RECORD.parent;
export const HR2_PINS = Object.freeze({ ...RECORD.pins });
export const HR2_EDITS = Object.freeze(RECORD.edits);
export const HR2_SCOPE = Object.freeze(["api/daily-snapshot/run.ts", "lib/emailDelivery.js"]);

const git = (repo, args, opts = {}) => spawnSync("git", ["-C", repo, ...args], { encoding: "utf8", ...opts });
export function isHR2Tree(repo) {
  if (git(repo, ["merge-base", "--is-ancestor", HR2_PARENT, "HEAD"]).status !== 0) return false;
  return git(repo, ["rev-parse", "HEAD"]).stdout.trim() !== HR2_PARENT;
}
export function deriveHR2(repo, file, edits = HR2_EDITS) {
  const r = git(repo, ["cat-file", "blob", `${HR2_PARENT}:${file}`], { encoding: "buffer" });
  if (r.status !== 0) return { ok: false, reason: "missing_parent_blob" };
  const list = edits[file];
  if (!Array.isArray(list) || list.length === 0) return { ok: false, reason: "no_recorded_edits" };
  let s = r.stdout.toString("utf8");
  for (const e of list) {
    if (typeof e.from !== "string" || !e.from || typeof e.to !== "string" || s.split(e.from).length !== 2)
      return { ok: false, reason: "edit_anchor_not_unique" };
    s = s.replace(e.from, () => e.to);
  }
  return { ok: true, bytes: Buffer.from(s, "utf8") };
}
