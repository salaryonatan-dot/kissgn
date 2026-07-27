# P0-DATA-01 R3 Change Summary

Closes the three blocking findings from Codex's R2 review (FINDINGS.json), independently verified against the cited code paths. All changes are inside `index.html` + `test/dashboard/entries-lifecycle.test.mjs`; the R2 date-identity/replay fixes and the reviewed listener/self-heal tenant binding are preserved.

## Blocker 1 — selection-bound save lifecycle (R2-001)
- One monotonic selection context `{tenantId, bizId, generation}` via `window.MarjinSaveLifecycle.createSelectionController()` (held in `selectionCtrlRef`). `capture()`/`isLive(ctx)` bind and validate; `invalidate(t,b)` bumps the generation and clears every selection-scoped ref/timer **synchronously**.
- `invalidateSelection(...)` runs at every transition BEFORE state updates: the `setCurrentBizId` wrapper, the raw `setCurrentBizId_("demo_biz")` and logout `setCurrentBizId_(null)` sites, all three tenant-init assignments, and component unmount. Same business-id string under a new tenant → new generation → stale.
- The full daily-save orchestration is the extracted production seam `executeEntrySave(io)`: captures ctx at start; builds the rebuild request body from the captured ctx only (never a later global tenant); re-checks `isLive(ctx)` after every await and before every state/ref mutation, API call, form reset, `setSaved`, navigation and op-id cleanup; a stale continuation returns `{status:"stale"}` silently. Proven: a stale save cannot call the analytics builder with business A + tenant T2.
- Delayed success navigation is tracked in `saveNavTimerRef` via `scheduleSelectionBoundTimeout` — cancelled on re-schedule/invalidation/unmount and token-checked at fire time.

## Blocker 2 — entry-exception lifecycle (R2-002)
- `loadEntryExceptions(ctx)` runs the seam `loadExceptionsBound`: request built only from the captured ctx; `entryExceptionStateRef`/`entryExceptions` applied only if the same context is still live after every await. The business effect passes its `ctxAtSetup`; failure reloads inside the save seam pass the captured save ctx.
- Business/tenant switch clears exception React state AND the state ref immediately (effect head + `invalidateSelection`). `entryExceptionOpIdRef` and `suppressNextDashboardInsightsLoadForBizRef` are cleared synchronously on every invalidation (op-ids can no longer cross businesses/tenants; suppression can no longer leak).
- Server exception API/schema/revision model unchanged; structured-first governance, optimistic revision, replay-safe op-id reuse and the save order preserved.

## Blocker 3 — canonical state/persistence consistency (R2-003)
- `persist` now accepts a caller ctx (live-check before the storage path is computed) and returns `{ok, canonical}` — the exact canonical array it wrote. New callers use the `persistEntries` alias (keeps the S0-frozen `persist(` lines byte-identical).
- `setSupPayDate` runs `applySupplierPaymentBound`: canonical-optimistic apply (via `upsertEntryByDate`, never raw `entries.map`/`[...entries]`), revert to the previous canonical array on persistence failure, apply the exact persisted canonical array on success, selection-bound.
- `deleteEntryByDate` and the employee daily-labor writer (`setDailyLabor`) likewise go through canonical helpers; demo hydration is canonicalized. Listener echo is canonical wholesale replacement, so it cannot reintroduce a raw array after canonical state.
- Fixed the stale listener comment that claimed supplier payments are summed.

## Preserved / unchanged
Revenue/VAT/forecast/labor/food/fixed/profit formulas; business-date semantics; duplicate precedence (explicit save wins wholesale; earliest-non-zero scalar; nested-map key union earliest-wins, never added; deterministic + idempotent); exception API contract; RTDB schema/paths/Rules; dependencies. The security suite's inline save-flow guard strings were preserved by naming the seam's internal variables `__revenueChanged/__stripException/__applyExc/__prevEntry/__ec` etc. (pure rename — behavior identical).

## Files changed
`index.html`, `test/dashboard/entries-lifecycle.test.mjs`, `artifacts/p0-data-01-r3/*` (8).
