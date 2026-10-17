// BF3 discovery correction, sole parent immutable BF2 a43b69bf (then BF1 cbc8e3a6, then I7).
// Authored by Codex after the BF2 independent review; awaiting independent acceptance. Pins are not acceptance.
//   BF2G-01 identity: sole parent BF2, whose sole parent is BF1; against BF1 AND against I7 the protected change set is exactly the one
//           script — committed, staged, and in the working tree where EVERY path not in the index counts, ignored or not (BF1-R-03),
//           outside the two dependency paths; the script is at the BF2 pin in HEAD / index / working tree; every inherited pin holds;
//           the committed change set vs BF1 is exactly the BF2 scope, and vs BF2 exactly the two BF3 test/support files
//   BF2G-02 exact record; BF1 record and chain unchanged; no reader allowlist / protected root widened; projection fails closed
//   BF2G-03 altered / staged / committed / missing / forged-record / BF1-record substitutions cannot project
//   BF2G-04 the collector (BF1-R-03) on disposable repositories: neither .git/info/exclude, nor a global core.excludesFile, nor a root or
//           nested .gitignore hides a file; a force-staged ignored file is a staged change; only the two dependency paths (directory or
//           symlink of exactly that name) are left out; look-alikes and non-ASCII names are counted; each control is shown to be hidden
//           by `--exclude-standard`, so it is meaningful; an ignored untracked scripts/ or lib/ file in a clone of THIS tree is caught
//   BF2G-05 layering: BF1G judges the immutable BF1 commit; I7G, S0, ADB-06 and the server-reader collector are BF1's bytes; the BF1
//           support module changes only by the BF2 delegation; nothing is skipped
//   BF3G-01 nested-repository discovery: actual descendants (including nested Git, ignored and non-ASCII paths) are counted;
//           metadata is omitted, symlinks are not traversed, and a benign nested repository has no protected change
import { historicalTest } from "../support/m1-a1-inspection.mjs";
const test = historicalTest(new URL("../../", import.meta.url), "3a3b6ff21632d76563eae95c6a8717e1cc263f76", "test/finance/bf2-backfill-layer-guard.test.mjs");
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, appendFileSync, rmSync, mkdtempSync, mkdirSync, symlinkSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { REPO } from "../support/fincore-load.mjs";
import { gitIn } from "../support/git-context.mjs";
import { gitBlobId, m1EffectivePins } from "../support/m1-r1-remediation.mjs";
import { isProtectedPath, collectServerReaderScopeInputs, serverReaderScopeVerdict } from "../support/server-reader-authorized-delta.mjs";
import { bf1Projection, BF1_PIN } from "../support/bf1-backfill-layer.mjs";
import { BF2_PARENT, BF2_GRANDPARENT, BF2_FILE, BF2_PIN, BF2_PARENT_BLOB, BF2_RECORD_FILE, BF1_RECORD_FILE, BF2_UNTRACKED_EXCLUDED,
  isBF2Tree, untrackedPaths, changeSets, bf2RecordVerdict, bf2Projection } from "../support/bf2-backfill-layer.mjs";

const rev = (root, s) => { const r = gitIn(root, ["rev-parse", "--verify", "-q", s]); return r.status === 0 ? r.stdout.trim() : null; };
const lines = (r) => r.stdout.split("\n").filter(Boolean);
const read = (f) => readFileSync(join(REPO, f), "utf8");
const at = (commit, f) => gitIn(REPO, ["cat-file", "blob", `${commit}:${f}`]).stdout;
// the BF1 guard's protected predicate, unchanged
const protectedPath = (p) => /^(src\/|fincore\/|api\/|lib\/|index\.html$|test\/support\/rules-authorized-delta\.mjs$|test\/emulator\/database\.rules\.json$)/.test(p) || isProtectedPath(p);
const SCOPE = [BF2_FILE, "test/emulator/backfill-registry-cli-emulator.mjs", "test/finance/backfill-registry-gate.test.mjs",
  "test/finance/bf1-backfill-layer-guard.test.mjs", "test/finance/bf2-backfill-layer-guard.test.mjs", "test/support/bf1-backfill-layer.mjs",
  BF2_RECORD_FILE, "test/support/bf2-backfill-layer.mjs"].sort();
