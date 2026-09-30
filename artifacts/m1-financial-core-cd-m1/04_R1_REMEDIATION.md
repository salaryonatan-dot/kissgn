# 04 — CD-M1 R1: remediation of the Codex review of `77f8b7ae` (CHANGES_REQUIRED, 11/3/0)

This is a narrow successor with one parent, `77f8b7aef6723a983651991d92435a0544fc4a15`. It fixes only F-01, F-02 and F-03 from `cd-m1-codex-review/04_FINDINGS_AND_NEXT_READINESS.md`.

The accepted rulings are unchanged:
- REV_FORECAST/v2 stays in `src/metrics`.
- `MARJIN_PROJ/2` is kept.
- The ledger is read for `config || fixed`.

The external handoff is `~/Documents/marjin-reviews/2026-09-30/cd-m1-r1/`.

| Finding | Fix | Regression |
|---|---|---|
| **F-01** `not_loaded` treated as an empty closure calendar | `canonicalMonthReport` refuses `exceptionsState:"not_loaded"` with `FinanceContractError("exceptions_required")`, the same as `canonicalMonthProjection`.<br><br>The shared `productMonthReport` refuses `exceptionLedgerState:"not_loaded"` with `closure_calendar_not_loaded`.<br><br>`closureCalendarUnknown` now covers `unreadable` or `not_loaded`: the projection is refused and the daily global placement is unavailable.<br><br>Unchanged:<br>• `absent` stays the valid empty ledger;<br>• an omitted state still means the caller supplied the complete ledger (browser);<br>• no-cost readers still read no ledger. | R1-F01-a / b / c |
| **F-02** closure + non-zero revenue left revenue `complete:true` with no invalid date | **Report.** The recorded amount is kept; it is never zeroed or clamped. Otherwise:<br>• `actual.revenue.complete` becomes false;<br>• the date becomes an expected revenue date listed in `coverage.revenue.invalidDays`, and leaves `closedDays`; the declaration stays in `operatingCalendar.closedDates` and in the flag;<br>• an invalid `revenue` issue (`closed_day_has_recorded_values`) is added, so every revenue-dependent output is `invalid_components`;<br>• `revenuePerPresentDay` is `invalid_components`.<br><br>**Daily.** `partial.revenue` is set. The analytics doc drops the legacy revenue numbers and records `fin.revenue = {state:"closed_day_has_recorded_values", value}`.<br><br>**Forecast** (already correct): `partial` with `invalidRevenueDates`. | R1-F02-a / b / c; golden O-14 re-authored |
| **F-03** provenance said `operatingCalendar:"none_declared"` | `ServerProvenance.operatingCalendar` follows the ledger state:<br>• `present` or `absent` gives `entry_exception_closure` (`PRODUCT_CLOSURE_SOURCE`, imported, not retyped);<br>• `unreadable` or `not_loaded` gives `"unknown"`, with `exceptionsState` saying which. | R1-F03; B1 API-01 updated |

## Superseded test expectations

- **`b1-canonical-server-api`:**
  - The `month` helper and the direct month-report calls in API-21, API-24, API-25, API-27 and AT-18 now pass the loaded empty ledger (`exceptionsState:"absent"`). This is what the real loader returns once config or fixed costs are read.
  - B1R1-01 additionally asserts that the not-loaded month report is refused.
  - API-01's provenance literal changes from `none_declared` to `PRODUCT_CLOSURE_SOURCE`.
- **Golden O-14:** now also asserts:
  - the incomplete revenue total `1050`;
  - the invalid revenue date;
  - the revenue issue on profit;
  - invalid `revenuePerPresentDay` and `purchasesPct`.

## Release gate (not code; no tooling in this change)

A read-only compatibility preflight of existing closure records is required before release (Codex ruling 4). It must count:
- active structured `closure` dates and qualifying legacy fallback dates;
- dates with non-zero aggregate revenue;
- ambiguous multi-row legacy dates.

It must be done with no Production access from development, no mutation and no backfill.
