// AVAIL-ACCRUAL — the Dashboard's fixed costs + rent and royalty agree with the P&L when revenue days
// are missing (production: Arkafe, October 2026 — P&L ₪66,949 / ₪72,157, Dashboard ₪29,205 · חלקי / —).
// One shared helper (the core's accrual over the same timeline, window, closure calendar and recorded
// revenue) feeds both views; configured rates come from the cost timeline. Synthetic rows only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadFinance, loadSeam, present, row, srcOf } from "../support/c1-seam.mjs";
import { configWithGlobal, fixedItems } from "../support/b1-fixtures.mjs";

const F = await loadFinance();
const C = loadSeam();
const AS_OF = "2026-09-29", NOW = Date.parse("2026-09-29T09:00:00Z");
const DAYS = Array.from({ length: 28 }, (_, i) => `2026-09-${String(i + 1).padStart(2, "0")}`);
let seq = 1;
const uid = () => `00000000-0000-4000-8000-${String(seq++).padStart(12, "0")}`;
const day = (d, o = {}) => row(d, { sales: "1000", deliveries: "0", other_income: "0", supplier_payments: { s1: "300" }, payroll: "100", other_expense: "0", ...o }, uid());
const noRev = { sales: "", deliveries: "", other_income: "" };
const PCT = { ...configWithGlobal("3000"), rentType: "pct", rentPct: 6.8, hasRoyalty: true, royaltyPct: 13 };
const FIXEDRENT = { ...configWithGlobal("3000"), rentType: "fixed", rentFixed: 4000, hasRoyalty: true, royaltyPct: 7 };
const src = (rows, config = PCT) => srcOf({ rows, asOf: AS_OF, config: present(config), fixed: present(fixedItems("3100")) });
const dash = (s) => C.dashboard(F, s, { nowMs: NOW, lastYearSales: null });
const pnl = (s) => C.pnl(F, s, "2026-09", null);
const arkafe = () => DAYS.filter((d) => d !== "2026-09-10").map((d) => (d >= "2026-09-25" ? day(d, noRev) : day(d, { payroll: "" })));

test("ALIGN-01 partial revenue: Dashboard fixed + rent and royalty equal the P&L (same helper, configured rates, recorded revenue); quiet basis line, no partial suffix", () => {
  for (const cfg of [PCT, FIXEDRENT]) {
    const s = src(arkafe(), cfg), dv = dash(s), p = pnl(s);
    assert.equal(dv.fixedRent.text, p.rows.fixedRent.text, JSON.stringify(cfg.rentType));
    assert.equal(dv.royalty.text, p.rows.royalty.text);
    assert.equal(dv.fixedRent.partial, false); assert.doesNotMatch(dv.fixedRent.text, /חלקי/);
    assert.equal(dv.fixedRent.pctText, p.rows.fixedRent.shareText); assert.equal(dv.royalty.pctText, p.rows.royalty.shareText);
    assert.match(dv.fixedRent.basisText, /לפי ההכנסות שהוזנו \(23\/28 ימי הכנסה\)/);
    assert.equal(dv.disclosure.warning, "");
  }
  // exact: recorded revenue 23 000 → royalty 13 % = 2 990; rent 6.8 % = 1 564; fixed 3100 × 28/30
  const dv = dash(src(arkafe(), PCT));
  assert.equal(dv.royalty.text, "₪2,990");
  const bd = Object.fromEntries(dv.breakdown.map((b) => [b.key, b.text]));
  assert.equal(bd.royalty, "₪2,990"); assert.equal(bd.rentPct, "₪1,564"); assert.equal(bd.fixed, F.presenters.money.formatShekel(F.finance.decimal.serializeRat(F.finance.decimal.ratDiv(F.finance.decimal.ratFromInt(3100 * 28), F.finance.decimal.ratFromInt(30)))));
});

test("ALIGN-02 the same window with the missing revenue entered as an explicit 0 gives the core's own complete accrual — identical amounts (no formula of our own)", () => {
  const partial = dash(src(arkafe()));
  const zeroed = DAYS.map((d) => (d === "2026-09-10" || d >= "2026-09-25" ? day(d, { sales: "0", deliveries: "0", other_income: "0", ...(d === "2026-09-10" ? { supplier_payments: {}, payroll: "0" } : {}) }) : day(d, { payroll: "" })));
  const z = dash(src(zeroed));
  const fx = z.report.actual.fixedAccrual;
  assert.equal(fx.state, "complete");
  assert.equal(partial.royalty.text, F.presenters.money.formatShekel(fx.royaltyPct));
  assert.equal(partial.fixedRent.text, F.presenters.money.formatShekel(F.finance.decimal.serializeRat(F.finance.decimal.ratAdd(F.finance.decimal.ratAdd(F.finance.decimal.parseAmountString(fx.regular), F.finance.decimal.parseAmountString(fx.rentFixed)), F.finance.decimal.parseAmountString(fx.rentPct)))));
});

test("ALIGN-03 complete month unchanged: complete accrual, no basis line, Food Cost untouched", () => {
  const dv = dash(src(DAYS.map((d) => day(d))));
  assert.equal(dv.report.actual.fixedAccrual.state, "complete");
  assert.equal(dv.fixedRent.basisText, null); assert.equal(dv.royalty.basisText, null);
  assert.equal(dv.royalty.text, F.presenters.money.formatShekel(dv.report.actual.fixedAccrual.royaltyPct));
  assert.equal(dv.purchasesPct.text, "30.0%"); assert.equal(dv.purchasesPct.partial, false);
});

test("ALIGN-04 zero revenue: rent % and royalty are known zeros of a recorded ₪0; percentages '—'. No revenue recorded: royalty '—' on both views (never a ₪0), the Dashboard keeps its DASH-05 partial fixed tile", () => {
  const zero = DAYS.slice(0, 20).map((d, i) => day(d, i < 10 ? { sales: "0" } : noRev));
  const dz = dash(src(zero)), pz = pnl(src(zero));
  assert.equal(dz.royalty.text, "₪0"); assert.equal(dz.royalty.text, pz.rows.royalty.text); assert.equal(dz.fixedRent.text, pz.rows.fixedRent.text);
  assert.equal(dz.royalty.pctText, "—"); assert.equal(dz.fixedRent.pctText, "—");
  const none = DAYS.slice(0, 20).map((d) => day(d, noRev));
  const dn = dash(src(none)), pn = pnl(src(none));
  assert.equal(dn.royalty.text, "—"); assert.equal(pn.rows.royalty.text, "—");
  assert.match(dn.fixedRent.text, /· חלקי$/, "DASH-05 fallback: regular fixed items known, rent % pending");
  assert.equal(dn.fixedRent.basisText, null);
});

test("ALIGN-05 malformed revenue keeps the existing behaviour (no recorded-revenue accrual)", () => {
  const rows = arkafe(); rows[2] = day(rows[2].date, { sales: "abc" });
  const dv = dash(src(rows));
  assert.equal(dv.royalty.text, "—"); assert.equal(dv.fixedRent.basisText, null);
  assert.ok(dv.disclosure.warning.length > 0);
});
