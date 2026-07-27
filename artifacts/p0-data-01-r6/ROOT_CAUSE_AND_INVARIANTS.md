# P0-DATA-01 R6 — Root Cause & Invariants

## R5 root cause

R5 serialized only supplier edits inside `createEntriesWriteCoordinator`; every other full-blob
entries writer (main save, delete, clear-all, employee labor) called the persistence transport
directly. Two independent terminal writes to the same `biz:{bizId}:entries` destination could be in
flight at once, so completion order — not logical order — decided the persisted value. Separately,
the scalar `expectedEchoes` counter, the lane-local `latest` flag, the once-captured insight role
closure, and the business-only in-flight clear each left a race or stale-state hole.

## R6 invariants (all executable)

1. **One destination lane.** Every entries writer submits to the single lane; the raw transport is
   private to it. No two full-blob writes to the destination overlap.
2. **Logical order wins.** Global single-flight; the newest non-cancelled desired revision commits
   last; an older success/failure can never overwrite or roll back a newer op, in state OR storage.
3. **Captured identity.** Terminal tenant+key derive from the captured ctx; `_currentTenantId` is
   never read after operation capture.
4. **Explicit settlement.** Every submitted op has an operation record and exactly one waiter
   settlement; on invalidation, not-yet-dispatched ops settle `cancelled_selection_changed`; the
   active write finalizes only its retired lane; pending accounting is per-generation, non-negative.
5. **Fingerprint echo ownership.** Own writes are identified by canonical-payload fingerprint
   registered at dispatch (local-before-ack safe); external payloads are never consumed by a counter;
   own fingerprints are bounded so no identical future remote payload is permanently blacklisted.
6. **Supplier error ownership.** The visible supplier error is mutated only by a result whose token
   still owns the current supplier UI, whose captured selection is still live, and while mounted.
7. **Insight eligibility at call time.** The retained loader reads current role via a render-updated
   ref; null→owner login re-enables loads on the same instance.
8. **Coherent save-UI invalidation.** Business/tenant/logout clear the observable `entrySaveInFlight`
   for the still-mounted UI; unmount marks the port dead first so no post-unmount state update occurs.
9. **Domain isolation preserved.** Entries writers never touch fixed; fixed never touch entries.
10. **R2 replay/canonicalization preserved.** Explicit save wins wholesale; earliest-non-zero scalar;
    nested-map union earliest-wins never summed; deterministic idempotent canonicalization; incident
    canonical ₪580,483.

## Intent semantics (replace vs transform)

Replace (`op.rows`): wholesale — main save (later explicit save wins wholesale) and clear-all.
Transform (`op.transform(desired)`): map the latest desired canonical rows — supplier, labor, delete.
Self-heal: conditional deduped replace through the same lane, only if the listener observation still
owns the baseline and no newer local intent supersedes it (fingerprint-guarded, no loop).
