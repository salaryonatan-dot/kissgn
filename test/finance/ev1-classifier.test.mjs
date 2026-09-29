// EV-1 classifier R2 — fixture-only tests (no network, no credentials, no Production).
// Covers the Codex EV-1 review gaps: real calendar validation, identity census (valid,
// missing, malformed, duplicate), supplier/legacy census incl. negative and offsetting maps,
// legacy-only food_cost, VD-23 drivers, fail-closed input, safe output, and a cross-check
// against the Financial Core (compiled source and committed artifact).
import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyBusiness, summarize, dateState, idState, cellState, Ev1InputError } from "../../tools/finance-core/ev1-classifier.mjs";
import { bothCores } from "../support/fincore-load.mjs";

const U = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const AS_OF = "2028-03-10";

test("EV1 calendar: real Gregorian validation, not a regex", () => {
  assert.equal(dateState("2028-02-29"), "valid", "valid leap day");
  assert.equal(dateState("2027-02-29"), "impossible_date", "invalid leap day");
  assert.equal(dateState("2100-02-29"), "impossible_date", "century non-leap");
  assert.equal(dateState("2000-02-29"), "valid", "400-year leap");
  assert.equal(dateState("2026-02-30"), "impossible_date");
  assert.equal(dateState("2026-02-31"), "impossible_date");
  assert.equal(dateState("2026-13-01"), "impossible_date", "invalid month");
  assert.equal(dateState("2026-00-10"), "impossible_date", "month zero");
  assert.equal(dateState("2026-04-31"), "impossible_date", "invalid day");
  assert.equal(dateState("2026-04-00"), "impossible_date", "day zero");
  assert.equal(dateState("2026-4-1"), "bad_shape");
  assert.equal(dateState(" 2026-04-01"), "bad_shape");
  assert.equal(dateState(20260401), "bad_shape");
});

test("EV1 identity states", () => {
  assert.equal(idState(U(1)), "valid");
  assert.equal(idState(undefined), "missing");
  assert.equal(idState(""), "missing");
  assert.equal(idState(null), "missing");
  assert.equal(idState("abc"), "malformed");
  assert.equal(idState("ABCDEF01-0000-4000-8000-00000000000A"), "malformed", "uppercase is not canonical");
  assert.equal(idState(42), "malformed");
  assert.equal(idState("00000000-0000-1000-8000-000000000001"), "malformed", "not v4");
});

test("EV1 cells mirror MARJIN_DEC/1", () => {
  assert.equal(cellState("0.00", false).state, "zero");
  assert.equal(cellState("-0", false).state, "zero");
  assert.equal(cellState("-40", true).state, "negative");
  assert.equal(cellState("1,234", false).state, "positive");
  assert.deepEqual(cellState("12,5", false), { state: "invalid", reason: "ambiguous_comma" });
  assert.deepEqual(cellState(true, false), { state: "invalid", reason: "wrong_type" });
  assert.deepEqual(cellState(0.30000000000000004, false), { state: "invalid", reason: "out_of_range" });
  assert.deepEqual(cellState("skip", false), { state: "invalid", reason: "bad_grammar" });
  assert.equal(cellState("skip", true).state, "skip");
  assert.equal(cellState("  ", false).state, "absent");
});

