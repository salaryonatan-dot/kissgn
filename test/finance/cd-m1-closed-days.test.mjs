// CD-M1 — shared financial core and closure-state semantics (owner-approved closed-days /
// active-day allocation amendment, 2026-09-30). Acceptance scenarios CD-AT01…11, 15…25, 28, 29
// (shared-core parts) and the CDA-01…22 rules they exercise. Every product assertion runs on the
// compiled server source, the freshly compiled browser bundle and the committed fincore/v1.
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadCompiled, loadCommitted } from "../support/fincore-load.mjs";
import { compileServer, makeDb } from "../support/server-reader-harness.mjs";
import { entry, env, uid, configWithGlobal, fixedItems, inputs, stableJson, seedRaw, recordingDb, T, B, nowMsFor } from "../support/b1-fixtures.mjs";

const BROWSER = await loadCompiled();
const COMMITTED = await loadCommitted();
const srv = compileServer();
const SERVER = await srv.import("src/policy/productFinance.js");
const CI = await srv.import("src/finance-server/canonicalInputs.js");
const CM = await srv.import("src/finance-server/canonicalMetrics.js");
const ENGINES = [["server", SERVER], ["browser", BROWSER.product], ["committed", COMMITTED.product]];
const CT = BROWSER.metrics.costTimeline, RP = BROWSER.metrics.report, RF = BROWSER.metrics.revenueForecast;
const DEC = BROWSER.finance.decimal;
const ser = RP.serializeReport;

// ── fixtures ────────────────────────────────────────────────────────────────
let seq = 1;
const full = (date, over = {}) => entry(uid(900000 + seq++), date, { sales: "1000", supplier_payments: { s1: "300" }, payroll: "100", ...over });
const dates = (from, to) => { const out = []; for (let d = new Date(from + "T00:00:00Z"); d.toISOString().slice(0, 10) <= to; d.setUTCDate(d.getUTCDate() + 1)) out.push(d.toISOString().slice(0, 10)); return out; };
const closed = (...ds) => Object.fromEntries(ds.map((d) => [d, { status: "active", reasonCode: "closure" }]));
const withStates = (i, states) => ({ ...i, exceptionStates: states });
const rat = (s) => DEC.parseAmountString(s);
const sumRat = (xs) => DEC.serializeRat(xs.reduce((a, x) => DEC.ratAdd(a, x), DEC.RAT_ZERO));
const G30 = configWithGlobal("30000"), F3 = fixedItems("3000");
/** A full September (1…asOf−1 complete), closures entered as explicit zero revenue (the closure action's write). */
function september(asOf, closures = [], over = {}) {
  const rows = dates("2026-09-01", "2026-09-30").filter((d) => d < asOf).map((d) => (closures.includes(d) ? full(d, { sales: "0", supplier_payments: { s1: "0" }, payroll: "0" }) : full(d, over[d] || {})));
  return withStates(inputs(rows, { config: G30, fixed: F3, asOf }), closed(...closures));
}
const placementsOf = (inp, month) => {
  const tl = SERVER.productTimeline(inp);
  const cal = SERVER.productClosureCalendar(inp);
  return dates(month + "-01", BROWSER.finance.businessDate.monthBounds(month).last).map((d) => [d, CT.dayPlacement(tl, d, { asOfBusinessDate: inp.asOfBusinessDate, closedDates: cal.closedDates })]);
};
const parity = (label, fn) => { const out = ENGINES.map(([e, P]) => [e, stableJson(fn(P))]); for (const [e, s] of out) assert.equal(s, out[0][1], label + ": " + e + " ≠ server"); return JSON.parse(out[0][1]); };

// ── CDA-01 closure source ───────────────────────────────────────────────────
test("CD-AT01 closure (explicit zero) vs ordinary entered zero vs missing: three distinct states in coverage, allocation and forecast eligibility", () => {
  const asOf = "2026-09-20";
  const i = september(asOf, ["2026-09-10"], {});
  const rows = i.rows.filter((r) => r.date !== "2026-09-12").map((r) => (r.date === "2026-09-11" ? { ...r, sales: "0" } : r)); // 11: ordinary 0; 12: missing
  const inp = { ...i, rows };
  const rep = parity("report", (P) => P.productMonthReport(inp, { kind: "open_month", month: "2026-09" }));
  assert.deepEqual(rep.coverage.revenue.closedDays, ["2026-09-10"], "closure is closed, not missing");
  assert.deepEqual(rep.coverage.revenue.missingDays, ["2026-09-12"], "missing stays missing (never zero, never closure)");
  assert.equal(rep.coverage.revenue.expectedDays, 18, "19 completed dates − 1 closure");
  assert.deepEqual(rep.actual.costAllocation.completedClosureDates, ["2026-09-10"], "closure leaves the allocation set");
  assert.equal(rep.actual.costAllocation.allocationEligibleDays, 18, "ordinary zero (11) and missing (12) stay allocation-eligible");
  const days = SERVER.productDays(inp, { from: "2026-09-10", to: "2026-09-12" }).days;
  const cs = new Set(SERVER.productClosureCalendar(inp).closedDates);
  assert.deepEqual(days.map((d) => RF.sampleEligibility(d, cs)), [{ eligible: false, reason: "declared_closure" }, { eligible: true }, { eligible: false, reason: "missing_revenue" }]);
  assert.equal(rep.actual.revenue.complete, false, "the missing date keeps revenue partial");
});

