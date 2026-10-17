import { isA1Tree } from "./m1-a1-inspection.mjs";
// RF2 — the Rules / test-fixture transition successor of RF1 (LOCAL author candidate; pending independent Codex review; T-RF2-*).
// Sole parent: RF1 441d6716 (preserved unchanged; its Rules content 27887d72 and T-RF1-TEST were independently accepted at scope on
// 2026-10-14; T-RF1-GATE / LANE / LAYER were rejected as complete for two test-side defects). RF2 closes them, test-side only:
//   RF1-R-01  the candidate expectation confined to its exact emulator scope on every fixture path (test/support/canary-fixtures.mjs:
//             manifestFor / candidateManifest / diagnosticManifest, assertCandidateScope, DIAGNOSTIC_RULES_BLOB) and proven through the
//             actual CLI (test/storage-v2/rf2-rules-gate.test.mjs RF-06..09)
//   RF1-R-02  the guard's untracked collector: EVERY untracked path outside the documented dependency / output paths counts as a change
//             (untrackedChanges below), so an untracked API / lib / src / scripts / tools / docs / root file is caught under both
//             protected-path definitions and under the exact-scope claim (RF2G-01; RF1G-01's unlayered branch uses the same collector)
// RF3 (test/support/rf3-rules-gate.mjs; closes the independent RF2 review's RF2-R-01): untrackedChanges no longer honours ANY git
// exclude source — RF2 used `--exclude-standard`, so a protected file hidden by .git/info/exclude, a global excludes file or a nested
// .gitignore escaped RF2G-01 / RF1G-01. Only the two documented dependency paths are excluded. Nothing else in this module changes.
// UNCHANGED: APPROVED_RULES_BLOB (32ea32bf, the release pin), CANDIDATE_RULES_BLOB (27887d72), both Rules files, the authorized-delta
// module, the operator matrix, tools/, every runtime file. No protected file under either protected-path rule moves. The proposed
// publication re-pin remains a PACKAGE artifact (proposed/), never applied. A pin here is a candidate pin and inherits no approval.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const RECORD = JSON.parse(readFileSync(new URL("./rf2-rules-gate.json", import.meta.url), "utf8"));
export const RF2_STATUS = "CANDIDATE (Rules / test-fixture transition RF2 on RF1) — pending independent Codex review; Storage V2 / canary test owner and M1 integration owner acceptance (T-RF2-*) PROPOSED";
export const RF2_PARENT = RECORD.parent;
/** RF1's sole parent (the I7 candidate): RF2 keeps the whole lineage; the I7 object is verified by I7G, the RF1 object by RF1G. */
export const RF2_GRANDPARENT = "5bae812c9fde9f58bd9d1bc359dd3855c4658cf1";
export const RF2_PINS = Object.freeze({ ...RECORD.pins });
export const RF2_MODIFIED = Object.freeze([...RECORD.modified]);
export const RF2_NEW_FILES = Object.freeze([...RECORD.newFiles]);
export const RF2_RECORD = "test/support/rf2-rules-gate.json";
/** The sentinel pin diagnostic manifests carry outside the candidate scope: 40-hex, no git object, no known pin. */
export const DIAGNOSTIC_SENTINEL = "d1a6d1a6d1a6d1a6d1a6d1a6d1a6d1a6d1a6d1a6";
/** The ONLY untracked paths a clone may hold without counting as a change: installed dependencies and the historical page deps. */
export const RF2_UNTRACKED_EXCLUDED = Object.freeze(["node_modules/", "test/historical/.deps/"]);

const git = (repo, args, opts = {}) => spawnSync("git", ["-C", repo, ...args], { encoding: "utf8", maxBuffer: 1 << 28, ...opts });
const lines = (r) => r.stdout.split("\n").map((x) => x.trim()).filter(Boolean);
/** The RF2 tree: the RF1 candidate is a STRICT ancestor of HEAD. */
export function isRF2Tree(repo) {
  if (isA1Tree(repo)) return true;
  if (git(repo, ["merge-base", "--is-ancestor", RF2_PARENT, "HEAD"]).status !== 0) return false;
  return git(repo, ["rev-parse", "HEAD"]).stdout.trim() !== RF2_PARENT;
}
/** Every path that is not in the index (`ls-files --others`, with NO exclude source: a file hidden by a .gitignore at any depth, by
 *  .git/info/exclude or by a global core.excludesFile is still listed — RF3, the independent RF2 review's RF2-R-01) outside
 *  RF2_UNTRACKED_EXCLUDED — under ANY directory. The two documented dependency paths are the ONLY paths it does not count. */
export function untrackedChanges(repo, excluded = RF2_UNTRACKED_EXCLUDED) {
  const isExcluded = (f) => excluded.some((p) => f === p.replace(/\/$/, "") || f.startsWith(p));
  return lines(git(repo, ["ls-files", "--others"])).filter((f) => !isExcluded(f));
}
/** The full working-tree change set vs `base`: tracked differences (committed, staged or dirty) ∪ every counted untracked path. */
export function workingChanges(repo, base, excluded = RF2_UNTRACKED_EXCLUDED) {
  return [...new Set([...lines(git(repo, ["diff", "--name-only", base, "--"])), ...untrackedChanges(repo, excluded)])].sort();
}
