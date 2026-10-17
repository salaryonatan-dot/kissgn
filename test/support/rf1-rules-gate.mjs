// RF1 — the Rules / test-fixture transition (LOCAL author candidate; pending independent Codex review and the Storage V2 / canary
// test owner's and the M1 integration owner's technical acceptance, T-RF1-*). Sole parent: I7 (5bae812c, preserved unchanged;
// itself under independent review). It gives the ORDINARY local canary gate an explicit candidate expectation:
//   test/support/canary-fixtures.mjs         CANDIDATE_RULES_BLOB = 27887d72 (the integration Rules of this lineage); an emulator
//                                            manifest names it, a production-shaped manifest keeps naming the release pin
//   test/storage-v2/canary-transport.test.mjs the fingerprint row checks the checked-out Rules against the candidate expectation
//   test/emulator/canary-operator-matrix.mjs  the operator matrix SAFETY-ABORTs unless the canonical Rules are the candidate expectation
//   test/storage-v2/rf1-rules-gate.test.mjs   RF-01..05: the identities, the release pin refused (publication pending), unexpected
//                                            Rules refused, the real CLI on the default manifest, the fixture distinction
// UNCHANGED: APPROVED_RULES_BLOB (32ea32bf, the release pin), APPROVED_FENCE_RULES_BLOB, both Rules files (27887d72),
// test/support/rules-authorized-delta.mjs, tools/, every runtime file. No protected file under either protected-path rule moves.
// The Codex lane 21a651d0 (selector + wrapper + RC-L01..04) is NOT carried: its protections are re-stated as RF-02..05 on the
// ordinary gate (T-RF1-LANE). A pin here is a candidate pin and inherits no approval.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const RECORD = JSON.parse(readFileSync(new URL("./rf1-rules-gate.json", import.meta.url), "utf8"));
export const RF1_STATUS = "CANDIDATE (Rules / test-fixture transition RF1 on I7) — pending independent Codex review; Storage V2 / canary test owner and M1 integration owner acceptance (T-RF1-*) PROPOSED";
export const RF1_PARENT = RECORD.parent;
/** Literal blob ids of every file RF1 adds or changes (all test-side; none protected). */
export const RF1_PINS = Object.freeze({ ...RECORD.pins });
export const RF1_MODIFIED = Object.freeze([...RECORD.modified]);
export const RF1_NEW_FILES = Object.freeze([...RECORD.newFiles]);
/** The release pin (unchanged) and the local gate expectation, as RF1 records them. */
export const RF1_RELEASE_PIN = "32ea32bfc9b70c16c06b1acf87d045c5e28ff1d8";
export const RF1_GATE_EXPECTATION = "27887d72da5431bd0b6ee69f53e0dfd10cc44caf";

const git = (repo, args, opts = {}) => spawnSync("git", ["-C", repo, ...args], { encoding: "utf8", maxBuffer: 1 << 28, ...opts });
/** The RF1 tree: the I7 candidate is a STRICT ancestor of HEAD. */
export function isRF1Tree(repo) {
  if (git(repo, ["merge-base", "--is-ancestor", RF1_PARENT, "HEAD"]).status !== 0) return false;
  return git(repo, ["rev-parse", "HEAD"]).stdout.trim() !== RF1_PARENT;
}
