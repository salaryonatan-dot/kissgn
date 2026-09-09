# R10 — STATUS: `CHANGES_STILL_REQUIRED` (NOT COMMITTED)

Worktree `kissgn-p0-data-01-r10` @ base `b854054` (R9). No commit created — and none is to be
created: the current assignment forbids committing even now that Gate 4 is green. R8, R9 and the
canonical repository are untouched.

**Gate status.** Gate 3 `APPROVED — CLOSED` · Gate 4 `CLOSED` ·
Gate 5 `IMPLEMENTATION COMPLETE — OPEN PENDING INDEPENDENT REVIEW` · Gate 7 `OPEN — NOT
STARTED` · **P0-DATA-01: not yet complete** · **Production readiness: not claimed.**

**Current gate state.** Gate 4 is **CLOSED** (lifecycle suite 112/112, three consecutive
identical green runs; ledger in `R9_FINDINGS_CLOSURE.md`, rationale in the *GATE 4B — COMPLETE*
section). **Gate 3 is `APPROVED — CLOSED`** — independent reviewer **Codex**, verdict
**`APPROVED`**, **no findings at any severity**, no commit recommended; sentinel 14/14 ×3,
concurrency 41/41 ×3, clear-all 42/42 ×3, lifecycle 112/112 ×3, full suite 585/585 across 39
files; Gates 5 and 7 were open at the time of approval. (An earlier revision of this file
recorded Gate 3 as closed prematurely; that claim was withdrawn after a `CHANGES_REQUIRED`
verdict, remediated, and re-reviewed — see *GATE 3 — DESTINATION PROOF REMEDIATION* below and
`GATE3_CONCURRENCY_AND_CLEAR_ALL_MATRIX.md`.) **Gates 5 and 7 remain open.** Historical
recovery is not complete, P0-DATA-01 is not closed, and nothing here asserts Production
readiness.

> Sections below are the running log in chronological order; earlier "remaining failure" lists
> are historical and are superseded by the final section.

## Closed in this round

**VAT S0 guard conflict (R10-GATE-007) — resolved architecturally, guard UNMODIFIED.**
All transformation code was removed from `index.html` and every runtime module. The pure
transformer now lives in `test/support/entries-id-offline-transformer.mjs`: pure functions
only, no I/O, no env/credentials, no CLI, side-effect free, not imported by runtime, not
referenced by `package.json`. It receives the REAL runtime contract helpers by injection, so
it cannot drift from production semantics. A committed boundary test proves each of those
properties, plus that hydration/listener/ordinary-mutation paths cannot reach it.
`test/finance/vat-invariant.test.mjs` is byte-unchanged and passes 5/5; a scan of every added
runtime line against the exact S0 regex is clean.

**Runtime terminology.** `migration_required` → `blocked_entry_identity_required`
(coordinator/UI) with validation reason `missing_entry_id`, and builder-level
`entry_identity_required`. No migration-oriented naming remains in runtime; the artifacts and
the test-only module discuss the future data action openly.

**ID contract (R10-GATE-008) — positive allowlist.** Stored ids are canonical lowercase
RFC 4122 **UUID v4** (version nibble 4, variant nibble 8/9/a/b). The prior negative-denylist
validator is gone. `generateEntryId(cryptoImpl)` is injectable and covers both paths —
`randomUUID()` and a `getRandomValues()` fallback that sets version/variant bits correctly.
Tested rejections: blank, whitespace, numeric, date, ISO timestamp, wrong version, bad
variant, uppercase, too short/long, arbitrary long strings.

**Create-ID collision (R10-GATE-009).** An identical create replays as a genuine no-op; any
difference returns `invalid_identity` with reason `id_collision` — never reinterpreted as an
edit, never patching the existing row, never `empty_patch`, never success. Zero remote
mutation asserted.

## Verified state
- `entries-id-contract.test.mjs` (contract + offline transformer + boundary): **12/12**
- `entries-remote-atomic.test.mjs` (two independent clients, shared remote CAS): **23/23**
- VAT S0 guard: **5/5**, file unmodified
- `entries-lifecycle.test.mjs`: **112/112** (updated at the end of Gate 4B — the figure below
  predates it)
- Everything except the legacy lifecycle file: **376/376 pass, 0 cancelled, 0 skipped**
  (whole-repository figure after Gate 4B: 488/488 across 36 files; after the Gate 3
  destination-proof remediation: **585/585 across 39 files**)
- `tsc --noEmit`: exit 2, 22 diagnostics, all `TS2742` in `src/firebase/refs.ts` — identical
  profile to untouched R9; no new diagnostic
- `git diff --check`: exit 0
- 3 consecutive runs of the cross-writer, contract and VAT suites: 0 failures each

## Remaining blockers
1. ~~**Gate 4** — the retained R6–R9 lifecycle suite is unmigrated.~~ **CLOSED.** All 112 tests
   pass; 32 were converted with an individually justified R10 semantic, 1 status-name correction,
   3 new; nothing deleted, skipped or shimmed. Ledger: `R9_FINDINGS_CLOSURE.md`.
2. **Gate 5 — `IMPLEMENTATION COMPLETE — OPEN PENDING INDEPENDENT REVIEW`.** Real UI
   call-site tests for revenue, supplier, labor, delete and clear-all across every reachable
   outcome now execute the ACTUAL production handlers extracted from `index.html`:
   `entries-ui-call-sites.test.mjs` 49/49, three consecutive identical runs. Two production UI
   defects were found and fixed (R10-GATE-012, R10-GATE-013) and two gaps were referred for
   decision (L-GAP-1, D-GAP-1). Traceability:
   `GATE5_REAL_UI_CALL_SITE_COVERAGE.md`. Not closed on Claude's own validation.
3. **Gate 3 — `APPROVED — CLOSED`** (Codex, no findings at any severity). The documented
   schedule inventory (date-edit vs revenue and vs food-cost
   in both orders, two conflicting date edits, date-edit vs delete, callback re-execution for
   date edits, owner invalidation during a date mutation; and the full clear-all matrix —
   unsorted, duplicate dates, identical rows/different ids, reorder, added field,
   inserted/deleted row, stale owner/generation, degraded listener, malformed,
   missing/malformed/duplicate id, valid unchanged confirmation) is implemented, and the
   destination-proof remediation demanded by the earlier `CHANGES_REQUIRED` verdict is complete:
   sentinel 14/14, concurrency 41/41, clear-all 42/42, three consecutive identical runs each.
   Traceability: `GATE3_CONCURRENCY_AND_CLEAR_ALL_MATRIX.md`.
4. **Gate 7 — `OPEN — NOT STARTED`.** Final validation and release-package review.

