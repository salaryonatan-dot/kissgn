# P0-DATA-01 R7 — Change Summary

**Finding closed:** `R6-FIND-001` — an own-write echo fingerprint could be consumed
across a different tenant, business or listener generation, suppressing legitimate
remote hydration of a newly selected destination.

**Base (R6):** `13e70a815af391516166c2af6753657493bb20e4`
**Branch:** `claude/p0-data-01-r7-fingerprint-ownership`
**Commit subject:** `fix: scope entries echo ownership`

## The defect
R6 registered pending own-write state as `[{ fp, rev }]` (global, unscoped) and
`onListenerEcho` consumed the first record whose `fp` matched the echo — before
proving the marker belonged to the listener's tenant, business and generation.
An identical canonical payload arriving in a different destination (`T1/A→T2/B`,
`T1/A→T2/A`, `T1/A→T1/B`) or after switch-away-and-back was wrongly classified
`ignored_own_echo`, leaving the new destination empty/stale.

## The fix (index.html, `createEntriesWriteCoordinator`)
Own-echo ownership is now **destination- and generation-scoped**, captured
immutably from the write's own context at dispatch:

1. **Scoped marker creation.** At dispatch the marker records
   `{ tenantId, bizId, gen, fp, rev }` from the write's captured ctx
   (`io.selection.capture()`), never reconstructed later from mutable globals.
2. **Scoped consumption.** `onListenerEcho` classifies an event as
   `ignored_own_echo` only when the listener ctx is live AND the marker matches
   on `tenantId`, `bizId`, `gen` and `fp`. A fingerprint match alone is never
   sufficient; an identical payload in another tenant/business/generation is
   treated as legitimate remote hydration.
3. **Stale-first ordering.** A stale listener callback (different
   tenant/business/generation) is rejected (`stale`) before it can consume,
   clear, retire or mutate any marker or destination state.
4. **Generation isolation.** Switch-away-and-back allocates a new generation
   (existing selection controller); an earlier-generation marker can never
   suppress the first hydration of the new generation.
5. **Scoped retirement.** A failed write retires ONLY its own marker;
   `invalidate()` retires markers that no longer belong to the now-current
   destination/generation (never another destination's), bounding accumulation;
   the bounded-16 cap remains as a backstop.
6. **Preserved own-echo suppression.** Same tenant/business/generation
   local-before-ack echoes are still `ignored_own_echo`.

Production has a single `onListenerEcho` call site
(`entriesWriteCoordRef.current.onListenerEcho(val, ctxAtSetup)`) which always
passes the listener's captured ctx, so production is always fully scoped.

## Tests
`test/dashboard/entries-lifecycle.test.mjs`: existing 55 cases retained and
strengthened (each own-echo call now passes the live listener ctx); 10 new R7
cases (`R7-1..R7-10`) prove cross-tenant/business/generation hydration,
switch-away-back hydration, stale-listener rejection, cross-destination
non-consumption, failed-write scoped cleanup, identical-fingerprint isolation,
same-generation own-echo preservation, and two-edit ordering. Focused suite:
**65 pass / 0 fail**.

## Negative control
A `/tmp` probe loads each worktree's real coordinator and runs `T1/A→T2/B`:
R6 → `ignored_own_echo` (hydrated:false); R7 → `applied` (hydrated:true).
R6 was not modified.
