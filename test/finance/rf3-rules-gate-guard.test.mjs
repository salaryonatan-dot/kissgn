// RF3 guard — the Rules / test-fixture transition successor on RF2 (LOCAL author candidate; pending independent Codex review; T-RF3-*).
// Nothing here is an approval: it proves what the candidate IS. Behaviour: test/storage-v2/rf3-rules-gate.test.mjs RF-11 / RF-12 and
// the unchanged canary suites / RF-01..09.
//   RF3G-01 identity: sole parent the RF2 candidate d4ac50ca (then RF1, then I7); the change set vs RF2 is exactly the recorded
//           test-side files at their literal pins — committed, staged, and in the working tree where EVERY path that is not in the
//           index counts, ignored or not (RF2-R-01), outside the two documented dependency paths; no protected file under either
//           protected-path rule moves; both Rules files, the release pin, the gate expectation and the canary fixtures are unchanged
//   RF3G-02 the collector (RF2-R-01) in the source and on disposable repositories: neither .git/info/exclude, nor a global
//           core.excludesFile, nor a root or nested .gitignore (the output-directory `*` pattern included) hides a file; a
//           force-staged ignored file is a staged change; the dependency paths (directories or symlinks) are excluded and nothing
//           else (look-alikes are counted); each control is shown to be hidden by `--exclude-standard`, so it is meaningful
//   RF3G-03 package completeness (RF2-R-02): the detached historical objects outside the candidate's ancestry are present as commits
//   RF3G-04 publication pending (RF2-R-03): the record validator carries the reviewed contract; this tree exports no acceptance record,
//           the release pin is 32ea32bf, acceptanceRecordStatus is "absent", RV-G01 is I7's bytes — nothing is re-pinned or filled
//   RF3G-05 layering: RF2G verifies the immutable RF2 object (imports isRF3Tree, reads RF2_TREE), RF1G the RF1 object, I7G the I7
//           object; RF2's support module changes ONLY in the collector line; nothing is skipped; matrix / M1 gate list / records unchanged
// C07 layering (T-C07-LAYER; the RF2G-on-RF3 pattern): on a tree that carries the COMPAT-07 fixture correction on top of the RF3
// candidate, RF3G-01 verifies the RF3 commit ITSELF (9ac5b3d8) from git objects — sole parent RF2, the recorded test-side change set
// at its pins — and the HEAD / index / working-tree identity of the later tree is held by its own guard (C07G-01).
import { historicalTest } from "../support/m1-a1-inspection.mjs";
const test = historicalTest(new URL("../../", import.meta.url), "7062046c0227a3647fbd034e83c9bcff937e79f6", "test/finance/rf3-rules-gate-guard.test.mjs");
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, writeFileSync, mkdirSync, rmSync, symlinkSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { REPO } from "../support/fincore-load.mjs";
import { gitIn } from "../support/git-context.mjs";
import { gitBlobId } from "../../tools/storage-v2/canary-transport.mjs";
import { isProtectedPath } from "../support/server-reader-authorized-delta.mjs";
import * as X from "../support/canary-fixtures.mjs";
import { RF1_PARENT, RF1_RELEASE_PIN, RF1_GATE_EXPECTATION } from "../support/rf1-rules-gate.mjs";
import { RF2_PARENT, RF2_UNTRACKED_EXCLUDED, isRF2Tree, untrackedChanges, workingChanges } from "../support/rf2-rules-gate.mjs";
import { RF3_PARENT, RF3_GRANDPARENT, RF3_PINS, RF3_MODIFIED, RF3_NEW_FILES, RF3_RECORD, RF3_REQUIRED_HISTORICAL_OBJECTS, isRF3Tree, missingHistoricalObjects } from "../support/rf3-rules-gate.mjs";
import { ACCEPTANCE_FIELDS, acceptanceRecordStatus, gitBlobReader } from "../support/rules-owner-acceptance.mjs";
import { isC07Tree, C07_PARENT } from "../support/c07-compat-fixture.mjs";