---
# GATE 4 SESSION — PARTIAL, WITH A SELF-INFLICTED REGRESSION (read this first)

## Progression this session
| Step | Lifecycle suite |
|---|---|
| Start | 26 pass / 77 fail / 0 cancelled |
| After conversion pass 1 (UUID fixtures + intent helpers + shim removal) | **43 pass / 60 fail / 0 cancelled** |
| After conversion pass 2 (over-greedy `{ rows }` regex + `upsertRows`) | **0 pass / 2 fail / 101 cancelled** ← current |

## What broke and exactly why
Conversion pass 2 applied this regex:

    (\w+)\.lane\.submit\(\{\s*rows(?::\s*(\w+))?\s*(?:,\s*apply:\s*(?:true|false)\s*)?\}\)  ->  $1.upsertRows($2)

It matched call sites whose `rows` variable holds fixtures **without uuids** (e.g. locally
built `[{date, sales}]`). `upsert()` then returns early with `entry_identity_required`
WITHOUT dispatching a transaction, so no transport is created. The test proceeds to
`h.ok(0)`, which throws on `transports[0] === undefined`, and the already-queued
`submitIntent` promise never settles — Node reports "Promise resolution is still pending but
the event loop has already resolved" and cancels the remaining 101 tests.

The runtime is NOT at fault here: refusing to dispatch for an id-less row is the approved
contract working correctly. The defect is in the TEST conversion.

## Correct fix (do this first next session)
1. Find every call site converted to `upsertRows` and give its local `rows` fixture real
   uuids (use the existing `day()` / `idFor()` helpers) instead of bare `{date, sales}`.
2. Make `upsert()` FAIL LOUDLY in tests rather than returning a non-dispatching status:
   throw when `buildEntryUpsertIntent` returns `entry_identity_required` for a fixture that
   was supposed to be identified. A silent early return is what turned a fixture bug into a
   suite-wide hang.
3. Re-run; expect to land at or above the 43-pass mark, then continue converting the
   remaining ~60 individually (categories already known: obsolete snapshot API, renamed
   outcomes, `persistEntries` removal (S1–S8), `persistMutation` port in `saveComposeHarness`,
   and the three source guards).

Do NOT revert the worktree — the pass-1 conversion work is real progress and the CTO
instruction forbids reset/discard. Fix forward from the current file.

## Unaffected and still green (verified after the regression)
- `entries-remote-atomic.test.mjs` (two independent clients, shared-remote CAS): 23/23
- `entries-id-contract.test.mjs` (UUID v4 contract, offline transformer, runtime boundary): 12/12
- `test/finance/vat-invariant.test.mjs` VAT S0 guard: 5/5, file byte-unchanged
- Runtime `index.html` was NOT modified during Gate 4 — only the lifecycle test file changed.

---
# GATE 4 RECOVERY SESSION — PARTIAL. SUITE STILL NOT MEASURABLE.

## Honest result
The lifecycle suite still reports **1 pass / 1 fail / 101 cancelled**. I did NOT restore
measurability. This is the second session in a row ending with the file in an unmeasurable
state, which the CTO explicitly said must not happen again.

## Repairs that DID land (verified individually)
1. **Hydration** — `laneHarness.hydrate()` now delivers a real listener value (the store is
   seeded, so an empty node is a genuinely empty node). The lane reaches true `hydrated`
   state, which clear-all requires. This alone fixed R6-2, previously failing.
2. **Fail-loud `upsert()`** — the dispatch-expecting helper now THROWS with a diagnostic
   naming the date, the blocking status and the offending id, instead of silently returning
   a non-dispatching result. `buildUpsert()` was added as the low-level helper so
   fail-closed negative tests can still inspect a blocked build directly.
3. **Transport diagnostics** — `h.ok(i)` / `h.fail(i)` throw a precise message
   ("no transaction was dispatched — inspect the returned status rather than acking")
   instead of a bare TypeError on `undefined.__commit`.
4. **Harness drain** — every harness registers itself; an `afterEach` settles any un-acked
   transaction, looping because settling one lets the pump dispatch the next.
5. **R6-1 and R6-3 converted** — both encoded whole-row last-writer-wins:
   - R6-1: legacy asserted the later main-save "wins wholesale" (persisted 999). Under R10
     the second submission is a CREATE for an id that already exists with different content
     → `blocked` / `id_collision`, zero mutation, first value intact. Single-flight and
     one-lane ordering assertions preserved.
   - R6-3: legacy asserted a later replace DROPPED accumulated supplier/labor fields. That
     is the history-loss mechanism R10 removes, so the assertion is inverted: a later
     revenue patch updates only its field and preserves `sup-1`, `sup-2` and `payroll`.

## What is still wrong
Despite the drain, one early test still strands a pending promise and Node cancels the rest.
The drain settles transports, but a submission BLOCKED BEFORE transport creation leaves a
`submitIntent` promise that no transport can settle — `__drain` has nothing to reject for it.

**Recommended fix (next session, do this first):** make the drain settle the LANE, not just
transports — e.g. call `lane.invalidate()` during `afterEach`, which settles every
not-yet-dispatched waiter as `cancelled_selection_changed`. Combine with the existing
transport drain. Verify with a deliberately-blocked positive fixture that the suite reports
exactly one failure and zero cancellations before converting any further tests.

## Unaffected and green (re-verified at end of session)
- cross-writer 23/23 · contract/transformer/boundary 12/12 · VAT S0 5/5 (file unchanged)
- `index.html` was NOT modified in this session — recovery was test-side only.

---
# GATE 4A — MEASURABLE BASELINE RESTORED

## Proven root cause (previous diagnosis REJECTED)
My earlier theory — "a submission blocked before transport creation strands a promise only
lane invalidation can settle" — was **wrong**, and `lane.invalidate()` would NOT have fixed
it. An isolated control-flow probe against the real vm-extracted coordinator proved the
actual mechanism:

    after submit : transports=1
    after ack(0) : transports=2  settled=[sup-1]
    after ack(1) : transports=3  settled=[sup-1, sup-2]
    UNACKED transports: [2]      PENDING ops: [payroll]

**The lane's pump dispatches a NEW transaction every time one settles.** A test that acks
fewer transports than the lane dispatches strands its last coordinator result promise. Its
only settlement paths are (a) acking that transport or (b) rejecting it — NOT invalidation,
because the operation is already DISPATCHED and `invalidate()` only cancels waiters whose
`rev > attemptedRev`. Because the test body sat at `await Promise.all([...])` and never
returned, **`afterEach` could never run** — which is why every previous teardown fix failed.

