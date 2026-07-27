# P0-DATA-01 R5 — Codex R4 Remediation Closure

Implementation evidence (production code in `index.html`) is stated separately from
test evidence (executable tests in `test/dashboard/entries-lifecycle.test.mjs`).
Source guards are supplementary wiring checks and are **never** counted as closure of a
race scenario. `[prod-helper]` tests run the real seam factories with deferred transports
that COMMIT to a simulated store; race tests assert both terminal-persisted state and
non-invocation of prohibited paths.

---

## R3-007 — supplier ordering / listener echo / invalidation counter  (was OPEN)

**Implementation.** `createEntriesWriteCoordinator` rewritten to a GLOBAL single-flight
pump: `let writing=false` serializes terminal writes across generations; the pump persists
the latest desired revision when the active write settles; per-generation lanes isolate
accounting; own-echoes are drained via `expectedEchoes`; `invalidate()` installs a fresh lane.

**Test evidence (all execute real coordinator + real `createPersistence` + committing store):**
- Persisted ordering — `PROBE A / S25+S33`: only ONE terminal write dispatched while the first is in flight; after it settles the second dispatches; **final persisted storage = 200** (not 100).
- Complete listener race — `PROBE B / S26`: `100→200→echo200→delayed-echo100`; both own-echoes drained; final UI and persisted = 200.
- Invalidation accounting — `PROBE C`: old completion finalizes retired lane only; `pending ≥ 0`; stale echo not applied while the new write is pending; final = NEW.
- Switch-away-and-back: new write is NOT dispatched while the old is in flight; old settles first, new commits last; persisted = NEW.
- `S27` echo-before-completion cannot regress; `S28` post-quiescence external payload converges; `S29` distinct suppliers both preserved (state + persisted); `S30` older failure cannot roll back newer success; `S31` latest failure flagged `latest:true`; `S32` duplicate rows collapse.

**Verdict: CLOSED** (persisted-ordering, listener-echo, and invalidation probes now pass with real terminal persistence).

## R3-006 — supplier failure visibility  (was PARTIAL)

**Implementation.** `setSupPayDate` inspects the settled result and calls the production
`applySupplierWriteResult(res, {setError, clearError})`; a new `supplierWriteError` state is
rendered as an alert banner; only the latest op mutates it; invalidation clears it.

**Test evidence.** `applySupplierWriteResult` executed directly: latest failure → `setError`; older
failure → no-op; older success → no-op; latest success → `clearError` (sequence asserted `["set","clear"]`).
`S31` proves the coordinator returns `{persist_failed, latest:true}` for a latest failure. Source guard
confirms the caller delegates and the state is rendered.

**Verdict: CLOSED** (production caller now surfaces latest failure through a visible state).

## R3-003 — stale insight UI setters  (was PARTIAL)

**Implementation.** Insight setter orchestration extracted to `createInsightUiLoader`;
`loadDashboardInsights` delegates to it. Cancellation (explicit OR bumped selection) is checked
before the first setter and after the readback → zero setter mutation on a stale entry.

**Test evidence.** `S14` (two cases): invalidate BEFORE first request → zero loading/data/date/error/warning
setter calls and zero requests; cancel DURING iteration → no post-readback setter mutation, no second request,
data setter only ever the live-entry clear (never stale insight data). `S11-S13` cover readback identity/cancellation.

**Verdict: CLOSED** (production wrapper setters proven).

## R3-005 — save UI ownership  (was PARTIAL)

**Implementation.** Ownership + observable in-flight orchestration extracted to `createSaveUiRunner`;
`saveEntry` delegates. The finally clears the in-flight flag only if the token still owns.

**Test evidence.** `S19-S22`: old save pending; invalidate; new save starts and owns the flag; old finally
emits no `setInFlight(false)` and cannot clear the new flag; new save's own finally clears it. `S23` duplicate
same-selection submit blocked. `S24` tenant switch / logout / unmount each free ownership so the next selection
can save.

**Verdict: CLOSED** (production in-flight state transitions proven across all four transitions).

## R3-008 — test/artifact overstatement  (was OPEN)

**Implementation/tests.** 53 focused tests: 38 `[prod-helper]` (real seam factories, deferred transports),
9 `[prod-entries]` (real `MarjinEntries`), 6 `[source-guard]` (supplementary wiring only). Every mandatory race
scenario is `EXECUTABLE_PRODUCTION_PATH`; the 43-scenario matrix (`PRODUCTION_BOUNDARY_TEST_MATRIX.md`) marks no
race scenario as source-guard-only. Baselines corrected: R2 37/378 · R3 35/376 · R4 46/387 · R5 53/394.

**Verdict: CLOSED** (coverage is executable production-path; artifacts state evidence type honestly).

---

## Also verified still-closed from R4 (no regression)

- **R3-001 / R3-002** — domain-specific mandatory-context persistence; every entries/fixed writer captures ctx. Tests `S1-S9`, `S6/S7/S8`.
- **R3-004** — `loadExceptionsBound` preflight. Tests `S15/S16/S15b`.
- **Explicit-tenant storage (H)** — `window.storage.setFor` now executed directly (stubbed ref/set): path under captured tenant despite a mutated global, `{_v}` envelope, zero call on missing tenant.

**Summary: R3-003, R3-005, R3-006, R3-007, R3-008 all CLOSED in production wiring with deterministic executable coverage; R3-001/002/004 remain closed.**
