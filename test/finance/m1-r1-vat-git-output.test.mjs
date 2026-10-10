// M1 R1 — regression for the S0 VAT guard's Git-output defect (independent review: the guard's runtime diff exceeded spawnSync's
// default 1 MiB buffer; ENOBUFS came back with status 0 or null by timing, so the guard failed intermittently and a status-0
// run could have asserted on truncated output). The fix is in the shared subprocess helper the guard uses
// (test/support/git-context.mjs gitIn: explicit bound + every subprocess error throws); the VAT guard itself is byte-identical
// to its reviewed version (the [H10] hardening test requires that).
//   GO-01  boundary + completeness: the guard's real diff is larger than the legacy default; gitIn returns it with no error
//          and status 0, and the guard's OWN added-line extraction equals git's independent --numstat count
//   GO-02  overflow is deterministic and LOUD: under a bound smaller than the output gitIn throws ENOBUFS (never a partial
//          result); the raw legacy call shows the hazard (ENOBUFS beside status 0 or null); a timed-out call throws
//   GO-03  control: the UNCHANGED VAT guard, run in a disposable clone, still fails on a real S0 violation — each forbidden
//          addition reported individually — with the oversized diff in place
//   GO-04  control: a failing git command is never a pass — a non-zero status reaches the guard's assertion; a spawn failure
//          throws
//   GO-05  the S0 guard is byte-identical to the rejected candidate's and reaches git only through gitIn
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { REPO } from "../support/fincore-load.mjs";
import { gitIn, GIT_OUTPUT_LIMIT } from "../support/git-context.mjs";

const BASE = "686b4350c6b6186c81d7f821d8c26a960428d30b";   // the S0 guard's base (test/finance/vat-invariant.test.mjs)
const LEGACY_DEFAULT = 1024 * 1024;
const CHILD_ENV = (() => { const e = { ...process.env }; delete e.NODE_TEST_CONTEXT; return e; })();   // a standalone child test run
const PATHS = ["index.html", "api", "lib", "src"];
const ARGS = ["diff", "--unified=0", BASE, "--", ...PATHS];   // exactly the guard's query
/** the guard's own added-line extraction, verbatim */
const guardAdded = (stdout) => stdout.split(/\r?\n/).filter((line) => line.startsWith("+") && !line.startsWith("+++")).map((line) => line.slice(1));
const numstatAdded = (txt) => txt.split("\n").filter(Boolean).reduce((n, l) => { const a = l.split("\t")[0]; assert.match(a, /^(\d+|-)$/, l); return n + (a === "-" ? 0 : Number(a)); }, 0);

test("GO-01 the guard's diff exceeds the legacy 1 MiB default; gitIn returns it completely (no error, status 0, additions = --numstat)", () => {
  const r = gitIn(REPO, ARGS);
  assert.equal(r.error, undefined); assert.equal(r.status, 0); assert.equal(r.signal, null);
  const bytes = Buffer.byteLength(r.stdout);
  assert.ok(bytes > LEGACY_DEFAULT, `the guard's diff (${bytes} bytes) is beyond the legacy default buffer — the boundary under test`);
  assert.ok(bytes < GIT_OUTPUT_LIMIT / 8, "and far inside the explicit bound");
  // INTEGRATION I1 (test-contract transition): the additions are counted by --numstat over EXACTLY the guard's query (-U0).
  // Without -U0, git's default-context alignment of index.html (after the owner-notice UI's four additive edits) yields a
  // different edit script (5,844 vs 5,789 additions for the page; both complete) — the count compared must be the same diff.
  // (-U0 implies the patch: the numstat lines are the ones before the first "diff --git" header)
  const numstat = gitIn(REPO, ["diff", "--numstat", "--unified=0", BASE, "--", ...PATHS]);
  assert.equal(numstat.status, 0);
  const statLines = numstat.stdout.slice(0, numstat.stdout.indexOf("diff --git"));
  assert.ok(statLines.split("\n").filter(Boolean).length > 50 && !statLines.includes("@@"), "the numstat lines are located");
  assert.equal(guardAdded(r.stdout).length, numstatAdded(statLines), "every added line reached the guard (complete output)");
});

