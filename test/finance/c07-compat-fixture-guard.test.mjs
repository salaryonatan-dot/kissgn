// C07 guard — the COMPAT-07 fixture correction on RF3 (LOCAL author candidate; pending independent Codex review; T-C07-*).
// Nothing here is an approval: it proves what the candidate IS. Behaviour: test/finance/b1-downstream-compat.test.mjs COMPAT-07.
//   C07G-01 identity: sole parent the RF3 candidate 9ac5b3d8 (then RF2, RF1, I7); the change set vs RF3 is exactly the recorded
//           test-side files at their literal pins — committed, staged, and in the working tree where EVERY path not in the index
//           counts, ignored or not (RF3's collector), outside the two documented dependency paths; no runtime, tool, script, page,
//           Rules or configuration byte moves vs RF3, and no protected file vs I7; RF3's recorded scope is RF3's bytes at RF3
//   C07G-02 the correction (C07-F1): the fixture changes ONLY in the one threshold line (plus its comment); the new line writes the
//           threshold at the path src/alerts/configRepo.ts reads (the source line is asserted, so a later repository path change
//           re-opens this row rather than silently disconnecting the fixture); the old path is gone; the three COMPAT-07 assertions,
//           the seeded data, the pre-B1 comparison and the omitted-field control are RF3's text; configRepo.ts is RF3's bytes
//   C07G-03 layering: RF3G verifies the immutable RF3 object (imports isC07Tree, reads RF3_TREE), RF2G the RF2 object, RF1G the
//           RF1 object, I7G the I7 object; RF3G changes only by the C07 layering; nothing is skipped
import { historicalTest } from "../support/m1-a1-inspection.mjs";
const test = historicalTest(new URL("../../", import.meta.url), "7062046c0227a3647fbd034e83c9bcff937e79f6", "test/finance/c07-compat-fixture-guard.test.mjs");
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { REPO } from "../support/fincore-load.mjs";
import { gitIn } from "../support/git-context.mjs";
import { gitBlobId } from "../../tools/storage-v2/canary-transport.mjs";
import { isProtectedPath } from "../support/server-reader-authorized-delta.mjs";
import { RF1_PARENT } from "../support/rf1-rules-gate.mjs";
import { RF2_PARENT, RF2_UNTRACKED_EXCLUDED, untrackedChanges, workingChanges } from "../support/rf2-rules-gate.mjs";
import { RF3_PARENT, RF3_PINS, RF3_MODIFIED, RF3_NEW_FILES, RF3_RECORD, isRF3Tree } from "../support/rf3-rules-gate.mjs";
import { C07_PARENT, C07_GRANDPARENT, C07_PINS, C07_MODIFIED, C07_NEW_FILES, C07_RECORD, C07_FIXTURE, C07_OLD_LINE, C07_NEW_LINE, C07_REPO_LINE, isC07Tree } from "../support/c07-compat-fixture.mjs";
import { C07T_PARENT, isC07TemporalTree, verifyC07TemporalHead } from "../support/c07-temporal-fixture.mjs";

// C07T: preserve C07's exact historical correction; the carrier verifier below holds this later tree too.
const TEMPORAL = isC07TemporalTree(REPO);
const C07_TREE = TEMPORAL ? C07T_PARENT : "HEAD";
const SKIP = !isC07Tree(REPO) && "not a C07 tree";
const PROTECTED = /^(src\/|fincore\/|api\/|lib\/|database\.rules\.json$|test\/support\/rules-authorized-delta\.mjs$|test\/emulator\/database\.rules\.json$|index\.html$|vercel\.json$|package(-lock)?\.json$)/;
const blobId = (spec) => { const r = gitIn(REPO, ["rev-parse", "--verify", "-q", spec]); return r.status === 0 ? r.stdout.trim() : null; };
const lines = (r) => r.stdout.split("\n").map((x) => x.trim()).filter(Boolean);
const read = (f) => readFileSync(join(REPO, f), "utf8");
const at = (rev, f) => gitIn(REPO, ["cat-file", "blob", `${rev}:${f}`]).stdout;
const codeOnly = (s) => s.split("\n").filter((l) => !/^\s*(\/\/|\/\*\*|\*)/.test(l)).join("\n");
const SCOPE = [...C07_MODIFIED, ...C07_NEW_FILES].sort(), PINNED = SCOPE.filter((f) => f !== C07_RECORD);
const RUNTIME_ROOTS = ["src", "fincore", "api", "lib", "tools", "scripts", "docs", "index.html", "vercel.json", "package.json", "package-lock.json", "database.rules.json", "test/emulator/database.rules.json", "test/support/rules-authorized-delta.mjs"];

