// Financial Core B1 — analytics repositories served by the canonical server API: REPO-01…10.
// Real compiled repositories through the server-reader harness (in-memory RTDB). The clock is
// injected through the harness (Date.now spy ⇒ asOfBusinessDate 2026-09-29).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { compileServer, makeDb, installDb, offlineFetch, ROOT } from "../support/server-reader-harness.mjs";
import { AS_OF, NOW_MS, T, B, asLegacy, asV2, configWithGlobal, entry, env, nowMsFor, seedRaw, uid } from "../support/b1-fixtures.mjs";

offlineFetch();
const REAL_NOW = Date.now; let clockReads = 0; let clock = NOW_MS;
Date.now = () => { clockReads++; return clock; };
process.on("exit", () => { Date.now = REAL_NOW; });
const srv = compileServer();
const DM = await srv.import("src/repositories/analytics/dailyMetricsRepo.js");
const LR = await srv.import("src/repositories/analytics/laborRepo.js");
const PR = await srv.import("src/repositories/analytics/purchasesRepo.js");
const AS = await srv.import("src/services/analyticsService.js");
const R = await import("../../lib/analytics/entriesReader.js");
const SUPPLIERS = env([{ id: "s1", name: "Alpha" }, { id: "s2", name: "Beta" }]);
const ALL = ["2000-01-01", "2099-12-31"];

/** Doc 03 table B states as stored rows (every row has an id so both storage forms apply). */
function doc03Rows() {
  let n = 0; const e = (date, f) => entry(uid(++n), date, f);
  return [
    e("2026-09-01", { sales: "100", supplier_payments: { s1: "40" } }),                 // 1 supplier only
    e("2026-09-02", { sales: "100", food_cost: "30" }),                                  // 2 legacy food only
    e("2026-09-03", { sales: "100", supplier_payments: { s1: "0" }, food_cost: "70" }),  // 3 collision (explicit 0 wins)
    e("2026-09-04", { supplier_payments: { s1: "0" } }),                                 // 4 explicit supplier zero (zero-only day)
    e("2026-09-05", { sales: "50", supplier_payments: { s1: "skip" } }),                 // 5 skip
    e("2026-09-06", { sales: "50", supplier_payments: { s1: "abc", s2: "10" } }),        // 6 invalid cell (partial)
    e("2026-09-07", { food_cost: "0" }),                                                 // 7 legacy food zero
    e("2026-09-08", { sales: "20", food_cost: "zz" }),                                   // 8 legacy food invalid
    e("2026-09-09", { payroll: "80" }),                                                  // 13 payroll only
    e("2026-09-10", { hourly_payroll: { w1: "50" } }),                                   // 14 hourly_payroll only ⇒ missing
    e("2026-09-11", { sales: "300", payroll: "60", hourly_payroll: { w1: "40" } }),      // 15 payroll + hourly
    e("2026-09-12", { notes: "only notes" }),                                            // 16 notes only
    e("2026-09-13", {}),                                                                 // 17 empty
    e("2026-09-14", { sales: "10" }), e("2026-09-14", { sales: "15", supplier_payments: { s2: "5" } }), // 20 duplicate date
    e("2026-09-15", { sales: "100", supplier_payments: { s1: "-25" } }),                // 23 negative (refund)
    e("2026-09-16", { sales: "100", includeVat: true }),                                 // 24 includeVat flag only
    e("2026-13-01", { sales: "1" }),                                                     // 19 invalid date
    e(AS_OF, { sales: "999" }),                                                          // 22 current day
    e("2026-10-02", { sales: "999" }),                                                   // 21 future
  ];
}
async function seed(entries, opts = {}) { clockReads = 0; return installDb(seedRaw(makeDb(), { entries, suppliers: SUPPLIERS, ...opts })); }
const plain = (v) => JSON.parse(JSON.stringify(v));
const everything = async () => ({ d: plain(await DM.getDailyMetrics(T, ...ALL, B)), l: plain(await LR.getLaborMetrics(T, ...ALL, B)), p: plain(await PR.getPurchaseMetrics(T, ...ALL, B)), latest: await DM.getLatestDailyDate(T, B) });