test("CDA-01 / CD-AT23 / CD-AT24 closure provenance: structured active closure only; generic reasons are not closure; structured cleared beats legacy; narrow legacy fallback", () => {
  const rows = [full("2026-09-01"), { ...full("2026-09-02", { sales: "0" }), is_exception: true, exception_reason: "closure" }, { ...full("2026-09-03", { sales: "0" }), is_exception: true, exception_reason: "closure" },
    { ...full("2026-09-04", { sales: "0" }), is_exception: true, exception_reason: "closure" }, { ...full("2026-09-04", { sales: "0" }) }, full("2026-09-05", { sales: "0" })];
  const base = inputs(rows, { asOf: "2026-09-10" });
  const states = { "2026-09-03": { status: "cleared", reasonCode: null }, "2026-09-05": { status: "active", reasonCode: "holiday" }, "2026-09-06": { status: "active", reasonCode: "renovation" }, "2026-09-07": { status: "active", reasonCode: "partial_hours" }, "2026-09-08": { status: "active", reasonCode: "closure" } };
  const cal = parity("calendar", (P) => P.productClosureCalendar(withStates(base, states)));
  // 02: legacy single row closure ⇒ closure; 03: structured cleared wins over legacy; 04: two rows ⇒ ambiguous, not closure;
  // 05/06/07: holiday / renovation / partial_hours are NOT accounting closure; 08: structured closure (no row needed)
  assert.deepEqual(cal, { source: "entry_exception_closure", closedDates: ["2026-09-02", "2026-09-08"] });
  const rep = SERVER.productMonthReport(withStates(base, states), { kind: "open_month", month: "2026-09" });
  assert.ok(rep.flags.some((f) => f.code === "exception_rows_disagree" && f.date === "2026-09-03"), "structured-vs-legacy disagreement is traceable");
  assert.ok(rep.coverage.revenue.missingDays.includes("2026-09-06") && rep.coverage.revenue.missingDays.includes("2026-09-07"), "a generic exception day with no revenue is missing, not a forced zero");
  // CD-AT23: a generic exception keeps its existing effect (out of the forecast baseline) without being an accounting closure
  const hol = SERVER.productDays(withStates(base, states), { from: "2026-09-05", to: "2026-09-05" }).days[0];
  assert.deepEqual(RF.sampleEligibility(hol, new Set(cal.closedDates)), { eligible: false, reason: "exception_day" });
  assert.ok(!rep.coverage.revenue.closedDays.includes("2026-09-05"), "a holiday is not a closure");
  // a boolean-only structured ledger (reason unknown) blocks the legacy fallback and creates no closure
  assert.deepEqual(SERVER.productClosureCalendar({ ...base, exceptionsByDate: { "2026-09-02": true } }).closedDates, ["2026-09-03"], "09-02 blocked (structured, reason unknown); 09-03 has no structured state ⇒ legacy fallback applies");
  // ordinary zero / missing never create closure
  assert.deepEqual(SERVER.productClosureCalendar(inputs([full("2026-09-01", { sales: "0" })], { asOf: "2026-09-10" })).closedDates, []);
});

// ── CDA-06 / CDA-07 six-occurrence forecast selection ───────────────────────
test("CD-AT02 eight prior Fridays (two closures, one explicit zero, five positive): the six samples are exactly the eligible Fridays, zero included, closures skipped", () => {
  const fridays = ["2026-07-31", "2026-08-07", "2026-08-14", "2026-08-21", "2026-08-28", "2026-09-04", "2026-09-11", "2026-09-18"];
  const sales = { "2026-07-31": "600", "2026-08-07": "700", "2026-08-14": "800", "2026-08-21": "900", "2026-09-04": "1100", "2026-09-11": "0" };
  const rows = fridays.map((d) => full(d, { sales: sales[d] || "0" }));
  const inp = withStates(inputs(rows, { asOf: "2026-09-25" }), closed("2026-08-28", "2026-09-18"));
  const p = parity("projection", (P) => P.productMonthProjection(inp, P.productMonthReport(inp, { kind: "open_month", month: "2026-09" }), { nowMs: nowMsFor("2026-09-25") }).forecast);
  const fri = p.engine.weekdays.find((w) => w.weekday === 5);
  assert.deepEqual(fri.sampleDates, ["2026-07-31", "2026-08-07", "2026-08-14", "2026-08-21", "2026-09-04", "2026-09-11"]);
  assert.deepEqual(fri.sampleValues, ["600", "700", "800", "900", "1100", "0"], "the explicit operating zero is a sample");
  assert.equal(fri.sampleAverage, "2050/3", "(600+700+800+900+1100+0)/6 exactly");
  assert.equal(p.engine.remainingDates.find((r) => r.date === "2026-09-25").value, "2050/3");
});

test("CD-AT03 only two eligible same-weekday observations ⇒ typed insufficient history; no mixed weekday, no zero-imputed fallback", () => {
  const rows = [full("2026-09-11", { sales: "500" }), full("2026-09-18", { sales: "700" }), ...dates("2026-09-12", "2026-09-17").map((d) => full(d, { sales: "9999" }))];
  const inp = inputs(rows, { asOf: "2026-09-25" });
  const month = { kind: "open_month", month: "2026-09" };
  const eng = RF.computeRevenueForecastV2({ month: "2026-09", asOfBusinessDate: "2026-09-25", history: SERVER.productDays(inp, { from: "2026-09-01", to: "2026-09-24" }).days, closedDates: [] });
  assert.equal(eng.weekdays.find((w) => w.weekday === 5).status, "insufficient_history");
  assert.equal(eng.weekdays.find((w) => w.weekday === 5).sampleAverage, null);
  assert.equal(eng.remainingDates.find((r) => r.date === "2026-09-25").value, null, "nothing fabricated for the Friday");
  const narrow = RF.computeRevenueForecastV2({ month: "2026-09", asOfBusinessDate: "2026-09-30", history: SERVER.productDays(inputs(rows, { asOf: "2026-09-30" }), { from: "2026-09-01", to: "2026-09-29" }).days, closedDates: [] });
  assert.equal(narrow.state, "insufficient_history"); assert.equal(narrow.monthEndForecastRevenue, null, "the only remaining weekday lacks history ⇒ no month figure");
  const p = SERVER.productMonthProjection(inputs(rows, { asOf: "2026-09-30" }), SERVER.productMonthReport(inputs(rows, { asOf: "2026-09-30" }), month), { nowMs: nowMsFor("2026-09-30") });
  assert.deepEqual([p.projection, p.forecast.projectedRevenue, p.forecast.state], [null, null, "insufficient_history"]);
});

