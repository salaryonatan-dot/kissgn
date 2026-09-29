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

export type LaborMeaning = "authoritative_employer_cost";
export type LaborSourceSystem = "attendance_workforce" | "marjin_workforce";
export type LaborIngestionMethod = "manual" | "integration";
/**
 * all_staff: the entered employer-cost figure covers every employee (salaried included);
 * excludes_salaried: salaried employees' employer cost must arrive as authoritative
 * salaried entries of the cost timeline (gross salary never qualifies).
 */
export type LaborScope = "all_staff" | "excludes_salaried";

/** Provenance of the labor amounts carried by entry rows (`payroll`, `hourly_payroll`). */
export interface LaborSourceInput {
  readonly policyId: string;
  readonly meaning: LaborMeaning;
  readonly sourceSystem: LaborSourceSystem;
  readonly ingestionMethod: LaborIngestionMethod;
  readonly scope: LaborScope;
  readonly fields: readonly string[];
}

const SYSTEMS: readonly string[] = ["attendance_workforce", "marjin_workforce"];
const METHODS: readonly string[] = ["manual", "integration"];
const SCOPES: readonly string[] = ["all_staff", "excludes_salaried"];
/** The entry-row fields that carry the entered employer cost. Gross-salary fields can never be declared. */
export const ENTRY_LABOR_FIELDS: readonly string[] = ["payroll", "hourly_payroll"];

/** Throws FinanceContractError unless the input declares an authoritative employer-cost source. */
export function validateLaborSource(input: unknown): LaborSourceInput {
  if (input === undefined || input === null) throw new FinanceContractError("labor_source_required");
  const i = input as Record<string, unknown>;
  if (typeof i !== "object") throw new FinanceContractError("labor_source_malformed");
  if (i.meaning !== "authoritative_employer_cost") throw new FinanceContractError("labor_source_not_employer_cost", i.meaning);
  if (typeof i.policyId !== "string" || i.policyId === "") throw new FinanceContractError("labor_source_malformed", "policyId");
  if (!SYSTEMS.includes(i.sourceSystem as string)) throw new FinanceContractError("labor_source_malformed", "sourceSystem");
  if (!METHODS.includes(i.ingestionMethod as string)) throw new FinanceContractError("labor_source_malformed", "ingestionMethod");
  if (!SCOPES.includes(i.scope as string)) throw new FinanceContractError("labor_source_malformed", "scope");
  if (!Array.isArray(i.fields) || i.fields.length < 1 || !i.fields.every((f) => ENTRY_LABOR_FIELDS.includes(f as string))) {
    throw new FinanceContractError("labor_source_malformed", "fields");
  }
  return input as LaborSourceInput;
}