test("REPO-01 legacy `_v` ≡ Storage V2 for every doc-03 state (daily, labor, purchases, latest date)", async () => {
  const rows = doc03Rows();
  for (const cfg of [env({}), env(configWithGlobal("3000")), null]) {
    await seed(asLegacy(rows), { config: cfg }); const a = await everything();
    await seed(asV2(rows), { config: cfg }); const b = await everything();
    await seed(asV2(rows.slice().reverse(), { keepV: true }), { config: cfg }); const c = await everything();
    assert.deepEqual(b, a); assert.deepEqual(c, a);
    assert.ok(a.d.length > 0 && a.p.length > 0);
  }
  // RTDB numeric-key readback (client contract R2-B3): a V2 map whose keys are dense integers
  // comes back as an ARRAY; for the two map fields it is the same value as {index: element}
  const keyed = [entry(uid(1), "2026-09-01", { sales: "100", supplier_payments: { 0: "10", 1: "20" }, payroll: "5", hourly_payroll: { 0: "7" } }), entry(uid(2), "2026-09-02", { sales: "50", supplier_payments: { 1: "4" } })];
  const readback = keyed.map((r) => ({ ...r, supplier_payments: Object.keys(r.supplier_payments).reduce((a, k) => { a[Number(k)] = r.supplier_payments[k]; return a; }, []), ...(r.hourly_payroll ? { hourly_payroll: ["7"] } : {}) }));
  assert.ok(Array.isArray(readback[1].supplier_payments) && readback[1].supplier_payments[0] === undefined, "sparse array with a hole");
  await seed(asLegacy(keyed)); const k1 = await everything();
  await seed({ schemaVersion: 2, generation: 1, rows: Object.fromEntries(readback.map((r) => [r.id, { ...r, supplier_payments: r.supplier_payments.map((x) => (x === undefined ? null : x)), _gen: 1 }])) }); const k2 = await everything();
  assert.deepEqual(k2, k1, "array readback ≡ keyed map (no invalid_map_shape)");
  assert.equal(k1.d[0].foodCost, 30); assert.equal(k1.d[1].foodCost, 4); assert.equal(k1.d[0].partial.purchases, false);
});

test("REPO-02 CanonicalDailyMetric carries every DailyMetric field (src/agent/types/analytics.ts) plus presence, partial, fin", async () => {
  const types = readFileSync(join(ROOT, "src/agent/types/analytics.ts"), "utf8");
  const block = types.slice(types.indexOf("interface DailyMetric"), types.indexOf("}", types.indexOf("interface DailyMetric")));
  const fields = [...block.matchAll(/^\s*(\w+)(\?)?:/gm)].filter((m) => !m[2]).map((m) => m[1]);
  assert.ok(fields.length >= 8);
  await seed(asLegacy(doc03Rows()));
  for (const d of await DM.getDailyMetrics(T, ...ALL, B)) {
    for (const k of fields) assert.ok(k in d, "DailyMetric." + k);
    for (const k of ["presence", "partial", "fin"]) assert.ok(k in d, k);
    for (const k of ["revenue", "laborCost", "foodCost", "transactionCount", "avgTicket"]) assert.equal(typeof d[k], "number", k);
    for (const k of ["laborPct", "foodCostPct"]) assert.ok(d[k] === null || typeof d[k] === "number", k + " number | null (VD-08)");
  }
});

test("REPO-03 D-1 / future: end 2026-10-31 with asOf 2026-09-29 ⇒ the last emitted date ≤ 2026-09-28", async () => {
  await seed(asLegacy(doc03Rows()));
  const d = await DM.getDailyMetrics(T, "2026-09-01", "2026-10-31", B);
  assert.ok(d.every((x) => x.date <= "2026-09-28"));
  assert.ok(!d.some((x) => x.date === AS_OF || x.date === "2026-10-02"));
});

