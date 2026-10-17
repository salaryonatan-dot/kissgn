import { isA1Tree } from "./m1-a1-inspection.mjs";
// CC2 — the checklist concurrency TEST-CONTRACT successor of CC1 (LOCAL author candidate; pending independent Codex review and the
// checklist / security-test owner's acceptance, T-CC1-TEST → T-CC2-TEST). Sole parent: CC1 (026c2278, preserved unchanged; its runtime
// correction `runs === 1 ? current : undefined` in lib/repositories/bizDataRepo.js was independently accepted at its scope on
// 2026-10-14, finding CC1-R-01 rejected ONLY the committed CCE-05 test contract). CC2 changes NO protected file: the real-transport
// emulator gate test/emulator/checklist-cold-cache-emulator.mjs binds every handler request to an IMMUTABLE AsyncLocalStorage context
// holding its own Admin SDK instance (no process-global selector, no default, no fallback), proves from the per-request trace that the two
// CCE-05 writers ran on two DISTINCT cold instances under varied scheduling, retries the loser with the current token, and rejects —
// in CCE-05N — the forced shared-instance, warm-instance and unbound-request conditions that the CC1 harness accepted.
// CC1G is layered onto the immutable CC1 object on a CC2 tree (the I6G-on-I7 / I7G-on-CC1 pattern); CC2G-01..04 hold HEAD / index /
// checkout. No pin is added: CC2 owns no protected file.
import { spawnSync } from "node:child_process";

export const CC2_STATUS = "CANDIDATE (checklist concurrency test-contract successor CC2 on CC1) — pending independent Codex review; checklist / security-test owner acceptance (T-CC2-TEST) PROPOSED";
export const CC2_PARENT = "026c2278e511a4007145d77ea019315867b76a23";
/** CC1's sole parent (the I7 candidate) — CC2 keeps the whole lineage. */
export const CC2_GRANDPARENT = "5bae812c9fde9f58bd9d1bc359dd3855c4658cf1";
/** The ONLY files CC2 changes relative to CC1 (all under test/; no protected path). */
export const CC2_FILES = Object.freeze([
  "test/emulator/checklist-cold-cache-emulator.mjs",
  "test/finance/cc1-checklist-cold-cache-guard.test.mjs",
  "test/finance/cc2-checklist-concurrency-guard.test.mjs",
  "test/security/checklist-concurrency.test.mjs",
  "test/support/cc2-checklist-concurrency.mjs",
]);
export const CC2_HARNESS = "test/emulator/checklist-cold-cache-emulator.mjs";
/** CC2 owns no protected file: the protected scope it adds is EMPTY. */
export const CC2_SCOPE = Object.freeze([]);

const git = (repo, args, opts = {}) => spawnSync("git", ["-C", repo, ...args], { encoding: "utf8", maxBuffer: 1 << 28, ...opts });
/** The CC2 tree: the CC1 candidate is a STRICT ancestor of HEAD. */
export function isCC2Tree(repo) {
  if (isA1Tree(repo)) return true;
  if (git(repo, ["merge-base", "--is-ancestor", CC2_PARENT, "HEAD"]).status !== 0) return false;
  return git(repo, ["rev-parse", "HEAD"]).stdout.trim() !== CC2_PARENT;
}