## Fix applied (test-side only)
A deterministic, tick-based watchdog wraps every lane entry point used by the harness
(`submitIntent`, `submitSupplierEdit`, `submitClearAll`). If an operation has not settled
after 60 quiescent `setImmediate` ticks — no timers, no sleeps — the await REJECTS with the
exact un-acked transport list, failing that one test instead of hanging the suite. Operation
accounting (`queued / result_settled / result_rejected / unexpectedly_pending`) is exposed
via `h.ops` and `h.unackedTransports()`.

## Harness regressions added (all passing)
H1 legitimate negative build blocked, zero mutation · H2 positive `upsert()` with an invalid
fixture throws immediately with operation, status, reason, offending id and transport count ·
H3 queued non-dispatched waiter settled by lane invalidation · H4 settling one transport
dispatches the next and cleanup reaches quiescence · H5 an un-acked dispatched operation
fails deterministically instead of hanging · H6 sentinel test after the stranded scenario
still executes (no cascade).

H1 initially failed and the watchdog diagnosed my own test error: identity validation runs
INSIDE the transaction, so a transaction does run and aborts server-side and must still be
acked. Corrected.

## Result — three consecutive runs, no code change between
| Run | tests | pass | fail | cancelled | skipped |
|---|---|---|---|---|---|
| 1 | 109 | 57 | 52 | 0 | 0 |
| 2 | 109 | 57 | 52 | 0 | 0 |
| 3 | 109 | 57 | 52 | 0 | 0 |

Failure list byte-identical across all three runs. 109 = the 103 retained lifecycle tests
plus the 6 new harness regressions. Zero hangs, zero unhandled rejections.

Independent suites re-verified: VAT S0 5/5 (file unchanged) · contract/transformer/boundary
12/12 · cross-writer 23/23 · `git diff --check` exit 0.

**`index.html` was NOT modified during Gate 4A** — every edit was in
`test/dashboard/entries-lifecycle.test.mjs`.

## Remaining 52 ordinary failures (stable, now measurable) — Gate 4B input
- [prod-entries] S43: duplicate incident rows canonicalize to 580,483; state == persisted
- [prod-helper] R6-1(R10): supplier + main-save share ONE lane; single-flight; a colliding second CREATE fails closed instead of overwriting
- [prod-helper] R6-12: exception op-ID isolation composed with executeEntrySave — T1/A and T2/A same date get isolated op IDs
- [prod-helper] R6-3(R10): patches build on the LATEST authoritative row — different suppliers + labor all preserved; a later field patch never drops them
- [prod-helper] R6-5: switch-away-and-back to T1/A — new write waits behind the old physical write, commits last, wins
- [prod-helper] R6-6: local own echo BEFORE ack is not poisoned; external 999 AFTER ack is applied
- [prod-helper] R6-6b: two serialized writes with local-before-ack echoes; two later external payloads both apply
- [prod-helper] R6-7: 100 → 200 → own-echo(200) → delayed own-echo(100); final UI/persisted 200
- [prod-helper] R6-8: external payload after quiescence applies; an identical FUTURE remote payload is not permanently blacklisted
- [prod-helper] R7-10: two-edit ordering preserved with scoped echoes — newest wins; own ignored, different remote applied
- [prod-helper] R7-1: identical payload T1/A → T2/B hydrates the NEW destination (not ignored_own_echo)
- [prod-helper] R7-2: identical payload T1/A → T2/A hydrates the NEW tenant
- [prod-helper] R7-3: identical payload T1/A → T1/B hydrates the NEW business
- [prod-helper] R7-4: switch T1/A → T2/B → back to T1/A — the NEW generation hydrates
- [prod-helper] R7-6: same tenant/business/generation local-before-ack own echo is STILL ignored_own_echo
- [prod-helper] R7-7: a foreign-destination listener cannot consume or clear the T1/A marker; the true own echo still lands
- [prod-helper] R7-8: a FAILED write retires ONLY its own scoped marker; a later identical remote payload is not blacklisted
- [prod-helper] R7-9: identical-fingerprint writes across destinations/generations keep isolated ownership
- [prod-helper] R8-12: superseded same-lane revisions retain correct ack/marker/rendered ordering (incl identical fingerprints)
- [prod-helper] R8-14: no pending local intent → normal live hydration remains applied
- [prod-helper] R8-1: old T1/A write in flight → T2/B initial payload hydrates; old success cannot mutate T2/B
- [prod-helper] R8-2: old write in flight → T2/B hydrates; old FAILURE cleanup affects only old ownership
- [prod-helper] R8-3: cross-tenant same business — T1/A→T2/A while old write in flight hydrates
- [prod-helper] R8-4: same tenant different business — T1/A→T1/B while old write in flight hydrates
- [prod-helper] R8-5: switch away and back — T1/A→T2/B→T1/A (new gen) hydrates before original settles
- [prod-helper] R8-6: behavior is NOT fingerprint-dependent — T2/B payload different from the old write still hydrates
- [prod-helper] R8-9: same tenant/business/generation local-before-ack own echo is STILL ignored_own_echo
- [prod-helper] R9-12: an OWN echo while pending is never stored as a deferred payload
- [prod-helper] R9-13: a NEWER local edit supersedes convergence until it settles
- [prod-helper] R9-17: late listener callback from the previous business never mutates the current one
- [prod-helper] R9-18: late write SUCCESS and FAILURE from a previous generation settle only their own lane
- [prod-helper] R9-19: two rapid edits to the SAME date converge on the newest
- [prod-helper] R9-1: revenue save on a fully hydrated 160-date history preserves ALL dates
- [prod-helper] R9-21: listener echo arriving BETWEEN queued edits cannot regress the newest edit
- [prod-helper] R9-4: current-month filtered subset is REFUSED as a full-replacement payload
- [prod-helper] R9-5: food-cost edit on 160-date history preserves every historical date
- [prod-helper] R9-6: hydration (incl. duplicates) emits NO write intent — self-heal is fail-closed
- [prod-helper] S1+S5: write under T1/A carries tenant T1; switch to T2/B issues no later write
- [prod-helper] S10: a save whose selection changes mid-flight mutates nothing in the new selection
- [prod-helper] S15b: live context issues one request and applies
- [prod-helper] S29: two rapid edits to DIFFERENT suppliers — both persisted
- [prod-helper] S2: same biz id under new tenant rejected
- [prod-helper] S31: LATEST failure reported latest:true; older completion cannot win
- [prod-helper] S32/S33: duplicate starting rows collapse to one canonical row; state == persisted
- [prod-helper] S3: persistEntries missing context rejected before any request
- [prod-helper] S41: normal same-context save succeeds exactly once (real persistence+readback)
- [prod-helper] S42: delayed navigation scheduled with the captured live ctx
- [prod-helper] S4: persistEntries key uses captured ctx.bizId
- [prod-helper] S6/S7: persistEntries writes ONLY the entries key (supplier + labor domain separation)
- [source-guard] R9 wiring: hydration gate, fail-closed self-heal, bootstrap and listener-error are production-wired
- [source-guard] coordinator own-echo ownership is destination+generation scoped (R7; no scalar expectedEchoes)
- [source-guard] every entries writer routes through the ONE lane; no direct persistEntries UI call

