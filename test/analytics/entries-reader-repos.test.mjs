// dailyMetricsRepo / laborRepo / purchasesRepo + fetchPlannedData routing (D3).
import { test } from "node:test";
import assert from "node:assert/strict";
import { compileServer, makeDb, installDb, seedBusiness, offlineFetch, T, B } from "../support/server-reader-harness.mjs";
import { FIXTURES, asLegacy, asV2, noFallbackNode, malformedNodes, plain, uuid, row } from "../support/entries-fixtures.mjs";

offlineFetch();
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
  // the repositories' own numeric coercion (`Number(v) || 0`) is UNCHANGED: "1,234" is not a
  // number to them (unlike dailyBuilder's parser), so the supplier sum is 0 and food_cost applies
  assert.equal(v.daily[0].revenue, 1250, "1000 + '250' + '' "); assert.equal(v.daily[0].foodCost, 90); assert.equal(v.daily[0].laborCost, 400); assert.equal(v.daily[1].foodCost, 300);
  assert.deepEqual(v.purchases.map((p) => [p.date, p.supplierName, p.amount]), [["2026-08-03", "ספק אחד", 40]], "supplier names resolved from the (legacy) suppliers list; '1,234'/skip/empty/0 ignored as before");
  assert.equal(v.latest, "2026-08-03"); assert.equal(v.labor[0].employeeCount, 2, "e1 + e2 hourly keys (e2 = 0 still a key) … plus manual payroll 0 → not counted");
  await withNode(asLegacy([])); assert.equal((await all()).latest, null); await withNode(null); assert.deepEqual((await all()).daily, []);
});
test("date window is inclusive and every row inside it is kept (duplicate dates → two records)", async () => {
  await withNode(asV2(FIXTURES.F3_dup));
  const daily = plain(await DM.getDailyMetrics(T, "2026-08-10", "2026-08-10", B));
  assert.equal(daily.length, 2); assert.deepEqual(daily.map((x) => x.revenue).sort(), [100, 500]);
  const purchases = plain(await PR.getPurchaseMetrics(T, "2026-08-10", "2026-08-10", B)); assert.deepEqual(purchases.map((p) => p.amount).sort(), [10, 50]);
  const labor = plain(await LR.getLaborMetrics(T, "2026-08-10", "2026-08-10", B)); assert.deepEqual(labor.map((l) => l.totalCost).sort(), [1, 5]);
  await withNode(asLegacy(FIXTURES.F3_dup));
  assert.equal((await DM.getDailyMetrics(T, "2026-08-10", "2026-08-10", B)).length, 2, "same under legacy");
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
