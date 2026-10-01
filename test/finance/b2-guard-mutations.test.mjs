// Financial Core B2 successor — CD-AT30 / B2-G30 / B2-G31: the narrow guard changes accept ONLY
// the reviewed B2 ownership and bytes. Mutants of the REAL repository inputs: an unauthorized
// consumer, a cross-category duplicate, globs / directories / stray paths, stale or altered
// snapshot bytes (including the never-approved checkpoint blobs) and an edited B1 pin all fail;
// Layer A and the four B1 reader pins are unchanged.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { REPO } from "../support/fincore-load.mjs";
import { gitIn } from "../support/git-context.mjs";
import { importerVerdict, loadConsumerFiles, repoKindOf, validateConsumerFiles } from "../support/b1-fixtures.mjs";
import { SERVER_READER_APPROVED_BLOBS, collectServerReaderScopeInputs, serverReaderScopeVerdict } from "../support/server-reader-authorized-delta.mjs";

const SB = "src/snapshot/snapshotBuilder.ts", SE = "src/snapshot/snapshotEmail.ts";
const read = (rel) => readFileSync(join(REPO, rel), "utf8");
const real = () => loadConsumerFiles(REPO).map((f) => ({ name: f.name, json: JSON.parse(JSON.stringify(f.json)) }));
const b2Of = (files) => files.find((f) => f.name === "b2.json");
const errors = (files) => validateConsumerFiles(files, repoKindOf(REPO)).errors;

test("B2G-01 the committed B2 ownership: e-mail = the ONLY B2 core consumer, builder = the ONLY B2 server-API consumer; no finance-server helper", () => {
  assert.deepEqual(b2Of(real()).json, { slice: "B2", consumers: [SE], serverApiConsumers: [SB] });
  assert.deepEqual(errors(real()), []);
  assert.equal(repoKindOf(REPO)("src/finance-server/canonicalSnapshot.ts"), null, "B2-R01: the broad helper is gone");
});

test("B2G-02 mutants of b2.json fail: cross-category duplicate, glob, directory, stray/missing path, a B1 path claimed by B2", () => {
  const cases = [
    [(b) => { b.json.serverApiConsumers.push(SE); }, /duplicate serverApiConsumers entry src\/snapshot\/snapshotEmail\.ts/],
    [(b) => { b.json.consumers.push(SB); }, /duplicate serverApiConsumers entry src\/snapshot\/snapshotBuilder\.ts \(also in b2\.json:consumers\)/],
    [(b) => { b.json.consumers = ["src/snapshot/*.ts"]; }, /glob/],
    [(b) => { b.json.consumers = ["src/snapshot"]; }, /directory/],
    [(b) => { b.json.consumers = ["src/snapshot/"]; }, /not_exact_path/],
    [(b) => { b.json.consumers = ["src/finance-server/canonicalSnapshot.ts"]; }, /missing_file/],
    [(b) => { b.json.serverApiConsumers = ["src/analytics/dailyBuilder.ts"]; }, /duplicate serverApiConsumers entry src\/analytics\/dailyBuilder\.ts/],
  ];
  for (const [mut, re] of cases) {
    const files = real(); mut(b2Of(files));
    assert.ok(errors(files).some((e) => re.test(e)), re + " → " + JSON.stringify(errors(files)));
  }
});

test("B2G-03 importer mutants fail: the builder importing the core, the e-mail importing the server API, an unlisted snapshot helper", () => {
  const v = validateConsumerFiles(real(), repoKindOf(REPO));
  const sources = { [SB]: read(SB), [SE]: read(SE) };
  assert.deepEqual(importerVerdict(sources, v), { ok: true, unlistedCore: [], unlistedServer: [] });
  const withCore = { ...sources, [SB]: read(SB) + '\nimport { ratioOfTotals } from "../metrics/report.js";\n' };
  assert.deepEqual(importerVerdict(withCore, v).unlistedCore, [SB]);
  const withServer = { ...sources, [SE]: read(SE) + '\nimport type { ServerProvenance } from "../finance-server/canonicalMetrics.js";\n' };
  assert.deepEqual(importerVerdict(withServer, v).unlistedServer, [SE]);
  const helper = { ...sources, "src/snapshot/snapshotView.ts": 'import { ratioOfTotals } from "../metrics/report.js";' };
  assert.deepEqual(importerVerdict(helper, v).unlistedCore, ["src/snapshot/snapshotView.ts"]);
});

