// DELIVERY-PCT — the estimated delivery cost: a configured % of the business's TOTAL recorded revenue with effective
// dates (config.deliveryCost.versions), one estimated expense line in the P&L and the Dashboard breakdown, included
// once in the bottom line / projected profit, never in revenue, purchases, Food Cost or gross profit.
// The production view models of index.html (window.MarjinC1) over the shared core. Synthetic rows only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadFinance, loadSeam, present, row, srcOf, ledgerOf } from "../support/c1-seam.mjs";
import { configWithGlobal } from "../support/b1-fixtures.mjs";

const F = await loadFinance();
const C = loadSeam();
const n = (x) => F.metrics.adapters.legacyNumber.amountToNumber(x);
const close = (a, b, m) => assert.ok(Math.abs(a - b) < 1e-6, `${m || ""} ${a} vs ${b}`);
let seq = 1;
const uid = () => `00000000-0000-4000-8000-${String(seq++).padStart(12, "0")}`;
const days = (m, k) => Array.from({ length: k }, (_, i) => `${m}-${String(i + 1).padStart(2, "0")}`);
const day = (d, o = {}) => row(d, { sales: "1000", deliveries: "200", other_income: "0", supplier_payments: { s1: "300" }, payroll: "100", other_expense: "0", ...o }, uid());
const ROWS = [...days("2026-09", 30), ...days("2026-10", 31)].map((d) => day(d));
const v = (effectiveFrom, ratePct, recordedAt = 1, versionId = effectiveFrom + ratePct) => ({ versionId, effectiveFrom, ratePct, recordedAt });
const BASE = { ...configWithGlobal("3000"), rentType: "fixed", rentFixed: 4000, hasRoyalty: false };
const cfg = (versions) => (versions === undefined ? BASE : { ...BASE, deliveryCost: { versions } });
const src = (asOf, versions, rows = ROWS, extra = {}) => ({ ...srcOf({ rows: rows.filter((r) => r.date < asOf), asOf, config: present(cfg(versions)) }), ...extra });
const pnl = (s, m, prior = null) => C.pnl(F, s, m, prior);
const dash = (s, asOf) => C.dashboard(F, s, { nowMs: Date.parse(asOf + "T08:00:00Z"), lastYearSales: null });
const bd = (dv, k) => { const x = dv.breakdown.find((b) => b.key === k); return x ? x.text : null; };

test("DLV-01 no setting: nothing changes — no delivery line, the same bottom line and projection as before", () => {
  const p = pnl(src("2026-11-01"), "2026-10");
  assert.equal(p.showDelivery, false); assert.equal(p.deliveryNote, null);
  assert.equal(p.rows.net.amount, p.report.actual.operatingProfit.value, "net = the core's operating profit");
  const d = dash(src("2026-10-20"), "2026-10-20");
  assert.equal(bd(d, "delivery"), null); assert.equal(d.delivery, null); assert.equal(d.projectedProfit.deliveryNote, null);
  assert.ok(d.breakdown.length > 0 && d.breakdown.every((b) => b.shareText !== "—"), "breakdown shares of a complete month to date are unaffected");
  assert.equal(d.projectedProfit.amount, d.projection.projection.operatingProfit);
});

test("DLV-02 14% from before the month: 14% of the TOTAL recorded revenue (sales + deliveries + other), one line, net reduced once; revenue / purchases / Food Cost / gross unchanged", () => {
  const p0 = pnl(src("2026-11-01"), "2026-10"), p = pnl(src("2026-11-01", [v("2026-09-01", "14")]), "2026-10");
  const rev = n(p.report.actual.revenue.value);
  assert.equal(rev, 31 * 1200, "total revenue incl. delivery revenue");
  assert.equal(p.showDelivery, true); assert.equal(p.deliveryLabel, "עלות משלוחים (הערכה)");
  close(n(p.rows.delivery.amount), rev * 0.14); assert.equal(p.rows.delivery.text, "₪5,208");
  assert.equal(p.rows.delivery.shareText, "14.0%"); assert.equal(p.rows.delivery.basisText, "הערכה: 14% מהפדיון");
  close(n(p.rows.net.amount), n(p0.rows.net.amount) - rev * 0.14, "the bottom line includes it once");
  assert.equal(p.deliveryNote, "כולל עלות משלוחים משוערת");
  for (const k of ["revenue", "purchases", "labor", "fixedRent", "royalty", "other"]) assert.equal(p.rows[k].text, p0.rows[k].text, k);
  assert.equal(p.gross.text, p0.gross.text, "gross profit (VD-50) unchanged"); assert.equal(p.purchasesPct.text, p0.purchasesPct.text, "Food Cost unchanged");
  assert.equal(p.rows.revenue.text, p0.rows.revenue.text, "revenue is never reduced");
});

