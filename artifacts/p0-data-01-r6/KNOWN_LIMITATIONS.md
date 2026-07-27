# P0-DATA-01 R6 — Known Limitations

All items are non-blocking and documented; none reintroduces a Codex finding or silently loses
persisted data.

1. **No DOM/React render harness.** Tests execute the exact production helpers the wrappers delegate
   to (the destination lane, `createSupplierResultOwnership`, `createSaveUiRunner`,
   `createInsightUiLoader`, `createExceptionOwnership`, `window.storage.setFor`) with deferred
   committing transports — not a mounted component tree. Delegation is asserted by `[source-guard]`
   tests; all order-deciding logic lives in the vm-extractable seam.

2. **One lane per component instance / destination.** The lane serializes writes to the current
   business's entries key. Two DIFFERENT businesses are different destinations and cannot conflict;
   switch-away-and-back to the SAME business is safe because the same coordinator (global `writing`
   flag) serializes across the generation change.

3. **Deferred-external policy.** A non-matching external payload arriving while a local op is pending
   is `deferred_pending_local` (not applied, not mis-owned) and reconciled by the next quiescent echo.
   This is the deterministic policy for the single-user-per-business model; true multi-writer conflict
   resolution is out of P0 scope. Normal post-write convergence is preserved and tested (`R6-8`).

4. **Fingerprint retention is bounded (16).** An own-write fingerprint is removed on first matching
   echo; the list is capped at 16 so an ancient un-echoed fingerprint retires (allowing an identical
   future remote payload to apply). In the rare case where an own echo never arrives AND an identical
   external payload arrives within the window, the external payload is treated as the own echo once
   (a single deferred convergence) — never a data loss, since desired already holds the value.

5. **Failed delete/labor/main-save keep the optimistic value + log.** On a genuine terminal failure
   the lane keeps the newest desired (never reverts to an older value) and the caller logs; state
   converges to server truth on the next listener echo. The supplier path additionally surfaces a
   visible error via ownership. A dedicated visible error surface for delete/labor is future work.

6. **Insight dashboard-VIEW path binds to the current live selection** (`captureSelectionCtx()`),
   correct for a view load and still cancellation-gated.

7. **TypeScript `TS2742` (22, `src/firebase/refs.ts`).** Pre-existing symlink-portability diagnostics;
   `--preserveSymlinks` is clean. Unchanged by R6.
