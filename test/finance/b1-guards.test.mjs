// Financial Core B1 — structural guards GUARD-01…08 and the AMEND-02 allowlist mutation
// proofs G2-01…06 (the validator used by fincore-guards G-B2, exercised on synthetic inputs).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { REPO } from "../support/fincore-load.mjs";
import { gitIn } from "../support/git-context.mjs";
import { closureSources, generate } from "../../tools/finance-core/gen-browser.mjs";
import {
  SERVER_READER_APPROVED_BLOBS, SERVER_READER_AUTHORIZED_FILES, SERVER_READER_BASE, collectServerReaderScopeInputs, serverReaderScopeVerdict,
} from "../support/server-reader-authorized-delta.mjs";
import { authorizedVersionFenceRulesDelta } from "../support/rules-authorized-delta.mjs";
import { importerVerdict, loadConsumerFiles, repoKindOf, validateConsumerFiles, importsCore, importsServerApi } from "../support/b1-fixtures.mjs";

const B1_BASE = "213fb350019c3e212156eb032e34f4da8c179d6f";
const read = (rel) => readFileSync(join(REPO, rel), "utf8");
const code = (rel) => read(rel).replace(/\/\*[\s\S]*?\*\//g, "").split("\n").map((l) => l.replace(/(^|[^:"'`])\/\/.*$/, "$1")).join("\n");
const MIGRATED = ["src/repositories/analytics/dailyMetricsRepo.ts", "src/repositories/analytics/laborRepo.ts", "src/repositories/analytics/purchasesRepo.ts", "src/analytics/dailyBuilder.ts"];
const B1_JSON = JSON.parse(read("test/finance/core-consumers/b1.json"));

test("GUARD-01 the server wrappers are pure: canonicalMetrics has no I/O, clock or binary math; canonicalInputs has exactly one clock read", () => {
  const cm = code("src/finance-server/canonicalMetrics.ts");
  for (const re of [/from\s+["']node:/, /firebase/, /Date\.now/, /new Date\(/, /\bNumber\(/, /Math\./, /\.toFixed\(/, /parseFloat/, /parseInt/, /\.ref\(/, /\.once\(/, /\.set\(/, /\.update\(/])
    assert.doesNotMatch(cm, re, "canonicalMetrics.ts matches " + re);
  const ci = code("src/finance-server/canonicalInputs.ts");
  assert.equal((ci.match(/Date\.now\(\)/g) || []).length, 1, "the only clock read of the financial read path");
  for (const re of [/new Date\(/, /\bNumber\(/, /Math\./, /\.set\(/, /\.update\(/, /\.remove\(/, /\.transaction\(/, /firebase/]) assert.doesNotMatch(ci, re, "canonicalInputs.ts matches " + re);
});

test("GUARD-02 core import allowlist: only src/finance-server loads the core; exactly the 5 listed files import src/finance-server", () => {
  const files = ["index.html", ...gitIn(REPO, ["ls-files", "api", "lib", "src"]).stdout.trim().split("\n"), ...gitIn(REPO, ["ls-files", "--others", "--exclude-standard", "src", "api", "lib"]).stdout.trim().split("\n")].filter((f) => f && /\.(ts|js|html)$/.test(f));
  const core = ["src/finance/", "src/metrics/", "src/policy/", "src/presenters/", "src/browser/"];
  const coreImporters = new Set(), serverImporters = new Set();
  for (const f of new Set(files)) {
    if (core.some((d) => f.startsWith(d))) continue;
    const src = read(f);
    if (importsCore(src)) coreImporters.add(f);
    if (!f.startsWith("src/finance-server/") && importsServerApi(src)) serverImporters.add(f);
  }
  assert.deepEqual([...coreImporters].sort(), [...B1_JSON.consumers].sort());
  assert.deepEqual([...serverImporters].sort(), [...B1_JSON.serverApiConsumers].sort());
  assert.ok([...coreImporters].every((f) => f.startsWith("src/finance-server/")));
});

test("GUARD-03 computePeriodReport( and toDailyMetric( are called only in src/policy/productFinance.ts, with the product basis and labor source", () => {
  const files = gitIn(REPO, ["ls-files", "api", "lib", "src", "index.html"]).stdout.trim().split("\n").concat(gitIn(REPO, ["ls-files", "--others", "--exclude-standard", "src"]).stdout.trim().split("\n")).filter((f) => /\.(ts|js|html)$/.test(f));
  const callers = { computePeriodReport: [], toDailyMetric: [] };
  for (const f of new Set(files)) {
    const c = code(f);
    for (const fn of Object.keys(callers)) if (new RegExp(`(?<!function )\\b${fn}\\(`).test(c)) callers[fn].push(f);
  }
  assert.deepEqual(callers.computePeriodReport, ["src/policy/productFinance.ts"]);
  assert.deepEqual(callers.toDailyMetric, ["src/policy/productFinance.ts"]);
  const pf = code("src/policy/productFinance.ts");
  assert.match(pf, /computePeriodReport\(days, productTimeline\(inputs\), productPurchaseBasis\(\), productLaborSource\(\),/);
  // CD-M1 (owner closed-days amendment, MARJIN_PRODUCT/2): the bound calendar is the product
  // closure calendar derived from the exception domain (was NO_DECLARED_CLOSURES); still no caller-supplied calendar.
  assert.match(pf, /toDailyMetric\(day, basis, productLaborSource\(\), timeline, \{ asOfBusinessDate: asOf, operatingCalendar: calendar, closureCalendarUnreadable \}\)/);
  assert.match(pf, /operatingCalendar: productClosureCalendar\(inputs, n\), closureCalendarUnreadable: closureCalendarUnknown\(inputs\) \}\)/);
  assert.match(pf, /resolvePurchaseBasis\([^;]*productPurchaseBasis\(\)\)/);
});

test("GUARD-04 the retired helpers are absent from the migrated files; no hourly_payroll / supplier arithmetic survives there", () => {
  for (const f of MIGRATED) {
    const c = code(f);
    for (const sym of ["rowComponents", "decimalSum", "sumSupplierPayments", "sumObj", "requireRowForDate", "requireEntriesRows", "canonicalDecimal", "CANONICAL_DECIMAL", "aggregateByDate", "RawEntry", "readRows", "DailyEntry"]) assert.ok(!new RegExp(`\\b${sym}\\b`).test(c), `${f} still carries ${sym}`);
    assert.doesNotMatch(c, /hourly_payroll|supplier_payments|\bfood_cost\s*[+\-*/]|payroll_manual|total_payroll/, f);
  }
  const db = code("src/analytics/dailyBuilder.ts");
  const numUses = [...db.matchAll(/\bnum\(([^)]*)\)/g)].map((m) => m[1]).filter((a) => !/^value: any$/.test(a));
  assert.ok(numUses.includes("config.lat") && numUses.includes("config.lon"));
  for (const a of numUses) assert.match(a, /^(?:config\.(?:lat|lon)|raw\?\.daily\?\.\w+\?\.\[0\])$/, "num() survives for location / weather only: " + a);
});

test("GUARD-05 server-reader pins: exactly 5 files; the 4 B1 files re-pinned to their git hash-object; the snapshot pin unchanged; no other protected path changed", () => {
  assert.deepEqual([...SERVER_READER_AUTHORIZED_FILES].sort(), ["src/analytics/dailyBuilder.ts", "src/repositories/analytics/dailyMetricsRepo.ts", "src/repositories/analytics/laborRepo.ts", "src/repositories/analytics/purchasesRepo.ts", "src/snapshot/snapshotBuilder.ts"]);
  for (const f of MIGRATED) {
    const h = gitIn(REPO, ["hash-object", f]); assert.equal(h.status, 0);
    assert.equal(SERVER_READER_APPROVED_BLOBS[f], h.stdout.trim(), f + " pin = working tree");
    const atBase = gitIn(REPO, ["rev-parse", `${B1_BASE}:${f}`]).stdout.trim();
    assert.notEqual(SERVER_READER_APPROVED_BLOBS[f], atBase, f + " is a reviewed B1 change (re-pinned)");
  }
  const snap = "src/snapshot/snapshotBuilder.ts";
  assert.equal(SERVER_READER_APPROVED_BLOBS[snap], gitIn(REPO, ["rev-parse", `${B1_BASE}:${snap}`]).stdout.trim(), "snapshot pin unchanged (B2 owns it)");
  const raw = collectServerReaderScopeInputs(REPO);
  const core = JSON.parse(gitIn(REPO, ["show", `${SERVER_READER_BASE}:database.rules.json`]).stdout);
  const fence = authorizedVersionFenceRulesDelta(core, JSON.parse(read("database.rules.json"))).ok === true;
  const live = { ...raw, changedProtectedPaths: raw.changedProtectedPaths.filter((r) => !(fence && r === "database.rules.json")) };
  assert.deepEqual(serverReaderScopeVerdict(live), { ok: true });
  const b1Protected = gitIn(REPO, ["diff", "--name-only", B1_BASE, "--"]).stdout.trim().split("\n").filter((f) => /^src\/(analytics|repositories|agent|snapshot|forecast)\//.test(f));
  assert.deepEqual(b1Protected.sort(), [...MIGRATED].sort(), "B1 changes no other protected file");
});

test("GUARD-06 ServerProvenance constants are imported from the core, never re-typed", () => {
  const cm = code("src/finance-server/canonicalMetrics.ts") + code("src/finance-server/canonicalInputs.ts").replace(/"MARJIN_FIN_SERVER\/1"/, "");
  for (const lit of ["MARJIN_FIN/", "MARJIN_NORM", "MARJIN_DEC", "MARJIN_LABOR", "MARJIN_PB", "PB_NET/BD-1", "LABOR_SRC/", "completed_days_through", "MARJIN_PRODUCT"]) assert.ok(!cm.includes(lit), "re-typed constant " + lit);
  for (const sym of ["FINANCIAL_FORMULA_VERSION", "NORMALIZATION_VERSION", "DECIMAL_CONTRACT_VERSION", "LABOR_CONTRACT_VERSION", "PURCHASE_BASIS_CONTRACT_VERSION", "PB_NET_POLICY_ID", "ACTUAL_WINDOW_RULE", "PRODUCT_FINANCE_VERSION", "productLaborSource"]) assert.match(cm, new RegExp(`import[^;]*\\b${sym}\\b`), "imports " + sym);
  assert.equal((code("src/finance-server/canonicalInputs.ts").match(/MARJIN_FIN_SERVER\/1/g) || []).length, 1, "the server API version is declared once");
});

test("GUARD-07 the B1 diff adds no line matching the vat-invariant forbidden-word regex (pre-check with the same regex)", () => {
  const re = /\b(?:migration|migrate|_rtdbSet|storage\.set|set\(ref|remove\(ref|persist\(|entries\s*=)\b/i;
  const diff = gitIn(REPO, ["diff", "--unified=0", B1_BASE, "--", "index.html", "api", "lib", "src"]); assert.equal(diff.status, 0, diff.stderr);
  const added = diff.stdout.split(/\r?\n/).filter((l) => l.startsWith("+") && !l.startsWith("+++")).map((l) => l.slice(1));
  const untracked = gitIn(REPO, ["ls-files", "--others", "--exclude-standard", "--", "index.html", "api", "lib", "src"]).stdout.trim().split("\n").filter(Boolean);
  for (const f of untracked) added.push(...read(f).split("\n"));
  assert.ok(added.length > 100, "the B1 runtime diff is inspected");
  assert.deepEqual(added.filter((l) => re.test(l)), []);
});

test("GUARD-08 fincore/v1 regenerates byte-identically; the browser closure is the BASE closure plus src/policy/productFinance.ts (+ CD-M1 src/metrics/revenueForecast.ts)", () => {
  const tmp = mkdtempSync(join(tmpdir(), "b1-fincore-"));
  const m = generate({ repo: REPO, outDir: tmp });
  for (const rel of ["MANIFEST.json", "browser/marjinFinanceGlobal.js", "policy/productFinance.js"]) assert.ok(readFileSync(join(tmp, rel)).equals(readFileSync(join(REPO, "fincore/v1", rel))), rel);
  const baseManifest = JSON.parse(gitIn(REPO, ["show", `${B1_BASE}:fincore/v1/MANIFEST.json`]).stdout);
  assert.deepEqual([...closureSources(REPO)].sort(), [...baseManifest.sources, "src/policy/productFinance.ts", "src/metrics/revenueForecast.ts"].sort());
  assert.deepEqual(m.sources, closureSources(REPO));
  assert.equal(m.typescript, "5.9.3");
});

// ── AMEND-02 validator mutation proofs ────────────────────────────────────────
const FAKE = new Map([["src/finance-server/canonicalInputs.ts", "file"], ["src/finance-server/canonicalMetrics.ts", "file"], ["src/finance-server", "dir"], ["src/analytics/dailyBuilder.ts", "file"], ["src/services/analyticsService.ts", "file"], ["index.html", "file"], ["src/snapshot/snapshotBuilder.ts", "file"]]);
const kindOf = (rel) => FAKE.get(rel) || null;
const valid = () => ({ name: "b1.json", json: { slice: "B1", consumers: ["src/finance-server/canonicalInputs.ts", "src/finance-server/canonicalMetrics.ts"], serverApiConsumers: ["src/analytics/dailyBuilder.ts", "src/services/analyticsService.ts"] } });
const errorsOf = (files) => validateConsumerFiles(files, kindOf).errors;

test("G2-01 a glob entry fails", () => {
  for (const g of ["src/finance-server/*.ts", "src/**/x.ts", "src/finance-server/canonical{Inputs,Metrics}.ts", "src/finance-server/canonical?nputs.ts"]) {
    const f = valid(); f.json.consumers = [g];
    assert.ok(errorsOf([f]).some((e) => /glob/.test(e)), g);
  }
});

test("G2-02 a directory entry fails (with or without a trailing slash)", () => {
  for (const [d, why] of [["src/finance-server", /directory/], ["src/finance-server/", /not_exact_path/], ["./src/finance-server/canonicalInputs.ts", /not_exact_path/], ["src/../src/finance-server/canonicalInputs.ts", /not_exact_path/], ["src/finance-server/missing.ts", /missing_file/]]) {
    const f = valid(); f.json.consumers = [d];
    assert.ok(errorsOf([f]).some((e) => why.test(e)), d + " → " + JSON.stringify(errorsOf([f])));
  }
});

test("G2-03 an unknown slice file fails (unknown slice, name ≠ slice, unknown key, index.html before C1)", () => {
  assert.ok(errorsOf([{ name: "z9.json", json: { slice: "Z9", consumers: [] } }]).some((e) => /unknown slice/.test(e)));
  assert.ok(errorsOf([{ ...valid(), name: "b2.json" }]).some((e) => /file name must be b1\.json/.test(e)));
  const extra = valid(); extra.json.allowEverything = true; assert.ok(errorsOf([extra]).some((e) => /unknown key allowEverything/.test(e)));
  const idx = valid(); idx.json.consumers = ["index.html"]; assert.ok(errorsOf([idx]).some((e) => /index\.html may be listed only by a slice >= C1/.test(e)));
  assert.deepEqual(errorsOf([{ name: "c1.json", json: { slice: "C1", consumers: ["index.html"] } }]), [], "C1 may list index.html");
  assert.ok(errorsOf([{ name: "b1.json", json: { __parseError: true } }]).some((e) => /not a JSON object/.test(e)));
});

test("G2-04 a duplicate entry fails (within one file and across slice files)", () => {
  const dupIn = valid(); dupIn.json.consumers.push("src/finance-server/canonicalInputs.ts");
  assert.ok(errorsOf([dupIn]).some((e) => /duplicate consumers entry/.test(e)));
  const b2 = { name: "b2.json", json: { slice: "B2", serverApiConsumers: ["src/analytics/dailyBuilder.ts"] } };
  assert.ok(errorsOf([valid(), b2]).some((e) => /duplicate serverApiConsumers entry src\/analytics\/dailyBuilder\.ts/.test(e)));
  assert.deepEqual(errorsOf([valid(), { name: "b2.json", json: { slice: "B2", serverApiConsumers: ["src/snapshot/snapshotBuilder.ts"] } }]), [], "disjoint slice files are fine");
  // B1 R1 (Codex FC-02 / AR-10): ONE owner per path — the same path under a different category
  // is a collision too, within one file and across slice files
  const cross = valid(); cross.json.serverApiConsumers.push("src/finance-server/canonicalInputs.ts");
  assert.ok(errorsOf([cross]).some((e) => /duplicate serverApiConsumers entry src\/finance-server\/canonicalInputs\.ts \(also in b1\.json:consumers\)/.test(e)), JSON.stringify(errorsOf([cross])));
  const crossSlice = { name: "c1.json", json: { slice: "C1", consumers: ["src/analytics/dailyBuilder.ts"] } };
  assert.ok(errorsOf([valid(), crossSlice]).some((e) => /duplicate consumers entry src\/analytics\/dailyBuilder\.ts \(also in b1\.json:serverApiConsumers\)/.test(e)), JSON.stringify(errorsOf([valid(), crossSlice])));
  assert.equal(validateConsumerFiles([valid(), crossSlice], kindOf).ok, false);
});

test("G2-05 an unlisted importer fails (core and server API, static / dynamic / re-export imports)", () => {
  const v = validateConsumerFiles([valid()], kindOf);
  const listed = { "src/finance-server/canonicalMetrics.ts": 'import { x } from "../policy/productFinance.js";', "src/analytics/dailyBuilder.ts": 'import { y } from "../finance-server/canonicalMetrics.js";' };
  assert.deepEqual(importerVerdict(listed, v), { ok: true, unlistedCore: [], unlistedServer: [] });
  for (const [rel, src, kind] of [
    ["src/snapshot/snapshotBuilder.ts", 'import { computePeriodReport } from "../metrics/report.js";', "unlistedCore"],
    ["src/alerts/checkers.ts", 'const m = await import("../finance/normalize.js");', "unlistedCore"],
    ["src/utils/x.ts", 'export { productDays } from "../policy/productFinance.js";', "unlistedCore"],
    ["index.html", '<script src="fincore/v1/browser/marjinFinanceGlobal.js"></script>', "unlistedCore"],
    ["src/snapshot/snapshotBuilder.ts", 'import { canonicalMonthReport } from "../finance-server/canonicalMetrics.js";', "unlistedServer"],
    ["api/x.ts", 'import "../src/finance-server/canonicalInputs.js";', "unlistedServer"],
  ]) {
    const r = importerVerdict({ ...listed, [rel]: src }, v);
    assert.equal(r.ok, false, rel); assert.deepEqual(r[kind], [rel], `${rel} → ${kind}`);
  }
});

test("G2-06 the committed b1.json passes against the real repository", () => {
  const files = loadConsumerFiles(REPO);
  assert.deepEqual(files.map((f) => f.name), ["b1.json"]);
  const v = validateConsumerFiles(files, repoKindOf(REPO));
  assert.deepEqual(v.errors, []); assert.equal(v.ok, true);
  assert.deepEqual([...v.consumers].sort(), ["src/finance-server/canonicalInputs.ts", "src/finance-server/canonicalMetrics.ts"]);
  assert.equal(v.serverApiConsumers.size, 5);
});
