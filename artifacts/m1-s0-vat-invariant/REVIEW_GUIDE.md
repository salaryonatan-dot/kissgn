# S0 VAT Invariant Review Guide

## Files To Review

- `index.html`
- `lib/whatsappMessages.js`
- `test/finance/vat-invariant.test.mjs`
- `artifacts/m1-s0-vat-invariant/`

## Review Focus

- Confirm the browser app still uses the existing standalone inline-script loading model.
- Confirm there is exactly one active VAT-rate literal in runtime source.
- Confirm gross daily-entry input is converted once before save and saved with `includeVat: false`.
- Confirm net-mode daily-entry input is not transformed.
- Confirm the dormant WhatsApp formatter treats `entry.total_sales` as already net.
- Confirm no migration, historical entry rewrite, RTDB rules/schema change, KPI change, or forecast change is present.

## Suggested Commands

```sh
node --test test/finance/vat-invariant.test.mjs
node --test test/forecast/revenue-forecast-ui.test.mjs test/forecast/revenue-forecast-p0.test.mjs
node --test test/**/*.test.mjs docs/production-readiness/test/*.test.mjs
./node_modules/.bin/tsc --noEmit
git diff --check
git diff --name-only 686b4350c6b6186c81d7f821d8c26a960428d30b..HEAD
```
