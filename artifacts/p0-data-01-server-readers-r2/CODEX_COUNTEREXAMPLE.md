# CODEX COUNTEREXAMPLE — reproduced and closed

Source: `~/Documents/marjin-reviews/2026-09-24/deterministic-decimal-design/DOWNSTREAM_THRESHOLD_ANALYSIS.md`.

Fixture: 21 logical dates — chronological 17 × 600, then 812, 500, 500 — and the most recent date ("yesterday") carrying three rows `100.1, 200.2, 300.3`. Rolling baseline (all 21 values) = 600.6. The detector's streak uses strict `value < baselineAvg` with no epsilon: `600.5999999999999 < 600.6` makes 500, 500, 600.5999… a THREE-day streak → high-severity result → persisted (suppressed <10% deviation) insight and digest counts; exactly `600.6` is not below → `null`, nothing persisted.

## Before (parent `c46c2727`) — `entries-reader-decimal-aggregation.test.mjs` #7 (negative control, compiled from git)
- `{100.1, 200.2, 300.3}` over the 6 permutations → aggregate ∈ {`600.5999999999999`, `600.6`} (both observed).
- `[1e308, 1e308, −1e308]` → ∈ {`1e+308`, `Infinity`} (intermediate overflow depends on order).
- Downstream: the six permutations of the Codex fixture yield **two** detector verdicts — `null` and a `high`-severity `revenue_underperformance` — from nothing but physical order.

## After (R2)
- Unit (#1): 108 representations (6 permutations × 6 UUID/value assignments × legacy / V2 / V2 reversed-insertion) → every one `Object.is(revenue, Number("600.6"))`, `String(revenue) === "600.6"`; same for laborCost and foodCost and for string inputs.
- Unit (#5), actual path `getDailyMetrics → fetchPlannedData → selectBaseline → detectDailyRevenueUnderperformance → runForBiz → persisted insight → digest`: 72 representations (6 perms × 6 UUID assignments × 2 forms) → DailyMetric `600.6`, 21 dates, baseline valid, detector `null`, no `revenue_underperformance` insight, a digest persisted with `totalDetected = 0, totalSuppressed = 0`, and the whole persisted state (timestamps stripped) deep-equal across all 72.
- Unit (#6) positive persistence control: aggregate 600 vs ~1000 history → one real persisted insight (`currentValue 600`) and non-empty digest, identical across 8 representations (proves the equality above is not "two empty outputs").
- Emulator `SR-12` (real RTDB + real Admin SDK + real `runForBiz`): 24 representations (6 perms × 2 UUID assignments × 2 forms) → `600.6`, detector null, identical insight-set and digest (`detected=0, suppressed=0`); 3 consecutive rounds.
