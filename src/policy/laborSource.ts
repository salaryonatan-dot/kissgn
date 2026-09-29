// Current product labor source (FINAL owner contract 2026-09-29, MARJIN_LABOR/2):
// the authoritative daily FULL EMPLOYER COST of HOURLY employees comes from ShiftOrganizer
// (attendance system) and is entered into Marjin MANUALLY on the entry-row field `payroll`
// (Employees screen daily grid "עלות כ״א יומית (מתוכנת נוכחות)" and entry form
// "עלות שעתיים / נוכחות יומית נוספת (₪)", index.html f5d0a8ed:7890-7906, :6964).
// It excludes global/full-time employees, whose monthly employer cost comes from the
// Marjin employee configuration (src/metrics/adapters/configCompat.ts) and is allocated by
// calendar day. `hourly_payroll` is a legacy field and is never declared here.
import type { LaborSourceInput } from "../finance/labor.js";

export const CURRENT_LABOR_SOURCE: LaborSourceInput = Object.freeze({
  policyId: "LABOR_SRC/shiftorganizer-hourly-manual/2026-09-29",
  meaning: "authoritative_employer_cost" as const,
  sourceSystem: "attendance_workforce" as const,
  sourceProduct: "ShiftOrganizer",
  ingestionMethod: "manual" as const,
  coverage: "hourly_employees_only" as const,
  fields: Object.freeze(["payroll"]),
});

export function productLaborSource(): LaborSourceInput {
  return CURRENT_LABOR_SOURCE;
}