test("DLV-03 effective dates: 10% to 14.10, 14% from 15.10 — each day at its own rate; September keeps its rate; a later version never rewrites earlier months", () => {
  const vs = [v("2026-09-01", "10"), v("2026-10-15", "14", 2)];
  const oct = pnl(src("2026-11-01", vs), "2026-10");
  close(n(oct.rows.delivery.amount), 14 * 1200 * 0.10 + 17 * 1200 * 0.14);
  assert.equal(oct.rows.delivery.basisText, "הערכה: לפי האחוז שבתוקף בכל יום (10%, 14%)");
  const sepBefore = pnl(src("2026-11-01", [v("2026-09-01", "10")]), "2026-09"), sepAfter = pnl(src("2026-11-01", vs), "2026-09");
  assert.equal(sepAfter.rows.delivery.amount, sepBefore.rows.delivery.amount); close(n(sepAfter.rows.delivery.amount), 30 * 1200 * 0.10);
  assert.equal(sepAfter.rows.net.amount, sepBefore.rows.net.amount, "September's bottom line unchanged by the October rate");
  // a same-date re-entry: the latest recording wins for that date only
  const fix = pnl(src("2026-11-01", [...vs, v("2026-10-15", "13.5", 3)]), "2026-10");
  close(n(fix.rows.delivery.amount), 14 * 1200 * 0.10 + 17 * 1200 * 0.135);
  // days before the first rate are not estimated
  const late = pnl(src("2026-11-01", [v("2026-10-20", "14")]), "2026-10");
  close(n(late.rows.delivery.amount), 12 * 1200 * 0.14);
  assert.equal(pnl(src("2026-11-01", [v("2026-10-20", "14")]), "2026-09").showDelivery, false, "no rate in force in September: no line");
  // the month-over-month change uses each month's own estimate
  const cmp = pnl(src("2026-11-01", vs), "2026-10", "2026-09");
  close(n(cmp.rows.delivery.delta), n(oct.rows.delivery.amount) - 30 * 1200 * 0.10);
});

test("DLV-04 missing revenue days: the estimate is on the recorded revenue, named in the basis; the recorded-data balance includes it; Dashboard = P&L", () => {
  const rows = ROWS.map((r) => (r.date >= "2026-10-10" && r.date <= "2026-10-12" ? day(r.date, { sales: "", deliveries: "", other_income: "" }) : r));
  const s = src("2026-10-20", [v("2026-09-01", "14")], rows);
  const p = pnl(s, "2026-10"), d = dash(s, "2026-10-20");
  close(n(p.rows.delivery.amount), 16 * 1200 * 0.14);
  assert.equal(p.rows.delivery.basisText, "הערכה: 14% מהפדיון שהוזן (16/19 ימי הכנסה)");
  const p0 = pnl(src("2026-10-20", undefined, rows), "2026-10");
  close(n(p.rows.net.amount), n(p0.rows.net.amount) - 16 * 1200 * 0.14, "balance includes the estimate");
  assert.equal(p.netLabel, "יתרה לפי הנתונים שהוזנו");
  assert.equal(bd(d, "delivery"), p.rows.delivery.text, "the Dashboard breakdown shows the same estimate");
  assert.equal(d.delivery.basisText, p.rows.delivery.basisText);
});

