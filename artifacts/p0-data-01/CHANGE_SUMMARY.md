# P0-DATA-01 Change Summary

## Runtime changes (all inside the existing dashboard lifecycle in `index.html`)
1. **New shared pure helpers** `window.MarjinEntries` (frozen; defined beside `MarjinVat`):
   - `entryDateKey` — trimmed-string date key; no `Date()` parsing anywhere (2026-07-25 can never map onto 2026-07-24).
   - `mergeLegacyDuplicateEntries` — the previous listener's merge semantics preserved **verbatim** (earliest non-zero scalar wins — revenue never summed; `supplier_payments` summed per supplier to heal legacy split rows; first truthy non-numeric wins).
   - `canonicalizeEntries` — one row per date, sorted; undated rows dropped (matches previous listener behavior).
   - `upsertEntryByDate` — replace-by-date upsert; the edited row (by `editingId`) is removed first, so date-collision edits deterministically end with exactly one row; an explicit save wins wholesale.
2. **`saveEntry`** — the originating defect: index-keyed `[...entries, e]` append / positional replace replaced by `upsertEntryByDate(entries, entry, editingId)`. Also binds the save to the business it started for and guards the post-`await` `setEntries` with `activeBizIdRef` so a stale save cannot mutate a different selection.
3. **Entries listener** — now canonicalizes through the shared helper (identical precedence); wholesale state replacement and the self-heal write-back retained.
4. **`persist()`** — defensive keyed invariant at the central persistence boundary: every full-blob entries write is canonicalized first (covers save, delete, supplier-grid `setSupPayDate`, clear-all), with a console warning when rows were merged. The S0-sanctioned `storage.set` line is byte-identical.
5. **Business-switch guards** — `activeBizIdRef` tracks the live selection; the async initial `lastyear` load discards results that resolve after the business changed. Listener teardown already existed (effect cleanup unsubscribes all) and is unchanged.

## Explicit non-changes
- No revenue/forecast/labor/food/profit/rounding/baseline/VAT/fixed-cost formula changed; Labor Cost untouched.
- No RTDB schema, rules, stored-data migration or backfill; no S2/S4 module (`src/finance/*`, `src/metrics/*`, `computeMetrics`) created.
- No dependency, package or lockfile change; no other surface (Builder/Agent/Insights/Alerts/Snapshot/Email) touched.

## Files changed
- `index.html` (six scoped edits above)
- `test/dashboard/entries-lifecycle.test.mjs` (new, 16 tests)
- `artifacts/p0-data-01/*` (these seven documents)
