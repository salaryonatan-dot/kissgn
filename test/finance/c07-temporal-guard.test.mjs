// C07T-F1: proposed current-carrier and temporal-fixture contract. Author evidence, never independent acceptance.
import { historicalTest } from "../support/m1-a1-inspection.mjs";
const test = historicalTest(new URL("../../", import.meta.url), "7062046c0227a3647fbd034e83c9bcff937e79f6", "test/finance/c07-temporal-guard.test.mjs");
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { REPO } from "../support/fincore-load.mjs";
import { gitIn } from "../support/git-context.mjs";
import { gitBlobId } from "../../tools/storage-v2/canary-transport.mjs";
import { C07T_PARENT, C07T_FILES, C07T_PINS, verifyC07TemporalHead } from "../support/c07-temporal-fixture.mjs";
const read = (f) => readFileSync(join(REPO, f), "utf8");
const at = (ref, f) => { const r = gitIn(REPO, ["show", ref + ":" + f]); assert.equal(r.status, 0, r.stderr); return r.stdout; };
const F = "test/finance/b1-downstream-compat.test.mjs", G = "test/finance/c07-compat-fixture-guard.test.mjs";
const row = (s) => s.slice(s.indexOf('test("COMPAT-07 '), s.indexOf('\ntest("COMPAT-08 '));

test("C07TG-01 exact temporal carrier: sole-parent accepted C07, current committed/index/working scope and pins, no runtime or release-pin delta", () => {
  verifyC07TemporalHead(REPO);
  // Independent of the verifier body: a weakened support function is itself a content mismatch.
  for (const [f, pin] of Object.entries(C07T_PINS)) assert.equal(gitBlobId(readFileSync(join(REPO, f))), pin, f + " independent current pin");
  const r = gitIn(REPO, ["diff", "--name-only", C07T_PARENT, "HEAD", "--", "src", "fincore", "lib", "api", "tools", "scripts", "docs", "index.html", "database.rules.json", "package.json", "package-lock.json"]);
  assert.equal(r.status, 0); assert.equal(r.stdout, "", "test-side correction only");
  assert.ok(C07T_FILES.every((f) => f.startsWith("test/")));
});

test("C07TG-02 only COMPAT-07 changes; original behavior assertions, threshold path, values and comparison remain; execution-clock and literal temporal regressions committed", () => {
  const old = at(C07T_PARENT, F), now = read(F);
  assert.equal(now.slice(0, now.indexOf('test("COMPAT-07 ')), old.slice(0, old.indexOf('test("COMPAT-07 ')), "prefix including imports and other rows unchanged");
  assert.equal(now.slice(now.indexOf('\ntest("COMPAT-08 ')), old.slice(old.indexOf('\ntest("COMPAT-08 ')), "COMPAT-08 and suffix unchanged");
  const allowed = (l) => l.startsWith('test("COMPAT-07 ') || l === "const nonVd = nonVdRows(10, 1);";
  for (const l of row(old).split("\n").map((l) => l.trim()).filter((l) => l && !allowed(l)))
    assert.ok(row(now).split("\n").map((l) => l.trim()).includes(l), "original scenario line retained: " + l.slice(0, 70));
  assert.ok(row(now).includes('date: ago(i + 1)'), "non-VD rows use the same business-date labels");
  assert.ok(row(now).includes('const executingMs = CallerDate.now();') && row(now).includes('await scenario(executingMs);') && row(now).includes('finally {') && row(now).includes('globalThis.Date = CallerDate;'), "execution capture and restoration");
  assert.ok(row(now).includes('timeZone: "Asia/Jerusalem"'), "business timezone is not UTC or the host timezone");
  assert.equal((row(now).match(/\["2026-\d\d-\d\dT[^"\n]+Z", "2026-\d\d-\d\d"\]/g) || []).length, 8, "eight literal offset/boundary cases");
  assert.ok(!/test\.skip\(|test\.todo\(|skip\s*:/.test(row(now)), "no temporal-window skip");
});

test("C07TG-03 accepted C07 guard proof retained historically; it also validates this exact current carrier; RF3 layer and accepted records untouched", () => {
  const old = at(C07T_PARENT, G), now = read(G);
  assert.ok(now.includes('const C07_TREE = TEMPORAL ? C07T_PARENT : "HEAD";'));
  assert.ok(now.includes('if (TEMPORAL) verifyC07TemporalHead(REPO);'), "C07G itself holds the later carrier");
  const start2 = 'test("C07G-02', start3 = 'test("C07G-03';
  const normalize = (s) => s.replace('const now = TEMPORAL ? at(C07_TREE, C07_FIXTURE) : read(C07_FIXTURE),', 'const now = read(C07_FIXTURE),');
  assert.equal(normalize(now.slice(now.indexOf(start2), now.indexOf(start3))), old.slice(old.indexOf(start2), old.indexOf(start3)), "C07G-02 assertions unchanged, historical fixture input only");
  assert.equal(now.slice(now.indexOf(start3)), old.slice(old.indexOf(start3)), "C07G-03 unchanged");
  for (const f of ["test/support/c07-compat-fixture.json", "test/support/c07-compat-fixture.mjs", "test/finance/rf3-rules-gate-guard.test.mjs", "test/support/rf3-rules-gate.json", "test/support/rf2-rules-gate.mjs"])
    assert.equal(read(f), at(C07T_PARENT, f), f + " accepted source unchanged");
});
