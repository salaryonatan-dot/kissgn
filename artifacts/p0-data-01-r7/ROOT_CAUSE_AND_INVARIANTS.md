# P0-DATA-01 R7 — Root Cause & Invariants

## Root cause (confirmed from R6 code)
`index.html` → `createEntriesWriteCoordinator`:

- `const ownPending = [];   // [{fp, rev}]` — pending own-write state carried ONLY
  a content fingerprint and revision; no tenant, business or generation.
- At dispatch: `ownPending.push({ fp: fp(snapshot), rev });` — the write ctx
  (`io.selection.capture()`) was captured for the transport but its
  tenant/business/generation was NOT recorded on the marker.
- In `onListenerEcho(rows, ctx)`: after a liveness gate, consumption was
  `ownPending.findIndex(r => r.fp === echoFp)` — a **fingerprint match alone**.

Because the marker was unscoped, an identical canonical payload delivered to a
DIFFERENT destination (whose listener ctx was legitimately live) matched an old
destination's fingerprint and returned `ignored_own_echo`, suppressing the new
destination's first hydration. `invalidate()` did not retire incompatible
markers, so a marker also survived switch-away-and-back and suppressed the new
generation's hydration.

Reproduced (independent probe): `T1/A→T2/B`, `T1/A→T2/A`, `T1/A→T1/B`, and
switch-away-back all wrongly returned `ignored_own_echo` and left the newly
selected destination empty/stale.

## Ownership representation (R7)
```
marker = { tenantId, bizId, gen, fp, rev }
```
- `tenantId`, `bizId`, `gen` — captured immutably from the WRITE's ctx
  (`io.selection.capture()`) at dispatch (the same generation counter the
  listener carries via its captured ctx).
- `fp` — canonical content fingerprint (`io.fingerprint(canonicalRows)`).
- `rev` — the lane revision (ordering/accounting).

## Enforced invariants
1. **Scoped marker creation.** Ownership is captured from the actual write ctx at
   dispatch; never reconstructed later from mutable globals or the currently
   selected business.
2. **Scoped consumption.** `ignored_own_echo` requires: listener ctx live
   (`isLive`) AND `marker.tenantId === ctx.tenantId` AND `marker.bizId ===
   ctx.bizId` AND `marker.gen === ctx.gen` AND `marker.fp === echoFp`. A
   fingerprint match alone is never sufficient.
3. **Decision ordering.** A stale listener (different tenant/business/generation)
   returns `stale` BEFORE any marker consumption, clearing, retirement, UI apply,
   or persistence mutation.
4. **Generation isolation.** Switch-away-and-back bumps the selection generation;
   an earlier-generation marker cannot match the new generation's listener, so it
   cannot suppress the new generation's first hydration.
5. **Scoped retirement.** Failed write → retire only its own marker; invalidate →
   retire markers not belonging to the now-current destination/generation;
   consumed own echo → remove the matched marker; bounded-16 backstop retained.
   Cleanup never deletes a marker owned by the active destination.
6. **Preserved own-echo suppression.** Same tenant/business/generation
   local-before-ack echo is still `ignored_own_echo`.
7. **No R6 regression.** Single-destination lifecycle, captured-tenant
   persistence, listener invalidation, write ordering, stale rejection,
   failed-write visibility, supplier ordering, two-edit races, VAT and forecast
   behavior are all preserved (focused 65/0, full 406/0, VAT 5/0, forecast pass).
