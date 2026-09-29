# 02 — Canonical server API (as implemented)

## Layers
```
src/finance ← src/metrics ← src/policy/productFinance.ts (pure; also in fincore/v1 as MarjinFinance.product)
                                   ↑ (+ one edge → src/forecast/revenueForecast.ts, AMEND-04)
src/finance-server/canonicalInputs.ts   — the only server I/O + clock (MARJIN_FIN_SERVER/1)
src/finance-server/canonicalMetrics.ts  — pure wrappers, doc encoding, provenance
      ↑ dailyMetricsRepo · laborRepo · purchasesRepo · dailyBuilder · analyticsService (error routing)
```

## `src/policy/productFinance.ts` (MARJIN_PRODUCT/1)
| Export | Contract |
|---|---|
| `decodeEnvelope(raw, "object"\|"array")` | null/undefined or `{}`/`{_v:null}` ⇒ `absent`; `{_v:"<JSON of the kind>"}` ⇒ `present` (`[]` is present); bad JSON ⇒ `unreadable/envelope_json`; any other shape (plain object, extra key, non-string `_v`, wrong kind, scalar/array node) ⇒ `unreadable/envelope_shape`. Never throws; never defaults to `{}`/`[]` |
| `ProductInputs` | `{rows, config, fixed, asOfBusinessDate, exceptionsByDate?}`; reserved (comment only): `costVersions` (F1), `purchaseContributions` / `supplierCredits` (P1) |
| `productTimeline` | `costTimelineFromCurrentConfig(config.present?, fixed.present?)`; AMEND-03: `fixed.unreadable` ⇒ flag `{invalid_fixed_amount, key:"__fixed_list_unreadable__", reason:"wrong_type"}` (existing core code path ⇒ `fixedAccrual` / profit `invalid_components`) |
| `productDays(inputs, range)` | `normalizeRows` → `groupByDate(from, min(to, asOf−1))`; window `{requested, effective\|null, asOfBusinessDate, completedThrough}`; quarantine counts; dataset flags |
| `productDailyMetrics` | one DailyMetric-shaped record per PRESENT completed day: `toDailyMetric(day, resolvePurchaseBasis(..., productPurchaseBasis()), productLaborSource(), timeline, {asOf, NO_DECLARED_CLOSURES})` + `partial{revenue,purchases,hourlyLabor}` |
| `productDayRecord(inputs, date)` | `> asOf` ⇒ `{inActual:false, reason:"future_date", presenceDay:"not_examined"}`; `= asOf` ⇒ `current_day` + presence; else Actual `{day, metric}` |
| `productMonthReport(inputs, {kind, month})` | the ONLY `computePeriodReport(` call in the codebase (G-S4 / GUARD-03), basis/source/calendar bound; DD-16 month-scoped `row_without_id` |
| `productMonthProjection(inputs, report, {nowMs})` | `nowMs` REQUIRED (`now_required`); history = completed days → `toForecastDay` → `computeRevenueForecast` → `applyProjection`; no forecast ⇒ `projection:null` + `insufficient_history` |

Purity: no clock, no `Number(`/`Math.`, no I/O, `JSON.parse` only in `decodeEnvelope` (PFN-04, G-S1).

## `src/finance-server/canonicalInputs.ts`
`loadCanonicalInputs(db, t, b, {site, nowMs?, need:{config, fixed}})` → `ServerInputs = ProductInputs + {tenantId, bizId, storageMode, configState, fixedState, inputIssues}`.
- Entries read once through the shared dual-mode reader (`requireEntriesRows`; typed `EntriesStorageError` propagates). Config / fixed read only when asked (`not_loaded` otherwise). A rejected RTDB read propagates (never "absent").
- Exactly one `Date.now()` when `nowMs` is omitted; `asOfBusinessDate = israelBusinessDate(nowMs)`. No write.
- DD-18 `mapFieldReadback`: RTDB numeric-key readback for `supplier_payments` / `hourly_payroll` only (client contract R2-B3). DD-17: no `need.exceptions`.

## `src/finance-server/canonicalMetrics.ts`
| Function | Output |
|---|---|
| `provenanceOf` / `ServerProvenance` | api, product, fin, norm, dec, labor, pb, pbPolicy, laborSource, windowRule, asOf, timelineSource, configurationBasis, configState, fixedState, operatingCalendar — all constants imported from the core (GUARD-06) |
| `canonicalDailySeries(inputs, range)` | `{provenance, window, days: CanonicalDailyMetric[], missingDates, quarantine, flagCodes, inputIssues}` |
| `canonicalLatestCompletedPresentDate` | latest present day ≤ asOf − 1 (explicit zeros count) |
| `canonicalLaborRecords` | per present completed day: `totalCost` = canonical daily labor (payroll + global calendar-day allocation), `totalCostComplete`, `hourlyEmployerCost` (null unless present), `globalEmployerCost`, `laborPctOfRevenue`; hours / head count / cost per hour `null` |
| `canonicalPurchaseRecords(inputs, range, names)` | one record per (present completed date, source) aggregate of ALL contributions; `source` supplier / legacy_food_cost; `dayPurchases` present / partial_invalid (DD-15) |
| `canonicalDayRecord` / `toAnalyticsFinancials` | persisted-doc encoding (below) |
| `canonicalMonthReport` / `canonicalMonthProjection` | B2's future entry points (no B1 runtime caller) |
| `isCanonicalFinanceError` | `name === "FinanceContractError"` |

## Persisted `biz:{b}:analytics:daily:{date}` encoding
- `revenue.{sales,deliveries,other_income,total,food_cost,payroll}`: written ONLY when the canonical fact is complete; otherwise the key is omitted. `payroll` = canonical daily labor, written only when `laborCostComplete` and hourly labor is not partial.
- `had_entry` = presence of the business date (explicit zero is entered); `has_sales` = complete revenue that is > 0.
- `fin` (additive): versions header, `inActual`, `outsideActualReason?`, presence, rowCount, exact revenue / purchases (+ `bySource` array) / hourly strings, derived numbers (`laborCostComplete`, `laborCost?`, `globalLaborCost?`, `laborPct?`, `foodCostPct?`, conversion id), `legacyHourlyPayroll{counted:false, recorded}`, timelineSource, configurationBasis?, configState, flagCodes?, inputIssues?. No row id, note, supplier name or free text (DB-09). No `undefined` / `null` / NaN / empty array (DD-19).
- Current day / future date ⇒ `fin.inActual:false`, no financial legacy field, the insights doc takes the empty path (the API wrapper's readback contract holds, COMPAT-08).

## Error model
| Error | Source | Behaviour |
|---|---|---|
| `EntriesStorageError` | loader | rethrown by `analyticsService` (unchanged); builder loop records the business failure |
| `FinanceContractError(duplicate_row_id)` | core | rethrown by `analyticsService` (NEW, DD-09); builder loop records the failure; nothing derived persisted (DB-12) |
| `FinanceContractError(invalid_date)` | range | rethrown (API-28) |
| unreadable config / fixed | never thrown | `configState/fixedState:"unreadable"` + `inputIssues`; the core's typed unavailable states |
