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
// RC 1.0 release assembly — the separately approved sources (exact commits; see the assembly handoff)
const P0 = "05bf5a59cd62bcfde2bc74f3ab0b9d38ba619661";      // P0 Scheduled Auth (codex-p0-scheduled-auth-review: APPROVED)
const HF1R1 = "9dea13f5d15af96699cbc91a34d0af841fe2e5af";   // HF-1 R1 (hf1-remediation-r1 independent review: APPROVED)
const HF1_BASE = "f5d0a8edffc216f0b6ad342f8bd1bb0d630276ab"; // merge base of the RC lineage and HF-1 R1
const P0_APPROVED = ["api/analytics/daily-builder.ts", "api/daily-snapshot/run.ts", "api/proactive/run.ts"];
// repository-independent git plumbing (run OUTSIDE any checkout, so a relocated worktree's
// unreadable .git pointer cannot break it; repository objects are read only through gitIn)
const hashBytes = (bytes) => { const r = spawnSync("git", ["hash-object", "--stdin"], { input: bytes, encoding: "utf8", cwd: tmpdir() }); assert.equal(r.status, 0, r.stderr); return r.stdout.trim(); };
/** The ONE approved index.html of the assembled tree: the clean (conflict-free) 3-way merge of the approved CD-M2 R1 and HF-1 R1 blobs over their merge base, computed from the git objects. */
function approvedIndexMerge(root, theirs = HF1R1) {
  const dir = mkdtempSync(join(tmpdir(), "rca-index-"));
  try {
    const put = (n, spec) => { const p = join(dir, n); writeFileSync(p, blobBytes(root, spec)); return p; };
    const ours = put("ours", CDM2R1 + ":index.html"), base = put("base", HF1_BASE + ":index.html"), other = put("theirs", theirs + ":index.html");
    const r = spawnSync("git", ["merge-file", "-p", ours, base, other], { encoding: "buffer", maxBuffer: 64 * 1024 * 1024, cwd: dir });
    assert.equal(r.status, 0, "the approved index.html sources must merge without conflict: " + String(r.stderr));
    return r.stdout;
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
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
    // RC 1.0 release assembly: when the approved HF-1 R1 commit (which carries the approved P0
    // Scheduled Auth commit as its ancestor) is integrated, the protected set grows by EXACTLY P0's
    // three API routes, pinned to P0's approved blobs, and index.html must be EXACTLY the clean
    // 3-way merge of the two approved index.html blobs (CD-M2 R1 ⊕ HF-1 R1 over their merge base).
    const assembled = gitIn(root, ["merge-base", "--is-ancestor", HF1R1, "HEAD"]).status === 0;
    const allowed = assembled ? [...CDM2_APPROVED, ...P0_APPROVED] : CDM2_APPROVED;
    const whole = [...names(["diff", "--name-only", BASE, "--"]), ...untracked].filter((f) => PROTECTED.test(f));
    assert.deepEqual([...new Set(whole)].sort(), [...allowed].sort(), assembled
      ? "assembled tree: protected changes are exactly CD-M2 R1's approved runtime files + P0 Scheduled Auth's three API routes"
      : "integrated tree: protected changes are exactly CD-M2 R1's approved runtime files");
    assert.equal(gitIn(root, ["merge-base", "--is-ancestor", CDM2R1, "HEAD"]).status, 0, "…and they come from the approved CD-M2 R1 lineage");
    if (assembled) assert.equal(gitIn(root, ["merge-base", "--is-ancestor", P0, "HEAD"]).status, 0, "…and the approved P0 Scheduled Auth lineage");
    // the approved content of each runtime file: [file, expected blob bytes, label]
    const expected = [
      ...(assembled ? [] : [["index.html", blobBytes(root, CDM2R1 + ":index.html"), CDM2R1.slice(0, 8) + ":index.html"]]),
      ["lib/repositories/entryExceptionsRepo.js", blobBytes(root, CDM2R1 + ":lib/repositories/entryExceptionsRepo.js"), CDM2R1.slice(0, 8) + ":lib/repositories/entryExceptionsRepo.js"],
      [SB, blobBytes(root, B2 + ":" + SB), B2.slice(0, 8) + ":" + SB],
      [SE, blobBytes(root, B2 + ":" + SE), B2.slice(0, 8) + ":" + SE],
      ...(assembled ? [
        ["index.html", approvedIndexMerge(root), "merge(" + CDM2R1.slice(0, 8) + ", " + HF1R1.slice(0, 8) + ")"],
        ...P0_APPROVED.map((f) => [f, blobBytes(root, P0 + ":" + f), P0.slice(0, 8) + ":" + f]),
      ] : []),
    ];
    // RC hardening (independent RC review, B2G-05 checkout-content finding): the committed blob is
    // not enough — the COMMITTED blob, the CHECKED-OUT bytes and the staged (index) entry of every
    // approved runtime file must equal the approved content exactly, so a local edit fails here.
    for (const [f, bytes, label] of expected) {
      const sha = hashBytes(bytes);
      assert.equal(gitIn(root, ["rev-parse", "HEAD:" + f]).stdout.trim(), sha, f + " is byte-identical to the approved " + label);
      assert.ok(readFileSync(join(root, f)).equals(bytes), f + ": checked-out bytes differ from the approved blob " + label);
      assert.equal(gitIn(root, ["rev-parse", ":" + f]).stdout.trim(), sha, f + ": staged (index) blob differs from the approved blob");
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
const isAssembledRepo = isIntegratedRepo && gitIn(REPO, ["merge-base", "--is-ancestor", HF1R1, "HEAD"]).status === 0;
const appendTo = (dir, f, text) => { writeFileSync(join(dir, f), readFileSync(join(dir, f), "utf8") + text); };

test("B2G-05-M1 integrated tree: a WORKING-TREE-ONLY edit of an approved CD-M2 runtime file (history unchanged) fails the guard; the clean clone passes", { skip: !isIntegratedRepo && "standalone tree: the integrated exception does not apply" }, () => {
  withClone(HEAD_SHA, (dir) => {
    assertB2Scope(dir);                                                 // positive control on the exact commit
    for (const f of ["index.html", "lib/repositories/entryExceptionsRepo.js", ...(isAssembledRepo ? P0_APPROVED : [])]) {
      const before = readFileSync(join(dir, f));
      appendTo(dir, f, "\n// local edit\n");
      assert.equal(gitIn(dir, ["rev-parse", "HEAD"]).stdout.trim(), HEAD_SHA, "history unchanged");
      assert.equal(gitIn(dir, ["rev-parse", "HEAD:" + f]).stdout.trim(), gitIn(REPO, ["rev-parse", HEAD_SHA + ":" + f]).stdout.trim(), "committed blob still the approved one");
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

// ── RC 1.0 release assembly: committed (history-level) substitutions of the approved sources fail ──
const commitIn = (dir, msg) => { assert.equal(spawnSync("git", ["-C", dir, "add", "-A"]).status, 0); const c = spawnSync("git", ["-C", dir, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", msg], { encoding: "utf8" }); assert.equal(c.status, 0, c.stderr); };
test("B2G-05-M4 assembled tree: committing a non-approved index.html (CD-M2 R1 alone, HF-1 alone, or the merge with the REJECTED HF-1 95d20d86), pre-P0 API bytes, or a stray API file fails; the exact assembled commit passes", { skip: !isAssembledRepo && "HF-1 R1 / P0 not integrated in this tree" }, () => {
  const REJECTED_HF1 = "95d20d8646736fe1c80c949924fa7875fbda90d2";
  const cases = [
    ["index.html = CD-M2 R1 only (HF-1 dropped)", (dir) => writeFileSync(join(dir, "index.html"), blobBytes(dir, CDM2R1 + ":index.html")), /index\.html is byte-identical to the approved merge/],
    ["index.html = HF-1 R1 only (CD-M2 dropped)", (dir) => writeFileSync(join(dir, "index.html"), blobBytes(dir, HF1R1 + ":index.html")), /index\.html is byte-identical to the approved merge/],
    ["index.html = CD-M2 R1 ⊕ REJECTED HF-1 95d20d86", (dir) => writeFileSync(join(dir, "index.html"), approvedIndexMerge(dir, REJECTED_HF1)), /index\.html is byte-identical to the approved merge/],
    ...P0_APPROVED.map((f) => ["pre-P0 bytes of " + f, (dir) => writeFileSync(join(dir, f), blobBytes(dir, HF1_BASE + ":" + f)), /protected changes are exactly CD-M2 R1's approved runtime files \+ P0 Scheduled Auth's three API routes/]), // pre-P0 bytes = the base bytes ⇒ the route drops out of the exact set
    ["a committed edit of the P0 run.ts", (dir) => appendTo(dir, "api/daily-snapshot/run.ts", "\n// edit\n"), /api\/daily-snapshot\/run\.ts is byte-identical to the approved 05bf5a59/],
    ["a stray API route", (dir) => writeFileSync(join(dir, "api", "stray.ts"), "export default function h() {}\n"), /protected changes are exactly/],
  ];
  withClone(HEAD_SHA, (dir) => assertB2Scope(dir));                     // positive control
  for (const [label, mut, re] of cases) {
    withClone(HEAD_SHA, (dir) => {
      mut(dir); commitIn(dir, label);
      assert.throws(() => assertB2Scope(dir), re, label);
    });
  }
});
