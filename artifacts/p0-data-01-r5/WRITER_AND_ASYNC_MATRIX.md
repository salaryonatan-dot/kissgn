# P0-DATA-01 R5 — Writer & Async Matrix

`ctx` = captured `{tenantId, bizId, generation}`. Terminal identity is always the captured
ctx (tenant via `storage.setFor`, key `biz:${ctx.bizId}:…`).

| Writer | Event | ctx | Op identity | Terminal ordering | Post-await guard | Failure/stale | Listener interaction | Verdict |
|---|---|---|---|---|---|---|---|---|
| Supplier grid (`submitSupplierEdit`) | keystroke | yes | revision + waiters | GLOBAL single-flight pump — one write in flight; newest persisted last | ctx re-check via persistEntries; own-echo drain | latest failure → `{persist_failed, latest:true}` surfaced; older no-op; never regress | own echoes drained; stale/pending ignored | **safe** |
| Entries listener + self-heal (`onListenerEcho`) | RTDB onValue | captured effect ctx | expectedEchoes | self-heal routed through the same pump | stale ctx rejected; pending ignored | n/a | drains own echoes; converges when quiescent | **safe** |
| Main daily save (`executeEntrySave`→`persistEntries`) | save | yes | save ownership token | single deliberate write; entries only | pre/post-persist isLive; after rebuild/readback/reset/nav | stale→silent; error→setError | applies canonical | **safe** |
| Delete by date (`persistEntries`) | delete | yes | — | single write | after-persist isLive; revert on failure | revert to prevCanonical | canonical | **safe** |
| Clear all (`persistEntries`) | button | yes | — | single write | mandatory ctx | structured result | n/a | **safe** |
| Employee daily labor (`persistEntries`) | keystroke | yes | — | single write, entries only (no fixedList) | mandatory ctx; before-dispatch isLive | structured result | n/a | **safe** |
| Fixed-expense modal / compact (`persistFixed`) | edit | yes | — | single write, fixed only | mandatory ctx; isLive | structured result | n/a | **safe** |
| Exception load (`loadExceptionsBound`) | effect | supplied ctx | op IDs (via `createExceptionOwnership`) | n/a | preflight isLive; after response; after JSON | stale→no request/apply | n/a | **safe** |
| Insight readback (`createInsightReadback`) | save/view | captured ctx | — | n/a | before + after every candidate await | cancelled→no mutation | n/a | **safe** |
| Insight UI setters (`createInsightUiLoader`) | dashboard | captured/effCtx | — | n/a | cancellation before first setter + after readback | stale→zero setter mutation | n/a | **safe** |
| Save in-flight (`createSaveUiRunner` + `createSaveOwnership`) | save | ctx | ownership token | n/a | owns-gated finally | stale finally no-op | n/a | **safe** |
| Save success timer (`scheduleSelectionBoundTimeout`) | save | ctx | timerBox | n/a | token-checked at fire | cancelled on invalidation | n/a | **safe (R3/R4)** |
| Explicit-tenant transport (`storage.setFor`) | all entries/fixed writes | explicit tenant arg | — | n/a | throws on missing tenant | n/a | n/a | **safe** |

## Non-entries/non-fixed writers (out of scope, unchanged)

`saveLastYear`, `saveBusinessConfig`, `saveSuppliers`, pettycash/compensations/tasks/checklist
writers, setup-time writers — each writes its own single domain key via the existing
`window.storage.set`, unchanged by R5.

## Conclusion

No reachable entries/fixed writer can be beaten by an older terminal write, corrupt a newer
generation's accounting, regress via a stale listener echo, or discard a latest failure without a
visible surface. Terminal persistence is single-flight and generation-safe; identity is always the
captured context.