test("B2G-04 pins: the reviewed builder/e-mail bytes pass; stale (pre-B2, checkpoint c16ac110) or altered bytes fail; the four B1 pins are the approved ones", () => {
  assert.deepEqual([SERVER_READER_APPROVED_BLOBS["src/analytics/dailyBuilder.ts"], SERVER_READER_APPROVED_BLOBS["src/repositories/analytics/dailyMetricsRepo.ts"], SERVER_READER_APPROVED_BLOBS["src/repositories/analytics/laborRepo.ts"], SERVER_READER_APPROVED_BLOBS["src/repositories/analytics/purchasesRepo.ts"]].map((h) => h.slice(0, 8)), ["6b70d03c", "4a5cb8f8", "14eff463", "7916308f"]);
  const inputs = collectServerReaderScopeInputs(REPO);
  const fence = (raw) => ({ ...raw, changedProtectedPaths: raw.changedProtectedPaths.filter((r) => r !== "database.rules.json") });
  assert.deepEqual(serverReaderScopeVerdict(fence(inputs)), { ok: true });
  const CHECKPOINT = "c16ac110e29913bcab9e6c598fa4b508c8f9fc63";
  for (const rev of ["4675eb20a97e8750429fad3e2ebda94f42f187b5", CHECKPOINT]) {
    for (const f of [SB, SE]) {
      const blob = gitIn(REPO, ["rev-parse", `${rev}:${f}`]);
      if (blob.status !== 0) continue; // the checkpoint object may be absent from a shallow review clone
      const m = fence({ ...inputs, blobs: { ...inputs.blobs, [f]: blob.stdout.trim() } });
      assert.equal(serverReaderScopeVerdict(m).reason, "approved_content_mismatch", `${f} @ ${rev.slice(0, 8)}`);
    }
  }
  const stray = fence({ ...inputs, changedProtectedPaths: [...inputs.changedProtectedPaths, "src/snapshot/snapshotView.ts"] });
  assert.deepEqual(serverReaderScopeVerdict(stray), { ok: false, reason: "unauthorized_protected_path", detail: ["src/snapshot/snapshotView.ts"] }, "a stray protected snapshot file fails");
  const altered = fence({ ...inputs, blobs: { ...inputs.blobs, [SE]: "0".repeat(40) } });
  assert.equal(serverReaderScopeVerdict(altered).reason, "approved_content_mismatch");
});

const BASE = "6d54e36752a5e04891127e2f62c8ea2571c61511";
const B2 = "3fd28e7c6b7001004ebd25b0dd92eb3ffe1cddac";
const CDM2R1 = "38af03c207010de2045b101c7d012d8de78a8b5a";
const PROTECTED = /^(src\/(finance|metrics|policy|presenters|browser|finance-server)\/|fincore\/|api\/|lib\/|database\.rules\.json$|test\/support\/rules-authorized-delta\.mjs$|index\.html$)/;
/** git object bytes (exact, no text decoding) */
const blobBytes = (root, spec) => { const r = gitIn(root, ["cat-file", "blob", spec], { encoding: "buffer" }); assert.equal(r.status, 0, "git object " + spec); return r.stdout; };
/**
 * The B2G-05 scope contract for the tree at `root` (committed history AND the checked-out files).
 * Throws an AssertionError on any violation. Used on the real repository and on disposable clones.
 */
