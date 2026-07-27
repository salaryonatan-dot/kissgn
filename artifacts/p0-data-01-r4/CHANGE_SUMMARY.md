# P0-DATA-01 R4 — Change Summary

**Branch:** `claude/p0-data-01-r4-production-lifecycle-hardening`
**Base (R3):** `eed85e23e95b98a6b2d2ce00425ea3faeb8f63d0` (subject `fix: bind entry saves to active selection`)
**Commit subject:** `fix: harden production entry lifecycle`
**Runtime files changed:** `index.html` only.
**Test files changed:** `test/dashboard/entries-lifecycle.test.mjs` only.
**Artifacts:** `artifacts/p0-data-01-r4/` (11 files).
**Storage-adapter change:** additive, backward-compatible, inside `index.html` (`window.storage.setFor`). No separate storage-adapter file exists — the adapter is defined inline in `index.html`, so no extra file was authorized or touched.

## What R3 got wrong (CTO framing)

R3 hardened the *extracted orchestration seam* (`executeEntrySave`) but left the **actual production adapters and the React wrapper** lifecycle-unsafe. The remediation therefore fixes the underlying **contracts**, not isolated symptoms: every read/write is bound to an immutable selection context; overlap-prone operations carry an operation identity; no request is issued after its context is stale; identity derives from captured context, never a later closure or global; each user action persists only the domain it changed; and older same-selection operations / listener echoes can never overwrite a newer edit.

## Production seam factories added (vm-extractable, the exact code the UI runs)

All added inside the `window.MarjinSaveLifecycle` block and exported on the freeze:

- **`createPersistence(io)`** → `persistEntries(rows, ctx)` / `persistFixed(fixed, ctx)`. Mandatory context; derives tenant **and** storage key from the captured `ctx` (never `currentBizId`/`_currentTenantId`); canonicalizes entries exactly once; re-checks liveness immediately before dispatch; writes **exactly one domain** (entries writers never touch fixed and vice-versa), so the old entries→fixed multi-write is structurally impossible; returns a structured result (`ok` / `stale` / `missing_context` / `error` / `staleAfterWrite`).
- **`createEntriesWriteCoordinator(io)`** → `submitSupplierEdit(args)` / `onListenerEcho(rows)` / `invalidate()`. Monotonic operation sequence: an older completion or failure can never overwrite a newer same-selection edit; each queued edit builds on the **latest desired canonical state** (distinct suppliers both survive); listener echoes are ignored while a local write is pending (no regression) and applied once quiescent (convergence). Supplier writes are **entries-only** (no `fixedList`).
- **`createSaveOwnership()`** → `begin/owns/settle/invalidate/current`. Generation-bound save token: blocks a same-selection duplicate submission but **not** a save in a newer selection; a stale `finally` clears in-flight state only if it still owns the current token.
- **`createInsightReadback(io)`** → `loadRange(ctx, preferredDate, isCancelled)`. Every candidate request derives tenant+business from the captured `ctx`; cancellation (explicit **or** a bumped selection) is checked **before and after every candidate await**, so a stale "not found" never triggers a second request and no request combines a new global tenant with an old business.
- **`loadExceptionsBound`** gained a **preflight** `selection.isLive(ctx)` gate before the URL is built and `apiFetch` is issued.

## Component wiring (delegation — no parallel logic)

- `persistenceRef`, `entriesWriteCoordRef`, `saveOwnershipCtrlRef`, `insightReadbackRef` created next to `selectionCtrlRef`; the component's `persistEntries`/`persistFixed` delegate to `createPersistence`.
- The central `persist(e, f, ctx)` multi-write helper and the `persistEntries = persist` alias were **removed**.
- Every full-blob writer now captures context at the event boundary and calls a **domain-specific** helper:
  main save (entries), supplier grid (entries via coordinator), delete-by-date (entries), clear-all (entries), employee daily labor (entries), fixed-expense modal + compact UI (fixed). Supplier and employee-labor edits never pass `fixedList`; fixed-expense edits never rewrite entries.
- `saveEntry` uses the ownership token; its `finally` clears in-flight UI only when still owning. `invalidateSelection` synchronously frees save ownership and neutralizes pending supplier writes (in addition to the R3 ref/timer clears).
- The entries listener routes hydration/echo through `entriesWriteCoordRef.current.onListenerEcho(...)`, preserving R2 canonical hydration and the tenant/selection-bound self-heal write-back.
- `apiGetDailyRange(kind, bizId, fromDate, toDate, tenantId)` accepts an **explicit** tenant (falls back to the global only for the unrelated analytics-range view).
- `window.storage.setFor(tenantId, key, value, shared)` is the explicit-tenant write transport; path semantics are byte-identical to `set()` (same `tenants/{tenantId}/…` layout, same `{_v}` envelope). `set()`/`get()`/`subscribe()` are unchanged.

## Preserved behavior (unchanged)

Explicit-save-wins-wholesale; earliest-non-zero scalar precedence; nested-map union with earliest-value-wins (never summed); deterministic idempotent canonicalization; R2 date-identity/replay; accepted listener/self-heal tenant binding; VAT/revenue/forecast/food-cost/labor/fixed/profit formulas; structured-exception API contract and revision model; RTDB schema/paths/Rules. Incident canonical total **₪580,483** (raw 608,236, delta 27,753) reproduced independently from the R4 helper.
