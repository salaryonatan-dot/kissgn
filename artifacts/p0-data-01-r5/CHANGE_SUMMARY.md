# P0-DATA-01 R5 — Change Summary

**Branch:** `claude/p0-data-01-r5-final-lifecycle-convergence`
**Base (R4):** `6c4d9eb1c7faf31d75fcea1649f92aaa130ea506` (`fix: harden production entry lifecycle`)
**Commit subject:** `fix: converge production entry lifecycle`
**Changed files:** `index.html`, `test/dashboard/entries-lifecycle.test.mjs`, and `artifacts/p0-data-01-r5/` (11). Package/lockfiles byte-identical to R4.

## What Codex invalidated in R4 (and R5 fixes)

R4's supplier coordinator sequence-gated **React state** but not **terminal persistence**. Codex's VM probes (real R4 coordinator + real R4 `createPersistence`, only the storage transport stubbed) proved three failures, plus three PARTIAL/PROXY test gaps and one OPEN artifact-overstatement:

- **R3-007 (persisted ordering):** overlapping edits dispatched competing terminal writes; an older storage write could commit last → final persisted `100` while UI showed `200`.
- **R3-007 (listener echo):** a delayed older echo could apply once `pending` reached 0.
- **R3-007 (invalidation counter):** `invalidate()` reset a **shared** `pending`; an old promise's `finally { pending-- }` corrupted the new generation and let a stale echo apply.
- **R3-006 (PARTIAL):** the production supplier caller discarded `persist_failed` — no visible error.
- **R3-003 / R3-005 (PARTIAL):** stale insight setters and save in-flight state proven only through helper/proxy, not the production wrappers.
- **R3-008 (OPEN):** R4 artifacts marked scenarios 6,7,14,17,18,21,25,26,31,40 closed that were proxy/source-only/failing.

## Implementation (index.html only)

**A. Single-flight terminal write coordinator (`createEntriesWriteCoordinator`, rewritten).**
A GLOBAL in-flight flag (`writing`) serializes terminal writes to the destination across generations: at most one write is in flight; later edits update optimistic desired rows but do NOT dispatch a competing write; when the active write settles the pump persists the LATEST desired revision. Terminal storage therefore commits in dispatch order and ends at the newest payload. An older in-flight write (e.g. after switch-away-and-back to the same business) always settles before the new lane's write is dispatched, so it can never beat newer data. Each edit returns a settled result `{status, rev, latest}`.

**B. Generation-safe invalidation.** Accounting lives in a per-generation **lane** object (`desiredRev/committedRev/attemptedRev/expectedEchoes/waiters`). `invalidate()` installs a fresh lane; an old completion finalizes only its retired lane and can never drive the new lane's counters negative or clear its state. `pending = desiredRev − committedRev` is non-negative by construction.

**C. Listener/self-heal arbitration.** The production listener delegates to `coordinator.onListenerEcho(val, ctxAtSetup)` with its captured selection context: a stale ctx is rejected; echoes are ignored while a write is queued/in-flight; our own committed writes' echoes are **drained** (consumed, not applied) via `expectedEchoes` so a delayed older echo cannot regress; once no own-echoes are outstanding an external payload applies (convergence preserved). Duplicate self-heal is routed through the SAME single-flight pump using captured-tenant persistence (`persistEntries → storage.setFor`), never the mutable-tenant global write, so it cannot race a supplier write.

**D. Supplier failure visibility.** `setSupPayDate` inspects the settled result and delegates to the production `applySupplierWriteResult(res, ports)` helper: only the **latest** op touches a new visible `supplierWriteError` state (rendered as an alert banner in the supplier grid) — a latest failure sets it, a latest owned success clears it, an older result leaves it untouched. Selection invalidation clears the selection-scoped error.

**E. Production-used test seams (extracted, delegated to by the real UI).** `createSaveUiRunner` (ownership + observable in-flight setter — saveEntry delegates), `createInsightUiLoader` (dashboard insight setter orchestration — loadDashboardInsights delegates), `createExceptionOwnership` (selection-bound op-ID + effective-state store — replaces the two exception refs; invalidateSelection resets it), and `applySupplierWriteResult`. All are on the frozen `window.MarjinSaveLifecycle` and executed directly by tests.

## Preserved (unchanged)

R4's mandatory-context domain-specific persistence, explicit-tenant `storage.setFor`, exception preflight, insight-readback candidate loop; R2 date-identity/replay/canonicalization; VAT/revenue/forecast/food-cost/labor/fixed/profit formulas; RTDB schema/paths/Rules; structured-exception API contract. Incident canonical **₪580,483** reproduced from the R5 helper.
