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
import { C1_ASSEMBLY, c1IndexVerdict } from "../support/c1-index-scope.mjs";
import { C1_INDEX_PIN } from "../support/c1-candidate-pin.mjs";
import { P1_BASE, p1IndexVerdict } from "../support/p1-index-scope.mjs";
import { P1_PINS } from "../support/p1-candidate-pin.mjs";

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
    // WP-C1: when the approved release assembly (239602c9) is a STRICT ancestor of HEAD, the tree
    // carries the C1 browser-surface migration. Every other protected file keeps its exact pin;
    // index.html may differ from the approved merge ONLY as the C1 index contract allows
    // (test/support/c1-index-scope.mjs: fixed zones anchored in the APPROVED bytes, protected
    // write sub-regions byte-identical, no write call changed) — never a blanket bypass.
    const c1 = assembled && gitIn(root, ["merge-base", "--is-ancestor", C1_ASSEMBLY, "HEAD"]).status === 0 && names(["rev-parse", "HEAD"])[0] !== C1_ASSEMBLY;
    // P1 Supplier Credits: when the reviewed C1 R2 commit (P1_BASE) is a STRICT ancestor of HEAD, the
    // tree carries the P1 candidate. Its protected changes are EXACTLY the files listed in the P1
    // identity pin (test/support/p1-candidate-pin.mjs — fixed blob literals, pending independent
    // review): each must be byte-identical (committed, staged, checked out) to its pinned blob, and
    // index.html must additionally satisfy the P1 scope contract over the C1-pinned base page.
    const p1 = c1 && gitIn(root, ["merge-base", "--is-ancestor", P1_BASE, "HEAD"]).status === 0 && names(["rev-parse", "HEAD"])[0] !== P1_BASE;
    const P1_FILES = p1 ? Object.keys(P1_PINS.blobs).filter((f) => f !== "index.html") : [];
    const allowed = assembled ? [...CDM2_APPROVED, ...P0_APPROVED, ...P1_FILES] : CDM2_APPROVED;
    const whole = [...names(["diff", "--name-only", BASE, "--"]), ...untracked].filter((f) => PROTECTED.test(f));
    assert.deepEqual([...new Set(whole)].sort(), [...allowed].sort(), assembled
      ? "assembled tree: protected changes are exactly CD-M2 R1's approved runtime files + P0 Scheduled Auth's three API routes" + (p1 ? " + the pinned P1 Supplier Credits candidate files" : "")
      : "integrated tree: protected changes are exactly CD-M2 R1's approved runtime files");
    for (const f of P1_FILES) {
      const pin = P1_PINS.blobs[f];
      assert.match(pin, /^[0-9a-f]{40}$/, "the P1 pin of " + f + " must be a literal blob id");
      assert.equal(gitIn(root, ["rev-parse", "HEAD:" + f]).stdout.trim(), pin, f + " (committed) is not the pinned P1 candidate blob " + pin.slice(0, 8));
      assert.equal(gitIn(root, ["rev-parse", ":" + f]).stdout.trim(), pin, f + ": staged (index) blob differs from the pinned P1 candidate blob");
      assert.equal(hashBytes(readFileSync(join(root, f))), pin, f + ": checked-out bytes differ from the pinned P1 candidate blob");
    }
    assert.equal(gitIn(root, ["merge-base", "--is-ancestor", CDM2R1, "HEAD"]).status, 0, "…and they come from the approved CD-M2 R1 lineage");
    if (assembled) assert.equal(gitIn(root, ["merge-base", "--is-ancestor", P0, "HEAD"]).status, 0, "…and the approved P0 Scheduled Auth lineage");
    // the approved content of each runtime file: [file, expected blob bytes, label]
    const expected = [
      ...(assembled ? [] : [["index.html", blobBytes(root, CDM2R1 + ":index.html"), CDM2R1.slice(0, 8) + ":index.html"]]),
      ["lib/repositories/entryExceptionsRepo.js", blobBytes(root, CDM2R1 + ":lib/repositories/entryExceptionsRepo.js"), CDM2R1.slice(0, 8) + ":lib/repositories/entryExceptionsRepo.js"],
      [SB, blobBytes(root, B2 + ":" + SB), B2.slice(0, 8) + ":" + SB],
      [SE, blobBytes(root, B2 + ":" + SE), B2.slice(0, 8) + ":" + SE],
      ...(assembled ? [
        ...(c1 ? [] : [["index.html", approvedIndexMerge(root), "merge(" + CDM2R1.slice(0, 8) + ", " + HF1R1.slice(0, 8) + ")"]]),
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
    if (c1) {
      // The approved bytes are recomputed from git objects (never the working tree); the
      // COMMITTED, STAGED and CHECKED-OUT index.html must each satisfy the C1 contract, and
      // must be one and the same content (a local edit, even inside a zone, fails).
      const approved = approvedIndexMerge(root);
      const committed = blobBytes(root, "HEAD:index.html"), staged = blobBytes(root, ":index.html"), checkedOut = readFileSync(join(root, "index.html"));
      assert.ok(checkedOut.equals(committed), "index.html: checked-out bytes differ from the committed C1 blob");
      assert.ok(staged.equals(committed), "index.html: staged (index) blob differs from the committed C1 blob");
      if (p1) {
        // P1 layer. The base page is recomputed from git objects (never the working tree) and must
        // be exactly the C1 identity-pinned blob AND satisfy the C1 contract; the candidate must then
        // satisfy the P1 contract against it and be exactly the P1 identity-pinned blob.
        const base = blobBytes(root, P1_BASE + ":index.html");
        assert.equal(hashBytes(base), C1_INDEX_PIN.blob, "P1 base index.html is the C1 identity-pinned blob " + C1_INDEX_PIN.blob.slice(0, 8));
        assert.deepEqual(c1IndexVerdict(approved, base), { ok: true }, "the P1 base index.html satisfies the C1 contract");
        for (const [label, bytes] of [["committed", committed], ["staged (index)", staged], ["checked-out", checkedOut]]) {
          const v = p1IndexVerdict(base, bytes);
          assert.ok(v.ok, "index.html (" + label + ") violates the P1 contract: " + JSON.stringify(v));
        }
        const pin = P1_PINS.blobs["index.html"];
        assert.match(pin, /^[0-9a-f]{40}$/, "the P1 identity pin must be a literal blob id");
        assert.equal(gitIn(root, ["rev-parse", "HEAD:index.html"]).stdout.trim(), pin, "index.html (committed) is not the pinned P1 candidate blob " + pin.slice(0, 8));
        assert.equal(gitIn(root, ["rev-parse", ":index.html"]).stdout.trim(), pin, "index.html: staged (index) blob differs from the pinned P1 candidate blob");
        assert.equal(hashBytes(checkedOut), pin, "index.html: checked-out bytes differ from the pinned P1 candidate blob");
        return;
      }
      for (const [label, bytes] of [["committed", committed], ["staged (index)", staged], ["checked-out", checkedOut]]) {
        const v = c1IndexVerdict(approved, bytes);
        assert.ok(v.ok, "index.html (" + label + ") violates the C1 contract: " + JSON.stringify(v));
      }
      // C1 R1 (independent review finding 1): SCOPE is not content identity. The committed,
      // staged and checked-out index.html must each be exactly the pinned C1 blob (a fixed
      // literal in test/support/c1-candidate-pin.mjs — never HEAD:index.html or a hash computed
      // here), so an in-zone change to a financial calculation fails dirty, staged or committed.
      assert.match(C1_INDEX_PIN.blob, /^[0-9a-f]{40}$/, "the C1 identity pin must be a literal blob id");
      assert.equal(gitIn(root, ["rev-parse", "HEAD:index.html"]).stdout.trim(), C1_INDEX_PIN.blob, "index.html (committed) is not the pinned C1 candidate blob " + C1_INDEX_PIN.blob.slice(0, 8));
      assert.equal(gitIn(root, ["rev-parse", ":index.html"]).stdout.trim(), C1_INDEX_PIN.blob, "index.html: staged (index) blob differs from the pinned C1 candidate blob");
      assert.equal(hashBytes(checkedOut), C1_INDEX_PIN.blob, "index.html: checked-out bytes differ from the pinned C1 candidate blob");
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
const isC1Repo = isAssembledRepo && gitIn(REPO, ["merge-base", "--is-ancestor", C1_ASSEMBLY, "HEAD"]).status === 0 && HEAD_SHA !== C1_ASSEMBLY;
const isP1Repo = isC1Repo && gitIn(REPO, ["merge-base", "--is-ancestor", P1_BASE, "HEAD"]).status === 0 && HEAD_SHA !== P1_BASE;
// On a C1 tree a non-approved index.html is refused by the C1 contract instead of the byte pin;
// on a P1 tree by the P1 contract (the C1 surfaces outside the P1 zones are frozen at C1 R2 bytes).
const INDEX_REFUSED = isP1Repo ? /index\.html \(committed\) violates the P1 contract|index\.html \(committed\) is not the pinned P1 candidate blob/
  : isC1Repo ? /index\.html \(committed\) violates the C1 contract|index\.html \(committed\) is not the pinned C1 candidate blob/ : /index\.html is byte-identical to the approved merge/;
// On a P1 tree a C1-zone mutation outside the P1 zones is refused by the P1 scope first.
const C1_REASON = (re) => (isP1Repo ? /change_outside_p1_zones|protected_region_changed|write_path_lines_changed|p1_|bundle_identity/ : re);
const PIN_REFUSED = isP1Repo ? /index\.html \(committed\) violates the P1 contract|index\.html \(committed\) is not the pinned P1 candidate blob/ : /index\.html \(committed\) is not the pinned C1 candidate blob/;
const p1BaseOf = (dir) => blobBytes(dir, P1_BASE + ":index.html");
/** The scope layer that applies to this tree: on a C1 tree a C1-zone edit is ACCEPTED by scope (why identity is required); on a P1 tree it is outside the P1 zones and REFUSED. */
function assertScopeLayer(dir, bytes, what) {
  if (isP1Repo) assert.equal(p1IndexVerdict(p1BaseOf(dir), bytes).reason, "change_outside_p1_zones", what + ": on a P1 tree the P1 scope refuses a C1-zone edit");
  else assert.deepEqual(c1IndexVerdict(approvedIndexMerge(dir), bytes), { ok: true }, what);
}
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
// These cases COMMIT, and committing an object that already exists in a borrowed (alternates)
// object store makes git "freshen" (re-timestamp) that store's pack files. So the writable clone
// does NOT borrow this repository's objects: it is cloned from a temporary bundle of HEAD's
// history (written outside the repository), and every write lands in the disposable clone only.
function withWritableClone(commit, fn) {
  const dir = mkdtempSync(join(tmpdir(), "b2g05w-"));
  try {
    const bundle = join(dir, "head.bundle"), clone = join(dir, "clone");
    assert.equal(gitIn(REPO, ["rev-parse", "HEAD"]).stdout.trim(), commit, "the writable clone is of this checkout's HEAD");
    const b = gitIn(REPO, ["bundle", "create", bundle, "HEAD"]);   // a bundle needs a ref; HEAD === commit (asserted)
    assert.equal(b.status, 0, String(b.stderr));
    const c = spawnSync("git", ["clone", "-q", "--no-checkout", bundle, clone], { encoding: "utf8", cwd: dir });
    assert.equal(c.status, 0, c.stderr);
    const co = spawnSync("git", ["-C", clone, "-c", "advice.detachedHead=false", "checkout", "-q", "--detach", commit], { encoding: "utf8" });
    assert.equal(co.status, 0, co.stderr);
    return fn(clone);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
const commitIn = (dir, msg) => { assert.equal(spawnSync("git", ["-C", dir, "add", "-A"]).status, 0); const c = spawnSync("git", ["-C", dir, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", msg], { encoding: "utf8" }); assert.equal(c.status, 0, c.stderr); };
test("B2G-05-M4 assembled tree: committing a non-approved index.html (CD-M2 R1 alone, HF-1 alone, or the merge with the REJECTED HF-1 95d20d86), pre-P0 API bytes, or a stray API file fails; the exact assembled commit passes", { skip: !isAssembledRepo && "HF-1 R1 / P0 not integrated in this tree" }, () => {
  const REJECTED_HF1 = "95d20d8646736fe1c80c949924fa7875fbda90d2";
  const cases = [
    ["index.html = CD-M2 R1 only (HF-1 dropped)", (dir) => writeFileSync(join(dir, "index.html"), blobBytes(dir, CDM2R1 + ":index.html")), INDEX_REFUSED],
    ["index.html = HF-1 R1 only (CD-M2 dropped)", (dir) => writeFileSync(join(dir, "index.html"), blobBytes(dir, HF1R1 + ":index.html")), INDEX_REFUSED],
    ["index.html = CD-M2 R1 ⊕ REJECTED HF-1 95d20d86", (dir) => writeFileSync(join(dir, "index.html"), approvedIndexMerge(dir, REJECTED_HF1)), INDEX_REFUSED],
    ...P0_APPROVED.map((f) => ["pre-P0 bytes of " + f, (dir) => writeFileSync(join(dir, f), blobBytes(dir, HF1_BASE + ":" + f)), /protected changes are exactly CD-M2 R1's approved runtime files \+ P0 Scheduled Auth's three API routes/]), // pre-P0 bytes = the base bytes ⇒ the route drops out of the exact set
    ["a committed edit of the P0 run.ts", (dir) => appendTo(dir, "api/daily-snapshot/run.ts", "\n// edit\n"), /api\/daily-snapshot\/run\.ts is byte-identical to the approved 05bf5a59/],
    ["a stray API route", (dir) => writeFileSync(join(dir, "api", "stray.ts"), "export default function h() {}\n"), /protected changes are exactly/],
  ];
  withWritableClone(HEAD_SHA, (dir) => assertB2Scope(dir));             // positive control
  for (const [label, mut, re] of cases) {
    withWritableClone(HEAD_SHA, (dir) => {
      mut(dir); commitIn(dir, label);
      assert.throws(() => assertB2Scope(dir), re, label);
    });
  }
});

// ── WP-C1: the C1 branch of B2G-05 (committed substitutions on a disposable writable clone) ──
test("B2G-05-M5 C1 tree: committed index.html changes outside the C1 zones, in a protected write region, adding a write call, or dropping the fincore bootstrap fail; a reverted (pre-C1) page fails; the exact C1 commit passes", { skip: !isC1Repo && "C1 not integrated in this tree" }, () => {
  const edit = (dir, from, to) => { const p = join(dir, "index.html"), src = readFileSync(p, "utf8"); assert.equal(src.split(from).length, 2, "mutation anchor unique: " + from.slice(0, 60)); writeFileSync(p, src.replace(from, to)); };
  const cases = [
    ["HF-1 setup-config block edited", (dir) => edit(dir, "// ── HF-1: Setup Wizard config preservation", "// ── HF-1: Setup Wizard config preservation (edited)"), /change_outside_c1_zones/],
    ["CD-M2 closure panel edited", (dir) => edit(dir, '{/* CD-M2: explicit "Business closed" action', '{/* CD-M2 (edited): explicit "Business closed" action'), /change_outside_c1_zones/],
    ["unrelated screen (petty cash) edited", (dir) => edit(dir, "  const fmtPetty = (n) => '₪' + (Number(n) || 0)", "  const fmtPetty = (n) => '₪ ' + (Number(n) || 0)"), /change_outside_c1_zones/],
    ["storage transport edited", (dir) => edit(dir, '        if (!snap.exists()) throw new Error("not found");', '        if (!snap.exists()) throw new Error("missing");'), /change_outside_c1_zones/],
    ["supplier write lane edited (inside the food-cost zone)", (dir) => edit(dir, "              const token = supplierResultOwnershipRef.current.begin(captureSelectionCtx());", "              const token = supplierResultOwnershipRef.current.begin(null);"), /protected_region_changed/],
    ["history clear-all edited (inside the history zone)", (dir) => edit(dir, '                  if(!window.confirm("למחוק את כל הרשומות?")) return;', '                  if(false) return;'), /protected_region_changed|protected_anchor/],
    ["write call added inside the dashboard zone", (dir) => edit(dir, "            const dv = finDash;", "            const dv = finDash; saveBusinessConfig({ ...businessConfig });"), /write_path_lines_changed/],
    ["fincore bootstrap removed", (dir) => edit(dir, '      const mod = await import("/fincore/v1/browser/marjinFinanceGlobal.js");', "      const mod = null;"), /fincore_import_shape/],
    ["page reverted to the approved assembly (no C1)", (dir) => writeFileSync(join(dir, "index.html"), approvedIndexMerge(dir)), /fincore_bootstrap_shape/],
  ];
  withWritableClone(HEAD_SHA, (dir) => assertB2Scope(dir));             // positive control: the exact C1 commit
  for (const [label, mut, re] of cases) {
    withWritableClone(HEAD_SHA, (dir) => {
      mut(dir); commitIn(dir, label);
      assert.throws(() => assertB2Scope(dir), C1_REASON(re), label);
    });
  }
});

test("B2G-05-M6 C1 tree: an in-zone edit (a label) fails dirty, staged AND committed — scope validation alone would accept it, the identity pin does not", { skip: !isC1Repo && "C1 not integrated in this tree" }, () => {
  const label = '<div className="chart-label">הכנסות יומיות</div>', edited = '<div className="chart-label">הכנסות יומיות (edited)</div>';
  withClone(HEAD_SHA, (dir) => {
    const p = join(dir, "index.html"), src = readFileSync(p, "utf8");
    writeFileSync(p, src.replace(label, edited));
    assert.throws(() => assertB2Scope(dir), /index\.html: checked-out bytes differ from the committed C1 blob/);
  });
  withWritableClone(HEAD_SHA, (dir) => {
    const p = join(dir, "index.html"), src = readFileSync(p, "utf8");
    const changed = src.replace(label, edited);
    assertScopeLayer(dir, Buffer.from(changed), "the scope layer alone accepts this in-zone edit");
    writeFileSync(p, changed); commitIn(dir, "in-zone label edit");
    assert.throws(() => assertB2Scope(dir), PIN_REFUSED);
  });
});

// C1 R1 — the independent reviewer's probe: an in-zone FINANCIAL CALCULATION change (the dashboard
// sales target forced to "1") must fail B2G-05 when dirty, when staged and when committed.
const FIN_OLD = "var target = D(F).serializeRat(D(F).ratMul(amt(F, lySales), growthFactor));", FIN_NEW = 'var target = "1";';
test("B2G-05-M7 C1 tree: an in-zone FINANCIAL calculation mutation passes the scope layer but fails B2G-05 dirty, staged and committed", { skip: !isC1Repo && "C1 not integrated in this tree" }, () => {
  const mutate = (dir) => { const p = join(dir, "index.html"), src = readFileSync(p, "utf8"); assert.equal(src.split(FIN_OLD).length, 2, "probe anchor unique"); writeFileSync(p, src.replace(FIN_OLD, FIN_NEW)); return readFileSync(p); };
  withClone(HEAD_SHA, (dir) => {
    const bytes = mutate(dir);
    assertScopeLayer(dir, bytes, "scope layer accepts the financial mutation (why identity is required)");
    assert.throws(() => assertB2Scope(dir), /checked-out bytes differ/, "dirty");
    assert.equal(spawnSync("git", ["-C", dir, "add", "index.html"]).status, 0);
    assert.throws(() => assertB2Scope(dir), /staged \(index\) blob differs|checked-out bytes differ/, "staged");
    assert.equal(spawnSync("git", ["-C", dir, "checkout", "--", "index.html"]).status, 0);   // staged only, working tree = index
    assert.throws(() => assertB2Scope(dir), /staged \(index\) blob differs|checked-out bytes differ/, "staged (working tree matches index)");
  });
  withWritableClone(HEAD_SHA, (dir) => {
    mutate(dir); commitIn(dir, "in-zone financial mutation");
    assert.throws(() => assertB2Scope(dir), PIN_REFUSED, "committed");
  });
  withWritableClone(HEAD_SHA, (dir) => {                               // unrelated non-protected file: not a false failure
    writeFileSync(join(dir, "scratch-note.txt"), "x\n"); commitIn(dir, "unrelated");
    assertB2Scope(dir);
  });
});

// ── P1 Supplier Credits: the P1 layer of B2G-05 (disposable clones) ─────────────────────────────
// Every pinned P1 runtime file fails dirty / staged / committed when edited; an in-zone index.html
// mutation (the credits tab amount label) passes the P1 scope but fails the identity pin; committed
// changes that put a credit on the purchase path, duplicate the net formula, touch a C1 surface,
// add an unpinned protected file or revert a pinned file fail; the exact P1 commit passes.
test("B2G-05-P1a P1 tree: each pinned runtime file (core, fincore, server API, lib, admin API, page) fails when edited dirty or staged; the exact commit passes", { skip: !isP1Repo && "P1 not integrated in this tree" }, () => {
  withClone(HEAD_SHA, (dir) => {
    assertB2Scope(dir);                                                 // positive control: the exact P1 commit
    for (const f of Object.keys(P1_PINS.blobs)) {
      const before = readFileSync(join(dir, f));
      appendTo(dir, f, f.endsWith(".json") ? " " : "\n// local edit\n");
      assert.throws(() => assertB2Scope(dir), new RegExp(f.replace(/[.\/]/g, "\\$&") + ": checked-out bytes differ"), f + " unstaged edit must fail");
      assert.equal(spawnSync("git", ["-C", dir, "add", f]).status, 0);
      writeFileSync(join(dir, f), before);
      assert.throws(() => assertB2Scope(dir), /staged \(index\) blob differs/, f + " staged edit must fail");
      assert.equal(spawnSync("git", ["-C", dir, "reset", "-q", "--", f]).status, 0);
      assertB2Scope(dir);
    }
  });
});

test("B2G-05-P1b P1 tree: committed negative-purchase substitution, formula duplication, C1-surface edits, an in-zone label edit, an unpinned protected file and a reverted pinned file all fail", { skip: !isP1Repo && "P1 not integrated in this tree" }, () => {
  const edit = (dir, f, from, to) => { const p = join(dir, f), src = readFileSync(p, "utf8"); assert.equal(src.split(from).length, 2, "mutation anchor unique: " + from.slice(0, 60)); writeFileSync(p, src.replace(from, to)); };
  const TAB = '          {fcTab==="credits" && (()=>{';
  const cases = [
    ["credit written as a negative supplier payment", (dir) => edit(dir, "index.html", TAB, TAB + "\n            const __neg = () => setSupPayDate(creditForm.supplierId, creditForm.issueDate, \"-\" + creditForm.amount);"), /write_path_lines_changed/],
    ["net formula duplicated in the page", (dir) => edit(dir, "index.html", "    function errorText(code) { return ERRORS[code] || ERRORS.failed; }", "    function errorText(code) { return ERRORS[code] || ERRORS.failed; }\n    function net(F, g, c) { return F.finance.decimal.decSub(g, c); }"), /formula_duplication/],
    ["C1 dashboard calculation edited", (dir) => edit(dir, "index.html", FIN_OLD, FIN_NEW), /change_outside_p1_zones/],
    ["in-zone label edit", (dir) => edit(dir, "index.html", "הוספת זיכוי ספק", "הוספת זיכוי ספק (edited)"), /index\.html \(committed\) is not the pinned P1 candidate blob/],
    ["core credit attribution edited", (dir) => edit(dir, "src/finance/supplierCredits.ts", "if (r.status !== \"active\" || !wanted.has(r.issueDate)) continue;", "if (r.status !== \"active\") continue;"), /src\/finance\/supplierCredits\.ts \(committed\) is not the pinned P1 candidate blob/],
    ["an unpinned protected file", (dir) => writeFileSync(join(dir, "lib", "creditsExtra.js"), "export const x = 1;\n"), /protected changes are exactly/],
    ["a pinned file reverted to the base", (dir) => writeFileSync(join(dir, "api", "admin.js"), blobBytes(dir, P1_BASE + ":api/admin.js")), /protected changes are exactly/],
    ["Rules changed", (dir) => appendTo(dir, "database.rules.json", " "), /protected changes are exactly/],
  ];
  for (const [label, mut, re] of cases) {
    withWritableClone(HEAD_SHA, (dir) => {
      mut(dir); commitIn(dir, label);
      assert.throws(() => assertB2Scope(dir), re, label);
    });
  }
});