test("REPO-04 explicit zero: a zero-only day is emitted (present); notes-only / empty / hourly-only days are not", async () => {
  await seed(asLegacy(doc03Rows()));
  const dates = (await DM.getDailyMetrics(T, ...ALL, B)).map((x) => x.date);
  for (const z of ["2026-09-04", "2026-09-07", "2026-09-09"]) assert.ok(dates.includes(z), z + " present (VD-23)");
  for (const m of ["2026-09-10", "2026-09-12", "2026-09-13"]) assert.ok(!dates.includes(m), m + " missing");
  const z = (await DM.getDailyMetrics(T, "2026-09-04", "2026-09-04", B))[0];
  assert.equal(z.presence.day, "present"); assert.equal(z.presence.purchases, "present"); assert.equal(z.foodCost, 0);
});

test("REPO-05 latest date: 09-28 zero-only, 09-29 current, 10-02 future ⇒ 2026-09-28", async () => {
  await seed(asLegacy([entry(uid(1), "2026-09-20", { sales: "5" }), entry(uid(2), "2026-09-28", { sales: "0" }), entry(uid(3), AS_OF, { sales: "7" }), entry(uid(4), "2026-10-02", { sales: "9" })]));
  assert.equal(await DM.getLatestDailyDate(T, B), "2026-09-28");
  await seed(asLegacy([entry(uid(3), AS_OF, { sales: "7" })])); assert.equal(await DM.getLatestDailyDate(T, B), null, "only a current-day row ⇒ no completed date");
  await seed(asLegacy([])); assert.equal(await DM.getLatestDailyDate(T, B), null);
});

test("REPO-06 labor records: one per present completed day (duplicate dates ⇒ one); totalCost = payroll + global day; hourly_payroll never counted; unknown facts null", async () => {
  await seed(asLegacy(doc03Rows()), { config: env(configWithGlobal("3000")) });
  const l = await LR.getLaborMetrics(T, "2026-09-01", "2026-09-30", B);
  const byDate = Object.fromEntries(l.map((x) => [x.date, x]));
  assert.equal(l.filter((x) => x.date === "2026-09-14").length, 1);
  assert.equal(byDate["2026-09-11"].totalCost, 160, "payroll 60 + 3000/30; hourly_payroll 40 excluded"); assert.equal(byDate["2026-09-11"].totalCostComplete, true);
  assert.equal(byDate["2026-09-09"].totalCost, 180); assert.equal(byDate["2026-09-09"].hourlyEmployerCost, 80); assert.equal(byDate["2026-09-09"].globalEmployerCost, 100);
  assert.equal(byDate["2026-09-01"].totalCostComplete, false, "no payroll fact ⇒ incomplete"); assert.equal(byDate["2026-09-01"].hourlyEmployerCost, null);
  assert.ok(!("2026-09-10" in byDate), "hourly-only day is missing");
  for (const x of l) { assert.equal(x.employeeCount, null); assert.equal(x.totalHours, null); assert.equal(x.costPerHour, null); }
});

test("REPO-07 purchase records per (day, source): negatives kept, 0/skip ⇒ 0, legacy source named, partial day flagged, unknown supplier fallback", async () => {
  await seed(asLegacy([...doc03Rows(), entry(uid(900), "2026-09-17", { supplier_payments: { s9: "12" } })]));
  const p = await PR.getPurchaseMetrics(T, "2026-09-01", "2026-09-30", B);
  const rows = p.map((x) => [x.date, x.source, x.supplierId, x.supplierName, x.amount, x.dayPurchases]);
  assert.deepEqual(rows, [
    ["2026-09-01", "supplier", "s1", "Alpha", 40, "present"],
    ["2026-09-02", "legacy_food_cost", null, "legacy_food_cost", 30, "present"],
    ["2026-09-03", "supplier", "s1", "Alpha", 0, "present"],
    ["2026-09-04", "supplier", "s1", "Alpha", 0, "present"],
    ["2026-09-05", "supplier", "s1", "Alpha", 0, "present"],
    ["2026-09-06", "supplier", "s2", "Beta", 10, "partial_invalid"],
    ["2026-09-07", "legacy_food_cost", null, "legacy_food_cost", 0, "present"],
    ["2026-09-14", "supplier", "s2", "Beta", 5, "present"],
    ["2026-09-15", "supplier", "s1", "Alpha", -25, "present"],
    ["2026-09-17", "supplier", "s9", "ספק s9", 12, "present"],
  ]);
});

