# Net-of-VAT Invariant

## Contract

All stored and calculated Marjin financial values are net of VAT.

Daily-entry gross mode is only an input convenience. When enabled, gross revenue inputs are converted to net values once before persistence with the current VAT rate of `1.18`. The persisted entry is written with `includeVat: false`.

Historical entries are already net and are not transformed by this slice.

## Single Source

The active VAT source for S0 is the browser-local `VAT_RATE = 1.18` constant in `index.html`.

This is browser-safe for the current app because `index.html` is a standalone document using CDN globals and inline scripts. The slice does not add browser ESM imports, a build system, bundling, or a runtime Firebase config dependency for VAT.

## Sanctioned Conversion Site

The only sanctioned VAT division is `grossToNetAmount(amount)`, used by the daily-entry gross mode before save and by the daily-entry preview.

Stored entries and dormant formatters must consume net values directly and must never divide stored revenue by VAT again.
