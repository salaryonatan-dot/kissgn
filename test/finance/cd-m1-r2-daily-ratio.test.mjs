// CD-M1 R2 — R1-F02-REM (Codex re-review of 8149bcea): a declared closure with non-zero revenue
// must not yield revenue-dependent DAILY ratios. ONE traceable conflict fixture is followed through
// every layer: shared product (server source ≡ fresh browser bundle ≡ committed fincore/v1) →
// server canonical metrics (real loader) → persisted analytics document (real dailyBuilder,
// saveAnalyticsDoc, storage read-back). Contrast fixtures pin the unchanged contract: a valid
// revenue with zero costs still gives a legitimate 0 %, an operating-day zero and a closed-day
// zero keep their existing meaning, and F-01 / F-03 stay closed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadCompiled, loadCommitted } from "../support/fincore-load.mjs";
import { compileServer, makeDb, installDb, offlineFetch } from "../support/server-reader-harness.mjs";
import { AS_OF, NOW_MS, T, B, asLegacy, configWithGlobal, entry, env, inputs, seedRaw, stableJson, uid } from "../support/b1-fixtures.mjs";

offlineFetch();
const BROWSER = await loadCompiled();
const COMMITTED = await loadCommitted();
const srv = compileServer();
const SERVER = await srv.import("src/policy/productFinance.js");
const CI = await srv.import("src/finance-server/canonicalInputs.js");
const CM = await srv.import("src/finance-server/canonicalMetrics.js");
const DBLD = await srv.import("src/analytics/dailyBuilder.js");
const ENGINES = [["server", SERVER], ["browser", BROWSER.product], ["committed", COMMITTED.product]];
const parity = (label, fn) => { const out = ENGINES.map(([e, P]) => [e, stableJson(fn(P))]); for (const [e, s] of out) assert.equal(s, out[0][1], label + ": " + e + " ≠ server"); return JSON.parse(out[0][1]); };

// ── THE conflict fixture (Codex minimal input, dated inside the fixed B1 clock) ──
const D = "2026-09-10";                       // completed (AS_OF = 2026-09-29)
const CONFLICT_ROW = { sales: "100", supplier_payments: { s1: "0" }, payroll: "0" };
const CONFIG = configWithGlobal("3000");      // present global configuration
const CLOSURE = { status: "active", reasonCode: "closure" };
const RATIO_KEYS = ["laborPct", "foodCostPct"];

const productIn = (row, { config = CONFIG, closed = true } = {}) =>
  ({ ...inputs([entry(uid(990001), D, row)], { config, asOf: AS_OF }), exceptionStates: closed ? { [D]: CLOSURE } : {}, exceptionLedgerState: "present" });
async function seeded(row, { config = CONFIG, closed = true } = {}) {
  const db = installDb(seedRaw(makeDb(), { entries: asLegacy([entry(uid(990001), D, row)]), config: env(config) }));
  if (closed) db.seed(`tenants/${T}/entry_exceptions/${B}/${D}`, { state: CLOSURE });
  return db;
}
const loadServer = (db) => CI.loadCanonicalInputs(db, T, B, { site: "r2", nowMs: NOW_MS, need: { config: true, fixed: false, exceptions: true } });
async function persisted(row, opts) {
  const db = await seeded(row, opts);
  const doc = await DBLD.buildAnalyticsForBiz(T, B, D, { nowMs: NOW_MS });
  await DBLD.saveAnalyticsDoc(doc);
  return { built: doc, saved: db.read(`tenants/${T}/biz:${B}:analytics:daily:${D}`) };
}

test("R2-01 shared product: the conflict date keeps its raw revenue and partial marker but has NO revenue-dependent ratio — server ≡ browser ≡ committed", () => {
  const inp = productIn(CONFLICT_ROW);
  const out = parity("conflict product", (P) => ({
    dm: P.productDailyMetrics(inp, { from: D, to: D })[0],
    rec: P.productDayRecord(inp, D).metric,
    rep: P.productMonthReport(inp, { kind: "open_month", month: "2026-09" }),
  }));
  for (const m of [out.dm, out.rec]) {
    assert.equal(m.revenue, 100, "raw conflicting revenue preserved");
    assert.equal(m.partial.revenue, true, "diagnostic partial marker preserved");
    assert.equal(m.presence.revenue, "present");
    assert.equal(m.laborPct, null, "laborPct unavailable — never 0");
    assert.equal(m.foodCostPct, null, "foodCostPct unavailable — never 0");
    assert.deepEqual([m.laborCost, m.laborCostComplete, m.globalLaborCost, m.foodCost], [0, true, 0, 0], "non-revenue daily facts are unchanged");
  }
  // the same fixture at report level (link, not the proof): the date is an invalid revenue date
  assert.equal(out.rep.actual.revenue.complete, false);
  assert.ok(out.rep.coverage.revenue.invalidDays.includes(D));
});

test("R2-02 server canonical metrics (real loader): day record, daily series and labor records carry null ratios for the conflict date", async () => {
  const i = await loadServer(await seeded(CONFLICT_ROW));
  assert.equal(i.exceptionsState, "present");
  const rec = CM.canonicalDayRecord(i, D);
  const ser = CM.canonicalDailySeries(i, { from: D, to: D }).days[0];
  for (const m of [rec.metric, ser]) {
    assert.deepEqual([m.revenue, m.partial.revenue, m.laborPct, m.foodCostPct], [100, true, null, null]);
  }
  assert.equal(CM.canonicalLaborRecords(i, { from: D, to: D })[0].laborPctOfRevenue, null);
  assert.equal(rec.provenance.operatingCalendar, "entry_exception_closure", "F-03 still closed");
  assert.throws(() => CM.canonicalMonthReport({ ...i, exceptionsState: "not_loaded" }, { kind: "open_month", month: "2026-09" }), (e) => e.code === "exceptions_required", "F-01 still closed");
});

