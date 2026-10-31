// CREDIT-AGOROT — supplier credits keep agorot end to end, and the Credits tab shows them.
// Production finding (read-only, Arkafe, 2026-10-31): the stored credit is the exact string "88.81"; the core
// counts 88.81 exactly (gross 239,230.65 − 88.81 = net 239,141.84; supplier 36,449.26 − 88.81 = 36,360.45);
// only the Credits tab rounded it to "₪89" (formatShekel, whole shekels). Here: the browser seam's own form
// validation and request bodies → the REAL api/admin.js handler over an in-memory DB (create, list, replace)
// → the page's decode → the Credits tab, the supplier view, Food Cost and P&L. Isolated data only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";
import { REPO } from "../support/fincore-load.mjs";
import { loadFinance, loadSeam, present, row, srcOf } from "../support/c1-seam.mjs";
import { apiHarness, T, B, NODE } from "../support/p1-r3-api-harness.mjs";

const F = await loadFinance();
const HTML = readFileSync(join(REPO, "index.html"), "utf8");
const C1 = loadSeam(HTML);
const P1_START = "// ── P1 supplier credits browser seam";
const p1src = HTML.slice(HTML.indexOf(P1_START), HTML.indexOf("</script>", HTML.indexOf(P1_START)));
const win = {}; vm.runInNewContext(p1src, { window: win, Object, Promise, setTimeout, clearTimeout, AbortController, crypto: globalThis.crypto });
const P1 = win.MarjinP1;
const SUPS = [{ id: "s1", name: "ספק אחד" }, { id: "s2", name: "ספק שני" }];
const BIND = { tenantId: T, bizId: B };
const ctx = { tenantId: T, bizId: B };
const decode = (node) => F.finance.supplierCredits.decodeSupplierCredits(node, BIND);
const deq = (a, b, m) => assert.deepEqual(JSON.parse(JSON.stringify(a)), b, m);

test("AGOROT-01 the Credits tab text is exact to the agora (no rounding, no number conversion)", () => {
  const cases = [["88.81", "₪88.81"], ["88.5", "₪88.50"], ["300", "₪300.00"], ["0.01", "₪0.01"], ["1234567.89", "₪1,234,567.89"], ["-12.3", "₪-12.30"]];
  for (const [a, t] of cases) assert.equal(P1.agorotText(F, a), t, a);
  assert.equal(P1.agorotText(F, null), "—");
  assert.equal(P1.agorotText(F, "1/3"), F.presenters.money.formatShekel("1/3"), "a non-decimal value is never a credit: whole-shekel fallback");
});

