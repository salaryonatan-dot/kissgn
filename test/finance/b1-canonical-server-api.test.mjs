// Financial Core B1 — canonical server API (src/finance-server/*): API-01…28.
// Pure wrappers are exercised with ServerInputs literals; the loader (API-02/03) and the
// repository error routing run through the server-reader harness (in-memory RTDB).
// Clock injected: asOfBusinessDate 2026-09-29 unless stated. Synthetic data only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { compileServer, makeDb, installDb, offlineFetch } from "../support/server-reader-harness.mjs";
import {
  AS_OF, NOW_MS, EV1, T, B, CONFIG_EMPTY, asLegacy, asV2, configWithGlobal, daysBefore, entry, env, fixedItems, nowMsFor, permutations,
  recordingDb, seedRaw, serverInputs as si, stableJson, uid,
} from "../support/b1-fixtures.mjs";

offlineFetch();
const srv = compileServer();
const CI = await srv.import("src/finance-server/canonicalInputs.js");
const CM = await srv.import("src/finance-server/canonicalMetrics.js");
const DM = await srv.import("src/repositories/analytics/dailyMetricsRepo.js");
const NORM = await srv.import("src/finance/normalize.js");
const DEC = await srv.import("src/finance/decimal.js");
const LAB = await srv.import("src/finance/labor.js");
const PBC = await srv.import("src/finance/purchaseBasis.js");
const REP = await srv.import("src/metrics/report.js");
const PB = await srv.import("src/policy/purchaseBasis.js");
const LS = await srv.import("src/policy/laborSource.js");
const CC = await srv.import("src/metrics/adapters/configCompat.js");
const PF = await srv.import("src/policy/productFinance.js");
const SEP = { from: "2026-09-01", to: "2026-09-30" };
const day = (rows, date, opts) => CM.canonicalDailySeries(si(rows, opts), { from: date, to: date }).days[0];
const sepRows = (f = () => ({ sales: "1000", supplier_payments: { s1: "300" }, payroll: "100" }), last = 28) => Array.from({ length: last }, (_, i) => entry(uid(100 + i), `2026-09-${String(i + 1).padStart(2, "0")}`, f(i)));
const augRows = (f) => Array.from({ length: 31 }, (_, i) => entry(uid(200 + i), `2026-08-${String(i + 1).padStart(2, "0")}`, f(i)));
// CD-M1 R1 / F-01: the month report needs a LOADED ledger; "absent" is the valid empty one (what the loader returns when config/fixed are read and no ledger node exists).
const month = (rows, sel, opts) => CM.canonicalMonthReport(si(rows, { exceptionsState: "absent", ...opts }), sel).report;

test("API-01 provenance: every output carries ServerProvenance; ids are the core constants", () => {
  const i = si(sepRows(), { config: configWithGlobal("3000"), exceptionsState: "absent" });
  const s = CM.canonicalDailySeries(i, SEP);
  const p = s.provenance;
  assert.equal(p.exceptionsState, "absent");
  assert.deepEqual(
    { api: p.api, product: p.product, fin: p.fin, norm: p.norm, dec: p.dec, labor: p.labor, pb: p.pb, pbPolicy: p.pbPolicy, laborSource: p.laborSource, windowRule: p.windowRule, asOf: p.asOfBusinessDate, cal: p.operatingCalendar },
    { api: CI.CANONICAL_SERVER_API_VERSION, product: PF.PRODUCT_FINANCE_VERSION, fin: REP.FINANCIAL_FORMULA_VERSION, norm: NORM.NORMALIZATION_VERSION, dec: DEC.DECIMAL_CONTRACT_VERSION, labor: LAB.LABOR_CONTRACT_VERSION, pb: PBC.PURCHASE_BASIS_CONTRACT_VERSION, pbPolicy: "PB_NET/BD-1", laborSource: "LABOR_SRC/shiftorganizer-hourly-manual/2026-09-29", windowRule: "completed_days_through_d_minus_1", asOf: AS_OF, cal: PF.PRODUCT_CLOSURE_SOURCE });
  assert.equal(p.api, "MARJIN_FIN_SERVER/1"); assert.equal(p.laborSource, LS.productLaborSource().policyId); assert.equal(PB.PB_NET_POLICY_ID, "PB_NET/BD-1");
  assert.equal(p.timelineSource, "compat_current_config"); assert.deepEqual([...p.configurationBasis], ["current_applied_retrospectively"]);
  for (const d of s.days) assert.deepEqual(d.fin, p);
  for (const r of CM.canonicalLaborRecords(i, SEP)) assert.deepEqual(r.fin, p);
  for (const r of CM.canonicalPurchaseRecords(i, SEP, {})) assert.deepEqual(r.fin, p);
  assert.deepEqual(CM.canonicalDayRecord(i, "2026-09-10").provenance, p);
  assert.deepEqual(CM.canonicalMonthReport(i, { kind: "open_month", month: "2026-09" }).provenance, p);
  assert.deepEqual(CM.canonicalMonthProjection(i, CM.canonicalMonthReport(i, { kind: "open_month", month: "2026-09" }).report, { nowMs: NOW_MS }).provenance, p);
});

test("API-02 envelope decoding through the loader: absent / present / unreadable (json, shape, plain object) — never {} / []", async () => {
  const cases = [["absent", null, "absent"], ["present", env({ businessName: "x" }), "present"], ["bad json", { _v: "{bad" }, "unreadable"], ["array for config", { _v: "[1]" }, "unreadable"], ["plain object", { businessName: "x" }, "unreadable"]];
  for (const [name, node, state] of cases) {
    const db = seedRaw(makeDb(), { entries: asLegacy([]), config: node, fixed: node === null ? null : { _v: "[bad" } });
    const i = await CI.loadCanonicalInputs(db, T, B, { site: "t", nowMs: NOW_MS, need: { config: true, fixed: true } });
    assert.equal(i.configState, state, name); assert.equal(i.config.state, state, name);
    if (state !== "present") assert.ok(!("value" in i.config), name + ": never defaulted to {}");
    assert.equal(i.inputIssues.includes("config_unreadable"), state === "unreadable", name);
    if (node !== null) { assert.equal(i.fixedState, "unreadable"); assert.ok(i.inputIssues.includes("fixed_unreadable")); assert.ok(!("value" in i.fixed)); }
  }
  const empty = await CI.loadCanonicalInputs(seedRaw(makeDb(), { entries: asLegacy([]), fixed: { _v: "[]" } }), T, B, { site: "t", nowMs: NOW_MS, need: { config: true, fixed: true } });
  assert.deepEqual(empty.fixed, { state: "present", value: [] }, "an empty list is PRESENT (R-17 valid zero)");
});