test("R2-03 analytics document: laborPct and foodCostPct are ABSENT from fin.derived (not 0, not null) in the mapping, the built doc and the persisted read-back; the raw revenue diagnostic stays", async () => {
  const i = await loadServer(await seeded(CONFLICT_ROW));
  const mapped = CM.toAnalyticsFinancials(CM.canonicalDayRecord(i, D));
  const { built, saved } = await persisted(CONFLICT_ROW);
  for (const [label, doc] of [["mapped", mapped], ["built", built], ["persisted", saved], ["json round-trip", JSON.parse(JSON.stringify(saved))]]) {
    for (const k of RATIO_KEYS) assert.equal(Object.prototype.hasOwnProperty.call(doc.fin.derived, k), false, `${label}: fin.derived.${k} must be absent`);
    assert.deepEqual(doc.fin.revenue, { state: "closed_day_has_recorded_values", value: "100" }, label + ": raw revenue + diagnostic in fin.revenue");
    assert.equal("total" in doc.revenue, false, label + ": no legacy revenue total");
    assert.deepEqual([doc.fin.derived.laborCostComplete, doc.fin.derived.laborCost, doc.fin.derived.globalLaborCost], [true, 0, 0], label + ": non-revenue derived facts kept");
  }
  assert.equal(saved.is_exception, true);
});

test("R2-04 contrast — a valid positive revenue with zero costs still yields a LEGITIMATE 0 % (product, server, persisted)", async () => {
  const noGlobal = {};
  const out = parity("valid zero-cost product", (P) => P.productDailyMetrics(productIn(CONFLICT_ROW, { config: noGlobal, closed: false }), { from: D, to: D })[0]);
  assert.deepEqual([out.revenue, out.partial.revenue, out.laborPct, out.foodCostPct], [100, false, 0, 0]);
  const { saved } = await persisted(CONFLICT_ROW, { config: noGlobal, closed: false });
  assert.deepEqual([saved.fin.derived.laborPct, saved.fin.derived.foodCostPct], [0, 0], "a real 0 % is persisted as 0");
  assert.deepEqual(saved.fin.revenue, { state: "present", value: "100" }); assert.equal(saved.revenue.total, 100);
});

test("R2-05 contrast — operating-day zero and closed-day zero keep the existing contract", async () => {
  const zero = { sales: "0", supplier_payments: { s1: "0" }, payroll: "0" };
  const op = parity("operating zero", (P) => P.productDailyMetrics(productIn(zero, { closed: false }), { from: D, to: D })[0]);
  const cl = parity("closed zero", (P) => P.productDailyMetrics(productIn(zero, { closed: true }), { from: D, to: D })[0]);
  assert.deepEqual([op.revenue, op.partial.revenue, op.laborPct, op.foodCostPct], [0, false, null, null], "operating zero: zero denominator ⇒ no ratio (unchanged)");
  assert.deepEqual([cl.revenue, cl.partial.revenue, cl.laborPct, cl.foodCostPct, cl.globalLaborCost], [0, false, null, null, 0], "closed zero: known zero, not a conflict (unchanged)");
  const opDoc = (await persisted(zero, { closed: false })).saved;
  const clDoc = (await persisted(zero, { closed: true })).saved;
  for (const doc of [opDoc, clDoc]) {
    assert.deepEqual(doc.fin.revenue, { state: "present", value: "0" }); assert.equal(doc.revenue.total, 0); assert.equal(doc.revenue.has_sales, false);
    for (const k of RATIO_KEYS) assert.equal(k in doc.fin.derived, false);
  }
  const rep = parity("closed zero report", (P) => P.productMonthReport(productIn(zero, { closed: true }), { kind: "open_month", month: "2026-09" }).coverage.revenue);
  assert.ok(rep.closedDays.includes(D) && !rep.invalidDays.includes(D));
});

test("R2-06 directly related instance — a PARTIAL (partly invalid) revenue denominator gives no daily ratio and no persisted ratio either", async () => {
  const rows = [entry(uid(990011), D, { sales: "100", supplier_payments: { s1: "0" }, payroll: "0" }), entry(uid(990012), D, { sales: "abc" })];
  const inp = { ...inputs(rows, { config: {}, asOf: AS_OF }), exceptionStates: {}, exceptionLedgerState: "present" };
  const m = parity("partial revenue", (P) => P.productDailyMetrics(inp, { from: D, to: D })[0]);
  assert.deepEqual([m.revenue, m.partial.revenue, m.laborPct, m.foodCostPct], [100, true, null, null]);
  installDb(seedRaw(makeDb(), { entries: asLegacy(rows), config: env({}) }));
  const doc = await DBLD.buildAnalyticsForBiz(T, B, D, { nowMs: NOW_MS });
  for (const k of RATIO_KEYS) assert.equal(k in doc.fin.derived, false, k + " absent for a partial revenue");
  assert.equal(doc.fin.revenue.state, "partial_invalid");
});
