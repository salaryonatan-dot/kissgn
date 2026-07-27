# P0-DATA-01 R6 — Codex R5 Remediation Closure

Implementation evidence (production code in `index.html`) is stated separately from test
evidence (executable tests in `test/dashboard/entries-lifecycle.test.mjs`). Source guards are
supplementary and never close a race scenario.

---

## R3-007 — destination-wide ordering / queued invalidation / local-before-ack  (was OPEN)
**Implementation.** ONE destination lane (`createEntriesWriteCoordinator.submit`) that every
entries writer uses; global single-flight; explicit waiter settlement on invalidate; content-
fingerprint echo ownership registered at dispatch (removes scalar `expectedEchoes`).
**Tests.** `R6-1` supplier+main-save single-flight, final PERSISTED 999; `R6-2` all six intents
through the lane; `R6-3` transform preservation + wholesale replace; `R6-4(success/failure)`
queued rev2/rev3 settle `cancelled_selection_changed` exactly once; `R6-5` switch-away-and-back;
`R6-6/6b` local-before-ack own echoes + external payloads apply; `R6-7` complete listener race →
200; `R6-8/8b` convergence + deferred external; `S29/S30/S31/S32/S33` persisted checks.
**Verdict: CLOSED.**

## R3-006 — supplier error ownership  (was OPEN)
**Implementation.** `createSupplierResultOwnership` binds result→error to tenant+business+
generation+token+mount; `setSupPayDate` delegates through it.
**Tests.** `R6-9` latest-live sets / older superseded / owned success clears; `R6-9b` old-selection
result after invalidation cannot set/clear the new error; `R6-9c` unmount → no mutation.
**Verdict: CLOSED.**

## R3-003 — insight null-to-owner role lifecycle  (was OPEN)
**Implementation.** `insightRoleRef` updated every render; the once-created loader reads current
role at call time.
**Tests.** `R6-10` same loader created with null role issues the request after role→owner; `R6-10b`
owner loader, invalidate before/after readback → zero stale setter mutations. `S11-S13` readback.
**Verdict: CLOSED.**

## R3-005 — save UI across tenant/logout/unmount  (was PARTIAL)
**Implementation.** `createSaveUiRunner` gains mount + `clearInFlight()` + `unmount()`;
`invalidateSelection` clears `entrySaveInFlight` for the still-mounted UI on business/tenant/logout;
the unmount effect marks the port dead first.
**Tests.** `R6-11(business/tenant/logout)` clears the observable flag, new save starts, old finally
cannot clear it; `R6-11(unmount)` no post-unmount `setInFlight`, double-submit still blocked; `S23`.
**Verdict: CLOSED.**

## R3-008 — test/artifact overstatement  (was OPEN)
**Implementation/tests.** 55 focused tests (≈44 `[prod-helper]`, 8 `[prod-entries]`, 3
`[source-guard]`). Every mandatory race scenario is `EXECUTABLE_PRODUCTION_PATH`; the 43-scenario
matrix marks no race scenario source-guard-only. Baselines corrected R2 37/378 · R3 35/376 ·
R4 46/387 · R5 53/394 · R6 55/396.
**Verdict: CLOSED.**

---

## Still closed from R5 (no regression)
- **R3-001 / R3-002** — mandatory-context domain-specific persistence (now the lane's private
  transport); tests `S1-S8`, `S6/S7`. **R3-004** — `loadExceptionsBound` preflight; `S15/S16/S15b`.
- **Explicit-tenant storage** — `storage.setFor` executed directly (`R6-13`).

**Summary: R3-003, R3-005, R3-006, R3-007, R3-008 all CLOSED in production wiring with deterministic
executable coverage; R3-001/002/004 remain closed.**
