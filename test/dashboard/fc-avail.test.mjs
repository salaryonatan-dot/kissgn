// FC-AVAIL — Dashboard Food Cost from available recorded data (production reproduction: Arkafe,
// October 2026 — revenue recorded on 23 of 30 days, purchases on 25: the core's complete-month
// Food Cost is "incomplete_components" and the tile showed "—" next to ₪231,724 purchases).
// Rule: when ONLY missing days stand in the way, the Dashboard shows recorded NET purchases ÷
// recorded revenue of the same Actual window. Nothing is invented: no basis / zero revenue → "—";
// invalid or partial cells, invalid / unresolved credits, contradictions and failed reads are
// unchanged. The shared core report itself is not changed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadFinance, loadSeam, present, absent, ledgerOf, row, srcOf } from "../support/c1-seam.mjs";
import { creditNode, spec } from "../support/p1-credit-fixtures.mjs";
import { T, B } from "../support/b1-fixtures.mjs";

const F = await loadFinance();
const C = loadSeam();
const AS_OF = "2026-09-29", NOW = Date.parse("2026-09-29T09:00:00Z");
const pad = (n) => String(n).padStart(2, "0");
const DAYS = Array.from({ length: 28 }, (_, i) => `2026-09-${pad(i + 1)}`);
let seq = 1;
const uid = () => `00000000-0000-4000-8000-${String(seq++).padStart(12, "0")}`;
const day = (d, over = {}) => row(d, { sales: "1000", deliveries: "0", other_income: "0", supplier_payments: { s1: "300" }, payroll: "100", other_expense: "0", ...over }, uid());
const CONFIG = present({ employees: [{ id: "g1", name: "g", type: "global", monthlySalary: 3000 }] });
const src = (rows, extra = {}) => ({ ...srcOf({ rows, asOf: AS_OF, config: CONFIG }), ...extra });
const dash = (s) => C.dashboard(F, s, { nowMs: NOW, lastYearSales: null });
const pct = (x) => F.presenters.percent.formatPercent(x);
/** Arkafe shape: day 10 missing entirely; revenue missing on 25–28 while purchases were recorded. */
const arkafeLike = () => DAYS.filter((d) => d !== "2026-09-10").map((d) => (d >= "2026-09-25" ? day(d, { sales: "", deliveries: "", other_income: "" }) : day(d)));

test("FC-AVAIL-01 complete month: the Food Cost model is exactly the core's complete-month value (unchanged), not marked partial", () => {
  const dv = dash(src(DAYS.map((d) => day(d))));
  const A = dv.report.actual;
  assert.equal(A.purchasesPct.state, "value");
  assert.equal(dv.purchasesPct.text, pct(A.purchasesPct)); assert.equal(dv.purchasesPct.text, "30.0%");
  assert.equal(dv.purchasesPct.band, "ok"); assert.equal(dv.purchasesPct.num, 30);
  assert.equal(dv.purchasesPct.belowGoalText, "3.0%");
  assert.equal(dv.purchasesPct.partial, false); assert.equal(dv.purchasesPct.basisText, null);
});

test("FC-AVAIL-02 missing days (Arkafe shape): recorded net purchases ÷ recorded revenue; marked partial with a quiet basis; the core report and the other ratios are unchanged", () => {
  const dv = dash(src(arkafeLike()));
  const A = dv.report.actual;
  assert.equal(A.purchasesPct.state, "incomplete_components", "the shared core still withholds the complete-month value");
  assert.equal(A.revenue.value, "23000"); assert.equal(A.purchases.value, "8100");
  assert.equal(dv.purchasesPct.text, "35.2%");                       // 8100 / 23000
  assert.ok(Math.abs(dv.purchasesPct.num - 8100 / 23000 * 100) < 1e-9);
  assert.equal(dv.purchasesPct.band, "warn");                        // goal 33: over, within +3
  assert.equal(dv.purchasesPct.partial, true);
  assert.equal(dv.purchasesPct.basisText, "מחושב מהנתונים שהוזנו: 23/28 ימי הכנסה, 27/28 ימי קניות");
  assert.equal(dv.disclosure.warning, "", "missing days are not a warning");
  assert.equal(dv.revenue.text, "₪23,000 · חלקי"); assert.equal(dv.purchases.amountText, "₪8,100");
  assert.equal(dv.laborPct.text, "—", "labor % is out of this fix's scope (salaried accrual basis)");
});

