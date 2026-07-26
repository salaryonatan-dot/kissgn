# P0-DATA-01 Review Guide

## Files to review
- `index.html` — six scoped edits (search for `P0-DATA-01`):
  1. `window.MarjinEntries` helper block (beside `window.MarjinVat`).
  2. `saveEntry`: `upsertEntryByDate(entries, entry, editingId)` replaces the index-keyed append/replace; `__saveForBizId` capture; guarded post-await `setEntries`.
  3. Entries listener: `canonicalizeEntries(val)` + retained self-heal write-back.
  4. `persist()`: canonicalize-before-write defensive boundary (S0 `storage.set` line byte-identical).
  5. `activeBizIdRef` declaration + effect wiring.
  6. Stale-`lastyear`-load guard.
- `test/dashboard/entries-lifecycle.test.mjs` — 16 tests (vm-extracts the real inline helpers; incident fixture ₪580,483/₪27,753/₪608,236).
- `artifacts/p0-data-01/` — these documents.

## Review focus
- Confirm identity is business-date (string) + storage-path scope — never array position or amount.
- Confirm precedence: explicit save wins wholesale; legacy merge never sums revenue.
- Confirm no formula/labor/VAT/schema/package change (diff containment) and that the S0 VAT guard still passes 5/5.
- Confirm chart + MTD still consume the single `monthEntries` collection.

## Suggested commands
```sh
node --test test/dashboard/entries-lifecycle.test.mjs
node --test test/finance/vat-invariant.test.mjs
node --test test/forecast/revenue-forecast-ui.test.mjs test/forecast/revenue-forecast-p0.test.mjs
node --test test/**/*.test.mjs docs/production-readiness/test/*.test.mjs
./node_modules/.bin/tsc --noEmit          # use --preserveSymlinks if node_modules is symlinked
git diff --check
git diff --name-only b16f5567c0b0f09b14a68e236b9baf781a9d19e8..HEAD
```