test("API-03 loader I/O: entries read once; config/fixed only when asked (CD-M1: the ledger whenever monthly costs are read); a rejected read propagates; exactly one clock read when nowMs is omitted; no write", async () => {
  const base = seedRaw(makeDb(), { entries: asLegacy([entry(uid(1), "2026-09-01", { sales: "1" })]), fixed: env([]) });
  for (const need of [{ config: false, fixed: false }, { config: true, fixed: false }, { config: false, fixed: true }, { config: true, fixed: true }]) {
    const db = recordingDb(base);
    const i = await CI.loadCanonicalInputs(db, T, B, { site: "t", nowMs: NOW_MS, need });
    assert.deepEqual(db.reads.filter((p) => p.endsWith(":entries")).length, 1, JSON.stringify(need));
    assert.equal(db.reads.some((p) => p.endsWith(":config")), need.config); assert.equal(db.reads.some((p) => p.endsWith(":fixed")), need.fixed);
    // CD-M1 (TD-CDM1-2): monthly-cost placement depends on declared closures ⇒ a cost-reading call also reads the ledger once
    const ledgerRead = need.config || need.fixed;
    assert.equal(db.reads.some((p) => p === `tenants/${T}/entry_exceptions/${B}`), ledgerRead, JSON.stringify(need) + " ledger");
    assert.equal(db.reads.some((p) => p === `tenants/${T}/${B}:cost_history`), ledgerRead, JSON.stringify(need) + " cost history");
    assert.equal(db.reads.length, 1 + (need.config ? 1 : 0) + (need.fixed ? 1 : 0) + (ledgerRead ? 1 : 0) + (ledgerRead ? 1 : 0));
    assert.equal(i.configState, need.config ? "present" : "not_loaded"); assert.equal(i.fixedState, need.fixed ? "present" : "not_loaded");
    assert.equal(i.storageMode, "legacy"); assert.equal(i.asOfBusinessDate, AS_OF);
  }
  assert.deepEqual(base.writes, [], "the loader never writes");
  const failing = { ref: (p) => (p.endsWith(":config") ? { once: async () => { throw new Error("rtdb down"); } } : base.ref(p)) };
  await assert.rejects(() => CI.loadCanonicalInputs(failing, T, B, { site: "t", nowMs: NOW_MS, need: { config: true, fixed: false } }), /rtdb down/, "a failed read is never 'absent'");
  const realNow = Date.now; let calls = 0;
  try {
    Date.now = () => { calls++; return NOW_MS; };
    await CI.loadCanonicalInputs(base, T, B, { site: "t", need: { config: true, fixed: true } }); assert.equal(calls, 1, "exactly one Date.now()");
    calls = 0; await CI.loadCanonicalInputs(base, T, B, { site: "t", nowMs: nowMsFor("2026-01-15"), need: { config: true, fixed: true } }); assert.equal(calls, 0, "injected clock: no read");
  } finally { Date.now = realNow; }
  const v2 = await CI.loadCanonicalInputs(seedRaw(makeDb(), { entries: asV2([entry(uid(1), "2026-09-01", { sales: "1" })]) }), T, B, { site: "t", nowMs: NOW_MS, need: { config: false, fixed: false } });
  assert.equal(v2.storageMode, "v2");
  // RTDB numeric-key readback of the two map fields (client contract R2-B3) — non-mutating
  const stored = [{ id: uid(5), date: "2026-09-02", supplier_payments: [null, "4", "6"], hourly_payroll: ["1"], notes: ["a", "b"] }, "garbage"];
  const before = JSON.stringify(stored);
  // B1 R1 (Codex FC-05/AR-05): the readback is part of the SHARED product composition now
  // (src/policy/productFinance.ts); the loader passes rows UNMODIFIED
  const out = PF.mapFieldReadback(stored);
  assert.deepEqual(out[0].supplier_payments, { 1: "4", 2: "6" }); assert.deepEqual(out[0].hourly_payroll, { 0: "1" }); assert.deepEqual(out[0].notes, ["a", "b"], "other arrays untouched");
  assert.equal(out[1], "garbage"); assert.equal(JSON.stringify(stored), before, "stored rows never mutated");
  assert.deepEqual([...PF.ENTRY_MAP_FIELDS], ["supplier_payments", "hourly_payroll"]);
  const rawNode = { schemaVersion: 2, generation: 1, rows: { [uid(5)]: { ...stored[0], _gen: 1 } } };
  const loaded = await CI.loadCanonicalInputs(seedRaw(makeDb(), { entries: rawNode }), T, B, { site: "t", nowMs: NOW_MS, need: { config: false, fixed: false, exceptions: false } });
  assert.ok(Array.isArray(loaded.rows[0].supplier_payments), "the loader hands the core the raw rows");
  // need.exceptions: the structured ledger is read only when asked and decoded by the shared core decoder
  const ledgerDb = seedRaw(makeDb(), { entries: asLegacy([entry(uid(1), "2026-09-01", { sales: "1" })]) });
  ledgerDb.seed(`tenants/${T}/entry_exceptions/${B}`, { "2026-09-02": { state: { status: "active" } }, "2026-09-03": { state: { status: "cleared" } } });
  for (const exceptions of [false, true]) {
    const rec = recordingDb(ledgerDb);
    const li = await CI.loadCanonicalInputs(rec, T, B, { site: "t", nowMs: NOW_MS, need: { config: false, fixed: false, exceptions } });
    assert.equal(rec.reads.some((p) => p === `tenants/${T}/entry_exceptions/${B}`), exceptions);
    assert.equal(li.exceptionsState, exceptions ? "present" : "not_loaded");
    assert.deepEqual(li.exceptionsByDate, exceptions ? { "2026-09-02": true, "2026-09-03": false } : undefined);
    // CD-M1: the same decode, reason-aware (the only structured closure source)
    assert.deepEqual(li.exceptionStates, exceptions ? { "2026-09-02": { status: "active", reasonCode: null }, "2026-09-03": { status: "cleared", reasonCode: null } } : undefined);
    assert.equal(li.exceptionLedgerState, exceptions ? "present" : "not_loaded");
  }
});

