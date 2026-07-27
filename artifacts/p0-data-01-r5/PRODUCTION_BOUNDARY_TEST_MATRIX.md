# P0-DATA-01 R5 — Production Boundary Test Matrix (all 43 scenarios)

Classification: `EXECUTABLE_PRODUCTION_PATH` = a `[prod-helper]`/`[prod-entries]` test drives the
real production helper with only terminal transport/timer/port injection. Source guards
(`[source-guard]`) are supplementary and are NOT counted as race proof for any scenario.

Every mandatory race scenario (6,7,14,17,18,19-22,24,25,26,31,40) that Codex classified
PARTIAL/PROXY/SOURCE/MISSING/FAILING in R4 is upgraded to `EXECUTABLE_PRODUCTION_PATH` here.

| # | Scenario | R5 test name | Class |
|---|---|---|---|
| 1 | write T1/A, switch T2/B, no later write | `S1+S5 …` | EXEC |
| 2 | biz A reused under T2 | `S2 …` | EXEC |
| 3 | missing context rejected before request | `S3 …` | EXEC |
| 4 | storage key uses captured ctx.bizId | `S4 …` | EXEC |
| 5 | storage tenant uses captured T1 | `S1+S5 …` | EXEC |
| 6 | supplier edit writes entries, never fixed | `S6/S7 …` + `PROBE A` (real coordinator+persistence) | EXEC |
| 7 | employee labor writes entries, never fixed | `S6/S7 …` (persistEntries entries-only) | EXEC |
| 8 | fixed edit writes fixed, never entries | `S8 …` | EXEC |
| 9 | clear-all writes entries with mandatory context | `S9 …` | EXEC |
| 10 | stale success/failure cannot mutate newer selection | `S10 …` (executeEntrySave + real persistence) | EXEC |
| 11 | first candidate deferred, invalidate, not found → no 2nd request | `S11 …` | EXEC |
| 12 | logout T1/login T2 same biz id | `S12 …` | EXEC |
| 13 | every insight request uses captured tenant/business | `S13 …` | EXEC |
| 14 | no stale insight loading/data/error/warning/suppression mutation | `S14 …` (×2, `createInsightUiLoader` setter ports) | EXEC |
| 15 | already-stale loadExceptionsBound sends zero requests | `S15 …` | EXEC |
| 16 | context stale during fetch applies nothing | `S16 …` | EXEC |
| 17 | old exception data/ref cannot affect new form | `S17 …` (`createExceptionOwnership`) | EXEC |
| 18 | old exception op ID cannot cross tenant/business | `S18 …`, `S18b …` | EXEC |
| 19 | old save pending | `S19-S22 …` (`createSaveUiRunner`) | EXEC |
| 20 | selection invalidates while old save pending | `S19-S22 …` | EXEC |
| 21 | new selection not disabled and can save | `S19-S22 …` (observable in-flight setter) | EXEC |
| 22 | old finally cannot clear new save flag/token | `S19-S22 …` | EXEC |
| 23 | same-selection double-submit blocked | `S23 …` | EXEC |
| 24 | logout/unmount invalidates ownership | `S24 …` (tenant/logout/unmount) | EXEC |
| 25 | 100 then 200, older resolves last → final persisted 200 | `PROBE A / S25+S33` (committing store) | EXEC |
| 26 | complete two-edit listener echo → 200 | `PROBE B / S26` | EXEC |
| 27 | echo before newest completion cannot regress | `S27 …` | EXEC |
| 28 | echo after newest completion converges | `S28 …` | EXEC |
| 29 | two edits, different suppliers, both preserved | `S29 …` (state + persisted) | EXEC |
| 30 | older failure cannot roll back newer success | `S30 …` (committing store, real persistence) | EXEC |
| 31 | newer failure surfaced; older completion cannot win | `S31 …` + `applySupplierWriteResult` test | EXEC |
| 32 | duplicate starting rows → one canonical row | `S32 …`, `S43 …` | EXEC |
| 33 | exact canonical payload equals state array | `PROBE A / S25+S33` | EXEC |
| 34 | R2 date-edit/replay/hydration/canonicalization | `S34/S34b/S35 …` | EXEC |
| 35 | explicit save wins wholesale | `S35 …` | EXEC |
| 36 | earliest non-zero scalar precedence | `S36 …` | EXEC |
| 37 | nested map union earliest-wins | `S37+S38 …` | EXEC |
| 38 | same nested keys never summed | `S37+S38 …` | EXEC |
| 39 | canonicalization deterministic and idempotent | `S39 …` | EXEC |
| 40 | actual listener/self-heal binding | `PROBE B/S26`, `S27`, `S28`, `PROBE C` (real `onListenerEcho`) + `S40` canonicalization | EXEC |
| 41 | same-context normal save succeeds exactly once | `S41 …` | EXEC |
| 42 | delayed nav remains token-checked | `S42 …` | EXEC |
| 43 | incident fixture, state equals persistence | `S43 …` | EXEC |

**Extra (H):** `window.storage.setFor` executed directly with stubbed ref/set — captured-tenant
path, `{_v}` envelope, zero call on missing tenant.

**Totals:** 43/43 EXECUTABLE_PRODUCTION_PATH. 0 PARTIAL/PROXY/SOURCE/MISSING/FAILING.

Every race test additionally asserts prohibited paths were NOT taken (no second request/write, old
finally no-op, stale save/echo applies nothing) AND, for supplier ordering, the **terminal persisted
storage** value — not merely the final React state.
