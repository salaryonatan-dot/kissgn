import { isA1Tree } from "./m1-a1-inspection.mjs";
// DT-O1 R2 local successor. The literal record pins the two calendar helpers
// after the reviewed f427e137 candidate; it grants no approval by itself.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const RECORD = JSON.parse(readFileSync(new URL("./dt-o1-runtime.json", import.meta.url), "utf8"));
export const DT_O1_PARENT = RECORD.parent;
export const DT_O1_I6 = RECORD.historicalI6;
export const DT_O1_PINS = Object.freeze({ ...RECORD.pins });
export const DT_O1_PREVIOUS_PINS = Object.freeze({ ...RECORD.previousPins });
export const DT_O1_SCOPE = Object.freeze(["src/analytics/dailyBuilder.ts", "src/utils/dates.ts"]);
export const DT_O1_EDITS = Object.freeze(RECORD.edits);

const git = (repo, args, opts = {}) => spawnSync("git", ["-C", repo, ...args], { encoding: "utf8", maxBuffer: 1 << 28, ...opts });
export function isDTO1Tree(repo) {
  if (isA1Tree(repo)) return true;
  if (git(repo, ["merge-base", "--is-ancestor", DT_O1_PARENT, "HEAD"]).status !== 0) return false;
  return git(repo, ["rev-parse", "HEAD"]).stdout.trim() !== DT_O1_PARENT;
}
export function deriveDTO1(repo, file, edits = DT_O1_EDITS) {
  const r = git(repo, ["cat-file", "blob", `${DT_O1_PARENT}:${file}`], { encoding: "buffer" });
  if (r.status !== 0) throw new Error(`${DT_O1_PARENT}:${file}`);
  const list = edits[file];
  if (!Array.isArray(list) || list.length === 0) return { ok: false, reason: "no_recorded_edits", detail: file };
  let s = r.stdout.toString("utf8");
  for (const [k, edit] of list.entries()) {
    if (typeof edit.from !== "string" || typeof edit.to !== "string" || !edit.from) return { ok: false, reason: "edit_shape", detail: `${file}#${k}` };
    if (s.split(edit.from).length !== 2) return { ok: false, reason: "edit_anchor_not_unique", detail: `${file}#${k}` };
    s = s.replace(edit.from, () => edit.to);
  }
  return { ok: true, bytes: Buffer.from(s, "utf8") };
}