const BF3_PARENT = "a43b69bf56ae4153044daed0065457a60c49c444";
const BF3_SCOPE = ["test/finance/bf2-backfill-layer-guard.test.mjs", "test/support/bf2-backfill-layer.mjs"];
const commit = (dir, m) => gitIn(dir, ["-c", "user.name=Local Test", "-c", "user.email=test@example.invalid", "-c", "commit.gpgsign=false", "commit", "-qm", m]);

test("BF2G-01 BF3 sole-parent BF2 child, BF2 sole-parent BF1 child; exactly one protected runtime delta vs BF1 and vs I7 (committed / staged / working tree incl. every ignored untracked path); every inherited pin retained", () => {
  assert.ok(isBF2Tree(REPO), "a BF2 tree");
  assert.equal(rev(REPO, "HEAD^"), BF3_PARENT, "the BF2 candidate is the SOLE parent");
  assert.equal(lines(gitIn(REPO, ["rev-list", "--parents", "-n1", "HEAD"]))[0].split(" ").length, 2, "exactly one parent");
  assert.equal(rev(REPO, `${BF3_PARENT}^`), BF2_PARENT, "BF2's sole parent is BF1");
  assert.equal(lines(gitIn(REPO, ["rev-list", "--parents", "-n1", BF3_PARENT]))[0].split(" ").length, 2, "BF2 has exactly one parent");
  assert.deepEqual(changeSets(REPO, BF3_PARENT).committed, BF3_SCOPE, "exactly the two BF3 discovery/guard files; no runtime delta from BF2");
  assert.equal(rev(REPO, `${BF2_PARENT}^`), BF2_GRANDPARENT, "BF1's sole parent is I7");
  assert.deepEqual([...BF2_UNTRACKED_EXCLUDED], ["node_modules/", "test/historical/.deps/"], "the documented exclusions only");
  for (const base of [BF2_PARENT, BF2_GRANDPARENT]) {
    const sets = changeSets(REPO, base);
    for (const [label, set] of Object.entries(sets)) assert.deepEqual(set.filter(protectedPath), [BF2_FILE], `${label} vs ${base.slice(0, 8)}: exactly the one protected script`);
  }
  assert.deepEqual(untrackedPaths(REPO).filter(protectedPath), [], "no protected path outside the index, ignored or not");
  assert.deepEqual(changeSets(REPO, BF2_PARENT).committed, SCOPE, "the committed change set vs BF1 is exactly the BF2 scope");
  assert.equal(rev(REPO, `HEAD:${BF2_FILE}`), BF2_PIN, "committed"); assert.equal(rev(REPO, `:${BF2_FILE}`), BF2_PIN, "staged");
  assert.equal(gitBlobId(readFileSync(join(REPO, BF2_FILE))), BF2_PIN, "checked out");
  for (const [f, pin] of Object.entries(m1EffectivePins(REPO))) {
    assert.equal(rev(REPO, `HEAD:${f}`), pin, f); assert.equal(rev(REPO, `:${f}`), pin, f);
    assert.equal(gitBlobId(readFileSync(join(REPO, f))), pin, f);
  }
});

test("BF2G-02 exact record; the BF1 record and chain unchanged; no reader allowlist or protected root widened; projection fails closed", () => {
  assert.equal(BF2_PARENT_BLOB, "672365e20a388db42f3e127741e0f5a9ca4d5967", "the BF1 pin");
  assert.equal(BF2_PARENT_BLOB, BF1_PIN, "chained to the BF1 record");
  assert.equal(BF2_PIN, "25754ea6e7f81585b0d68101da5c51ebcff6de48");
  assert.deepEqual(bf2RecordVerdict(REPO), { ok: true });
  const record = JSON.parse(read(BF2_RECORD_FILE));
  for (const [forged, reason] of [[{ pin: "0".repeat(40) }, "unknown_pin"], [{ file: "scripts/other.mjs" }, "record_scope"], [{ parent: BF2_GRANDPARENT }, "record_scope"],
    [{ parentBlob: "1".repeat(40) }, "parent_blob"], [{ pin: BF2_PARENT_BLOB }, "pin_shape"]])
    assert.equal(bf2RecordVerdict(REPO, { ...record, ...forged }).reason, reason, JSON.stringify(forged));
  assert.equal(rev(REPO, `HEAD:${BF1_RECORD_FILE}`), rev(REPO, `${BF2_PARENT}:${BF1_RECORD_FILE}`), "the BF1 record is BF1's");
  const raw = collectServerReaderScopeInputs(REPO);
  assert.ok(raw.bf1.ok && raw.bf1.layered && raw.bf1.layer === "bf2", "the collector's script projection is BF2's verdict");
  assert.ok(raw.changedProtectedPathsUnprojected.includes(BF2_FILE));
  assert.ok(!raw.changedProtectedPaths.includes(BF2_FILE));
  assert.deepEqual(serverReaderScopeVerdict({ ...raw, changedProtectedPaths: [BF2_FILE] }), { ok: false, reason: "unauthorized_protected_path", detail: [BF2_FILE] }, "the reader table alone still refuses the stored-data script");
  const stray = "scripts/unreviewed.mjs";
  assert.ok(bf2Projection(REPO, [BF2_FILE, stray]).projected.includes(stray), "only the exact script is projected");
  assert.deepEqual(serverReaderScopeVerdict({ ...raw, changedProtectedPaths: [stray] }), { ok: false, reason: "unauthorized_protected_path", detail: [stray] });
});

