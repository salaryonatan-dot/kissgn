# P0-DATA-01 R8 — Root Cause & Invariants

## Root cause (confirmed from R7 production code)
`index.html` → `createEntriesWriteCoordinator`:
- one coordinator-wide `let writing = false;` served BOTH transport
  serialization (`pump`: `if (writing) return;`) and the listener hydration gate.
- `invalidate()` installs a fresh lane and retires incompatible markers, but does
  not (and must not) force `writing=false` while the old physical write is still
  unresolved.
- `onListenerEcho`: after the stale-context and scoped own-echo checks, it
  returned `deferred_pending_local` on `writing || ln.desiredRev > ln.attemptedRev`.
  The `writing` term is global, so an OLD generation's in-flight write deferred
  the CURRENT destination's first live hydration — leaving it `desired: null`.

Independent probe (pending-switch): dispatch `T1/A`, switch to `T2/B` before ack,
deliver the live `T2/B` initial payload → R7 returned `deferred_pending_local`,
`hydrated:false`, active `desired:null`.

## Final ownership representation
- **Lane owner (new in R8):** `lane.owner = { tenantId, bizId, gen }`, captured
  immutably from `io.selection.current()` at lane creation (init + `invalidate()`).
- **Own-write marker (R7, retained):** `{ tenantId, bizId, gen, fp, rev }`.
- **In-flight write identity (new in R8):** `writingLane` — the exact lane object
  whose physical write is on the wire (object identity = one lane per epoch).

## The four separated concepts
| Concept | State | Role |
|---|---|---|
| Global transport/pump activity | `writing` | one physical write at a time (serialization only) |
| In-flight write ownership | `writingLane` | which lane's write is currently on the wire |
| Current-lane pending local intent | `laneOwned && (writing && writingLane===ln \|\| desiredRev>attemptedRev)` | the ONLY thing that defers a live hydration |
| Deferred external listener state | (stateless) | not stored/replayed; convergence via next quiescent emit |

## Enforced invariants
1. **Pump ≠ hydration gate.** `writing` alone never causes `deferred_pending_local`.
2. **Immutable ownership.** Lane owner and markers capture tenant/business/gen at
   creation/dispatch; never reconstructed from mutable current-selection globals.
3. **Exact-lane deferral.** A live callback defers only if the ACTIVE lane it owns
   (matching tenant+business+generation) has its OWN pending intent (own in-flight
   write or queued-not-dispatched revision). A foreign in-flight write is never
   sufficient.
4. **Current-destination hydration.** A fresh active lane with no own pending
   intent applies immediately, even while an old foreign write is unresolved —
   for identical payloads, different payloads, different tenants, different
   businesses, and switch-away-back to a new generation.
5. **Preserve current local intent.** If the new lane already has its own pending
   intent, a listener callback is deferred (not clobbered).
6. **Scoped deferred state.** Deferral is stateless; a dropped deferred payload is
   never carried into another tenant/business, replayed after its generation is
   stale, or flushed by an unrelated old write's completion. Terminal behavior:
   convergence on the next quiescent listener emit (unchanged from R6/R7).
7. **Old-completion isolation.** An old-generation write settles against its own
   captured lane (`writeLane`); it never clears the current lane's marker/pending
   intent, resets the current pump, mutates rendered/current entries, or writes
   persistence for the active destination.
8. **R7 ownership preserved.** Stale-first rejection, full-scope own-echo match,
   no fingerprint-only fallback, failed-write marker cleanup by object identity,
   generation isolation, same-generation own-echo suppression, bounded markers.
9. **Ordering/convergence preserved.** Two-edit ordering, identical fingerprints
   across revisions, persisted supplier ordering, failed-write visibility,
   local-before-ack own echo, self-heal, captured-tenant persistence, listener
   invalidation, VAT invariants, forecast behavior.
