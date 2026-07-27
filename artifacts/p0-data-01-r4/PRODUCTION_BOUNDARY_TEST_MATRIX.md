# P0-DATA-01 R4 — Production Boundary Test Matrix

All executable tests drive the **real** production helpers vm-extracted from `index.html`
(`window.MarjinEntries`, `window.MarjinSaveLifecycle.{createPersistence,
createEntriesWriteCoordinator, createSaveOwnership, createInsightReadback,
loadExceptionsBound, executeEntrySave}`). Only terminal I/O is injected: deferred
storage transport, deferred API transport, state/ref spies, timers. The persistence,
candidate-loop, ownership and sequencing **logic** under test is the real code.

Labels: `[prod-helper]` production seam factory run · `[prod-entries]` real MarjinEntries
helpers · `[source-guard]` supplementary static-source wiring assertion (NOT race coverage).

## Mandatory scenario → test coverage (all 43)

| # | Scenario | Test (label) | Boundary exercised |
|---|---|---|---|
| 1 | entries write starts T1/A, switch T2/B before resolve, no later write | S1+S5 [prod-helper] | `createPersistence.persistEntries` + deferred storage |
| 2 | same, biz A reused under T2 | S2 [prod-helper] | persistEntries |
| 3 | missing context rejected before any request | S3 [prod-helper] | persistEntries |
| 4 | storage key uses captured ctx.bizId | S4 [prod-helper] | persistEntries |
| 5 | storage tenant uses captured T1, cannot become T2 | S1+S5 [prod-helper] | persistEntries |
| 6 | supplier edit writes entries, never fixed | S6/S7, S6(coord) [prod-helper] | persistEntries + coordinator |
| 7 | employee labor writes entries, never fixed | S6/S7 [prod-helper] + source-guard | persistEntries |
| 8 | fixed edit writes fixed, never entries | S8 [prod-helper] | persistFixed |
| 9 | clear-all writes entries with mandatory context | S9 [prod-helper] | persistEntries |
| 10 | stale success/failure cannot mutate newer selection | S10 [prod-helper] | executeEntrySave + real persistence |
| 11 | first candidate deferred, invalidate, not found → no 2nd request | S11+S14 [prod-helper] | createInsightReadback.loadRange |
| 12 | logout T1/login T2 same biz id | S12 [prod-helper] | loadRange |
| 13 | every request uses captured tenant/business | S13 [prod-helper] | loadRange |
| 14 | no stale insight loading/data/error/suppression mutation | S11+S14, S10 [prod-helper] | loadRange + executeEntrySave |
| 15 | already-stale loadExceptionsBound sends 0 requests | S15 [prod-helper] | loadExceptionsBound preflight |
| 16 | context stale during fetch → applies nothing | S16, S16(supplier) [prod-helper] | loadExceptionsBound / coordinator |
| 17 | old exception data/ref cannot affect new form | S15/S16 [prod-helper] (no apply when stale) | loadExceptionsBound |
| 18 | old exception opId cannot cross tenant/business | covered by request identity (S15b tenant/biz in URL) | loadExceptionsBound |
| 19–22 | old save pending / invalidate / new save / old finally no-op | S19-S22 [prod-helper] | createSaveOwnership |
| 23 | same-selection double-submit blocked | S23 [prod-helper] | createSaveOwnership |
| 24 | logout/unmount invalidate ownership | S24 [prod-helper] | createSaveOwnership.invalidate |
| 25 | 100 then 200, older resolves last → final 200 | S25 [prod-helper] | coordinator sequence |
| 26 | same with storage/listener echo after older write | S26+S28 [prod-helper] | coordinator + onListenerEcho |
| 27 | echo before newest completion can't regress 200→100 | S27 [prod-helper] | onListenerEcho pending-suppression |
| 28 | echo after newest completion converges to 200 | S26+S28 [prod-helper] | onListenerEcho |
| 29 | two edits, different suppliers, both preserved | S29 [prod-helper] | coordinator latest-desired |
| 30 | older failure can't roll back newer success | S30 [prod-helper] | coordinator |
| 31 | newer failure surfaced; older completion can't win | S31 [prod-helper] | coordinator |
| 32 | duplicate starting rows → one canonical row | S32, S43 [prod-helper]/[prod-entries] | coordinator + canonicalize |
| 33 | exact canonical payload == array exposed to state | S33 [prod-helper] | coordinator |
| 34 | R2 date-edit/replay/hydration/canonicalization covered | S34, S34b, S35 [prod-entries] | upsertEntryByDate |
| 35 | explicit save wins wholesale | S35 [prod-entries] | upsertEntryByDate |
| 36 | earliest-non-zero scalar precedence | S36 [prod-entries] | canonicalizeEntries |
| 37 | nested-map union earliest-wins | S37+S38 [prod-entries] | mergeEntryMaps |
| 38 | same nested keys never summed | S37+S38 [prod-entries] | mergeEntryMaps |
| 39 | canonicalization deterministic & idempotent | S39 [prod-entries] | canonicalizeEntries |
| 40 | listener/self-heal tenant binding intact | S40 [prod-entries] + source-guard | canonicalize + wiring |
| 41 | same-context normal save succeeds exactly once | S41 [prod-helper] | executeEntrySave + real persistence + real readback |
| 42 | delayed nav remains token-checked | S42 [prod-helper] | executeEntrySave + scheduleSelectionBoundTimeout |
| 43 | incident fixture 608,236/580,483/27,753; state==persistence | S43 + fixture [prod-entries]/[prod-helper] | canonicalize + persistEntries |

Every executable test that asserts a race also asserts **prohibited calls/setters were not invoked**
(e.g. "no second request", "no later write", "old finally did not clear the new state",
"stale save never reports success/reset/nav/suppress"), not merely that a final value matched.

## What is NOT claimed as production race coverage

The 7 `[source-guard]` tests assert static wiring only (helper removed, callers delegate,
preflight ordering, explicit-tenant transport present). They are supplementary — every race
claim above is backed by a `[prod-helper]`/`[prod-entries]` runtime test against the real helper.