test("BF2G-03 altered, staged, committed, missing, forged-record and BF1-record substitutions cannot project", () => {
  const dir = mkdtempSync(join(tmpdir(), "bf2-guard-"));
  try {
    const clone = gitIn(REPO, ["clone", "--quiet", "--shared", REPO, dir]); assert.equal(clone.status, 0, clone.stderr);
    const p = join(dir, BF2_FILE), bytes = readFileSync(p);
    assert.ok(bf1Projection(dir, [BF2_FILE]).ok && bf2Projection(dir, [BF2_FILE]).ok, "CONTROL");
    appendFileSync(p, "\n// mutation\n");
    for (const f of [bf1Projection, bf2Projection]) assert.equal(f(dir, [BF2_FILE]).reason, "script_content_mismatch");
    assert.equal(gitIn(dir, ["add", BF2_FILE]).status, 0); writeFileSync(p, bytes);
    for (const f of [bf1Projection, bf2Projection]) assert.equal(f(dir, [BF2_FILE]).reason, "script_history_mismatch", "staged altered bytes despite clean working bytes");
    assert.equal(commit(dir, "mutation").status, 0); assert.equal(gitIn(dir, ["add", BF2_FILE]).status, 0);
    for (const f of [bf1Projection, bf2Projection]) assert.equal(f(dir, [BF2_FILE]).reason, "script_history_mismatch", "committed altered bytes despite restored index and working bytes");
    rmSync(p); assert.equal(bf2Projection(dir, [BF2_FILE]).reason, "script_missing");
  } finally { rmSync(dir, { recursive: true, force: true }); }
  const d2 = mkdtempSync(join(tmpdir(), "bf2-guard-rec-"));
  try {
    assert.equal(gitIn(REPO, ["clone", "--quiet", "--shared", REPO, d2]).status, 0);
    // a BF1-record edit (even one that keeps the JSON valid) is refused by the chain check
    const r1 = join(d2, BF1_RECORD_FILE); writeFileSync(r1, readFileSync(r1, "utf8").replace("\n}", ',\n  "note": "x"\n}'));
    assert.equal(bf2RecordVerdict(d2).reason, "bf1_record_changed"); assert.equal(bf1Projection(d2, [BF2_FILE]).ok, false);
    rmSync(r1); assert.equal(bf2RecordVerdict(d2).reason, "bf1_record_missing");
  } finally { rmSync(d2, { recursive: true, force: true }); }
});

