// PNL-AVAIL — the P&L of an incomplete month keeps its valid recorded amounts (production
// reproduction: Arkafe, October 2026 — revenue on 23/30 days, purchases on 25/30, no hourly labor
// recorded: every P&L line but revenue showed "—"). Missing ≠ zero, malformed ≠ missing, the
// bottom line of an incomplete month is a recorded-data BALANCE (never "net profit"), and a
// complete month is unchanged. Synthetic rows only; the shared core is not changed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadFinance, loadSeam, present, ledgerOf, row, srcOf } from "../support/c1-seam.mjs";
import { creditNode, spec } from "../support/p1-credit-fixtures.mjs";
import { T, B, configWithGlobal, fixedItems } from "../support/b1-fixtures.mjs";

const F = await loadFinance();
const C = loadSeam();
const AS_OF = "2026-09-29", MONTH = "2026-09";
const pad = (n) => String(n).padStart(2, "0");
const DAYS = Array.from({ length: 28 }, (_, i) => `2026-09-${pad(i + 1)}`);
let seq = 1;
const uid = () => `00000000-0000-4000-8000-${String(seq++).padStart(12, "0")}`;
const day = (d, over = {}) => row(d, { sales: "1000", deliveries: "0", other_income: "0", supplier_payments: { s1: "300" }, payroll: "100", other_expense: "0", ...over }, uid());
const noRev = { sales: "", deliveries: "", other_income: "" };
// global employer cost 3000/month (100/day in September), royalty 7 %, fixed rent 4000, fixed items 3100
const CONFIG = { ...configWithGlobal("3000"), rentType: "fixed", rentFixed: 4000, hasRoyalty: true, royaltyPct: 7 };
const src = (rows, extra = {}) => ({ ...srcOf({ rows, asOf: AS_OF, config: present(CONFIG), fixed: present(fixedItems("3100")) }), ...extra });
const pnl = (s) => C.pnl(F, s, MONTH, null);
const M = (a) => F.presenters.money.formatShekel(a);
const BIND = { tenantId: T, bizId: B };

test("PNL-AVAIL-01 complete month: every figure is the core's complete value; net profit labelled as such; no basis line", () => {
  const p = pnl(src(DAYS.map((d) => day(d))));
  const A = p.report.actual;
  assert.equal(A.operatingProfit.state, "complete");
  assert.equal(p.rows.net.amount, A.operatingProfit.value); assert.equal(p.netLabel, "רווח נקי"); assert.equal(p.netPctLabel, "רווח נקי %");
  assert.equal(p.available, null);
  assert.equal(p.rows.purchases.amount, A.purchases.value); assert.equal(p.rows.labor.amount, A.labor.employerCost.value);
  assert.equal(p.purchasesPct.text, F.presenters.percent.formatPercent(A.purchasesPct));
  assert.equal(p.gross.status, "complete");
});

