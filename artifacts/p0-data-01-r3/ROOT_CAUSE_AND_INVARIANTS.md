# R3 Root Cause & Invariants

## Root causes (verified against R2 `ddd4163`)
1. R2 guarded only the pre-persist abort and the single `setEntries(updated)` on business+tenant; the continuation after persist (rebuild, insight readback, failure/warning state, form reset, `setSaved`, delayed navigation, op-id cleanup) ran unconditionally and built the rebuild body from the live global tenant + old business.
2. `loadEntryExceptions(currentBizId)` read the live global tenant and applied results with no post-await selection check; called outside the guarded listener wrapper; save-path exception mutations happened before the pre-persist guard; failure reloads used live globals; `entryExceptionOpIdRef`/`suppressNextDashboardInsightsLoadForBizRef` were keyed only by date/business.
3. `setSupPayDate` applied `entries.map(...)`/`[...entries,newEntry]` (raw, non-canonical) to state before persistence, and `persist` canonicalized only internally without returning the canonical array.

## Invariants established
- **Selection identity** = (tenantId, bizId, generation); monotonic; advances synchronously on business change, tenant init/reset, logout, unmount. Same biz-id under a new tenant is a different context.
- **Async binding**: an operation captures the context at start and may mutate state/refs, call APIs, write storage, or navigate only while that exact context is live.
- **Canonical single boundary**: the exact array `persist` writes (returned as `.canonical`) is the only array applied to React state; no raw optimistic array is ever exposed; failures restore the prior canonical array.
- Preserved from R2: business-date string identity; explicit-save-wins-wholesale; earliest-non-zero scalar precedence; nested-map key union earliest-wins never-added; deterministic idempotent canonicalization.