test("BF2G-04 the collector counts every path not in the index, ignored or not (info/exclude, global excludes, .gitignore at any depth, force-staged); only the two dependency paths are left out", () => {
  const src = read("test/support/bf2-backfill-layer.mjs");
  assert.ok(src.includes('zlist(gitIn(root, ["ls-files", "--others", "-z"]), "ls-files --others")'), "the collector lists every path not in the index (NUL-separated)");
  assert.ok(!src.includes("--exclude-standard") && !/"--exclude(-from|-per-directory)?[="]|"-x"|"-X"|"--ignored"/.test(src), "no exclude source is honoured");
  const d = mkdtempSync(join(tmpdir(), "bf2-collector-")), g = mkdtempSync(join(tmpdir(), "bf2-global-"));
  const saved = process.env.GIT_CONFIG_GLOBAL;
  try {
    const run = (args) => gitIn(d, args);
    const touch = (f, body = "x\n") => { mkdirSync(dirname(join(d, f)), { recursive: true }); writeFileSync(join(d, f), body); };
    const std = () => lines(run(["ls-files", "--others", "--exclude-standard"]));
    process.env.GIT_CONFIG_GLOBAL = join(g, "gitconfig"); writeFileSync(process.env.GIT_CONFIG_GLOBAL, "");
    assert.equal(spawnSync("git", ["init", "-q", d], { encoding: "utf8" }).status, 0);
    for (const f of ["api/a.js", "lib/b.js", "scripts/c.mjs", "README.md"]) touch(f);
    assert.equal(run(["add", "-A"]).status, 0); assert.equal(commit(d, "base").status, 0);
    assert.deepEqual(untrackedPaths(d), [], "CONTROL: nothing");
    touch("scripts/info-excluded.mjs"); appendFileSync(join(d, ".git/info/exclude"), "/scripts/info-excluded.mjs\n");
    assert.ok(!std().includes("scripts/info-excluded.mjs"), "(control: --exclude-standard hides it)");
    assert.deepEqual(untrackedPaths(d), ["scripts/info-excluded.mjs"], ".git/info/exclude hides nothing");
    assert.deepEqual(changeSets(d, "HEAD").working, ["scripts/info-excluded.mjs"]);
    rmSync(join(d, "scripts/info-excluded.mjs"));
    writeFileSync(join(g, "ignore"), "global-excluded.js\n"); writeFileSync(process.env.GIT_CONFIG_GLOBAL, `[core]\n\texcludesFile = ${join(g, "ignore")}\n`);
    touch("lib/global-excluded.js");
    assert.ok(!std().includes("lib/global-excluded.js"), "(control: a global core.excludesFile hides it)");
    assert.deepEqual(untrackedPaths(d), ["lib/global-excluded.js"], "a global excludes file hides nothing");
    rmSync(join(d, "lib/global-excluded.js")); writeFileSync(process.env.GIT_CONFIG_GLOBAL, "");
    touch(".gitignore", "lib/root-ignored.js\n"); touch("api/.gitignore", "nested-ignored.js\n"); touch("src/out/.gitignore", "*\n");
    touch("lib/root-ignored.js"); touch("api/nested-ignored.js"); touch("src/out/run.json");
    assert.deepEqual(std(), [".gitignore", "api/.gitignore"], "(control: --exclude-standard hides all three, and the `*` directory's own .gitignore)");
    assert.deepEqual(untrackedPaths(d), [".gitignore", "api/.gitignore", "api/nested-ignored.js", "lib/root-ignored.js", "src/out/.gitignore", "src/out/run.json"], "no .gitignore at any depth hides a file");
    assert.equal(run(["add", "-f", "lib/root-ignored.js"]).status, 0);
    assert.deepEqual(changeSets(d, "HEAD").staged, ["lib/root-ignored.js"], "a force-staged ignored file is a staged change");
    assert.equal(run(["rm", "-q", "--cached", "lib/root-ignored.js"]).status, 0);
    for (const f of [".gitignore", "api/.gitignore", "api/nested-ignored.js", "lib/root-ignored.js", "src/out/.gitignore", "src/out/run.json"]) rmSync(join(d, f));
    appendFileSync(join(d, "api/a.js"), "dirty\n");
    assert.deepEqual(changeSets(d, "HEAD").working, ["api/a.js"], "a dirty tracked file");
    assert.equal(run(["checkout", "--", "api/a.js"]).status, 0);
    touch("node_modules/x/scripts/y.js"); touch("test/historical/.deps/node_modules/z/scripts/w.js");
    assert.deepEqual(untrackedPaths(d), [], "the documented dependency directories are left out");
    rmSync(join(d, "node_modules"), { recursive: true }); rmSync(join(d, "test"), { recursive: true });
    mkdirSync(join(d, "test/historical"), { recursive: true }); symlinkSync(g, join(d, "node_modules"), "dir"); symlinkSync(g, join(d, "test/historical/.deps"), "dir");
    assert.deepEqual(untrackedPaths(d), [], "the documented dependency symlinks are left out");
    touch("node_modules-like/x.js"); touch("node_modules.js"); touch("test/historical/.deps-like/x.js"); touch("lib/node_modules/evil.js"); touch("scripts/בדיקה.mjs");
    assert.deepEqual(untrackedPaths(d), ["lib/node_modules/evil.js", "node_modules-like/x.js", "node_modules.js", "scripts/בדיקה.mjs", "test/historical/.deps-like/x.js"].sort(), "look-alikes, a nested node_modules and a non-ASCII name are counted, unquoted");
    assert.ok(untrackedPaths(d).filter(protectedPath).includes("scripts/בדיקה.mjs"), "a non-ASCII protected name stays protected");
  } finally {
    if (saved === undefined) delete process.env.GIT_CONFIG_GLOBAL; else process.env.GIT_CONFIG_GLOBAL = saved;
    rmSync(d, { recursive: true, force: true }); rmSync(g, { recursive: true, force: true });
  }
  // the review's tamper on a clone of THIS tree: an ignored untracked scripts/ or lib/ file is a protected working-tree change
  const c = mkdtempSync(join(tmpdir(), "bf2-ignored-"));
  try {
    assert.equal(gitIn(REPO, ["clone", "--quiet", "--shared", REPO, c]).status, 0);
    assert.deepEqual(changeSets(c, BF2_PARENT).working.filter(protectedPath), [BF2_FILE], "CONTROL");
    for (const f of ["scripts/unreviewed.mjs", "lib/unreviewed.js"]) {
      writeFileSync(join(c, f), "export const x = 1;\n"); appendFileSync(join(c, ".git/info/exclude"), "/" + f + "\n");
      assert.ok(!lines(gitIn(c, ["ls-files", "--others", "--exclude-standard"])).includes(f), f + ": (control: hidden from --exclude-standard)");
      assert.deepEqual(changeSets(c, BF2_PARENT).working.filter(protectedPath), [BF2_FILE, f].sort(), f + ": caught although ignored");
      rmSync(join(c, f));
    }
  } finally { rmSync(c, { recursive: true, force: true }); }
});

