// Marjin — strict finite-metric parsing/mapping for legacy-shaped daily analytics.
//
// Extracted as a pure ESM module so the validation can be unit-tested WITHOUT the
// (unavailable) canonical TypeScript toolchain. Consumed by src/alerts/checkers.ts
// readLegacyShapedDaily(): a flat AnalyticsDoc may enter alert calculations only
// when revenue.total, revenue.payroll and revenue.food_cost are ALL valid finite
// numerics. Anything invalid ⇒ the whole date is skipped (never a zero record),
// so malformed/missing analytics can never manufacture a false alert.

// Return a finite number for a valid numeric value, else undefined.
// Valid:   a finite JS number; or a NON-EMPTY numeric string converting to finite.
// Invalid: missing, undefined, null, empty string, whitespace-only string, NaN,
//          Infinity, -Infinity, arbitrary text, boolean, object, array.
export function parseFiniteMetric(value) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed === "") return undefined;          // empty / whitespace-only
    const n = Number(trimmed);
    return Number.isFinite(n) ? n : undefined;     // "abc" → NaN → undefined
  }
  // null, undefined, boolean, object, array, function, symbol, bigint → invalid
  return undefined;
}

// Given a flat AnalyticsDoc `revenue` object, return the strict legacy-shaped
// metric { revenue, laborCost, foodCost } ONLY when all three required fields are
// valid finite numerics (explicit zero is valid). Otherwise return null so the
// caller skips the entire date. Preserves the mapping:
//   revenue.total     → revenue
//   revenue.payroll   → laborCost
//   revenue.food_cost → foodCost
export function strictLegacyDailyMetric(revenue) {
  if (!revenue || typeof revenue !== "object" || Array.isArray(revenue)) return null;
  const total = parseFiniteMetric(revenue.total);
  const payroll = parseFiniteMetric(revenue.payroll);
  const foodCost = parseFiniteMetric(revenue.food_cost);
  if (total === undefined || payroll === undefined || foodCost === undefined) return null;
  return { revenue: total, laborCost: payroll, foodCost };
}