---
# GATE 4B — PARTIAL (verified batch checkpoint, suite fully measurable)

Start of Gate 4B: 109 tests / 57 pass / 52 fail / 0 cancelled.
End of this session: **109 tests / 77 pass / 32 fail / 0 cancelled / 0 skipped**, identical
across three consecutive runs. Pass count rose monotonically at every checkpoint
(57 → 71 → 74 → 77); no previously passing test regressed. `index.html` was NOT modified
during Gate 4B — every edit was test-side.

## Batches completed
1. **Listener-echo status vocabulary (19 assertions, ~14 tests).** An earlier bulk rename
   had over-applied: `onListenerEcho` legitimately still returns `"applied"` (a hydration
   status); only MUTATION results became `committed`. Corrected per-site, scoped to
   variables actually assigned from `onListenerEcho`. Fixed most of the R7-*/R8-* cluster.
2. **Removed `persistEntries` API (S3, S4, S1+S5, S2, S6/S7).** The deleted blind
   full-node writer's invariant — a write addressed by the CAPTURED tenant/business, and no
   write for a changed selection — now lives in the remote-atomic mutator, the only entries
   writer. `persistHarness` drives that real path with the same call shape so each original
   assertion maps 1:1. `persistFixed` retained (different destination, single-owner).
3. **`persistMutation` port + source guards (R6-12, S41, S42, S10, 3 guards).**
   `executeEntrySave` now consumes `persistMutation(intent, ctx)`. Guards updated to the
   R10 wiring they actually protect: main save routes as a typed intent; the own-echo
   marker binds its fingerprint to the COMMITTED transaction result; and the
   wholesale-replace guard is replaced by an assertion that the replace path is GONE plus
   the required-identity block.

## Remaining 32 failures — exact names and the next batch
- [prod-entries] S43: duplicate incident rows canonicalize to 580,483; state == persisted
- [prod-helper] R6-1(R10): supplier + main-save share ONE lane; single-flight; a colliding second CREATE fails closed instead of overwriting
- [prod-helper] R6-12: exception op-ID isolation composed with executeEntrySave — T1/A and T2/A same date get isolated op IDs
- [prod-helper] R6-3(R10): patches build on the LATEST authoritative row — different suppliers + labor all preserved; a later field patch never drops them
- [prod-helper] R6-5: switch-away-and-back to T1/A — new write waits behind the old physical write, commits last, wins
- [prod-helper] R6-6: local own echo BEFORE ack is not poisoned; external 999 AFTER ack is applied
- [prod-helper] R6-7: 100 → 200 → own-echo(200) → delayed own-echo(100); final UI/persisted 200
- [prod-helper] R7-10: two-edit ordering preserved with scoped echoes — newest wins; own ignored, different remote applied
- [prod-helper] R7-6: same tenant/business/generation local-before-ack own echo is STILL ignored_own_echo
- [prod-helper] R7-7: a foreign-destination listener cannot consume or clear the T1/A marker; the true own echo still lands
- [prod-helper] R7-9: identical-fingerprint writes across destinations/generations keep isolated ownership
- [prod-helper] R8-12: superseded same-lane revisions retain correct ack/marker/rendered ordering (incl identical fingerprints)
- [prod-helper] R8-9: same tenant/business/generation local-before-ack own echo is STILL ignored_own_echo
- [prod-helper] R9-12: an OWN echo while pending is never stored as a deferred payload
- [prod-helper] R9-13: a NEWER local edit supersedes convergence until it settles
- [prod-helper] R9-17: late listener callback from the previous business never mutates the current one
- [prod-helper] R9-18: late write SUCCESS and FAILURE from a previous generation settle only their own lane
- [prod-helper] R9-19: two rapid edits to the SAME date converge on the newest
- [prod-helper] R9-1: revenue save on a fully hydrated 160-date history preserves ALL dates
- [prod-helper] R9-21: listener echo arriving BETWEEN queued edits cannot regress the newest edit
- [prod-helper] R9-4: current-month filtered subset is REFUSED as a full-replacement payload
- [prod-helper] R9-5: food-cost edit on 160-date history preserves every historical date
- [prod-helper] R9-6: hydration (incl. duplicates) emits NO write intent — self-heal is fail-closed
- [prod-helper] S1+S5: write under T1/A carries tenant T1; switch to T2/B issues no later write
- [prod-helper] S10: a save whose selection changes mid-flight mutates nothing in the new selection
- [prod-helper] S15b: live context issues one request and applies
- [prod-helper] S29: two rapid edits to DIFFERENT suppliers — both persisted
- [prod-helper] S31: LATEST failure reported latest:true; older completion cannot win
- [prod-helper] S32/S33: duplicate starting rows collapse to one canonical row; state == persisted
- [prod-helper] S41: normal same-context save succeeds exactly once (real persistence+readback)
- [prod-helper] S42: delayed navigation scheduled with the captured live ctx
- [source-guard] every entries writer routes through the ONE lane; no direct persistEntries UI call

**Next batch (start here):** the three `upsert_entry never settled` watchdog failures —
R6-3(R10), R9-1, R9-4. These are incomplete transport sequences: the lane dispatches more
transactions than the test acks. Fix by acking every dispatched transport (the watchdog
message names the exact index); do NOT raise the tick threshold or auto-ack. Then the
"strictly equal" cluster (S29, S31, S32/S33, S1+S5, S15b, R9-12), then the remaining
own-echo/newest-wins singles.

Gate 4 is NOT complete, and Gate 4 completion will not close historical recovery or
`P0-DATA-01`.

---
# GATE 4B CONTINUATION — verified checkpoint 81/28 (was 77/32)

109 tests · **81 pass · 28 fail · 0 cancelled · 0 skipped**, identical across three runs.
Pass count rose monotonically (77 → 80 → 81); no previously passing test regressed.
`index.html` unchanged; no runtime edits.

## Batches completed
**Batch 1 — the three watchdog failures (R6-3, R9-1, R9-4) → all pass; exactly the
predicted 80/29.**
- *R6-3*: three creates sharing one id are collisions, not the invariant under test. The
  harness now hydrates the row so the three edits are FIELD PATCHES on one immutable id;
  all three dispatched transactions are settled explicitly and every field is asserted
  preserved. Field-level preservation invariant strengthened, not weakened.