test("API-04 partial month D-1: asOf 2026-09-29 ⇒ effective range ends 2026-09-28; the 09-29 row never appears", () => {
  const rows = [entry(uid(1), "2026-09-27", { sales: "1" }), entry(uid(2), "2026-09-28", { sales: "2" }), entry(uid(3), AS_OF, { sales: "3" })];
  const s = CM.canonicalDailySeries(si(rows), SEP);
  assert.deepEqual(s.window.effective, { from: "2026-09-01", to: "2026-09-28" }); assert.equal(s.window.completedThrough, "2026-09-28");
  assert.deepEqual(s.days.map((d) => d.date), ["2026-09-27", "2026-09-28"]);
  assert.ok(!s.missingDates.includes(AS_OF)); assert.equal(s.quarantine.futureRows, 0, "the current day is not future — it is outside Actual");
  assert.equal(CM.canonicalLatestCompletedPresentDate(si(rows)), "2026-09-28");
});

test("API-05 future rows are quarantined: absent from days, missingDates and the latest date", () => {
  const rows = [entry(uid(1), "2026-09-20", { sales: "1" }), entry(uid(2), "2026-09-30", { sales: "9" }), entry(uid(3), "2026-10-05", { sales: "9" })];
  const s = CM.canonicalDailySeries(si(rows), { from: "2026-09-01", to: "2026-10-31" });
  assert.equal(s.quarantine.futureRows, 2); assert.deepEqual(s.days.map((d) => d.date), ["2026-09-20"]);
  assert.ok(!s.missingDates.some((d) => d >= AS_OF)); assert.equal(CM.canonicalLatestCompletedPresentDate(si(rows)), "2026-09-20");
});

test("API-06 invalid dates (2026-02-29, 29/09/2026, '') are quarantined and never Actual", () => {
  const rows = [entry(uid(1), "2026-02-29", { sales: "5" }), entry(uid(2), "29/09/2026", { sales: "5" }), entry(uid(3), "", { sales: "5" }), entry(uid(4), "2026-02-28", { sales: "1" })];
  const s = CM.canonicalDailySeries(si(rows), { from: "2026-02-01", to: "2026-03-31" });
  assert.equal(s.quarantine.invalidDateRows, 3); assert.deepEqual(s.days.map((d) => [d.date, d.revenue]), [["2026-02-28", 1]]);
  assert.ok(s.flagCodes.includes("invalid_date_row"));
});

test("API-07 duplicate date: 3 rows ⇒ ONE day, exact sum, rowCount 3, order/UUID independent; legacy storage reaches the PF fold; MISSING IDS are informational only (fingerprinted, counted, never repaired)", () => {
  const vals = [["100.1", "150"], ["200.2", "220"], ["300.3", "0"]];
  const out = new Set();
  for (const ids of permutations([uid(1), uid(2), uid(3)])) for (const order of permutations([0, 1, 2])) {
    const rows = order.map((k) => entry(ids[k], "2026-09-10", { sales: vals[k][0], supplier_payments: { A: vals[k][1] } }));
    const rec = CM.canonicalDayRecord(si(rows), "2026-09-10");
    out.add(stableJson({ m: rec.metric, n: rec.day.rowCount, s: rec.day.purchases.bySource }));
  }
  assert.equal(out.size, 1); const one = JSON.parse([...out][0]);
  assert.equal(one.m.revenue, 600.6); assert.equal(one.n, 3); assert.deepEqual(one.s, { "supplier:A": "370" });
  // legacy-storage equivalent of PF-01: {A:150} and {A:220, B:90} on one date ⇒ 460 / A 370 / B 90
  const pf = CM.canonicalDayRecord(si([entry(uid(1), "2026-09-10", { supplier_payments: { A: "150" } }), entry(uid(2), "2026-09-10", { supplier_payments: { A: "220", B: "90" } })]), "2026-09-10");
  assert.equal(pf.metric.foodCost, 460); assert.deepEqual(pf.day.purchases.bySource, { "supplier:A": "370", "supplier:B": "90" });
  // EV-1: missing ids are informational (every observed row lacked an id). An id-less row gets a
  // deterministic fingerprint id + flag row_without_id; identical id-less rows are BOTH counted;
  // the input rows are never mutated or repaired.
  const idless = [entry(null, "2026-09-11", { sales: "10" }), entry(null, "2026-09-11", { sales: "10" }), entry(null, "2026-09-12", { sales: "5" })];
  const before = JSON.stringify(idless);
  const rec = CM.canonicalDayRecord(si(idless), "2026-09-11");
  assert.equal(rec.metric.revenue, 20, "identical id-less rows both count"); assert.equal(rec.day.rowCount, 2);
  assert.ok(rec.day.contributions.every((id) => id.startsWith("noid:")), "fingerprint ids"); assert.equal(new Set(rec.day.contributions).size, 2);
  assert.ok(CM.canonicalDailySeries(si(idless), { from: "2026-09-11", to: "2026-09-12" }).flagCodes.includes("row_without_id"), "disclosed as a dataset flag");
  assert.equal(JSON.stringify(idless), before, "no entry-ID repair / no mutation");
  const withIds = CM.canonicalDayRecord(si([entry(uid(7), "2026-09-11", { sales: "10" }), entry(uid(8), "2026-09-11", { sales: "10" })]), "2026-09-11");
  assert.equal(withIds.metric.revenue, rec.metric.revenue, "the financial result does not depend on ids existing");
  assert.ok(EV1.missingIdRows === EV1.rowsObserved, "EV-1: missing ids on every observed row (informational)");
});