test("PNL-AVAIL-02 partial revenue (Arkafe shape): recorded revenue, net purchases, labor (hourly + salaried), fixed + royalty on recorded revenue; recorded-data balance, not net profit", () => {
  const rows = DAYS.filter((d) => d !== "2026-09-10").map((d) => (d >= "2026-09-25" ? day(d, noRev) : day(d)));
  const p = pnl(src(rows));
  const A = p.report.actual;
  assert.equal(A.operatingProfit.state, "incomplete_components");
  assert.equal(A.revenue.value, "23000"); assert.equal(p.rows.revenue.text, "₪23,000 · חלקי");
  assert.equal(p.rows.purchases.amount, "8100"); assert.equal(p.rows.purchases.text, "₪8,100");
  // hourly 27 × 100 + salaried 3000/30 × 28 recognised days = 2700 + 2800
  assert.equal(A.labor.globalEmployerCost.value, "2800");
  assert.equal(p.rows.labor.amount, "5500");
  // the core's own accrual over the same window: identical to a month where the missing revenue days carry an explicit 0
  const zeroed = pnl(src(DAYS.map((d) => (d === "2026-09-10" || d >= "2026-09-25" ? day(d, { sales: "0", deliveries: "0", other_income: "0", ...(d === "2026-09-10" ? { supplier_payments: {}, payroll: "0" } : {}) }) : day(d)))));
  const zfx = zeroed.report.actual.fixedAccrual;
  assert.equal(zfx.state, "complete");
  assert.equal(p.rows.fixedRent.amount, F.finance.decimal.serializeRat(F.finance.decimal.ratAdd(F.finance.decimal.ratAdd(F.finance.decimal.parseAmountString(zfx.regular), F.finance.decimal.parseAmountString(zfx.rentFixed)), F.finance.decimal.parseAmountString(zfx.rentPct))));
  assert.equal(p.rows.royalty.amount, zfx.royaltyPct); assert.equal(p.rows.royalty.amount, "1610");   // 7 % × 23 000
  const expectBalance = 23000 - 8100 - 5500 - Number(p.rows.fixedRent.amount.includes("/") ? NaN : p.rows.fixedRent.amount) - 1610;
  assert.ok(p.rows.net.amount !== null);
  const bal = F.metrics.adapters.legacyNumber.amountToNumber(p.rows.net.amount);
  const fixedN = F.metrics.adapters.legacyNumber.amountToNumber(p.rows.fixedRent.amount);
  assert.ok(Math.abs(bal - (23000 - 8100 - 5500 - fixedN - 1610)) < 1e-6, String(expectBalance));
  assert.equal(p.netLabel, "יתרה לפי הנתונים שהוזנו"); assert.equal(p.netPctLabel, "יתרה %");
  assert.equal(p.purchasesPct.text, "35.2%"); assert.equal(p.laborPct.text, "23.9%");     // 8100 / 23000, 5500 / 23000
  assert.equal(p.rows.purchases.shareText, "35.2%");
  assert.deepEqual([...p.available.missing], []);
  assert.match(p.available.basisText, /23\/28 ימי הכנסה, 27\/28 ימי קניות, 27\/28 ימי עלות עובדים שעתית/);
  assert.match(p.available.basisText, /יתרה לפי הנתונים שהוזנו ואינה רווח נקי\./); assert.doesNotMatch(p.available.basisText, /אינה כוללת/, "nothing excluded");
  assert.equal(p.gross.text, "—", "VD-50 gross profit stays complete-only");
  assert.equal(p.rows.net.deltaText, "—", "no comparison of a partial month");
  assert.equal(p.disclosure.warning, "", "missing days are not a warning");
});

test("PNL-AVAIL-03 partial expenses: no hourly labor recorded ⇒ labor '—' (salaried share alone is not shown as the labor cost); balance excludes it and says so", () => {
  const p = pnl(src(DAYS.map((d) => day(d, { payroll: "" }))));
  assert.equal(p.rows.labor.text, "—"); assert.equal(p.rows.labor.amount, null); assert.equal(p.laborPct.text, "—");
  assert.equal(p.rows.purchases.amount, "8400"); assert.equal(p.rows.revenue.text, "₪28,000");
  assert.deepEqual([...p.available.missing], ["labor"]);
  assert.match(p.available.basisText, /ואינה רווח נקי\. היתרה אינה כוללת: עלות עובדים \(לא הוזנו נתונים\)\./);
  assert.ok(p.rows.net.amount !== null); assert.equal(p.netLabel, "יתרה לפי הנתונים שהוזנו");
  // some hourly days recorded: labor = recorded hourly + salaried accrual
  const q = pnl(src(DAYS.map((d, i) => day(d, i < 10 ? {} : { payroll: "" }))));
  assert.equal(q.rows.labor.amount, "3800");   // 10 × 100 + 2800
  assert.deepEqual([...q.available.missing], []);
});

test("PNL-AVAIL-04 other expense: nothing recorded is not shown as a cost line; a recorded amount is shown and deducted", () => {
  const none = pnl(src(DAYS.map((d) => day(d, { payroll: "", other_expense: "" }))));
  assert.equal(none.showOther, false);
  const some = pnl(src(DAYS.map((d, i) => day(d, { payroll: "", other_expense: i === 3 ? "250" : "" }))));
  assert.equal(some.showOther, true); assert.equal(some.rows.other.amount, "250");
  assert.equal(F.metrics.adapters.legacyNumber.amountToNumber(none.rows.net.amount) - F.metrics.adapters.legacyNumber.amountToNumber(some.rows.net.amount), 250);
});