test("CD-AT04 a prior-month closed Friday never depresses a later month: the earlier six eligible Fridays are used", () => {
  const fridays = ["2026-08-14", "2026-08-21", "2026-08-28", "2026-09-04", "2026-09-11", "2026-09-18", "2026-09-25"];
  const rows = fridays.map((d, k) => full(d, { sales: d === "2026-09-25" ? "0" : String(1000 + k * 100) }));
  const inp = withStates(inputs(rows, { asOf: "2026-10-02" }), closed("2026-09-25"));
  const fri = SERVER.productMonthProjection(inp, SERVER.productMonthReport(inp, { kind: "open_month", month: "2026-10" }), { nowMs: nowMsFor("2026-10-02") }).forecast.engine.weekdays.find((w) => w.weekday === 5);
  assert.deepEqual(fri.sampleDates, fridays.slice(0, 6)); assert.equal(fri.sampleAverage, "1250");
  // negative control: the same Friday merely ENTERED as 0 (not a closure) is an operating zero and IS sampled
  const zero = SERVER.productMonthProjection(inputs(rows, { asOf: "2026-10-02" }), SERVER.productMonthReport(inputs(rows, { asOf: "2026-10-02" }), { kind: "open_month", month: "2026-10" }), { nowMs: nowMsFor("2026-10-02") }).forecast.engine.weekdays.find((w) => w.weekday === 5);
  assert.deepEqual(zero.sampleDates, fridays.slice(1)); assert.equal(zero.sampleAverage, "3250/3", "(1100+1200+1300+1400+1500+0)/6");
});

// ── CDA-03 / CDA-04 / CDA-05 Actual + remaining forecast; timing split ───────
test("CD-AT05 / CD-AT06 / CD-AT28 one completed + one future closure: completed zero counted once; future closure 0 forecast immediately; Actual, calendar counters and cost placement unchanged by recording it", () => {
  const history = dates("2026-07-01", "2026-08-31").map((d) => full(d));
  const asOf = "2026-09-15";
  const cur = september(asOf, ["2026-09-08"]);
  const before = { ...cur, rows: [...history, ...cur.rows] };
  const after = withStates(before, { ...before.exceptionStates, ...closed("2026-09-22") });
  const month = { kind: "open_month", month: "2026-09" };
  const now = nowMsFor(asOf);
  const rb = SERVER.productMonthReport(before, month), ra = SERVER.productMonthReport(after, month);
  assert.equal(ser(ra), ser(rb), "recording a FUTURE closure changes no byte of the Actual report (incl. calendar counters and cost placement)");
  assert.deepEqual([ra.window.recognizedDays, ra.window.completedThrough], [14, "2026-09-14"]);
  const pb = SERVER.productMonthProjection(before, rb, { nowMs: now }), pa = SERVER.productMonthProjection(after, ra, { nowMs: now });
  const e = pa.forecast.engine;
  assert.equal(e.actualCompletedRevenue, ra.actual.revenue.value, "forecast Actual ≡ report Actual (13 × 1000 + the closure's 0)");
  assert.equal(e.actualCompletedRevenue, "13000");
  assert.deepEqual(e.completedClosureDates, ["2026-09-08"]); assert.deepEqual(e.futureClosureDates, ["2026-09-22"]);
  assert.deepEqual(e.remainingDates.find((r) => r.date === "2026-09-22"), { date: "2026-09-22", kind: "declared_closure", value: "0" });
  const forecasts = e.remainingDates.filter((r) => r.kind === "forecast").map((r) => rat(r.value));
  assert.equal(e.monthEndForecastRevenue, sumRat([rat(e.actualCompletedRevenue), ...forecasts]), "month = Actual + other remaining forecasts (no subtraction)");
  assert.equal(DEC.serializeRat(DEC.ratSub(rat(pb.forecast.projectedRevenue), rat(pa.forecast.projectedRevenue))), "1000", "the future closure removed exactly its weekday forecast");
  assert.equal(e.forecastEligibleRemainingDays, pb.forecast.engine.forecastEligibleRemainingDays - 1);
  assert.deepEqual(pa.projection.afterActual, pb.projection.afterActual, "future closure keeps its cost placement (afterActual cost identical)");
  assert.equal(pa.projection.globalEmployerCost, "30000"); assert.equal(pa.projection.fixed, "3000");
});

// ── CDA-09 / CDA-10 allocation and the key timing test ──────────────────────
test("CD-AT07 five completed closures in a 30-day month: entitlement 30,000 / 3,000 kept; closures carry 0; 25 eligible dates carry 1,200 / 120; exact reconciliation", () => {
  const cl = ["2026-09-05", "2026-09-12", "2026-09-19", "2026-09-26", "2026-09-30"];
  const inp = september("2026-10-01", cl);
  const rep = parity("report", (P) => P.productMonthReport(inp, { kind: "closed_month", month: "2026-09" }));
  assert.equal(rep.actual.labor.globalEmployerCost.value, "30000"); assert.equal(rep.actual.fixedAccrual.regular, "3000");
  assert.equal(rep.actual.costAllocation.allocationEligibleDays, 25); assert.deepEqual(rep.actual.costAllocation.completedClosureDates, cl);
  const pl = placementsOf(inp, "2026-09");
  for (const [d, p] of pl) assert.deepEqual([DEC.serializeRat(p.global), DEC.serializeRat(p.fixedRegular)], cl.includes(d) ? ["0", "0"] : ["1200", "120"], d);
  assert.equal(sumRat(pl.map(([, p]) => p.global)), "30000"); assert.equal(sumRat(pl.map(([, p]) => p.fixedRegular)), "3000");
  const dm = parity("daily", (P) => P.productDailyMetrics(inp, { from: "2026-09-01", to: "2026-09-30" }));
  assert.equal(dm.find((m) => m.date === "2026-09-05").globalLaborCost, 0); assert.equal(dm.find((m) => m.date === "2026-09-06").globalLaborCost, 1200);
});

