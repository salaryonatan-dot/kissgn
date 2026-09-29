// MARJIN_LABOR/2 — labor and fixed-cost recognition contract (FINAL owner contract 2026-09-29,
// supersedes MARJIN_LABOR/1).
//
// CANONICAL DAILY LABOR COST = hourly employer cost + global employer cost allocation.
//   1. Hourly employer cost: the authoritative daily FULL EMPLOYER COST of HOURLY employees
//      from the attendance system (ShiftOrganizer), entered manually into Marjin on the entry
//      row field `payroll`. It excludes global/full-time employees.
//   2. Global employer cost: each global/full-time employee's MONTHLY amount entered in
//      Marjin IS full employer cost (not gross, not net, no multiplier). It is allocated by
//      CALENDAR DAY: monthly / calendar days of the month, on every calendar day — closed days
//      included, never conditioned on revenue, never divided by operating days.
//   The two sources never overlap. The core applies no payroll formula, uplift or conversion.
// Fixed costs (rent, arnona, subscriptions, accounting, …) are allocated the same way:
// monthly / calendar days, on every calendar day.
// `hourly_payroll` is a LEGACY field with no current owner-recognised meaning: it is never a
// labor source, never added to labor cost, and is only reported as an uncounted datum.
import { FinanceContractError } from "./types.js";
export const LABOR_CONTRACT_VERSION = "MARJIN_LABOR/2";
const SYSTEMS = ["attendance_workforce", "marjin_workforce"];
const METHODS = ["manual", "integration"];
/** The only entry-row field that carries counted labor cost. */
export const ENTRY_LABOR_FIELDS = ["payroll"];
/** Legacy entry-row labor-like fields that are NEVER counted (meaning unknown; see R1.4 09). */
export const LEGACY_UNCOUNTED_LABOR_FIELDS = ["hourly_payroll"];
export const GLOBAL_COST_ALLOCATION = "calendar_days";
export const FIXED_COST_ALLOCATION = "calendar_days";
/** Throws FinanceContractError unless the input declares the frozen hourly employer-cost source. */
export function validateLaborSource(input) {
    if (input === undefined || input === null)
        throw new FinanceContractError("labor_source_required");
    const i = input;
    if (typeof i !== "object")
        throw new FinanceContractError("labor_source_malformed");
    if (i.meaning !== "authoritative_employer_cost")
        throw new FinanceContractError("labor_source_not_employer_cost", i.meaning);
    if (typeof i.policyId !== "string" || i.policyId === "")
        throw new FinanceContractError("labor_source_malformed", "policyId");
    if (!SYSTEMS.includes(i.sourceSystem))
        throw new FinanceContractError("labor_source_malformed", "sourceSystem");
    if (typeof i.sourceProduct !== "string" || i.sourceProduct === "")
        throw new FinanceContractError("labor_source_malformed", "sourceProduct");
    if (!METHODS.includes(i.ingestionMethod))
        throw new FinanceContractError("labor_source_malformed", "ingestionMethod");
    if (i.coverage !== "hourly_employees_only")
        throw new FinanceContractError("labor_source_malformed", "coverage");
    if (!Array.isArray(i.fields))
        throw new FinanceContractError("labor_source_malformed", "fields");
    if (i.fields.some((f) => LEGACY_UNCOUNTED_LABOR_FIELDS.includes(f)))
        throw new FinanceContractError("legacy_labor_field_not_countable", "hourly_payroll");
    if (i.fields.length !== ENTRY_LABOR_FIELDS.length || !ENTRY_LABOR_FIELDS.every((f) => i.fields.includes(f))) {
        throw new FinanceContractError("labor_source_malformed", "fields");
    }
    return input;
}
