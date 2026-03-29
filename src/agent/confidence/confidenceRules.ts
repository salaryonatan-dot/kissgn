// Confidence scoring rules — reference doc

// What RAISES confidence:
// - High completeness (>90% of expected data present)
// - Fresh data (updated within last 24h)
// - Consistent sources (analytics match raw data)
// - Large sample size (>14 days for trends, >4 same-day occurrences for day-of-week)
// - Multiple supporting facts
// - Valid baseline with good sample

// What LOWERS confidence:
// - Missing data for key metrics
// - Stale analytics (>26h since last update)
// - Inconsistency between analytics and raw data
// - Small sample size
// - No supporting facts from data
// - Invalid or missing baseline when required
// - Very few raw records

// Thresholds:
// score >= 0.85 → high → full answer with recommendations if applicable
// score >= 0.65 → medium → answer with hedging, no strong recommendations
// score < 0.65  → low → refuse, return safe-fail message

export const CONFIDENCE_THRESHOLDS = {
  HIGH: 0.85,
  MEDIUM: 0.65,
  REFUSE_BELOW: 0.65,
} as const;

export {};
