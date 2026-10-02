import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { REPO } from "../support/fincore-load.mjs";
import { gitIn } from "../support/git-context.mjs";
import { F1_INDEX_BASE, f1IndexVerdict } from "../support/f1-index-scope.mjs";
import { F1_COMMIT, F1_INDEX_PIN } from "../support/f1-candidate-pin.mjs";
import { R1_COMMIT } from "../support/r1-candidate-pin.mjs";
import { VD50_INDEX_PIN } from "../support/vd50-candidate-pin.mjs";

const base = gitIn(REPO, ["show", `${F1_INDEX_BASE}:index.html`]).stdout;
// F1 R1: on a tree that carries the R1 successor, the F1 page is the FIXED F1 candidate blob (read from git,
// never the working tree); the R1 page itself is guarded by f1-r1-guard-mutations (R1G-01/02).
const onR1 = gitIn(REPO, ["merge-base", "--is-ancestor", R1_COMMIT, "HEAD"]).status === 0;
const page = onR1 ? gitIn(REPO, ["show", `${F1_COMMIT}:index.html`]).stdout : readFileSync(join(REPO, "index.html"), "utf8");
const hash = (s) => spawnSync("git", ["hash-object", "--stdin"], { input: s, encoding: "utf8" }).stdout.trim();

test("F1-G01 exact VD-50 parent, narrow page scope and fixed pending identity", () => {
  assert.equal(hash(base), VD50_INDEX_PIN.blob);
  assert.deepEqual(f1IndexVerdict(base, page), { ok: true });
  assert.equal(hash(page), F1_INDEX_PIN.blob);
  assert.match(F1_INDEX_PIN.status, /pending independent review/);
  const pinSource = readFileSync(join(REPO, "test/support/f1-candidate-pin.mjs"), "utf8");
  assert.doesNotMatch(pinSource, /hash-object|readFileSync|rev-parse|spawnSync/);
});

test("F1-G02 capability, absent-subscription and finance mutations fail scope or identity", () => {
  for (const [from, to] of [
    ['v.costHistory !== "MARJIN_COSTH/1"', 'v.costHistory !== "MARJIN_COSTH/0"'],
    ['callback(snap.exists() ? snap.val() : null)', 'if (snap.exists()) callback(snap.val())'],
    ['costHistory: src.costHistory || { state: "absent" }', 'costHistory: { state: "absent" }'],
    ['gross: typedValue(A.grossProfitBeforeFixed)', 'gross: "0"'],
  ]) {
    assert.ok(page.includes(from), from);
    const changed = page.replace(from, to);
    assert.ok(!f1IndexVerdict(base, changed).ok || hash(changed) !== F1_INDEX_PIN.blob);
  }
});
