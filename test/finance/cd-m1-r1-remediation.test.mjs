// CD-M1 R1 — regression tests for the three Codex findings on 77f8b7ae
// (cd-m1-codex-review/04_FINDINGS_AND_NEXT_READINESS.md):
//   F-01 exceptionsState "not_loaded" must never act as an empty closure calendar;
//   F-02 a declared closure with non-zero revenue must not leave revenue a complete fact;
//   F-03 server provenance must name the closure source actually used.
// Every product assertion runs on the compiled server source, the freshly compiled browser
// bundle and the committed fincore/v1; the server wrappers run on the real loader.
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadCompiled, loadCommitted } from "../support/fincore-load.mjs";
import { compileServer, makeDb } from "../support/server-reader-harness.mjs";
import { entry, env, uid, configWithGlobal, fixedItems, inputs, serverInputs, stableJson, seedRaw, recordingDb, T, B, nowMsFor } from "../support/b1-fixtures.mjs";

const BROWSER = await loadCompiled();
const COMMITTED = await loadCommitted();
const srv = compileServer();
const SERVER = await srv.import("src/policy/productFinance.js");
const CI = await srv.import("src/finance-server/canonicalInputs.js");
const CM = await srv.import("src/finance-server/canonicalMetrics.js");
const ENGINES = [["server", SERVER], ["browser", BROWSER.product], ["committed", COMMITTED.product]];
const ser = BROWSER.metrics.report.serializeReport;
const LEDGER = `tenants/${T}/entry_exceptions/${B}`;
const SEPT = { kind: "open_month", month: "2026-09" };

let seq = 1;
const row = (date, sales, over = {}) => entry(uid(880000 + seq++), date, { sales, supplier_payments: { s1: "0" }, payroll: "0", ...over });
const dates = (from, to) => { const out = []; for (let d = new Date(from + "T00:00:00Z"); d.toISOString().slice(0, 10) <= to; d.setUTCDate(d.getUTCDate() + 1)) out.push(d.toISOString().slice(0, 10)); return out; };
const closure = { status: "active", reasonCode: "closure" };
const parity = (label, fn) => { const out = ENGINES.map(([e, P]) => [e, stableJson(fn(P))]); for (const [e, s] of out) assert.equal(s, out[0][1], label + ": " + e + " ≠ server"); return JSON.parse(out[0][1]); };
const throwsCode = (fn, code) => assert.throws(fn, (e) => e && e.name === "FinanceContractError" && e.code === code, "expected FinanceContractError " + code);

/** The reviewer's F-01 minimal input: present global config, one completed zero row (asOf Sep 2). */
function f01Db(ledger) {
  const db = seedRaw(makeDb(), { entries: env([row("2026-09-01", "0")]), config: env(configWithGlobal("3000")) });
  if (ledger !== undefined) db.seed(LEDGER, ledger);
  return db;
}
const load = (db, need) => CI.loadCanonicalInputs(db, T, B, { site: "r1", nowMs: nowMsFor("2026-09-02"), need });

// ── F-01 ─────────────────────────────────────────────────────────────────────
test("R1-F01-a canonicalMonthReport distinguishes the four ledger states: not_loaded refused; absent = valid empty; present = applied; unreadable = unknown", async () => {
  const notLoaded = await load(f01Db(), { config: true, fixed: false, exceptions: false }).then((i) => ({ ...i, exceptionsState: "not_loaded", exceptionLedgerState: "not_loaded", exceptionStates: undefined, exceptionsByDate: undefined }));
  throwsCode(() => CM.canonicalMonthReport(notLoaded, SEPT), "exceptions_required");

  const absent = await load(f01Db(), { config: true, fixed: false, exceptions: false });
  assert.equal(absent.exceptionsState, "absent", "loaded, no ledger node ⇒ the valid empty ledger");
  const a = CM.canonicalMonthReport(absent, SEPT).report;
  assert.deepEqual([a.operatingCalendar.source, a.operatingCalendar.closedDates, a.actual.costAllocation.dayPlacement], ["entry_exception_closure", [], "available"]);
  assert.deepEqual([a.actual.labor.globalEmployerCost.state, a.actual.labor.globalEmployerCost.value], ["complete", "100"], "valid empty ledger: allocation is determinable");

  const present = await load(f01Db({ "2026-09-01": { state: closure } }), { config: true, fixed: false, exceptions: false });
  const p = CM.canonicalMonthReport(present, SEPT).report;
  assert.deepEqual([p.operatingCalendar.closedDates, p.actual.costAllocation.completedClosureDates, p.actual.labor.globalEmployerCost.value], [["2026-09-01"], ["2026-09-01"], "0"]);

  const unreadable = await load(f01Db("corrupt"), { config: true, fixed: false, exceptions: false });
  const u = CM.canonicalMonthReport(unreadable, SEPT).report;
  assert.deepEqual([unreadable.exceptionsState, u.actual.costAllocation.dayPlacement, u.actual.labor.globalEmployerCost.state], ["unreadable", "closure_calendar_unreadable", "invalid_components"]);
});