const SKIP = !isRF3Tree(REPO) && "not an RF3 tree";
const LAYERED = isC07Tree(REPO);
const RF3_TREE = LAYERED ? C07_PARENT : "HEAD";          // the RF3 commit itself when the C07 layer is checked out
const PROTECTED = /^(src\/|fincore\/|api\/|lib\/|database\.rules\.json$|test\/support\/rules-authorized-delta\.mjs$|test\/emulator\/database\.rules\.json$|index\.html$|vercel\.json$|package(-lock)?\.json$)/;
const blobId = (spec) => { const r = gitIn(REPO, ["rev-parse", "--verify", "-q", spec]); return r.status === 0 ? r.stdout.trim() : null; };
const lines = (r) => r.stdout.split("\n").map((x) => x.trim()).filter(Boolean);
const read = (f) => readFileSync(join(REPO, f), "utf8");
const at = (rev, f) => gitIn(REPO, ["cat-file", "blob", `${rev}:${f}`]).stdout;
const codeOnly = (s) => s.split("\n").filter((l) => !/^\s*(\/\/|\/\*\*|\*)/.test(l)).join("\n");
const SCOPE = [...RF3_MODIFIED, ...RF3_NEW_FILES].sort(), PINNED = SCOPE.filter((f) => f !== RF3_RECORD);
const UNCHANGED_VS_RF2 = ["test/support/canary-fixtures.mjs", "test/finance/f1-r1-review-state.test.mjs", "test/finance/rf1-rules-gate-guard.test.mjs", "test/finance/i7-integration-guard.test.mjs",
  "test/storage-v2/rf1-rules-gate.test.mjs", "test/storage-v2/rf2-rules-gate.test.mjs", "test/storage-v2/canary-transport.test.mjs", "test/storage-v2/canary-contract.test.mjs", "test/storage-v2/canary-cli.test.mjs",
  "test/emulator/canary-operator-matrix.mjs", "test/support/m1-run-gates.sh", "test/support/p1-r7-emu-run.sh", "test/support/rf1-rules-gate.json", "test/support/rf1-rules-gate.mjs", "test/support/rf2-rules-gate.json",
  "test/support/rules-authorized-delta.mjs", "tools/storage-v2/canary.mjs", "tools/storage-v2/canary-transport.mjs", "tools/storage-v2/canary-contract.mjs"];

