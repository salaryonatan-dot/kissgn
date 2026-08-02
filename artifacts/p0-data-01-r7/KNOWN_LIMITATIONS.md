# P0-DATA-01 R7 — Known Limitations

All items are non-blocking and documented; none reintroduces `R6-FIND-001` or
weakens own-echo scoping.

1. **Generation counter is per selection controller.** Ownership `gen` is the
   selection generation carried by the listener ctx (the same value production
   passes as `ctxAtSetup`). This is the correct identity for listener/echo
   matching; it is not a global monotonic clock across unrelated subsystems.

2. **Bounded-16 backstop retained.** Beyond scoped retirement (consumed echo /
   failed write / invalidation), the marker list is still capped at 16 as a
   defensive backstop. With scoping this cap can no longer cause a cross-
   destination mis-consumption; at worst an ancient same-destination fingerprint
   could retire early, which only means an identical future payload hydrates
   (never data loss, since desired already holds the value).

3. **Deferred-external policy unchanged.** A non-matching external payload
   arriving while a same-destination local op is pending is still
   `deferred_pending_local` (R6 behavior), reconciled by the next quiescent echo.
   True multi-writer conflict resolution remains out of P0 scope.

4. **No DOM/React render harness.** Tests drive the exact production
   coordinator/selection/persistence seams with deferred committing transports,
   not a mounted component tree; the single production wiring
   (`onListenerEcho(val, ctxAtSetup)`) is asserted by the `[source-guard]` test.

5. **Marker retirement on invalidate reads `io.selection.current()`.** In
   production `invalidateSelection` bumps the selection BEFORE calling the
   coordinator's `invalidate()`, so `current()` is the new destination and old
   markers are retired. A fallback to `capture()` is used if a selection stub
   lacks `current()`.

6. **TypeScript `TS2742` (22, `src/firebase/refs.ts`).** Pre-existing
   symlink-portability diagnostics; `--preserveSymlinks` is clean. Unchanged by R7.
