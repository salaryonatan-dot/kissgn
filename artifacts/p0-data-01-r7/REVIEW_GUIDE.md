# P0-DATA-01 R7 — Review Guide

Independent re-review of `fix: scope entries echo ownership`
(parent `13e70a81`, branch `claude/p0-data-01-r7-fingerprint-ownership`).

## 1. Containment
```
git diff --name-status 13e70a81 HEAD     # M index.html · M test/dashboard/… · A artifacts/p0-data-01-r7/*
git diff --check 13e70a81 HEAD           # clean
git diff 13e70a81 HEAD -- package.json package-lock.json   # empty (identical)
```

## 2. The fix (index.html → createEntriesWriteCoordinator)
- `const ownPending = [];  // [{tenantId,bizId,gen,fp,rev}] …` — scoped markers.
- Dispatch: `const marker = { tenantId: ctx.tenantId, bizId: ctx.bizId, gen: ctx.gen, fp: fp(snapshot), rev };`
  `ownPending.push(marker);` (captured from the write's ctx; bounded-16 retained).
- Failure branch: `const mi = ownPending.indexOf(marker); if (mi !== -1) ownPending.splice(mi, 1);`
- `onListenerEcho`: liveness gate (`stale`) first; then
  `ownPending.findIndex(r => r.fp === echoFp && r.tenantId === ctx.tenantId && r.bizId === ctx.bizId && r.gen === ctx.gen)`.
- `invalidate()`: after installing the fresh lane, retire markers whose
  (tenant,biz,gen) != `io.selection.current()`.

## 3. Why fingerprint-alone is impossible in production
Single production call site:
`entriesWriteCoordRef.current.onListenerEcho(val, ctxAtSetup)` — always passes
the listener's captured ctx. Own-echo consumption requires that ctx to match the
marker on tenant+business+generation as well as fingerprint.

## 4. Reproduce
```
node --test test/dashboard/entries-lifecycle.test.mjs                     # 65/0
node --test test/finance/vat-invariant.test.mjs                           # 5/0
node --test test/forecast/revenue-forecast-ui.test.mjs test/forecast/revenue-forecast-p0.test.mjs
node --test --test-concurrency=8 test/**/*.test.mjs docs/production-readiness/test/*.test.mjs  # 406/0
./node_modules/.bin/tsc --noEmit                                          # 22 TS2742 (refs.ts), exit 2
./node_modules/.bin/tsc --noEmit --preserveSymlinks                       # exit 0
```
(Do NOT run bare `node --test` — it invokes the guarded RTDB emulator test.)

## 5. Negative control (proves closure, not just green tests)
`/tmp/r7-negctl/probe.mjs` loads each worktree's real coordinator and runs
`T1/A→T2/B`. R6 → `ignored_own_echo` (hydrated:false). R7 → `applied`
(hydrated:true). R6 unmodified. See `ADVERSARIAL_PROBES.md`.

## 6. Key tests to read
`R7-1` (cross tenant+biz hydration), `R7-4` (switch-away-back generation),
`R7-5` (stale old-context rejection), `R7-7` (cross-destination non-consumption),
`R7-8` (failed-write scoped retirement), `R7-9` (identical-fp isolation),
`R7-6` (same-generation own echo preserved). Legacy `R6-6/6b/7/8` still assert
local-before-ack suppression (now with explicit ctx).

## 7. Not changed
`package*`, `database.rules.json`, `vercel.json`, `api/`, `lib/`, `src/`,
financial formulas/VAT, RTDB schema/paths/Rules, dependencies, the approved cron
remediation. R5/R6/cron worktrees and the canonical repo untouched.
