# D1 DOWNSTREAM FIX — Codex SR-F1

## Phase 1 — trace (evidence, not guesswork)

`entriesReader.requireEntriesRows` → `dailyMetricsRepo.getDailyMetrics` → `analyticsService.fetchPlannedData` (`metrics["daily"]`) → `runProactiveJob.runForBiz` → `validateData` → `selectBaseline` → five detectors incl. `detectDailyRevenueUnderperformance`; also `forecastService`, `analyzeDirectMetric/Trend/Anomaly/Forecast/Comparison`.

1. **What `dailyMetricsRepo` is contractually supposed to return.** `DailyMetric { date: "YYYY-MM-DD", revenue, laborCost, laborPct, foodCost, foodCostPct, transactionCount, avgTicket }` (`src/agent/types/analytics.ts`) — keyed by business date, carrying day-level ratios. Every consumer treats one element as one day: the detector takes `sorted[last]` as "yesterday", counts `consecutiveBelow` days, reports `dataPointCount` as days; `selectBaseline` needs "≥ 7 days"; `forecastService` uses `daily.length` as days and `avg(revenues)` as the daily average; `detectLaborInefficiency` needs "≥ 7 days with revenue and labor". `grep` shows `metrics["labor"]` / `metrics["purchases"]` have **no** analytical consumer (only carried in `FetchedData`), so `dailyMetricsRepo` is the sole per-day series.
2. **What it represented before R1.** Raw rows mapped 1:1 (`rows.map(toDaily)`): a duplicate business date produced two "days" with the same date. That was never a contract, it was the absence of one — legacy storage had no duplicates by construction until the concurrent-writer bug, and the Storage V2 sort `(date, id)` gave the second record a deterministic-but-meaningless position.
3. **Why the detector ended up with one same-date row.** `[...daily].sort(by date)` is stable, so ties keep input order; `revenues[revenues.length-1]` is whichever duplicate came last — legacy array position or the reader's UUID order. Codex: legacy `[1000, 1]`… → null vs V2 → −99.9% anomaly.
4. **Correct domain operation: A — aggregate.** Every field of `DailyMetric` is either additive over the rows of a day (revenue, laborCost, foodCost, transactionCount — all sums of per-row money) or a ratio of those sums (laborPct, foodCostPct; avgTicket is constant 0). No field is non-additive, so aggregation invents nothing; it is exactly what the other aggregators (snapshotBuilder's month totals, laborRepo, purchasesRepo) already do row-wise, and it keeps the daily series consistent with the monthly snapshot (the day's 600 is part of the month's total). This matches CTO D1: "aggregating consumers count every row". Option B (refuse) was not needed and would have made the whole agent, forecast and five detectors fail for a business on any duplicate day.

## Fix (narrowest contract boundary — repository only)

`getDailyMetrics` groups filtered rows by `date`, sums the per-row components (formulas unchanged in `rowComponents`), derives ratios from the sums and sorts by date. Order-independent by construction (addition commutes; output keyed and sorted by date). `getLatestDailyDate` was already order-free.

`src/agent/**` was **not** modified: with one record per date the detector has nothing to choose between, so repo-only remediation was sufficient — every downstream consumer is fixed at once, without touching agent code.

## Proof (final results, never just sorted-array equality)

| Test | Evidence |
|---|---|
| `entries-reader-d1-downstream` #1 | 5 representations × 2 UUID orders → identical `[{08-10: 600/80/100, ratios from totals}, {08-11: 700}]`; unique dates untouched; 3-row day interleaved with other dates in reversed V2 → identical |
| #2 | A=100, B=500 on today, 15-day 1000 history: **10 representations → one identical detector result**, `currentValue 600`, `periodEnd today` |
| #3 | Codex's 1 / 1000: 10 representations → one verdict (`null`, 1001 ≈ baseline) |
| #4 | **actual `runForBiz`** (fetch → validate → baseline → detectors → dedup/suppression → persisted insight + digest): 5 representations → identical persisted insight (`currentValue 600`) and digest (timestamps stripped) |
| #5 negative control | pre-fix `f00568d2` repository compiled from git: legacy `[A,B]` → null, legacy `[B,A]` → anomaly `currentValue 1`, V2 → null — the verdict flipped on order alone; the R1 repository on the same node → one record, one verdict |
| `entries-reader-repos` "date window…" | V2, legacy, reversed legacy → same single aggregated record; labor/purchases keep both rows |
| Emulator `SR-07` | real RTDB, both forms: daily metric `[[600, 6, 60]]`, labor keeps 2 rows |
| Emulator `SR-11` | real RTDB + real Admin SDK + real `runForBiz`: 8 representations (legacy [A,B]/[B,A], V2 A→B/B→A, × reversed UUID lexical order) → identical `res`, `daily`, `proactive_insights`, `proactive_digests`; insight `currentValue 600`; ×3 rounds |

Related-risk audit (Codex): `analyzeAnomaly`, `selectBaseline`, `detectLaborInefficiency`, `detectWeakDayPattern`, `detectForecastRisk`, `detectPurchasesWithoutRevenueSupport`, `forecastService` all consume `metrics["daily"]` only → all covered by the same repository contract. `dailyBuilder` (one-row-per-date → typed `duplicate_business_date`) and `entryExceptionsRepo` (`legacy_ambiguous`) are unchanged; they were already order-free.