test("C07G-01 identity: sole parent the RF3 candidate; the change set vs RF3 is exactly the recorded test-side files at their pins (committed / staged / working tree incl. EVERY path not in the index, ignored or not); no runtime or protected file moves", { skip: SKIP }, () => {
  if (TEMPORAL) verifyC07TemporalHead(REPO);
  assert.equal(C07_PARENT, "9ac5b3d83b99aa13b01fe7dc8def902947889f01", "built on the RF3 candidate");
  assert.equal(C07_GRANDPARENT, RF3_PARENT, "RF3's recorded parent is the RF2 candidate");
  assert.equal(gitIn(REPO, ["rev-parse", C07_TREE + "^"]).stdout.trim(), C07_PARENT, "the RF3 candidate is the SOLE parent");
  assert.equal(lines(gitIn(REPO, ["rev-list", "--parents", "-n1", C07_TREE]))[0].split(" ").length, 2, "exactly one parent");
  assert.equal(gitIn(REPO, ["rev-parse", C07_PARENT + "^"]).stdout.trim(), C07_GRANDPARENT, "the RF3 object's sole parent is RF2");
  assert.equal(gitIn(REPO, ["rev-parse", C07_GRANDPARENT + "^"]).stdout.trim(), RF2_PARENT, "the RF2 object's sole parent is RF1");
  assert.equal(gitIn(REPO, ["rev-parse", RF2_PARENT + "^"]).stdout.trim(), RF1_PARENT, "the RF1 object's sole parent is I7");
  assert.ok(isRF3Tree(REPO), "a C07 tree is an RF3 tree (RF2 is a strict ancestor)");
  assert.deepEqual(SCOPE, ["test/finance/b1-downstream-compat.test.mjs", "test/finance/c07-compat-fixture-guard.test.mjs", "test/finance/rf3-rules-gate-guard.test.mjs", "test/support/c07-compat-fixture.json", "test/support/c07-compat-fixture.mjs"], "the recorded scope");
  assert.deepEqual(Object.keys(C07_PINS).sort(), PINNED, "one pin per recorded file (the record itself excepted)");
  assert.ok(C07_NEW_FILES.includes(C07_RECORD));
  assert.equal(blobId("HEAD:" + C07_RECORD), blobId(":" + C07_RECORD), "the record is committed as staged");
  assert.equal(gitBlobId(readFileSync(join(REPO, C07_RECORD))), blobId("HEAD:" + C07_RECORD), "the record is committed as checked out");
  const committed = lines(gitIn(REPO, ["diff", "--name-only", C07_PARENT, C07_TREE, "--"]));
  const sets = [["committed", committed]];
  if (!TEMPORAL) {
    sets.push(["staged", lines(gitIn(REPO, ["diff", "--name-only", "--cached", C07_PARENT, "--"]))]);
    sets.push(["working tree (incl. every untracked path, ignored or not)", workingChanges(REPO, C07_PARENT)]);
  }
  for (const [label, set] of sets)
    assert.deepEqual([...new Set(set)].sort(), SCOPE, label + ": the change set vs RF3 is exactly the C07 scope");
  assert.deepEqual(untrackedChanges(REPO), [], "no counted untracked path at all — no exclude source hides one");
  assert.deepEqual([...RF2_UNTRACKED_EXCLUDED], ["node_modules/", "test/historical/.deps/"], "the documented exclusions only");
  for (const f of SCOPE) { assert.ok(/^test\//.test(f), f + " is test-side"); assert.ok(!PROTECTED.test(f) && !isProtectedPath(f), f + " is not protected under either rule"); }
  for (const f of PINNED) {
    assert.match(C07_PINS[f], /^[0-9a-f]{40}$/, f + ": literal blob id");
    assert.equal(blobId(C07_TREE + ":" + f), C07_PINS[f], f + " committed");
    if (TEMPORAL) continue; // verifyC07TemporalHead holds every current delta pin and preserves all other paths
    assert.equal(blobId(":" + f), C07_PINS[f], f + " staged");
    assert.equal(gitBlobId(readFileSync(join(REPO, f))), C07_PINS[f], f + " checked out");
  }
  for (const f of C07_NEW_FILES) assert.equal(blobId(`${C07_PARENT}:${f}`), null, f + " is new");
  for (const f of C07_MODIFIED) assert.notEqual(blobId(`${C07_PARENT}:${f}`), C07_PINS[f], f + " really changes");
  assert.deepEqual(lines(gitIn(REPO, ["diff", "--name-only", C07_PARENT, "HEAD", "--", ...RUNTIME_ROOTS])), [], "no runtime, tool, script, page, Rules or configuration byte moves vs RF3");
  assert.deepEqual(lines(gitIn(REPO, ["diff", "--name-only", RF1_PARENT, "HEAD", "--"])).filter((f) => PROTECTED.test(f) || isProtectedPath(f)), [], "no protected file moves vs I7 either");
  // RF3's own recorded scope is unchanged at the RF3 object, and every RF3 file other than its guard is still RF3's bytes at HEAD
  for (const f of [...RF3_MODIFIED, ...RF3_NEW_FILES]) {
    if (f !== RF3_RECORD) assert.equal(blobId(`${C07_PARENT}:${f}`), RF3_PINS[f], f + " is at its RF3 pin at the RF3 object");
    if (f !== "test/finance/rf3-rules-gate-guard.test.mjs") assert.equal(blobId("HEAD:" + f), blobId(`${C07_PARENT}:${f}`), f + " is RF3's bytes at HEAD");
  }
});

test("C07G-02 the correction: the fixture changes only in the threshold line; the new line writes where the alert repository reads; assertions, data and the repository are RF3's", { skip: SKIP }, () => {
  const now = TEMPORAL ? at(C07_TREE, C07_FIXTURE) : read(C07_FIXTURE), was = at(C07_PARENT, C07_FIXTURE);
  assert.equal(was.split("\n").filter((l) => l === C07_OLD_LINE).length, 1, "RF3's fixture wrote the threshold at biz:{biz}:alertConfig (the defect) exactly once");
  assert.equal(now.split("\n").filter((l) => l === C07_NEW_LINE).length, 1, "the fixture writes the threshold at alert_config/{biz} exactly once");
  assert.ok(!codeOnly(now).includes("alertConfig"), "the unread path is gone (code only; the comment names it)");
  assert.equal(codeOnly(now).replace(C07_NEW_LINE, "<THRESHOLD>"), codeOnly(was).replace(C07_OLD_LINE, "<THRESHOLD>"), "code-only, the fixture changes in that one line and nothing else");
  // the repository contract the fixture now agrees with (src/alerts/configRepo.ts is RF3's bytes, and I7's)
  const repo = read("src/alerts/configRepo.ts");
  assert.equal(repo.split("\n").filter((l) => l === C07_REPO_LINE).length, 1, "configRepo reads tenants/{t}/alert_config/{biz}");
  assert.ok(C07_NEW_LINE.includes("`tenants/${T}/alert_config/${B}`") && C07_REPO_LINE.includes("`tenants/${tenantId}/alert_config/${bizId}`"), "the fixture path and the repository path are the same template");
  for (const f of ["src/alerts/configRepo.ts", "src/alerts/runner.ts", "src/alerts/checkers.ts", "src/alerts/alertMonthReport.ts", "src/alerts/types.ts"]) {
    assert.equal(blobId("HEAD:" + f), blobId(`${C07_PARENT}:${f}`), f + " is RF3's bytes");
    assert.equal(blobId("HEAD:" + f), blobId(`${RF1_PARENT}:${f}`), f + " is I7's bytes");
  }
  // the row's contract is unchanged: its three assertions and its fixtures are RF3's text
  for (const needle of ['assert.ok(h1.res.alertsFired > 0, "the fixture fires alerts"); assert.deepEqual(h1, h0, "non-VD firing: identical alerts");',
    'assert.deepEqual(a.res.errors, []); assert.deepEqual(a, b, "non-VD: identical alert outcome");',
    'assert.deepEqual(c.res.errors, []); assert.equal(c.res.alertsFired, 0, "no alert manufactured from an omitted field");',
    "const hot = Array.from({ length: 10 }, (_, i) => entry(uid(800 + i), ago(i + 1), { sales: String(REV[i % REV.length]), supplier_payments: { s1: String(REV[i % REV.length] / 2) }, payroll: String(REV[i % REV.length] / 2) }));",
    "const purchasesOnly = Array.from({ length: 8 }, (_, i) => entry(uid(700 + i), ago(i + 1), { supplier_payments: { s1: \"900\" } }));",
    "const nonVd = nonVdRows(10, 1);", "for (let k = 1; k <= 8; k++) { const d = await builder.buildAnalyticsForBiz(T, B, ago(k)); await builder.saveAnalyticsDoc(d); }"])
    assert.ok(now.includes(needle) && was.includes(needle), "unchanged: " + needle.slice(0, 60));
  assert.ok(!/\{ skip: |test\.skip\(|test\.todo\(/.test(codeOnly(now)), "no COMPAT row is skipped");
});

test("C07G-03 layering: RF3G verifies the immutable RF3 object on this tree, RF2G the RF2 object, RF1G the RF1 object, I7G the I7 object; RF3G changes only by the C07 layering; nothing skipped", { skip: SKIP }, () => {
  const rf3g = codeOnly(read("test/finance/rf3-rules-gate-guard.test.mjs"));
  assert.ok(rf3g.includes('import { isC07Tree, C07_PARENT } from "../support/c07-compat-fixture.mjs";'), "RF3G imports the C07 layer");
  assert.ok(rf3g.includes("const LAYERED = isC07Tree(REPO);") && rf3g.includes('const RF3_TREE = LAYERED ? C07_PARENT : "HEAD";'), "RF3G reads the RF3 object when C07 is checked out");
  assert.ok(rf3g.includes('if (LAYERED) assert.equal(RF3_TREE, "9ac5b3d83b99aa13b01fe7dc8def902947889f01"'), "the RF3 commit itself is verified when layered");
  assert.ok(rf3g.includes('assert.equal(blobId(RF3_TREE + ":" + f), RF3_PINS[f]') && rf3g.includes('["diff", "--name-only", RF3_PARENT, RF3_TREE, "--"]') && !rf3g.includes('["diff", "--name-only", RF3_PARENT, "HEAD"'), "RF3G's pins and change set are judged at RF3_TREE");
  assert.ok(rf3g.includes("if (!LAYERED) {                                                   // C07G-01 holds HEAD / index / working tree of the later tree"), "HEAD / index / working tree are C07G-01's when layered");
  // RF3G: identical to the RF3 object except the layering (code only): every remaining difference names LAYERED, RF3_TREE or C07
  const trimmed = (t) => t.split("\n").map((l) => l.trim()).filter(Boolean);
  const was = trimmed(codeOnly(at(C07_PARENT, "test/finance/rf3-rules-gate-guard.test.mjs"))), now = trimmed(rf3g);
  const only = (a, b) => a.filter((l) => !b.includes(l));
  const LAYERING = /LAYERED|RF3_TREE|C07|\bHEAD\b|\bsets\b|^const (committed|staged|working) = |^assert\.deepEqual\(untrackedChanges\(REPO\), \[\]|^for \(const \[label, set\] of \[/;   // the layered change-set collection included
  for (const l of [...only(now, was), ...only(was, now)]) assert.ok(LAYERING.test(l), "RF3G differs only in layering lines: " + l.slice(0, 80));
  assert.ok(only(now, was).length >= 8 && only(now, was).length <= 24, "a bounded layering edit (" + only(now, was).length + " lines)");
  // the lower layers are RF3's bytes and still layered onto their own objects
  for (const f of ["test/finance/rf2-rules-gate-guard.test.mjs", "test/finance/rf1-rules-gate-guard.test.mjs", "test/finance/i7-integration-guard.test.mjs", "test/support/rf2-rules-gate.mjs", "test/support/rf3-rules-gate.mjs", "test/support/rf3-rules-gate.json", "test/storage-v2/rf3-rules-gate.test.mjs", "test/support/m1-run-gates.sh"])
    assert.equal(blobId("HEAD:" + f), blobId(`${C07_PARENT}:${f}`), f + " is RF3's bytes");
  assert.ok(codeOnly(read("test/finance/rf2-rules-gate-guard.test.mjs")).includes('const RF2_TREE = LAYERED ? RF3_PARENT : "HEAD";'), "RF2G reads the RF2 object (RF3's layering, unchanged)");
  for (const f of ["test/finance/rf3-rules-gate-guard.test.mjs", "test/finance/c07-compat-fixture-guard.test.mjs", C07_FIXTURE]) {
    const t = codeOnly(read(f));
    assert.ok(!/test\([^\n]*\{ skip: true \}/.test(t) && !/test\.skip\(|test\.todo\(/.test(t), f + ": nothing is skipped unconditionally");
  }
});
