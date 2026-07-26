# P0-DATA-01 R2 Change Summary

## Confirmed defects (all reproduced before any edit — Phase 1, temp analysis outside the repos)
1. **Suspect A — stale array-index edit identity (CONFIRMED, data loss).** `upsertEntryByDate(list, entry, replaceIndex)` removed the edited row by array position. Reproduced with the real vm-extracted helper: after hydration inserted `2026-06-30`, saving an edit of `2026-07-24`→`07-25` with the stale index **deleted `2026-07-01`** and left `07-24` behind; with the edited day already removed, the stale index **deleted unrelated `2026-07-30`**.
2. **Suspect B — replay doubles supplier payments (CONFIRMED, financial inflation).** The same complete daily record delivered twice canonicalized to supplierA `100→200` (revenue/payroll safe); same-key conflict summed `100+70→170`; `canonicalize(x+x) ≠ canonicalize(x)`. Downstream: supplier total → Food Cost → Food-Cost % → profit inputs all inflate, and the self-heal write-back would persist the inflated value. Also: complementary `hourly_payroll` keys from duplicate rows were dropped (first-object-wins).
3. **Suspect C — `saveRevenueStep` (CONFIRMED dead, removed).** Exactly one repository reference: its own declaration (`git grep` across the committed tree). Its `'suppliers'` step screen no longer exists; `setSupPay` was likewise declaration-only. It was an index-keyed append/replace writer — removed as a retained duplicate-shaped hazard (removal safe and scoped: zero references).
4. **Suspect D — lifecycle gaps (CONFIRMED).** `saveEntry` awaits the structured-exception API **before** persisting, and `persist`/`storage.set` resolve the tenant path at write time — a mid-save business/tenant switch could persist old-selection entries under the new selection's path; the post-persist state guard checked business only; listener callbacks/self-heal had no generation or tenant binding; the open edit context survived a selection switch; the last-year loader checked business only.

## Implementation (index.html only; helpers extended under the existing `window.MarjinEntries`)
- `mergeEntryMaps` (new): deterministic key union for `supplier_payments` **and** `hourly_payroll`; same key → earliest value wins; **values are never added**. Canonicalization is now idempotent and replay-safe: `canonicalize(x+x) === canonicalize(x)`.
- `upsertEntryByDate(list, entry, originalDate)`: third parameter is now the **original canonical business date** (stable edit identity captured at editor-open in `editingDateRef`); removal is by date only; a non-string third argument (legacy index) is ignored, making positional deletion structurally impossible.
- `saveEntry`: binds to `__saveForBizId` + `__saveForTenantId` at start; locates `__prevEntry` by original date (never `entries[editingId]`); **aborts before persist** if the selection changed mid-save; post-persist `setEntries` guarded on business AND tenant; clears the edit identity on success.
- Editor lifecycle: both editor-open sites capture `editingDateRef`; new-entry, cancel, save-success and **selection switch** clear it (switch also resets `editingId`).
- Listener lifecycle: per-effect `let live` generation flag + `tenantAtSetup`; every subscription callback ignores post-cleanup deliveries; the self-heal write-back runs only while `live` and on its own tenant; effect cleanup flips `live=false` before unsubscribing; last-year loader now checks business, tenant and liveness.
- `deleteEntryByDate` (new UI path): resolves the current index for the date fresh inside the click handler and delegates to the original (byte-identical) `deleteEntry`; the history row passes `e.date`, never a render index.
- Removed dead `saveRevenueStep` + `setSupPay`.

## Deliberately unchanged
Revenue/VAT/forecast/labor/food/fixed/profit/rounding formulas; business-date definition (exact local strings, no UTC); scalar merge precedence (earliest non-zero wins); the self-heal mechanism itself; RTDB schema/rules; dependencies; all other surfaces.

## Why this remains P0
Every change is confined to the dashboard entries lifecycle introduced/hardened by P0-DATA-01 (identity, canonicalization, persistence boundary, selection lifecycle). No shared financial core, no formula, no schema, no migration.