test("R1-F01-b the shared product refuses a not_loaded ledger for the month report and projection on every engine; daily placement is unavailable, never 'no closures'", () => {
  const rows = [row("2026-09-01", "0")];
  const base = inputs(rows, { config: configWithGlobal("3000"), asOf: "2026-09-02" });
  const nl = { ...base, exceptionLedgerState: "not_loaded" };
  for (const [e, P] of ENGINES) {
    throwsCode(() => P.productMonthReport(nl, SEPT), "closure_calendar_not_loaded");
    const rep = P.productMonthReport({ ...base, exceptionLedgerState: "absent" }, SEPT);
    throwsCode(() => P.productMonthProjection(nl, rep, { nowMs: nowMsFor("2026-09-02") }), "closure_calendar_unknown");
    assert.equal(P.closureCalendarUnknown(nl), true, e);
    assert.equal(P.closureCalendarUnknown({ ...base, exceptionLedgerState: "absent" }), false, e + ": absent is a loaded empty ledger");
    assert.equal(P.closureCalendarUnknown(base), false, e + ": an omitted state means the caller supplied the complete ledger");
  }
  const dm = parity("daily not_loaded", (P) => P.productDailyMetrics(nl, { from: "2026-09-01", to: "2026-09-01" }));
  assert.deepEqual([dm[0].globalLaborCost, dm[0].laborCostComplete, dm[0].revenue], [null, false, 0], "closure-dependent placement unavailable; revenue untouched");
  const dmAbsent = parity("daily absent", (P) => P.productDailyMetrics({ ...base, exceptionLedgerState: "absent" }, { from: "2026-09-01", to: "2026-09-01" }));
  assert.deepEqual([dmAbsent[0].globalLaborCost, dmAbsent[0].laborCostComplete], [100, true]);
});

test("R1-F01-c no-cost readers are not forced to read the ledger and their unrelated outputs are unchanged", async () => {
  const rows = [row("2026-09-01", "250", { supplier_payments: { s1: "40" } }), row("2026-09-02", "0")];
  const db = seedRaw(makeDb(), { entries: env(rows), config: env(configWithGlobal("3000")) });
  const rec = recordingDb(db);
  const i = await CI.loadCanonicalInputs(rec, T, B, { site: "purchasesRepo.getPurchaseMetrics", nowMs: nowMsFor("2026-09-03"), need: { config: false, fixed: false, exceptions: false } });
  assert.ok(!rec.reads.includes(LEDGER), "no ledger read without a monthly-cost need");
  assert.equal(i.exceptionsState, "not_loaded");
  assert.deepEqual(CM.canonicalPurchaseRecords(i, { from: "2026-09-01", to: "2026-09-02" }, {}).map((r) => [r.date, r.amount]), [["2026-09-01", 40], ["2026-09-02", 0]]);
  assert.equal(CM.canonicalLatestCompletedPresentDate(i), "2026-09-02");
  const s = CM.canonicalDailySeries(i, { from: "2026-09-01", to: "2026-09-02" });
  assert.deepEqual(s.days.map((d) => [d.date, d.revenue, d.foodCost, d.presence.revenue]), [["2026-09-01", 250, 40, "present"], ["2026-09-02", 0, 0, "present"]]);
  throwsCode(() => CM.canonicalMonthReport(i, SEPT), "exceptions_required");
});

