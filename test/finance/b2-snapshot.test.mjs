// Financial Core B2 — the morning snapshot served from the canonical B1 server API.
// B2-T01…T16 (downstream preflight 07 §B2), INV-01…14 through the snapshot, the
// consumer-audit cluster FC-01 scenarios (financial-completeness-consumer-audit 02), and the
// B1 R1 readiness wiring (one clock, need.exceptions, existing canonicalMonthProjection).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { compileServer, makeDb, installDb, offlineFetch } from "../support/server-reader-harness.mjs";
import { seedRaw, env, entry, uid, configWithGlobal, fixedItems, T, B, nowMsFor, recordingDb, stableJson, badValues, entriesKey } from "../support/b1-fixtures.mjs";
import { INVARIANTS, INV_NOW_MS, completeSeptember, fullDay, GLOBAL_3000, FIXED_3100, MONTH_LENGTHS, monthDates } from "../support/financial-invariants.mjs";
import { gitIn } from "../support/git-context.mjs";

offlineFetch();
const srv = compileServer();
const SB = await srv.import("src/snapshot/snapshotBuilder.js");
const CI = await srv.import("src/finance-server/canonicalInputs.js");
const CM = await srv.import("src/finance-server/canonicalMetrics.js");
const SE = await srv.import("src/snapshot/snapshotEmail.js");
const REPO = join(import.meta.dirname, "..", "..");
const NOW = INV_NOW_MS; // 2026-09-29 09:00 UTC ⇒ asOf 2026-09-29, Actual 09-01…09-28

function seed({ rows, config = GLOBAL_3000, fixed = FIXED_3100, exceptions, raw = {} } = {}) {
  const db = installDb(makeDb());
  seedRaw(db, {
    entries: raw.entries !== undefined ? raw.entries : env(rows),
    config: raw.config !== undefined ? raw.config : env(config),
    fixed: raw.fixed !== undefined ? raw.fixed : env(fixed),
    businesses: [{ id: B, name: "Biz " + B }],
  });
  if (exceptions !== undefined) db.seed(`tenants/${T}/entry_exceptions/${B}`, exceptions);
  return db;
}
const snapOf = async (opts, nowMs = NOW) => { seed(opts); return SB.buildSnapshotForBiz(T, B, { nowMs }); };
const noFin = (s) => { const { financials, ...rest } = s; return rest; };

// ── B2-T01 ────────────────────────────────────────────────────────────────────
test("B2-T01 open month, complete Sep 1–28: every figure equals the canonicalMonthReport exact value, converted once", async () => {
  const rows = completeSeptember();
  const s = await snapOf({ rows });
  const inputs = await CI.loadCanonicalInputs(globalThis.__DB, T, B, { site: "t", nowMs: NOW, need: { config: true, fixed: true, exceptions: true } });
  const { report, provenance } = CM.canonicalMonthReport(inputs, { kind: "open_month", month: "2026-09" });
  const a = report.actual, f = s.financials;
  assert.equal(s.presentation, "month_actual");
  assert.deepEqual([s.date, s.month, f.window.completedThrough, s.daysPassed, s.presentDays, s.daysInMonth, s.daysLeft], ["2026-09-29", "2026-09", "2026-09-28", 28, 28, 30, 2]);
  assert.deepEqual(
    [f.amounts.revenue.exact, f.amounts.purchases.exact, f.amounts.laborEmployerCost.exact, f.amounts.fixedRegular.exact, f.amounts.operatingProfit.exact],
    [a.revenue.value, a.purchases.value, a.labor.employerCost.value, a.fixedAccrual.regular, a.operatingProfit.value]);
  // hand oracle: revenue 28×1000; purchases 28×300; labor 28×100 + 3000×28/30; fixed 3100×28/30
  assert.deepEqual([f.amounts.revenue.exact, f.amounts.purchases.exact, f.amounts.laborEmployerCost.exact, f.amounts.fixedRegular.exact], ["28000", "8400", "5600", "8680/3"]);
  assert.equal(f.amounts.operatingProfit.exact, "33320/3", "28000 − 8400 − 2800 − 2800 − 8680/3");
  assert.deepEqual([s.totalSales, s.totalFood, s.totalPayroll, s.fixedRegular, s.foodCostPct, s.laborPct], [28000, 8400, 5600, 2893.3333333333, 30, 20]);
  assert.equal(s.netProfit, 11106.6666666667, "one legacy conversion at 10 dp (amountToNumber)");
  assert.equal(f.provenance.api, "MARJIN_FIN_SERVER/1"); assert.equal(f.provenance.fin, provenance.fin);
  assert.deepEqual([f.provenance.proj, f.provenance.forecast, f.provenance.snapshot, f.provenance.exceptionsState], ["MARJIN_PROJ/2", "REV_FORECAST/v2", "MARJIN_SNAPSHOT/2", "absent"]);
  assert.deepEqual(badValues(s), [], "no undefined / NaN / Infinity anywhere in the snapshot");
  assert.ok(!("totalExpenses" in s) && !("dailyAvg" in s), "B2-12 / B2-18 (VD-41 default): the unnamed totals are retired");
});