test("CD-AT08 / CD-AT09 KEY TIMING (one fixture, clock advanced only): a recorded future closure keeps its placement until it completes; then only that month redistributes; entitlement and calendar definitions unchanged", () => {
  const cl = ["2026-09-05", "2026-09-20"];
  const allRows = [...dates("2026-07-01", "2026-08-31").map((d) => full(d)), ...september("2026-10-01", cl).rows]; // the same stored rows and ledger for both clocks
  const at = (asOf) => withStates(inputs(allRows.filter((r) => r.date < asOf), { config: G30, fixed: F3, asOf }), closed(...cl));
  // 1) asOf Sep 10: Sep 5 completed, Sep 20 future — denominator 29, Sep 20 still placed, but no forecast revenue
  const early = at("2026-09-10");
  const p1 = new Map(placementsOf(early, "2026-09"));
  assert.equal(DEC.serializeRat(p1.get("2026-09-20").global), "30000/29"); assert.equal(DEC.serializeRat(p1.get("2026-09-05").global), "0");
  assert.equal(DEC.serializeRat(p1.get("2026-09-06").global), "30000/29");
  const r1 = SERVER.productMonthReport(early, { kind: "open_month", month: "2026-09" });
  assert.equal(r1.actual.labor.globalEmployerCost.value, "240000/29", "8 eligible completed dates × 30000/29");
  const f1 = SERVER.productMonthProjection(early, r1, { nowMs: nowMsFor("2026-09-10") });
  assert.equal(f1.forecast.engine.remainingDates.find((r) => r.date === "2026-09-20").value, "0", "future closure: zero forecast immediately");
  assert.equal(f1.projection.globalEmployerCost, "30000");
  // 2) only the clock advances to Sep 21: Sep 20 completed — denominator 28, Sep 20 carries 0, the rest 30000/28
  const late = at("2026-09-21");
  const p2 = new Map(placementsOf(late, "2026-09"));
  assert.equal(DEC.serializeRat(p2.get("2026-09-20").global), "0"); assert.equal(DEC.serializeRat(p2.get("2026-09-06").global), "7500/7");
  assert.equal(sumRat([...p2.values()].map((p) => p.global)), "30000", "entitlement preserved exactly");
  const r2 = SERVER.productMonthReport(late, { kind: "open_month", month: "2026-09" });
  assert.equal(r2.actual.revenue.value, "18000", "Sep 20 is now Actual — as its explicit zero, counted once");
  assert.equal(r2.window.recognizedDays, 20, "calendar counter = completed calendar days (definition unchanged)");
  assert.equal(r2.actual.costAllocation.allocationEligibleDays, 18, "allocation counter is separate: 20 − 2 completed closures");
  assert.equal(r2.actual.labor.globalEmployerCost.value, "135000/7", "18 × 30000/28");
  const f2 = SERVER.productMonthProjection(late, r2, { nowMs: nowMsFor("2026-09-21") });
  assert.ok(!f2.forecast.engine.remainingDates.some((r) => r.date === "2026-09-20"), "a completed closure is not forecast again");
  assert.equal(f2.projection.globalEmployerCost, "30000", "month entitlement unchanged");
  // exact month reconciliation: Actual window + afterActual = entitlement
  assert.equal(sumRat([rat(r2.actual.labor.globalEmployerCost.value), rat(f2.projection.afterActual.globalEmployerCost)]), "30000");
});

test("CD boundary: a closure dated TODAY is still future (allocation-eligible, zero forecast); it becomes completed exactly when the business date moves past it", () => {
  const cl = ["2026-09-15"];
  const rows = september("2026-10-01", cl).rows;
  const today = withStates(inputs(rows.filter((r) => r.date < "2026-09-15"), { config: G30, fixed: F3, asOf: "2026-09-15" }), closed(...cl));
  assert.equal(DEC.serializeRat(new Map(placementsOf(today, "2026-09")).get("2026-09-15").global), "1000");
  const f = SERVER.productMonthProjection(today, SERVER.productMonthReport(today, { kind: "open_month", month: "2026-09" }), { nowMs: nowMsFor("2026-09-15") }).forecast.engine;
  assert.deepEqual(f.remainingDates[0], { date: "2026-09-15", kind: "declared_closure", value: "0" });
  assert.ok(!f.warnings.includes("partial_current_day"), "a closed current day is not a partial operating day");
  const next = withStates(inputs(rows.filter((r) => r.date < "2026-09-16"), { config: G30, fixed: F3, asOf: "2026-09-16" }), closed(...cl));
  assert.equal(DEC.serializeRat(new Map(placementsOf(next, "2026-09")).get("2026-09-15").global), "0");
});

test("CD-AT10 / CDA-16 a retroactive closure (and its reopening) recomputes only its own month; adjacent months byte-identical; reopening does not resurrect revenue", () => {
  const rows = [...dates("2026-08-01", "2026-10-04").map((d) => full(d))];
  const base = inputs(rows, { config: G30, fixed: F3, asOf: "2026-10-05" });
  const withC = withStates(base, closed("2026-09-15"));
  const rows0 = rows.map((r) => (r.date === "2026-09-15" ? { ...r, sales: "0" } : r));
  const closedZero = withStates({ ...base, rows: rows0 }, closed("2026-09-15"));
  for (const m of [{ kind: "closed_month", month: "2026-08" }, { kind: "open_month", month: "2026-10" }]) {
    assert.equal(ser(SERVER.productMonthReport(closedZero, m)), ser(SERVER.productMonthReport(base, m)), m.month + " byte-identical");
  }
  const sep = SERVER.productMonthReport(closedZero, { kind: "closed_month", month: "2026-09" });
  assert.deepEqual(sep.actual.costAllocation.completedClosureDates, ["2026-09-15"]); assert.equal(sep.actual.labor.globalEmployerCost.value, "30000");
  // nonzero revenue on a declared closure is a contradiction (invalid) until the closure action zeroes it (CDA-02)
  const contradicted = SERVER.productMonthReport(withC, { kind: "closed_month", month: "2026-09" });
  assert.equal(contradicted.actual.operatingProfit.state, "invalid_components");
  assert.ok(contradicted.flags.some((f) => f.code === "closed_day_has_recorded_values" && f.date === "2026-09-15"));
  // reopening = structured cleared: the date is an ordinary active explicit zero; old revenue is not restored
  const reopened = withStates({ ...base, rows: rows0 }, { "2026-09-15": { status: "cleared", reasonCode: null } });
  const r = SERVER.productMonthReport(reopened, { kind: "closed_month", month: "2026-09" });
  assert.deepEqual(r.actual.costAllocation.completedClosureDates, []); assert.equal(r.actual.revenue.value, "29000", "the zero stays a zero");
  assert.deepEqual(r.coverage.revenue.closedDays, []);
});

