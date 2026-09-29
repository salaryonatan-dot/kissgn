// MARJIN_LABOR/1 — labor-cost source contract (owner decision, R1.4 amendment 2026-09-29).
//
// Canonical labor cost = FULL EMPLOYER COST. The business's authoritative figure comes from
// its attendance/workforce system and is entered into Marjin MANUALLY today (no direct
// integration). The Financial Core consumes that authoritative value; it never derives
// employer cost from gross salary, net salary or an hourly wage, and applies no uplift or
// payroll formula. A future integration or Marjin Workforce/Attendance module may change the
// transport (ingestionMethod / sourceSystem) but never the financial meaning.
import { FinanceContractError } from "./types.js";
export const LABOR_CONTRACT_VERSION = "MARJIN_LABOR/1";
const SYSTEMS = ["attendance_workforce", "marjin_workforce"];
const METHODS = ["manual", "integration"];
const SCOPES = ["all_staff", "excludes_salaried"];
/** The entry-row fields that carry the entered employer cost. Gross-salary fields can never be declared. */
export const ENTRY_LABOR_FIELDS = ["payroll", "hourly_payroll"];
/** Throws FinanceContractError unless the input declares an authoritative employer-cost source. */
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
    if (!METHODS.includes(i.ingestionMethod))
        throw new FinanceContractError("labor_source_malformed", "ingestionMethod");
    if (!SCOPES.includes(i.scope))
        throw new FinanceContractError("labor_source_malformed", "scope");
    if (!Array.isArray(i.fields) || i.fields.length < 1 || !i.fields.every((f) => ENTRY_LABOR_FIELDS.includes(f))) {
        throw new FinanceContractError("labor_source_malformed", "fields");
    }
    return input;
}