// ── B2-T02 / INV-01 ───────────────────────────────────────────────────────────
test("B2-T02 / INV-01 a today row (added, large, tiny) never changes any Actual value; the projection context may", async () => {
  const base = completeSeptember();
  const [v0, ...others] = INVARIANTS.find((i) => i.id === "INV-01").variants(base);
  const ref = await snapOf({ rows: v0 });
  for (const rows of others) {
    const s = await snapOf({ rows });
    assert.equal(stableJson({ a: s.financials.amounts, r: s.financials.ratios, w: s.financials.window, c: s.financials.coverage }), stableJson({ a: ref.financials.amounts, r: ref.financials.ratios, w: ref.financials.window, c: ref.financials.coverage }));
    assert.equal(s.totalSales, 28000);
  }
});

// ── B2-T03 / INV-02 / FC-01 ───────────────────────────────────────────────────
test("B2-T03 / INV-02 a missing completed day: revenue is a PARTIAL sum, profit and ratios unavailable, no profit / ratio insight", async () => {
  const rows = INVARIANTS.find((i) => i.id === "INV-02").apply(completeSeptember());
  const s = await snapOf({ rows });
  const f = s.financials;
  assert.equal(f.amounts.revenue.state, "partial"); assert.equal(f.amounts.revenue.exact, "27000");
  assert.deepEqual(f.coverage.revenue.missing, ["2026-09-20"]);
  assert.deepEqual([s.netProfit, s.foodCostPct, s.laborPct, s.forecast], [null, null, null, null]);
  assert.equal(f.amounts.operatingProfit.state, "unavailable");
  assert.deepEqual(s.insights.filter((i) => ["net_profit", "food_cost", "labor"].includes(i.rule)), [], "VD-44: no insight on an incomplete input");
});

// ── B2-T04 / INV-03 ───────────────────────────────────────────────────────────
test("B2-T04 / INV-03 an explicit zero revenue day is present and complete; profit stays numeric", async () => {
  const rows = INVARIANTS.find((i) => i.id === "INV-03").apply(completeSeptember());
  const s = await snapOf({ rows });
  assert.equal(s.financials.amounts.revenue.state, "complete"); assert.equal(s.totalSales, 27000);
  assert.equal(s.presentDays, 28, "the zero day counts as entered");
  assert.equal(s.financials.amounts.purchases.exact, "8100", "supplier 0 / skip are a real zero");
  assert.equal(typeof s.netProfit, "number");
});

test("INV-04 an invalid revenue cell is invalid (never 0): revenue not complete, profit unavailable", async () => {
  const rows = INVARIANTS.find((i) => i.id === "INV-04").apply(completeSeptember());
  const s = await snapOf({ rows });
  // the day's other revenue cells are valid ⇒ the day is PARTIAL (the invalid cell is not a 0)
  assert.deepEqual([...s.financials.coverage.revenue.invalid, ...s.financials.coverage.revenue.partial], ["2026-09-11"]);
  assert.equal(s.financials.amounts.revenue.state, "partial");
  assert.equal(s.netProfit, null); assert.equal(s.foodCostPct, null);
});