// ── F-02 ─────────────────────────────────────────────────────────────────────
test("R1-F02-a the reviewer's input (Sep 1 revenue 100 + active closure, as of Sep 2): revenue is NOT complete, Sep 1 is an invalid revenue date, the 100 is kept, every revenue-dependent output is invalid", async () => {
  const db = seedRaw(makeDb(), { entries: env([row("2026-09-01", "100")]), config: env(configWithGlobal("3000")) });
  db.seed(LEDGER, { "2026-09-01": { state: closure } });
  const i = await load(db, { config: true, fixed: false, exceptions: true });
  const r = CM.canonicalMonthReport(i, SEPT).report;
  assert.deepEqual(r.actual.revenue, { value: "100", presentDays: 1, complete: false }, "the conflicting amount is preserved, never zeroed, and never complete");
  assert.deepEqual(r.coverage.revenue, { expectedDays: 1, presentDays: 0, missingDays: [], invalidDays: ["2026-09-01"], partialDays: [], closedDays: [] });
  assert.deepEqual(r.operatingCalendar.closedDates, ["2026-09-01"], "the declaration itself is kept for diagnosis");
  assert.ok(r.flags.some((f) => f.code === "closed_day_has_recorded_values" && f.date === "2026-09-01"));
  for (const [name, v] of [["operatingProfit", r.actual.operatingProfit.state], ["contributionBeforeFixed", r.actual.contributionBeforeFixed.state], ["purchasesPct", r.actual.purchasesPct.state], ["employerCostPct", r.actual.labor.employerCostPct.state], ["revenuePerPresentDay", r.actual.averages.revenuePerPresentDay.state]]) {
    assert.equal(v, "invalid_components", name);
  }
  assert.ok(r.actual.operatingProfit.issues.some((x) => x.component === "revenue" && x.kind === "invalid" && x.reason === "closed_day_has_recorded_values"));
  // completeness metadata can no longer present the conflicting value as a complete financial fact
  const claimsComplete = r.actual.revenue.complete === true && r.coverage.revenue.invalidDays.length === 0 && r.coverage.revenue.missingDays.length === 0;
  assert.equal(claimsComplete, false);
});

test("R1-F02-b propagation: forecast partial with the invalid date, projection has no profit, daily metric and analytics doc withhold the revenue as a complete fact — server ≡ browser ≡ committed", async () => {
  const hist = dates("2026-07-01", "2026-09-01").map((d) => row(d, "100"));
  const base = inputs(hist, { config: configWithGlobal("3000"), asOf: "2026-09-02" });
  const inp = { ...base, exceptionStates: { "2026-09-01": closure }, exceptionLedgerState: "present" };
  const out = parity("F-02 product", (P) => {
    const rep = P.productMonthReport(inp, SEPT);
    const pr = P.productMonthProjection(inp, rep, { nowMs: nowMsFor("2026-09-02") });
    return { rep: JSON.parse(ser(rep)), fc: { state: pr.forecast.state, invalid: pr.forecast.invalidRevenueDates, warnings: pr.forecast.warnings }, profit: pr.projection && pr.projection.operatingProfit, dm: P.productDailyMetrics(inp, { from: "2026-09-01", to: "2026-09-01" })[0].partial };
  });
  assert.equal(out.rep.actual.revenue.complete, false);
  assert.deepEqual(out.fc.invalid, ["2026-09-01"]); assert.equal(out.fc.state, "partial"); assert.ok(out.fc.warnings.includes("invalid_completed_days"));
  assert.equal(out.profit, null, "no projected profit on a contradicted Actual");
  assert.equal(out.dm.revenue, true, "the daily metric marks the revenue as not a complete fact");
  const db = seedRaw(makeDb(), { entries: env(hist), config: env(configWithGlobal("3000")) });
  db.seed(LEDGER, { "2026-09-01": { state: closure } });
  const si = await load(db, { config: true, fixed: false, exceptions: false });
  const doc = CM.toAnalyticsFinancials(CM.canonicalDayRecord(si, "2026-09-01"));
  assert.equal("total" in doc.revenue, false, "no legacy revenue total for a contradicted closure");
  assert.equal("sales" in doc.revenue, false); assert.equal(doc.revenue.has_sales, false);
  assert.deepEqual(doc.fin.revenue, { state: "closed_day_has_recorded_values", value: "100" }, "the recorded amount is kept with the reason");
});

