# Final owner contract — labor, global employees, fixed costs, Actual window

- Commit: successor of `d83705f64995c5335d1e83fecf21bd4e74600552` on `claude/m1-financial-core-slice-a`.
- Scope: Financial Core only (`src/finance|metrics|policy|presenters`), the generated `fincore/v1`, tests, the EV-1 classifier and documentation.
- Untouched:
  - no consumer, `index.html`, `api/`, `lib/`, server repository, Rules, schema, `package.json` or `scripts/` change;
  - no Production access, EV-1 execution, push or deploy.

## Versions
`MARJIN_LABOR/1 → /2`, `MARJIN_FIN/1 → /2`, `MARJIN_PROJ/1 → /2`, `MARJIN_NORM/2 → /3`, `EV1/2 → EV1/3`. `MARJIN_DEC/1` and `MARJIN_PB/1` are unchanged.

## Code
| File | Change |
|---|---|
| `src/finance/labor.ts` | MARJIN_LABOR/2 contract. Hourly source `coverage: hourly_employees_only`, `sourceProduct`, `fields: ["payroll"]`. `hourly_payroll` is refused (`legacy_labor_field_not_countable`). Calendar-day allocation constants. |
| `src/policy/laborSource.ts` | Product policy `LABOR_SRC/shiftorganizer-hourly-manual/2026-09-29` |
| `src/finance/normalize.ts`, `types.ts` | `directLabor` → `hourlyLabor` = `payroll` only. `legacyHourlyPayroll` (uncounted) plus flag. New flag codes. `today_open`, `invalid_salary` and `gross_salary_not_labor_cost` removed. |
| `src/metrics/costTimeline.ts` | `salaried`/`SalariedEntry` (with the gross kind) → `globalEmployees`/`GlobalEmployeeEntry` (employer cost only, validated). Calendar-day accrual on every date. `revenueLinked` added. |
| `src/metrics/adapters/configCompat.ts` | Global `monthlySalary` → authoritative employer cost. Missing / invalid / negative amounts are typed. Non-global amounts are reported. |
| `src/metrics/report.ts` | Actual window D-1 (`actualWindowDates`, `ACTUAL_WINDOW_RULE`). Operating calendar (closed vs missing). Labor = hourly + global. Typed global, fixed and purchases %. `empty_window` state. Closed-day contradiction issue. Operating-day averages. |
| `src/metrics/projected.ts` | MARJIN_PROJ/2. Full-month global and fixed. `afterActual` (current day → month end). `null` + warnings for unknown global/fixed. Never touches Actual. |
| `src/metrics/adapters/legacyNumber.ts` | `toDailyMetric(day, basis, labor, timeline, {asOfBusinessDate, operatingCalendar?})`. Daily labor = hourly + global day allocation. The current day is refused. |
| `src/presenters/labels.ts` | Hebrew labels for hourly/global/closed/current day/`empty_window` |
| `tools/finance-core/ev1-classifier.mjs` | EV1/3: labor = `payroll`; `legacyHourlyPayroll` census and summary totals |
| `test/finance/consumer-manifest.json` | `laborContractMigration` list, H1–H8 plus proration and label sites (for B1/C1) |

## Tests
- Goldens re-authored by hand for D-1 and the labor contract; 107 cases (was 84).
- New cases:
  - O-01…O-20 (owner tests 1–12 and the self-review);
  - contract tests for test 7, the test 4 property, unknown-cost projection, labor contract v2 and the D-1 window;
  - EV-1 R3 census and core cross-check.

## Documents
- This folder:
  - `LABOR_FIXED_COST_CALCULATION_CONTRACT.md` (canonical);
  - `HOURLY_PAYROLL_FINDING.md`;
  - `GLOBAL_EMPLOYEE_DATA_FINDING.md`;
  - `OWNER_TEST_MATRIX.md`;
  - `SUPERSESSION.md`;
  - `SELF_REVIEW.md`;
  - `VERIFICATION.md`;
  - `REVIEW_GUIDE.md`.
- Supersession banners were added to the remediation R1 labor, incomplete-profit and EV-1 R2 docs.
- The R1.4 package (outside the repo) gains `09_LABOR_FIXED_COST_CALCULATION_CONTRACT.md`, with amendments to 00, 03, 05 and 08.
