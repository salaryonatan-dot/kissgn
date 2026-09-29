// Financial Core B1 — purchase future-proofing (doc 07). Storage-independent contract: a day's
// purchases are the fold of ALL its contributions (zero or more per date, several from the
// same supplier allowed). Nothing assumes "one supplier = one value per date".
//   PF-01…06. Fixture rows are NormalizedRow literals (no entries storage, no supplier_payments).
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadCompiled } from "../support/fincore-load.mjs";
import { compileServer, makeDb, installDb, offlineFetch } from "../support/server-reader-harness.mjs";
import { AS_OF, T, B, entry, asLegacy, asV2, permutations, purchaseOnlyNormalizedRow, seedRaw, serverInputs, stableJson, uid } from "../support/b1-fixtures.mjs";

offlineFetch();
const F = await loadCompiled();
const srv = compileServer();
const PF = await srv.import("src/policy/productFinance.js");
const CM = await srv.import("src/finance-server/canonicalMetrics.js");
const DB = await srv.import("src/analytics/dailyBuilder.js");
const D = "2026-09-10";
const p1 = () => purchaseOnlyNormalizedRow(D, "supplier:A", "150", "p1");
const p2 = () => purchaseOnlyNormalizedRow(D, "supplier:A", "220", "p2");
const p3 = () => purchaseOnlyNormalizedRow(D, "supplier:B", "90", "p3");

test("PF-01 A150 + A220 + B90 on one date ⇒ purchases 460, bySource {A:370, B:90}, rowCount 3 (groupByDate over contributions)", () => {
  const [day] = F.finance.normalize.groupByDate([p1(), p2(), p3()], { from: D, to: D });
  assert.equal(F.finance.decimal.serializeDec(day.purchases.value), "460");
  assert.equal(day.purchases.presence, "present"); assert.equal(day.purchases.partial, false);
  assert.deepEqual(day.purchases.bySource, { "supplier:A": "370", "supplier:B": "90" });
  assert.equal(day.rowCount, 3);
});

test("PF-02 the same contributions + a revenue row through productDailyMetrics (asOf 2026-09-11) ⇒ purchases 460, foodCostPct 23", () => {
  // productDailyMetrics takes stored rows; the revenue row is a stored row, the purchases are the
  // same three contributions expressed as stored rows so the path is the real product composition
  const rows = [entry("r1", D, { sales: "2000" }), entry("p1", D, { supplier_payments: { A: "150" } }), entry("p2", D, { supplier_payments: { A: "220" } }), entry("p3", D, { supplier_payments: { B: "90" } })];
  const [m] = PF.productDailyMetrics({ rows, config: { state: "present", value: {} }, fixed: { state: "absent" }, asOfBusinessDate: "2026-09-11" }, { from: D, to: D });
  assert.equal(m.foodCost, 460); assert.equal(m.foodCostPct, 23); assert.equal(m.revenue, 2000);
  assert.equal(m.presence.purchases, "present"); assert.equal(m.partial.purchases, false);
  // and the NormalizedRow-literal fold agrees with the stored-row fold (storage independence)
  const [lit] = F.finance.normalize.groupByDate([p1(), p2(), p3()], { from: D, to: D });
  const stored = PF.productDays({ rows, config: { state: "present", value: {} }, fixed: { state: "absent" }, asOfBusinessDate: "2026-09-11" }, { from: D, to: D }).days[0];
  assert.deepEqual(stored.purchases.bySource, lit.purchases.bySource);
});

test("PF-03 every permutation and id assignment of PF-01 ⇒ byte-identical day serialization", () => {
  const amounts = [["supplier:A", "150"], ["supplier:A", "220"], ["supplier:B", "90"]];
  const out = new Set();
  for (const ids of permutations(["p1", "p2", "p3"])) for (const order of permutations([0, 1, 2])) {
    const rows = order.map((i) => purchaseOnlyNormalizedRow(D, amounts[i][0], amounts[i][1], ids[i]));
    const [day] = F.finance.normalize.groupByDate(rows, { from: D, to: D });
    out.add(stableJson({ v: day.purchases.value, s: day.purchases.bySource, n: day.rowCount, p: day.presence }));
  }
  assert.equal(out.size, 1);
});

