// LABOR-AVAIL — Dashboard labor from available recorded data, consistent with the P&L.
// Before: any operating day without payroll made the core's employer cost incomplete and the Dashboard
// labor tile, labor % and breakdown row showed "—", while the P&L (PNL-AVAIL) already showed recorded
// hourly + salaried accrual. Now both views use ONE helper: complete → the core's employer cost; missing
// payroll days → recorded hourly employer cost + the core's salaried accrual, each counted once, with a
// quiet basis line. No hourly payroll recorded → "—" (never ₪0, salaried share alone is not the labor
// cost). Labor % only over a valid, non-zero recorded revenue. Synthetic rows only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadFinance, loadSeam, present, ledgerOf, row, srcOf } from "../support/c1-seam.mjs";

const F = await loadFinance();
const C = loadSeam();
const AS_OF = "2026-09-29", NOW = Date.parse("2026-09-29T09:00:00Z"), MONTH = "2026-09";
const DAYS = Array.from({ length: 28 }, (_, i) => `2026-09-${String(i + 1).padStart(2, "0")}`);
let seq = 1;
const uid = () => `00000000-0000-4000-8000-${String(seq++).padStart(12, "0")}`;
const day = (d, o = {}) => row(d, { sales: "1000", deliveries: "0", other_income: "0", supplier_payments: { s1: "300" }, payroll: "100", other_expense: "0", ...o }, uid());
const noRev = { sales: "", deliveries: "", other_income: "" };
const SALARIED = present({ employees: [{ id: "g1", name: "g", type: "global", monthlySalary: 3000 }] });   // 3000 / 30 per day
const HOURLY_ONLY = present({ employees: [] });
const src = (rows, config = SALARIED, extra = {}) => ({ ...srcOf({ rows, asOf: AS_OF, config }), ...extra });
const dash = (s) => C.dashboard(F, s, { nowMs: NOW, lastYearSales: null });
const pnl = (s) => C.pnl(F, s, MONTH, null);
const bdLabor = (dv) => dv.breakdown.find((b) => b.key === "labor");
/** payroll recorded on the first `n` days only (the rest of the days have revenue and purchases) */
const partialPayroll = (n) => DAYS.map((d, i) => day(d, i < n ? {} : { payroll: "" }));

test("LABOR-AVAIL-01 complete month: the core's employer cost and labor % exactly as before; no basis line", () => {
  const dv = dash(src(DAYS.map((d) => day(d))));
  const A = dv.report.actual;
  assert.equal(A.labor.employerCost.state, "complete");
  assert.equal(dv.labor.text, F.presenters.money.formatTypedAmount(A.labor.employerCost));
  assert.equal(dv.labor.text, "₪5,600");                              // 28 × 100 + 2800
  assert.equal(dv.laborPct.text, F.presenters.percent.formatPercent(A.labor.employerCostPct));
  assert.equal(dv.laborPct.text, "20.0%");
  assert.equal(dv.labor.partial, false); assert.equal(dv.labor.basisText, null);
  assert.equal(bdLabor(dv).text, "₪5,600");
  const p = pnl(src(DAYS.map((d) => day(d))));
  assert.equal(p.rows.labor.text, dv.labor.text); assert.equal(p.laborPct.text, dv.laborPct.text);
});

test("LABOR-AVAIL-02 partial payroll + salaried: recorded hourly + salaried accrual once; % on recorded revenue; Dashboard = P&L", () => {
  const s = src(partialPayroll(20));
  const dv = dash(s), p = pnl(s), A = dv.report.actual;
  assert.equal(A.labor.employerCost.state, "incomplete_components", "the shared core still withholds the complete-month value");
  assert.equal(A.hourlyLabor.value, "2000"); assert.equal(A.labor.globalEmployerCost.value, "2800");
  assert.equal(dv.labor.text, "₪4,800");                              // 20 × 100 + 2800, the salaried share once
  assert.equal(dv.labor.partial, true);
  assert.equal(dv.laborPct.text, "17.1%"); assert.ok(Math.abs(dv.laborPct.num - 4800 / 28000 * 100) < 1e-9);
  assert.equal(dv.laborPct.band, "ok");                               // goal 27
  assert.equal(dv.labor.basisText, "מחושב מהנתונים שהוזנו: עלות שעתית ב-20/28 ימים שהוזנו + שכר גלובלי לפי ההגדרות");
  assert.doesNotMatch(dv.labor.text, /חלקי/);
  assert.equal(bdLabor(dv).text, "₪4,800");
  // the P&L shows the same amount and percentage (one helper)
  assert.equal(p.rows.labor.amount, "4800"); assert.equal(p.rows.labor.text, dv.labor.text); assert.equal(p.laborPct.text, dv.laborPct.text);
  assert.match(p.available.basisText, /עלות עובדים: עלות שעתית ב-20\/28 ימים שהוזנו \+ שכר גלובלי לפי ההגדרות\./);
  // exactly the core's own employer cost when the missing payroll days carry an explicit 0
  const z = dash(src(DAYS.map((d, i) => day(d, i < 20 ? {} : { payroll: "0" }))));
  assert.equal(z.report.actual.labor.employerCost.state, "complete");
  assert.equal(z.report.actual.labor.employerCost.value, "4800");
  assert.equal(z.labor.text, dv.labor.text); assert.equal(z.labor.basisText, null);
  // the other tiles are unchanged by this fix
  assert.equal(dv.purchasesPct.text, "30.0%"); assert.equal(dv.projectedLabor, "—"); assert.equal(dv.projectedProfit.text, "—");
});

