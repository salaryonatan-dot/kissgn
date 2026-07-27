# P0-DATA-01 R4 — Writer & Async Matrix

Every reachable entries/fixed writer after R4. `ctx` = captured `{tenantId, bizId, generation}`. Identity source is always the captured ctx (tenant via `storage.setFor`, key via `` `biz:${ctx.bizId}:…` ``) unless noted.

| Writer | Event | Captures ctx | Op token/seq | State payload | Persisted payload | Canonicalize | Awaited boundary + post-await guard | Later calls | Failure/stale | Listener interaction | Verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Main daily save (`executeEntrySave` → `persistEntries`) | save button | yes (seam capture) | save ownership token | `persistResult.canonical` | `biz:ctx.bizId:entries` (entries only) | once, in `persistEntries` | pre-persist `isLive`; post-persist `isLive`; after rebuild/readback/reset/nav | rebuild + readback, all ctx-bound | stale→silent return; error→setError, no success | applies canonical exactly | **safe** |
| Supplier grid (`submitSupplierEdit`) | keystroke | yes | monotonic sequence | latest canonical desired | `biz:ctx.bizId:entries` (entries only) | on every edit | after persist `isLive`; `mySeq===seq` apply gate | none | failure keeps optimistic, never regresses; stale→no apply | echoes suppressed while pending, converge when quiescent | **safe** |
| Delete by date (`persistEntries`) | delete | yes | — | canonical next / revert | `biz:ctx.bizId:entries` | yes | after persist `isLive`; revert on failure | none | revert to prevCanonical (no newer op possible) | canonical | **safe** |
| Clear all (`persistEntries`) | button | yes | — | `[]` | `biz:ctx.bizId:entries` | yes (empty) | mandatory ctx | none | structured result | n/a | **safe** |
| Employee daily labor (`persistEntries`) | keystroke | yes (`captureCtx()`) | — | (parent state via listener) | `biz:ctx.bizId:entries` (entries only — no fixedList) | yes | mandatory ctx; before-dispatch `isLive` | none | structured result | n/a | **safe** |
| Fixed-expense modal (`persistFixed`) | edit | yes | — | `setFixedList(u)` | `biz:ctx.bizId:fixed` (fixed only) | n/a | mandatory ctx; `isLive` | none | structured result | n/a | **safe** |
| Fixed-expense compact UI (`persistFixed`) | edit | yes | — | `setFixedList(u)` | `biz:ctx.bizId:fixed` (fixed only) | n/a | mandatory ctx; `isLive` | none | structured result | n/a | **safe** |
| Entries listener hydration/echo (`onListenerEcho`) | RTDB onValue | effect ctx + coordinator | pending counter | canonical wholesale | self-heal `biz:currentBizId:entries` if dup & tenant matches | yes | ignores while local write pending; tenant/live self-heal guard | self-heal write | ignored when pending | coordinates with pending supplier writes | **R2 behavior preserved** |
| Structured exception load (`loadExceptionsBound`) | effect | supplied ctx | exception opId (date-bound) | applied only when live | `/api/admin?...list-entry-exceptions` (ctx tenant/biz) | n/a | **preflight** `isLive`; after response; after JSON | none | stale→no request/no apply | n/a | **safe** |
| Insight readback (`createInsightReadback.loadRange`) | save readback / view | captured ctx | — | dashboard insight state | `apiGetDailyRange` with explicit `ctx.tenantId`/`ctx.bizId` | n/a | before + after every candidate await | terminates before next candidate if stale | cancelled→no state mutation | n/a | **safe** |
| Rebuild-after-save (`rebuildInsightsAfterEntrySave`) | save | ctx | — | none | `/api/analytics/daily-builder` (ctx tenant/biz) | n/a | caller `isLive` after await | readback | throw→onInsightsFailure (live only) | n/a | **safe (R3 preserved)** |
| Save success timer (`scheduleSelectionBoundTimeout`) | save | ctx | timerBox | delayed nav | none | n/a | token-checked at fire | none | cancelled on invalidation | n/a | **safe (R3 preserved)** |
| Save in-flight (`createSaveOwnership`) | save | ctx | ownership token | `entrySaveInFlight` | none | n/a | owns-gated finally | none | stale finally is a no-op | n/a | **safe** |

## Non-entries/non-fixed writers (out of scope, unchanged)

`saveLastYear`, `saveBusinessConfig`, `saveSuppliers`, pettycash/compensations/tasks writers, checklist template/runs writers, setup-time config/suppliers/fixed writers, `EmployeesScreen.saveBusinessConfig` — each writes its own single domain key via the existing `window.storage.set`, unchanged by R4. These are not selection-race sites for the entries/fixed lifecycle under review.

## Conclusion

No reachable entries/fixed writer retains an optional-context lifecycle bypass. Every such writer captures an immutable ctx at its event boundary, derives storage identity from that ctx, re-checks liveness after each relevant await, writes exactly one domain, and cannot be overwritten by an older same-selection operation or listener echo.
