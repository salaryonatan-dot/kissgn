# P0-DATA-01 R4 — Codex Findings Closure

Each of the eight blocking R3 findings, mapped to its exact remediation, production code location (`index.html`), the executable regression tests that cover it, the result, any remaining limitation, and a closure verdict. All tests are in `test/dashboard/entries-lifecycle.test.mjs` unless noted; `[prod-helper]` = runs the real production seam factory with deferred transports.

---

## P0-DATA-01-R3-001 — central persist can issue a second fixed write after context stales
- **Remediation:** removed `persist(e,f,ctx)`; added single-domain `createPersistence.persistEntries(rows, ctx)` / `persistFixed(fixed, ctx)` — tenant+key from captured `ctx`, liveness re-checked immediately before dispatch, exactly one domain written.
- **Location:** seam `createPersistence` (`index.html` ~1225–1257); component delegators (~3150–3157); removal site (~3599).
- **Tests:** `S1+S5 … issues NO later write`, `S2 same biz id under new tenant`, `S6/S7 persistEntries writes ONLY entries`, `S8 persistFixed writes ONLY fixed`.
- **Result:** pass. No code path performs an entries→fixed multi-write; a stale context issues zero writes.
- **Remaining limitation:** none.
- **Verdict:** **CLOSED.**

## P0-DATA-01-R3-002 — no-ctx fixed/employee callers bypass the contract
- **Remediation:** every full-blob writer captures ctx at the event boundary; fixed-expense → `persistFixed(u, captureSelectionCtx())`; employee labor → `persistEntries(newEntries, captureCtx())` (fixedList dropped); clear-all → `persistEntries(u, captureSelectionCtx())`. A missing context is rejected before any request.
- **Location:** fixed-expense callers (~4471–4500, ~5927–5956); clear-all (~5438); `EmployeesScreen.setDailyLabor` (~6138–6146); prop wiring (~5877, ~6116).
- **Tests:** `S3 missing context rejected before any storage request`, `S9 clear-all with mandatory context`, `S7`/`S8` domain separation, source-guards (multi-write removed; fixed callers use persistFixed; employee labor uses persistEntries).
- **Result:** pass.
- **Remaining limitation:** none.
- **Verdict:** **CLOSED.**

## P0-DATA-01-R3-003 — insight readback issues another candidate after cancellation using a new tenant global
- **Remediation:** `createInsightReadback.loadRange(ctx,…)` derives each request's tenant+biz from ctx and checks cancellation (explicit OR bumped selection) before and after every candidate await; `apiGetDailyRange` takes an explicit tenant; the save seam threads ctx into `loadInsights`.
- **Location:** seam `createInsightReadback` (~1290–1318); `loadDashboardInsights` (~3508–3555); `apiGetDailyRange` (~7433); seam `loadInsights(...,ctx)` call (~1324); adapter (~3975).
- **Tests:** `S11+S14 no second request, no cancelled-path mutation`, `S12 logout/login same biz id`, `S13 every request uses captured tenant/business`, missing-context test.
- **Result:** pass. After cancellation the second candidate request is never issued; no request combines a new global tenant with an old business.
- **Remaining limitation:** the dashboard-**view** load path (not a save) binds to the current live selection via `captureSelectionCtx()`; this is correct for the view and still ctx-gated.
- **Verdict:** **CLOSED.**

## P0-DATA-01-R3-004 — stale loadExceptionsBound still sends a request
- **Remediation:** preflight `io.selection.isLive(ctx)` gate before URL construction and `apiFetch`.
- **Location:** `loadExceptionsBound` (~1178–1186).
- **Tests:** `S15 already-stale context sends ZERO requests`, `S16 stale during fetch applies nothing`, `S15b live context issues exactly one request and applies`.
- **Result:** pass.
- **Remaining limitation:** none.
- **Verdict:** **CLOSED.**

## P0-DATA-01-R3-005 — saveEntry in-flight not selection-bound; stale finally mutates new selection
- **Remediation:** `createSaveOwnership` token; `saveEntry` acquires via `begin`, `finally` clears in-flight only if `owns(token)`; `invalidateSelection` frees ownership synchronously; unmount/logout/business-switch invalidate.
- **Location:** seam `createSaveOwnership` (~1272–1288); `saveEntry` (~3935–3990); `invalidateSelection` (~3175–3178); `setCurrentBizId` (~3162).
- **Tests:** `S19–S22 old pending / invalidate / new saves / old finally is no-op`, `S23 same-selection duplicate blocked`, `S24 logout/unmount frees ownership`.
- **Result:** pass.
- **Remaining limitation:** none.
- **Verdict:** **CLOSED.**

## P0-DATA-01-R3-006 — supplier fixed-failure leaves persisted entries and state inconsistent
- **Remediation:** supplier writes are entries-only via the coordinator (no `fixedList`); failure of the latest op keeps the optimistic value and reports the failure — never reverts to an older value; no multi-domain success is reported.
- **Location:** seam `createEntriesWriteCoordinator` (~1259–1288 region); `setSupPayDate` (~4951–4957).
- **Tests:** `S6 entries-only`, `S31 newer failure surfaced without older completion winning`, `S33 canonical payload equals applied array`, `S16(supplier-variant) stale completion applies nothing`.
- **Result:** pass. There is no fixed write on a supplier edit, so entries-success/fixed-failure is impossible.
- **Remaining limitation:** a genuinely failed entries write leaves the optimistic (unpersisted) value visible until the next successful write or a listener echo reconciles it — see `KNOWN_LIMITATIONS.md`. It never silently loses a **persisted** value (the actual R3 bug).
- **Verdict:** **CLOSED.**

## P0-DATA-01-R3-007 — overlapping supplier writes let an older completion overwrite a newer value
- **Remediation:** monotonic operation sequence in the coordinator; `mySeq === seq` gates every state apply; each edit builds on the latest desired state; listener echoes suppressed while a local write is pending.
- **Location:** seam `createEntriesWriteCoordinator`.
- **Tests:** `S25 out-of-order resolution → newer wins`, `S27 echo before completion can't regress`, `S26+S28 echo after completion converges`, `S29 different suppliers both preserved`, `S30 older failure can't roll back newer`, `S32 duplicate rows collapse`.
- **Result:** pass.
- **Remaining limitation:** none for the reviewed single-user supplier-grid scope.
- **Verdict:** **CLOSED.**

## P0-DATA-01-R3-008 — tests overstate production coverage; R2 baseline misstated
- **Remediation:** all executable tests now drive the real production factories with deferred **transports** only; source-string assertions are labeled `[source-guard]` and used only as supplementary wiring guards; baseline corrected.
- **Location:** `test/dashboard/entries-lifecycle.test.mjs` (46 tests: 30 `[prod-helper]`, 9 `[prod-entries]`, 7 `[source-guard]`).
- **Tests:** the whole suite; `R2_R3_R4_TEST_MAPPING.md` reconciles 37/378 (R2) and 35/376 (R3) → 46/387 (R4).
- **Result:** pass; independent R2/R3 counts reproduced.
- **Remaining limitation:** the React render tree itself is not mounted (no DOM harness); the extracted factories ARE the exact functions the wrapper delegates to, and source-guards assert the delegation. See `KNOWN_LIMITATIONS.md`.
- **Verdict:** **CLOSED.**

---

**Summary:** 8/8 findings CLOSED in production wiring with deterministic executable coverage. Remaining items are documented non-blocking limitations, not open findings.