test("REPO-08 retired engine: the repository files carry no arithmetic of their own (source scan)", () => {
  for (const f of ["src/repositories/analytics/dailyMetricsRepo.ts", "src/repositories/analytics/laborRepo.ts", "src/repositories/analytics/purchasesRepo.ts"]) {
    const code = readFileSync(join(ROOT, f), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").split("\n").map((l) => l.replace(/\/\/.*$/, "")).join("\n");
    for (const re of [/\bNumber\(/, /\|\|\s*0\b/, /hourly_payroll/, /supplier_payments/, /food_cost/, /parseFloat/, /\.reduce\(/, /\+=/, /Math\./, /rowComponents|decimalSum|sumObj|aggregateByDate|canonicalDecimal|requireRowForDate|requireEntriesRows/])
      assert.doesNotMatch(code, re, `${f} matches ${re}`);
    assert.match(code, /from "\.\.\/\.\.\/finance-server\/canonicalMetrics\.js"/, f + " is served by the canonical API");
  }
});

test("REPO-09 fetchPlannedData rethrows EntriesStorageError and FinanceContractError (duplicate id); other errors still soft-fail", async () => {
  const plan = { intent: "x", metrics: ["daily", "labor", "purchases"], dimensions: [], filters: {}, timeRange: { start: "2026-09-01", end: "2026-09-28" }, requiresBaseline: false, requiresComparison: false, requiresAnomalyDetection: false };
  const ctx = { tenantId: T, bizId: B, timezone: "Asia/Jerusalem", locale: "he", nowIso: "2026-09-29T09:00:00.000Z", userQuestion: "q" };
  await seed({ schemaVersion: 2, generation: 1, rows: "corrupt" });
  await assert.rejects(() => AS.fetchPlannedData(plan, ctx), (e) => R.isEntriesStorageError(e));
  await seed(asLegacy([entry("X", "2026-09-10", { sales: "1" }), entry("X", "2026-09-11", { sales: "2" })]));
  await assert.rejects(() => AS.fetchPlannedData(plan, ctx), (e) => e.name === "FinanceContractError" && /duplicate_row_id/.test(e.message));
  const db = await seed(asLegacy(doc03Rows()));
  const ok = await AS.fetchPlannedData(plan, ctx);
  assert.equal(ok.fetchStatus.daily, "ok"); assert.equal(ok.fetchStatus.labor, "ok"); assert.equal(ok.fetchStatus.purchases, "ok");
  const orig = db.ref; db.ref = (p) => (p.endsWith(":suppliers") ? { once: async () => { throw new Error("network"); } } : orig(p));
  const soft = await AS.fetchPlannedData(plan, ctx); assert.equal(soft.fetchStatus.purchases, "failed"); assert.equal(soft.fetchStatus.daily, "ok");
});

test("REPO-10 clock: one clock read per repository call; the injected clock is honoured", async () => {
  await seed(asLegacy([entry(uid(1), "2026-01-14", { sales: "1" }), entry(uid(2), "2026-01-15", { sales: "2" }), entry(uid(3), "2026-01-16", { sales: "3" })]));
  for (const call of [() => DM.getDailyMetrics(T, ...ALL, B), () => DM.getLatestDailyDate(T, B), () => LR.getLaborMetrics(T, ...ALL, B), () => PR.getPurchaseMetrics(T, ...ALL, B)]) {
    clockReads = 0; await call(); assert.equal(clockReads, 1, "exactly one clock read");
  }
  clock = nowMsFor("2026-01-16");
  try {
    assert.deepEqual((await DM.getDailyMetrics(T, ...ALL, B)).map((x) => x.date), ["2026-01-14", "2026-01-15"], "asOf 2026-01-16 ⇒ Actual through 01-15");
    assert.equal(await DM.getLatestDailyDate(T, B), "2026-01-15");
  } finally { clock = NOW_MS; }
});
