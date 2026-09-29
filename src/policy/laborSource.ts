// Current product labor source (owner clarification 2026-09-29, R1.4 amendment):
// the business's authoritative FULL EMPLOYER COST from its attendance/workforce system is
// entered into Marjin MANUALLY, on the daily labor fields of the entry row:
//   - `payroll`        — Employees screen "עלות כ״א יומית (מתוכנת נוכחות)" / entry form
//                        "עלות שעתיים / נוכחות יומית נוספת (₪)" (index.html f5d0a8ed:7890, :6964)
//   - `hourly_payroll` — entry form "עובדים שעתיים — הזן עלות יומית" (:6947)
// There is no direct integration yet; that is a transport limitation, not a data gap.
// `employees[].monthlySalary` is labelled "משכורת חודשית ברוטו" (gross, :7953) and is NOT
// labor cost. Scope `all_staff` follows the owner statement that the entered figure is the
// full employer cost (see R1.4 08 — residual field-scope ambiguity is reported there).
import type { LaborSourceInput } from "../finance/labor.js";

export const CURRENT_LABOR_SOURCE: LaborSourceInput = Object.freeze({
  policyId: "LABOR_SRC/attendance-manual/2026-09-29",
  meaning: "authoritative_employer_cost" as const,
  sourceSystem: "attendance_workforce" as const,
  ingestionMethod: "manual" as const,
  scope: "all_staff" as const,
  fields: Object.freeze(["payroll", "hourly_payroll"]),
});

export function productLaborSource(): LaborSourceInput {
  return CURRENT_LABOR_SOURCE;
}
