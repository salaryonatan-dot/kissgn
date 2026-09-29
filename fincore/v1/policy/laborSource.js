export const CURRENT_LABOR_SOURCE = Object.freeze({
    policyId: "LABOR_SRC/shiftorganizer-hourly-manual/2026-09-29",
    meaning: "authoritative_employer_cost",
    sourceSystem: "attendance_workforce",
    sourceProduct: "ShiftOrganizer",
    ingestionMethod: "manual",
    coverage: "hourly_employees_only",
    fields: Object.freeze(["payroll"]),
});
export function productLaborSource() {
    return CURRENT_LABOR_SOURCE;
}
