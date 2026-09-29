export const CURRENT_LABOR_SOURCE = Object.freeze({
    policyId: "LABOR_SRC/attendance-manual/2026-09-29",
    meaning: "authoritative_employer_cost",
    sourceSystem: "attendance_workforce",
    ingestionMethod: "manual",
    scope: "all_staff",
    fields: Object.freeze(["payroll", "hourly_payroll"]),
});
export function productLaborSource() {
    return CURRENT_LABOR_SOURCE;
}
