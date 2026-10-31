// BD-PURCHASES — the Dashboard expense breakdown's "רכש ספקים" row shows the recorded NET purchases when only
// missing days stand in the way (same rule as the P&L purchases line), instead of "—" next to a purchases tile
// that already shows the amount. Invalid / partial purchase cells and an invalid / unreviewed credit source keep
// "—"; a complete month is unchanged; breakdown shares stay complete-only. Synthetic rows only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadFinance, loadSeam, present, row, srcOf } from "../support/c1-seam.mjs";
import { creditNode, spec } from "../support/p1-credit-fixtures.mjs";
import { T, B } from "../support/b1-fixtures.mjs";

const F = await loadFinance();
const C = loadSeam();
const DAYS = Array.from({ length: 28 }, (_, i) => `2026-09-${String(i + 1).padStart(2, "0")}`);
let n = 1; const id = () => `00000000-0000-4000-8000-${String(n++).padStart(12, "0")}`;
const day = (d, o = {}) => row(d, { sales: "1000", deliveries: "0", other_income: "0", supplier_payments: { s1: "300" }, payroll: "100", other_expense: "0", ...o }, id());
const dash = (rows, extra = {}) => C.dashboard(F, { ...srcOf({ rows, asOf: "2026-09-29", config: present({}) }), ...extra }, { nowMs: Date.parse("2026-09-29T09:00:00Z"), lastYearSales: null });
const bd = (dv) => dv.breakdown.find((b) => b.key === "purchases");
const BIND = { tenantId: T, bizId: B };

test("BD-PURCHASES-01 complete month: the breakdown row is the core's complete net purchases (unchanged), with its share", () => {
  const dv = dash(DAYS.map((d) => day(d)));
  assert.equal(bd(dv).text, "₪8,400"); assert.notEqual(bd(dv).shareText, "—");
});

test("BD-PURCHASES-02 missing days: the row shows the recorded net purchases — the same amount as the purchases tile; no share (complete-only)", () => {
  const dv = dash(DAYS.filter((d) => d !== "2026-09-10").map((d) => (d >= "2026-09-25" ? day(d, { sales: "" }) : day(d))));
  assert.equal(dv.report.actual.purchases.complete, false);
  assert.equal(bd(dv).text, "₪8,100"); assert.equal(bd(dv).text, dv.purchases.amountText); assert.equal(bd(dv).shareText, "—");
  const credits = F.finance.supplierCredits.decodeSupplierCredits(creditNode([spec(1, "s1", "2026-09-15", "88.81")]), BIND);
  const withCredit = dash(DAYS.filter((d) => d !== "2026-09-10").map((d) => day(d)), { credits });
  assert.equal(withCredit.report.actual.purchases.value, "8011.19"); assert.equal(bd(withCredit).text, "₪8,011", "net of the credit (whole-shekel display as every breakdown row)");
});

test("BD-PURCHASES-03 malformed purchases stay '—': an invalid cell, an unreadable credit source, an unreviewed credit", () => {
  const rows = DAYS.filter((d) => d !== "2026-09-10").map((d) => day(d)); rows[3] = day(rows[3].date, { supplier_payments: { s1: "x1" } });
  assert.equal(bd(dash(rows)).text, "—");
  const ok = DAYS.filter((d) => d !== "2026-09-10").map((d) => day(d));
  for (const credits of [{ state: "not_loaded" }, F.finance.supplierCredits.decodeSupplierCredits("garbage", BIND),
    F.finance.supplierCredits.decodeSupplierCredits(creditNode([spec(1, "s1", "2026-09-12", "50", { review: "pending" })]), BIND)])
    assert.equal(bd(dash(ok, { credits })).text, "—", JSON.stringify(credits).slice(0, 50));
});

test("BD-PURCHASES-04 no purchases recorded: '—' (never ₪0)", () => {
  assert.equal(bd(dash(DAYS.slice(0, 10).map((d) => day(d, { supplier_payments: {} })))).text, "—");
});