test("API-08 supplier/legacy collision: supplier map wins (incl. explicit 0), flagged; {s1:100}+food_cost 70 ⇒ 100", () => {
  const z = CM.canonicalDayRecord(si([entry(uid(1), "2026-09-10", { sales: "1", supplier_payments: { s1: "0" }, food_cost: "70" })]), "2026-09-10");
  assert.equal(z.metric.foodCost, 0); assert.equal(z.day.purchases.presence, "present"); assert.ok(z.day.flags.some((f) => f.code === "supplier_and_legacy_food_both"));
  assert.equal(day([entry(uid(1), "2026-09-10", { sales: "1", supplier_payments: { s1: "100" }, food_cost: "70" })], "2026-09-10").foodCost, 100);
});

test("API-09 a notes-only row ⇒ the day is missing (in missingDates, not in days); flag rows_without_financial_values", () => {
  const s = CM.canonicalDailySeries(si([entry(uid(1), "2026-09-05", { notes: "closed?" }), entry(uid(2), "2026-09-06", { sales: "1" })]), { from: "2026-09-05", to: "2026-09-06" });
  assert.deepEqual(s.days.map((d) => d.date), ["2026-09-06"]); assert.deepEqual(s.missingDates, ["2026-09-05"]);
  assert.ok(s.flagCodes.includes("rows_without_financial_values"));
});

test("API-10 malformed rows: a non-object element is quarantined (malformed_row) and never throws; supplier_payments 'x' ⇒ invalid_map_shape ⇒ purchases invalid ⇒ foodCostPct null", () => {
  const s = CM.canonicalDailySeries(si(["garbage", 42, null, entry(uid(3), "2026-09-06", { sales: "100", supplier_payments: "x" })]), { from: "2026-09-06", to: "2026-09-06" });
  assert.ok(s.flagCodes.includes("malformed_row")); assert.ok(s.flagCodes.includes("invalid_map_shape"));
  assert.equal(s.days[0].presence.purchases, "invalid"); assert.equal(s.days[0].foodCostPct, null);
});

test("API-11 hourly_payroll: alone ⇒ the day is missing; with sales ⇒ labor incomplete, laborPct null; flag legacy_hourly_payroll_not_counted", () => {
  const alone = CM.canonicalDailySeries(si([entry(uid(1), "2026-09-10", { hourly_payroll: { w1: "50" } })]), { from: "2026-09-10", to: "2026-09-10" });
  assert.deepEqual(alone.days, []); assert.deepEqual(alone.missingDates, ["2026-09-10"]);
  const withSales = CM.canonicalDailySeries(si([entry(uid(1), "2026-09-10", { sales: "500", hourly_payroll: { w1: "50" } })]), { from: "2026-09-10", to: "2026-09-10" });
  const d = withSales.days[0];
  assert.equal(d.laborCostComplete, false); assert.equal(d.laborPct, null); assert.equal(d.presence.hourlyLabor, "absent");
  assert.ok(withSales.flagCodes.includes("legacy_hourly_payroll_not_counted"));
  assert.equal(EV1.legacyHourlyPayrollRows, 0, "EV-1: none in Production; legacy compatibility stays contract-tested");
});

test("API-12 payroll 200 + hourly_payroll 70 + global 3000/month (September) ⇒ laborCost 300 — never 370", () => {
  const d = day([entry(uid(1), "2026-09-10", { sales: "1000", payroll: "200", hourly_payroll: { w1: "70" } })], "2026-09-10", { config: configWithGlobal("3000") });
  assert.equal(d.laborCost, 300); assert.equal(d.hourlyLaborCost, 200); assert.equal(d.globalLaborCost, 100); assert.equal(d.laborCostComplete, true); assert.equal(d.laborPct, 30);
});

test("API-13 parity: canonicalMonthReport ≡ direct computePeriodReport for 20 synthetic businesses × {open, closed}", () => {
  for (let b = 0; b < 20; b++) {
    const rows = [];
    for (let k = 0; k < 40; k++) {
      const date = daysBefore("2026-09-28", (k * (b + 3)) % 75);
      const f = { sales: String(100 + b * 7 + k), payroll: k % 5 === 0 ? undefined : String(10 + b) };
      if (k % 3 === 0) f.supplier_payments = { s1: String(k + b) }; else if (k % 4 === 0) f.food_cost = String(k);
      if (k % 11 === 0) f.hourly_payroll = { w: "9" };
      rows.push(entry(uid(b * 1000 + k), date, Object.fromEntries(Object.entries(f).filter(([, v]) => v !== undefined))));
    }
    const config = b % 3 === 0 ? configWithGlobal(String(1000 + b)) : b % 3 === 1 ? CONFIG_EMPTY : { rentType: "pct", rentPct: "5", employees: [] };
    const fixed = b % 2 ? fixedItems(String(500 + b)) : null;
    for (const sel of [{ kind: "open_month", month: "2026-09" }, { kind: "closed_month", month: "2026-08" }]) {
      const got = REP.serializeReport(month(rows, sel, { config, fixed }));
      const n = NORM.normalizeRows(rows, { asOfBusinessDate: AS_OF });
      const bounds = sel.month === "2026-09" ? ["2026-09-01", "2026-09-30"] : ["2026-08-01", "2026-08-31"];
      const days = NORM.groupByDate(n.rows, { from: bounds[0], to: bounds[1] });
      // CD-M1: the product binds its exception-domain closure calendar (empty here) instead of NO_DECLARED_CLOSURES
      const direct = REP.computePeriodReport(days, CC.costTimelineFromCurrentConfig(config, fixed), PB.productPurchaseBasis(), LS.productLaborSource(), { kind: sel.kind, month: sel.month, asOfBusinessDate: AS_OF }, { quarantine: n.quarantine, flags: n.flags, operatingCalendar: { source: PF.PRODUCT_CLOSURE_SOURCE, closedDates: [] }, closureCalendarUnreadable: false });
      assert.equal(got, REP.serializeReport(direct), `business ${b} ${sel.kind}`);
    }
  }
});

