# P0-DATA-01 R8 — Known Limitations

All items are non-blocking and documented; none reintroduces
`P0-DATA-01-R7-FIND-001` or weakens R7 ownership guarantees.

1. **Deferred external state is stateless (by design).** A `deferred_pending_local`
   payload is not stored or replayed; the current destination converges to server
   truth on the next quiescent listener emit (unchanged from R6/R7). This is why
   there is no cross-lane deferred-payload leak: there is no stored deferred
   payload to mis-scope (proven by `R8-10`). Terminal behavior for a same-lane
   deferred payload is convergence on the next quiescent echo.

2. **Global single-flight transport retained.** `writing` still serializes to one
   physical write at a time across generations (`pump`), so a new destination's
   own write queues behind an old destination's in-flight write until it settles
   (`R8-8`/`R8-11`). This is the existing R6/R7 transport model; only the
   HYDRATION gate was decoupled from it. A per-destination parallel transport is
   out of scope.

3. **Lane owner from selection generation.** `lane.owner.gen` is the selection
   generation carried by the listener ctx — the correct identity for
   listener/hydration matching — not a global monotonic clock.

4. **Initial lane owner may be null in production.** The coordinator is created
   once at mount when the selection may be unset; the initial lane's owner can be
   null until the first `invalidate()`. No listener hydration with pending intent
   occurs before a real selection installs an owned lane; a null-owner lane simply
   applies (never wrongly defers). In tests the harness selects before creating
   the coordinator, so the initial lane is always owned.

5. **No DOM/React render harness.** Tests drive the exact production
   coordinator/selection/persistence seams with deferred committing transports,
   not a mounted component tree; the single production wiring
   (`onListenerEcho(val, ctxAtSetup)`, line ~3699) is asserted by the source-guard.

6. **TypeScript `TS2742` (22, `src/firebase/refs.ts`).** Pre-existing
   symlink-portability diagnostics; `--preserveSymlinks` is clean. Unchanged by R8.