test("LABOR-AVAIL-03 hourly only (no salaried employees): recorded hourly; the basis does not mention a salaried share", () => {
  const dv = dash(src(partialPayroll(14), HOURLY_ONLY));
  assert.equal(dv.labor.text, "₪1,400"); assert.equal(dv.laborPct.text, "5.0%");
  assert.equal(dv.labor.basisText, "מחושב מהנתונים שהוזנו: עלות שעתית ב-14/28 ימים שהוזנו");
  assert.equal(pnl(src(partialPayroll(14), HOURLY_ONLY)).rows.labor.amount, "1400");
});

test("LABOR-AVAIL-04 partial revenue AND partial payroll: % over recorded revenue, named in the basis", () => {
  const rows = DAYS.map((d, i) => day(d, { ...(i < 20 ? {} : { payroll: "" }), ...(d >= "2026-09-25" ? noRev : {}) }));
  const dv = dash(src(rows)), p = pnl(src(rows));
  assert.equal(dv.report.actual.revenue.value, "24000");
  assert.equal(dv.labor.text, "₪4,800"); assert.equal(dv.laborPct.text, "20.0%");   // 4800 / 24000
  assert.equal(dv.labor.basisText, "מחושב מהנתונים שהוזנו: עלות שעתית ב-20/28 ימים שהוזנו + שכר גלובלי לפי ההגדרות; לייבור לפי ההכנסות שהוזנו (24/28 ימי הכנסה)");
  assert.equal(p.laborPct.text, dv.laborPct.text);
});

test("LABOR-AVAIL-05 no hourly payroll recorded: '—' on both views (never ₪0, salaried share alone is not shown); with and without salaried employees", () => {
  for (const cfg of [SALARIED, HOURLY_ONLY]) {
    const s = src(DAYS.map((d) => day(d, { payroll: "" })), cfg);
    const dv = dash(s), p = pnl(s);
    assert.equal(dv.labor.text, "—"); assert.equal(dv.laborPct.text, "—"); assert.equal(dv.laborPct.num, null);
    assert.equal(dv.labor.partial, false); assert.equal(dv.labor.basisText, null);
    assert.equal(bdLabor(dv).text, "—");
    assert.equal(p.rows.labor.text, "—"); assert.equal(p.laborPct.text, "—");
    assert.deepEqual([...p.available.missing], ["labor"]);
  }
});

test("LABOR-AVAIL-06 zero recorded revenue: the labor amount is shown, the % is '—' (zero denominator)", () => {
  const rows = DAYS.map((d, i) => day(d, { sales: "0", deliveries: "0", other_income: "0", ...(i < 10 ? {} : { payroll: "" }) }));
  const dv = dash(src(rows)), p = pnl(src(rows));
  assert.equal(dv.report.actual.revenue.value, "0");
  assert.equal(dv.labor.text, "₪3,800");                              // 10 × 100 + 2800
  assert.equal(dv.laborPct.text, "—"); assert.equal(dv.laborPct.num, null); assert.equal(dv.laborPct.band, "none");
  assert.equal(p.laborPct.text, "—");
  const none = dash(src(DAYS.map((d, i) => day(d, { ...noRev, ...(i < 10 ? {} : { payroll: "" }) }))));
  assert.equal(none.labor.text, "₪3,800"); assert.equal(none.laborPct.text, "—", "no recorded revenue: no basis");
});

test("LABOR-AVAIL-07 malformed data stays unavailable: an invalid payroll cell, a closed-day contradiction; invalid revenue keeps the amount but not the %", () => {
  const bad = partialPayroll(20); bad[3] = day(bad[3].date, { payroll: "abc" });
  const b = dash(src(bad));
  assert.equal(b.labor.text, "—"); assert.equal(b.laborPct.text, "—"); assert.equal(bdLabor(b).text, "—");
  assert.equal(pnl(src(bad)).rows.labor.text, "—");
  const contra = src(partialPayroll(20), SALARIED, { ledger: ledgerOf(C.structuredStates({ "2026-09-05": { source: "structured", status: "active", reasonCode: "closure" } }), "2000-01-01", "2100-12-31") });
  const c = dash(contra);
  assert.deepEqual([...c.disclosure.contradictions], ["2026-09-05"]);
  assert.equal(c.labor.text, "—"); assert.equal(c.laborPct.text, "—");
  const badRev = partialPayroll(20); badRev[2] = day(badRev[2].date, { sales: "abc" });
  const r = dash(src(badRev));
  assert.equal(r.labor.text, "₪4,800", "a valid labor amount stays visible");
  assert.equal(r.laborPct.text, "—", "an invalid revenue cell is no denominator"); assert.equal(r.laborPct.num, null);
});

test("LABOR-AVAIL-08 failed / pending reads stay visible states: no labor value is produced", () => {
  const rows = partialPayroll(20);
  assert.equal(dash(srcOf({ rows, asOf: AS_OF, config: SALARIED, rowsReady: false })).status, "loading");
  assert.equal(dash(src(rows, SALARIED, { ledger: { state: "unreadable", reason: "read_failed" } })).status, "unavailable");
  assert.equal(dash(src(rows, SALARIED, { costHistory: { state: "unreadable", reason: "read_failed" } })).status, "unavailable");
  assert.equal(pnl(src(rows, SALARIED, { costHistory: { state: "unreadable", reason: "read_failed" } })).status, "unavailable");
});