test("API-14 complete closed month 2026-08 ⇒ operating profit complete, hand-computed exact value", () => {
  const r = month(augRows(() => ({ sales: "1000", supplier_payments: { s1: "300" }, payroll: "100" })), { kind: "closed_month", month: "2026-08" }, { config: configWithGlobal("3100"), fixed: fixedItems("3100") });
  // 31 × 1000 − 31 × 300 − 31 × 100 − 3100 (global) − 3100 (fixed) = 12400
  assert.equal(r.actual.operatingProfit.state, "complete"); assert.equal(r.actual.operatingProfit.value, "12400");
  assert.equal(r.actual.labor.employerCost.value, "6200");
});

test("API-15 open month: Sep 1–28 complete ⇒ complete; a 09-29 (current-day) row does not change one byte", () => {
  const cfg = { config: configWithGlobal("3000") };
  const a = month(sepRows(), { kind: "open_month", month: "2026-09" }, cfg);
  const b = month([...sepRows(), entry(uid(999), AS_OF, { sales: "5555", supplier_payments: { s1: "1" } })], { kind: "open_month", month: "2026-09" }, cfg);
  assert.equal(a.actual.operatingProfit.state, "complete"); assert.equal(REP.serializeReport(a), REP.serializeReport(b));
  assert.equal(a.window.completedThrough, "2026-09-28"); assert.deepEqual(a.window.currentDay, { date: AS_OF, inActual: false });
});

test("API-16 first day of the month (asOf 2026-10-01) ⇒ no_completed_days, empty_window totals, empty series", () => {
  const opts = { asOf: "2026-10-01" };
  const r = month(sepRows(), { kind: "open_month", month: "2026-10" }, opts);
  assert.equal(r.window.state, "no_completed_days"); assert.equal(r.actual.operatingProfit.state, "empty_window"); assert.equal(r.actual.purchasesPct.state, "empty_window");
  assert.equal(r.actual.revenue.value, null);
  assert.deepEqual(CM.canonicalDailySeries(si(sepRows(), opts), { from: "2026-10-01", to: "2026-10-31" }).days, []);
});

test("API-17 a missing completed day ⇒ revenue coverage lists it; profit incomplete (null); purchases % incomplete", () => {
  const r = month(sepRows().filter((x) => x.date !== "2026-09-20"), { kind: "open_month", month: "2026-09" }, { config: CONFIG_EMPTY });
  assert.ok(r.coverage.revenue.missingDays.includes("2026-09-20"));
  assert.equal(r.actual.operatingProfit.state, "incomplete_components"); assert.equal(r.actual.operatingProfit.value, null);
  assert.equal(r.actual.purchasesPct.state, "incomplete_components");
});

test("API-18 explicit revenue zero is a complete fact: daily ratios null; the period profit is a real negative number", () => {
  const d = day([entry(uid(1), "2026-09-10", { sales: "0", supplier_payments: { s1: "5" }, payroll: "1" })], "2026-09-10");
  assert.equal(d.presence.revenue, "present"); assert.equal(d.revenue, 0); assert.equal(d.laborPct, null); assert.equal(d.foodCostPct, null);
  const r = month(augRows(() => ({ sales: "0", supplier_payments: { s1: "5" }, payroll: "1" })), { kind: "closed_month", month: "2026-08" });
  assert.equal(r.actual.revenue.complete, true); assert.equal(r.actual.operatingProfit.state, "complete"); assert.equal(r.actual.operatingProfit.value, "-186");
});

test("API-19 purchases missing ⇒ purchases % and profit incomplete; explicit {s1:'0'} or 'skip' ⇒ complete", () => {
  const missing = month(augRows(() => ({ sales: "100", payroll: "1" })), { kind: "closed_month", month: "2026-08" });
  assert.equal(missing.actual.purchasesPct.state, "incomplete_components"); assert.equal(missing.actual.operatingProfit.state, "incomplete_components");
  for (const v of ["0", "skip"]) {
    const r = month(augRows(() => ({ sales: "100", payroll: "1", supplier_payments: { s1: v } })), { kind: "closed_month", month: "2026-08" });
    assert.equal(r.actual.purchasesPct.state, "value", v); assert.equal(r.actual.operatingProfit.state, "complete", v); assert.equal(r.actual.operatingProfit.value, "3069", v);
  }
});

test("API-20 a completed day without payroll ⇒ laborCostComplete false, laborPct null; report labor / profit incomplete", () => {
  const d = day([entry(uid(1), "2026-09-10", { sales: "100", supplier_payments: { s1: "5" } })], "2026-09-10");
  assert.equal(d.laborCostComplete, false); assert.equal(d.laborPct, null);
  const r = month(augRows((i) => (i === 4 ? { sales: "100", supplier_payments: { s1: "5" } } : { sales: "100", supplier_payments: { s1: "5" }, payroll: "1" })), { kind: "closed_month", month: "2026-08" });
  assert.equal(r.actual.labor.employerCost.state, "incomplete_components"); assert.equal(r.actual.operatingProfit.state, "incomplete_components");
});