test("RF3G-01 identity: sole parent the RF2 candidate; the change set vs RF2 is exactly the recorded test-side files at their pins (committed / staged / working tree incl. EVERY path not in the index, ignored or not); no protected file moves", { skip: SKIP }, () => {
  assert.equal(RF3_PARENT, "d4ac50ca80fbc62d7942ef9a14284968c0348630", "built on the RF2 candidate");
  assert.equal(RF3_GRANDPARENT, RF2_PARENT, "RF2's recorded parent is the RF1 candidate");
  if (LAYERED) assert.equal(RF3_TREE, "9ac5b3d83b99aa13b01fe7dc8def902947889f01", "the RF3 candidate commit itself is verified");
  assert.equal(gitIn(REPO, ["rev-parse", RF3_TREE + "^"]).stdout.trim(), RF3_PARENT, "the RF2 candidate is the SOLE parent");
  assert.equal(lines(gitIn(REPO, ["rev-list", "--parents", "-n1", RF3_TREE]))[0].split(" ").length, 2, "exactly one parent");
  assert.equal(gitIn(REPO, ["rev-parse", RF3_PARENT + "^"]).stdout.trim(), RF3_GRANDPARENT, "the RF2 object's sole parent is RF1");
  assert.equal(gitIn(REPO, ["rev-parse", RF3_GRANDPARENT + "^"]).stdout.trim(), RF1_PARENT, "the RF1 object's sole parent is I7");
  assert.ok(isRF2Tree(REPO), "an RF3 tree is an RF2 tree (RF1 is a strict ancestor)");
  assert.ok(SCOPE.length >= 6, "the recorded scope is populated");
  assert.deepEqual(Object.keys(RF3_PINS).sort(), PINNED, "one pin per recorded file (the record itself excepted)");
  assert.ok(RF3_NEW_FILES.includes(RF3_RECORD));
  if (!LAYERED) {
    assert.equal(blobId("HEAD:" + RF3_RECORD), blobId(":" + RF3_RECORD), "the record is committed as staged");
    assert.equal(gitBlobId(readFileSync(join(REPO, RF3_RECORD))), blobId("HEAD:" + RF3_RECORD), "the record is committed as checked out");
  }
  const sets = [["committed", lines(gitIn(REPO, ["diff", "--name-only", RF3_PARENT, RF3_TREE, "--"]))]];
  if (!LAYERED) {                                                   // C07G-01 holds HEAD / index / working tree of the later tree
    sets.push(["staged", lines(gitIn(REPO, ["diff", "--name-only", "--cached", RF3_PARENT, "--"]))]);
    sets.push(["working tree (incl. every untracked path, ignored or not)", workingChanges(REPO, RF3_PARENT)]);
  }
  for (const [label, set] of sets)
    assert.deepEqual([...new Set(set)].sort(), SCOPE, label + ": the change set vs RF2 is exactly the RF3 scope");
  if (!LAYERED) assert.deepEqual(untrackedChanges(REPO), [], "no counted untracked path at all — no exclude source hides one");
  assert.deepEqual([...RF2_UNTRACKED_EXCLUDED], ["node_modules/", "test/historical/.deps/"], "the documented exclusions only");
  for (const f of SCOPE) { assert.ok(/^test\//.test(f), f + " is test-side"); assert.ok(!PROTECTED.test(f) && !isProtectedPath(f), f + " is not protected under either rule"); }
  for (const f of PINNED) {
    assert.match(RF3_PINS[f], /^[0-9a-f]{40}$/, f + ": literal blob id");
    assert.equal(blobId(RF3_TREE + ":" + f), RF3_PINS[f], f + " committed" + (LAYERED ? " (at the RF3 commit)" : ""));
    if (LAYERED) continue;
    assert.equal(blobId(":" + f), RF3_PINS[f], f + " staged");
    assert.equal(gitBlobId(readFileSync(join(REPO, f))), RF3_PINS[f], f + " checked out");
  }
  for (const f of RF3_NEW_FILES) assert.equal(blobId(`${RF3_PARENT}:${f}`), null, f + " is new");
  for (const f of RF3_MODIFIED) assert.notEqual(blobId(`${RF3_PARENT}:${f}`), RF3_PINS[f], f + " really changes");
  for (const f of ["database.rules.json", "test/emulator/database.rules.json"]) assert.equal(blobId(RF3_TREE + ":" + f), RF1_GATE_EXPECTATION, f + " is the integration Rules (unchanged)");
  for (const f of UNCHANGED_VS_RF2) { assert.ok(blobId(RF3_TREE + ":" + f), f + " exists"); assert.equal(blobId(RF3_TREE + ":" + f), blobId(`${RF3_PARENT}:${f}`), f + " is RF2's bytes"); }
  assert.deepEqual(lines(gitIn(REPO, ["diff", "--name-only", RF3_PARENT, RF3_TREE, "--", "src", "fincore", "api", "lib", "tools", "scripts", "docs", "index.html", "vercel.json", "package.json", "package-lock.json", "database.rules.json"])), [], "no runtime, tool, script, page, Rules or configuration byte moves");
  assert.deepEqual(lines(gitIn(REPO, ["diff", "--name-only", RF1_PARENT, RF3_TREE, "--"])).filter((f) => PROTECTED.test(f) || isProtectedPath(f)), [], "no protected file moves vs I7 either");
});

test("RF3G-02 the collector: no exclude source hides a file (info/exclude, a global excludes file, a root or nested .gitignore); a force-staged ignored file is staged; only the dependency paths are excluded (disposable repositories)", { skip: SKIP }, () => {
  const mod = codeOnly(read("test/support/rf2-rules-gate.mjs"));
  assert.ok(mod.includes('return lines(git(repo, ["ls-files", "--others"])).filter((f) => !isExcluded(f));'), "the collector lists every path not in the index");
  assert.ok(!mod.includes("--exclude-standard") && !/"--exclude(-from|-per-directory)?[=\"]|"-x"|"-X"/.test(mod), "no exclude source is honoured");
  const d = mkdtempSync(join(tmpdir(), "rf3-collector-")), g = mkdtempSync(join(tmpdir(), "rf3-global-"));
  const saved = process.env.GIT_CONFIG_GLOBAL;
  try {
    const run = (args) => spawnSync("git", ["-C", d, ...args], { encoding: "utf8" });
    const std = () => lines(run(["ls-files", "--others", "--exclude-standard"]));
    const touch = (f) => { mkdirSync(join(d, f, ".."), { recursive: true }); writeFileSync(join(d, f), "export const unapproved = true;\n"); };
    const commit = (m) => run(["-c", "user.name=x", "-c", "user.email=x@x", "-c", "commit.gpgsign=false", "commit", "-q", "--allow-empty", "-m", m]);
    run(["init", "-q"]); commit("base");
    assert.deepEqual(untrackedChanges(d), [], "CONTROL: nothing");
    // .git/info/exclude
    mkdirSync(join(d, ".git/info"), { recursive: true });
    touch("api/info-excluded.js"); appendFileSync(join(d, ".git/info/exclude"), "/api/info-excluded.js\n");
    assert.ok(!std().includes("api/info-excluded.js"), "(control: --exclude-standard hides it)");
    assert.deepEqual(untrackedChanges(d), ["api/info-excluded.js"], ".git/info/exclude hides nothing");
    // force-staged while ignored: a staged change and still a working change
    run(["add", "-f", "api/info-excluded.js"]);
    assert.deepEqual(lines(run(["diff", "--name-only", "--cached", "HEAD", "--"])), ["api/info-excluded.js"], "a force-staged ignored file is a staged change");
    assert.deepEqual(workingChanges(d, "HEAD"), ["api/info-excluded.js"]);
    run(["rm", "-q", "--cached", "api/info-excluded.js"]); rmSync(join(d, "api"), { recursive: true }); writeFileSync(join(d, ".git/info/exclude"), "");
    // a global core.excludesFile (this process only; the user's configuration is untouched)
    writeFileSync(join(g, "ignore"), "/src/analytics/global-excluded.ts\n"); writeFileSync(join(g, "config"), `[core]\n\texcludesFile = ${join(g, "ignore")}\n`);
    process.env.GIT_CONFIG_GLOBAL = join(g, "config");
    touch("src/analytics/global-excluded.ts");
    assert.ok(!std().includes("src/analytics/global-excluded.ts"), "(control: --exclude-standard hides it)");
    assert.deepEqual(untrackedChanges(d), ["src/analytics/global-excluded.ts"], "a global excludes file hides nothing");
    if (saved === undefined) delete process.env.GIT_CONFIG_GLOBAL; else process.env.GIT_CONFIG_GLOBAL = saved;
    rmSync(join(d, "src"), { recursive: true });
    // a root .gitignore, a nested one under a protected root, and the output-directory pattern (`*` + `!.gitignore`)
    writeFileSync(join(d, ".gitignore"), "lib/\n"); touch("lib/root-ignored.js");
    touch("api/nested-ignored.js"); writeFileSync(join(d, "api/.gitignore"), "nested-ignored.js\n");
    mkdirSync(join(d, "docs/production-readiness/output"), { recursive: true }); writeFileSync(join(d, "docs/production-readiness/output/.gitignore"), "*\n!.gitignore\n"); touch("docs/production-readiness/output/run.json");
    run(["add", ".gitignore", "api/.gitignore", "docs/production-readiness/output/.gitignore"]); commit("ignore files");
    for (const f of ["lib/root-ignored.js", "api/nested-ignored.js", "docs/production-readiness/output/run.json"]) assert.ok(!std().includes(f), `(control: --exclude-standard hides ${f})`);
    assert.deepEqual(untrackedChanges(d), ["api/nested-ignored.js", "docs/production-readiness/output/run.json", "lib/root-ignored.js"], "no .gitignore at any depth hides a file");
    for (const f of ["lib", "api/nested-ignored.js", "docs/production-readiness/output/run.json"]) rmSync(join(d, f), { recursive: true });
    // only the two documented dependency paths, as directories or as symlinks; look-alikes are counted
    touch("node_modules/x/index.js"); touch("test/historical/.deps/node_modules/y.js");
    assert.deepEqual(untrackedChanges(d), [], "the documented dependency directories are excluded");
    rmSync(join(d, "node_modules"), { recursive: true }); rmSync(join(d, "test/historical/.deps"), { recursive: true });
    mkdirSync(join(g, "deps")); symlinkSync(join(g, "deps"), join(d, "node_modules")); symlinkSync(join(g, "deps"), join(d, "test/historical/.deps"));
    assert.deepEqual(untrackedChanges(d), [], "the documented dependency symlinks are excluded");
    touch("node_modules-like/x.js"); touch("node_modules.js"); touch("test/historical/.deps-like/x.js");
    assert.deepEqual(untrackedChanges(d), ["node_modules-like/x.js", "node_modules.js", "test/historical/.deps-like/x.js"], "look-alikes are counted");
  } finally {
    if (saved === undefined) delete process.env.GIT_CONFIG_GLOBAL; else process.env.GIT_CONFIG_GLOBAL = saved;
    rmSync(d, { recursive: true, force: true }); rmSync(g, { recursive: true, force: true });
  }
});

test("RF3G-03 package completeness: the detached historical objects the guards and the RF packaging need are present as commits (never an undocumented transplant)", { skip: SKIP }, () => {
  assert.deepEqual(Object.keys(RF3_REQUIRED_HISTORICAL_OBJECTS).sort(), ["21a651d0bb6bd8f914745b36e5c6b6610d721c1a", "2a9df535b5a0c94940724158cf24c905f4cd17b6"]);
  assert.deepEqual(missingHistoricalObjects(REPO), [], "every required historical object is in this repository — ship them with the candidate (bundle refs source/owner-notice-ui-r1, codex/rules-canary-local-successor)");
  for (const id of Object.keys(RF3_REQUIRED_HISTORICAL_OBJECTS)) assert.notEqual(gitIn(REPO, ["merge-base", "--is-ancestor", id, "HEAD"]).status, 0, id + " is outside the candidate's ancestry (a one-ref bundle would drop it)");
  for (const f of ["test/finance/i1-integration-guard.test.mjs", "test/finance/owner-notice-ui-guard.test.mjs"]) assert.ok(read(f).includes("2a9df535"), f + " dereferences the UI commit");
});

test("RF3G-04 publication pending: the record validator carries the reviewed contract; no acceptance record is filled; the release pin is unchanged and the tree is NOT publication-ready", { skip: SKIP }, () => {
  assert.deepEqual([...ACCEPTANCE_FIELDS], ["rulesBlob", "rulesSha256", "acceptedBy", "acceptedAt", "scope", "recordRef", "reviewedBy", "reviewRef"], "the reviewed schema, every field required");
  const v = codeOnly(read("test/support/rules-owner-acceptance.mjs"));
  assert.ok(v.includes('if (!Object.hasOwn(record, f)) { bad(f, "missing"); continue; }') && v.includes("for (const f of ACCEPTANCE_FIELDS) {"), "required fields are checked by the schema, not by the record's own keys");
  assert.ok(v.includes('else if (bytes !== null && sha256(bytes) !== usable.rulesSha256) bad("rulesSha256", "sha256_mismatch");') && v.includes('bad("rulesSha256", "unverifiable")'), "the SHA-256 is the accepted blob's bytes, never shape alone");
  assert.ok(v.includes("export function isCalendarDate(s) {") && v.includes('if (!isCalendarDate(usable.acceptedAt)) bad("acceptedAt", "not_a_calendar_date");'), "a real calendar date");
  assert.equal(X.APPROVED_RULES_BLOB, RF1_RELEASE_PIN, "the release pin is unchanged (32ea32bf)");
  assert.notEqual(X.APPROVED_RULES_BLOB, X.CANDIDATE_RULES_BLOB, "the gate expectation is not the release pin: publication pending");
  assert.equal(X.RULES_OWNER_ACCEPTANCE, undefined, "no acceptance record exists in this tree");
  assert.equal(X.GATE_EXPECTATION_IS_ACCEPTED, undefined, "the proposal is not applied");
  assert.deepEqual(acceptanceRecordStatus(X, { readBlob: gitBlobReader(REPO) }), { status: "absent", publication: "pending (not established by any source fact)" }, "no record: NOT ready for a re-pin, publication pending");
  const holders = lines(gitIn(REPO, ["grep", "-l", "-E", "^export const RULES_OWNER_ACCEPTANCE\\b", "HEAD", "--"])).map((l) => l.replace(/^HEAD:/, ""));
  assert.deepEqual(holders, [], "no tracked file defines an acceptance record");
});

test("RF3G-05 layering: RF2G verifies the immutable RF2 object on this tree, RF1G the RF1 object, I7G the I7 object; RF2's module changes only in the collector; nothing skipped", { skip: SKIP }, () => {
  const rf2g = codeOnly(read("test/finance/rf2-rules-gate-guard.test.mjs"));
  assert.ok(rf2g.includes('import { isRF3Tree, RF3_PARENT } from "../support/rf3-rules-gate.mjs";'), "RF2G imports the RF3 layer");
  assert.ok(rf2g.includes("const LAYERED = isRF3Tree(REPO);") && rf2g.includes('const RF2_TREE = LAYERED ? RF3_PARENT : "HEAD";'), "RF2G reads the RF2 object when RF3 is checked out");
  assert.ok(rf2g.includes('if (LAYERED) assert.equal(RF2_TREE, "d4ac50ca80fbc62d7942ef9a14284968c0348630"'), "the RF2 commit itself is verified when layered");
  assert.ok(rf2g.includes('assert.equal(blobId(RF2_TREE + ":" + f), RF2_PINS[f]') && rf2g.includes('["diff", "--name-only", RF2_PARENT, RF2_TREE, "--"]') && !rf2g.includes('["diff", "--name-only", RF2_PARENT, "HEAD"'), "RF2G's pins and change set are judged at RF2_TREE");
  assert.ok(rf2g.includes("if (!LAYERED) {                                                   // RF3G-01 holds HEAD / index / working tree of the later tree"), "HEAD / index / working tree are RF3G-01's when layered");
  assert.ok(rf2g.includes('assert.deepEqual(untrackedChanges(d), [".gitignore", "ignored.js"], "an ignored file IS counted; the .gitignore itself too");'), "RF2G-03 asserts the corrected collector");
  // RF2's support module: identical to the RF2 object except the collector line (code only)
  const norm = (s) => codeOnly(s).replace('return lines(git(repo, ["ls-files", "--others"])).filter((f) => !isExcluded(f));', "<COLLECTOR>").replace('return lines(git(repo, ["ls-files", "--others", "--exclude-standard"])).filter((f) => !isExcluded(f));', "<COLLECTOR>");
  assert.equal(norm(read("test/support/rf2-rules-gate.mjs")), norm(at(RF3_PARENT, "test/support/rf2-rules-gate.mjs")), "test/support/rf2-rules-gate.mjs changes only in the collector");
  assert.ok(at(RF3_PARENT, "test/support/rf2-rules-gate.mjs").includes('["ls-files", "--others", "--exclude-standard"]'), "(the RF2 object's collector honoured exclude sources — the defect)");
  for (const f of ["test/finance/rf1-rules-gate-guard.test.mjs", "test/finance/rf2-rules-gate-guard.test.mjs", "test/finance/rf3-rules-gate-guard.test.mjs", "test/finance/i7-integration-guard.test.mjs", "test/storage-v2/rf3-rules-gate.test.mjs"]) {
    const t = codeOnly(read(f));
    assert.ok(!/test\([^\n]*\{ skip: true \}/.test(t) && !/test\.skip\(|test\.todo\(/.test(t), f + ": nothing is skipped unconditionally");
  }
});