- *R9-1*: was submitting the whole 160-row edited array — the snapshot behaviour R10
  removes — which dispatches one transaction per row. Converted to ONE narrow intent on
  the edited row; still proves every other date survives an August edit.
- *R9-4*: `blocked_history_drop` no longer exists because the wholesale-replace path is
  gone. The protection is now STRUCTURAL: the only write API is a typed intent, so a
  client collection is rejected (`blocked_invalid_intent`), asserted together with the
  absence of the old status and the survival of all 153 pre-August rows.

**Batch 2 — R6-1 create-ID collision → passes.** Asserts: first create commits; second
create with the same id and differing content fails closed; never ordinary or idempotent
success; no committed rows returned; the first value intact; exactly one remote row (zero
unintended mutation); every transaction explicitly settled.

## Observability gap found (NOT a semantic defect — for the next gate)
`applyEntryIntent` classifies a same-id create with differing content precisely as
`reason: "id_collision"`, but `createRemoteEntriesMutator` reports only the outer status,
so the caller/UI receives `reason: "invalid_identity"` and the finer detail is lost.
Semantics are correct (fail-closed, zero mutation); only the detail is dropped. The earlier
plan requires a distinct create-ID-collision UI outcome, so the minimal additive fix is to
propagate `detail: outcome.reason` from the mutator. Deferred deliberately: it is a runtime
change and the protocol requires rerunning every guard suite, which did not fit this budget.

## Remaining 28 failures
- [prod-entries] S43: duplicate incident rows canonicalize to 580,483; state == persisted
- [prod-helper] R6-12: exception op-ID isolation composed with executeEntrySave — T1/A and T2/A same date get isolated op IDs
- [prod-helper] R6-5: switch-away-and-back to T1/A — new write waits behind the old physical write, commits last, wins
- [prod-helper] R6-6: local own echo BEFORE ack is not poisoned; external 999 AFTER ack is applied
- [prod-helper] R6-7: 100 → 200 → own-echo(200) → delayed own-echo(100); final UI/persisted 200
- [prod-helper] R7-10: two-edit ordering preserved with scoped echoes — newest wins; own ignored, different remote applied
- [prod-helper] R7-6: same tenant/business/generation local-before-ack own echo is STILL ignored_own_echo
- [prod-helper] R7-7: a foreign-destination listener cannot consume or clear the T1/A marker; the true own echo still lands
- [prod-helper] R7-9: identical-fingerprint writes across destinations/generations keep isolated ownership
- [prod-helper] R8-12: superseded same-lane revisions retain correct ack/marker/rendered ordering (incl identical fingerprints)
- [prod-helper] R8-9: same tenant/business/generation local-before-ack own echo is STILL ignored_own_echo
- [prod-helper] R9-12: an OWN echo while pending is never stored as a deferred payload
- [prod-helper] R9-13: a NEWER local edit supersedes convergence until it settles
- [prod-helper] R9-17: late listener callback from the previous business never mutates the current one
- [prod-helper] R9-18: late write SUCCESS and FAILURE from a previous generation settle only their own lane
- [prod-helper] R9-19: two rapid edits to the SAME date converge on the newest
- [prod-helper] R9-21: listener echo arriving BETWEEN queued edits cannot regress the newest edit
- [prod-helper] R9-5: food-cost edit on 160-date history preserves every historical date
- [prod-helper] R9-6: hydration (incl. duplicates) emits NO write intent — self-heal is fail-closed
- [prod-helper] S1+S5: write under T1/A carries tenant T1; switch to T2/B issues no later write
- [prod-helper] S10: a save whose selection changes mid-flight mutates nothing in the new selection
- [prod-helper] S15b: live context issues one request and applies
- [prod-helper] S29: two rapid edits to DIFFERENT suppliers — both persisted
- [prod-helper] S31: LATEST failure reported latest:true; older completion cannot win
- [prod-helper] S32/S33: duplicate starting rows collapse to one canonical row; state == persisted
- [prod-helper] S41: normal same-context save succeeds exactly once (real persistence+readback)
- [prod-helper] S42: delayed navigation scheduled with the captured live ctx
- [source-guard] every entries writer routes through the ONE lane; no direct persistEntries UI call

**Next batch:** `S15b` (a listener-echo assertion still expecting `committed`; must be
`applied` — my per-site pass missed it because the variable was not directly assigned from
`onListenerEcho`) and `R9-12` (expects `ignored_own_echo`, now `deferred_pending_local`,
because the own-echo marker's fingerprint is only bound at COMMIT in R10; with
`applyLocally:false` a pre-commit own echo is no longer production-reachable, so convert to
assert that suppression plus safe deferral of a pre-commit external payload). Then S29/S31/
S32/S33/S1+S5, then the own-echo/newest-wins singles.

---

# GATE 4B — COMPLETE. LIFECYCLE SUITE GREEN AND STABLE.

## Result

`test/dashboard/entries-lifecycle.test.mjs`: **112 tests · 112 pass · 0 fail · 0 cancelled ·
0 skipped · 0 todo · 0 unhandled rejections**, on three consecutive runs with no code change
between them. Every one of the 28 remaining failures was converted to valid R10 semantic
coverage; none was deleted, skipped, weakened to a tautology, or routed through a shim.

Two tests were added in this batch (110 → 112), both closing the create-ID-collision
observability gap that the previous checkpoint recorded as deferred.

## The four conversion patterns (each failure is an instance of one)

**Pattern A — own-echo before ack.** R10 binds the own-marker fingerprint at COMMIT, and the
transport passes `{ applyLocally: false }` so Firebase emits no optimistic local event. A
"local-before-ack own echo" is therefore not producible in production. Each such test is
converted into two halves that together are strictly stronger than the original: the pre-ack
payload must be safely DEFERRED and RETAINED (`deferred_pending_local` + `deferredStored`)
rather than swallowed as ours — swallowing it would discard a real remote change — and the
true post-commit own echo must still be `ignored_own_echo`. Applied to R6-6, R7-6, R7-7,
R7-9, R8-9, R9-12. A source guard (R7-6b) pins `applyLocally: false` so the premise cannot
silently regress.

**Pattern B — "newest wins" from a shared base.** Two edits computed from the SAME base was
last-writer-wins over a client snapshot: exactly the R9-FIND-001/003 loss mechanism. R10
refuses the second edit with `conflict` and the precise `conflictPaths`, leaves the committed
value byte-intact, and commits it only once re-based. Each test now asserts the full arc —
commit → conflict → value intact → re-based commit — so ordering is still proven while the
overwrite is proven impossible. Applied to R6-5, R6-7, R7-10, R8-12, R9-13, R9-19, R9-21.

