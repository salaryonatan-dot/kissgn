# Change Summary — Financial Core Slice A Remediation R1

Branch `claude/m1-financial-core-slice-a`; parent `a8fdf2c8f1e13fa9ec6461a848e9f1f584415ff4` (not amended). Input: Codex review `marjin-reviews/2026-09-29/codex-financial-core-slice-a-review/` and owner clarifications of 2026-09-29 (labor = full employer cost from the attendance/workforce system, **entered manually** today; gross salary is never labor).

## P1-1 Employer-cost boundary
- New `src/finance/labor.ts` (`MARJIN_LABOR/1`): required `LaborSourceInput` {meaning `authoritative_employer_cost`, sourceSystem, ingestionMethod, scope, fields ⊆ payroll/hourly_payroll}; any other meaning is a contract error.
- New `src/policy/laborSource.ts`: product source = attendance_workforce / manual / all_staff / `payroll` + `hourly_payroll` (evidence: Employees screen "עלות כ״א יומית (מתוכנת נוכחות)").
- `costTimeline.ts`: salaried entries are `authoritative_employer_cost` (counted) or `gross_salary` (datum, never counted); gross-only days/employees reported.
- `configCompat.ts`: `monthlySalary` ("משכורת חודשית ברוטו") becomes a `gross_salary` datum; flag `gross_salary_not_labor_cost`; no conversion, no fallback.
- `report.ts`: `actual.labor = {contract, source, enteredEmployerCost, salariedEmployerCost, grossSalaryDatumPresent, employerCost, employerCostPct}`; removed `salaryAccrued`, `fullyLoadedLabor(Pct)`, `laborCostBasis`.
- `legacyNumber.ts`: `toDailyMetric(day, basis, laborSource)` adds `laborMeaning/SourceSystem/IngestionMethod`.
- R1.4 package amended (01, 02, 03, 05, 06, 00) + new `08_LABOR_EMPLOYER_COST_AMENDMENT.md` (evidence of the manual input path, residual ambiguities A-1/A-2 reported).

## P1-2 Incomplete profit
- `operatingProfit`, `contributionBeforeFixed`, `labor.employerCost` are `TypedAmount` (`complete` | `revenue_missing` | `incomplete_components` | `invalid_components`) with `issues`; the value is computed only when complete (required operands asserted non-null). Required daily: revenue, purchases, entered labor; optional other_expense (invalid counts); config coverage + invalid/missing rate/amount; salaried only for scope `excludes_salaried`.
- Labor % requires complete labor and revenue; `evaluatePolicy` does not evaluate goals on incomplete components; projection uses only a complete Actual; `formatTypedAmount` renders "—".

## P1-3 EV-1
- Classifier R2 `tools/finance-core/ev1-classifier.mjs` (pure) + `test/finance/ev1-classifier.test.mjs`: real calendar validation, identity census (valid/missing/malformed/duplicate incl. non-string), supplier/legacy census incl. negative, offsetting, invalid, legacy-only, collision variants, VD-23 drivers, presence classes, fail-closed input, safe output, cross-check with the core.
- `EV1_CONTRACT_R2.md` supersedes the readiness field list.

## P2
- EOF blank lines removed (`git diff --check` clean). Stale ref debris: analysed, recommendation only (HOUSEKEEPING_ANALYSIS.md).

## Self-review (independent read-only pass) — fixed before commit
missing percentage-rent/royalty rate or fixed amount treated as zero → `missing_rate` / `missing_fixed_amount` config issues; labor % on incomplete revenue → incomplete; goals evaluated on incomplete components → `not_evaluable`; salaried cost shown "0" when only gross exists → `null`; invalid revenue reported as `revenue_missing` → `invalid_components` precedence; labor source accepting arbitrary `fields` → restricted; EV-1 duplicate census ignoring non-string ids → counted. Reported, not changed (outside Slice A): `src/snapshot/snapshotBuilder.ts` and `index.html` still add gross salary to labor in today's runtime (VD-28, migrates in B2/C1); MTD profit is incomplete until today's entries exist (open owner decision, INCOMPLETE_PROFIT_CONTRACT.md).

## Golden expectation changes (contract-driven, all listed)
G-01 (profit now complete 9300 with labor = entered employer cost; gross salary flagged, not added), G-02/G-03/G-04/G-11…G-14/G-25c/G-29 (salaried accrual asserted on authoritative timeline entries with scope `excludes_salaried`), G-07d/G-07n/G-X3/G-X4 (typed profit), G-10/G-X2 (gross datum), G-15 (costs made complete to keep the explicit-zero real-loss case). New: R1-A…R1-P.

## Not changed
No `index.html`, `api/**`, `lib/**`, pre-existing `src/**`, Rules, schema, package or deploy change. No Production access, no EV-1 execution, no push.
