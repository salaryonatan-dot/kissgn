# Gate 5 — real UI call-site coverage (P0-DATA-01 R10)

Worktree `kissgn-p0-data-01-r10`, branch `claude/p0-data-01-r10`, base/unchanged HEAD
`b854054cce5d27dcef7a2a442c15e32eadca20f3`. **NOT COMMITTED.**

**Gate 5 status: IMPLEMENTATION COMPLETE — OPEN PENDING INDEPENDENT REVIEW.** Closure is a
review decision and is not claimed here.

Suite: `test/dashboard/entries-ui-call-sites.test.mjs` — **49 tests, 49 pass, 0 fail,
0 cancelled, 0 skipped, 0 todo**, three consecutive identical runs.

## Production boundaries executed

Every test drives the ACTUAL production handler text, located in `index.html` by an
unambiguous anchor and extracted by brace matching, then evaluated in a `node:vm` sandbox whose
globals are exactly the React closure. No handler is copied, shimmed, re-implemented, replaced
by a test-only outcome mapper, or stood in for by a source-string assertion.

| UI operation | Production handler | `index.html` line | Wired to |
|---|---|---|---|
| revenue create/edit/save | `saveEntry` | 4764 | save button `onClick={()=>…saveEntry()}` (6303) |
| supplier create/edit/save | `setSupPayDate` | 5812 | supplier grid `onChange`/`onClick` (5987, 5991, 6010) |
| labor create/edit/save | `submitLaborEntry` | 3935 | `setDailyLabor` → employees grid `onChange` (7036, 7114) |
| entry deletion | `deleteEntryByDate` | 4839 | history row `onClick={()=>deleteEntryByDate(e.date)}` (6488) |
| id-addressed deletion | `deleteEntryById` | 4864 | **not wired to any UI element** — see finding D-GAP-1 |
| clear-all | the `<button onClick={async ()=>{…}}>` arrow | 6320 | history header "מחק הכל" |
| revenue material-change | `__revenueMaterialChanged` | 4746 | extracted, never restated |

Dependencies are the REAL seams, not fakes: `createEntriesWriteCoordinator`,
`createRemoteEntriesMutator`, `createSaveUiRunner`, `createSaveOwnership`,
`createSupplierResultOwnership`, `createExceptionOwnership`, `createSelectionController`,
`executeEntrySave`, `describeSaveOutcome`, `buildEntryUpsertIntent`, and the Gate-3-approved
destination-partitioned remote service. Controlled: React state setters (all spies), the
confirmation dialog, `apiFetch`, insight loaders, and a fake `setTimeout` that never fires by
itself so the real `scheduleSelectionBoundTimeout` is observable without any sleep.

Observed effects: `setSaved`, `setForm`, `setEditingId`, `editingDateRef.current`,
`setEntrySaveError`, `setSupplierWriteError`, `setEntries`/`applyRows`, `setInFlight`,
`setScreen`, `setEntryStep`, `rebuildInsights`, `loadInsights`, scheduled navigation,
`window.confirm`, and `console.warn`. Captured coordinator arguments: the exact typed intent
(`type`, `target.id`, `patch`, `base`, `createIfMissing`, `newRow`), the exact
`submitSupplierEdit` args (`supId`, `date`, `val`, `targetId`, `baseValue`, `newId`), and the
exact `submitClearAll` args (`expectedNodeFingerprint`, `confirmToken`).

The Gate-3-approved harness `test/support/cross-writer-harness.mjs` is imported **unchanged**
(SHA-256 identical before and after this gate) for topology and fixtures; Gate 5 loads its own
lifecycle sandbox purely so it can supply a deterministic timer, rather than altering an
approved file.

## Canonical outcome inventory

Derived by tracing each call site from the user action through input validation → immutable
identity resolution → coordinator/mutator → typed result handling → `describeSaveOutcome` →
visible/stateful effects, then confirmed empirically against the real handlers.