test("BF2G-05 layering: BF1G judges the immutable BF1 commit; I7G, S0, ADB-06 and the server-reader collector are BF1's bytes; the BF1 support module changes only by the BF2 delegation; nothing is skipped", () => {
  const bf1g = read("test/finance/bf1-backfill-layer-guard.test.mjs");
  assert.ok(bf1g.includes('import { isBF2Tree, BF2_PARENT } from "../support/bf2-backfill-layer.mjs";') && bf1g.includes('const BF1_TREE = LAYERED ? BF2_PARENT : "HEAD";'), "BF1G verifies the BF1 object on a BF2 tree");
  assert.ok(!bf1g.includes('rev("HEAD^")'), "BF1G no longer asserts HEAD's parent directly");
  for (const f of ["test/finance/i7-integration-guard.test.mjs", "test/finance/s0-guard-server-reader-mutations.test.mjs", "test/finance/adb06-builder-layer-guard.test.mjs",
    "test/support/server-reader-authorized-delta.mjs", BF1_RECORD_FILE, "test/security/biz-access.test.mjs", "test/emulator/backfill-registry-gate-emulator.mjs", "lib/businessRegistry.js", "lib/bizAccess.js", "lib/securityContext.js"])
    assert.equal(rev(REPO, `HEAD:${f}`), rev(REPO, `${BF2_PARENT}:${f}`), f + " unchanged from BF1");
  const strip = (s) => s.split("\n").filter((l) => !/BF2/.test(l)).join("\n");
  assert.equal(strip(read("test/support/bf1-backfill-layer.mjs")), strip(at(BF2_PARENT, "test/support/bf1-backfill-layer.mjs")), "the BF1 module changes only in lines naming BF2");
  assert.equal(read("test/support/bf1-backfill-layer.mjs").split("\n").filter((l) => /BF2/.test(l)).length, 5, "exactly the five BF2 lines (comment, import, two comment lines, delegation)");
  // the script changes only in main()'s initialization (BF1-R-01): the pure core, the gate and the commit are BF1's bytes
  const body = (s) => s.slice(s.indexOf("// ── PURE CORE"), s.indexOf("// ── CLI (guarded"));
  const tail = (s) => s.slice(s.indexOf("/** The plan / reconcile / cleanup / apply flow"));
  assert.equal(body(read(BF2_FILE)), body(at(BF2_PARENT, BF2_FILE)), "pure core unchanged"); assert.ok(body(read(BF2_FILE)).length > 5000);
  assert.equal(tail(read(BF2_FILE)), tail(at(BF2_PARENT, BF2_FILE)), "runBackfill and the entry guard unchanged"); assert.ok(tail(read(BF2_FILE)).length > 3000);
  assert.ok(read(BF2_FILE).includes('const admin = (await import("firebase-admin")).default;'), "the real (CommonJS default) namespace");
  const SKIPPED = new RegExp("\\bskip" + "\\s*:\\s*(SKIP\\b|true\\b|[\"'`])");   // built from parts so this file does not match itself
  for (const f of ["test/finance/bf1-backfill-layer-guard.test.mjs", "test/finance/bf2-backfill-layer-guard.test.mjs", "test/finance/backfill-registry-gate.test.mjs"])
    assert.ok(!SKIPPED.test(read(f)), f + ": nothing is skipped");
});