test("FC-AVAIL-03 supplier credits stay attributed by the core: Food Cost on NET purchases with missing days", () => {
  const BIND = { tenantId: T, bizId: B };
  const credits = F.finance.supplierCredits.decodeSupplierCredits(creditNode([spec(1, "s1", "2026-09-15", "300")]), BIND);
  const dv = dash(src(arkafeLike(), { credits }));
  assert.equal(dv.report.actual.purchases.value, "7800");
  assert.equal(dv.purchasesPct.text, "33.9%");                       // 7800 / 23000
  assert.equal(dv.purchasesPct.partial, true);
});

test("FC-AVAIL-04 no recorded revenue / zero revenue / no recorded purchases: no calculation basis → '—', never 0", () => {
  const noRevenue = DAYS.slice(0, 20).map((d) => day(d, { sales: "", deliveries: "", other_income: "" }));
  const a = dash(src(noRevenue));
  assert.equal(a.purchasesPct.text, "—"); assert.equal(a.purchasesPct.num, null); assert.equal(a.purchasesPct.band, "none"); assert.equal(a.purchasesPct.partial, false);
  const zeroRevenue = DAYS.slice(0, 20).map((d) => day(d, { sales: "0", deliveries: "0", other_income: "0" }));
  const z = dash(src(zeroRevenue));
  assert.equal(z.report.actual.revenue.value, "0"); assert.equal(z.purchasesPct.text, "—", "zero denominator"); assert.equal(z.purchasesPct.partial, false);
  const zc = dash(src(DAYS.map((d) => day(d, { sales: "0", deliveries: "0", other_income: "0" }))));
  assert.equal(zc.report.actual.purchasesPct.state, "zero_denominator"); assert.equal(zc.purchasesPct.text, "—", "complete month with ₪0 revenue: unchanged");
  const noPurchases = DAYS.slice(0, 20).map((d) => day(d, { supplier_payments: {} }));
  const p = dash(src(noPurchases));
  assert.equal(p.report.actual.purchases.value, null); assert.equal(p.purchasesPct.text, "—"); assert.equal(p.purchasesPct.empty, true);
});

test("FC-AVAIL-05 malformed data stays unavailable: an invalid revenue or purchase cell, an invalid / unresolved credit, a closed-day contradiction", () => {
  const withBad = (over) => { const r = arkafeLike(); r[3] = day(r[3].date, over); return r; };
  for (const over of [{ sales: "abc" }, { supplier_payments: { s1: "x1" } }]) {
    const dv = dash(src(withBad(over)));
    assert.equal(dv.report.actual.purchasesPct.state, "invalid_components", JSON.stringify(over));
    assert.equal(dv.purchasesPct.text, "—"); assert.equal(dv.purchasesPct.partial, false);
  }
  const BIND = { tenantId: T, bizId: B };
  for (const credits of [{ state: "not_loaded" }, F.finance.supplierCredits.decodeSupplierCredits("garbage", BIND),
    F.finance.supplierCredits.decodeSupplierCredits(creditNode([spec(1, "s1", "2026-09-12", "50", { review: "pending" })]), BIND)]) {
    const dv = dash(src(arkafeLike(), { credits }));
    assert.equal(dv.purchasesPct.text, "—", JSON.stringify(credits).slice(0, 60)); assert.equal(dv.purchasesPct.partial, false);
  }
  const closedWithRevenue = src(arkafeLike(), { ledger: ledgerOf(C.structuredStates({ "2026-09-05": { source: "structured", status: "active", reasonCode: "closure" } }), "2000-01-01", "2100-12-31") });
  const cdv = dash(closedWithRevenue);
  assert.deepEqual([...cdv.disclosure.contradictions], ["2026-09-05"]);
  assert.equal(cdv.purchasesPct.text, "—"); assert.equal(cdv.purchasesPct.partial, false);
});

test("FC-AVAIL-06 failed / pending reads stay visible states: no Food Cost value is produced", () => {
  const rows = arkafeLike();
  assert.equal(dash(srcOf({ rows, asOf: AS_OF, config: CONFIG, rowsReady: false })).status, "loading");
  assert.equal(dash(src(rows, { ledger: { state: "unreadable", reason: "read_failed" } })).status, "unavailable");
  assert.equal(dash(src(rows, { costHistory: { state: "unreadable", reason: "read_failed" } })).status, "unavailable");
  assert.equal(dash(src(rows, { credits: { state: "loading" } })).status, "loading");
});