test("CD-AT11 / CDA-08 a completed closure keeps its recorded purchases 400, payroll 200 and other expense 50 on its date and in totals; no contradiction", () => {
  const asOf = "2026-09-11";
  const i = september(asOf, ["2026-09-05"]);
  const rows = i.rows.map((r) => (r.date === "2026-09-05" ? { ...r, sales: "0", supplier_payments: { s1: "400" }, payroll: "200", other_expense: "50" } : r));
  const inp = { ...i, rows };
  const rep = SERVER.productMonthReport(inp, { kind: "open_month", month: "2026-09" });
  assert.equal(rep.actual.purchases.value, "3100"); assert.equal(rep.actual.hourlyLabor.value, "1100"); assert.equal(rep.actual.otherExpense.value, "50");
  assert.ok(!rep.flags.some((f) => f.code === "closed_day_has_recorded_values"), "costs alone are no contradiction");
  assert.equal(rep.actual.operatingProfit.state, "complete");
  const dm = SERVER.productDailyMetrics(inp, { from: "2026-09-05", to: "2026-09-05" })[0];
  assert.deepEqual([dm.revenue, dm.hourlyLaborCost, dm.globalLaborCost, dm.laborCost, dm.foodCost], [0, 200, 0, 200, 400]);
});

// ── CDA-11 / CDA-12 effective segments ──────────────────────────────────────
const V = (id, from, rec, glob = {}, fixed = {}, rent = { mode: "none" }, royalty = { mode: "none" }) => ({ versionId: id, effectiveFrom: from, recordedAt: rec, basis: "recorded",
  globalEmployees: Object.entries(glob).map(([k, v]) => ({ employeeKey: k, kind: "authoritative_employer_cost", monthlyAmount: v, sourceSystem: "marjin_employee_config", ingestionMethod: "manual" })),
  fixedItems: Object.entries(fixed).map(([k, v]) => ({ itemKey: k, monthlyAmount: v })), rent, royalty });
const TL = (...versions) => ({ versions, timelineSource: "persisted", vatBasis: "net_of_vat" });
const placeAll = (tl, month, asOf, cl) => dates(month + "-01", BROWSER.finance.businessDate.monthBounds(month).last).map((d) => [d, CT.dayPlacement(tl, d, { asOfBusinessDate: asOf, closedDates: cl })]);

test("CD-AT15 A/B effective segments in one month with completed and future closures: entitlement first, each segment excludes only its completed closures", () => {
  const tl = TL(V("A", "0000-01-01", 1, { e1: "30000" }), V("B", "2026-09-16", 2, { e1: "60000" }));
  const alloc = CT.allocateMonth(CT.resolveTimeline(tl), "2026-09", { asOfBusinessDate: "2026-09-20", closedDates: ["2026-09-05", "2026-09-18", "2026-09-25"] });
  assert.deepEqual(alloc.segments.map((s) => [s.versionId, s.from, s.to, DEC.serializeRat(s.entitlement.global), s.eligibleDates.length, s.completedClosureDates]),
    [["A", "2026-09-01", "2026-09-15", "15000", 14, ["2026-09-05"]], ["B", "2026-09-16", "2026-09-30", "30000", 14, ["2026-09-18"]]]);
  const pl = new Map(placeAll(tl, "2026-09", "2026-09-20", ["2026-09-05", "2026-09-18", "2026-09-25"]));
  assert.equal(DEC.serializeRat(pl.get("2026-09-15").global), "7500/7"); assert.equal(DEC.serializeRat(pl.get("2026-09-16").global), "15000/7");
  assert.equal(DEC.serializeRat(pl.get("2026-09-25").global), "15000/7", "future closure still placed");
  assert.equal(sumRat([...pl.values()].map((p) => p.global)), "45000");
});

test("CD-AT16 an employee from Sep 15 (segment Sep 15–30): only the segment entitlement exists; nothing before Sep 15; a completed closure changes distribution only", () => {
  const tl = TL(V("pre", "0000-01-01", 1, {}), V("emp", "2026-09-15", 2, { e1: "30000" }));
  const pl = placeAll(tl, "2026-09", "2026-09-25", ["2026-09-20"]);
  for (const [d, p] of pl) if (d < "2026-09-15") assert.equal(DEC.serializeRat(p.global), "0", d);
  assert.equal(DEC.serializeRat(new Map(pl).get("2026-09-16").global), "3200/3", "16000 / 15 eligible dates");
  assert.equal(DEC.serializeRat(new Map(pl).get("2026-09-20").global), "0");
  assert.equal(sumRat(pl.map(([, p]) => p.global)), "16000", "30000 × 16/30");
});

test("CD-AT17 / CDA-12 closed pre-activation (uncovered) dates stay unavailable: a closure never manufactures a cost basis or R-17 coverage", () => {
  const tl = TL(V("late", "2026-09-15", 1, { e1: "30000" }, { f1: "3000" }));
  const inpDays = SERVER.productDays(inputs(dates("2026-09-01", "2026-09-19").map((d) => full(d, d < "2026-09-15" ? { sales: "0" } : {})), { asOf: "2026-09-20" }), { from: "2026-09-01", to: "2026-09-30" }).days;
  const rep = RP.computePeriodReport(inpDays, tl, BROWSER.policy.purchaseBasis.productPurchaseBasis(), BROWSER.policy.laborSource.productLaborSource(), { kind: "open_month", month: "2026-09", asOfBusinessDate: "2026-09-20" },
    { operatingCalendar: { source: "fixture", closedDates: dates("2026-09-01", "2026-09-14") } });
  assert.equal(rep.actual.labor.globalEmployerCost.state, "incomplete_components"); assert.equal(rep.actual.fixedAccrual.state, "incomplete_components");
  assert.ok(rep.actual.fixedAccrual.issues.some((i) => i.reason === "cost_config_absent"));
  assert.deepEqual(CT.dayPlacement(tl, "2026-09-03", { asOfBusinessDate: "2026-09-20", closedDates: ["2026-09-03"] }), { state: "uncovered" });
});

