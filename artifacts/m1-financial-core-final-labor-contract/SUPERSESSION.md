# What the FINAL owner contract (2026-09-29) supersedes

The earlier documents are kept for audit. Only the listed statements lose force. R1.2 and R1.3 are not modified.

| Earlier statement | Where | Now |
|---|---|---|
| Global labor accrues only when revenue exists / is allocated across operating days / a missing revenue day means zero global labor | Owner wording before the final contract; current product proration by entry count (`calcMetrics`, `snapshotBuilder`) | Calendar-day allocation on every calendar day, never conditioned on revenue (contract §3) |
| Current-day accrual belongs in Actual; "today live/open"; window `1 … asOf` inclusive; `today` block; flag `today_open` | R1.4 `03_BD3_CURRENT_PERIOD_RECOGNITION.md`; `MARJIN_FIN/1` | Actual through D-1; the current day is outside Actual (§6). `today`/`today_open` removed; `window.currentDay`/`completedThrough` added |
| `monthlySalary` is GROSS salary and never labor cost; `gross_salary` timeline kind; flag `gross_salary_not_labor_cost`; `grossSalaryDatumPresent` | R1.4 `08` table and contract; remediation R1 `LABOR_PROVENANCE_CONTRACT.md`; `MARJIN_LABOR/1` | Global monthly amount IS full employer cost (§1, §3); gross concept removed |
| Scope `all_staff` (entered figure covers everyone) / `excludes_salaried`; ambiguity A-1 | R1.4 `08` | Frozen coverage `hourly_employees_only`; global always added; no overlap. A-1 closed by the owner |
| `hourly_payroll` is part of the entered employer cost (summed with `payroll`); ambiguity A-2 | R1.4 `08`; `MARJIN_LABOR/1` fields `["payroll","hourly_payroll"]` | LEGACY_UNKNOWN, never counted (§2). A-2 closed by the owner |
| VD-01 clarification (salaried accrual only with scope `excludes_salaried`) | R1.4 `05` addendum | Global employer cost always accrues by calendar day |
| VD-28 (Financial Core does not add prorated gross salary) | R1.4 `05` addendum | VD-28 revised: the Financial Core adds the global monthly employer cost by calendar day. The product prorates by entry count and labels the input "ברוטו". Differences: calendar vs entry-count proration; label |
| VD-06 "fixed costs recognised through the current business date" | R1.4 `05` | Through the last completed day (D-1) |
| EV-1 R2 labor census (payroll + hourly_payroll) | remediation R1 `EV1_CONTRACT_R2.md` | EV-1 R3: labor = `payroll`; legacy `hourly_payroll` censused separately |
| Fixed accrual always a number; purchases % a value over incomplete components | `MARJIN_FIN/1` (Slice A / remediation R1) | Typed (TI-18 extension, self-review of this change) |

New visible differences:
- **VD-30:** Actual MTD excludes the current day, so the dashboard MTD shows through yesterday.
- **VD-31:** `hourly_payroll` is no longer added to labor.
- **VD-32:** Declared closed days are not missing, and they still carry global and fixed cost.

These are recorded in R1.4 `05` (addendum 2).
