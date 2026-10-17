// RF2 guard — the Rules / test-fixture transition successor on RF1 (LOCAL author candidate; pending independent Codex review; T-RF2-*).
// Nothing here is an approval: it proves what the candidate IS. Behaviour: test/storage-v2/rf2-rules-gate.test.mjs RF-06..09 (+ RF-05')
// and the unchanged canary suites / RF-01..05.
//   RF2G-01 identity: sole parent the RF1 candidate 441d6716 (grandparent I7 5bae812c); the change set vs RF1 is exactly the recorded
//           test-side files at their literal pins — committed, staged, and in the working tree where EVERY untracked path outside the
//           documented dependency / output paths counts (RF1-R-02); no protected file under EITHER protected-path rule moves; both Rules
//           files, the release pin and the gate expectation are unchanged
//   RF2G-02 the fixture boundary in the source (RF1-R-01): three constructors and one judge; the ordinary fixture refuses every scope
//           override but the production switch; the candidate factory refuses them all and freezes; the diagnostic constructor requires a
//           reason, registers its output and never carries the candidate outside its scope; the candidate is never caller-selected; the
//           sentinel is no git object; the release-pin line and everything above it are I7's text (RV-G01); the lane is not carried
//   RF2G-03 the untracked collector (RF1-R-02): positive / negative controls on a disposable git repository — an untracked file under
//           api/, lib/, src/, scripts/, tools/, docs/, test/ or the root is a change; node_modules/ and test/historical/.deps/ are not
//   RF2G-04 layering: RF1G verifies the immutable RF1 object on this tree (imports isRF2Tree, reads RF1_TREE) and I7G the immutable
//           I7 object; the matrix, the M1 gate list and the retired lane are untouched; no `{ skip: true }`
// RF3 layering (T-RF3-LAYER; the RF1G-on-RF2 pattern): on a tree that carries RF3 on top of the RF2 candidate, RF2G-01 / 02 / 04
// verify the RF2 commit ITSELF (d4ac50ca) from git objects — sole parent RF1, the recorded test-side change set at its pins, the RF2
// source rules — and the HEAD / index / working-tree identity of the later tree is held by its own guard (RF3G-01). RF2G-03 tests the
// collector this tree ships: RF3 corrects it (the independent RF2 review's RF2-R-01) so an IGNORED untracked file is counted too.
import { historicalTest } from "../support/m1-a1-inspection.mjs";
const test = historicalTest(new URL("../../", import.meta.url), "7062046c0227a3647fbd034e83c9bcff937e79f6", "test/finance/rf2-rules-gate-guard.test.mjs");
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { REPO } from "../support/fincore-load.mjs";
import { gitIn } from "../support/git-context.mjs";
import { gitBlobId } from "../../tools/storage-v2/canary-transport.mjs";
import { isProtectedPath } from "../support/server-reader-authorized-delta.mjs";
import { RF1_PARENT, RF1_RELEASE_PIN, RF1_GATE_EXPECTATION, isRF1Tree } from "../support/rf1-rules-gate.mjs";
import { RF2_PARENT, RF2_GRANDPARENT, RF2_PINS, RF2_MODIFIED, RF2_NEW_FILES, RF2_RECORD, RF2_UNTRACKED_EXCLUDED, DIAGNOSTIC_SENTINEL, isRF2Tree, untrackedChanges, workingChanges } from "../support/rf2-rules-gate.mjs";
import { isRF3Tree, RF3_PARENT } from "../support/rf3-rules-gate.mjs";

