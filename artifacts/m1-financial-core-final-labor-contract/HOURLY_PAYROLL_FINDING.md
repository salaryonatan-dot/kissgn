# HOURLY_PAYROLL_FINDING

**Verdict: LEGACY_UNKNOWN.** The repository gives `hourly_payroll` a technical shape but no current, owner-recognised business meaning. Per the owner contract it is **not** a labor source and receives no new meaning. The Financial Core never counts it.

Evidence is read at base `f5d0a8ed`; `index.html` and all server code are unchanged on this branch.

## What the field is, technically
- An optional per-entry-row **map** `{ [employeeId]: amount }`.
- It was already present in the initial commit `2820fa7`, with the same UI.

## How it can be written today
| Site | Behaviour |
|---|---|
| `index.html:6944-6957` (entry form) | Shows an input per employee whose config `type === "hourly"`, under "עובדים שעתיים — הזן עלות יומית". It writes `form.hourly_payroll[emp.id]`. |
| `index.html:7835-7847` (Employees screen) | Add and edit **force `type: "global"`**. No current UI path creates a `type: "hourly"` employee (none in `2820fa7` either). |
| Consequence | The input only renders for legacy/imported config employees with `type: "hourly"`. Whether any business has such employees or stored values is unknown. EV-1 R3 now sizes this (see below). |

## What current consumers do with it (runtime, unchanged; flagged for consumer migration)
| # | Site | Current behaviour | Duplication risk under the owner contract |
|---|---|---|---|
| H1 | `index.html:4350-4359` `calcMetrics` | `totalPayroll += payroll + Σhourly_payroll` | **Yes.** It adds a second labor amount on top of the ShiftOrganizer figure. |
| H2 | `index.html:4409` `buildChart` | `pay = payroll + Σhourly_payroll` | Yes |
| H3 | `index.html:7140-7141` history DayCard | `exp = supp + payroll + hourlyPay + other` | Yes |
| H4 | `index.html:10804` DOW averages (`field === 'labor'`) | `payroll + Σhourly_payroll` | Yes |
| H5 | `src/repositories/analytics/dailyMetricsRepo.ts:47` | `laborCost = payroll + sumObj(hourly_payroll)` | Yes (server analytics/agent) |
| H6 | `src/repositories/analytics/laborRepo.ts:33-38` | `totalCost = payroll + hourly`; `employeeCount = keys(hourly_payroll) + (payroll>0)` | Yes |
| H7 | `src/analytics/dailyBuilder.ts:472-478` | `total_payroll = payroll_manual + hourly_payroll` | Yes |
| H8 | `src/snapshot/snapshotBuilder.ts:211-237` | `totalPayroll += totalHourlyPayroll` (plus global proration) | Yes |
| H9 | `src/alerts/checkers.ts:326-330` | Per-employee check over `hourly_payroll` values | Reads only; no sum into labor |
| H10 | `lib/entryDelta.js:15`, `index.html:5466` | Material-change field list for rebuild decisions | No (change detection only) |
| H11 | `index.html:6966-6970` entry-form "סה״כ שכר היום" | Shows `globalDaily + payroll`, **without** `hourly_payroll` | Already consistent with the contract |
| H12 | `index.html:7897` Employees screen daily total | `payroll + globalDailyTotal`, **without** `hourly_payroll` | Already consistent with the contract |

So the product is internally inconsistent today:
- The daily-total displays (H11, H12) ignore `hourly_payroll`.
- The aggregate/analytics paths (H1–H8) add it.

Under the owner contract the displays are right and H1–H8 would double-count whenever a row carries both fields.

The consumer migration list is recorded machine-readably in `test/finance/consumer-manifest.json` → `laborContractMigration`.

## What the Financial Core does (MARJIN_LABOR/2)
- `hourlyLabor = payroll` only (`src/finance/normalize.ts`).
- `hourly_payroll` is kept as `CanonicalDay.legacyHourlyPayroll = {counted: false, rows, byEmployee}` and flagged `legacy_hourly_payroll_not_counted` per row. Invalid cells are reported, but they never invalidate labor.
- `validateLaborSource` rejects any declaration of `hourly_payroll` (`legacy_labor_field_not_countable`).
- Report: `actual.labor.legacyHourlyPayroll = {counted: false, dates}`.
- Tests:
  - O-12 checks that `payroll` 1000 plus `hourly_payroll` {400, "abc"} gives labor 1000, complete.
  - O-12e checks that declaring `hourly_payroll` as a labor field is an error.
  - G-05 and R1-G check that it is kept but not counted.

## Evidence step (read-only, not executed)
EV-1 classifier R3 (`tools/finance-core/ev1-classifier.mjs`, `EV1/3`) adds the `legacyHourlyPayroll` census:
- rows with the map recorded;
- rows with **both** `payroll` and `hourly_payroll` (the double-count exposure);
- hourly-only rows;
- invalid cells.

The summary gives `businessesWithLegacyHourlyPayroll`, `totalLegacyHourlyPayrollRows` and `totalHourlyPayrollAndPayrollRows`. EV-1 has **not** been run against Production.