| Status / reason | revenue | supplier | labor | delete | clear-all |
|---|---|---|---|---|---|
| `committed` | R01–R03 | S01, S02 | L01, L02 | D01, D07 | C02 |
| `committed_idempotent` / `empty_patch` | R04 | — (¹) | — (¹) | — (¹) | — (²) |
| `committed_idempotent` / `already_applied` | R05 | S03 | — (¹) | — (¹) | — (²) |
| `committed_idempotent` / `already_created` | R06 | — (³) | — (³) | n/a | n/a |
| `committed_idempotent` / `already_empty` | n/a | n/a | n/a | n/a | C03 |
| `conflict` (+ `conflictPaths`) | R07 | S04 | L06 | D05 | — (⁴) |
| `blocked` / `invalid_identity` / `id_collision` | R08 | — (³) | — (³) | n/a | n/a |
| `blocked` / `duplicate_id` | — (⁵) | — (⁵) | — (⁵) | — (⁵) | C06 |
| `blocked` / `target_not_found` | R07-family | ✓ path | ✓ path | D05 | n/a |
| `blocked_entry_identity_required` | R11 | ✓ path | L04 | D03, D08 | ✓ path |
| `entry_identity_required` (builder-level) | R11 | n/a | n/a | n/a | n/a |
| `blocked_unhydrated` | R12 | ✓ path | ✓ path | ✓ path | C05 |
| `blocked` / `precondition_failed` | n/a | n/a | n/a | n/a | C04 |
| `invalid_date` | R10 | ✓ path | L05 | early return | n/a |
| transport rejection (`failed` / `transport_failed`) | R13 | S05 | L06 | D06, D08 | C07 |
| retry exhaustion (`failed` / `not_committed`) | R14 | ✓ path | ✓ path | ✓ path | C07 |
| `stale` | R09 | S06 | ✓ path | ✓ path | C08 |
| `cancelled_selection_changed` | — (⁶) | — (⁶) | — (⁶) | — (⁶) | — (⁶) |
| `id_is_immutable` | — (⁷) | — (⁷) | — (⁷) | n/a | n/a |
| ambiguous duplicate date | R15 (allowed) | S07 (allowed) | L03 (refused) | D02 (refused) | n/a |

**Unreachable status/reason explanations — with the excluding production boundary:**

1. Reachable in principle but not distinguishable at the UI: these call sites treat every
   `committed_idempotent` exactly as `committed`, and no idempotency reason is rendered. The
   reason is still forwarded (R10-GATE-011) and is asserted at the caller by the concurrency
   matrix (C-16, C-16b, C-04) and clear-all matrix (K-09b, K-26).
2. `empty_patch` / `already_applied` do not exist for clear-all: `applyEntryIntent`'s
   `clear_all` branch produces only `already_empty`, `precondition_failed` or a commit.
3. `already_created` / `id_collision` require a **create** whose pre-generated id already
   exists. Supplier and labor creates always mint a fresh id via `newRowId()` →
   `generateEntryId()`, so the collision is not producible from those call sites without
   forcing the generator; revenue is covered directly (R06, R08).
4. `conflict` is structurally impossible for `clear_all`: that branch has no `patch`/`base`
   paths, so `applyEntryIntent` can only return commit, `already_empty` or
   `precondition_failed`.
5. `duplicate_id` blocks at the whole-node validation gate, so every ordinary mutation returns
   it identically; it is asserted once at the clear-all call site (C06) and exhaustively at the
   coordinator boundary by the Gate 3 matrices (C-N6, K-12).
6. `cancelled_selection_changed` cannot reach a UI branch: `executeEntrySave` re-checks
   `sel.isLive(ctx)` immediately after `persistMutation` and returns `stale` first, and
   `createSupplierResultOwnership.settle` returns `{action:"stale"}` before inspecting the
   status. The coordinator status therefore exists but is always pre-empted by the stale gate —
   which is itself asserted silent (R09, S06).
7. `id_is_immutable` requires an intent that patches `id`. `buildEntryUpsertIntent` skips `id`
   in both diff loops and in the unset loop, and no UI call site constructs a raw patch, so no
   UI path can produce it. It is asserted at the coordinator boundary by C-N5.

**Ordinary commits never fabricate an idempotency reason** — negative control C-16c
(concurrency matrix) plus R01/R02 asserting the plain committed success effects.

## Traceability matrix

