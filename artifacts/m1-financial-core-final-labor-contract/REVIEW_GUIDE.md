# Review guide — Codex focused re-review of the final successor commit

## Suggested order
1. `LABOR_FIXED_COST_CALCULATION_CONTRACT.md`: the contract being implemented.
2. `src/finance/labor.ts`, `src/policy/laborSource.ts`: the hourly source and the refusal of `hourly_payroll`.
3. `src/metrics/report.ts`:
   - `actualWindowDates` (D-1);
   - `validateCalendar`, `metricIssues` (missing only on operating days);
   - the global / config / calendar issue lists;
   - `typedAmount` with `empty_window`;
   - the typed `purchasesPct` and `fixedAccrual`.
4. `src/metrics/costTimeline.ts`: `accrueDay` (monthly / calendar days, every date) and `resolveTimeline` validation.
5. `src/metrics/adapters/configCompat.ts`: the global amount as employer cost, and missing / invalid / negative handling.
6. `src/finance/normalize.ts`: `hourlyLabor = payroll`; `legacyHourlyPayroll`.
7. `src/metrics/projected.ts`: `afterActual`, and null/warnings for unknown cost.
8. `src/metrics/adapters/legacyNumber.ts`: the daily labor view and the current-day refusal.
9. Tests:
   - `test/finance/golden/author_goldens.py`, where the hand arithmetic sits in comments next to the O-cases;
   - `test/finance/fincore-contract.test.mjs` ("owner contract test 7", "test 4", "labor contract", "window contract").

## Adversarial checks worth repeating
| Check | Expected |
|---|---|
| Any `open_month` with `asOf = X` | `window.to = X − 1`; changing or removing the X row never changes the serialized report |
| `asOf` = 1st of month | Every typed total is `empty_window` |
| Declared closed day without data | Complete; global and fixed accrue that day |
| Same data without the declaration | Missing |
| `hourly_payroll` in any shape, including invalid | Never changes labor, profit or labor % |
| Global employee listed with an empty amount | `missing_global_amount` ⇒ labor and profit incomplete, never 0 |
| Projection | Never mutates Actual; unknown global/fixed cost ⇒ `null` |

## Out of scope (by instruction)
- B1 and consumer migration (H1–H8 in `HOURLY_PAYROLL_FINDING.md`);
- `index.html` labels;
- Slice F persistence;
- closure-declaration input;
- live/same-day model;
- EV-1 execution;
- any Production access.
