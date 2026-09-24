# DOWNSTREAM EQUIVALENCE — what is now invariant, and what is recorded as follow-up

## Invariant (proven)
For any multiset of rows per business date, `getDailyMetrics` returns one `DailyMetric` per date whose `revenue`, `laborCost`, `foodCost` are the exact decimal sums of the existing per-row components, converted once; `laborPct`/`foodCostPct` derive from those sums. Consequently every consumer of `metrics["daily"]` — `selectBaseline`, the five proactive detectors, `analyzeDirectMetric/Trend/Anomaly/Forecast/Comparison`, `forecastService` — receives input that does not depend on physical row order, UUID assignment, V2 map insertion order or storage form. Proven at the final-result level: DailyMetric, baseline, detector, persisted insight, digest (unit ×72 / ×8, emulator ×24 ×3 rounds).

## Recorded follow-up audit items (NOT fixed in R2, per assignment)
1. **Nested-map sums inside a row** (`sumObj` over `supplier_payments` / `hourly_payroll`, also in `laborRepo`, `purchasesRepo`, `dailyBuilder`): member enumeration order can change a row component by a binary residual and, in `dailyMetricsRepo`, the truthiness-based `food_cost` fallback. Out of the approved boundary (singleton compatibility preserved); needs an explicit owner decision to widen.
2. **Snapshot monthly reductions** (`snapshotBuilder.ts` ~197-216, 300-344): binary raw-row sums and target/profit comparisons; independent of `dailyMetricsRepo`.
3. **Detector / analysis thresholds on Number arithmetic** (`avg`, `stdDev`, rolling baselines, `forecastService` MTD average, strict `<` comparisons without epsilon): with deterministic per-date input the row-order degree of freedom is gone, but ordinary floating-point approximation remains; no new persisted counterexample is known.
4. **Frontend reductions** in `index.html` (metrics/forecast over raw rows/maps): outside the server reader scope.
5. **Preserved intentional difference**: `dailyBuilder` cleans comma strings (`"1,234"` → 1234) while the repositories coerce them to 0 — pre-existing, documented in R0.
