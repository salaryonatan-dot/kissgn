# P0-DATA-01 R4 — Review Guide

Fastest path for an independent re-review of the R4 commit `fix: harden production entry lifecycle`
(parent `eed85e23`, branch `claude/p0-data-01-r4-production-lifecycle-hardening`).

## 1. Verify containment (2 files + artifacts)

```
git diff --name-status eed85e23 HEAD
# expect: M index.html · M test/dashboard/entries-lifecycle.test.mjs · A artifacts/p0-data-01-r4/*
git diff --check eed85e23 HEAD           # clean
shasum -a 256 package.json package-lock.json   # identical to R2
```

## 2. The production seam (all lifecycle logic is here, vm-extractable)

`index.html`, block `window.MarjinSaveLifecycle` (search `// ── P0-DATA-01 R3: selection-bound save lifecycle`).
New/changed factories (the exact functions the UI delegates to):

- `createPersistence` — `persistEntries(rows, ctx)` / `persistFixed(fixed, ctx)`: mandatory ctx, single-domain, `io.storageSetFor(ctx.tenantId, \`biz:${ctx.bizId}:…\`, …)`, liveness re-check before dispatch.
- `createEntriesWriteCoordinator` — `submitSupplierEdit` (monotonic `seq`, `mySeq===seq` apply gate, entries-only) / `onListenerEcho` (pending-suppression → convergence) / `invalidate`.
- `createSaveOwnership` — `begin/owns/settle/invalidate`.
- `createInsightReadback` — `loadRange(ctx,…)`: cancellation before+after every candidate await; identity from ctx.
- `loadExceptionsBound` — preflight `isLive(ctx)` before `apiFetch`.

## 3. The component delegation (search these anchors)

- `persistenceRef` / `entriesWriteCoordRef` / `saveOwnershipCtrlRef` / `insightReadbackRef` — created next to `selectionCtrlRef`.
- `window.storage.setFor` — explicit-tenant transport (near `window.storage = {`); path semantics identical to `set()`.
- `const persistEntries = (rows, ctx) =>` / `const persistFixed = (fixed, ctx) =>` — delegators; the old `persist(e,f,ctx)` is gone.
- `saveEntry` — `ownership.begin(...)`; `finally { if (ownership.owns(saveToken)) setEntrySaveInFlight(false); ownership.settle(saveToken); }`.
- `invalidateSelection` — frees save ownership + neutralizes the coordinator.
- `setSupPayDate` — `entriesWriteCoordRef.current.submitSupplierEdit(...)` (no `fixedList`).
- fixed-expense callers — `persistFixed(u, captureSelectionCtx())`; clear-all — `persistEntries(u, captureSelectionCtx())`; `EmployeesScreen.setDailyLabor` — `persistEntries(newEntries, captureCtx())`.
- `loadDashboardInsights` — `insightReadbackRef.current.loadRange(effCtx, …)`; `apiGetDailyRange(kind, bizId, fromDate, toDate, tenantId)`.

## 4. Reproduce the tests

```
node --test test/dashboard/entries-lifecycle.test.mjs      # 46/0
node --test test/finance/vat-invariant.test.mjs            # 5/0
node --test test/forecast/revenue-forecast-ui.test.mjs test/forecast/revenue-forecast-p0.test.mjs
node --test test/**/*.test.mjs docs/production-readiness/test/*.test.mjs   # 387/0
./node_modules/.bin/tsc --noEmit                            # 22 TS2742 (refs.ts), exit 2
./node_modules/.bin/tsc --noEmit --preserveSymlinks         # exit 0
```

## 5. Adversarial checks worth re-running by hand

- Grep for any entries/fixed writer that omits ctx or does a multi-write:
  `grep -nE "persist\(entries|persist\(u,null|persist\(newEntries|applySupplierPaymentBound|const persist = async \(e, f" index.html` → **empty**.
- Confirm no selection-bound identity reads a global:
  `grep -n "biz:\${currentBizId}:entries" index.html` should show only the tenant-bound self-heal (listener) line, not a persist.
- Confirm the VAT diff-guard stays green (R4 adds no `set(ref`/`persist(`/`storage.set`/`entries =` line vs base `686b4350`).

## 6. What R4 deliberately did NOT change

MTD/chart/P&L consumers; VAT/revenue/forecast/food-cost/labor/fixed/profit formulas; RTDB schema/paths/Rules;
the structured-exception API contract and revision model; dependencies; S2/S4A; R1.1 docs. See `SCOPE_COMPLIANCE.md`.
