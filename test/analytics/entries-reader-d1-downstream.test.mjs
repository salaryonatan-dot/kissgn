// SERVER READERS R1 — CTO D1 DOWNSTREAM (Codex SR-F1): duplicate business dates must have
// ZERO order / UUID effect on the per-day analytical series and on every consumer of it.
//
// dailyMetricsRepo is the per-business-date daily series for the whole agent (analyses,
// baseline, proactive detectors, forecast). R1 makes it return exactly ONE DailyMetric per
// business date with every row contributing to the additive totals. This suite proves the
// FINAL results — detector output and the actual proactive flow's persisted insight /
// digest — are identical across legacy [A,B], legacy [B,A], V2 map keyed A→B and V2 map
// keyed B→A, including the case where the UUID lexical order is reversed relative to the
// sales order; and (negative control) that the PRE-FIX repository let the detector's
// verdict depend on nothing but that order.
//
// Financial Core B1: the series is the canonical server series. The CURRENT business day is
// outside every Actual output (D-1, VD-30), so the duplicate "most recent day" is YESTERDAY
// (the last completed day); labor = `payroll` (+ global) and `hourly_payroll` is never
// counted (VD-31); ratios are ratios of exact totals (VD-19, 10 dp legacy conversion).
import { test } from "node:test";
import { withIsraelScenario } from "../support/israel-scenario-clock.mjs";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { compileServer, makeDb, installDb, seedBusiness, offlineFetch, ROOT, T, B } from "../support/server-reader-harness.mjs";
import { plain } from "../support/entries-fixtures.mjs";
import { gitIn } from "../support/git-context.mjs";

offlineFetch();
const srv = compileServer();
const DM = await srv.import("src/repositories/analytics/dailyMetricsRepo.js");
const AS = await srv.import("src/services/analyticsService.js");
const DET = await srv.import("src/agent/proactive/detectors/detectDailyRevenueUnderperformance.js");
const PJ = await srv.import("src/agent/proactive/runProactiveJob.js");

// ── fixtures ─────────────────────────────────────────────────────────────────
const today = new Date().toISOString().slice(0, 10);
const dayBefore = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
const ID_LO = "11111111-1111-4111-8111-000000000001";   // lexically FIRST
const ID_HI = "11111111-1111-4111-8111-000000000002";   // lexically LAST
const past = (n) => Array.from({ length: n }, (_, i) => ({ id: `22222222-2222-4222-8222-${String(i + 1).padStart(12, "0")}`, date: dayBefore(i + 2), sales: 1000, deliveries: 0, other_income: 0, payroll: 100, supplier_payments: { s1: 300 } }));
const dup = (date, aSales, bSales, { reverseUuid = false, extra = {} } = {}) => {
  const A = { id: reverseUuid ? ID_HI : ID_LO, date, sales: aSales, deliveries: 0, other_income: 0, payroll: 20, supplier_payments: { s1: 30 }, hourly_payroll: { e1: 5 }, ...extra };
  const Bv = { id: reverseUuid ? ID_LO : ID_HI, date, sales: bSales, deliveries: 0, other_income: 0, payroll: 40, supplier_payments: { s1: 70 }, hourly_payroll: { e1: 15 }, ...extra };
  return { A, B: Bv };
};
const legacyNode = (rows) => ({ _v: JSON.stringify(rows) });
const v2Node = (rows) => { const map = {}; for (const r of rows) map[r.id] = { ...r, _gen: 1 }; return { schemaVersion: 2, generation: 1, rows: map }; };
/** Every logically identical physical representation of `history + {A,B}`. */
const representations = (history, A, Bv) => ({
  "legacy [A,B]": legacyNode([...history, A, Bv]),
  "legacy [B,A]": legacyNode([...history, Bv, A]),
  "legacy [B,history,A]": legacyNode([Bv, ...history, A]),
  "v2 keys A→B": v2Node([...history, A, Bv]),
  "v2 keys B→A": v2Node([Bv, A, ...history]),
});
const baseline = { valid: true, baselineType: "rolling", sampleSize: 15, values: Array.from({ length: 15 }, (_, i) => [900, 1000, 1100][i % 3]) };
const plan = { intent: "anomaly_detection", metrics: ["daily", "labor", "purchases"], dimensions: [], filters: {}, timeRange: { start: dayBefore(28), end: today }, requiresBaseline: true, requiresComparison: false, requiresAnomalyDetection: true };
// B1: the most recent COMPLETED business day (the current day is never Actual)
const lastDay = dayBefore(1);
const ctx = { tenantId: T, bizId: B, timezone: "Asia/Jerusalem", locale: "he", nowIso: new Date().toISOString(), userQuestion: "proactive" };
const SUPPLIERS = { _v: JSON.stringify([{ id: "s1", name: "S1" }]) };
async function seed(node) { const db = installDb(makeDb()); seedBusiness(db, { entries: node }); db.seed(`tenants/${T}/biz:${B}:suppliers`, SUPPLIERS); return db; }
const stripTime = (v) => JSON.parse(JSON.stringify(v, (k, x) => (/At$|^generatedAt$|^jobId$/.test(k) ? undefined : x)));