**Pattern C — the deleted full-node writer.** `createPersistence.persistEntries` no longer
exists; `executeEntrySave` hands a typed intent to `io.persistMutation`. The affected
harnesses were rewired onto the REAL `createRemoteEntriesMutator` over a committing store, so
each original assertion maps 1:1 onto the path that actually ships. Applied to R6-12, S41,
S42, S10, S1+S5, and the S43 incident-fixture test.

**Pattern D — client-side canonicalization on the write path.** R10-GATE-005 stores the
authoritative node exactly as received: collapsing duplicate dates client-side is itself a
silent full-node rewrite. Tests that asserted collapse now assert preservation plus
independent addressability by id, and that a patch touches exactly the addressed row.
Applied to S32/S33, S43, R9-6.

## Deliberate semantic changes, individually justified

| Test | Legacy assertion | R10 assertion | Why the change is correct |
|---|---|---|---|
| R6-5 | re-selected generation's write "wins" | it `conflict`s, then commits re-based | it edited from a base predating the OLD commit; winning would erase a value it never observed |
| R6-6, R7-6, R7-7, R7-9, R8-9, R9-12 | pre-ack echo is `ignored_own_echo` | pre-ack payload is deferred+retained; post-commit own echo is ignored | with `applyLocally:false` no pre-ack own echo exists; consuming an unknown pre-ack payload would drop remote data |
| R6-7, R7-10, R8-12, R9-13, R9-21 | newest of two same-base edits wins | second `conflict`s, commits re-based | removes last-writer-wins (R9-FIND-001/003) |
| S31 | the optimistically applied 200 stays rendered after its write fails | the rendered value is the last COMMITTED value (100) | R10 renders no financial value that no transaction committed |
| S32/S33, S43, R9-6 | duplicates collapse to one canonical row | duplicates preserved, independently addressable | R10-GATE-005 — client-side collapse is a silent node rewrite |
| R9-6 | `duplicatesObserved`/`selfHealSuppressed` are true | both false, node stored verbatim | the self-heal write-back was DELETED, not gated; there is no collapse pass left to report |
| S1+S5 | `staleAfterWrite: true` | not-committed is not success; the retired ctx is refused before any transaction | there is no blind write left to report on |
| S15b | `committed` | `applied` | `onListenerEcho` legitimately returns `applied`; an earlier bulk rename over-applied here |
| R9-17, R9-18 | `markHydrated(ctx, rows)` delivers history | a real listener echo delivers history | R9 invariant B — `markHydrated` models an ABSENT node and rejects a non-empty bootstrap |
| source-guard | clear-all passes `{ rows: [], allowDrop: true }` | clear-all is `submitClearAll` with the confirmed content fingerprint | the wholesale-replace path and its options-boolean are gone |

## R10-GATE-010 — create-ID-collision observability gap CLOSED

The accepted R10 contract requires a distinct create-ID-collision outcome at the UI, so the
gap recorded at the previous checkpoint is a real defect, not a cosmetic one. It was closed
end-to-end, additively:

1. `createRemoteEntriesMutator` propagates the transformation's own classification
   (`detail: outcome.reason`, e.g. `id_collision`) alongside the unchanged fail-closed
   `status`/`reason`.
2. The coordinator's `settleQueued` forwards `detail` to the caller.
3. The production save-UI adapter now prefers `r.detail` over the coarser `r.reason` and also
   carries `reason` through.
4. `describeSaveOutcome` accepts EITHER the legacy status string OR the whole typed outcome.
   Given only a status the returned text is byte-identical to before; given the full outcome
   it presents the collision as its own actionable message, and surfaces a precise
   `duplicate_id` / `invalid_identity` / `malformed_remote` reason instead of the catch-all
   `blocked` text.
5. Every entry-save call site (`executeEntrySave`, `deleteEntryById`, clear-all,
   `applySupplierWriteResult`, `createSupplierResultOwnership.settle`) now passes the whole
   outcome.

Covered by R6-1 (`detail === "id_collision"` reaches the caller), R6-1b (the message is
distinct from both the generic blocked text and the generic identity text, never reads as
success, and every legacy status string maps identically in object form), and R6-1c (a source
guard pinning all four propagation points). No stored data is inspected or altered anywhere in
this change — it is a classification and presentation path only.

## Verification performed for this batch

- lifecycle suite: 112/112, **three consecutive identical runs**, 0 cancelled/skipped/todo,
  no unhandled rejection
- `entries-id-contract.test.mjs` 12/12 · `entries-remote-atomic.test.mjs` 23/23
- VAT S0 anti-migration guard: **5/5**, `test/finance/vat-invariant.test.mjs` byte-unchanged
  (`git diff --stat` empty); the S0 added-line regex is clean against the new runtime lines
- **complete repository suite** (mandatory — a runtime change was made): all 36 test files,
  **488 tests, 0 fail, 0 cancelled, 0 skipped**
- syntax: all 4 inline `<script>` blocks of `index.html` parse clean under a JSX-aware parser
  (including the 569 KB `text/babel` block)
- `tsc --noEmit`: exit 2, 22 diagnostics, all `TS2742` in `src/firebase/refs.ts` — identical
  profile to untouched R9, no new diagnostic
- `git diff --check`: exit 0

## Status

**NOT COMMITTED**, as instructed. Working tree carries `index.html` and
`test/dashboard/entries-lifecycle.test.mjs` modified, plus the untracked
`test/dashboard/entries-id-contract.test.mjs`, `test/dashboard/entries-remote-atomic.test.mjs`,
`test/support/` and `artifacts/p0-data-01-r10/`.

Gate 4 is closed. Gates 5, 3 (partial) and 7 remain open as previously recorded.

---

# GATE 3 — CONCURRENCY AND CLEAR-ALL MATRICES COMPLETE

Both remaining Gate 3 matrices are implemented and green. Full traceability — every cell's
required schedule, protected invariant, initial state, writer identities and bases, transport
and listener ordering, expected result per writer, exact authoritative final state, exact local
converged state, negative control and pass state — is in
`GATE3_CONCURRENCY_AND_CLEAR_ALL_MATRIX.md`. This section is the running-log summary only.

## Result

| Matrix | Start | Final | Stability |
|---|---|---|---|
| independent-writer concurrency (`entries-concurrency-matrix.test.mjs`) | 0 (new file) | **41/41** | 3 consecutive identical runs |
| clear-all exact state (`entries-clear-all-matrix.test.mjs`) | 0 (new file) | **40/40** | 3 consecutive identical runs |
| lifecycle (unchanged baseline) | 112/112 | **112/112** | 3 consecutive identical runs |
| complete repository suite | 488/488 across 36 files | **569/569 across 38 files** | 0 fail, 0 cancelled, 0 skipped |

