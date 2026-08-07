# R9 — CHANGE SUMMARY (P0-DATA-01 save-lifecycle hardening)

**Branch:** `claude/p0-data-01-r9` · **Base:** `3685c9266c7cb14df53da890341808de25224245` (R8, `CHANGES_REQUIRED`)
**Scope:** the financial `entries` save lifecycle only. **No display/month-selector work is included.**

## Why R9 exists
R8 closed the R7 cross-destination hydration blocker but was rejected: a same-lane
`deferred_pending_local` listener payload was **stateless**, so on write failure with no
subsequent listener emit the UI and the active lane stayed on failed optimistic rows while
persistence held something else (`P0-DATA-01-R8-FIND-001`). Separately, the revenue-display
review confirmed the deployed lane can turn any stale/partial/pre-hydration state into a
full-parent replacement (`P0-REV-WRITE-004`), that food-cost shares that lane
(`P0-REV-FOOD-008`), and that automatic self-heal writes exist (`P0-REV-SAFETY-005`).

## What changed (all inside `createEntriesWriteCoordinator` + its production wiring)

1. **Hydration gate (invariant B).** Every lane now carries `hydrated`. `submit()` refuses with
   `blocked_unhydrated` **before** any `desiredRows`/`desiredRev` mutation, optimistic apply,
   waiter or pump — so a pre-hydration save produces **no persistence intent at all**.
   A lane hydrates only from an authoritative source: a listener payload for its own owner, or
   the explicit `markHydrated(ctx, rows)` bootstrap.

2. **Absent-node bootstrap.** Firebase `onValue` never fires for a missing node, so a business
   with no entries yet would be permanently unwritable. A **read-only** probe resolves exactly
   that case: node genuinely absent (`"not found"`) → `markHydrated(ctx, [])`. Any *other* read
   failure is treated as a hydration failure (fail-closed), never as "empty". It never writes.

3. **Stateful deferral + terminal convergence (closes R8-FIND-001).** A deferred remote payload
   is retained with its owning `{tenantId, bizId, gen}`. When the owning write settles
   **unsuccessfully** and no newer local intent exists, `convergeDeferred()` applies it —
   deterministically, with **no dependency on a further listener emission**. On success the
   deferral is discarded (our committed value is newer). It is never applied across owners.

4. **Authoritative persistence source (invariant C).** Once hydrated, transforms always build on
   the lane's authoritative `desiredRows`; a caller-supplied `baseRows` (a React/UI collection
   that may be month-filtered, sorted or stale) can never become the base. For wholesale
   replaces, a **history-drop guard** refuses any payload that silently drops business dates the
   authoritative history contains (`blocked_history_drop`). Genuine removals declare `allowDrop`
   (delete-by-date uses a transform; clear-all now declares it explicitly).
   **A current-month display subset is therefore structurally incapable of replacing the node.**

5. **Fail-closed self-heal (invariant G, `P0-REV-SAFETY-005`).** The automatic duplicate
   write-back is **removed**. Duplicates are canonicalized for display, the condition is surfaced
   (`duplicatesObserved`), and no write is emitted. Opening or navigating the screen now
   provably produces zero entries write intent.

6. **Fail-closed on listener error (invariant G).** `onListenerError(ctx)` marks the lane
   `hydrationFailed`; writes stay blocked rather than persisting from an unverified state.
   `window.storage.subscribe` gained an optional (additive, backwards-compatible) error callback.

7. **Owner validity (invariant A).** A write requires a fully identified `{tenantId, bizId, gen}`;
   a null/partial context is refused with `blocked_no_owner` (covers logout/unmount).

Ordering/concurrency (invariant D), teardown (E) and revenue/food-cost parity (F) build on the
existing R6–R8 single-lane, revision-aware machinery, now behind the gates above.

## Files changed
- `index.html` — coordinator hardening + production wiring (listener error, bootstrap, clear-all).
- `test/dashboard/entries-lifecycle.test.mjs` — harness models the hydrated lifecycle; 24 new R9 tests.
- `artifacts/p0-data-01-r9/**` — this evidence bundle.

No dependency, Firebase config, Rules, IAM, schema, server-API or financial-definition changes.