test("CD-AT18 R-17 absent / empty fixed list stays a known complete zero (the no-eligible mechanism does not turn it missing)", () => {
  const all = dates("2026-09-01", "2026-09-30");
  for (const fixed of [null, []]) {
    const i = withStates(inputs(all.map((d) => full(d, { sales: "0", supplier_payments: { s1: "0" }, payroll: "0" })), { config: G30, fixed, asOf: "2026-10-01" }), closed(...all));
    const rep = SERVER.productMonthReport(i, { kind: "closed_month", month: "2026-09" });
    assert.deepEqual([rep.actual.fixedAccrual.state, rep.actual.fixedAccrual.regular], ["complete", "0"], String(fixed));
  }
});

test("CD-AT19 / CDA-13 fixed rent and items use the completed-closure placement; percentage rent / royalty stay rate × revenue (0 on a closed zero day, never redistributed)", () => {
  const tl = TL(V("v", "0000-01-01", 1, {}, { f1: "3000" }, { mode: "fixed", monthlyAmount: "6000" }, { mode: "pct", ratePct: "5" }));
  const cl = ["2026-09-05"];
  const days = SERVER.productDays(withStates(inputs(dates("2026-09-01", "2026-09-30").map((d) => full(d, cl.includes(d) ? { sales: "0" } : {})), { asOf: "2026-10-01" }), closed(...cl)), { from: "2026-09-01", to: "2026-09-30" }).days;
  const rep = RP.computePeriodReport(days, tl, BROWSER.policy.purchaseBasis.productPurchaseBasis(), BROWSER.policy.laborSource.productLaborSource(), { kind: "closed_month", month: "2026-09", asOfBusinessDate: "2026-10-01" }, { operatingCalendar: { source: "fixture", closedDates: cl } });
  assert.deepEqual([rep.actual.fixedAccrual.regular, rep.actual.fixedAccrual.rentFixed, rep.actual.fixedAccrual.royaltyPct], ["3000", "6000", "1450"], "royalty = 5% × 29,000 (the closed day's 0 revenue adds 0)");
  const p = new Map(placeAll(tl, "2026-09", "2026-10-01", cl));
  assert.deepEqual([DEC.serializeRat(p.get("2026-09-05").rentFixed), DEC.serializeRat(p.get("2026-09-06").rentFixed)], ["0", "6000/29"]);
  const pct = TL(V("p", "0000-01-01", 1, {}, {}, { mode: "pct", ratePct: "10" }));
  const rp = RP.computePeriodReport(days, pct, BROWSER.policy.purchaseBasis.productPurchaseBasis(), BROWSER.policy.laborSource.productLaborSource(), { kind: "closed_month", month: "2026-09", asOfBusinessDate: "2026-10-01" }, { operatingCalendar: { source: "fixture", closedDates: cl } });
  assert.deepEqual([rp.actual.fixedAccrual.rentPct, rp.actual.fixedAccrual.rentFixed], ["2900", "0"], "percentage rent is never treated as a fixed monthly amount");
});

test("CD-AT20 / CDA-22 an exact 100 over three eligible dates reconciles before and after one becomes a completed closure; the aggregate is the canonical 100, not a sum of rounded days", () => {
  const tl = TL(V("a", "0000-01-01", 1, {}), V("b", "2026-09-28", 2, {}, { f1: "1000" }));
  const before = placeAll(tl, "2026-09", "2026-09-28", ["2026-09-28"]).filter(([d]) => d >= "2026-09-28");
  assert.deepEqual(before.map(([, p]) => DEC.serializeRat(p.fixedRegular)), ["100/3", "100/3", "100/3"]);
  assert.equal(sumRat(before.map(([, p]) => p.fixedRegular)), "100");
  const after = placeAll(tl, "2026-09", "2026-09-29", ["2026-09-28"]).filter(([d]) => d >= "2026-09-28");
  assert.deepEqual(after.map(([, p]) => DEC.serializeRat(p.fixedRegular)), ["0", "50", "50"]);
  const money = BROWSER.presenters.money;
  assert.equal(before.map(([, p]) => money.formatShekel(DEC.serializeRat(p.fixedRegular))).join("+"), "₪33+₪33+₪33", "rounded days would show 99 …");
  const acc = CT.accrueWindow(tl, dates("2026-09-01", "2026-09-30"), new Map(), { asOfBusinessDate: "2026-09-28", closedDates: ["2026-09-28"] });
  assert.equal(money.formatShekel(DEC.serializeRat(acc.fixedRegular)), "₪100", "… the aggregate is presented from the canonical total");
});