> **SUPERSEDED.** The destination-transition cells summarised in this section did not prove what
> they claimed — see the `CHANGES_REQUIRED` verdict and the *GATE 3 — DESTINATION PROOF
> REMEDIATION* section at the end of this file for the corrected topology, the strengthened
> cells and the current counts (sentinel 14/14, concurrency 41/41, clear-all 42/42, repository
> 585/585 across 39 files).

The approved 23-test cross-writer baseline was NOT refactored: the shared topology was
extracted into a new `test/support/cross-writer-harness.mjs` used only by the two new files, so
`entries-remote-atomic.test.mjs` stays byte-unchanged at 23/23.

## Inventory reconciliation

The Gate 3 blocker list in this file (item 3 above) and the assignment's category list agree;
the former is contained in the latter. Two gaps were resolved by taking the union: the
assignment additionally requires independent creates, rebase-after-conflict, exhausted
operations and business/generation transitions; and the two clear-all lists are orthogonal axes
(node **shapes** vs **orderings**), so both are implemented in full. No documented requirement
was replaced by a smaller invented one.

## Schedules added

Concurrency — independent creates (different dates, same date/different ids, same id with
differing content, same id with identical content, against an absent node); date-edit vs
revenue on different rows and on the same row; date-edit vs food-cost; two conflicting date
edits; date-edit vs delete in three contract-distinct variants; callback re-execution for a
date edit; owner invalidation during a date mutation; rebase-after-conflict including a proof
that a blind retry is not a rebase; exhausted retries; transport rejection; convergent and
empty-diff idempotency; business, tenant and generation transitions; both submission orders for
same-field conflicts; a three-writer disjoint-field schedule; interleaved listener echoes; and
six negative controls including the two watchdog-integrity cells.

Clear-all — the five legal node shapes that must clear when unchanged and the five divergences
that must abort; already-empty idempotency; missing/malformed/duplicate id and malformed node;
the five readiness and precondition gates; races against a create, an edit, a replayed retry,
a second clear and a mid-transaction writer, in both orders; listener delivery before and after
acknowledgement; a stale client's confirmation; business, tenant and generation transitions;
rejection and exhaustion; a proof that a committed clear is never partial; a proof that no
success state exists before commitment; and four negative controls.

Every expected result is derived from the accepted contract, not from execution order. Where
the contract requires a conflict the cell proves a conflict and asserts the committed value
byte-intact; a retry commits only after a genuine rebase.

## Runtime defect found and corrected — R10-GATE-011

**Corrected description (an earlier revision of this section overstated the finding).**
R10-GATE-011 was a **lost idempotency classification / caller-observability defect**: the
coordinator's committed settle branch did not forward the transformation's `reason`
(`already_created` / `already_applied` / `empty_patch`), while the non-committed branch
forwarded `reason` and `detail` correctly. A caller therefore received a bare
`committed_idempotent` and could not tell which condition made the operation a no-op.

It caused **no data loss and no incorrect remote mutation** — remote state was correct in every
case. It is **not equivalent in severity or mechanics** to the R9 date-edit defect, which was a
genuine data-loss/no-op-write bug where an edit silently did not move data. This one is an
observability gap on an operation that behaved correctly, symmetric with the already-accepted
R10-GATE-010 gap on the failure side.

Correction: one additive line in `createEntriesWriteCoordinator` forwarding `res.reason` on the
committed branch. Identity, collision, idempotency and conflict semantics unchanged; no
full-node writer, migration, repair or identity adoption added; remote atomicity and fail-closed
behaviour unchanged. Regressions retained: C-16, C-16b, C-04, K-09b, K-26. Negative control
C-16c proves an ordinary commit carries no idempotency reason.

`index.html` is the only runtime file changed in this assignment.

## Verification

Concurrency ×3 (41/41 each), clear-all ×3 (40/40 each), lifecycle ×3 (112/112 each), cross-writer
23/23, id-contract 12/12, VAT S0 5/5 with the guard byte-unchanged, complete repository suite
569/569 across 38 files, `node --check` clean on every changed `.mjs`, all four inline
`index.html` script blocks parsing clean under a JSX-aware parser, `tsc --noEmit` unchanged at
exit 2 with 22 `TS2742` in `src/firebase/refs.ts`, `git diff --check` exit 0. H1–H6 remain
meaningful and green. `node_modules` and `test/.DS_Store` remain incidental; the worktree `.git`
pointer was not modified. **No commit created.**

## Remaining

Gate 5 (real UI call-site coverage) and Gate 7 (artifact completion and final validation).
Historical recovery is not complete, P0-DATA-01 is not closed, and nothing here asserts
Production readiness.

---

# GATE 3 — DESTINATION PROOF REMEDIATION (verdict `CHANGES_REQUIRED`)

Independent review of the previous Gate 3 submission returned **`CHANGES_REQUIRED`**. The
finding was accepted in full: the cross-writer harness was **not** destination-partitioned, so
the destination-transition cells could not prove what the previous report claimed. That claim
is withdrawn, and Gate 3 is recorded as **OPEN**.

## The accepted proof gap

The harness held one global `state.node`, one global `state.version`, one global listener
collection and destination-agnostic helpers; `transact(tenantId, key, txnFn)` *recorded* `key`
but read and wrote that single node. `(T1, biz:A:entries)`, `(T1, biz:B:entries)` and
`(T2, biz:A:entries)` were physically indistinguishable, so C-12, C-17, C-18, K-29a and K-29b
could assert only local lane state (fresh generation, `desired === null`,
`isHydrated() === false`) against one global remote value.

## The corrected topology

The remote is now partitioned by the exact pair `[tenantId, key]` (`key === biz:${bizId}:entries`)
using a **nested Map** — `Map<tenantId, Map<key, destination>>` — with no delimiter
concatenation anywhere. Each destination independently owns node value, version, listeners,
transaction/CAS attempts, rejection state, retry limit, interleaving hooks, in-flight holds and
transaction log. A transaction **captures** `(tenantId, key)` at dispatch and thereafter reads,
writes, versions and notifies only that destination; an aborted, rejected or exhausted
transaction leaves every destination byte-intact. Every remote helper is destination-explicit
(`remote.at(...)` / `remote.atKey(...)`); a default destination exists only where a fixture
explicitly declares it. `attach()` and `pull()` bind to the destination derived from the
client's selection ctx, matching production listener routing, and logs record the captured
tenant and exact key. The accepted single-destination RTDB semantics and the deterministic
60-tick watchdog are preserved unchanged.

## Evidence

