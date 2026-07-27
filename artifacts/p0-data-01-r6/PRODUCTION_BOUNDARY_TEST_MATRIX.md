# P0-DATA-01 R6 — Production Boundary Test Matrix (all 43 scenarios)

`EXEC` = `EXECUTABLE_PRODUCTION_PATH` (a `[prod-helper]`/`[prod-entries]` test drives the real
production helper with only terminal transport/timer/port injection). Source guards are
supplementary and close no scenario. Every scenario Codex classified PARTIAL/FAILING in R5
(6,7,9,14,17,18,20,21,24,26,28,31,40) is upgraded to EXEC.

| # | Invariant | Test | Helper/caller | Class |
|---|---|---|---|---|
| 1 | write T1/A, switch, no later write | `S1+S5` | createPersistence | EXEC |
| 2 | biz A reused under T2 rejected | `S2` | createPersistence | EXEC |
| 3 | missing context rejected pre-request | `S3` | createPersistence | EXEC |
| 4 | key uses captured ctx.bizId | `S4` | createPersistence | EXEC |
| 5 | tenant uses captured T1 | `S1+S5` | createPersistence | EXEC |
| 6 | supplier writes entries, never fixed, destination-ordered | `R6-1/2`, `S6/S7` | lane + persistence | EXEC |
| 7 | employee labor writes entries via the lane, never fixed | `R6-2/3`, `S6/S7` | lane + persistence | EXEC |
| 8 | fixed writes fixed, never entries | `S8` | createPersistence | EXEC |
| 9 | clear-all writes entries via the lane, mandatory ctx | `S9`, `R6-2` | lane + persistence | EXEC |
| 10 | stale save cannot mutate new selection | `S10` | executeEntrySave | EXEC |
| 11 | first candidate deferred, invalidate, no 2nd request | `S11` | createInsightReadback | EXEC |
| 12 | logout T1/login T2 same biz id | `S12` | createInsightReadback | EXEC |
| 13 | every insight request uses captured tenant/biz | `S13` | createInsightReadback | EXEC |
| 14 | real insight wrapper + changing role closure | `R6-10`, `R6-10b` | createInsightUiLoader + role port | EXEC |
| 15 | already-stale exception load sends zero requests | `S15` | loadExceptionsBound | EXEC |
| 16 | context stale during fetch applies nothing | `S16` | loadExceptionsBound | EXEC |
| 17 | old exception state cannot populate new form | `R6-12` | createExceptionOwnership + executeEntrySave | EXEC |
| 18 | old exception op ID cannot cross tenant/business | `R6-12` | createExceptionOwnership + executeEntrySave | EXEC |
| 19 | old save pending observable | `R6-11(*)` | createSaveUiRunner | EXEC |
| 20 | invalidate while old save pending clears UI | `R6-11(business/tenant/logout)` | createSaveUiRunner | EXEC |
| 21 | new selection not disabled, can save | `R6-11(*)` | createSaveUiRunner | EXEC |
| 22 | old finally cannot clear new flag/token | `R6-11(*)` | createSaveUiRunner | EXEC |
| 23 | same-selection double-submit blocked | `S23`, `R6-11(unmount)` | createSaveUiRunner | EXEC |
| 24 | logout/unmount invalidate ownership + UI | `R6-11(logout)`, `R6-11(unmount)` | createSaveUiRunner | EXEC |
| 25 | 100 then 999, final persisted 999 | `R6-1` | lane + persistence (committing store) | EXEC |
| 26 | complete two-edit listener echo (local-before-ack) | `R6-7`, `R6-6/6b` | lane onListenerEcho | EXEC |
| 27 | echo before newest completion cannot regress | `R6-8b` | lane onListenerEcho | EXEC |
| 28 | external echo after quiescence converges | `R6-6`, `R6-8` | lane onListenerEcho | EXEC |
| 29 | two different suppliers both persisted | `S29`, `R6-3` | lane + persistence | EXEC |
| 30 | older failure cannot roll back newer success | `S30` | lane + persistence | EXEC |
| 31 | newer failure surfaced; old selection cannot touch UI | `S31`, `R6-9/9b` | lane + supplier ownership | EXEC |
| 32 | duplicate rows → one canonical row | `S32/S33`, `R6-2` | lane + canonicalize | EXEC |
| 33 | exact canonical payload == state array | `S32/S33` | lane + persistence | EXEC |
| 34 | R2 date-edit/replay | `S34/S34b` | MarjinEntries | EXEC |
| 35 | explicit save wins wholesale | `S34b/S35`, `R6-3` | MarjinEntries + lane | EXEC |
| 36 | earliest-non-zero scalar precedence | `S36` | MarjinEntries | EXEC |
| 37 | nested map union earliest-wins | `S37+S38` | MarjinEntries | EXEC |
| 38 | same nested keys never summed | `S37+S38` | MarjinEntries | EXEC |
| 39 | canonicalization deterministic/idempotent | `S39` | MarjinEntries | EXEC |
| 40 | actual listener binding + local-first timing | `R6-6/6b/7`, `R6-2`(self-heal) | lane onListenerEcho | EXEC |
| 41 | same-context save succeeds exactly once | `S41` | executeEntrySave | EXEC |
| 42 | delayed nav token-checked | `S42` | executeEntrySave + timer | EXEC |
| 43 | incident fixture, state == persistence | `S43` | MarjinEntries + persistence | EXEC |

**Extra (H):** `R6-13` executes `window.storage.setFor` directly (captured-tenant path, `{_v}`
envelope, no call on missing tenant).

**Totals: 43/43 EXECUTABLE_PRODUCTION_PATH; 0 PARTIAL/PROXY/SOURCE/MISSING/FAILING.** Race tests
assert terminal PERSISTED storage and non-invocation of prohibited paths, not only React state.
