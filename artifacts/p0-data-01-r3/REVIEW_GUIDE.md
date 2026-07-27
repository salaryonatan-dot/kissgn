# R3 Review Guide (independent re-review)

- Base `ddd4163bd0ba187e169ba634ba23c1821fe4db9b` → Final HEAD (this commit) · Branch `claude/p0-data-01-r3-lifecycle-consistency`
- Files: `index.html`, `test/dashboard/entries-lifecycle.test.mjs`, `artifacts/p0-data-01-r3/*`

## Highest-risk functions (search "R3")
1. `createSelectionController` / `invalidateSelection` — synchronous generation advance + ref/timer clearing.
2. `executeEntrySave` (production seam) — per-await `isLive(ctx)` re-checks; captured-ctx request bodies.
3. `loadExceptionsBound` — captured-ctx request + post-await liveness gate.
4. `applySupplierPaymentBound` / `deleteEntryByDate` / `setDailyLabor` — canonical-optimistic + revert.
5. `persist(e,f,ctx)` — ctx live-check before path build; returns `.canonical`.
6. `setCurrentBizId` wrapper + the raw `setCurrentBizId_` / tenant-init / logout / unmount invalidation sites.

## Suggested adversarial scenarios
- Resolve a persisted save AFTER `invalidate("T2","A")` — assert no rebuild/readback request, no form reset, no nav, no setSaved(true).
- Old `loadExceptionsBound` resolving after a tenant switch — assert `applyState` never called.
- Supplier update from a duplicate-row local state — assert one canonical row and no summation.
- Persist failure in supplier/delete — assert state reverts to the previous canonical array.
- Fire an old nav timer after switch — assert it does not navigate.

## Expected invariant outcomes
One effective row per (tenant,business,date) in state+persistence+consumers; a stale continuation mutates nothing in the new selection; the exact persisted canonical array is what React state holds.