| Operation | Mode | Status / reason | Handler | Coordinator input | Expected visible effect | Expected form/modal/state effect | Forbidden effect | Test | Result |
|---|---|---|---|---|---|---|---|---|---|
| revenue | create | `committed` | `saveEntry` | `upsert_entry`, `createIfMissing:true`, `target.id`=fresh uuid, complete `newRow` | no error | `saved=true`, form reset, `editingId=null`, nav scheduled | any error message | G5-R01 | pass |
| revenue | edit | `committed` | `saveEntry` | `target.id`=ORIGINAL id, `patch.fields={sales}`, `base.fields={sales}` | no error | success effects | id change; other rows touched | G5-R02 | pass |
| revenue | edit (date) | `committed` | `saveEntry` | `target.id` unchanged, `patch.fields={date}` | no error | success effects | identity derived from date | G5-R03 | pass |
| revenue | edit | `committed_idempotent`/`empty_patch` | `saveEntry` | empty patch | no error | success effects, **no rebuild** | failure/collision message | G5-R04 | pass |
| revenue | edit | `committed_idempotent`/`already_applied` | `saveEntry` | patch already satisfied remotely | no error | success effects | conflict message | G5-R05 | pass |
| revenue | create | `committed_idempotent`/`already_created` | `saveEntry` | identical replayed create | no error | success effects | a second physical row | G5-R06 | pass |
| revenue | edit | `conflict` | `saveEntry` | stale base | production conflict message | form fully preserved | success; reset; second call | G5-R07 | pass |
| revenue | create | `id_collision` | `saveEntry` | create for an existing id | distinct collision message | form preserved | generic blocked/identity text; success | G5-R08 | pass |
| revenue | create | `stale` | `saveEntry` | in-flight, selection switched | **silent** | form preserved, no `setEntries` | any success; cross-destination write | G5-R09 | pass |
| revenue | create | `invalid_date` | `saveEntry` | none | "תאריך לא תקין." | form preserved | any coordinator call | G5-R10 | pass |
| revenue | edit | `entry_identity_required` | `saveEntry` | **none** | identity-required message | form preserved | submitting a non-intent | G5-R11 | pass |
| revenue | create | `blocked_unhydrated` | `saveEntry` | gated at the lane | actionable message | form preserved | success | G5-R12 | pass |
| revenue | create | rejection | `saveEntry` | one call | mapped failure | form preserved | silent retry | G5-R13 | pass |
| revenue | edit | exhaustion | `saveEntry` | one call | mapped failure | form preserved | success; mutation | G5-R14 | pass |
| revenue | edit | `committed` (dupes) | `saveEntry` | `target.id`=resolved row's own id | no error | success effects | twin row touched | G5-R15 | pass |
| supplier | edit | `committed` | `setSupPayDate` | `targetId`=row id, exact `baseValue` | error surface **cleared** | — | error set on success | G5-S01 | pass |
| supplier | create | `committed` | `setSupPayDate` | `targetId:undefined`, `newId`=fresh uuid | no error | — | reusing another row's id | G5-S02 | pass |
| supplier | edit | `committed_idempotent` | `setSupPayDate` | already applied | error surface cleared | — | failure message | G5-S03 | pass |
| supplier | edit | `conflict` | `setSupPayDate` | stale base | conflict message | — | `applyRows`; mutation | G5-S04 | pass |
| supplier | edit | rejection | `setSupPayDate` | one call | mapped failure | — | second call; mutation | G5-S05 | pass |
| supplier | edit | `stale` | `setSupPayDate` | in-flight, selection switched | **silent** | current surface untouched | any `setSupplierWriteError` | G5-S06 | pass |
| supplier | edit (dupes) | `committed` | `setSupPayDate` | `targetId`=resolved row's own id | — | — | twin touched | G5-S07 | pass |
| labor | edit | `committed` | `submitLaborEntry` | `target.id`=row id, `patch.fields={payroll}` | — | — | other fields lost | G5-L01 | pass |
| labor | create | `committed` | `submitLaborEntry` | `createIfMissing:true`, fresh id, complete `newRow` | — | — | date-derived identity | G5-L02 | pass |
| labor | edit | ambiguous date | `submitLaborEntry` | **none** | typed refusal to caller | — | any coordinator call | G5-L03 | pass |
| labor | edit | `blocked_entry_identity_required` | `submitLaborEntry` | **none** | typed refusal | — | identity adoption | G5-L04 | pass |
| labor | edit | `invalid_date` | `submitLaborEntry` | **none** | typed refusal | — | any coordinator call | G5-L05 | pass |
| labor | edit | `conflict` / rejection | `submitLaborEntry` | one call | typed result incl. `conflictPaths` | — | mutation; wrong surface reused | G5-L06 | pass (¹) |
| delete | delete | `committed` | `deleteEntryByDate` | `delete_entry`, `target.id`, declared base | no error | row removed | date/index target | G5-D01 | pass |
| delete | delete | ambiguous date | `deleteEntryByDate` | **none** | disambiguation message | — | any deletion | G5-D02 | pass |
| delete | delete | id-less row | `deleteEntryByDate` | **none** | identity-required message | — | any deletion | G5-D03 | pass |
| delete | delete | reorder mid-flight | `deleteEntryByDate` | `target.id` fixed at submission | — | addressed row removed | redirected deletion | G5-D04 | pass |
| delete | delete | `conflict` (stale) | `deleteEntryByDate` | declared base | — | row preserved | optimistic local deletion | G5-D05 | pass |
| delete | delete | rejection | `deleteEntryByDate` | one call | **mapped failure surfaced** | row preserved | console-only; success | G5-D06 | pass |
| delete | delete by id | `committed` | `deleteEntryById` | `target.id`=addressed twin | — | exactly that twin removed | sibling removed | G5-D07 | pass |
| delete | delete by id | invalid identity / rejection | `deleteEntryById` | none / one call | mapped messages | — | deletion | G5-D08 | pass |
| delete | negative control | — | both | — | — | — | date/position addressing | G5-D09 | pass |
| clear-all | declined | — | onClick arrow | **none** | — | nothing cleared | any submission | G5-C01 | pass |
| clear-all | confirmed | `committed` | onClick arrow | `submitClearAll{expectedNodeFingerprint, confirmToken}` | no error | node exactly `[]`, UI converged | ordinary submission path | G5-C02 | pass |
| clear-all | confirmed | `already_empty` | onClick arrow | same | no error | `[]` | failure message | G5-C03 | pass |
| clear-all | confirmed | `precondition_failed` | onClick arrow | same | dedicated Hebrew message | nothing cleared | generic blocked text; optimistic removal | G5-C04 | pass |
| clear-all | confirmed | `blocked_unhydrated` | onClick arrow | gated at lane | actionable message | nothing cleared | success | G5-C05 | pass |
| clear-all | confirmed | `duplicate_id` | onClick arrow | one call | identity message | nothing cleared | success | G5-C06 | pass |
| clear-all | confirmed | rejection / exhaustion | onClick arrow | one call | mapped failure | nothing cleared, no `applyRows` | partial clear as complete | G5-C07 | pass |
| clear-all | confirmed | destination change mid-flight | onClick arrow | one call | — | only the confirmed destination cleared | new lane cleared/hydrated by old result; confirmation reuse | G5-C08 | pass |
| clear-all | confirmed | `committed` | onClick arrow | exactly one `submitClearAll` | one `confirm` | — | a second silent action | G5-C09 | pass |