const SKIP = !isRF2Tree(REPO) && "not an RF2 tree";
const LAYERED = isRF3Tree(REPO);
const RF2_TREE = LAYERED ? RF3_PARENT : "HEAD";          // the RF2 commit itself when the RF3 layer is checked out
const PROTECTED = /^(src\/|fincore\/|api\/|lib\/|database\.rules\.json$|test\/support\/rules-authorized-delta\.mjs$|test\/emulator\/database\.rules\.json$|index\.html$|vercel\.json$|package(-lock)?\.json$)/;
const blobId = (spec) => { const r = gitIn(REPO, ["rev-parse", "--verify", "-q", spec]); return r.status === 0 ? r.stdout.trim() : null; };
const lines = (r) => r.stdout.split("\n").map((x) => x.trim()).filter(Boolean);
const read = (f) => (LAYERED ? gitIn(REPO, ["cat-file", "blob", `${RF2_TREE}:${f}`]).stdout : readFileSync(join(REPO, f), "utf8"));
const parentText = (f) => gitIn(REPO, ["cat-file", "blob", `${RF2_PARENT}:${f}`]).stdout;
const codeOnly = (s) => s.split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n");
const SCOPE = [...RF2_MODIFIED, ...RF2_NEW_FILES].sort(), PINNED = SCOPE.filter((f) => f !== RF2_RECORD);

