# 05 — CD-M1 R2: close R1-F02-REM (daily ratios over an invalid revenue denominator)

This is a narrow successor to `8149bcea37aae9936a819aaaddc16b4a1dc71964`, which Codex re-reviewed as CHANGES_REQUIRED with 13 PASS, 1 FAIL and 0 BLOCKED. F-01 and F-03 were closed; F-02 was partially closed. The external handoff is `~/Documents/marjin-reviews/2026-09-30/cd-m1-r2/`.

## Defect

For a declared closure with non-zero revenue, the daily metric still exposed `laborPct:0` and `foodCostPct:0`, and `toAnalyticsFinancials` persisted them in `fin.derived`.

The cause was in `toDailyMetric`: it computed the ratios over the recorded revenue before the product marked the day `partial.revenue`.

## Fix

| Layer | Change |
|---|---|
| `src/metrics/adapters/legacyNumber.ts` `toDailyMetric` | A daily ratio needs a valid revenue denominator. That excludes a declared-closure conflict (closed day, recorded revenue ≠ 0) and a partial revenue. Otherwise `laborPct` and `foodCostPct` are `null`, the existing "unavailable" representation, never 0. The recorded `revenue` and every non-revenue value stay unchanged. |
| `src/finance-server/canonicalMetrics.ts` `toAnalyticsFinancials` | `fin.derived.laborPct` / `foodCostPct` are written only over a complete, non-contradicted revenue denominator. This is defence in depth on top of the null check: an unavailable ratio is **omitted**, never written as 0 or null. |
| generated | `fincore/v1` regenerated (`metrics/adapters/legacyNumber.js`, `MANIFEST.json`) |

## Directly related instance, corrected

A **partial** (partly invalid) revenue denominator had the same propagation defect in the same path. For example, one row with sales 100 and another with sales `abc` on the same date produced numeric ratios such as `laborPct 103.4…`, which were persisted. This case is now corrected and covered by R2-06.

Two cases are not changed: a numerator that is only partial, and other consumers. Those are outside this finding.

## Regression

`test/finance/cd-m1-r2-daily-ratio.test.mjs` (6 tests) follows one conflict fixture through four layers:
- the shared product, compared across server, browser and committed builds;
- the server canonical metrics, via the real loader;
- the real `dailyBuilder`, `saveAnalyticsDoc` and storage read-back;
- a JSON round-trip of the saved document.

Against `8149bcea`, 4 of the 6 tests fail on the defective values themselves (for example, "expected ~ / actual 0"). The two contrast tests pass by design:
- a legitimate 0 % over a valid revenue;
- an operating-day zero and a closed-day zero, both unchanged.

## Unchanged

- Forecast location, the `MARJIN_PROJ/2` ruling, and the ledger-loading contract.
- F-01 and F-03 (the R1 tests are kept, and R2-02 re-asserts both).
- No existing expectation or golden changed.
