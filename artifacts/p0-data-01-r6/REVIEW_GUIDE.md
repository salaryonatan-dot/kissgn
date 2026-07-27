# P0-DATA-01 R6 — Review Guide

For an independent re-review of commit `fix: unify entries destination lifecycle`
(parent `088310c3`, branch `claude/p0-data-01-r6-destination-lifecycle-convergence`).

## 1. Containment
```
git diff --name-status 088310c3 HEAD    # M index.html · M test/… · A artifacts/p0-data-01-r6/*
git diff --check 088310c3 HEAD          # clean
cmp package.json ../kissgn-p0-data-01-r5/package.json   # identical
```

## 2. The one destination lane (core)
`index.html`, `function createEntriesWriteCoordinator(io)`. Verify:
- `submit(op)` handles `op.rows` (replace) and `op.transform(desired)` (transform).
- one global `writing` flag; pump dispatches the CURRENT lane's newest desired; re-invokes on settle.
- `ownPending` fingerprint list; `ownPending.push({fp,rev})` at DISPATCH (before ack); bounded to 16.
- `onListenerEcho(rows, ctx)`: stale-ctx reject → own-fingerprint consume → `deferred_pending_local`
  while pending → apply external + conditional self-heal.
- `invalidate()` settles queued waiters `cancelled_selection_changed` and installs a fresh lane.
- `io.commit` is the raw transport (private).

## 3. Every writer routed (search anchors)
- `entriesWriteCoordRef.current.submit(` — main save (`apply:false`), delete (transform), clear (`rows:[]`).
- `submitLaborEntry` — employee labor. `submitSupplierEdit` — supplier.
- `entriesWriteCoordRef.current.onListenerEcho(val, ctxAtSetup)` — listener + self-heal.
- `const persistEntriesRaw =` — the private transport; NO direct UI call to it.

## 4. The other fixes
- `createSupplierResultOwnership` + `supplierResultOwnershipRef.current.begin/settle` in `setSupPayDate`.
- `insightRoleRef.current = loggedInUser?.role` (every render) + `candidatesReady` reads it.
- `createSaveUiRunner` `clearInFlight()`/`unmount()`; `invalidateSelection` calls `clearInFlight()`;
  the unmount effect calls `saveUiRunnerRef.current.unmount()` and `supplierResultOwnershipRef.current.unmount()` first.

## 5. Reproduce
```
node --test test/dashboard/entries-lifecycle.test.mjs                    # 55/0
node --test test/finance/vat-invariant.test.mjs                          # 5/0
node --test test/forecast/revenue-forecast-ui.test.mjs test/forecast/revenue-forecast-p0.test.mjs
node --test test/**/*.test.mjs docs/production-readiness/test/*.test.mjs  # 396/0
./node_modules/.bin/tsc --noEmit                                         # 22 TS2742 (refs.ts), exit 2
./node_modules/.bin/tsc --noEmit --preserveSymlinks                      # exit 0
```
(Do NOT run the bare `node --test` — it invokes the guarded RTDB emulator test.)
Read `R6-1` (cross-writer persisted 999), `R6-4` (queued settlement), `R6-6/7` (local-before-ack),
`R6-9b` (supplier error isolation), `R6-10` (insight role), `R6-11` (save-UI unmount), `R6-12`
(exception composed with executeEntrySave).

## 6. Not changed by R6
MTD/chart/P&L consumers; financial formulas; RTDB schema/paths/Rules; structured-exception API;
dependencies; S2/S4A; R1.1 docs. See `SCOPE_COMPLIANCE.md`.
