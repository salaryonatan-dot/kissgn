# R8 / display-review FINDINGS CLOSURE MATRIX (R9)

Every actionable finding from the Codex R8 review (`codex-p0-data-01-r8-review-2026-08-05`)
and the Codex revenue/display review (`codex-p0-revenue-display-review-2026-08-07`).

---
## `P0-DATA-01-R8-FIND-001` — BLOCKING
- **Prior severity:** BLOCKING (sole reason R8 was `CHANGES_REQUIRED`).
- **Issue:** same-lane `deferred_pending_local` payload stored nowhere; on write failure with no
  further listener emit, rendered + active state stay on failed optimistic rows.
- **R9 resolution:** deferral is **stateful** — the payload is retained with its owning
  `{tenantId,bizId,gen}`; `convergeDeferred()` applies it when the owning write settles
  unsuccessfully and no newer local intent exists. Deterministic; needs **no** further emit.
  Discarded on success (our value is newer); never applied across owners.
- **Affected source:** `index.html` — `newLane` (`deferred`), `convergeDeferred`, pump settle
  (success + failure), `onListenerEcho` deferral branch, `invalidate`.
- **Regression test:** `R9-10` (failure + no re-emit -> converged), `R9-11` (success -> discarded),
  `R9-12` (own-echo never deferred), `R9-13` (newer local intent supersedes),
  `R9-14` (never applied after owner change), plus an independent negative control that
  reproduces R8's exact defect numbers and R9's fix.
- **Remaining limitation:** latest-wins — intermediate superseded remote payloads are not queued.
- **Status: CLOSED.**

## `P0-DATA-01-R8-FIND-002` — NON_BLOCKING
- **Prior severity:** NON_BLOCKING (missing committed coverage).
- **Issue:** no committed test for same-lane deferred -> persist_failed -> no subsequent emit.
- **R9 resolution:** committed tests `R9-10`..`R9-14` cover exactly that case plus success,
  own-echo-only, supersession and invalidation, asserting callback classification, active lane
  state, rendered rows, persistence, marker ownership and whether another emit is required.
- **Affected source:** `test/dashboard/entries-lifecycle.test.mjs`.
- **Regression test:** `R9-10`..`R9-14`.
- **Remaining limitation:** none.
- **Status: CLOSED.**

## `P0-REV-WRITE-004` — P0, requires_r9, blocks_writes
- **Prior severity:** P0 (FULL_PARENT_OVERWRITE_CAPABILITY).
- **Issue:** any stale/partial/wrong-business/pre-hydration entries state can become a
  destructive full-replacement payload.
- **R9 resolution:** (a) hydration gate — no write before authoritative history exists for that
  exact owner; (b) authoritative-base rule — transforms build only on `desiredRows`, never caller
  `baseRows`; (c) history-drop guard — a wholesale replace that drops known business dates is
  refused unless `allowDrop` is declared; (d) owner-validity gate.
- **Affected source:** `index.html` — `submit` gates, `dateKeysOf`, `ownerUsable`.
- **Regression test:** `R9-2`, `R9-3` (no intent pre-hydration), `R9-4` (month subset refused,
  153 drops detected), `R9-1`, `R9-5` (160-date history preserved), `R9-8` (malformed owner).
- **Remaining limitation:** `allowDrop` is a trusted caller declaration (only clear-all uses it);
  a replace that *modifies values* without dropping dates is still trusted.
- **Status: CLOSED (within the save lifecycle).**

## `P0-REV-FOOD-008` — P1, requires_r9, blocks_writes
- **Prior severity:** P1 (food-cost shares the entries full-replacement lane).
- **Issue:** food-cost saves can full-replace the blob from partial state.
- **R9 resolution:** parity by construction — `submitSupplierEdit` routes through the same
  `submit()` and inherits the hydration gate, authoritative base and owner checks.
- **Affected source:** `index.html` — `submitSupplierEdit` -> `submit`.
- **Regression test:** `R9-3` (blocked pre-hydration, zero intent), `R9-5` (160 dates preserved),
  `R9-19`/`R9-20` (rapid same/different-date edits), `R9-23` (retry ownership).
- **Remaining limitation:** none within the lane.
- **Status: CLOSED.**

## `P0-REV-SAFETY-005` — P1, requires_r9
- **Prior severity:** P1 (AUTOMATIC_PRODUCTION_WRITE_PATHS).
- **Issue:** the entries duplicate self-heal writes back automatically; opening the app is not
  guaranteed write-free.
- **R9 resolution:** the automatic entries self-heal write-back is **removed** (fail-closed,
  invariant G). Duplicates are canonicalized for display only and surfaced via
  `duplicatesObserved` for an explicit operator-initiated repair.
- **Affected source:** `index.html` — `onListenerEcho`.
- **Regression test:** `R9-6` (hydration incl. duplicates emits zero write intent) + a source
  guard asserting the `desiredRev++; pump();` self-heal pattern is gone.
- **Remaining limitation:** **PARTIAL for the finding as a whole.** Non-entries automatic writes
  (`user_tenants`, `username_index`, `user_active_biz` repair via `_rtdbSet`) are *outside* the
  entries save lifecycle and are deliberately **not** changed in R9 — see `KNOWN_LIMITATIONS.md`.
- **Status: CLOSED for the entries lane; OPEN (out of R9 scope) for non-entries repair writes.**

## `P0-REV-R8-007` — P0, requires_r9
- **Prior severity:** P0 (R8_NOT_APPROVED).
- **R9 resolution:** R9 delivers terminally safe same-lane deferral with committed
  failure/no-reemit tests, on top of R8 (R8 itself is untouched and remains unapproved).
- **Regression test:** `R9-10`..`R9-14` + negative control.
- **Status: CLOSED pending independent Codex review of the R9 commit.**

---
## Explicitly NOT addressed in R9 (by instruction)
| Finding | Reason |
|---|---|
| `P0-REV-DISPLAY-001` (current-month view, no history browse) | The display fix is a **separate task and commit**; R9 must not change visible `פדיון יומי` behavior. |
| `P0-REV-EVID-002`, `P0-REV-EVID-003` | Evidence-quality findings about the Phase-2 artifacts; no source change. |
| `P0-REV-PHASE1-006` | Documentation correction, already applied to the incident record. |

**Totals:** 6 actionable findings reviewed · 6 closed for the entries save lifecycle
(1 with a scoped remainder outside R9) · 0 blocking findings remaining.