// ── CDA-14 / CDA-15 no eligible allocation dates ─────────────────────────────
test("CD-AT21 every date of a completed month closed: no division, no calendar fallback, no zero — daily placement typed unavailable; entitlement, entered costs and the aggregate profit stay visible", () => {
  const all = dates("2026-09-01", "2026-09-30");
  const rows = all.map((d) => full(d, { sales: "0", supplier_payments: { s1: d === "2026-09-10" ? "400" : "0" }, payroll: "0" }));
  const inp = withStates(inputs(rows, { config: G30, fixed: F3, asOf: "2026-10-01" }), closed(...all));
  const rep = parity("report", (P) => P.productMonthReport(inp, { kind: "closed_month", month: "2026-09" }));
  assert.equal(rep.actual.labor.globalEmployerCost.value, "30000"); assert.equal(rep.actual.fixedAccrual.regular, "3000");
  assert.equal(rep.actual.costAllocation.dayPlacement, "no_eligible_allocation_days");
  assert.equal(rep.actual.costAllocation.placementUnavailableDates.length, 30); assert.equal(rep.actual.costAllocation.allocationEligibleDays, 0);
  assert.equal(rep.actual.purchases.value, "400", "entered costs kept");
  assert.deepEqual(rep.actual.operatingProfit, { state: "complete", value: "-33400", issues: [] }, "aggregate profit determinable: 0 − 400 − 0 − 30000 − 3000");
  const dm = parity("daily", (P) => P.productDailyMetrics(inp, { from: "2026-09-01", to: "2026-09-30" }));
  for (const m of dm) assert.deepEqual([m.globalLaborCost, m.laborCostComplete], [null, false], m.date + " no daily placement");
  assert.equal(dm.find((m) => m.date === "2026-09-10").foodCost, 400);
  assert.deepEqual(CT.dayPlacement(SERVER.productTimeline(inp), "2026-09-10", { asOfBusinessDate: "2026-10-01", closedDates: all }), { state: "no_eligible_allocation_days", versionId: "compat:current-config", from: "2026-09-01", to: "2026-09-30" });
});

test("CD-AT22 a completed segment with zero eligible dates keeps its entitlement without crossing into the other segment", () => {
  const tl = TL(V("A", "0000-01-01", 1, { e1: "30000" }), V("B", "2026-09-11", 2, { e1: "30000" }));
  const cl = dates("2026-09-01", "2026-09-10");
  const alloc = CT.allocateMonth(CT.resolveTimeline(tl), "2026-09", { asOfBusinessDate: "2026-10-01", closedDates: cl });
  assert.deepEqual(alloc.segments.map((s) => [s.versionId, s.state, DEC.serializeRat(s.entitlement.global)]), [["A", "no_eligible_allocation_days", "10000"], ["B", "allocated", "20000"]]);
  const pl = new Map(placeAll(tl, "2026-09", "2026-10-01", cl));
  assert.equal(pl.get("2026-09-05").state, "no_eligible_allocation_days"); assert.equal(DEC.serializeRat(pl.get("2026-09-11").global), "1000", "B allocates only its own 20000 over its 20 dates");
  const acc = CT.accrueWindow(tl, dates("2026-09-01", "2026-09-30"), new Map(), { asOfBusinessDate: "2026-10-01", closedDates: cl });
  assert.equal(DEC.serializeRat(acc.global), "30000"); assert.equal(acc.allocation.aggregateDeterminable, true);
  // a window that cuts the no-eligible segment has no determinable share: typed, never guessed
  const part = CT.accrueWindow(tl, dates("2026-09-05", "2026-09-30"), new Map(), { asOfBusinessDate: "2026-10-01", closedDates: cl });
  assert.equal(part.allocation.aggregateDeterminable, false);
});

// ── CDA-18 missing revenue ───────────────────────────────────────────────────
test("CD-AT25 (core) completed revenue missing on two dates: exact dates, partial totals and forecast, never zero-imputed", () => {
  const history = dates("2026-07-01", "2026-08-31").map((d) => full(d));
  const cur = september("2026-09-20").rows.filter((r) => r.date !== "2026-09-07" && r.date !== "2026-09-12");
  const inp = inputs([...history, ...cur], { config: G30, fixed: F3, asOf: "2026-09-20" });
  const rep = SERVER.productMonthReport(inp, { kind: "open_month", month: "2026-09" });
  assert.deepEqual(rep.coverage.revenue.missingDays, ["2026-09-07", "2026-09-12"]); assert.equal(rep.actual.revenue.complete, false); assert.equal(rep.actual.revenue.value, "17000");
  assert.equal(rep.actual.operatingProfit.state, "incomplete_components");
  const p = parity("forecast", (P) => P.productMonthProjection(inp, P.productMonthReport(inp, { kind: "open_month", month: "2026-09" }), { nowMs: nowMsFor("2026-09-20") }).forecast);
  assert.equal(p.state, "partial"); assert.deepEqual(p.missingRevenueDates, ["2026-09-07", "2026-09-12"]);
  assert.equal(p.engine.actualCompletedRevenue, "17000", "missing dates contribute nothing — not a zero observation, not imputed");
  assert.ok(p.warnings.includes("missing_completed_days"));
});

// ── CDA-21 / CD-AT29 shared implementation ───────────────────────────────────
test("CD-AT29 identical raw rows, ledger and clock through the server loader and the generated browser product: reports, samples, both eligibility sets, allocations, states and projection serialize equivalently", async () => {
  const rows = [...dates("2026-07-01", "2026-09-14").map((d) => full(d, d === "2026-09-08" ? { sales: "0" } : {}))];
  const ledger = { "2026-09-08": { state: { status: "active", reasonCode: "closure" } }, "2026-09-22": { state: { status: "active", reasonCode: "closure" } }, "2026-09-10": { state: { status: "active", reasonCode: "holiday" } } };
  const db = seedRaw(makeDb(), { entries: env(rows), config: env(G30), fixed: env(F3) });
  db.seed(`tenants/${T}/entry_exceptions/${B}`, ledger);
  const now = nowMsFor("2026-09-15");
  const server = await CI.loadCanonicalInputs(db, T, B, { site: "t", nowMs: now, need: { config: true, fixed: true, exceptions: true } });
  const decoded = BROWSER.product.decodeExceptionLedger(ledger);
  const browserIn = { rows, config: BROWSER.product.decodeEnvelope(env(G30), "object"), fixed: BROWSER.product.decodeEnvelope(env(F3), "array"), asOfBusinessDate: "2026-09-15", exceptionStates: decoded.value };
  const view = (P, i) => { const rep = P.productMonthReport(i, { kind: "open_month", month: "2026-09" }); const pr = P.productMonthProjection(i, rep, { nowMs: now });
    return stableJson({ rep: ser(rep), pr: ser(pr), cal: P.productClosureCalendar(i), dm: P.productDailyMetrics(i, { from: "2026-09-01", to: "2026-09-14" }) }); };
  const s = view(SERVER, server);
  assert.equal(view(BROWSER.product, browserIn), s); assert.equal(view(COMMITTED.product, browserIn), s);
  const pr = SERVER.productMonthProjection(server, SERVER.productMonthReport(server, { kind: "open_month", month: "2026-09" }), { nowMs: now });
  assert.deepEqual([pr.forecast.engine.completedClosureDates, pr.forecast.engine.futureClosureDates], [["2026-09-08"], ["2026-09-22"]], "two eligibility views of one calendar");
  const canonical = CM.canonicalMonthProjection(server, CM.canonicalMonthReport(server, { kind: "open_month", month: "2026-09" }).report, { nowMs: now });
  assert.equal(ser(canonical.forecast), ser(pr.forecast)); assert.equal(canonical.provenance.product, "MARJIN_PRODUCT/2"); assert.equal(canonical.provenance.fin, "MARJIN_FIN/3"); assert.equal(canonical.provenance.labor, "MARJIN_LABOR/3");
  assert.equal(pr.forecast.formulaId, "REV_FORECAST/v2");
});