test("BF3G-01 opaque untracked repositories expose protected descendants; benign repositories, Git metadata and symlink targets do not cause incidental refusals", () => {
  for (const layout of ["git-directory", "git-pointer-file"]) {
    const d = mkdtempSync(join(tmpdir(), "bf3-nested-")), meta = mkdtempSync(join(tmpdir(), "bf3-metadata-"));
    try {
      const init = (root, extra = []) => assert.equal(spawnSync("git", ["init", "-q", ...extra, root], { encoding: "utf8" }).status, 0);
      const touch = (f, body = "x\n") => { mkdirSync(dirname(join(d, f)), { recursive: true }); writeFileSync(join(d, f), body); };
      init(d); touch("README.md"); assert.equal(gitIn(d, ["add", "README.md"]).status, 0); assert.equal(commit(d, "base").status, 0);
      const prefix = "vendor/unreviewed", nested = join(d, prefix);
      mkdirSync(nested, { recursive: true });
      init(nested, layout === "git-pointer-file" ? [`--separate-git-dir=${join(meta, "git")}`] : []);
      touch(`${prefix}/README.md`);
      // The metadata's scripts directory must not be confused with working-tree content.
      const gitdir = layout === "git-pointer-file" ? join(meta, "git") : join(nested, ".git");
      mkdirSync(join(gitdir, "scripts")); writeFileSync(join(gitdir, "scripts/not-source.mjs"), "metadata\n");
      assert.deepEqual(gitIn(d, ["ls-files", "--others", "-z"]).stdout.split("\0").filter(Boolean), [`${prefix}/`], `${layout}: Git's opaque entry reproduces the boundary`);
      assert.deepEqual(changeSets(d, "HEAD").working.filter(protectedPath), [], `${layout}: benign control has no protected file`);
      const protectedFiles = [`${prefix}/scripts/run.mjs`, `${prefix}/scripts/בדיקה\nחדשה.mjs`, `${prefix}/migrations/move.mjs`,
        `${prefix}/lib/node_modules/scripts/inside.mjs`, `${prefix}/deeper/child/scripts/tracked.mjs`].sort();
      for (const f of protectedFiles) touch(f);
      // Even a file tracked by the inner repository is untracked by the outer one.
      const child = join(nested, "deeper/child"); init(child);
      assert.equal(gitIn(child, ["add", "scripts/tracked.mjs"]).status, 0); assert.equal(commit(child, "inner tracked file").status, 0);
      touch(`${prefix}/.gitignore`, "scripts/\nmigrations/\nlib/\n");
      appendFileSync(join(gitdir, "info/exclude"), "scripts/\n");
      symlinkSync(d, join(nested, "cycle"), "dir");
      const ignores = [readFileSync(join(gitdir, "info/exclude")), readFileSync(join(nested, ".gitignore"))];
      assert.deepEqual(changeSets(d, "HEAD").working.filter(protectedPath), protectedFiles, `${layout}: detection is attributable to the protected descendants only`);
      assert.deepEqual(untrackedPaths(d), [...protectedFiles, `${prefix}/README.md`, `${prefix}/.gitignore`, `${prefix}/cycle`].sort(), `${layout}: exact working-tree paths, without metadata or symlink traversal`);
      assert.deepEqual([readFileSync(join(gitdir, "info/exclude")), readFileSync(join(nested, ".gitignore"))], ignores, "discovery never edits ignore settings");
    } finally { rmSync(d, { recursive: true, force: true }); rmSync(meta, { recursive: true, force: true }); }
  }
});