test("GO-02 overflow is deterministic and loud: below the output size gitIn throws ENOBUFS; the raw legacy call shows the hazard", () => {
  for (const limit of [4096, LEGACY_DEFAULT]) {
    assert.throws(() => gitIn(REPO, ARGS, { maxBuffer: limit }), /subprocess error ENOBUFS .*maxBuffer \d+\)\. A guard must never read a truncated or killed git result/, `gitIn at ${limit} bytes throws`);
    const raw = spawnSync("git", ["-C", REPO, "--no-optional-locks", ...ARGS], { encoding: "utf8", maxBuffer: limit });
    assert.equal(raw.error && raw.error.code, "ENOBUFS", "the raw spawnSync reports ENOBUFS");
    assert.ok(raw.status === 0 || raw.status === null, "…while its status alone (0 or null, by timing) says nothing reliable");
  }
  assert.throws(() => gitIn(REPO, ["log", "-1"], { timeout: 1, killSignal: "SIGKILL" }), /subprocess error/, "a timed-out git call throws");
});

test("GO-03 control: the unchanged VAT guard fails on each real S0 violation in a disposable clone (oversized diff in place)", () => {
  const head = gitIn(REPO, ["rev-parse", "HEAD"]).stdout.trim();
  for (const [rel, line] of [["lib/helpers.js", 'await storage.set("x", y); // go-03 probe A'], ["api/admin.js", "const migrate = true; // go-03 probe B"], ["src/finance/labor.ts", "export const p = persist(1); // go-03 probe C"]]) {
    const dir = mkdtempSync(join(tmpdir(), "m1r1-s0-"));
    try {
      assert.equal(spawnSync("git", ["clone", "-q", "--shared", "--no-checkout", REPO, dir]).status, 0);
      assert.equal(spawnSync("git", ["-C", dir, "checkout", "-q", "--detach", head]).status, 0);
      symlinkSync(join(REPO, "node_modules"), join(dir, "node_modules"), "dir");
      const p = join(dir, rel); writeFileSync(p, readFileSync(p, "utf8") + "\n" + line + "\n");
      const run = spawnSync(process.execPath, ["--test", "--test-reporter=tap", "--test-name-pattern=S0 diff contains no historical", "test/finance/vat-invariant.test.mjs"], { cwd: dir, encoding: "utf8", maxBuffer: 1 << 26, timeout: 300000, env: CHILD_ENV });
      assert.notEqual(run.status, 0, rel + ": the guard fails");
      assert.match(run.stdout, /^not ok \d+ - S0 diff contains no historical data transform/m);
      assert.ok(run.stdout.includes(line.split("//")[1].trim()), rel + ": the violating line is reported: " + run.stdout.slice(-1500));
      assert.ok(!/ENOBUFS/.test(run.stdout), "the failure is the S0 assertion, not a buffer error");
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }
});

test("GO-04 control: a failing git command is never a pass; a spawn failure throws", () => {
  const bad = gitIn(REPO, ["diff", "--unified=0", "0".repeat(40), "--", "lib"]);
  assert.equal(bad.status, 128, "a non-zero status reaches the caller (the guard asserts status 0)");
  assert.throws(() => assert.equal(bad.status, 0, bad.stderr), /bad object|unknown revision|0000000/);
  assert.throws(() => gitIn(REPO, ["status"], { cwd: join(tmpdir(), "m1r1-definitely-missing-dir") }), /subprocess error/);
});

test("GO-05 the S0 guard is byte-identical to the rejected candidate's and reaches git only through gitIn (explicit bound, loud errors)", () => {
  const src = readFileSync(join(REPO, "test/finance/vat-invariant.test.mjs"), "utf8");
  const parent = gitIn(REPO, ["show", "8511d7b2d3e4c89659b1ae006f6bdb1e9670b826:test/finance/vat-invariant.test.mjs"]);
  assert.equal(parent.status, 0);
  assert.equal(src, parent.stdout, "the VAT guard is unchanged by R1 (the fix is in its subprocess helper)");
  assert.ok(src.includes('const runtimeDiff = gitIn(ROOT, ["diff", "--unified=0", BASE, "--", "index.html", "api", "lib", "src"]);'));
  assert.ok(src.includes('import { gitIn } from "../support/git-context.mjs";'));
  assert.ok(!/spawnSync|execSync|execFileSync/.test(src), "no direct subprocess call in the guard");
  const ctx = readFileSync(join(REPO, "test/support/git-context.mjs"), "utf8");
  assert.ok(ctx.includes("maxBuffer: GIT_OUTPUT_LIMIT, ...opts") && ctx.includes("  if (r.error) {"), "explicit bound + loud subprocess errors");
});