test("PF-04 through the server wrappers and the persisted doc: 2 records (A 370, B 90), food_cost 460, fin.purchases.bySource array", async () => {
  const rows = [entry(uid(1), D, { sales: "2000" }), entry(uid(2), D, { supplier_payments: { A: "150" } }), entry(uid(3), D, { supplier_payments: { A: "220", B: "90" } })];
  const recs = CM.canonicalPurchaseRecords(serverInputs(rows, { asOf: "2026-09-11" }), { from: D, to: D }, { A: "Alpha" });
  assert.deepEqual(recs.map((r) => [r.date, r.source, r.supplierId, r.supplierName, r.amount, r.dayPurchases]), [[D, "supplier", "A", "Alpha", 370, "present"], [D, "supplier", "B", "ספק B", 90, "present"]]);
  for (const node of [asLegacy(rows), asV2(rows)]) {
    installDb(seedRaw(makeDb(), { entries: node }));
    const doc = await DB.buildAnalyticsForBiz(T, B, D, { nowMs: Date.UTC(2026, 8, 11, 9) });
    assert.equal(doc.revenue.food_cost, 460);
    assert.deepEqual(doc.fin.purchases.bySource, [{ source: "supplier:A", amount: "370" }, { source: "supplier:B", amount: "90" }]);
    assert.equal(doc.fin.purchases.value, "460");
  }
});

test("PF-05 a negative contribution (refund inside transactions) is kept, not clamped: A −50 ⇒ 410, A 320, flag negative_amount (VD-17; not a credit)", () => {
  const rows = [p1(), p2(), p3(), purchaseOnlyNormalizedRow(D, "supplier:A", "-50", "p4")];
  const [day] = F.finance.normalize.groupByDate(rows, { from: D, to: D });
  assert.equal(F.finance.decimal.serializeDec(day.purchases.value), "410");
  assert.deepEqual(day.purchases.bySource, { "supplier:A": "320", "supplier:B": "90" });
  assert.ok(day.flags.some((f) => f.code === "negative_amount"));
  // the same through stored rows (legacy storage reaches the same fold)
  const stored = [entry(uid(1), D, { supplier_payments: { A: "150" } }), entry(uid(2), D, { supplier_payments: { A: "220", B: "90" } }), entry(uid(3), D, { supplier_payments: { A: "-50" } })];
  const d2 = PF.productDays({ rows: stored, config: { state: "absent" }, fixed: { state: "absent" }, asOfBusinessDate: AS_OF }, { from: D, to: D }).days[0];
  assert.deepEqual(d2.purchases.bySource, { "supplier:A": "320", "supplier:B": "90" });
  assert.ok(d2.flags.some((f) => f.code === "negative_amount"));
});

test("PF-06 fixture drift guard: purchaseOnlyNormalizedRow has exactly the key set of a real normalizeRows row", () => {
  const real = F.finance.normalize.normalizeRows([entry("x1", D, { supplier_payments: { A: "1" } })], { asOfBusinessDate: AS_OF }).rows[0];
  const lit = purchaseOnlyNormalizedRow(D, "supplier:A", "1", "x1");
  assert.deepEqual(Object.keys(lit).sort(), Object.keys(real).sort());
  for (const k of ["metrics", "revenueParts", "legacyHourlyPayroll", "annotations"]) assert.deepEqual(Object.keys(lit[k]).sort(), Object.keys(real[k]).sort(), k);
  assert.deepEqual(Object.keys(lit.purchaseContributions[0]).sort(), Object.keys(real.purchaseContributions[0]).sort());
  assert.deepEqual(stableJson(lit.purchaseContributions), stableJson(real.purchaseContributions), "same exact Dec encoding");
});