test("RF2G-01 identity: sole parent the RF1 candidate; the change set vs RF1 is exactly the recorded test-side files at their pins (committed / staged / working tree incl. every counted untracked path); no protected file moves", { skip: SKIP }, () => {
  assert.equal(RF2_PARENT, "441d6716e2fcfca81818485f58ff878a763619da", "built on the RF1 candidate");
  assert.equal(RF2_GRANDPARENT, RF1_PARENT, "RF1's recorded parent is the I7 candidate");
  if (LAYERED) assert.equal(RF2_TREE, "d4ac50ca80fbc62d7942ef9a14284968c0348630", "the RF2 candidate commit itself is verified");
  assert.equal(gitIn(REPO, ["rev-parse", RF2_TREE + "^"]).stdout.trim(), RF2_PARENT, "the RF1 candidate is the SOLE parent");
  assert.equal(lines(gitIn(REPO, ["rev-list", "--parents", "-n1", RF2_TREE]))[0].split(" ").length, 2, "exactly one parent");
  assert.equal(gitIn(REPO, ["rev-parse", RF2_PARENT + "^"]).stdout.trim(), RF2_GRANDPARENT, "the RF1 object's sole parent is I7");
  assert.ok(isRF1Tree(REPO), "an RF2 tree is an RF1 tree (I7 is a strict ancestor)");
  assert.ok(SCOPE.length >= 7, "the recorded scope is populated");
  assert.deepEqual(Object.keys(RF2_PINS).sort(), PINNED, "one pin per recorded file (the record itself excepted)");
  assert.ok(RF2_NEW_FILES.includes(RF2_RECORD));
  if (!LAYERED) {
    assert.equal(blobId("HEAD:" + RF2_RECORD), blobId(":" + RF2_RECORD), "the record is committed as staged");
    assert.equal(gitBlobId(readFileSync(join(REPO, RF2_RECORD))), blobId("HEAD:" + RF2_RECORD), "the record is committed as checked out");
  }
  const sets = [["committed", lines(gitIn(REPO, ["diff", "--name-only", RF2_PARENT, RF2_TREE, "--"]))]];
  if (!LAYERED) {                                                   // RF3G-01 holds HEAD / index / working tree of the later tree
    sets.push(["staged", lines(gitIn(REPO, ["diff", "--name-only", "--cached", RF2_PARENT, "--"]))]);
    sets.push(["working tree (incl. every untracked path, ignored or not)", workingChanges(REPO, RF2_PARENT)]);
  }
  for (const [label, set] of sets)
    assert.deepEqual([...new Set(set)].sort(), SCOPE, label + ": the change set vs RF1 is exactly the RF2 scope");
  if (!LAYERED) assert.deepEqual(untrackedChanges(REPO), [], "no counted untracked path at all");
  assert.deepEqual([...RF2_UNTRACKED_EXCLUDED], ["node_modules/", "test/historical/.deps/"], "the documented exclusions only");
  for (const f of SCOPE) { assert.ok(/^test\//.test(f), f + " is test-side"); assert.ok(!PROTECTED.test(f) && !isProtectedPath(f), f + " is not protected under either rule"); }
  for (const f of PINNED) {
    assert.match(RF2_PINS[f], /^[0-9a-f]{40}$/, f + ": literal blob id");
    assert.equal(blobId(RF2_TREE + ":" + f), RF2_PINS[f], f + " committed" + (LAYERED ? " (at the RF2 commit)" : ""));
    if (LAYERED) continue;
    assert.equal(blobId(":" + f), RF2_PINS[f], f + " staged");
    assert.equal(gitBlobId(readFileSync(join(REPO, f))), RF2_PINS[f], f + " checked out");
  }
  for (const f of RF2_NEW_FILES) assert.equal(blobId(`${RF2_PARENT}:${f}`), null, f + " is new");
  for (const f of RF2_MODIFIED) assert.notEqual(blobId(`${RF2_PARENT}:${f}`), RF2_PINS[f], f + " really changes");
  for (const f of ["database.rules.json", "test/emulator/database.rules.json"]) assert.equal(blobId(RF2_TREE + ":" + f), RF1_GATE_EXPECTATION, f + " is the integration Rules (unchanged)");
  assert.deepEqual(lines(gitIn(REPO, ["diff", "--name-only", RF2_PARENT, RF2_TREE, "--", "src", "fincore", "api", "lib", "tools", "scripts", "docs", "index.html", "vercel.json", "package.json", "package-lock.json"])), [], "no runtime, tool, script, page or configuration byte moves");
  assert.deepEqual(lines(gitIn(REPO, ["diff", "--name-only", RF2_GRANDPARENT, RF2_TREE, "--"])).filter((f) => PROTECTED.test(f) || isProtectedPath(f)), [], "no protected file moves vs I7 either");
});

test("RF2G-02 the fixture boundary in the source: three constructors, one judge, the candidate confined and never selected; the sentinel; RV-G01's text; the lane absent", { skip: SKIP }, () => {
  const fx = read("test/support/canary-fixtures.mjs"), fx1 = parentText("test/support/canary-fixtures.mjs"), g = codeOnly(fx);
  const pinLine = `export const APPROVED_RULES_BLOB = "${RF1_RELEASE_PIN}";`;
  assert.ok(fx.includes(pinLine) && (fx.match(/export const APPROVED_RULES_BLOB/g) || []).length === 1, "the release pin literal is unchanged");
  const head = (s) => s.slice(0, s.indexOf(pinLine) + pinLine.length);
  assert.equal(head(fx), head(fx1), "everything up to and including the release pin line is RF1's (= I7's) text");
  assert.ok(fx.includes(`export const CANDIDATE_RULES_BLOB = "${RF1_GATE_EXPECTATION}";`), "the candidate expectation literal is unchanged");
  assert.ok(fx.includes(`export const DIAGNOSTIC_RULES_BLOB = "${DIAGNOSTIC_SENTINEL}";`), "the sentinel literal");
  assert.equal(gitIn(REPO, ["cat-file", "-e", DIAGNOSTIC_SENTINEL]).status !== 0, true, "the sentinel is no git object");
  assert.ok(![RF1_RELEASE_PIN, RF1_GATE_EXPECTATION].includes(DIAGNOSTIC_SENTINEL));
  // the judge and the scope
  assert.ok(g.includes('export function isCandidateScope(m) { return !!m && m.environment === "emulator" && m.projectId === EMU_PROJECT && m.databaseURL === EMU_URL; }'), "the exact scope: emulator, the demo project, the loopback namespace URL");
  assert.ok(g.includes("export function assertCandidateScope(m) {") && g.includes('if (pin === CANDIDATE_RULES_BLOB && !isCandidateScope(m)) throw scopeError("candidate_scope_refused"') && g.includes('if (m && m.environment === "production" && pin === CANDIDATE_RULES_BLOB) throw scopeError("candidate_scope_refused"'), "the judge refuses the candidate outside its scope and on any production shape");
  assert.ok(g.includes('const SCOPE_KEYS = Object.freeze(["environment", "projectId", "databaseURL", "approved"]);'), "the four scope categories (RC-L04)");
  // the ordinary fixture: refuses the four categories except the production switch; judged after the merge
  const mf = g.slice(g.indexOf("export function manifestFor(over = {}) {"), g.indexOf("function buildManifest("));
  assert.ok(mf.includes('for (const k of SCOPE_KEYS) if (Object.hasOwn(over, k) && !(k === "environment" && over.environment === "production")) throw scopeError("candidate_scope_refused"'), "manifestFor refuses scope overrides");
  assert.ok(mf.includes("return assertCandidateScope(buildManifest(over));"), "manifestFor judges the FINAL object");
  // the candidate factory: refuses every scope key, judges and freezes the exact scope
  const cm = g.slice(g.indexOf("export function candidateManifest(over = {}) {"), g.indexOf("export function diagnosticManifest("));
  assert.ok(cm.includes('for (const k of SCOPE_KEYS) if (Object.hasOwn(over, k)) throw scopeError("candidate_scope_refused"') && cm.includes('if (!isCandidateScope(m) || m.approved.rulesBlob !== CANDIDATE_RULES_BLOB) throw scopeError("candidate_scope_refused"') && cm.includes("return deepFreeze(assertCandidateScope(m));"), "candidateManifest: RC-L04 semantics, judged, frozen");
  // the diagnostic constructor: reason required, candidate never selected, judged, registered
  const dm = g.slice(g.indexOf("export function diagnosticManifest(over = {}, reason) {"), g.indexOf("export function manifestFor("));
  assert.ok(dm.includes('if (typeof reason !== "string" || !reason.trim()) throw scopeError("diagnostic_reason_required"') && dm.includes("refuseSelectedCandidatePin(over);") && dm.includes("const m = assertCandidateScope(buildManifest(over));") && dm.includes("DIAGNOSTIC.add(m);"), "diagnosticManifest: explicit, confined, registered");
  assert.ok(g.includes('const refuseSelectedCandidatePin = (over) => { if (over && over.approved && typeof over.approved === "object" && over.approved.rulesBlob === CANDIDATE_RULES_BLOB) throw scopeError("candidate_pin_selection_refused"'), "the candidate is never a selected pin");
  assert.ok(!/export function manifestFor[\s\S]*?deepMerge\(m, over\);\s*\n\}/.test(mf), "no un-judged merge path is exported");
  assert.equal((g.match(/return deepMerge\(m, over\);/g) || []).length, 1, "the merge happens in exactly one private builder");
  assert.ok(!/export function buildManifest/.test(g), "the raw builder is private");
  // every fixture consumer of a scope override goes through the diagnostic constructor (RF-06..08 call the ordinary fixture with
  // overrides only to assert the refusal, so the RF2 test file is checked for that shape separately)
  for (const f of ["test/storage-v2/canary-contract.test.mjs", "test/storage-v2/canary-transport.test.mjs", "test/storage-v2/rf1-rules-gate.test.mjs", "test/storage-v2/canary-cli.test.mjs"]) {
    const t = codeOnly(read(f));
    for (const m of t.matchAll(/X\.manifestFor\((\{[^)]*\})\)/g)) assert.ok(!/projectId|databaseURL|approved|environment: "(?!production")/.test(m[1]), `${f}: an ordinary manifestFor carries no scope override (${m[1].slice(0, 60)})`);
    assert.ok(!/manifestFor\(\{[^)]*environment: "staging"/.test(t), f + ": no staging shape through the ordinary fixture");
  }
  const rf2t = codeOnly(read("test/storage-v2/rf2-rules-gate.test.mjs"));
  assert.ok(rf2t.includes('refused(() => X.manifestFor(over), "candidate_scope_refused");') && rf2t.includes('refused(() => X.candidateManifest(over), "candidate_scope_refused");') && rf2t.includes('"candidate_pin_selection_refused");'), "RF-06 asserts the refusals");
  assert.ok(rf2t.includes("assert.equal(produced, null, \"no production-shaped candidate manifest is produced\");"), "RF-07 asserts no fixture path produces the RF1 forcing");
  // every RF row is retained AT HEAD (RF1G reads the RF1 object when layered, so the later tree must keep them itself); none is skipped
  const rf1t = read("test/storage-v2/rf1-rules-gate.test.mjs"), rf2tAll = read("test/storage-v2/rf2-rules-gate.test.mjs");
  for (const id of ["RF-01", "RF-02", "RF-03", "RF-04", "RF-05"]) assert.equal((rf1t.match(new RegExp(`\\ntest\\("${id} `, "g")) || []).length, 1, id + " retained at HEAD");
  for (const id of ["RF-06", "RF-07", "RF-08", "RF-09", "RF-05'"]) assert.equal((rf2tAll.match(new RegExp(`\\ntest\\("${id.replace("'", "'")} `, "g")) || []).length, 1, id + " present at HEAD");
  for (const [f, t] of [["rf1-rules-gate.test.mjs", rf1t], ["rf2-rules-gate.test.mjs", rf2tAll]]) assert.ok(!/test\.skip\(|test\.todo\(|\{ skip: /.test(codeOnly(t)), f + ": no skipped or todo row");
  assert.ok(rf1t.includes('test("RF-02 (RC-L01)'), "RF-02 (the stale pin refused) is present at HEAD");
  // RF-05 and the matrix: unchanged RF1 bytes; the lane is not carried
  assert.equal(blobId(RF2_TREE + ":test/emulator/canary-operator-matrix.mjs"), blobId(`${RF2_PARENT}:test/emulator/canary-operator-matrix.mjs`), "the matrix is RF1's bytes");
  for (const f of ["test/support/rules-canary-local-candidate.mjs", "test/emulator/rules-canary-local-candidate-matrix.mjs", "test/storage-v2/rules-canary-local-candidate.test.mjs"]) assert.equal(blobId(RF2_TREE + ":" + f), null, f + " (the retired Codex lane) is not carried");
  for (const f of ["test/finance/f1-r1-review-state.test.mjs", "test/support/rules-authorized-delta.mjs", "tools/storage-v2/canary.mjs", "tools/storage-v2/canary-transport.mjs", "tools/storage-v2/canary-contract.mjs", "test/support/m1-run-gates.sh", "test/support/p1-r7-emu-run.sh"])
    assert.equal(blobId(RF2_TREE + ":" + f), blobId(`${RF1_PARENT}:${f}`), f + " is I7's bytes");
});

test("RF2G-03 the untracked collector: an untracked file under api/, lib/, src/, scripts/, tools/, docs/, test/ or the root is a change — ignored or not (RF3); node_modules/ and test/historical/.deps/ are not (disposable repository)", { skip: SKIP }, () => {
  const d = mkdtempSync(join(tmpdir(), "rf2-collector-"));
  try {
    const run = (args) => spawnSync("git", ["-C", d, ...args], { encoding: "utf8" });
    run(["init", "-q"]); run(["-c", "user.name=x", "-c", "user.email=x@x", "commit", "-q", "--allow-empty", "-m", "base"]);
    const touch = (f) => { mkdirSync(join(d, f, ".."), { recursive: true }); writeFileSync(join(d, f), "export const unapproved = true;\n"); };
    assert.deepEqual(untrackedChanges(d), [], "CONTROL: nothing");
    const cases = ["api/rf-unapproved.js", "lib/rf-unapproved.js", "src/rf-unapproved.ts", "src/analytics/rf-unapproved.ts", "scripts/rf-unapproved.mjs", "tools/storage-v2/rf-unapproved.mjs", "docs/production-readiness/lib/rf-unapproved.mjs", "test/finance/rf-unapproved.test.mjs", "test/emulator/rf-unapproved.rules.json", "fincore/v1/rf-unapproved.js", "rf-unapproved.json"];
    for (const f of cases) { touch(f); assert.deepEqual(untrackedChanges(d), [f], f + " is a change"); rmSync(join(d, f)); }
    touch("node_modules/x/index.js"); touch("test/historical/.deps/node_modules/y.js");
    assert.deepEqual(untrackedChanges(d), [], "the documented dependency paths are excluded");
    touch("node_modules-like/x.js"); assert.deepEqual(untrackedChanges(d), ["node_modules-like/x.js"], "a look-alike directory is not excluded");
    rmSync(join(d, "node_modules-like"), { recursive: true });
    // RF3 (RF2-R-01): NO git exclude source hides a file from the collector — an ignored file is counted, and so is the .gitignore
    writeFileSync(join(d, ".gitignore"), "ignored.js\n"); touch("ignored.js");
    assert.deepEqual(untrackedChanges(d), [".gitignore", "ignored.js"], "an ignored file IS counted; the .gitignore itself too");
    assert.ok(!run(["ls-files", "--others", "--exclude-standard"]).stdout.split("\n").includes("ignored.js"), "(control: --exclude-standard would hide it)");
    assert.equal(blobId(RF2_TREE + ":.gitignore"), null, "this repository has no root .gitignore");
    // the full working set: tracked dirt + untracked, ignored or not
    run(["add", ".gitignore"]); run(["-c", "user.name=x", "-c", "user.email=x@x", "commit", "-q", "-m", "gi"]);
    writeFileSync(join(d, ".gitignore"), "ignored.js\nmore\n"); touch("api/z.js");
    assert.deepEqual(workingChanges(d, "HEAD"), [".gitignore", "api/z.js", "ignored.js"]);
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test("RF2G-04 layering: RF1G verifies the immutable RF1 object on this tree and I7G the immutable I7 object; nothing skipped; the gate list and the matrix unchanged", { skip: SKIP }, () => {
  const rf1g = codeOnly(read("test/finance/rf1-rules-gate-guard.test.mjs"));
  assert.ok(rf1g.includes('import { isRF2Tree, RF2_PARENT, untrackedChanges } from "../support/rf2-rules-gate.mjs";'), "RF1G imports the RF2 layer and the corrected collector");
  assert.ok(rf1g.includes("const LAYERED = isRF2Tree(REPO);") && rf1g.includes('const RF1_TREE = LAYERED ? RF2_PARENT : "HEAD";'), "RF1G reads the RF1 object when RF2 is checked out");
  assert.ok(rf1g.includes('if (LAYERED) assert.equal(RF1_TREE, "441d6716e2fcfca81818485f58ff878a763619da"'), "the RF1 commit itself is verified when layered");
  assert.ok(rf1g.includes("...untrackedChanges(REPO)]"), "RF1G's unlayered working-tree set uses the corrected collector");
  assert.ok(!/\.filter\(\(f\) => \/\^test\\\/\/\.test\(f\)\)/.test(rf1g), "the test/-only untracked filter is gone");
  assert.ok(!rf1g.includes('gitIn(REPO, ["rev-parse", "HEAD^"])'), "RF1G no longer asserts HEAD's parent directly");
  const i7g = codeOnly(read("test/finance/i7-integration-guard.test.mjs"));
  assert.ok(i7g.includes('import { isRF1Tree, RF1_PARENT } from "../support/rf1-rules-gate.mjs";') && i7g.includes("const I7_TREE = LAYERED ? RF1_PARENT :"), "I7G verifies the I7 object (RF1's layering, unchanged)");
  assert.equal(blobId(RF2_TREE + ":test/finance/i7-integration-guard.test.mjs"), blobId(`${RF2_PARENT}:test/finance/i7-integration-guard.test.mjs`), "I7G unchanged");
  for (const f of ["test/finance/rf1-rules-gate-guard.test.mjs", "test/finance/rf2-rules-gate-guard.test.mjs", "test/finance/i7-integration-guard.test.mjs"]) assert.ok(!/test\([^\n]*\{ skip: true \}/.test(codeOnly(read(f))), f + ": nothing is skipped unconditionally");
  assert.equal(blobId(RF2_TREE + ":test/support/m1-run-gates.sh"), blobId(`${RF2_PARENT}:test/support/m1-run-gates.sh`), "the M1 gate list is unchanged");
  assert.equal(blobId(RF2_TREE + ":test/support/rf1-rules-gate.json"), blobId(`${RF2_PARENT}:test/support/rf1-rules-gate.json`), "the RF1 record is unchanged");
  assert.equal(blobId(RF2_TREE + ":test/support/rf1-rules-gate.mjs"), blobId(`${RF2_PARENT}:test/support/rf1-rules-gate.mjs`), "the RF1 support module is unchanged");
});