function assertB2Scope(root) {
  const names = (args) => gitIn(root, args).stdout.trim().split("\n").filter(Boolean);
  const untracked = names(["ls-files", "--others", "--exclude-standard"]);
  // RC 1.0 integration: when the approved B2 commit is an ANCESTOR of HEAD (an integrated tree),
  // B2's own scope is checked on B2's exact approved commit delta, and the rest of the tree may
  // carry ONLY the separately approved CD-M2 R1 runtime surface. On a standalone B2 tree (B2 not
  // an ancestor, or B2 itself) the original whole-tree check below applies unchanged.
  const integrated = gitIn(root, ["merge-base", "--is-ancestor", B2, "HEAD"]).status === 0 && names(["rev-parse", "HEAD"])[0] !== B2;
  const b2Delta = integrated ? names(["diff", "--name-only", BASE, B2, "--"]) : [...names(["diff", "--name-only", BASE, "--"]), ...untracked];
  for (const f of b2Delta) assert.doesNotMatch(f, PROTECTED, "B2 must not touch " + f);
  const runtime = b2Delta.filter((f) => /^src\//.test(f));
  assert.deepEqual(runtime.sort(), [SB, SE], "B2 runtime edits: exactly the two snapshot files");
  if (integrated) {
    // the ONLY protected paths the integrated tree may change: CD-M2 R1's approved client + repository fix
    const CDM2_APPROVED = ["index.html", "lib/repositories/entryExceptionsRepo.js"];
    const whole = [...names(["diff", "--name-only", BASE, "--"]), ...untracked].filter((f) => PROTECTED.test(f));
    assert.deepEqual([...new Set(whole)].sort(), CDM2_APPROVED, "integrated tree: protected changes are exactly CD-M2 R1's approved runtime files");
    assert.equal(gitIn(root, ["merge-base", "--is-ancestor", CDM2R1, "HEAD"]).status, 0, "…and they come from the approved CD-M2 R1 lineage");
    for (const f of CDM2_APPROVED) assert.equal(gitIn(root, ["rev-parse", "HEAD:" + f]).stdout.trim(), gitIn(root, ["rev-parse", CDM2R1 + ":" + f]).stdout.trim(), f + " is byte-identical to approved CD-M2 R1");
    // RC hardening (independent RC review, B2G-05 checkout-content finding): the committed blob is
    // not enough — the CHECKED-OUT bytes and the staged (index) entry of every approved runtime file
    // must equal the approved commit's blob exactly, so an unstaged or staged local edit fails here.
    const APPROVED_SOURCES = [...CDM2_APPROVED.map((f) => [f, CDM2R1]), [SB, B2], [SE, B2]];
    for (const [f, src] of APPROVED_SOURCES) {
      const approved = blobBytes(root, src + ":" + f);
      assert.ok(readFileSync(join(root, f)).equals(approved), f + ": checked-out bytes differ from the approved blob " + src.slice(0, 8) + ":" + f);
      assert.equal(gitIn(root, ["rev-parse", ":" + f]).stdout.trim(), gitIn(root, ["rev-parse", src + ":" + f]).stdout.trim(), f + ": staged (index) blob differs from the approved blob");
    }
  }
}

test("B2G-05 Layer A / Rules / delivery surface unchanged relative to the approved CD-M1 predecessor; B2 edits no core, fincore, productFinance or server API (B2-G27/G28)", () => {
  assertB2Scope(REPO);
});

// ── B2G-05 regression: the guard sees the CHECKED-OUT tree, not only git metadata ───────────
// Each case runs on a disposable checkout: a fresh `git init` whose object store borrows this
// repository's objects read-only (objects/info/alternates) — no refs are copied, and nothing here
// touches this checkout, its index, refs, locks or worktrees — detached at an exact commit.
function withClone(commit, fn) {
  const objects = gitIn(REPO, ["rev-parse", "--path-format=absolute", "--git-path", "objects"]).stdout.trim();
  const common = gitIn(REPO, ["rev-parse", "--path-format=absolute", "--git-common-dir"]).stdout.trim();
  const alt = existsSync(objects) ? objects : join(common, "objects");
  const dir = mkdtempSync(join(tmpdir(), "b2g05-"));
  try {
    const c = spawnSync("git", ["init", "-q", dir], { encoding: "utf8" });
    assert.equal(c.status, 0, c.stderr);
    writeFileSync(join(dir, ".git", "objects", "info", "alternates"), alt + "\n");
    const co = spawnSync("git", ["-C", dir, "-c", "advice.detachedHead=false", "checkout", "-q", "--detach", commit], { encoding: "utf8" });
    assert.equal(co.status, 0, co.stderr);
    return fn(dir);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
const HEAD_SHA = gitIn(REPO, ["rev-parse", "HEAD"]).stdout.trim();
const isIntegratedRepo = gitIn(REPO, ["merge-base", "--is-ancestor", B2, "HEAD"]).status === 0 && HEAD_SHA !== B2;
const appendTo = (dir, f, text) => { writeFileSync(join(dir, f), readFileSync(join(dir, f), "utf8") + text); };

test("B2G-05-M1 integrated tree: a WORKING-TREE-ONLY edit of an approved CD-M2 runtime file (history unchanged) fails the guard; the clean clone passes", { skip: !isIntegratedRepo && "standalone tree: the integrated exception does not apply" }, () => {
  withClone(HEAD_SHA, (dir) => {
    assertB2Scope(dir);                                                 // positive control on the exact commit
    for (const f of ["index.html", "lib/repositories/entryExceptionsRepo.js"]) {
      const before = readFileSync(join(dir, f));
      appendTo(dir, f, "\n// local edit\n");
      assert.equal(gitIn(dir, ["rev-parse", "HEAD"]).stdout.trim(), HEAD_SHA, "history unchanged");
      assert.equal(gitIn(dir, ["rev-parse", "HEAD:" + f]).stdout.trim(), gitIn(dir, ["rev-parse", CDM2R1 + ":" + f]).stdout.trim(), "committed blob still the approved one");
      assert.throws(() => assertB2Scope(dir), new RegExp(f.replace(/[.\/]/g, "\\$&") + ": checked-out bytes differ"), f + " unstaged edit must fail");
      // a STAGED edit with the checked-out file restored also fails (index ≠ approved)
      assert.equal(spawnSync("git", ["-C", dir, "add", f]).status, 0);
      writeFileSync(join(dir, f), before);
      assert.throws(() => assertB2Scope(dir), /staged \(index\) blob differs/, f + " staged edit must fail");
      assert.equal(spawnSync("git", ["-C", dir, "reset", "-q", "--", f]).status, 0);
      assertB2Scope(dir);                                               // restored ⇒ passes again
    }
    // the B2 runtime files are covered the same way
    appendTo(dir, SE, "\n// local edit\n");
    assert.throws(() => assertB2Scope(dir), /snapshotEmail\.ts: checked-out bytes differ/);
  });
});

test("B2G-05-M2 integrated tree: editing an unrelated NON-protected file in the working tree is not a false failure", { skip: !isIntegratedRepo && "standalone tree" }, () => {
  withClone(HEAD_SHA, (dir) => {
    appendTo(dir, "test/emulator/README.md", "\nlocal note\n");
    writeFileSync(join(dir, "scratch-note.txt"), "untracked, not protected\n");
    assertB2Scope(dir);
  });
});

test("B2G-05-M3 standalone approved B2 tree: unchanged behaviour — the exact B2 commit passes; a working-tree edit of index.html fails as before", () => {
  withClone(B2, (dir) => {
    assertB2Scope(dir);
    appendTo(dir, "index.html", "\n<!-- local edit -->\n");
    assert.throws(() => assertB2Scope(dir), /B2 must not touch index\.html/);
  });
});
