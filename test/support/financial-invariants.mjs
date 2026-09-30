// Financial Core — shared acceptance invariants INV-01…INV-14 (downstream preflight 07 §0).
// Created by B2; reused by C1 / F1. Pure synthetic fixtures (no EV-1 or Production data):
// each builder returns storage-shaped inputs { rows, config, fixed } for asOf 2026-09-29
// (Actual = 2026-09-01 … 2026-09-28). Consumers run them through THEIR surface (server
// snapshot, browser view model, …) and assert the stated expectation.
import { uid, entry, configWithGlobal, fixedItems, nowMsFor } from "./b1-fixtures.mjs";

export const INV_AS_OF = "2026-09-29";
export const INV_NOW_MS = nowMsFor(INV_AS_OF);
export const SEP_COMPLETED = Array.from({ length: 28 }, (_, i) => `2026-09-${String(i + 1).padStart(2, "0")}`);

let seq = 5000;
const id = () => uid(seq++);
/** A complete business day: revenue, a supplier purchase, hourly employer cost (`payroll`), other expense. */
export const fullDay = (date, over = {}) => entry(id(), date, { sales: "1000", deliveries: "0", other_income: "0", supplier_payments: { s1: "300" }, payroll: "100", other_expense: "0", ...over });
/** Every completed September day complete (the INV baseline). */
export const completeSeptember = (over = {}) => SEP_COMPLETED.map((d) => fullDay(d, over));
/** Global employees 3000 / month (full employer cost) — 100 per September day. */
export const GLOBAL_3000 = Object.freeze(configWithGlobal("3000"));
/** Fixed 3100 / month — 3100/30 per September day. */
export const FIXED_3100 = Object.freeze(fixedItems("3100"));

/**
 * The INV cases: `apply(rows)` derives the variant; `expect` names the contract result the
 * consumer must show. Consumers assert through their own surface.
 */
export const INVARIANTS = Object.freeze([
  { id: "INV-01", title: "Actual ends at D-1: a today row (added / changed / removed) leaves every Actual value byte-identical", variants: (base) => [base, [...base, fullDay(INV_AS_OF, { sales: "999999" })], [...base, fullDay(INV_AS_OF, { sales: "1" })]] },
  { id: "INV-02", title: "missing ≠ zero: a completed day without revenue ⇒ revenue coverage lists it; profit unavailable", apply: (base) => base.map((r) => (r.date === "2026-09-20" ? { ...r, sales: undefined, deliveries: undefined, other_income: undefined } : r)), missingRevenueDate: "2026-09-20" },
  { id: "INV-03", title: "explicit zero kept: sales 0 and supplier 0 / skip are present and complete", apply: (base) => base.map((r) => (r.date === "2026-09-10" ? { ...r, sales: "0", supplier_payments: { s1: "0", s2: "skip" } } : r)), zeroDate: "2026-09-10" },
  { id: "INV-04", title: "invalid ≠ zero: an unparsable cell is invalid, never folded in as 0", apply: (base) => base.map((r) => (r.date === "2026-09-11" ? { ...r, sales: "12,5" } : r)), invalidDate: "2026-09-11" },
  { id: "INV-05", title: "incomplete ⇒ unavailable: missing payroll makes labor, labor % and profit unavailable", apply: (base) => base.map((r) => (r.date === "2026-09-12" ? { ...r, payroll: undefined } : r)) },
  { id: "INV-06", title: "net of VAT: no reader converts; stored revenue is the shown revenue", apply: (base) => base },
  { id: "INV-07", title: "labor = payroll + global calendar-day allocation (payroll 200 + global 3000 in September ⇒ 300 / day)", apply: (base) => base.map((r) => ({ ...r, payroll: "200" })), perDayLabor: "300" },
  { id: "INV-08", title: "hourly_payroll is never counted", apply: (base) => base.map((r) => ({ ...r, hourly_payroll: { w1: "70" } })) },
  { id: "INV-11", title: "R-17: fixed node absent / [] ⇒ fixed 0 and complete; unreadable ⇒ invalid; enabled item without amount ⇒ missing", fixedStates: ["absent", "empty", "unreadable", "item_without_amount"] },
  { id: "INV-12", title: "no invented history: every report says current_applied_retrospectively (compat timeline)", apply: (base) => base },
  { id: "INV-13", title: "future rows quarantined", apply: (base) => [...base, fullDay("2026-10-05", { sales: "777777" })] },
  { id: "INV-14", title: "duplicate business dates aggregate, order- and id-independent", apply: (base) => [...base, fullDay("2026-09-05", { sales: "500", supplier_payments: { s1: "50" }, payroll: "20" })] },
]);

/** INV-09 / INV-10 month-length cases (a month is observed on its LAST day, so Actual = all days but the last). */
export const MONTH_LENGTHS = Object.freeze([
  { month: "2027-02", days: 28 }, { month: "2028-02", days: 29 }, { month: "2026-04", days: 30 }, { month: "2027-01", days: 31 },
]);
export const monthDates = (month, days) => Array.from({ length: days }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`);
export { nowMsFor };