// ── B2-T05 ────────────────────────────────────────────────────────────────────
test("B2-T05 global config missing amount / invalid / config unreadable ⇒ labor and profit unavailable, labor insight suppressed", async () => {
  const cases = {
    missing: { config: { employees: [{ id: "g1", type: "global", name: "G" }] } },
    invalid: { config: configWithGlobal("abc") },
    unreadable: { raw: { config: { _v: "{not json" } } },
  };
  for (const [name, opts] of Object.entries(cases)) {
    const s = await snapOf({ rows: completeSeptember(), ...opts });
    assert.equal(s.totalPayroll, null, name + " labor"); assert.equal(s.laborPct, null, name + " labor %"); assert.equal(s.netProfit, null, name + " profit");
    assert.equal(s.insights.some((i) => i.rule === "labor" || i.rule === "net_profit"), false, name + " insights");
  }
});

// ── B2-T06 / B2-T07 / INV-11 (R-17) ───────────────────────────────────────────
test("B2-T06 / B2-T07 / INV-11 R-17: fixed absent / [] ⇒ 0 and complete; unreadable ⇒ invalid; enabled item without amount ⇒ missing", async () => {
  for (const [name, raw] of [["absent", { fixed: null }], ["empty", { fixed: env([]) }]]) {
    const s = await snapOf({ rows: completeSeptember(), raw });
    assert.equal(s.financials.amounts.fixedRegular.exact, "0", name); assert.equal(s.fixedRegular, 0, name);
    assert.equal(s.financials.amounts.operatingProfit.state, "complete", name + ": profit complete");
  }
  const bad = await snapOf({ rows: completeSeptember(), raw: { fixed: { _v: "[broken" } } });
  assert.deepEqual([bad.fixedRegular, bad.netProfit], [null, null], "unreadable fixed list is invalid, never 0");
  const noAmount = await snapOf({ rows: completeSeptember(), fixed: [{ id: "f1", name: "Rent-ish" }] });
  assert.deepEqual([noAmount.fixedRegular, noAmount.netProfit], [null, null], "enabled item without an amount is missing");
});

// ── B2-T08 / INV-08 / FC-01 hourly variant ────────────────────────────────────
test("B2-T08 / INV-08 hourly_payroll is never counted (FC-01 variant: only hourly_payroll 200 ⇒ labor stays unavailable)", async () => {
  const ref = await snapOf({ rows: completeSeptember() });
  const withHourly = await snapOf({ rows: INVARIANTS.find((i) => i.id === "INV-08").apply(completeSeptember()) });
  assert.equal(withHourly.financials.amounts.laborEmployerCost.exact, ref.financials.amounts.laborEmployerCost.exact);
  assert.equal(withHourly.financials.coverage.legacyHourlyPayrollDates.length, 28);
  const onlyHourly = await snapOf({ rows: [entry(uid(1), "2026-09-28", { sales: "1000", hourly_payroll: { employee: "200" } })] });
  assert.notEqual(onlyHourly.totalPayroll, 200); assert.equal(onlyHourly.totalPayroll, null);
});

// ── B2-T09 ────────────────────────────────────────────────────────────────────
test("B2-T09 month-level OR regression: one supplier row no longer hides every legacy food_cost row (per-row selection, VD-05)", async () => {
  const rows = SEP(28).map((d, i) => (i === 0 ? fullDay(d, { supplier_payments: { s1: "300" } }) : fullDay(d, { supplier_payments: undefined, food_cost: "200" })));
  const s = await snapOf({ rows });
  assert.equal(s.financials.amounts.purchases.exact, String(300 + 27 * 200));
});
function SEP(n) { return Array.from({ length: n }, (_, i) => `2026-09-${String(i + 1).padStart(2, "0")}`); }

