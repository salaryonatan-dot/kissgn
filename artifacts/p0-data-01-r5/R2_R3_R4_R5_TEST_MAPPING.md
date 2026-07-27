# P0-DATA-01 — R2 → R3 → R4 → R5 Test Mapping & Count Reconciliation

## Count reconciliation (independently reproduced; matches Codex)

| Suite | R2 | R3 | R4 | R5 |
|---|---|---|---|---|
| Focused `test/dashboard/entries-lifecycle.test.mjs` | 37 | 35 | 46 | **53** |
| Full `test/**/*.test.mjs docs/production-readiness/test/*.test.mjs` | 378 | 376 | 387 | **394** |

- R5 focused **53** = 38 `[prod-helper]` + 9 `[prod-entries]` + 6 `[source-guard]`.
- R5 full **394** = R4 full 387 − 46 + 53 (net +7 focused; no other suite changed).
- The R3 artifact's "357" R2 baseline was wrong; the true R2 full is 378 (Codex-verified, reproduced).

## R4 → R5 focused delta (46 → 53, no reduction)

R5 did NOT reduce the 46. It re-pointed and strengthened the supplier/wrapper coverage and added
the missing production-path scenarios:

- **Rewrote** the supplier tests to compose the REAL coordinator with the REAL `createPersistence` and a **committing** deferred store, asserting terminal persisted storage (PROBE A/B/C, switch-back, S27-S33). R4's S25/S26 asserted React state only and used stubbed persistence.
- **Added** `createSaveUiRunner` tests (S19-S24) — observable in-flight setter across business/tenant/logout/unmount; R4 used a simulated boolean.
- **Added** `createInsightUiLoader` tests (S14 ×2) — production setter ports; R4 tested only the readback helper.
- **Added** `createExceptionOwnership` tests (S17, S18, S18b) — op-ID/state isolation; R4 had none.
- **Added** `applySupplierWriteResult` test — production failure-surface arbitration; R4 discarded the result.
- **Added** `storage.setFor` direct-execution test (H); R4 asserted only its presence.

## Every R2 assertion preserved at ≥ strength

The R2 date-identity / canonicalization / replay assertions are covered by the `[prod-entries]`
tests `S34, S34b, S35, S36, S37+S38, S39, S40, S43` and the incident fixture — identical helpers,
identical expectations. The R2 lifecycle/wiring assertions (persist canonicalization, selection
binding, listener hydration, delete-by-date, clear-all) are covered at **greater** strength by the
R5 `[prod-helper]` runtime tests (real persistence boundary, real coordinator, real wrappers) plus
source guards. No R2 assertion was dropped or weakened; see `R2_R3_R4_TEST_MAPPING.md` in the R4
artifacts for the case-by-case R2 table (unchanged and still valid for the entries helpers).

## Source-guard discipline

The 6 `[source-guard]` tests assert static wiring only (legacy multi-write removed; caller
delegation; single-flight lane structure present; explicit-tenant transport present). They are
supplementary. **No mandatory race scenario is closed by a source guard** — each race scenario in
`PRODUCTION_BOUNDARY_TEST_MATRIX.md` is backed by a `[prod-helper]` runtime test with committing
terminal transport.
