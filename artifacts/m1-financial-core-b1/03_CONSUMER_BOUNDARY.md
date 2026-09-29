# 03 — Consumer boundary

## AMEND-02 allowlist (`test/finance/core-consumers/b1.json`)
```json
{"slice":"B1",
 "consumers":["src/finance-server/canonicalInputs.ts","src/finance-server/canonicalMetrics.ts"],
 "serverApiConsumers":["src/repositories/analytics/dailyMetricsRepo.ts","src/repositories/analytics/laborRepo.ts","src/repositories/analytics/purchasesRepo.ts","src/analytics/dailyBuilder.ts","src/services/analyticsService.ts"]}
```
- `fincore-guards` G-B2 reads the UNION of `test/finance/core-consumers/*.json` through `test/support/core-consumer-allowlist.mjs` (pure validator + importer verdict). Later slices add `b2.json` / `c1.json` / `f1.json`; the guard is never edited again.
- Validation: file name = `<slice>.json`, slice ∈ {B1, B2, C1, C2, F1, F2, D, E, P1, P2}; exact existing file paths (no glob, no directory, no `..`, no `./`); no duplicates within or across files; no unknown key; `index.html` only for a slice ≥ C1. Importer detection covers static, re-export, side-effect and dynamic imports plus `fincore` / `MarjinFinance` references.
- Mutation proofs G2-01…06 (`b1-guards`). GUARD-02 asserts the exact importer sets equal `b1.json`.

## Who calls what
| Consumer | Calls | Needs |
|---|---|---|
| `getDailyMetrics` | `loadCanonicalInputs(need config)` → `canonicalDailySeries().days` | config (global labor) |
| `getLatestDailyDate` | `loadCanonicalInputs(no config)` → `canonicalLatestCompletedPresentDate` | entries only |
| `getLaborMetrics` | `canonicalLaborRecords` | config |
| `getPurchaseMetrics` | suppliers list (names only, `parseLegacyListEnvelope` retained) + `canonicalPurchaseRecords` | entries only |
| `buildAnalyticsForBiz(t, b, date, {nowMs?})` | `loadCanonicalInputs(need config)` + business list + single-date structured exception → `canonicalDayRecord` → `toAnalyticsFinancials` | config (labor + location) |
| `buildAndSaveInsights` | non-Actual doc ⇒ empty path; else unchanged | — |
| `fetchPlannedData` (4 catches) | rethrow `isEntriesReadError || isCanonicalFinanceError` | — |
| insights (`baselines.trailingRatioAvg`, `rules.ruleLaborRisk`, `types`) | skip non-finite / absent numerators | — |

No other runtime file imports the core or the server API (GUARD-02). `computePeriodReport(` / `toDailyMetric(` are called only in `src/policy/productFinance.ts` (GUARD-03, G-S4).

## `consumer-manifest.json` edits
- S01, S02, S03, S04, S06 → `MIGRATED (B1)` + `servedBy: src/finance-server/canonicalMetrics.ts`.
- NEW SV1 `src/finance-server/canonicalInputs.ts`, SV2 `src/finance-server/canonicalMetrics.ts` (G-M1 coverage).
- S44a (`src/agent/types/analytics.ts`) → slice D (B1 returns a superset type; D owns the file). The packet's "S34" does not exist in the manifest — nothing to move.
- `b1Note` on S07b/S07c/S07d (insights compatibility guard only) and S14 (`analyticsService` typed-error routing only).
- `laborContractMigration` H5, H6, H7 → `migrated_in: "B1"` (H1–H4 are `index.html`, C1).

## Downstream (unchanged by B1, ready)
| Slice | Uses | Edits B1 files? |
|---|---|---|
| B2 | `canonicalMonthReport`, `canonicalMonthProjection`, `loadCanonicalInputs(need.fixed)` | no; adds `b2.json`, edits `src/snapshot/*` (re-pins its own blob) |
| C1 | `MarjinFinance.product.*` from `fincore/v1`, `decodeEnvelope`; **must mirror DD-18 (map-field array readback) in its browser loader** | no core edit; adds `c1.json` |
| F1 | extends `ProductInputs.costVersions` / `productTimeline`, adds one loader read | yes, by design (serial after B1) |
| P1/P2 | `ProductInputs.purchaseContributions` / `supplierCredits` | P1 modifies `productFinance.ts` |
| D | `CanonicalDailyMetric` (superset of `DailyMetric`; `laborPct`/`foodCostPct` may be `null`; `partial` flags) | owns `src/agent/types/analytics.ts` |
