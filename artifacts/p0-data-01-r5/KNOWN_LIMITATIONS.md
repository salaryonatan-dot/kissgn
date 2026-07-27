# P0-DATA-01 R5 — Known Limitations

All items are non-blocking and documented; none reintroduces a Codex finding or silently loses
persisted data.

1. **No DOM/React render harness.** Tests execute the exact production helpers the React wrappers
   delegate to (`window.MarjinSaveLifecycle.*` factories, `window.storage.setFor`), wired to deferred
   committing transports — not a mounted component tree. The delegation is asserted by `[source-guard]`
   tests; all lifecycle logic that could misroute or misorder a write lives in the vm-extractable seam.

2. **Global single-flight is per-coordinator-instance (one destination).** The coordinator serializes
   writes to the current business's entries key. It is created per component instance; switching
   business installs a fresh lane but the same coordinator serializes across the switch, which is why
   switch-away-and-back is safe. Concurrent writes to two *different* businesses are not serialized
   against each other (they are different destinations and cannot conflict).

3. **Failed supplier write shows the optimistic value until reconciliation.** On a genuine latest-write
   failure the coordinator keeps the optimistic value AND surfaces a visible error (`supplierWriteError`
   banner). It never regresses to an older value and never reports a partial multi-domain success. A
   later successful write or an external listener echo (once quiescent) reconciles to server truth.

4. **Listener echo arbitration assumes the single-user-per-business model.** Own committed writes' echoes
   are drained via `expectedEchoes`; once none are outstanding an external payload applies (convergence).
   A genuine concurrent remote change arriving *between* our own write and its echo would be consumed as
   an own-echo and reconciled by the next external echo. True multi-writer conflict resolution is out of
   P0 scope. Normal post-write convergence is preserved and tested (`S28`).

5. **Main daily save uses the ownership token, not the supplier coordinator.** `executeEntrySave` is a
   single deliberate ownership-gated write; it is not routed through the supplier single-flight pump.
   The two are different user flows; a save's listener echo is handled by the coordinator's arbitration.

6. **Insight dashboard-VIEW path binds to the current live selection** (`captureSelectionCtx()`), which is
   correct for a view load (no originating save) and still fully cancellation-gated.

7. **TypeScript `TS2742` (22, `src/firebase/refs.ts`).** Pre-existing symlink-portability diagnostics from
   the shared `node_modules` symlink; `--preserveSymlinks` is clean. Unchanged by R5.