test("DLV-05 invalid data is never an estimate: a malformed setting or an invalid revenue cell → '—'; a malformed setting also withholds the bottom line", () => {
  for (const bad of [[{ effectiveFrom: "2026-09-01", ratePct: "abc", recordedAt: 1 }], [{ effectiveFrom: "2026-09-01", ratePct: "140", recordedAt: 1 }], [{ effectiveFrom: "x", ratePct: "14", recordedAt: 1 }]]) {
    const p = pnl(src("2026-11-01", bad), "2026-10");
    assert.equal(p.showDelivery, true); assert.equal(p.rows.delivery.text, "—"); assert.equal(p.rows.net.text, "—", JSON.stringify(bad));
    assert.equal(p.deliveryNote, "הגדרת עלות המשלוחים אינה תקינה");
  }
  const p = pnl({ ...src("2026-11-01"), config: present({ ...BASE, deliveryCost: "14%" }) }, "2026-10");
  assert.equal(p.rows.delivery.text, "—");
  const rows = ROWS.map((r, i) => (i === 40 ? day(r.date, { sales: "abc" }) : r));
  const q = pnl(src("2026-11-01", [v("2026-09-01", "14")], rows), "2026-10");
  assert.equal(q.rows.delivery.text, "—", "invalid revenue: no estimate");
});

test("DLV-06 no recorded revenue under a configured rate: '—' (never ₪0); zero revenue: a known ₪0; rate 0%: a known ₪0", () => {
  const empty = ROWS.map((r) => (r.date >= "2026-10-01" ? day(r.date, { sales: "", deliveries: "", other_income: "" }) : r));
  assert.equal(pnl(src("2026-10-20", [v("2026-09-01", "14")], empty), "2026-10").rows.delivery.text, "—");
  const zero = ROWS.map((r) => day(r.date, { sales: "0", deliveries: "0", other_income: "0" }));
  assert.equal(pnl(src("2026-11-01", [v("2026-09-01", "14")], zero), "2026-10").rows.delivery.text, "₪0");
  assert.equal(pnl(src("2026-11-01", [v("2026-09-01", "0")]), "2026-10").rows.delivery.text, "₪0");
});

test("DLV-07 Dashboard: breakdown row, shares over the total incl. the estimate, projected profit includes the estimate to date + today's rate on the projected rest", () => {
  const asOf = "2026-10-20", s = src(asOf, [v("2026-09-01", "14")]), s0 = src(asOf);
  const d = dash(s, asOf), d0 = dash(s0, asOf);
  assert.equal(bd(d, "delivery"), "₪3,192");                             // 19 × 1200 × 14 %
  assert.ok(d.breakdown.every((b) => b.shareText !== "—"), "shares available (complete month to date)");
  const fRev = n(d.projection.forecast.projectedRevenue), actual = n(d.report.actual.revenue.value);
  const expect = n(d0.projectedProfit.amount) - (actual * 0.14 + (fRev - actual) * 0.14);
  assert.ok(Math.abs(n(d.projectedProfit.amount) - expect) < 1e-6, `${d.projectedProfit.amount} vs ${expect}`);
  assert.match(d.projectedProfit.deliveryNote, /משוערת/);
  for (const k of ["revenue", "purchases"]) assert.equal(JSON.stringify(d[k]), JSON.stringify(d0[k]), k);
  assert.equal(d.purchasesPct.text, d0.purchasesPct.text); assert.equal(d.labor.text, d0.labor.text); assert.equal(d.fixedRent.text, d0.fixedRent.text);
  // a rate that starts tomorrow: nothing to date, the projection uses no rate today → unchanged
  const t = dash(src(asOf, [v("2026-10-21", "14")]), asOf);
  assert.equal(t.delivery, null); assert.equal(t.projectedProfit.amount, d0.projectedProfit.amount);
});

test("DLV-08 failed / pending reads stay visible states; a closed-day contradiction makes the estimate unavailable", () => {
  const vs = [v("2026-09-01", "14")];
  assert.equal(pnl({ ...src("2026-11-01", vs), costHistory: { state: "unreadable", reason: "read_failed" } }, "2026-10").status, "unavailable");
  assert.equal(dash(srcOf({ rows: ROWS.filter((r) => r.date < "2026-10-20"), asOf: "2026-10-20", config: present(cfg(vs)), rowsReady: false }), "2026-10-20").status, "loading");
  const ledger = ledgerOf(C.structuredStates({ "2026-10-05": { source: "structured", status: "active", reasonCode: "closure" } }), "2000-01-01", "2100-12-31");
  assert.equal(pnl(src("2026-11-01", vs, ROWS, { ledger }), "2026-10").rows.delivery.text, "—");
});