test("API-21 missing / invalid global employer cost (no amount, 'abc', −5, config absent, config unreadable) ⇒ null, never 0", () => {
  const cases = [["no amount", { employees: [{ id: "g1", type: "global" }] }, "incomplete_components"], ["abc", configWithGlobal("abc"), "invalid_components"], ["-5", configWithGlobal("-5"), "invalid_components"], ["config absent", null, "incomplete_components"], ["config unreadable", { state: "unreadable", reason: "envelope_json" }, "incomplete_components"]];
  for (const [name, config, state] of cases) {
    const i = si(sepRows(), { config, exceptionsState: "absent" });
    const d = CM.canonicalDailySeries(i, { from: "2026-09-01", to: "2026-09-01" }).days[0];
    assert.equal(d.globalLaborCost, null, name); assert.equal(d.laborCostComplete, false, name); assert.equal(d.laborPct, null, name);
    const g = CM.canonicalMonthReport(i, { kind: "open_month", month: "2026-09" }).report.actual.labor.globalEmployerCost;
    assert.equal(g.state, state, name); assert.equal(g.value, null, name); assert.equal(g.issues[0].component, "global_employer_cost", name);
    assert.equal(i.inputIssues.includes("config_unreadable"), name === "config unreadable", name);
  }
});

test("API-22 calendar-day allocation: global 3000 and fixed 3100 over September ⇒ 100/day and 3100/30; month totals exact, independent of rows", () => {
  const opts = { config: configWithGlobal("3000"), fixed: fixedItems("3100"), asOf: "2026-10-02" };
  assert.equal(day(sepRows(), "2026-09-10", opts).globalLaborCost, 100);
  const variants = [sepRows(), sepRows().filter((_, i) => i % 3 === 0), [...sepRows(), ...sepRows().map((r, i) => ({ ...r, id: uid(5000 + i) }))], [entry(uid(1), "2026-09-03", { sales: "1" })]];
  for (const rows of variants) {
    const r = month(rows, { kind: "closed_month", month: "2026-09" }, opts);
    assert.equal(r.actual.labor.globalEmployerCost.value, "3000"); assert.equal(r.actual.fixedAccrual.regular, "3100"); assert.equal(r.actual.fixedAccrual.total, "3100");
  }
  const open = month(sepRows(), { kind: "open_month", month: "2026-09" }, { ...opts, asOf: AS_OF });
  assert.equal(open.actual.labor.globalEmployerCost.value, "2800", "28 completed days × 100"); assert.equal(open.actual.fixedAccrual.regular, "8680/3", "28 × 3100/30, exact rational");
});

test("API-23 month lengths (Feb 2027 = 28, Feb 2028 = 29, Apr 2026 = 30, Jan 2027 = 31): the monthly amount reconciles exactly", () => {
  for (const [m, asOf, perDay] of [["2027-02", "2027-03-05", 107.1428571429], ["2028-02", "2028-03-05", 103.4482758621], ["2026-04", "2026-05-05", 100], ["2027-01", "2027-02-05", 96.7741935484]]) {
    const opts = { config: configWithGlobal("3000"), asOf };
    assert.equal(month([entry(uid(1), `${m}-03`, { sales: "1" })], { kind: "closed_month", month: m }, opts).actual.labor.globalEmployerCost.value, "3000", m);
    assert.equal(day([entry(uid(1), `${m}-03`, { sales: "1", payroll: "0" })], `${m}-03`, opts).globalLaborCost, perDay, m + " per-day legacy number (10 dp)");
  }
});

test("API-24 performance: N ≥ EV-1 maxRowsTotal (213) rows over ≥ 3 years, and a 3-year daily stress — series 90 days + month report complete", (t) => {
  const N = EV1.maxRowsTotal; assert.equal(N, 213);
  const spread = Array.from({ length: N }, (_, i) => entry(uid(10000 + i), daysBefore("2026-09-28", i * 6), { sales: String(1000 + i), supplier_payments: { s1: String(200 + (i % 17)), s2: "0" }, payroll: String(90 + (i % 5)) }));
  const first = spread[spread.length - 1].date; assert.ok(first <= "2023-09-29", "≥ 3 years of dates: " + first);
  const stress = Array.from({ length: 1100 }, (_, i) => entry(uid(20000 + i), daysBefore("2026-09-28", i), { sales: String(500 + i), supplier_payments: { s1: "100" }, payroll: "50" }));
  for (const [label, rows] of [["EV-1 max (213 rows)", spread], ["3-year daily stress (1100 rows)", stress]]) {
    const i = si(rows, { config: configWithGlobal("3000"), fixed: fixedItems("3100"), exceptionsState: "absent" });
    const t0 = process.hrtime.bigint();
    const s = CM.canonicalDailySeries(i, { from: daysBefore("2026-09-28", 89), to: "2026-09-28" });
    const t1 = process.hrtime.bigint();
    const r = CM.canonicalMonthReport(i, { kind: "open_month", month: "2026-09" });
    const t2 = process.hrtime.bigint();
    const latest = CM.canonicalLatestCompletedPresentDate(i);
    const t3 = process.hrtime.bigint();
    assert.ok(s.days.length > 0); assert.ok(r.report.window.state === "actual"); assert.equal(latest, "2026-09-28");
    t.diagnostic(`${label}: series(90d) ${(Number(t1 - t0) / 1e6).toFixed(1)} ms, month report ${(Number(t2 - t1) / 1e6).toFixed(1)} ms, latest date ${(Number(t3 - t2) / 1e6).toFixed(1)} ms (report-only; no threshold set)`);
  }
});

test("API-25 deterministic decimals: 100.1 + 200.2 + 300.3 = 600.6 in every order/form; exact rationals in the report; legacy numbers at 10 dp; repeated runs byte-identical", () => {
  const out = new Set();
  for (const perm of permutations(["100.1", 200.2, "300.3"])) out.add(day(perm.map((v, k) => entry(uid(k + 1), "2026-09-10", { sales: v })), "2026-09-10").revenue);
  assert.deepEqual([...out], [600.6]);
  const i = si(sepRows(), { config: configWithGlobal("1000"), exceptionsState: "absent" });
  const r = CM.canonicalMonthReport(i, { kind: "open_month", month: "2026-09" }).report;
  assert.equal(r.actual.labor.globalEmployerCost.value, "2800/3", "28 × 1000/30 kept exact");
  assert.equal(CM.canonicalDailySeries(i, { from: "2026-09-01", to: "2026-09-01" }).days[0].globalLaborCost, 33.3333333333, "one conversion, 10 dp, half away from zero");
  const a = stableJson(CM.canonicalDailySeries(i, SEP)), b = stableJson(CM.canonicalDailySeries(i, SEP));
  assert.equal(a, b); assert.equal(REP.serializeReport(r), REP.serializeReport(CM.canonicalMonthReport(i, { kind: "open_month", month: "2026-09" }).report));
});

