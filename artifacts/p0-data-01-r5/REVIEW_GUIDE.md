# P0-DATA-01 R5 — Review Guide

For an independent re-review of commit `fix: converge production entry lifecycle`
(parent `6c4d9eb1`, branch `claude/p0-data-01-r5-final-lifecycle-convergence`).

## 1. Containment
```
git diff --name-status 6c4d9eb1 HEAD    # M index.html · M test/dashboard/entries-lifecycle.test.mjs · A artifacts/p0-data-01-r5/*
git diff --check 6c4d9eb1 HEAD          # clean
cmp package.json ../kissgn-p0-data-01-r4/package.json   # identical
```

## 2. The single-flight coordinator (the core fix)
`index.html`, `function createEntriesWriteCoordinator(io)`. Verify:
- `let writing = false;` — a GLOBAL in-flight flag (not per-lane).
- `pump()` returns early when `writing`; dispatches the CURRENT lane's newest desired; re-invokes itself on settle.
- lane object `{gen, desiredRows, desiredRev, committedRev, attemptedRev, expectedEchoes, waiters}`; `invalidate()` installs a fresh lane.
- `onListenerEcho(rows, ctx)`: stale-ctx reject → pending ignore → own-echo drain (`expectedEchoes`) → apply/self-heal.
- `submitSupplierEdit` returns a settled `{status, rev, latest}` promise.

## 3. Reproduce the adversarial probes (real coordinator + real persistence + committing store)
```
node --test test/dashboard/entries-lifecycle.test.mjs
```
Key tests to read: `PROBE A / S25+S33` (asserts final PERSISTED storage 200), `PROBE B / S26`
(full two-edit echo), `PROBE C` (invalidation, pending ≥ 0), `switch-away-and-back`, `S30/S31`
(failure), the `[prod-helper] supplier failure …` test (production error setter), `S14 ×2`
(insight UI setters), `S19-S24` (save UI runner), `S17/S18/S18b` (exception op-ID), `H`
(`storage.setFor`).

## 4. Production delegation (search anchors in index.html)
- `entriesWriteCoordRef.current.submitSupplierEdit` / `.onListenerEcho(val, ctxAtSetup)`
- `window.MarjinSaveLifecycle.applySupplierWriteResult(res, {` (supplier failure surface) and `{supplierWriteError}` (rendered banner)
- `saveUiRunnerRef.current.run(ownCtx` ; `insightUiLoaderRef.current.load(effCtx`
- `exceptionOwnershipRef.current.ensureOpId` / `.invalidate()`
- `window.storage.setFor = async (tenantId, key, value, shared=false)`

## 5. Full validation
```
node --test test/finance/vat-invariant.test.mjs                       # 5/0, S0 diff-guard green
node --test test/forecast/revenue-forecast-ui.test.mjs test/forecast/revenue-forecast-p0.test.mjs
node --test test/**/*.test.mjs docs/production-readiness/test/*.test.mjs   # 394/0
./node_modules/.bin/tsc --noEmit                                       # 22 TS2742 (refs.ts), exit 2
./node_modules/.bin/tsc --noEmit --preserveSymlinks                    # exit 0
```
(Do NOT run the bare `node --test` — it invokes the guarded RTDB emulator test.)

## 6. Not changed by R5
MTD/chart/P&L consumers; VAT/revenue/forecast/food-cost/labor/fixed/profit formulas; RTDB
schema/paths/Rules; the structured-exception API contract; dependencies; S2/S4A; R1.1 docs.
See `SCOPE_COMPLIANCE.md`.
