// dailyMetricsRepo / laborRepo / purchasesRepo + fetchPlannedData routing (D3).
// Financial Core B1: the repositories serve the canonical server API (one engine); every changed
// expectation is annotated with its VD. The clock is injected (asOfBusinessDate 2026-09-29).
import { test } from "node:test";
import assert from "node:assert/strict";
import { compileServer, makeDb, installDb, seedBusiness, offlineFetch, T, B } from "../support/server-reader-harness.mjs";
import { FIXTURES, asLegacy, asV2, noFallbackNode, malformedNodes, plain, uuid, row } from "../support/entries-fixtures.mjs";

offlineFetch();
const NOW = Date.UTC(2026, 8, 29, 9); const REAL_NOW = Date.now; Date.now = () => NOW;
process.on("exit", () => { Date.now = REAL_NOW; });
const srv = compileServer();
const DM = await srv.import("src/repositories/analytics/dailyMetricsRepo.js");
const LR = await srv.import("src/repositories/analytics/laborRepo.js");
const PR = await srv.import("src/repositories/analytics/purchasesRepo.js");
const AS = await srv.import("src/services/analyticsService.js");
const R = await import("../../lib/analytics/entriesReader.js");
const SUPPLIERS = { _v: JSON.stringify([{ id: "s1", name: "ספק אחד" }, { id: 7, name: "seven" }]) };
async function withNode(node) { const db = installDb(makeDb()); seedBusiness(db, { entries: node }); db.seed(`tenants/${T}/biz:${B}:suppliers`, SUPPLIERS); return db; }
const all = async (from = "2000-01-01", to = "2099-12-31") => ({
  daily: plain(await DM.getDailyMetrics(T, from, to, B)), latest: await DM.getLatestDailyDate(T, B),
  labor: plain(await LR.getLaborMetrics(T, from, to, B)), purchases: plain(await PR.getPurchaseMetrics(T, from, to, B)),
});
const sortKeyed = (o) => ({ ...o, daily: o.daily.slice().sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))), labor: o.labor.slice().sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))), purchases: o.purchases.slice().sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))) });