const FIXTURE = [
  { id: U(1), date: "2028-03-01", sales: "1000", supplier_payments: { s1: "300" }, payroll: "200" },                 // clean
  { id: U(2), date: "2028-03-02", supplier_payments: { s1: "0" }, food_cost: "70" },                                  // collision, supplier zero, selection changes
  { id: U(3), date: "2028-03-03", supplier_payments: { s1: "skip" }, food_cost: "70" },                               // collision, skip, selection changes
  { id: U(4), date: "2028-03-04", supplier_payments: { s1: "100" }, food_cost: "0" },                                 // collision, food zero, same selection
  { id: U(5), date: "2028-03-05", food_cost: "90", sales: "500" },                                                    // legacy-only food
  { id: U(6), date: "2028-03-06", food_cost: "abc", sales: "500" },                                                   // legacy food invalid
  { id: U(7), date: "2028-03-07", supplier_payments: { s1: "12,5" }, sales: "500" },                                  // supplier invalid
  { id: U(8), date: "2028-03-08", supplier_payments: { s1: "100", s2: "-100" }, sales: "500" },                       // offsetting + negative
  { id: U(9), date: "2028-03-09", notes: "closed for inspection" },                                                   // notes-only
  { id: U(10), date: "2028-03-09", sales: "" },                                                                       // empty row (no financial value)
  { id: U(11), date: "2028-03-10", sales: 0.30000000000000004 },                                                      // malformed financial (invalid only)
  { id: U(12), date: "2028-03-10", supplier_payments: [5], payroll: "0" },                                            // malformed map shape + labor zero
  { id: U(13), date: "2028-03-10", sales: "0", payroll: "0" },                                                        // zero-only, revenue zero
  { id: U(14), date: "2028-03-10", hourly_payroll: { w1: "50" } },                                                    // hourly-only
  { id: U(15), date: "2028-03-10", other_income: "20" },                                                              // other-income-only
  { id: U(16), date: "2028-03-10", other_expense: "15" },                                                             // other-expense-only
  { id: U(17), date: "2028-03-10", supplier_payments: { s1: "100" }, food_cost: "zz" },                               // supplier + invalid legacy
  { date: "2028-03-01", sales: "1" },                                                                                 // missing id
  { id: "not-a-uuid", date: "2028-03-01", sales: "1" },                                                               // malformed id
  { id: U(20), date: "2028-03-01", sales: "1" },                                                                      // duplicate id (1/2)
  { id: U(20), date: "2028-03-02", sales: "2" },                                                                      // duplicate id (2/2)
  { id: U(21), date: "2027-02-29", sales: "1" },                                                                      // invalid leap day
  { id: U(22), date: "2028-02-29", sales: "1" },                                                                      // valid leap day
  { id: U(23), date: "2026-13-01", sales: "1" },                                                                      // invalid month
  { id: U(24), date: "2026-04-31", sales: "1" },                                                                      // invalid day
  { id: U(25), date: "03/01/2028", sales: "1" },                                                                      // bad shape
  { id: U(26), date: "2028-04-01", sales: "1" },                                                                      // future
  "garbage",                                                                                                          // malformed row
];

test("EV1 R2 census over the adversarial fixture", () => {
  const r = classifyBusiness(FIXTURE, AS_OF);
  assert.equal(r.classifier, "EV1/2");
  assert.equal(r.rowsTotal, 28);
  assert.equal(r.malformedRows, 1);
  assert.deepEqual(r.identity, { validIds: 25, missingIds: 1, malformedIds: 1, duplicateIdRows: 2, duplicateIdValues: 1, duplicateIds: [U(20)] });
  assert.deepEqual(r.dates, { validDateRows: 23, badShapeDateRows: 1, impossibleDateRows: 3, futureRows: 1, actualWindowRows: 22, duplicateDateDates: 4 });
  assert.deepEqual(r.supplier, {
    rowsWithSupplierRecorded: 6, rowsWithExplicitZeroCell: 1, rowsWithSkipCell: 1, rowsWithNegativeCell: 1, rowsWithInvalidCell: 1,
    rowsWithOffsettingNonzeroCells: 1, invalidMapShapeRows: 1,
    cells: { zero: 1, skip: 1, positive: 4, negative: 1, invalid: 1 },
  });
  assert.deepEqual(r.legacyFood, { presentPositiveRows: 3, presentNegativeRows: 0, presentZeroRows: 1, invalidRows: 2, legacyOnlyRows: 1 });
  assert.deepEqual(r.vd16, { supplierRecordedAndLegacyFoodRecorded: 3, ofWhichSelectionChanges: 2, supplierRecordedAndLegacyFoodInvalid: 1, rowIds: [U(2), U(3), U(4)] });
  assert.deepEqual(r.labor, { rowsWithLaborPresent: 4, rowsWithLaborZero: 2, rowsWithLaborInvalid: 0, invalidHourlyMapShapeRows: 0 });
  assert.deepEqual(r.presence, { noFinancialValueRows: 3, notesOnlyRows: 1, emptyRows: 1, invalidOnlyRows: 1, rowsWithInvalidFinancialCell: 5 });
  assert.deepEqual(r.vd23, {
    rowsZeroOnlyPresent: 4, rowsNotEnteredTodayButPresentNow: 5, // zero-only: U2,U3 (supplier wins), U12, U13; not-entered-today: U12–U16
    revenueZeroRows: 1, laborOnlyRows: 2, hourlyOnlyRows: 1, otherIncomeOnlyRows: 1, otherExpenseOnlyRows: 1, purchasesOnlyRows: 4,
  });
  assert.deepEqual(r.invalidCellsByReason, { ambiguous_comma: 1, bad_grammar: 2, out_of_range: 1, invalid_map_shape: 1 });
  assert.deepEqual(r.invalidCellsByField, { food_cost: 2, sales: 1, supplier_payments: 2 });
});

