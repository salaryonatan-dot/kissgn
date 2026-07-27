# P0-DATA-01 R4 — Known Limitations

All items below are **non-blocking** and documented deliberately. None reintroduces a
Codex R3 finding, and none silently loses persisted data.

1. **No DOM/React render harness.** Tests execute the exact production helpers the wrapper
   delegates to (`window.MarjinSaveLifecycle.*` factories, `window.MarjinEntries`), wired to
   deferred transports — not a mounted component tree. The delegation itself is asserted by
   `[source-guard]` tests. Mounting React/Babel JSX is out of scope for a Node `--test` suite;
   the lifecycle logic that could misroute a write now lives entirely in the vm-extractable
   seam, so the runtime tests do cover the real decision logic. (Closes R3-008's intent.)

2. **Failed supplier/entries write shows the optimistic value until reconciliation.** When the
   *latest* entries write genuinely fails (network/permission), the coordinator keeps the
   optimistic (newest) value in state and reports `persist_failed` rather than reverting to an
   older value. This is intentional: R3-006 was caused by reverting a value that *had* been
   persisted. R4 never regresses to an older value; a subsequent successful write or a listener
   echo (once quiescent) reconciles state to server truth. Trade-off: a transient failure can
   briefly show an unpersisted value. The supplier grid has no dedicated error toast; the
   failure is returned by the coordinator and logged, not surfaced visually. A future slice
   could add a supplier-write error indicator (UI-only, no lifecycle change).

3. **Earliest-value-wins for hydrated duplicate scalars/maps** (preserved from R2/R3). When two
   duplicate rows for the same date are hydrated, the earliest non-zero scalar and the earliest
   value per nested-map key win; values are never summed. This is the accepted replay-safety
   policy (prevents duplicate-delivery inflation), not a "latest wins" merge. Explicit user
   saves still win wholesale over hydrated duplicates.

4. **Listener-echo suppression is coarse-grained.** While *any* local supplier write is pending,
   the entries listener ignores echoes wholesale (they can only carry an equal-or-older value in
   the single-user editing model). A concurrent legitimate change from another device during that
   window would be deferred until the local writes settle, then reconciled by the next echo. For
   the reviewed single-user-per-business scope this is safe; true multi-writer conflict resolution
   is a larger design (out of P0 scope).

5. **`apiGetDailyRange` view path still allows a global-tenant fallback.** The 5th `tenantId`
   parameter is honored when supplied (the selection-bound insight readback always supplies it);
   when omitted it falls back to `window._currentTenantId` for the unrelated analytics-range
   **view** consumer (`buildDaySnapshot`/history). That view is bound to the current live
   selection and is not a save continuation, so the fallback cannot misroute a stale save.

6. **Save readback identity for the dashboard-VIEW path** uses `captureSelectionCtx()` (the
   current live selection) rather than a save ctx, because the view load has no originating save.
   This is correct for the view and still fully ctx-gated (cancellation on selection change).

7. **TypeScript `TS2742` (22, `src/firebase/refs.ts`).** Pre-existing symlink-portability
   diagnostics from the shared `node_modules` symlink; `--preserveSymlinks` is clean. Unchanged
   by R4 and unrelated to this slice.
