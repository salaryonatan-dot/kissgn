// WP-C2 — the C2 layer of B2G-05 in-process: the C2 index.html scope contract
// (test/support/c2-index-scope.mjs) and the C2 identity pin (test/support/c2-candidate-pin.mjs),
// with negative controls. The BASE page is the reviewed C1 R2 index.html read from git objects;
// the committed-clone variants live in b2-guard-mutations.test.mjs (B2G-05-M8/M9).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { REPO } from "../support/fincore-load.mjs";
import { gitIn } from "../support/git-context.mjs";
import { C1_ASSEMBLY, c1IndexVerdict, diffHunks } from "../support/c1-index-scope.mjs";
import { C1_INDEX_PIN } from "../support/c1-candidate-pin.mjs";
import { C2_BASE, C2_ZONES, C2_PROTECTED_LINES, C2_RETIRED, c2IndexVerdict } from "../support/c2-index-scope.mjs";
import { C2_INDEX_PIN } from "../support/c2-candidate-pin.mjs";
import { VD50_BASE } from "../support/vd50-index-scope.mjs";

const blob = (spec) => { const r = gitIn(REPO, ["cat-file", "blob", spec], { encoding: "buffer" }); assert.equal(r.status, 0, spec); return r.stdout.toString("utf8"); };
const blobOf = (s) => { const r = spawnSync("git", ["hash-object", "--stdin"], { input: s, encoding: "utf8" }); assert.equal(r.status, 0); return r.stdout.trim(); };
const base = blob(C2_BASE + ":index.html");
// On successor trees, keep proving the exact independently reviewed C2 page.
const candidate = blob(VD50_BASE + ":index.html");
const once = (src, from, to) => { assert.equal(src.split(from).length, 2, "mutation anchor unique: " + from.slice(0, 70)); return src.replace(from, to); };
const reason = (b) => c2IndexVerdict(base, b).reason;

test("C2G-01 the base is the reviewed C1 R2 page: C1-pinned blob, C1-contract-valid, and an ancestor of HEAD", () => {
  assert.equal(gitIn(REPO, ["merge-base", "--is-ancestor", C2_BASE, "HEAD"]).status, 0);
  assert.equal(blobOf(base), C1_INDEX_PIN.blob);
  assert.deepEqual(c1IndexVerdict(blob(C1_ASSEMBLY + ":index.html"), base), { ok: true });
});

test("C2G-02 positive control: the candidate satisfies the C2 contract and every changed hunk lies in a named C2 zone", () => {
  assert.deepEqual(c2IndexVerdict(base, candidate), { ok: true });
  const hunks = diffHunks(base, candidate);
  assert.ok(hunks.length >= 2, "both zones are used");
  for (const [name, s] of C2_ZONES) assert.equal(base.split(s).length, 2, name + ": anchor unique in the base");
  for (const l of C2_PROTECTED_LINES) assert.equal(candidate.split(l + "\n").length, 2, "protected line present once: " + l.trim());
});

test("C2G-03 negative controls OUTSIDE the zones: C1 surfaces, CD-M2, HF-1, the call site and the injection are refused", () => {
  const cases = [
    ["C1 seam", "var target = D(F).serializeRat(D(F).ratMul(amt(F, lySales), growthFactor));", 'var target = "1";', "change_outside_c2_zones"],
    ["C1 ledger deadline", "var LEDGER_ATTEMPT_DEADLINE_MS = 30000;", "var LEDGER_ATTEMPT_DEADLINE_MS = 3000000;", "change_outside_c2_zones"],
    ["HF-1 block", "// ── HF-1: Setup Wizard config preservation", "// ── HF-1 (edited)", "change_outside_c2_zones"],
    ["call site", "  const __revenueChanged = __revenueMaterialChanged(__prevEntry, netForm);", "  const __revenueChanged = true;", "change_outside_c2_zones"],
    ["rebuild decision", "  const shouldRebuild = __revenueChanged || (__exResponse", "  const shouldRebuild = true || (__exResponse", "change_outside_c2_zones"],
    ["injection", "        materialChanged: __revenueMaterialChanged,", "        materialChanged: () => false,", "change_outside_c2_zones"],
  ];
  for (const [label, from, to, want] of cases) assert.equal(reason(once(candidate, from, to)), want, label);
});

test("C2G-04 negative controls INSIDE the zones: a write call, a second block, a non-delegating trigger are refused", () => {
  assert.equal(reason(once(candidate, "    return window.MarjinC2.financialChanged(fin, prev, next).changed;", "    persistEntries([]);\n    return window.MarjinC2.financialChanged(fin, prev, next).changed;")), "write_path_lines_changed");
  assert.equal(reason(once(candidate, "    return window.MarjinC2.financialChanged(fin, prev, next).changed;", "    return true;")), "c2_trigger_shape");
  assert.equal(reason(once(candidate, "    window.MarjinC2 = Object.freeze({", "    window.MarjinC2 = Object.freeze({}); window.MarjinC2 = Object.freeze({")), "c2_block_shape");
  assert.equal(reason(base), "c2_block_shape", "the unmodified C1 page is not a C2 page");
});

test("C2G-05 scope layer, by design: an in-zone fingerprint edit is accepted by SCOPE alone; identity is the C2_INDEX_PIN layer", () => {
  const fin = once(candidate, '["otherExpense", "other_expense"], ["isException", "is_exception"]]);', '["otherExpense", "other_expense"]]);');
  assert.deepEqual(c2IndexVerdict(base, fin), { ok: true });
  assert.notEqual(blobOf(fin), C2_INDEX_PIN.blob, "the identity pin refuses it");
});

test("C2G-06 identity layer: the C2 pin is a fixed literal equal to the candidate page and its status is the candidate's", () => {
  assert.match(C2_INDEX_PIN.blob, /^[0-9a-f]{40}$/);
  assert.match(C2_INDEX_PIN.status, /pending independent review/);
  assert.doesNotMatch(C2_INDEX_PIN.status, /approved/i);
  assert.equal(blobOf(candidate), C2_INDEX_PIN.blob);
  const pinSrc = readFileSync(join(REPO, "test/support/c2-candidate-pin.mjs"), "utf8");
  assert.ok(!/rev-parse|hash-object|readFileSync|execSync|spawnSync|import /.test(pinSrc), "pin module computes nothing");
  assert.notEqual(C2_INDEX_PIN.blob, C1_INDEX_PIN.blob, "C2 does not reuse the C1 pin");
});

test("C2G-07 retirement: exactly lib/entryDelta.js is retired (C2-03); it existed in the base", () => {
  assert.deepEqual([...C2_RETIRED], ["lib/entryDelta.js"]);
  for (const f of C2_RETIRED) {
    assert.ok(!existsSync(join(REPO, f)));
    assert.equal(gitIn(REPO, ["cat-file", "-e", C2_BASE + ":" + f]).status, 0, f + " existed in the C2 base");
  }
});