test("TD-CDM1-2 cost-reading callers get the one decoded ledger: the B1 repositories (need.exceptions:false) place monthly costs with the declared closures; an unreadable ledger is typed, never 'no closures'", async () => {
  const rows = dates("2026-09-01", "2026-09-14").map((d) => full(d, d === "2026-09-08" ? { sales: "0" } : {}));
  const db = seedRaw(makeDb(), { entries: env(rows), config: env(G30), fixed: env(F3) });
  db.seed(`tenants/${T}/entry_exceptions/${B}`, { "2026-09-08": { state: { status: "active", reasonCode: "closure" } } });
  const rec = recordingDb(db);
  const i = await CI.loadCanonicalInputs(rec, T, B, { site: "dailyMetricsRepo.getDailyMetrics", nowMs: nowMsFor("2026-09-15"), need: { config: true, fixed: false, exceptions: false } });
  assert.ok(rec.reads.includes(`tenants/${T}/entry_exceptions/${B}`)); assert.equal(i.exceptionsState, "present");
  const series = CM.canonicalDailySeries(i, { from: "2026-09-01", to: "2026-09-14" });
  assert.equal(series.days.find((d) => d.date === "2026-09-08").globalLaborCost, 0); assert.equal(series.days.find((d) => d.date === "2026-09-09").globalLaborCost, 1034.4827586207);
  const noCost = await CI.loadCanonicalInputs(recordingDb(db), T, B, { site: "t", nowMs: nowMsFor("2026-09-15"), need: { config: false, fixed: false, exceptions: false } });
  assert.equal(noCost.exceptionsState, "not_loaded", "no monthly cost ⇒ no ledger read");
  db.seed(`tenants/${T}/entry_exceptions/${B}`, "corrupt");
  const bad = await CI.loadCanonicalInputs(db, T, B, { site: "t", nowMs: nowMsFor("2026-09-15"), need: { config: true, fixed: true, exceptions: false } });
  const rep = CM.canonicalMonthReport(bad, { kind: "open_month", month: "2026-09" }).report;
  assert.equal(rep.actual.costAllocation.dayPlacement, "closure_calendar_unreadable");
  assert.equal(rep.actual.labor.globalEmployerCost.state, "invalid_components"); assert.equal(rep.actual.operatingProfit.state, "invalid_components");
  assert.ok(CM.canonicalDailySeries(bad, { from: "2026-09-01", to: "2026-09-14" }).days.every((d) => d.globalLaborCost === null));
  assert.throws(() => SERVER.productMonthProjection(bad, rep, { nowMs: nowMsFor("2026-09-15") }), (e) => e.name === "FinanceContractError");
  assert.equal(CM.canonicalMonthProjection(bad, rep, { nowMs: nowMsFor("2026-09-15") }).forecast.state, "unavailable");
});

test("Leap February 2028 and month transition: one completed closure ⇒ 28 eligible dates carry 29,000/28; the closure on the month's last day changes only that month", () => {
  const feb = dates("2028-02-01", "2028-02-29");
  const inp = withStates(inputs(feb.map((d) => full(d, d === "2028-02-29" ? { sales: "0" } : {})), { config: configWithGlobal("29000"), fixed: fixedItems("2900"), asOf: "2028-03-01" }), closed("2028-02-29"));
  const rep = SERVER.productMonthReport(inp, { kind: "closed_month", month: "2028-02" });
  assert.deepEqual([rep.actual.labor.globalEmployerCost.value, rep.actual.fixedAccrual.regular, rep.actual.costAllocation.allocationEligibleDays], ["29000", "2900", 28]);
  const pl = new Map(placementsOf(inp, "2028-02"));
  assert.deepEqual([DEC.serializeRat(pl.get("2028-02-28").global), DEC.serializeRat(pl.get("2028-02-29").global)], ["7250/7", "0"]);
  const mar = SERVER.productMonthReport(inp, { kind: "open_month", month: "2028-03" });
  assert.equal(mar.actual.costAllocation.completedClosureDates.length, 0);
});

test("CDA-20 calendar counters stay calendar measures; allocation / forecast counters are separately named", () => {
  const inp = september("2026-09-15", ["2026-09-08"]);
  const withFuture = withStates(inp, { ...inp.exceptionStates, ...closed("2026-09-22") });
  const r = SERVER.productMonthReport(withFuture, { kind: "open_month", month: "2026-09" });
  assert.deepEqual([r.window.recognizedDays, r.coverage.day.expectedDays, r.actual.costAllocation.allocationEligibleDays], [14, 13, 13]);
  const f = SERVER.productMonthProjection(withFuture, r, { nowMs: nowMsFor("2026-09-15") }).forecast.engine;
  assert.equal(f.forecastEligibleRemainingDays, 15, "16 remaining calendar dates − 1 future closure");
  assert.ok(!("recognizedDays" in f) && !("daysLeft" in f), "no calendar counter is redefined by the forecast");
});