test("AGOROT-02 save → reload → edit through the real API: '88.81' is stored, listed, shown and edited exactly; the month total keeps agorot", async () => {
  const h = await apiHarness();
  // form input as the user typed it → the seam's validation → the seam's request body → the real handler
  const v = P1.validateForm(F, { supplierId: "s1", issueDate: "2026-10-28", amount: "88.81", documentNumber: "04/066635", note: "" }, SUPS, null);
  assert.equal(v.ok, true); assert.equal(v.input.amount, "88.81");
  const created = await h.call("create-supplier-credit", P1.createBody(ctx, v.input, P1.newId(), P1.newId()), "mgr");
  assert.equal(created.code, 200, JSON.stringify(created.body));
  const stored = Object.values(h.db.read(NODE).records);
  assert.equal(stored.length, 1); assert.equal(stored[0].amount, "88.81", "persisted exactly");
  // reload: the list API → the page decode → the Credits tab
  const listed = await h.call("list-supplier-credits", { tenantId: T, bizId: B }, "mgr", "GET");
  assert.equal(listed.code, 200);
  let mv = P1.monthView(F, decode(listed.body.node), "2026-10", SUPS);
  assert.equal(mv.rows[0].amount, "88.81"); assert.equal(mv.rows[0].amountText, "₪88.81"); assert.equal(mv.totalText, "₪88.81");
  // edit: the form is prefilled from row.amount (startEditCredit) — the exact stored string
  assert.match(HTML, /setCreditForm\(\{ supplierId: row\.supplierId, issueDate: row\.issueDate, amount: row\.amount,/);
  const ve = P1.validateForm(F, { supplierId: "s1", issueDate: "2026-10-28", amount: "88.8", documentNumber: "04/066635", note: "" }, SUPS, mv.rows[0]);
  assert.equal(ve.ok, true);
  const replaced = await h.call("replace-supplier-credit", P1.replaceBody(ctx, mv.rows[0], ve.input, P1.newId(), P1.newId(), false), "mgr");
  assert.equal(replaced.code, 200, JSON.stringify(replaced.body));
  // a second credit with agorot on another supplier
  const v2 = P1.validateForm(F, { supplierId: "s2", issueDate: "2026-10-05", amount: "1000.39", documentNumber: "CR-77", note: "" }, SUPS, null);
  assert.equal((await h.call("create-supplier-credit", P1.createBody(ctx, v2.input, P1.newId(), P1.newId()), "mgr")).code, 200);
  const relisted = await h.call("list-supplier-credits", { tenantId: T, bizId: B }, "mgr", "GET");
  mv = P1.monthView(F, decode(relisted.body.node), "2026-10", SUPS);
  const counted = mv.rows.filter((r) => r.counted);
  deq(counted.map((r) => [r.amount, r.amountText]).sort(), [["1000.39", "₪1,000.39"], ["88.8", "₪88.80"]]);
  const replacedRow = mv.rows.find((r) => !r.counted);
  assert.equal(replacedRow.amountText, "₪88.81", "the replaced record keeps its own exact amount in the history");
  assert.equal(mv.total, "1089.19"); assert.equal(mv.totalText, "₪1,089.19");
  return decode(relisted.body.node);
});

test("AGOROT-03 aggregation is exact: supplier net, month net purchases, Food Cost and P&L; issue-date attribution kept", async () => {
  const h = await apiHarness();
  for (const [sup, date, amount, doc] of [["s1", "2026-10-28", "88.81", "A-1"], ["s2", "2026-10-05", "1000.39", "A-2"]]) {
    const v = P1.validateForm(F, { supplierId: sup, issueDate: date, amount, documentNumber: doc, note: "" }, SUPS, null);
    assert.equal((await h.call("create-supplier-credit", P1.createBody(ctx, v.input, P1.newId(), P1.newId()), "mgr")).code, 200);
  }
  const credits = decode((await h.call("list-supplier-credits", { tenantId: T, bizId: B }, "mgr", "GET")).body.node);
  let n = 1; const id = () => `00000000-0000-4000-8000-${String(n++).padStart(12, "0")}`;
  const days = Array.from({ length: 28 }, (_, i) => `2026-10-${String(i + 1).padStart(2, "0")}`);
  const rows = [...days.map((d) => row(d, { sales: "1000", supplier_payments: { s1: "300.25", s2: "50" }, payroll: "100" }, id())),
    ...Array.from({ length: 30 }, (_, i) => row(`2026-09-${String(i + 1).padStart(2, "0")}`, { sales: "1000", supplier_payments: { s1: "300.25", s2: "50" }, payroll: "100" }, id()))];
  const src = { ...srcOf({ rows, asOf: "2026-10-29", config: present({}) }), credits };
  const sv = C1.suppliers(F, src, "2026-10", SUPS);
  // gross s1 = 28 × 300.25 = 8407; s2 = 28 × 50 = 1400; credits issued in October: s1 88.81, s2 1000.39
  assert.equal(sv.bySupplierId.s1.gross, "8407"); assert.equal(sv.bySupplierId.s1.credits, "88.81"); assert.equal(sv.bySupplierId.s1.amount, "8318.19");
  assert.equal(sv.bySupplierId.s2.credits, "1000.39"); assert.equal(sv.bySupplierId.s2.amount, "399.61");
  assert.equal(sv.total.amount, "8717.8"); assert.equal(sv.credits.amount, "1089.2");
  const dv = C1.dashboard(F, src, { nowMs: Date.parse("2026-10-29T09:00:00Z"), lastYearSales: null });
  assert.equal(dv.report.actual.purchases.value, "8717.8");
  assert.equal(dv.report.actual.purchasesPct.state, "value");
  const dec = F.finance.decimal;
  assert.equal(dec.ratCmp(dec.parseAmountString(dv.report.actual.purchasesPct.value), dec.ratMul(dec.ratDiv(dec.parseAmountString("8717.8"), dec.parseAmountString("28000")), dec.ratFromInt(100))), 0, "Food Cost on the exact net");
  const p = C1.pnl(F, src, "2026-10", null);
  assert.equal(p.rows.purchases.amount, "8717.8");
  // issue-date attribution: October credits never reduce September purchases
  const sep = C1.suppliers(F, src, "2026-09", SUPS);
  assert.equal(sep.bySupplierId.s1.amount, "9007.5"); assert.equal(sep.credits && sep.credits.amount, null);
});