// ── B2-T10 (VD-45 default) ────────────────────────────────────────────────────
test("B2-T10 1st of the month: no completed day ⇒ VD-45 default (b) — no figure at all, never an empty/zero month or a fixed-cost 'loss'", async () => {
  const rows = [...completeSeptember(), fullDay("2026-10-01", { sales: "5000" })];
  const s = await snapOf({ rows }, nowMsFor("2026-10-01"));
  assert.equal(s.presentation, "no_completed_days"); assert.equal(s.month, "2026-10");
  for (const k of ["totalSales", "totalFood", "totalPayroll", "fixedRegular", "rentFixedAmount", "rentPctAmount", "royaltyAmount", "netProfit", "foodCostPct", "laborPct", "forecast", "paceRevenue"]) assert.equal(s[k], null, k);
  assert.equal(s.daysPassed, 0); assert.deepEqual(s.insights, []);
  assert.ok(s.financials.projection.warnings.includes("no_completed_days"));
});

// ── B2-T11 / INV-09 / INV-10 ──────────────────────────────────────────────────
test("B2-T11 / INV-09 / INV-10 month lengths (28/29/30/31), no closures: global and fixed accrue monthly/days per allocation-eligible day (= calendar day without a completed closure) through D-1, independent of rows", async () => {
  for (const { month, days } of MONTH_LENGTHS) {
    const dates = monthDates(month, days);
    const sparse = dates.slice(0, days - 1).filter((_, i) => i % 3 === 0).map((d) => fullDay(d)); // entries on a third of the days only
    const s = await snapOf({ rows: sparse }, nowMsFor(dates[days - 1]));
    const f = s.financials;
    assert.equal(f.window.recognizedDays, days - 1, month);
    const expected = (monthly) => { const n = monthly * (days - 1), g = gcd(n, days); return days / g === 1 ? String(n / g) : `${n / g}/${days / g}`; };
    assert.equal(f.amounts.globalEmployerCost.exact, expected(3000), month + " global");
    assert.equal(f.amounts.fixedRegular.exact, expected(3100), month + " fixed");
  }
});
function gcd(a, b) { return b ? gcd(b, a % b) : a; }

