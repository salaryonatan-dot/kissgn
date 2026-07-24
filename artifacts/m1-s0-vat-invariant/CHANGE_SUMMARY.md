# Marjin 1.0 S0 VAT Invariant Change Summary

## Runtime Changes

- Kept a single active `VAT_RATE = 1.18` source in `index.html`.
- Added a browser-local helper in the existing inline app script to normalize gross daily-entry revenue fields to net values before persistence.
- Updated daily-entry save and preview paths to use the helper instead of repeating VAT division.
- Removed the dormant WhatsApp daily report double-conversion of stored `total_sales`.

## Test Changes

- Added `test/finance/vat-invariant.test.mjs`.
- The test covers gross mode conversion, net mode preservation, WhatsApp formatting, runtime VAT literal/operator guardrails, and diff-scope guardrails against historical-data transforms.

## Explicit Non-Changes

- No migration or historical entry rewrite.
- No RTDB schema or rules change.
- No KPI, analytics, forecast, repository, agent, or snapshot formula change.
- No dependency or package metadata change.
