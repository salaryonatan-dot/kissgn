import { isA1Tree } from "./m1-a1-inspection.mjs";
// C07 — the COMPAT-07 fixture correction, a test-only successor of RF3 9ac5b3d8 (LOCAL author candidate; pending independent Codex
// review; T-C07-*). Sole parent: RF3 (preserved unchanged; RF3's scoped acceptance is not re-decided here).
//   C07-F1  test/finance/b1-downstream-compat.test.mjs COMPAT-07 wrote its alert threshold at tenants/{t}/biz:{biz}:alertConfig, a
//           path the alert repository never read (src/alerts/configRepo.ts reads tenants/{t}/alert_config/{biz}, unchanged since
//           2026-03-30). The fixture's minDailyRevenue therefore never applied, and the row fired only through the open-month ratio
//           checkers, which since eb9f900 need complete evidence for every completed day of the month; the ten rolling seeded days
//           give that only on days 2–11, so the row was red on the 1st and from the 12th of every month. The fixture now writes the
//           threshold where the repository reads it. Assertions, the seeded data and every runtime file are unchanged.
// RF3G is layered onto the immutable RF3 object (T-C07-LAYER, the RF2G-on-RF3 pattern); C07G holds HEAD / index / working tree.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const RECORD = JSON.parse(readFileSync(new URL("./c07-compat-fixture.json", import.meta.url), "utf8"));
export const C07_STATUS = "CANDIDATE (COMPAT-07 fixture correction on RF3) — pending independent Codex review (T-C07-*) PROPOSED";
export const C07_PARENT = RECORD.parent;
/** RF3's sole parent (RF2): the whole RF lineage stays, each object verified by its own layered guard. */
export const C07_GRANDPARENT = "d4ac50ca80fbc62d7942ef9a14284968c0348630";
export const C07_PINS = Object.freeze({ ...RECORD.pins });
export const C07_MODIFIED = Object.freeze([...RECORD.modified]);
export const C07_NEW_FILES = Object.freeze([...RECORD.newFiles]);
export const C07_RECORD = "test/support/c07-compat-fixture.json";
export const C07_FIXTURE = "test/finance/b1-downstream-compat.test.mjs";
/** The one fixture line that changes (C07-F1), before and after. */
export const C07_OLD_LINE = "    db.seed(`tenants/${T}/biz:${B}:alertConfig`, { minDailyRevenue: 5000 });";
export const C07_NEW_LINE = "    db.seed(`tenants/${T}/alert_config/${B}`, { minDailyRevenue: 5000 });";
/** The repository line the fixture must agree with (src/alerts/configRepo.ts). */
export const C07_REPO_LINE = "  return getDb().ref(`tenants/${tenantId}/alert_config/${bizId}`);";

const git = (repo, args, opts = {}) => spawnSync("git", ["-C", repo, ...args], { encoding: "utf8", maxBuffer: 1 << 28, ...opts });
/** The C07 tree: the RF3 candidate is a STRICT ancestor of HEAD. */
export function isC07Tree(repo) {
  if (isA1Tree(repo)) return true;
  if (git(repo, ["merge-base", "--is-ancestor", C07_PARENT, "HEAD"]).status !== 0) return false;
  return git(repo, ["rev-parse", "HEAD"]).stdout.trim() !== C07_PARENT;
}