| Suite | Result | Stability |
|---|---|---|
| topology sentinel (`entries-topology-sentinel.test.mjs`) | **14/14** | 3 consecutive identical runs |
| concurrency matrix | **41/41** (count unchanged; 4 cells strengthened) | 3 consecutive identical runs |
| clear-all exact state | **42/42** (was 40; K-29d and K-29e added) | 3 consecutive identical runs |
| lifecycle | **112/112** | 3 consecutive identical runs |
| complete repository suite | **585/585 across 39 files** | 0 fail, 0 cancelled, 0 skipped |

**Anti-regression proof.** Run against a faithful simulation of the former single-node topology
(scratch copy in the build container; worktree untouched, copy removed afterwards), the sentinel
suite scores **0 pass / 14 fail**, the concurrency matrix **37 pass / 4 fail** (C-12, C-17, C-18,
C-19) and the clear-all matrix **37 pass / 5 fail** (K-29a–e). The strengthened cells therefore
depend on real remote routing, not on local lane state.

Each strengthened transition cell asserts: exact initial state of all four seeded destinations;
that the transaction captured the old tenant/key (log equality, empty logs elsewhere,
`allLogs().length === 1`); exact final state of all four destinations with only the captured one
mutated; that the old acknowledgement never entered the new lane (`ownPending === 0`); that an
old-destination listener payload is `stale` and applies nothing; that the new lane stays fresh
and unhydrated until its own listener; and that the new destination then hydrates with exactly
its own value, asserted not equal to the old destination's state. For clear-all, additionally:
the old confirmation cannot be reused at the new destination, and rejection or exhaustion during
the transition mutates nothing anywhere and never reports a partial clear as success. C-19 and
K-29c are same-destination generation cases and are described as such — generation is a local
ownership device, not an RTDB storage axis.

## Runtime

**No runtime defect was discovered by the corrected harness. `index.html` was not modified in
this remediation** — its SHA-256 is byte-identical before and after. The accepted R10-GATE-011
`res.reason` forwarding correction remains intact.

## File integrity — what is provable

`test/finance/vat-invariant.test.mjs` is tracked and `git diff` shows it unmodified against
`b854054`; that is authoritative. The harness, matrices, id-contract suite, cross-writer suite
and offline transformer are **untracked**: git cannot attest to their history, and no commit or
previously recorded digest exists for them, so **their identity prior to this remediation cannot
be established from an authoritative source**. What is recorded is narrower and accurate —
SHA-256 digests taken at the start of this remediation, before any edit, compared with digests
taken after it, which establishes only that a file was untouched *during this remediation*. The
full table is in `GATE3_CONCURRENCY_AND_CLEAR_ALL_MATRIX.md`.

## Remaining

Gate 3 (open, pending review of this evidence), Gate 5 (real UI call-site coverage) and Gate 7
(artifact completion and final validation). Historical recovery is not complete, P0-DATA-01 is
not closed, and nothing here asserts Production readiness. **No commit created.**

---

# GATE 5 — REAL UI CALL-SITE COVERAGE (implementation complete, open pending review)

Full traceability — one row per UI operation, mode, typed status/reason, production handler,
coordinator input, expected visible effect, expected form/modal/state effect, forbidden effect,
exact test name and result — is in `GATE5_REAL_UI_CALL_SITE_COVERAGE.md`. This section is the
running-log summary only.

## What was proven

`test/dashboard/entries-ui-call-sites.test.mjs` — **49/49, three consecutive identical runs** —
executes the ACTUAL production handlers, located in `index.html` by unambiguous anchors and
extracted by brace matching: `saveEntry` (4764), `setSupPayDate` (5812), `submitLaborEntry`
(3935), `deleteEntryByDate` (4839), `deleteEntryById` (4864), the clear-all `onClick` arrow
(6320) and `__revenueMaterialChanged` (4746). Nothing is copied, shimmed, re-implemented or
replaced by a test-only outcome mapper; only React state setters and terminal I/O are
controlled, and every seam (coordinator, mutator, save-UI runner, supplier result ownership,
exception ownership, selection controller) is the real one over the Gate-3-approved
destination-partitioned remote.

Verdicts: immutable-ID addressing everywhere (create mints a fresh uuid, edit retains the
original, delete targets `target.id`); date changes never change identity; duplicate dates and
reorders never redirect a mutation (labor and delete refuse outright; revenue and supplier
target the resolved row's own id and leave the twin byte-intact); stale and cancelled are
silent and silence is never success; conflicts surface the production message with exact
`conflictPaths` and preserve every entered value; all three idempotency reasons survive to the
caller while the UI treats idempotent commits as ordinary success; rejection and exhaustion are
mapped, never retried silently, and never mutate.

## Runtime defects found and fixed — two

**R10-GATE-012** — `executeEntrySave` handed a typed builder refusal
(`entry_identity_required`, an object with no `type`) to the lane, so editing a legacy id-less
row produced the catch-all failure text instead of the specific identity-required message the
sibling delete and labor call sites already show. Fixed by treating any typed builder refusal
as a refusal: surface it and submit nothing. Regression G5-R11.

**R10-GATE-013** — `deleteEntryByDate`, the delete the UI actually invokes, surfaced a failed
delete only via `console.warn`, contradicting its own comment "Surface, do not silently
ignore" and diverging from `deleteEntryById`. Fixed by surfacing through the existing
`entrySaveError` state and the existing mapper, keeping the `res.latest` guard and keeping
stale/cancelled silent. Regression G5-D06.

Both are local UI result-handling fixes. Neither touches destination routing, immutable
identity, collision semantics, conflict detection, retry/rebase behaviour, clear-all
confirmation ownership, migration, repair, or Rules/configuration, and the accepted
`res.reason` forwarding is unchanged. `index.html` is the only runtime file changed.

## Referred for decision (no runtime change)

- **L-GAP-1** — `setDailyLabor` discards the typed labor result and the employees screen has no
  error surface, so a failed labor write is invisible. Adding one is a UX addition, not result
  handling. Current behaviour pinned by G5-L06.
- **D-GAP-1** — `deleteEntryById` is correct but wired to no UI element, so R10-GATE-006's
  individually-deletable duplicates are not reachable by an operator.

## Verification

Gate 5 ×3 (49/49 each); topology sentinel 14/14; concurrency 41/41; clear-all 42/42; lifecycle
×3 (112/112 each); cross-writer 23/23; id-contract 12/12; focused R10-GATE-011 coverage green;
H1–H6 green; VAT S0 5/5 with the guard unmodified vs `b854054`; complete repository suite
**634/634 across 40 files**; `node --check` clean; all four inline `index.html` scripts parse
clean; `tsc --noEmit` unchanged at exit 2 with 22 `TS2742` in `src/firebase/refs.ts`;
`git diff --check` exit 0. Five isolated mutation probes (run on a build-container scratch copy,
never the worktree, deleted afterwards) each caused the suite to fail. **No commit created.**