test("equivalence: every fixture yields the same metrics from `_v` and from rows (order-insensitive for ties)", async () => {
  for (const [name, rows] of Object.entries(FIXTURES)) {
    await withNode(asLegacy(rows)); const a = await all();
    await withNode(asV2(rows, { keepV: true })); const b = await all();
    assert.deepEqual(sortKeyed(b), sortKeyed(a), name);
    assert.deepEqual(a.daily.map((x) => x.date), a.daily.map((x) => x.date).slice().sort(), name + ": sorted by date");
  }
  await withNode(asLegacy(FIXTURES.F4_variety)); const v = await all();
  // B1: the repositories use the ONE canonical engine (no private `Number(v) || 0` coercion).
  // VD-10: "1,234" is a strictly grouped amount; VD-16 (revised): the recorded supplier map wins
  // over legacy food_cost 90; VD-31: labor = `payroll` ("0") + global (none) — hourly_payroll not counted.
  assert.equal(v.daily[0].revenue, 1250, "1000 + '250' + '' "); assert.equal(v.daily[0].foodCost, 1234); assert.equal(v.daily[0].laborCost, 0); assert.equal(v.daily[1].foodCost, 300);
  // VD-08: a zero-revenue day has ratios null, never 0
  assert.equal(v.daily[1].laborPct, null); assert.equal(v.daily[1].foodCostPct, null);
  // DD-15 / VD-16/17: one purchase record per (date, source); "skip"/0 are present zeros; legacy source named
  assert.deepEqual(v.purchases.map((p) => [p.date, p.source, p.supplierName, p.amount]), [
    ["2026-08-01", "supplier", "ספק אחד", 1234], ["2026-08-01", "supplier", "ספק s2", 0], ["2026-08-01", "supplier", "ספק s4", 0],
    ["2026-08-02", "legacy_food_cost", "legacy_food_cost", 300], ["2026-08-03", "supplier", "ספק אחד", 40]], "supplier names resolved from the (legacy) suppliers list");
  assert.equal(v.latest, "2026-08-03");
  assert.equal(v.labor[0].employeeCount, null, "B1: no hourly-key head count (hourly_payroll is not a labor source)"); assert.equal(v.labor[0].totalCost, 0);
  await withNode(asLegacy([])); assert.equal((await all()).latest, null); await withNode(null); assert.deepEqual((await all()).daily, []);
});
test("date window is inclusive; duplicate dates → ONE daily metric with every row counted (R1 / D1); labor & purchases keep every row", async () => {
  await withNode(asV2(FIXTURES.F3_dup));
  const daily = plain(await DM.getDailyMetrics(T, "2026-08-10", "2026-08-10", B));
  const legacyShape = ({ date, revenue, laborCost, laborPct, foodCost, foodCostPct, transactionCount, avgTicket }) => ({ date, revenue, laborCost, laborPct, foodCost, foodCostPct, transactionCount, avgTicket });
  // B1 VD-31: hourly_payroll (1 + 5) is not counted — labor = payroll "0" + global (none)
  assert.deepEqual(daily.map(legacyShape), [{ date: "2026-08-10", revenue: 600, laborCost: 0, laborPct: 0, foodCost: 60, foodCostPct: 10, transactionCount: 0, avgTicket: 0 }], "100+500 sales, 10+50 supplier payments — no winner");
  assert.equal(daily.length, 1); assert.equal(daily[0].presence.day, "present");
  // DD-15: ONE purchase record per (date, source) — every contribution of the date is summed
  const purchases = plain(await PR.getPurchaseMetrics(T, "2026-08-10", "2026-08-10", B)); assert.deepEqual(purchases.map((p) => [p.supplierId, p.amount]), [["s1", 60]]);
  // B1: one labor record per canonical day (duplicate dates ⇒ one)
  const labor = plain(await LR.getLaborMetrics(T, "2026-08-10", "2026-08-10", B)); assert.deepEqual(labor.map((l) => l.totalCost), [0]);
  await withNode(asLegacy(FIXTURES.F3_dup));
  assert.deepEqual(plain(await DM.getDailyMetrics(T, "2026-08-10", "2026-08-10", B)), daily, "identical under legacy");
  await withNode(asLegacy(FIXTURES.F3_dup.slice().reverse()));
  assert.deepEqual(plain(await DM.getDailyMetrics(T, "2026-08-10", "2026-08-10", B)), daily, "identical with the legacy array reversed");
  assert.equal(await DM.getLatestDailyDate(T, B), "2026-08-11");
});
test("NO-FALLBACK poison: metrics come from rows; the stale `_v` never contributes", async () => {
  const { node } = noFallbackNode(); await withNode(node);
  const r = await all();
  assert.deepEqual(r.daily.map((x) => [x.date, x.revenue]), [["2026-08-10", 555], ["2026-08-11", 700]]); assert.equal(r.latest, "2026-08-11");
});
test("MALFORMED V2: each repository throws the typed storage error — never an empty dataset", async () => {
  for (const [name, node] of Object.entries(malformedNodes())) {
    await withNode(node);
    for (const fn of [() => DM.getDailyMetrics(T, "2000-01-01", "2099-12-31", B), () => DM.getLatestDailyDate(T, B), () => LR.getLaborMetrics(T, "2000-01-01", "2099-12-31", B), () => PR.getPurchaseMetrics(T, "2000-01-01", "2099-12-31", B)])
      await assert.rejects(fn, (e) => R.isEntriesStorageError(e) && e.bizId === B && typeof e.site === "string", name);
  }
});
test("D3 routing: fetchPlannedData RE-THROWS typed storage errors (no soft 'failed' with partial data) and still soft-fails other errors", async () => {
  const plan = { intent: "x", metrics: ["daily", "labor", "purchases"], dimensions: [], filters: {}, timeRange: { start: "2026-08-01", end: "2026-08-31" }, requiresBaseline: false, requiresComparison: false, requiresAnomalyDetection: false };
  const ctx = { tenantId: T, bizId: B, timezone: "Asia/Jerusalem", locale: "he", nowIso: new Date().toISOString(), userQuestion: "q" };
  await withNode(malformedNodes().rows_scalar);
  await assert.rejects(() => AS.fetchPlannedData(plan, ctx), (e) => R.isEntriesStorageError(e));
  await withNode(asV2(FIXTURES.F2_multi));
  const ok = await AS.fetchPlannedData(plan, ctx);
  assert.equal(ok.fetchStatus.daily, "ok"); assert.equal(ok.metrics.daily.length, 2, "two August rows"); assert.equal(ok.fetchStatus.labor, "ok");
  // a non-storage failure keeps the historical soft-fail
  const db = installDb(makeDb()); seedBusiness(db, { entries: asV2(FIXTURES.F2_multi) }); db.seed(`tenants/${T}/biz:${B}:suppliers`, SUPPLIERS);
  const origRef = db.ref; db.ref = (p) => (p.endsWith(":suppliers") ? { once: async () => { throw new Error("network"); } } : origRef(p));
  const soft = await AS.fetchPlannedData(plan, ctx); assert.equal(soft.fetchStatus.purchases, "failed"); assert.equal(soft.fetchStatus.daily, "ok");
});