test("dailyMetricsRepo: exactly one record per business date; duplicates aggregate additively; ratios from totals; order-independent", async () => {
  const { A, B: Bv } = dup("2026-08-10", 100, 500);
  const single = { id: "33333333-3333-4333-8333-000000000001", date: "2026-08-11", sales: 700, deliveries: 0, other_income: 0, payroll: 0 };
  const expected = [
    // B1 VD-31: labor = payroll 20 + 40 (hourly_payroll 5 + 15 not counted); VD-19: exact ratio, 10 dp
    { date: "2026-08-10", revenue: 600, laborCost: 60, laborPct: 10, foodCost: 100, foodCostPct: 16.6666666667, transactionCount: 0, avgTicket: 0 },
    // no purchase fact on 08-11: foodCostPct null (VD-08), never 0
    { date: "2026-08-11", revenue: 700, laborCost: 0, laborPct: 0, foodCost: 0, foodCostPct: null, transactionCount: 0, avgTicket: 0 },
  ];
  const legacyShape = (xs) => xs.map(({ date, revenue, laborCost, laborPct, foodCost, foodCostPct, transactionCount, avgTicket }) => ({ date, revenue, laborCost, laborPct, foodCost, foodCostPct, transactionCount, avgTicket }));
  for (const [name, node] of Object.entries(representations([single], A, Bv))) {
    await seed(node);
    const daily = plain(await DM.getDailyMetrics(T, "2026-08-01", "2026-08-31", B));
    assert.deepEqual(legacyShape(daily), expected, name);
    assert.equal(await DM.getLatestDailyDate(T, B), "2026-08-11", name);
  }
  // reversed UUID lexical order (the 100-sales row now carries the LAST uuid) → identical
  const rev = dup("2026-08-10", 100, 500, { reverseUuid: true });
  for (const [name, node] of Object.entries(representations([single], rev.A, rev.B))) {
    await seed(node);
    assert.deepEqual(legacyShape(plain(await DM.getDailyMetrics(T, "2026-08-01", "2026-08-31", B))), expected, "reversed uuid: " + name);
  }
  // unique dates are untouched by aggregation: one row → one record with the per-row formulas
  await seed(legacyNode([single, { ...single, id: "33333333-3333-4333-8333-000000000002", date: "2026-08-12", sales: "80", supplier_payments: { s1: "40" }, food_cost: "999" }]));
  const d = plain(await DM.getDailyMetrics(T, "2026-08-01", "2026-08-31", B));
  assert.deepEqual(d.map((x) => [x.date, x.revenue, x.foodCost]), [["2026-08-11", 700, 0], ["2026-08-12", 80, 40]]);
  // three rows on one date, interleaved with other dates, any order
  const trip = [dup("2026-08-20", 1, 2).A, { ...single, id: "33333333-3333-4333-8333-000000000003", date: "2026-08-19" }, dup("2026-08-20", 1, 2).B, { ...single, id: "33333333-3333-4333-8333-000000000004", date: "2026-08-20", sales: 4 }];
  await seed(legacyNode(trip)); const t1 = plain(await DM.getDailyMetrics(T, "2026-08-01", "2026-08-31", B));
  await seed(v2Node(trip.slice().reverse())); const t2 = plain(await DM.getDailyMetrics(T, "2026-08-01", "2026-08-31", B));
  assert.deepEqual(t1, t2); assert.deepEqual(t1.map((x) => [x.date, x.revenue]), [["2026-08-19", 700], ["2026-08-20", 7]]);
});

test("detector: identical FINAL result for every representation (A=100, B=500 on the most recent day)", async () => {
  return withIsraelScenario(async ({ today, dayBefore, nowIso }) => {
  const past = n => Array.from({ length: n }, (_, i) => ({ id: `22222222-2222-4222-8222-${String(i + 1).padStart(12, "0")}`, date: dayBefore(i + 2), sales: 1000, deliveries: 0, other_income: 0, payroll: 100, supplier_payments: { s1: 300 } }));
  const lastDay = dayBefore(1);
  const plan = { intent: "anomaly_detection", metrics: ["daily", "labor", "purchases"], dimensions: [], filters: {}, timeRange: { start: dayBefore(28), end: today }, requiresBaseline: true, requiresComparison: false, requiresAnomalyDetection: true };
  const ctx = { tenantId: T, bizId: B, timezone: "Asia/Jerusalem", locale: "he", nowIso, userQuestion: "proactive" };
  const history = past(15);
  const { A, B: Bv } = dup(lastDay, 100, 500);
  const results = {};
  for (const [name, node] of Object.entries({ ...representations(history, A, Bv), ...Object.fromEntries(Object.entries(representations(history, ...Object.values(dup(lastDay, 100, 500, { reverseUuid: true })))).map(([k, v]) => ["reversed-uuid " + k, v])) })) {
    await seed(node);
    const fetched = await AS.fetchPlannedData(plan, ctx);
    results[name] = plain(DET.detectDailyRevenueUnderperformance(fetched, baseline));
  }
  const names = Object.keys(results); assert.equal(names.length, 10);
  for (const n of names) assert.deepEqual(results[n], results[names[0]], `${n} vs ${names[0]}`);
  // and the one result is the AGGREGATE day: 600 vs baseline 1000
  const r = results[names[0]];
  assert.ok(r && r.type === "revenue_underperformance", "the aggregated day underperforms the baseline");
  assert.equal(r.currentValue, 600, "currentValue is the sum of both rows — never 100 or 500");
  assert.equal(r.periodEnd, lastDay);
  });
});

