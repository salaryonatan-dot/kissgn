# P0-DATA-01 R2 — Root Cause & Invariants

## Original incident (context)
`saveEntry` new-entry mode appended `[...entries, e]` without date identity; MTD/chart counted every row (₪580,483 + ₪27,753 = ₪608,236); the listener healed RTDB but the post-await `setEntries(updated)` re-applied the raw duplicate; refresh loaded the clean blob. Closed by the original P0 commit (74150537) via date-keyed upsert + canonicalization.

## R2 reproductions (real vm-extracted helper, pre-edit)
- **Stale index:** state `[07-01, 07-24]`, editor open on `07-24` (editingId=1); hydration inserts `06-30` → canonical `[06-30, 07-01, 07-24]`; save `07-24→07-25` with index 1 → result `[06-30, 07-24, 07-25]` — **07-01 deleted, 07-24 retained**. Variant with the edited day already gone deleted unrelated **07-30**. Correct outcomes occurred only when the index happened to still align.
- **Replay:** `{date:2026-07-24, sales:27753, supplier_payments:{supplierA:100}, payroll:500}` delivered twice → supplierA **200**; same-key conflict `100/70` → **170**; property-order variants identical; `canonicalize∘canonicalize` was idempotent but `canonicalize(x+x)` was not `canonicalize(x)`.

## Final identity model
- **Row identity:** (tenant, business) from the storage path + **canonical local business date** (trimmed exact string; no `Date()` parsing; `2026-07-24` ≠ `2026-07-25` always).
- **Edit identity:** the original canonical date captured at editor-open (`editingDateRef`), invalidated on new-entry/cancel/success/selection-switch. `editingId` (index) survives only as display convenience and can no longer affect logical mutation.

## Precedence rules (documented, deterministic)
1. **Explicit save wins wholesale** for its final date: the saved entry replaces both the row at its original date and any row already at the final date. No field merging, no arithmetic.
2. **Legacy hydrated duplicates** (same date twice in a stored blob): earliest row wins for non-zero scalars (revenue, payroll — never summed); zero/missing scalars are filled by later rows; nested maps (`supplier_payments`, `hourly_payroll`) merge by key union with earliest-value-wins per key — **a repeated key is never added**; non-numeric fields: first truthy wins; undated rows are dropped.
3. **Idempotency law:** `canonicalize(canonicalize(x)) = canonicalize(x)` and `canonicalize(x + x) = canonicalize(x)` (asserted in tests over every financial field in the schema).

## Tenant/business lifecycle rule
Every async continuation is bound to the selection that started it: saves capture (tenantId, bizId) and abort before persist (and skip state after persist) on mismatch; listener callbacks and the self-heal write are generation- (`live`) and tenant-bound; the last-year loader checks business + tenant + liveness; switching selection resets the open edit context. Teardown (`live=false` + unsubscribe-all) runs before any new subscription generation.
