# P0-DATA-01 R8 — Change Summary

**Finding closed:** `P0-DATA-01-R7-FIND-001` — an old destination's physically
in-flight write could still suppress the newly selected destination's first
legitimate listener hydration through the coordinator-wide global `writing` flag.

**Base / parent (R7):** `dc321d8cc47d5d023c17cb5d70bffbdce8fa42fe`
**Grandparent (R6):** `13e70a815af391516166c2af6753657493bb20e4`
**Branch:** `claude/p0-data-01-r8-pending-write-isolation`
**Commit subject:** `fix: isolate pending entry hydration`

## The defect
`createEntriesWriteCoordinator` used ONE coordinator-wide `writing` flag both to
serialize physical transport AND, inside `onListenerEcho`, to decide
`deferred_pending_local` (`if (writing || ln.desiredRev > ln.attemptedRev)`).
After a selection switch, `invalidate()` installs a fresh lane and retires
incompatible markers, but `writing` stays true while the OLD generation's write
is still physically in flight. So the fresh destination's first live listener
payload was deferred (not applied): the new destination stayed empty/stale with
`desired: null`.

## The fix (index.html, `createEntriesWriteCoordinator`)
The hydration deferral is now scoped to the CURRENT live lane's OWN pending
local intent, independent of the global transport flag:

1. **Explicit lane ownership.** Each lane carries an immutable
   `owner = { tenantId, bizId, gen }` captured from the selection at lane
   creation (`newLane(gen, curOwner())` at init and in `invalidate()`).
2. **Scoped in-flight tracking.** A new `writingLane` reference records the EXACT
   lane whose physical write is currently in flight (object identity → a distinct
   lane per selection epoch). `writing` remains ONLY a global transport
   serializer (one physical write at a time).
3. **Scoped deferral.** `onListenerEcho` now defers only when the current lane is
   owned by this live callback's tenant+business+generation AND has its OWN
   pending intent:
   `laneOwned && (ownWriteInFlight || ln.desiredRev > ln.attemptedRev)`,
   where `ownWriteInFlight = writing && writingLane === ln`.
   A physically running write from an old/foreign tenant/business/generation is
   never sufficient to defer the current destination's hydration.

This preserves R7's exact same-lane semantics — a failed write (writing=false,
nothing queued) still applies external payloads; a same-lane in-flight or queued
write still defers — while a foreign in-flight write no longer gates hydration.

## Distinctions made explicit
- **Global transport/pump activity** (`writing`): one physical write at a time,
  across generations. Serialization only.
- **In-flight write ownership** (`writingLane`): which exact lane's write is on
  the wire right now.
- **Current-lane pending local intent** (`laneOwned && (ownWriteInFlight ||
  desiredRev > attemptedRev)`): the only thing that defers a live hydration.
- **Deferred external listener state**: stateless — a deferred payload is not
  stored or replayed; convergence is via the next quiescent listener emit
  (unchanged from R6/R7). Nothing is carried across lanes.

## Tests & negative control
14 new deterministic cases (`R8-1..R8-14`); all 65 R7 cases retained. Focused
**79/0**, full suite **420/0**, VAT **5/0**, forecast pass, tsc unchanged. A
`/tmp` negative control runs the exact pending-switch order against each
worktree's real coordinator: R7 → `deferred_pending_local` (hydrated:false,
desired:null); R8 → `applied` (hydrated:true, old callback stale, no current
mutation). The acknowledged-write R6 control remains `applied` on both.