test("detector: the Codex reproduction (1 vs 1000 on the same day) — no representation can flip the verdict", async () => {
  const history = past(15);
  const out = new Set();
  for (const rev of [false, true]) {
    const { A, B: Bv } = dup(lastDay, 1, 1000, { reverseUuid: rev });
    for (const [, node] of Object.entries(representations(history, A, Bv))) {
      await seed(node);
      const fetched = await AS.fetchPlannedData(plan, ctx);
      out.add(JSON.stringify(plain(DET.detectDailyRevenueUnderperformance(fetched, baseline))));
    }
  }
  assert.equal(out.size, 1, "one verdict across all 10 representations");
  const r = JSON.parse([...out][0]);
  assert.equal(r, null, "1 + 1000 = 1001 ≈ baseline → no anomaly, in every representation");
});

test("actual proactive flow (runForBiz): identical persisted insight and digest across legacy/V2 and both orders", async () => {
  return withIsraelScenario(async ({ dayBefore }) => {
  const past = n => Array.from({ length: n }, (_, i) => ({ id: `22222222-2222-4222-8222-${String(i + 1).padStart(12, "0")}`, date: dayBefore(i + 2), sales: 1000, deliveries: 0, other_income: 0, payroll: 100, supplier_payments: { s1: 300 } }));
  const history = past(20);
  const { A, B: Bv } = dup(dayBefore(1), 100, 500);   // "yesterday" is the duplicate day (its only rows)
  const snapshots = {};
  for (const [name, node] of Object.entries(representations(history, A, Bv))) {
    const db = await seed(node);
    const result = await PJ.runForBiz(T, B);
    assert.deepEqual(result.errors, [], name);
    const insights = db.read(`tenants/${T}/proactive_insights/${B}`) || {};
    const digests = db.read(`tenants/${T}/proactive_digests/${B}`) || {};
    snapshots[name] = stripTime({ result, insights, digests });
  }
  const names = Object.keys(snapshots);
  for (const n of names) assert.deepEqual(snapshots[n], snapshots[names[0]], `${n} vs ${names[0]}`);
  const ins = Object.values(snapshots[names[0]].insights);
  const ru = ins.find((i) => i.type === "revenue_underperformance");
  assert.ok(ru, "the aggregated 600 day is detected once");
  assert.equal(ru.currentValue, 600);
  });
});

test("NEGATIVE CONTROL — the PRE-FIX repository emits order-dependent duplicate dates; the current detector refuses them", async () => {
  const show = gitIn(ROOT, ["show", "f00568d26b1fc4c755efa4030733420c116ade40:src/repositories/analytics/dailyMetricsRepo.ts"]);
  assert.equal(show.status, 0, show.stderr);
  const ts = (await import(pathToFileURL(join(ROOT, "node_modules", "typescript", "lib", "typescript.js")).href)).default;
  const js = ts.transpileModule(show.stdout, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
  const prePath = join(srv.dir, "src", "repositories", "analytics", "dailyMetricsRepo.__prefix__.js");
  writeFileSync(prePath, js);
  const PRE = await import(pathToFileURL(prePath).href);
  const history = past(15);
  const { A, B: Bv } = dup(lastDay, 1, 1000);
  const series = {};
  for (const [name, node] of Object.entries({ "legacy [A,B]": legacyNode([...history, A, Bv]), "legacy [B,A]": legacyNode([...history, Bv, A]), "v2 (reader sorts (date,id): A first)": v2Node([Bv, A, ...history]) })) {
    await seed(node);
    const daily = plain(await PRE.getDailyMetrics(T, dayBefore(28), today, B));
    assert.equal(daily.filter((d) => d.date === lastDay).length, 2, name + ": pre-fix emitted two records for one day");
    series[name] = daily.filter((d) => d.date === lastDay).map((d) => d.revenue);
    assert.equal(DET.detectDailyRevenueUnderperformance({ metrics: { daily } }, baseline), null,
      "unproven and duplicate daily records cannot yield a current finding");
  }
  assert.deepEqual(series["legacy [A,B]"], [1, 1000]);
  assert.deepEqual(series["legacy [B,A]"], [1000, 1]);
  assert.deepEqual(series["v2 (reader sorts (date,id): A first)"], [1, 1000]);
  // the R1 repository on the same nodes: one record, one verdict
  await seed(legacyNode([...history, Bv, A]));
  const fixed = plain(await DM.getDailyMetrics(T, dayBefore(28), today, B));
  assert.equal(fixed.filter((d) => d.date === lastDay).length, 1);
  assert.equal(plain(DET.detectDailyRevenueUnderperformance({ metrics: { daily: fixed } }, baseline)), null);
});
