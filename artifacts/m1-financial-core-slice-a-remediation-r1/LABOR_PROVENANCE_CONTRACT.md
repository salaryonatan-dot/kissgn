# Labor Provenance Contract — MARJIN_LABOR/1

| Item | Contract |
|---|---|
| **Current business truth source** | external attendance/workforce system |
| **Current canonical meaning** | full employer cost |
| **Current ingestion into Marjin** | **manual entry** on the entry-row fields `payroll` and `hourly_payroll` (no direct integration yet — a transport limitation, not a data gap) |
| **Financial Core responsibility** | consume the authoritative entered value; never calculate it from gross salary, net salary or an hourly wage; no uplift, no multiplier, no fallback |
| **Future source** | Marjin Workforce/Attendance (or a direct integration) may become the source (`sourceSystem: marjin_workforce`, `ingestionMethod: integration`) |
| **Semantic contract** | unchanged regardless of source migration (`meaning: authoritative_employer_cost`) |

## Repository evidence (base f5d0a8ed; files not modified by Slice A)
- `payroll`: Employees screen daily grid labelled **"עלות כ״א יומית (מתוכנת נוכחות)"** (daily labor cost from the attendance software), placeholder "₪ נוכחות", written by `submitLaborEntry` (`index.html:4599-4615`, `:7890-7906`); entry-form label "עלות שעתיים / נוכחות יומית נוספת (₪)" (`:6964`).
- `hourly_payroll{employeeId}`: entry form "עובדים שעתיים — הזן עלות יומית" (`:6947`).
- `employees[].monthlySalary`: **"משכורת חודשית ברוטו"** (gross monthly salary, `:7953-7954`) → gross datum, never labor.
- No attendance/workforce import code exists in `index.html`, `api/**`, `lib/**`, `src/**`.

## Types
```ts
interface LaborSourceInput {            // REQUIRED argument of computePeriodReport
  policyId: string;
  meaning: "authoritative_employer_cost";          // anything else ⇒ labor_source_not_employer_cost
  sourceSystem: "attendance_workforce" | "marjin_workforce";
  ingestionMethod: "manual" | "integration";
  scope: "all_staff" | "excludes_salaried";
  fields: string[];                                  // ["payroll","hourly_payroll"]
}
type SalariedEntry =
  | { employeeKey; kind: "authoritative_employer_cost"; monthlyAmount; sourceSystem; ingestionMethod }  // counts
  | { employeeKey; kind: "gross_salary"; monthlyAmount };                                             // datum only
```
Product policy `src/policy/laborSource.ts`: `LABOR_SRC/attendance-manual/2026-09-29` = attendance_workforce / manual / all_staff / payroll + hourly_payroll.

## Provenance distinctions (Codex list → contract)
| Required distinction | Representation |
|---|---|
| authoritative external attendance/workforce employer cost | `sourceSystem: attendance_workforce` (+ `ingestionMethod: manual` today) |
| future Marjin Workforce employer cost | `sourceSystem: marjin_workforce` |
| gross salary only | salaried entry `kind: gross_salary`; flag `gross_salary_not_labor_cost`; `labor.grossSalaryDatumPresent` |
| direct recorded labor amount with known semantics | the entered `payroll`/`hourly_payroll` values under the declared `LaborSourceInput` (`labor.enteredEmployerCost`) |
| missing / not recorded for a day | component issue `labor_employer_cost / missing / not_recorded` with dates |
| invalid | component issue `labor_employer_cost / invalid / invalid_or_partial_value`; `labor_source_*` contract errors for invalid source declarations |

## Report surface
`actual.labor = { contract, source, enteredEmployerCost (MetricTotal), salariedEmployerCost (null when scope all_staff), grossSalaryDatumPresent, employerCost (TypedAmount), employerCostPct (RatioResult incl. incomplete_components / invalid_components) }`. Legacy `DailyMetric` adds `laborMeaning`, `laborSourceSystem`, `laborIngestionMethod`.

## Scope and residual ambiguity
Scope `all_staff` follows the owner statement that the entered figure is the full employer cost. The product today also adds a prorated gross salary of "global" employees on top of `payroll` in its own UI arithmetic; the Financial Core does not (VD-28). Owner confirmation requested (R1.4 doc 08, A-1/A-2) that the entered figure covers salaried staff for every business and that `hourly_payroll` entries are employer cost. If a business enters only non-salaried staff, scope `excludes_salaried` requires authoritative salaried entries; gross never qualifies.