test("R1-F02-c unchanged: a valid closed-day explicit zero stays a known zero; an ordinary operating-day zero stays a complete present fact", () => {
  const rows = [row("2026-09-01", "0"), row("2026-09-02", "0"), row("2026-09-03", "200")];
  const inp = { ...inputs(rows, { config: configWithGlobal("3000"), asOf: "2026-09-04" }), exceptionStates: { "2026-09-01": closure }, exceptionLedgerState: "present" };
  const rep = parity("F-02 unchanged", (P) => JSON.parse(ser(P.productMonthReport(inp, SEPT))));
  assert.deepEqual(rep.actual.revenue, { value: "200", presentDays: 3, complete: true });
  assert.deepEqual([rep.coverage.revenue.closedDays, rep.coverage.revenue.invalidDays, rep.coverage.revenue.expectedDays], [["2026-09-01"], [], 2]);
  assert.equal(rep.actual.operatingProfit.state, "complete");
  assert.ok(!rep.flags.some((f) => f.code === "closed_day_has_recorded_values"));
  const dm = parity("F-02 unchanged daily", (P) => P.productDailyMetrics(inp, { from: "2026-09-01", to: "2026-09-02" }).map((m) => m.partial.revenue));
  assert.deepEqual(dm, [false, false]);
});

// ── F-03 ─────────────────────────────────────────────────────────────────────
test("R1-F03 server provenance names the closure source actually used and follows the ledger state (present / absent ⇒ entry_exception_closure; unreadable / not_loaded ⇒ unknown)", async () => {
  const withClosure = await load(f01Db({ "2026-09-01": { state: closure } }), { config: true, fixed: false, exceptions: true });
  const r = CM.canonicalMonthReport(withClosure, SEPT);
  assert.equal(r.provenance.operatingCalendar, "entry_exception_closure");
  assert.equal(r.provenance.operatingCalendar, r.report.operatingCalendar.source, "provenance = the calendar the report used");
  assert.deepEqual(r.report.operatingCalendar.closedDates, ["2026-09-01"]);
  for (const p of [CM.canonicalDailySeries(withClosure, { from: "2026-09-01", to: "2026-09-01" }).provenance, CM.canonicalDayRecord(withClosure, "2026-09-01").provenance]) assert.equal(p.operatingCalendar, "entry_exception_closure");
  assert.equal(CM.canonicalMonthProjection(withClosure, r.report, { nowMs: nowMsFor("2026-09-02") }).provenance.operatingCalendar, "entry_exception_closure");
  const absent = await load(f01Db(), { config: true, fixed: false, exceptions: false });
  assert.deepEqual([absent.exceptionsState, CM.provenanceOf(absent).operatingCalendar], ["absent", "entry_exception_closure"]);
  const unreadable = await load(f01Db("corrupt"), { config: true, fixed: false, exceptions: false });
  assert.deepEqual([unreadable.exceptionsState, CM.provenanceOf(unreadable).operatingCalendar], ["unreadable", "unknown"]);
  const notLoaded = await load(f01Db(), { config: false, fixed: false, exceptions: false });
  assert.deepEqual([notLoaded.exceptionsState, CM.provenanceOf(notLoaded).operatingCalendar], ["not_loaded", "unknown"]);
  assert.equal(CM.canonicalDailySeries(notLoaded, { from: "2026-09-01", to: "2026-09-01" }).provenance.operatingCalendar, "unknown");
  assert.ok(![r.provenance, CM.provenanceOf(absent), CM.provenanceOf(unreadable), CM.provenanceOf(notLoaded)].some((p) => p.operatingCalendar === "none_declared"), "the stale literal never appears");
  const lit = serverInputs([row("2026-09-01", "0")], { config: configWithGlobal("3000"), exceptionsState: "present", exceptionsByDate: {} });
  assert.equal(CM.provenanceOf(lit).operatingCalendar, "entry_exception_closure");
});
