import { isA1Tree } from "./m1-a1-inspection.mjs";
// RF3 — the Rules / test-fixture transition successor of RF2 (LOCAL author candidate; pending independent Codex review; T-RF3-*).
// Sole parent: RF2 d4ac50ca (preserved unchanged). The independent RF2 review (2026-10-15, RULES_FIXTURE_TRANSITION_RF2_VERDICT:
// CHANGES_REQUIRED) accepted T-RF2-GATE / T-RF2-LANE at the fixture / fake-CLI scope and kept the accepted Rules content and
// T-RF1-TEST; RF3 closes its three findings, test-side only:
//   RF2-R-01  ignored untracked protected files escaped the collector: test/support/rf2-rules-gate.mjs untrackedChanges lists every
//             path not in the index with NO exclude source (.gitignore at any depth, .git/info/exclude, a global core.excludesFile);
//             only node_modules/ and test/historical/.deps/ are excluded. RF3G-01 holds this tree with it; RF3G-02 / RF-11 prove it.
//   RF2-R-02  the delivery bundle omitted historical objects the guards need: RF3 ships them (package) and RF3G-03 refuses a checkout
//             that lacks the detached owner-notice UI commit the I1 / UI guards dereference or the retired lane object the RF
//             packaging carries — a recipient never needs an undocumented object transplant.
//   RF2-R-03  the proposed re-pin's record validator accepted missing owner / reference fields, a wrong SHA-256 and an impossible
//             date: test/support/rules-owner-acceptance.mjs is the committed contract (RF-12 / RF-13); the proposal (package,
//             proposed/rules-owner-acceptance-repin-v3.patch) calls it and stays UNAPPLIED. No record is filled; publication pending.
// UNCHANGED: APPROVED_RULES_BLOB (32ea32bf, the release pin) and its RV-G01 text, CANDIDATE_RULES_BLOB (27887d72), both Rules files,
// canary-fixtures.mjs, the operator matrix, tools/, every runtime file. RF2G is layered onto the immutable RF2 object (T-RF3-LAYER).
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const RECORD = JSON.parse(readFileSync(new URL("./rf3-rules-gate.json", import.meta.url), "utf8"));
export const RF3_STATUS = "CANDIDATE (Rules / test-fixture transition RF3 on RF2) — pending independent Codex review; Storage V2 / canary test owner and M1 integration owner acceptance (T-RF3-*) PROPOSED";
export const RF3_PARENT = RECORD.parent;
/** RF2's sole parent (RF1) and RF1's (I7): RF3 keeps the whole lineage; each is verified by its own layered guard. */
export const RF3_GRANDPARENT = "441d6716e2fcfca81818485f58ff878a763619da";
export const RF3_PINS = Object.freeze({ ...RECORD.pins });
export const RF3_MODIFIED = Object.freeze([...RECORD.modified]);
export const RF3_NEW_FILES = Object.freeze([...RECORD.newFiles]);
export const RF3_RECORD = "test/support/rf3-rules-gate.json";
/** Objects outside the candidate's ancestry that a complete RF package must carry (RF2-R-02): the detached owner-notice UI candidate
 *  the I1 / UI guards dereference (I1G-02, UIG-01, UIG-03) and the retired Codex lane RF1's packaging carries for historical review. */
export const RF3_REQUIRED_HISTORICAL_OBJECTS = Object.freeze({
  "2a9df535b5a0c94940724158cf24c905f4cd17b6": "source/owner-notice-ui-r1 — the owner-notice UI candidate (I1G-02, UIG-01, UIG-03)",
  "21a651d0bb6bd8f914745b36e5c6b6610d721c1a": "codex/rules-canary-local-successor — the retired lane (RF1 / RF2 packaging, historical review)",
});

const git = (repo, args, opts = {}) => spawnSync("git", ["-C", repo, ...args], { encoding: "utf8", maxBuffer: 1 << 28, ...opts });
/** The RF3 tree: the RF2 candidate is a STRICT ancestor of HEAD. */
export function isRF3Tree(repo) {
  if (isA1Tree(repo)) return true;
  if (git(repo, ["merge-base", "--is-ancestor", RF3_PARENT, "HEAD"]).status !== 0) return false;
  return git(repo, ["rev-parse", "HEAD"]).stdout.trim() !== RF3_PARENT;
}
/** The required historical objects absent from `repo` (each must be a commit). */
export function missingHistoricalObjects(repo) {
  return Object.keys(RF3_REQUIRED_HISTORICAL_OBJECTS).filter((id) => git(repo, ["cat-file", "-t", id]).stdout.trim() !== "commit");
}