(¹) G5-L06 asserts the CURRENT production behaviour, which includes finding L-GAP-1 below.

## Verdicts

- **Immutable-ID proof.** Every create submits a pre-generated `generateEntryId()` uuid
  (R01, S02, L02, C02's confirm token); every edit retains the row's original id (R02, R03,
  S01, L01); every delete targets `target.id` (D01, D07). No handler derives identity from
  date, array position, row content or fingerprint (R03, R15, S07, L03, D02, D09).
- **Duplicate-date / reorder proof.** With two rows sharing `2026-08-01`, labor and delete
  **refuse** before any coordinator call (L03, D02); revenue and supplier target the resolved
  row's own id and leave the twin byte-intact (R15, S07); a reorder between render and
  confirmation cannot redirect a deletion (D04); D09 is the explicit negative control that a
  date- or position-addressed delete would fail.
- **Stale/cancelled policy.** Silent, and silence is never treated as success: no message, no
  `saved`, no form clear, no `setEntries`, no navigation, and no write to the newly selected
  destination (R09, S06, C08). `cancelled_selection_changed` is pre-empted by the stale gate.
- **Conflict / `conflictPaths` policy.** Surfaced through `describeSaveOutcome("conflict")` at
  the revenue and supplier surfaces (R07, S04); the exact `conflictPaths` are returned to the
  caller and asserted (L06 `["payroll"]`), and exhaustively at the coordinator boundary by the
  Gate 3 matrices. Never reduced to success and never discarding the user's input.
- **Idempotency-reason policy.** All three reasons are preserved end to end and asserted at the
  caller (C-16 `already_applied`, C-16b `empty_patch`, C-04/K-09b/K-26 `already_created` /
  `already_empty`); at the UI every `committed_idempotent` produces the operation's normal
  success effects and no failure text (R04–R06, S03, C03).
- **Thrown/rejected transport.** Mapped to the production failure text at every surface that
  has one (R13, S05, D06, D08, C07); zero mutation; exactly one coordinator call — production
  performs no silent retry anywhere.
- **Non-commit form preservation.** Asserted by the shared `assertNoSuccessEffects` helper plus
  explicit form equality on every revenue non-commit cell (R07, R08, R10–R14).

## Runtime defects discovered: **Yes — two**

Both were exposed by the new real-call-site tests, both regressions were written and observed
failing before any runtime edit, and both fixes are local UI result-handling changes. Neither
touches destination routing, immutable identity, collision semantics, conflict detection,
retry/rebase behaviour, clear-all confirmation ownership, migration, data repair, or Firebase
Rules/configuration. The accepted `res.reason` forwarding is unchanged.

### R10-GATE-012 — a typed builder refusal was submitted to the lane as an intent

*Real call site.* `saveEntry` → `executeEntrySave` (`index.html` 1784).
*Incorrect behaviour.* Editing a legacy row that has no immutable id makes
`buildEntryUpsertIntent` return the typed refusal `{status:"entry_identity_required"}`.
`executeEntrySave` special-cased only `invalid_date`, so the refusal object — which has no
`type` — was handed to `entriesWriteCoordRef.current.submitIntent`. The lane answered
`blocked_invalid_intent` and the operator saw the catch-all "שמירת הנתונים נכשלה. נסה שוב",
while the sibling delete and labor call sites already show the precise
"רשומות קיימות עדיין ללא מזהה קבוע…" for the same condition.
*Typed lower-level result was correct.* `buildEntryUpsertIntent` classified the condition
exactly; the loss was in the seam's handling of it.
*Narrowest fix.* Treat ANY typed builder refusal as a refusal: surface it via
`describeSaveOutcome` and submit nothing. `describeSaveOutcome` additionally aliases the
builder-level `entry_identity_required` to the existing coordinator-level text.
*Effect.* Strictly safer — one fewer invalid object reaches the lane, and the message is now
specific. Regression: G5-R11 (asserts the specific message AND zero coordinator calls).

### R10-GATE-013 — a failed delete was never surfaced to the operator

*Real call site.* `deleteEntryByDate` (`index.html` 4839), the delete the UI invokes
(`onClick={()=>deleteEntryByDate(e.date)}`, 6488).
*Incorrect behaviour.* On any non-commit result the handler emitted only
`console.warn("[delete] entries write failed; will reconcile on next sync")`. Its own comment
states "Surface, do not silently ignore", and the id-addressed sibling `deleteEntryById`
already calls `setEntrySaveError(describeSaveOutcome(res || "failed", false))`. A user whose
delete failed saw no indication at all.
*Typed lower-level result was correct.* The coordinator returned `failed`/`transport_failed`
with `latest:true`; the loss was purely in presentation.
*Narrowest fix.* Inside the existing non-commit branch, surface the failure through the
existing `entrySaveError` state and the existing mapper. The pre-existing `res.latest` guard is
retained so a superseded delete stays quiet, and `stale`/`cancelled_selection_changed` remain
silent per the accepted outcome policy. The `console.warn` is unchanged.
*Regression.* G5-D06 (asserts the mapped message, no local removal, one call).

**Runtime files changed: `index.html` only.**

## Findings recorded for decision (no runtime change made)

- **L-GAP-1 — labor failures are invisible.** `setDailyLabor` (`index.html` 7036) awaits
  `submitLaborEntry` and discards the typed result, and the employees screen has no error
  surface. A conflicted, blocked or rejected labor write produces no operator-visible effect.
  Adding a surface is a UX addition (new state and new element), not result handling, so it is
  referred rather than changed unilaterally. The current behaviour is pinned by G5-L06 so it
  cannot regress further unnoticed.
- **D-GAP-1 — `deleteEntryById` is unreachable from the UI.** It is defined and correct
  (G5-D07, G5-D08) but no element invokes it, so R10-GATE-006's "duplicate-date rows are
  individually deletable" is not reachable by an operator; the wired delete refuses ambiguous
  dates (G5-D02). Wiring it is a UI addition and is referred.

## Negative controls and mutation-probe results

Behavioural negative controls in the suite: G5-D09 (date/position-addressed delete),
G5-F2 (deterministic watchdog reports a stranded UI operation — unchanged 60-tick threshold, no
sleeps, no auto-acknowledgement), G5-F3 (continuation sentinel), C-16c (ordinary commit carries
no fabricated idempotency reason).

Isolated mutation probes were run on a scratch copy in the build container — never in the
reviewed worktree — and the copy was deleted afterwards. Each probe inverted or removed one
production branch:

| Probe | Suite result | Caught by |
|---|---|---|
| conflict routed through the SUCCESS branch | 44 pass / **5 fail** | G5-R07, G5-R08, G5-R12, G5-R13, G5-R14 |
| stale/cancelled result CLEARS the form | 48 pass / **1 fail** | G5-R09 |
| idempotency reason DISCARDED at the coordinator | 39 pass / **2 fail** (concurrency matrix) | C-16, C-16b |
| delete targets the DATE instead of the immutable id | **suite refuses to run** | fidelity marker: "deleteEntryByDate no longer contains the production marker `target: { id: target.id }`" |
| clear-all reports REJECTION as success | 45 pass / **4 fail** | G5-C04, G5-C05, G5-C06, G5-C07 |

`index.html` was verified byte-identical to the pre-probe copy after every probe.

## Validation

Run after the final edit, with no changes between runs.

| Check | Result |
|---|---|
| Gate 5 UI call-site suite ×3 | 49/49 · 49/49 · 49/49 |
| topology sentinel | 14/14 |
| concurrency matrix | 41/41 |
| clear-all matrix | 42/42 |
| lifecycle suite ×3 | 112/112 · 112/112 · 112/112 |
| prior cross-writer suite | 23/23 |
| UUID/id-contract + transformer/runtime-boundary | 12/12 |
| focused R10-GATE-011 coverage | C-04, C-16, C-16b, C-16c all pass |
| H1–H6 | all six pass |
| VAT S0 guard | 5/5; `test/finance/vat-invariant.test.mjs` unmodified vs `b854054` |
| complete repository suite | **40 files, 634 tests, 0 fail, 0 cancelled, 0 skipped, 0 todo** |
| `node --check` on changed/new `.mjs` | clean |
| inline `index.html` scripts | all 4 parse clean under a JSX-aware parser |
| TypeScript vs untouched R9 | exit 2, 22 diagnostics, all `TS2742` in `src/firebase/refs.ts` — **unchanged** |
| `git diff --check` | exit 0 |

Baseline before Gate 5 was 585 tests across 39 files; the new real total is **634 across 40**
(+49 Gate 5). No test was consolidated or removed to preserve any prior count.

Gate-3-approved files are unchanged by this gate (SHA-256 identical before and after):
`test/support/cross-writer-harness.mjs` `5b0f9ce5…`,
`test/dashboard/entries-concurrency-matrix.test.mjs` `008c20bd…`,
`test/dashboard/entries-clear-all-matrix.test.mjs` `86cb1f39…`,
`test/dashboard/entries-topology-sentinel.test.mjs` `d2c1ff5b…`,
`test/dashboard/entries-remote-atomic.test.mjs` `fd613f42…`,
`test/dashboard/entries-id-contract.test.mjs` `40b57e1d…`,
`test/dashboard/entries-lifecycle.test.mjs` `0fbc8957…`,
`test/support/entries-id-offline-transformer.mjs` `ea44dca5…`.

## Status

Gate 5 is **IMPLEMENTATION COMPLETE — OPEN PENDING INDEPENDENT REVIEW**. Gate 7 is **OPEN —
NOT STARTED**. P0-DATA-01 is not yet complete and Production readiness is not claimed.
