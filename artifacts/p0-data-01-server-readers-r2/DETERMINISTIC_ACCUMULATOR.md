# DETERMINISTIC ACCUMULATOR — implementation (`src/repositories/analytics/dailyMetricsRepo.ts`)

## Canonical decimal of a finite Number
`canonicalDecimal(x)`: `s = x.toString()` (ECMAScript shortest round-trip form), matched by
`^(-?)([0-9]+)(?:\.([0-9]+))?(?:e([+-]?[0-9]+))?$`;
`coefficient = BigInt(integerDigits + fractionalDigits)` (negated for `-`), `scale = fractionalDigits.length − exponent`; if `scale < 0` the coefficient is multiplied by `10^(−scale)` and `scale = 0`. So `x ≡ coefficient × 10^(−scale)` exactly.
Examples: `100.1 → (1001n, 1)`, `0.002 → (2n, 3)`, `1e+21 → (1000000000000000000000n, 0)`, `1.5e-7 → (15n, 8)`, `5e-324 → (5n, 324)`, `-2.5 → (-25n, 1)`. Deterministic: the same Number always has the same `toString()`.

## Exact sum
`decimalSum(values)`:
1. `values.length === 1` → return the value unchanged (singleton passthrough, D-R2-1).
2. Non-finite scan: any `NaN` → `NaN`; both `+∞` and `−∞` present → `NaN`; only `+∞` → `+∞`; only `−∞` → `−∞` (category semantics of binary addition, order-independent).
3. Otherwise `total = 0n, scale = 0`; for each operand align scales with powers of ten in BigInt (`total *= 10n**Δ` when the operand is finer; `c *= 10n**Δ` when coarser) and `total += c`. No Number addition anywhere.
4. `total === 0n` → `+0`; else **one** conversion `Number(total.toString() + "e-" + scale)` — a decimal string, so the conversion is the correctly rounded binary64 of the exact total (never `Number(C)/10**S`, which would double-round).

Order independence: integer addition in BigInt is exact and commutative/associative; the final conversion is a function of the exact total only. UUIDs and row order therefore cannot influence the result.

## Aggregation
`aggregateByDate` collects the per-row components per business date into arrays, then `revenue = decimalSum(...)`, `laborCost = decimalSum(...)`, `foodCost = decimalSum(...)`; `laborPct = revenue > 0 ? laborCost/revenue*100 : 0`, `foodCostPct` likewise — ratios from the final sums, never averaged; `transactionCount = 0`, `avgTicket = 0` unchanged; sorted by date. `getLatestDailyDate` unchanged.

## Bounds
Canonical finite Numbers have ≤ 17 significant digits, scale ≤ 324 and ≤ 309 integer digits, so coefficients stay in the hundreds of digits; row counts add only logarithmic growth. No BigInt leaks into the `DailyMetric` (all fields are Numbers).

## Diff vs R1 (single file)
`rowComponents`/`num`/`sumObj`/`readRows` unchanged; `aggregateByDate` accumulates arrays instead of `+=`; `CANONICAL_DECIMAL`, `canonicalDecimal`, `decimalSum` added (private). `git diff c46c2727 -- src/repositories/analytics/dailyMetricsRepo.ts`.