test("API-26 percentage unavailable: revenue missing / zero / negative ⇒ ratios null (never 0); report ratio states typed", () => {
  for (const sales of [undefined, "0", "-10"]) {
    const f = sales === undefined ? { supplier_payments: { s1: "5" }, payroll: "1" } : { sales, supplier_payments: { s1: "5" }, payroll: "1" };
    const d = day([entry(uid(1), "2026-09-03", f)], "2026-09-03");
    assert.equal(d.laborPct, null, String(sales)); assert.equal(d.foodCostPct, null, String(sales));
  }
  const states = (f) => { const r = month(augRows(f), { kind: "closed_month", month: "2026-08" }); return [r.actual.purchasesPct.state, r.actual.labor.employerCostPct.state]; };
  assert.deepEqual(states(() => ({ sales: "0", supplier_payments: { s1: "5" }, payroll: "1" })), ["zero_denominator", "zero_denominator"]);
  assert.deepEqual(states(() => ({ sales: "-10", supplier_payments: { s1: "5" }, payroll: "1" })), ["negative_denominator", "negative_denominator"]);
  assert.deepEqual(states(() => ({ supplier_payments: { s1: "5" }, payroll: "1" })), ["incomplete_components", "incomplete_components"]);
  assert.equal(month(sepRows().filter((x) => x.date !== "2026-09-02"), { kind: "open_month", month: "2026-09" }).actual.purchasesPct.state, "incomplete_components");
});

test("API-27 duplicate row id ⇒ FinanceContractError(duplicate_row_id) from series, day record and month report; isCanonicalFinanceError", () => {
  const i = si([entry("X", "2026-09-10", { sales: "1" }), entry("X", "2026-09-11", { sales: "2" })], { exceptionsState: "absent" });
  for (const fn of [() => CM.canonicalDailySeries(i, SEP), () => CM.canonicalDayRecord(i, "2026-09-10"), () => CM.canonicalMonthReport(i, { kind: "open_month", month: "2026-09" }), () => CM.canonicalLatestCompletedPresentDate(i)]) {
    assert.throws(fn, (e) => e.name === "FinanceContractError" && /duplicate_row_id/.test(e.message) && CM.isCanonicalFinanceError(e));
  }
  assert.equal(CM.isCanonicalFinanceError(new Error("x")), false); assert.equal(CM.isCanonicalFinanceError(null), false);
});

test("API-28 invalid range ⇒ FinanceContractError through the repository; from > to ⇒ days []", async () => {
  installDb(seedRaw(makeDb(), { entries: asLegacy([entry(uid(1), "2026-09-10", { sales: "1" })]) }));
  await assert.rejects(() => DM.getDailyMetrics(T, "2026-13-01", "2026-09-30", B), (e) => CM.isCanonicalFinanceError(e));
  await assert.rejects(() => DM.getDailyMetrics(T, "2026-09-01", "", B), (e) => CM.isCanonicalFinanceError(e));
  assert.deepEqual(CM.canonicalDailySeries(si([entry(uid(1), "2026-09-10", { sales: "1" })]), { from: "2026-09-20", to: "2026-09-10" }).days, []);
});