test("PNL-AVAIL-05 zero revenue: amounts shown, every ratio '—' (zero denominator), never 0 % or ∞", () => {
  const p = pnl(src(DAYS.slice(0, 20).map((d) => day(d, { sales: "0" }))));
  assert.equal(p.rows.revenue.text, "₪0 · חלקי");
  assert.equal(p.rows.purchases.amount, "6000");
  for (const k of ["purchases", "labor", "fixedRent", "royalty", "net"]) assert.equal(p.rows[k].shareText, "—", k);
  assert.equal(p.purchasesPct.text, "—"); assert.equal(p.laborPct.text, "—"); assert.equal(p.netPct.text, "—");
  assert.equal(p.rows.royalty.amount, "0", "7 % of a recorded ₪0");
});

test("PNL-AVAIL-06 no revenue recorded: costs shown, ratios and balance '—'", () => {
  const p = pnl(src(DAYS.slice(0, 20).map((d) => day(d, noRev))));
  assert.equal(p.rows.revenue.text, "—"); assert.equal(p.rows.purchases.amount, "6000");
  assert.equal(p.rows.net.text, "—"); assert.equal(p.netPct.text, "—"); assert.equal(p.purchasesPct.text, "—");
  assert.equal(p.rows.royalty.text, "—", "a royalty on no recorded revenue is not a known ₪0");
});

test("PNL-AVAIL-07 malformed data stays distinct from missing: invalid cell / invalid or unreviewed credits / contradiction ⇒ that line '—', no balance, basis says why", () => {
  const base = () => DAYS.filter((d) => d !== "2026-09-10").map((d) => day(d));
  const badPur = base(); badPur[2] = day(badPur[2].date, { supplier_payments: { s1: "x1" } });
  const a = pnl(src(badPur));
  assert.equal(a.rows.purchases.text, "—"); assert.equal(a.rows.net.text, "—"); assert.equal(a.netPct.text, "—");
  assert.equal(a.rows.labor.amount, "5500"); // a valid component stays visible: 27 × 100 + 2800
  assert.match(a.available.basisText, /נתונים לא תקינים/);
  const badRev = base(); badRev[2] = day(badRev[2].date, { sales: "abc" });
  const b = pnl(src(badRev));
  assert.equal(b.rows.net.text, "—"); assert.equal(b.purchasesPct.text, "—"); assert.ok(b.disclosure.warning.length > 0, "the invalid-revenue warning stays");
  for (const credits of [{ state: "not_loaded" }, F.finance.supplierCredits.decodeSupplierCredits("garbage", BIND),
    F.finance.supplierCredits.decodeSupplierCredits(creditNode([spec(1, "s1", "2026-09-12", "50", { review: "pending" })]), BIND)]) {
    const c = pnl(src(base(), { credits }));
    assert.equal(c.rows.purchases.text, "—"); assert.equal(c.rows.net.text, "—");
  }
  const contra = pnl(src(base(), { ledger: ledgerOf(C.structuredStates({ "2026-09-05": { source: "structured", status: "active", reasonCode: "closure" } }), "2000-01-01", "2100-12-31") }));
  assert.equal(contra.rows.net.text, "—"); assert.equal(contra.purchasesPct.text, "—");
});

test("PNL-AVAIL-08 supplier credits stay the core's net purchases (issue-date attribution)", () => {
  const rows = DAYS.filter((d) => d !== "2026-09-10").map((d) => day(d));
  const credits = F.finance.supplierCredits.decodeSupplierCredits(creditNode([spec(1, "s1", "2026-09-15", "300")]), BIND);
  const p = pnl(src(rows, { credits }));
  assert.equal(p.rows.purchases.amount, "7800"); assert.equal(p.rows.purchases.amount, p.report.actual.purchases.value);
});

test("PNL-AVAIL-09 failed / pending reads stay visible states (no figures)", () => {
  const rows = DAYS.map((d) => day(d));
  assert.equal(pnl(srcOf({ rows, asOf: AS_OF, rowsReady: false })).status, "loading");
  assert.equal(pnl(src(rows, { ledger: { state: "unreadable", reason: "read_failed" } })).status, "unavailable");
  assert.equal(pnl(src(rows, { costHistory: { state: "unreadable", reason: "read_failed" } })).status, "unavailable");
  assert.equal(pnl(src(rows, { credits: { state: "loading" } })).status, "loading");
});
