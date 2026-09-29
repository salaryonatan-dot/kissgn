# Self-review (independent adversarial pass before commit)

An independent reviewer probed the compiled core against the owner contract. No leak of the current day into Actual was found, and `hourly_payroll` was never counted. The reviewer's findings and their dispositions (all fixed in this commit unless noted):

| # | Sev | Finding | Disposition |
|---|---|---|---|
| 1 | P1 | `purchasesPct` (food cost %) was a value even when revenue or purchases were missing on a completed day. This predates the change but violates "missing data inside the completed window ⇒ incomplete". | **Fixed.** `PurchasesPct` gains `incomplete_components` / `invalid_components` / `empty_window`. Cases: G-07d, G-07n, O-10. |
| 2 | P2 | `fixedAccrual` was always numeric, even with uncovered dates or missing/invalid fixed configuration. | **Fixed.** Now typed (`state`, `issues`, amounts `null` unless complete); a % rent/royalty also requires complete revenue. Cases: O-18, O-19, G-03. |
| 3 | P2 | `toDailyMetric` (a) ignored declared closed days, (b) accepted the current day, (c) went to 0 when global was unknown. | **Fixed:** (a) and (b). It now requires `{asOfBusinessDate, operatingCalendar?}`; a closed day's labor = global allocation (O-20); the current day and later raise `day_outside_actual`. (c) is **kept by design**: `laborCost` is canonical daily labor, so when incomplete it is `0` for old readers only, with `laborCostComplete: false` and `hourlyLaborCost` still carrying the hourly amount. |
| 4 | P2 | A negative global monthly amount was accepted as employer cost. | **Fixed.** `invalid_global_amount` (`negative_amount`) in the compat adapter; a contract error in a recorded timeline (O-17, O-17e). |
| 5 | P3 | Projection fixed could show `0` with invalid fixed configuration. | **Fixed.** `fixed` / `afterActual.fixedRegularAndRent` are `null` with `fixed_cost_unavailable` (contract test). |
| 6 | P3 | EV-1 counted an invalid legacy `hourly_payroll` cell as an invalid *financial* row. | **Fixed.** It is censused in `legacyHourlyPayroll` / by-field only. |
| 7 | P3 | Non-global employees with an amount were silently skipped. | **Fixed.** Reported with `employee_amount_not_global` (never counted); G-X2. |
| 8 | P3 | With no calendar every day is an operating day. | **Kept, documented** (contract §5). This is "no closure declared", not a 365-day rule: closure must be declared and is never inferred. The source is visible as `operatingCalendar.source: "none_declared"`. |
| 9 | P3 | Per-present-day averages counted closed days. | **Fixed.** The denominator is recorded **operating** days. |