// ══ B1 R1 (Codex re-review of 658cd05) ══════════════════════════════════════════
test("B1R1-01 need.exceptions: the structured ledger decodes with the parity-tested resolver's meaning; the month projection requires it and excludes exception days from forecast history", async () => {
  const { resolveEffectiveException } = await import("../../lib/entryExceptions.js");
  // decoder ≡ lib/entryExceptions.js resolveEffectiveException (structured origin only) for every envelope shape
  const envs = { "2026-09-01": { state: { status: "active", reasonCode: "closure" } }, "2026-09-02": { state: { status: "cleared" } }, "2026-09-03": { state: {} }, "2026-09-04": {}, "2026-09-05": null, "2026-09-06": "str", "2026-09-07": { state: "x" }, "not-a-date": { state: { status: "active" } } };
  const d = PF.decodeExceptionLedger(envs);
  assert.equal(d.state, "present");
  for (const [date, env] of Object.entries(envs)) {
    if (date === "not-a-date") { assert.ok(!(date in d.value)); continue; }
    const r = resolveEffectiveException(env, null);
    assert.equal(date in d.value, r.origin === "structured", date);
    // CD-M1: the decode is reason-aware (status + active reasonCode); the boolean meaning is unchanged
    if (r.origin === "structured") { assert.equal(d.value[date].status === "active", r.isException, date); assert.equal(d.value[date].reasonCode, r.isException && typeof r.state.reasonCode === "string" ? r.state.reasonCode : null, date); }
  }
  assert.deepEqual(PF.decodeExceptionLedger(null), { state: "absent" });
  for (const bad of ["x", 5, [1], true]) assert.deepEqual(PF.decodeExceptionLedger(bad), { state: "unreadable", reason: "ledger_shape" });
  // loader: unreadable ledger is an input issue, never "no exceptions"
  const badDb = seedRaw(makeDb(), { entries: asLegacy([entry(uid(1), "2026-09-01", { sales: "1" })]) });
  badDb.seed(`tenants/${T}/entry_exceptions/${B}`, "corrupt");
  const bi = await CI.loadCanonicalInputs(badDb, T, B, { site: "t", nowMs: NOW_MS, need: { config: true, fixed: true, exceptions: true } });
  assert.equal(bi.exceptionsState, "unreadable"); assert.ok(bi.inputIssues.includes("exceptions_unreadable")); assert.ok(!("exceptionsByDate" in bi));
  // month projection: requires the ledger; unreadable ⇒ no projection; present ⇒ exception days leave forecast history
  const hist = [];
  for (let k = 0; k < 90; k++) { const date = daysBefore("2026-09-28", k); hist.push(entry(uid(40000 + k), date, { sales: date === "2026-09-22" ? "90000" : "1000", supplier_payments: { s1: "300" }, payroll: "100" })); }
  const opts = { config: configWithGlobal("3000"), fixed: fixedItems("3100") };
  const base = si(hist, opts);
  // CD-M1 R1 / F-01: a not-loaded ledger is refused by the month report too (never "no closures").
  assert.throws(() => CM.canonicalMonthReport(base, { kind: "open_month", month: "2026-09" }), (e) => e.name === "FinanceContractError" && /exceptions_required/.test(e.message));
  const rep = CM.canonicalMonthReport(si(hist, { ...opts, exceptionsState: "absent" }), { kind: "open_month", month: "2026-09" }).report;
  assert.throws(() => CM.canonicalMonthProjection(base, rep, { nowMs: NOW_MS }), (e) => e.name === "FinanceContractError" && /exceptions_required/.test(e.message));
  const unreadable = CM.canonicalMonthProjection(si(hist, { ...opts, exceptionsState: "unreadable" }), rep, { nowMs: NOW_MS });
  assert.deepEqual([unreadable.projection, unreadable.forecast.projectedRevenue, unreadable.forecast.warnings], [null, null, ["exception_ledger_unreadable"]]);
  const without = CM.canonicalMonthProjection(si(hist, { ...opts, exceptionsState: "absent" }), rep, { nowMs: NOW_MS });
  const withExc = CM.canonicalMonthProjection(si(hist, { ...opts, exceptionsByDate: { "2026-09-22": true } }), CM.canonicalMonthReport(si(hist, { ...opts, exceptionsByDate: { "2026-09-22": true } }), { kind: "open_month", month: "2026-09" }).report, { nowMs: NOW_MS });
  assert.equal(typeof without.forecast.projectedRevenue, "string"); assert.equal(typeof withExc.forecast.projectedRevenue, "string");
  assert.notEqual(withExc.forecast.projectedRevenue, without.forecast.projectedRevenue, "the structured exception day is excluded from the forecast baseline");
  assert.equal(withExc.provenance.exceptionsState, "present");
  const direct = PF.productMonthProjection({ ...si(hist, opts), exceptionsByDate: { "2026-09-22": true } }, CM.canonicalMonthReport(si(hist, { ...opts, exceptionsByDate: { "2026-09-22": true } }), { kind: "open_month", month: "2026-09" }).report, { nowMs: NOW_MS, tenantId: T, bizId: B });
  assert.deepEqual(withExc.forecast, direct.forecast);
});

test("AT-18 a future `costVersions`-shaped field (and any unknown field) on the inputs changes nothing and needs no call-site rewrite", async (t) => {
  const rows = sepRows();
  const opts = { config: configWithGlobal("3000"), fixed: fixedItems("3100"), exceptionsState: "absent" };
  const plainIn = si(rows, opts);
  const future = { ...si(rows, opts), costVersions: [{ versionId: "f1:2026-09", effectiveFrom: "2026-09-01", basis: "effective_dated", globalEmployees: [{ employeeKey: "g9", kind: "authoritative_employer_cost", monthlyAmount: "999999" }], fixedItems: [{ itemKey: "x", monthlyAmount: "888888" }] }], someFutureField: { any: "thing" } };
  const outs = (i) => stableJson({
    series: CM.canonicalDailySeries(i, SEP), report: REP.serializeReport(CM.canonicalMonthReport(i, { kind: "open_month", month: "2026-09" }).report),
    day: CM.canonicalDayRecord(i, "2026-09-10"), labor: CM.canonicalLaborRecords(i, SEP), purchases: CM.canonicalPurchaseRecords(i, SEP, {}),
    daily: PF.productDailyMetrics(i, SEP), timeline: PF.productTimeline(i),
  });
  assert.equal(outs(future), outs(plainIn), "B1 results are byte-identical with the future field present");
  const r = CM.canonicalMonthReport(future, { kind: "open_month", month: "2026-09" }).report;
  assert.deepEqual([r.timelineSource, [...r.configurationBasis]], ["compat_current_config", ["current_applied_retrospectively"]], "B1 keeps the current-config timeline (no F1 activation)");
  assert.equal(r.actual.labor.globalEmployerCost.value, "2800");
  // compile-time probe: an F1-style extension of ProductInputs type-checks against the UNCHANGED signatures
  const { mkdtempSync, writeFileSync } = await import("node:fs");
  const { spawnSync } = await import("node:child_process");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { ROOT } = await import("../support/server-reader-harness.mjs");
  const dir = mkdtempSync(join(tmpdir(), "b1-at18-"));
  const probe = join(dir, "probe.ts");
  writeFileSync(probe, `import { productDailyMetrics, productMonthReport, productMonthProjection, productTimeline, type ProductInputs } from ${JSON.stringify(join(ROOT, "src/policy/productFinance.js"))};
interface F1Inputs extends ProductInputs { readonly costVersions?: ReadonlyArray<{ readonly versionId: string; readonly effectiveFrom: string }>; }
export function f1CallSites(i: F1Inputs, nowMs: number): unknown[] {
  const report = productMonthReport(i, { kind: "open_month", month: "2026-09" });
  return [productDailyMetrics(i, { from: "2026-09-01", to: "2026-09-30" }), productTimeline(i), report, productMonthProjection(i, report, { nowMs })];
}
`);
  const tsc = join(ROOT, "node_modules", "typescript", "bin", "tsc");
  const res = spawnSync("node", [tsc, "--noEmit", "--strict", "--skipLibCheck", "--target", "es2022", "--module", "esnext", "--moduleResolution", "bundler", probe], { encoding: "utf8" });
  t.diagnostic("AT-18 tsc probe exit " + res.status);
  assert.equal(res.status, 0, "an F1-extended bundle compiles against the B1 call signatures:\n" + res.stdout + res.stderr);
});