test("EV1 R2 duplicate census includes non-string ids", () => {
  const r = classifyBusiness([{ id: 7, date: "2028-03-01" }, { id: 7, date: "2028-03-02" }, { id: "7", date: "2028-03-03" }, { id: U(1), date: "2028-03-01" }, { id: U(1), date: "2028-03-02" }], AS_OF);
  assert.deepEqual(r.identity, { validIds: 2, missingIds: 0, malformedIds: 3, duplicateIdRows: 4, duplicateIdValues: 2, duplicateIds: [U(1)] });
});

test("EV1 R2 output is safe: counts and canonical row UUIDs only", () => {
  const r = classifyBusiness(FIXTURE, AS_OF);
  const text = JSON.stringify(r);
  for (const leak of ["closed for inspection", "not-a-uuid", "12,5", "0.30000000000000004", "03/01/2028", "2028-03", "2027-02-29", "1000", "300", "garbage", "zz"]) {
    assert.equal(text.includes(leak), false, "leaks " + leak);
  }
  const ids = text.match(/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/g) || [];
  assert.ok(ids.every((x) => idState(x) === "valid"));
});

test("EV1 R2 fails closed on non-evidence input", () => {
  const code = (fn) => { try { fn(); } catch (e) { return e instanceof Ev1InputError ? e.code : "other"; } return null; };
  assert.equal(code(() => classifyBusiness(null, AS_OF)), "rows_not_array");
  assert.equal(code(() => classifyBusiness({ _v: "[]" }, AS_OF)), "rows_not_array");
  assert.equal(code(() => classifyBusiness([], "2028-02-30")), "invalid_as_of");
  assert.equal(code(() => classifyBusiness([], undefined)), "invalid_as_of");
  assert.equal(summarize([], []).evidenceComplete, false, "no business classified");
  assert.equal(summarize([{ result: classifyBusiness([], AS_OF) }], [{ scope: "entries", tenantId: "t", bizId: "b", code: "read_failed" }]).evidenceComplete, false);
  assert.equal(summarize([{ result: classifyBusiness([], AS_OF) }], undefined).evidenceComplete, false, "unknown failures ⇒ incomplete");
  const ok = summarize([{ result: classifyBusiness(FIXTURE, AS_OF) }], []);
  assert.equal(ok.evidenceComplete, true);
  assert.equal(ok.businessesWithDuplicateIds, 1);
  assert.equal(ok.businessesWithImpossibleDates, 1);
  assert.equal(ok.totalSelectionChanges, 2);
});

const cores = await bothCores();
for (const [label, F] of cores) {
  test(`EV1 R2 cross-check with the Financial Core [${label}]`, () => {
    // duplicate id: the core rejects the dataset; EV-1 must report it
    assert.throws(() => F.finance.normalize.normalizeRows([{ id: U(20), date: "2028-03-01" }, { id: U(20), date: "2028-03-02" }], { asOfBusinessDate: AS_OF }), (e) => e.code === "duplicate_row_id");
    // everything else: same VD-16 rows, same quarantine classes
    const noDup = FIXTURE.filter((r) => !(r && r.id === U(20)));
    const n = F.finance.normalize.normalizeRows(noDup, { asOfBusinessDate: AS_OF });
    const ev = classifyBusiness(noDup, AS_OF);
    const coreVd16 = n.rows.flatMap((x) => x.flags).filter((f) => f.code === "supplier_and_legacy_food_both").map((f) => f.rowId).sort();
    assert.deepEqual(coreVd16, ev.vd16.rowIds, "same VD-16 collision rows");
    assert.equal(n.quarantine.futureRows.length, ev.dates.futureRows);
    const coreInvalidDates = n.flags.filter((f) => f.code === "invalid_date_row").length;
    assert.equal(coreInvalidDates, ev.dates.impossibleDateRows + ev.dates.badShapeDateRows, "core quarantines exactly the dates EV-1 rejects");
  });
}
