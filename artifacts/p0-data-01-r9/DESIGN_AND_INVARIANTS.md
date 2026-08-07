# R9 — DESIGN AND INVARIANTS

## Model
One destination **lane** per `{tenantId, bizId, generation}`. All full-blob `entries` writes —
revenue save, food-cost/supplier edit, employee labor, delete, clear-all, listener hydration —
route through that single lane. R9 adds a **lifecycle state machine** to each lane:

```
                    markHydrated(ctx,[])            (absent node bootstrap, read-only)
                              |
  [UNHYDRATED] --------------- ---------------> [HYDRATED] --submit()--> [WRITING] --+
    writes: BLOCKED           |                  writes: ALLOWED                     |
    onListenerError --> [FAILED] (still BLOCKED)                                     |
                              ^                                                      |
                onListenerEcho(owned payload)                                        |
                                                                                     |
   settle: ok   -> commit rev, discard deferral <------------------------------------+
   settle: fail -> convergeDeferred() -> apply retained remote payload <--------------+
   invalidate() -> new lane, UNHYDRATED, owner-scoped deferral cleanup
```

## Invariants and how each is enforced

**A — Owner and generation isolation.** Every lane, marker, waiter, deferral and retry carries an
immutable `{tenantId, bizId, gen}` captured at creation. `ownerUsable()` refuses a null/partial
context (`blocked_no_owner`); `sameOwner()` guards hydration, deferral replay and marker
retirement. Stale callbacks are rejected before touching any state (`isLive` check first).
*Tests: R9-8, R9-9, R9-14, R9-17, R9-18.*

**B — Hydration gate.** `submit()` returns `blocked_unhydrated` before mutating anything, so a
pre-hydration save emits **no** persistence intent. Hydration comes only from an owned listener
payload, a converged remote payload, or the read-only absent-node bootstrap.
*Tests: R9-2, R9-3, R9-7, R9-15, R9-16, R9-6.*

**C — Authoritative persistence source.** Post-hydration, transforms build on `desiredRows` only —
never caller `baseRows` (which may be a month-filtered/sorted/stale UI collection). Wholesale
replaces are rejected when they drop known business dates unless `allowDrop` is declared.
*Tests: R9-4 (month subset -> `blocked_history_drop`, 153 drops), R9-1, R9-5.*

**D — Ordering and concurrency.** Single-flight pump; monotonic `desiredRev`/`attemptedRev`/
`committedRev`; waiters resolve by revision; the newest intent always wins; a failure never
discards a later queued change; convergence yields to newer local intent.
*Tests: R9-19, R9-20, R9-21, R9-22, R9-23, plus the retained R6/R7/R8 ordering suite.*

**E — Business switching and teardown.** `invalidate()` retires the lane, settles undispatched
waiters as `cancelled_selection_changed`, starts the successor **unhydrated**, and drops
deferrals not owned by the now-current destination. Late callbacks may be observed, never applied.
*Tests: R9-9, R9-14, R9-15, R9-16, R9-17, R9-18.*

**F — Revenue / food-cost parity.** `submitSupplierEdit` is a thin transform over the same
`submit()`, so it inherits every gate above by construction — not by duplication.
*Tests: R9-3, R9-5, R9-19, R9-20, R9-23.*

**G — Fail closed.** Listener error -> `hydrationFailed`, writes stay blocked. Malformed owner ->
blocked. **The automatic duplicate self-heal write-back is removed**: a financial node is never
silently replaced from client-derived state; the condition is surfaced for explicit repair.
*Tests: R9-6, R9-7, R9-8.*

## Deliberate design choices
- **Gate at the coordinator, not at each call site.** Every writer already funnels through the one
  lane, so a single gate is provably complete; per-call-site checks would be bypassable.
- **Block, don't buffer, pre-hydration saves.** Queuing a save against unknown history would
  reintroduce the destructive payload risk the gate exists to remove. The save is refused with a
  status the caller can surface.
- **`allowDrop` is explicit.** Deletion is legitimate; silent history loss is not. Making removal
  declare itself turns "did this payload intend to drop 153 days?" into an explicit contract.
- **Latest-wins deferral.** Only the most recent remote payload is retained; older ones are
  already superseded by definition.
- **The bootstrap never trusts a swallowed error.** Only a literal `"not found"` means "no node";
  every other failure is fail-closed. This is the same class of bug R9 exists to prevent.
