# P0-DATA-01 R2 Review Guide

- Base SHA: `74150537fbff208e54d5f7f5fb79a9d09a873706`
- Final SHA: see FILES_CHANGED/commit (subject `fix: harden entry date identity and replay safety`)
- Files: `index.html`, `test/dashboard/entries-lifecycle.test.mjs`, `artifacts/p0-data-01-r2/*`

## Highest-risk functions to review (search for "R2" in index.html)
1. `upsertEntryByDate` — third param is now the ORIGINAL DATE; verify a numeric arg is ignored and no positional filter remains.
2. `mergeEntryMaps` + `mergeLegacyDuplicateEntries` — key union, earliest-wins, no addition; applied to `supplier_payments` AND `hourly_payroll`.
3. `saveEntry` — `__saveForTenantId`/`__editingDate` capture; pre-persist abort guard; post-persist tenant+biz guard; `__prevEntry` by date.
4. useEffect 2 — `live` flag, `tenantAtSetup`, edit-context reset on switch, guarded sub wrapper, guarded self-heal, cleanup order.
5. `deleteEntryByDate` — fresh index resolution; original `deleteEntry` line byte-identical (S0 guard).
6. Removal of `saveRevenueStep`/`setSupPay` — verify zero references existed.

## Suggested adversarial scenarios (Codex)
- Open editor on day X; mutate entries via a second tab/listener echo (insert earlier date, delete X, create the target date); save with a changed date — assert no unrelated day is ever removed and exactly one row exists for the final date.
- Deliver the same raw blob row twice with every financial field populated, in different property orders — assert no field inflates and the self-heal writes the same canonical value.
- Switch business/tenant between save-click and persist (the exception `await` window) — assert nothing is persisted or set for the new selection.
- Attempt `upsertEntryByDate(list, entry, <number>)` — assert positional deletion is impossible.

## Expected invariant outcomes
One effective row per (tenant, business, date) in state, persistence, chart, MTD and history; explicit save wins wholesale; legacy merges never add amounts; canonicalization idempotent and replay-safe; async continuations selection-bound.
