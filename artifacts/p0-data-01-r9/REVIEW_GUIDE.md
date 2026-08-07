# R9 — REVIEW GUIDE

## Verify identity first
```
git -C <r9-worktree> rev-parse HEAD          # the R9 commit
git -C <r9-worktree> rev-parse HEAD~1        # must be 3685c926... (R8, unmodified)
git -C <r9-worktree> diff --stat HEAD~1..HEAD
```
Expect exactly: `index.html`, `test/dashboard/entries-lifecycle.test.mjs`,
`artifacts/p0-data-01-r9/**`. Nothing else.

## Read the diff in this order
1. **`createEntriesWriteCoordinator` — lane shape.** `newLane()` gains `hydrated`,
   `hydrationFailed`, `deferred`, `duplicatesObserved`. All per-lane => inherently owner-scoped.
2. **Helpers** `ownerUsable` / `sameOwner` / `dateKeysOf` / `convergeDeferred`. `convergeDeferred`
   is the R8-FIND-001 fix; check its four refusals (not current lane / retired, owner mismatch,
   newer local intent, no payload).
3. **`submit()` gates.** Confirm every rejection returns **before** `desiredRows`, `desiredRev`,
   `applyRows`, waiter creation and `pump()` — i.e. a blocked save leaves *no* trace.
4. **pump settle.** Success clears the deferral; failure calls `convergeDeferred` and reports
   `converged` on the settled result.
5. **`onListenerEcho`.** Deferral now stores the payload; the `desiredRev++; pump();` self-heal
   write-back is gone; hydration flags are set on the applied path.
6. **`invalidate()`.** Owner-scoped deferral cleanup.
7. **Production wiring.** Listener error -> `onListenerError`; absent-node bootstrap (a read that
   distinguishes `"not found"` from any other failure — never a write); clear-all declares
   `allowDrop: true`; `window.storage.subscribe` gained an optional error callback (additive).

## The questions R8 failed — check them directly
- Same-lane deferred payload + **write failure** + **no further listener emit**: do rendered
  state, the active lane and persistence converge deterministically? -> `R9-10`.
- Can a **current-month subset** become a full-parent payload? -> `R9-4` (expects
  `blocked_history_drop`, `droppedCount === 153`, zero transports).
- Does **opening/navigating** emit any entries write? -> `R9-6` (expects zero transports even with
  duplicate dates present).
- Do **food-cost** and **revenue** saves share identical guarantees? -> `R9-3`/`R9-5` vs `R9-2`/`R9-1`.

## Reproduce the negative control (proves R9 actually fixes R8)
A standalone probe vm-extracts **both** coordinators and runs the identical scenario:
R8 ends with `desired = 200` (failed optimistic rows; another emit required);
R9 ends with `desired = 999` (converged onto the deferred remote payload).
See `COMMANDS_SANITIZED.log` for the invocation; the probe lives under `/tmp` and is not committed.

## Adversarial angles worth probing
- Can a deferred payload from owner X reach owner Y? (`R9-14`; try variations.)
- Can `markHydrated` be replayed to overwrite real history? (It no-ops once hydrated ->
  `already_hydrated`.)
- Does a failed write de-hydrate the lane and strand the user? (`R9-23` asserts it does not.)
- Does the history-drop guard block a legitimate single-date delete? (It must not — delete uses a
  transform, not a wholesale replace; see the retained `R6-2`.)
- Is the hydration gate reachable around? (Every entries writer funnels through `submit()`; the
  raw transport `persistEntriesRaw` is private to the lane — see the retained source guard.)