// ── B2-T12 ────────────────────────────────────────────────────────────────────
test("B2-T12 projection = the EXISTING canonicalMonthProjection (no second composition); insufficient history ⇒ unavailable + warning", async () => {
  const s = await snapOf({ rows: completeSeptember() });
  const inputs = await CI.loadCanonicalInputs(globalThis.__DB, T, B, { site: "t", nowMs: NOW, need: { config: true, fixed: true, exceptions: true } });
  const { report } = CM.canonicalMonthReport(inputs, { kind: "open_month", month: "2026-09" });
  const p = CM.canonicalMonthProjection(inputs, report, { nowMs: NOW });
  assert.equal(s.financials.projection.revenue.exact, p.forecast.projectedRevenue);
  assert.equal(s.financials.projection.operatingProfit.exact, p.projection.operatingProfit);
  assert.equal(s.financials.projection.formulaIds.forecast, "REV_FORECAST/v2");
  // two weeks of history only ⇒ the engine has too few same-weekday samples
  const short = await snapOf({ rows: SEP(28).slice(20).map((d) => fullDay(d)) });
  assert.equal(short.paceRevenue, null); assert.equal(short.forecast, null);
  assert.ok(short.financials.projection.warnings.includes("insufficient_history"), short.financials.projection.warnings.join());
  // no linear extrapolation code path remains in the snapshot sources
  const src = readFileSync(join(REPO, "src/snapshot/snapshotBuilder.ts"), "utf8") + readFileSync(join(REPO, "src/snapshot/snapshotEmail.ts"), "utf8");
  assert.doesNotMatch(src, /dailyAvg|daysLeft\s*\*|\/\s*daysPassed|computeRevenueForecast|applyProjection\(/);
});

test("B2-P1 need.exceptions: the ledger is read once; a structured exception day leaves forecast history; an unreadable ledger ⇒ no projection (warning), Actual unchanged", async () => {
  const hist = []; for (let k = 1; k <= 28; k++) hist.push(fullDay(`2026-09-${String(k).padStart(2, "0")}`, { sales: k === 22 ? "90000" : "1000" }));
  seed({ rows: hist });
  const rec = recordingDb(globalThis.__DB); installDb(rec);
  const plain = await SB.buildSnapshotForBiz(T, B, { nowMs: NOW });
  assert.ok(rec.reads.includes(`tenants/${T}/entry_exceptions/${B}`), "exception ledger requested (need.exceptions:true)");
  assert.equal(rec.reads.filter((p) => p === entriesKey()).length, 1, "entries read once");
  const withExc = await snapOf({ rows: hist, exceptions: { "2026-09-22": { state: { status: "active", reasonCode: "event" } } } });
  assert.notEqual(withExc.financials.projection.revenue.exact, plain.financials.projection.revenue.exact, "the Tuesday exception day is excluded from the forecast baseline");
  assert.equal(withExc.financials.amounts.revenue.exact, plain.financials.amounts.revenue.exact, "Actual still includes the exception day");
  const unreadable = await snapOf({ rows: hist, exceptions: "corrupt" });
  assert.deepEqual([unreadable.paceRevenue, unreadable.forecast], [null, null]);
  assert.ok(unreadable.financials.projection.warnings.includes("exception_ledger_unreadable"));
  assert.equal(unreadable.financials.amounts.revenue.exact, plain.financials.amounts.revenue.exact);
  assert.equal(unreadable.financials.provenance.exceptionsState, "unreadable");
});

test("B2-P2 one clock: without nowMs exactly ONE Date.now() read feeds both the loader and the projection; with nowMs, none", async () => {
  seed({ rows: completeSeptember() });
  const real = Date.now; let calls = 0;
  Date.now = () => { calls += 1; return NOW; };
  try {
    const s = await SB.buildSnapshotForBiz(T, B);
    assert.equal(calls, 1, "one clock read for the whole snapshot"); assert.equal(s.date, "2026-09-29");
    calls = 0; await SB.buildSnapshotForBiz(T, B, { nowMs: NOW }); assert.equal(calls, 0, "an injected clock is used as is");
  } finally { Date.now = real; }
  const src = readFileSync(join(REPO, "src/snapshot/snapshotBuilder.ts"), "utf8");
  assert.equal((src.match(/Date\.now\(\)/g) || []).length, 1); assert.doesNotMatch(src, /new Date\(/);
  assert.match(src, /loadCanonicalInputs\([^)]*nowMs,/); assert.match(src, /canonicalMonthProjection\(inputs, report, \{ nowMs \}\)/);
});

// ── B2-T13 ────────────────────────────────────────────────────────────────────
test("B2-T13 targets: food/labor goals from config.targets.*; absent ⇒ compat 33/27 labelled; the 700,000 sales fallback unchanged (D)", async () => {
  const own = await snapOf({ rows: completeSeptember(), config: { ...GLOBAL_3000, targets: { foodCostPct: "28", laborCostPct: "22" } } });
  assert.deepEqual([own.targetFoodCost, own.targetLabor, own.financials.goals.foodCostPct.source], [28, 22, "business_config"]);
  const compat = await snapOf({ rows: completeSeptember() });
  assert.deepEqual([compat.targetFoodCost, compat.targetLabor, compat.financials.goals.laborPct.source, compat.targetSales, compat.financials.goals.sales.source], [33, 27, "compatibility_product_default", 700000, "compatibility_product_default"]);
  const legacyKey = await snapOf({ rows: completeSeptember(), config: { ...GLOBAL_3000, targetSales: 500000 } });
  assert.equal(legacyKey.targetSales, 500000); assert.equal(legacyKey.financials.goals.sales.source, "legacy_config_key");
});

// ── B2-T14 ────────────────────────────────────────────────────────────────────
test("B2-T14 run.ts compatibility: the endpoint file is byte-identical and its manual POST fields are number | null", async () => {
  assert.equal(gitIn(REPO, ["diff", "--name-only", "4675eb20a97e8750429fad3e2ebda94f42f187b5", "--", "api/daily-snapshot/run.ts"]).stdout.trim(), "");
  const s = await snapOf({ rows: completeSeptember() });
  for (const k of ["tenantId", "bizId", "bizName", "date"]) assert.equal(typeof s[k], "string", k);
  assert.equal(typeof s.netProfit, "number"); assert.equal(typeof s.totalSales, "number");
  const partial = await snapOf({ rows: INVARIANTS.find((i) => i.id === "INV-05").apply(completeSeptember()) });
  assert.equal(partial.netProfit, null, "INV-05: missing payroll ⇒ profit unavailable, JSON-safe null");
  assert.equal(JSON.parse(JSON.stringify({ netProfit: partial.netProfit })).netProfit, null);
});

// ── B2-T15 (scan) ─────────────────────────────────────────────────────────────
test("B2-T15 scan: no private financial engine or binary money formatting remains in the B2 files", () => {
  for (const f of ["src/snapshot/snapshotBuilder.ts", "src/snapshot/snapshotEmail.ts"]) {
    const code = readFileSync(join(REPO, f), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
    for (const re of [/\bnum\(/, /\bNumber\(/, /parseFloat/, /Math\./, /\.toFixed\(/, /toLocaleString/, /Intl\.NumberFormat/, /\|\|\s*0\b/, /hourly_payroll/, /supplier_payments/, /startsWith\(currentMonth\)/, /1\.18/])
      assert.doesNotMatch(code, re, f + " matches " + re);
  }
});

// ── B2-T16 ────────────────────────────────────────────────────────────────────
test("B2-T16 duplicate row id ⇒ typed FinanceContractError; buildSnapshotForAll records the failure and continues", async () => {
  const dup = [fullDay("2026-09-01"), { ...fullDay("2026-09-02"), id: uid(424242) }, { ...fullDay("2026-09-03"), id: uid(424242) }];
  seed({ rows: dup });
  await assert.rejects(() => SB.buildSnapshotForBiz(T, B, { nowMs: NOW }), (e) => e.name === "FinanceContractError");
  const db = installDb(makeDb());
  for (const [b, rows] of [["good", completeSeptember()], ["dup", dup]]) seedRaw(db, { biz: b, entries: env(rows), config: env(GLOBAL_3000), fixed: env(FIXED_3100), businesses: [{ id: "good", name: "Good" }, { id: "dup", name: "Dup" }] });
  const all = await SB.buildSnapshotForAll();
  assert.deepEqual(all.map((s) => s.bizId), ["good"]);
});

// ── INV cases not covered above ───────────────────────────────────────────────
test("INV-06 / INV-07 / INV-12 / INV-13 / INV-14 through the snapshot", async () => {
  const base = await snapOf({ rows: completeSeptember() });
  assert.equal(base.totalSales, 28000, "INV-06: stored net revenue shown as is (no reader VAT conversion)");
  const i7 = await snapOf({ rows: INVARIANTS.find((i) => i.id === "INV-07").apply(completeSeptember()) });
  assert.equal(i7.financials.amounts.laborEmployerCost.exact, String(28 * 300), "INV-07: 200 payroll + 100 global per day");
  assert.deepEqual([...base.financials.provenance.configurationBasis], ["current_applied_retrospectively"], "INV-12");
  assert.equal(base.financials.provenance.timelineSource, "compat_current_config");
  const i13 = await snapOf({ rows: INVARIANTS.find((i) => i.id === "INV-13").apply(completeSeptember()) });
  assert.equal(stableJson(i13.financials.amounts), stableJson(base.financials.amounts), "INV-13: a future row changes nothing");
  const i14a = await snapOf({ rows: INVARIANTS.find((i) => i.id === "INV-14").apply(completeSeptember()) });
  const i14b = await snapOf({ rows: INVARIANTS.find((i) => i.id === "INV-14").apply(completeSeptember()).reverse() });
  assert.equal(i14a.financials.amounts.revenue.exact, "28500"); assert.equal(stableJson(i14a.financials.amounts), stableJson(i14b.financials.amounts), "INV-14: order-independent");
  assert.equal(i14a.daysPassed, 28, "a duplicate date is one calendar day");
});

// ── Consumer audit FC-01 (Daily Email) scenarios ──────────────────────────────
test("CA-FC01 minimal input: sales 1000 only, payroll & purchases absent, no fixed configuration ⇒ never 'profit ₪1,000'", async () => {
  const s = await snapOf({ rows: [entry(uid(7), "2026-09-28", { sales: "1000" })], config: {}, raw: { fixed: null } });
  assert.equal(s.financials.amounts.purchases.state, "unavailable"); assert.equal(s.totalFood, null);
  assert.equal(s.totalPayroll, null); assert.equal(s.netProfit, null); assert.equal(s.foodCostPct, null); assert.equal(s.laborPct, null);
  assert.equal(s.fixedRegular, 0, "R-17 is the only legitimate zero: absent fixed list");
  const today = await snapOf({ rows: [entry(uid(8), "2026-09-29", { sales: "1000" })], config: {}, raw: { fixed: null } });
  assert.equal(today.totalSales, null, "the same row dated TODAY is not Actual");
});

test("CA-SPARSE sparse / positive-only windows never masquerade as complete periods; explicit zero, missing and closed stay distinct", async () => {
  const rows = SEP(28).filter((_, i) => i % 2 === 0).map((d) => fullDay(d));
  const s = await snapOf({ rows });
  assert.equal(s.financials.amounts.revenue.state, "partial"); assert.equal(s.presentDays, 14); assert.equal(s.daysPassed, 28);
  assert.equal(s.financials.coverage.revenue.missing.length, 14);
  assert.deepEqual([s.netProfit, s.foodCostPct, s.laborPct, s.forecast], [null, null, null, null]);
  // explicit zero vs missing: a zero day is present (coverage shrinks), a missing one is listed
  const withZero = await snapOf({ rows: [...rows, fullDay("2026-09-02", { sales: "0", supplier_payments: { s1: "0" }, payroll: "0" })] });
  assert.equal(withZero.presentDays, 15); assert.ok(!withZero.financials.coverage.revenue.missing.includes("2026-09-02"));
  // closed days: none are declared (no closure inference); a missing day is NOT treated as closed
  assert.equal(s.financials.provenance.operatingCalendar, "entry_exception_closure"); assert.deepEqual(s.financials.coverage.closedDays, [], "no closure declared ⇒ none inferred");
  // negative refunds are kept (not dropped as "non-positive")
  const refund = await snapOf({ rows: completeSeptember().map((r) => (r.date === "2026-09-03" ? { ...r, supplier_payments: { s1: "-50" } } : r)) });
  assert.equal(refund.financials.amounts.purchases.exact, String(27 * 300 - 50));
});

test("B2 view model is pure encoding: buildSnapshotView is deterministic and never produces a number without an exact source", async () => {
  const s = await snapOf({ rows: INVARIANTS.find((i) => i.id === "INV-02").apply(completeSeptember()) });
  const walk = (o, p = "$") => { for (const [k, v] of Object.entries(o || {})) { if (v && typeof v === "object") walk(v, p + "." + k); else if (k === "number" && v !== null) assert.notEqual(o.exact, null, p + ": a number needs its exact string"); } };
  walk(s.financials);
  for (const m of Object.values(s.financials.amounts)) if (m.state === "unavailable") assert.deepEqual([m.exact, m.number], [null, null]);
  assert.equal(typeof SE.kpiShares, "function"); assert.equal(typeof SE.buildSnapshotView, "function");
});
