// Business Memory Rules
//
// WHAT GETS STORED:
// - Repeated weak days (e.g., Tuesdays consistently below average)
// - Recurring labor inefficiency patterns
// - Repeated anomalies (same metric, same direction, multiple occurrences)
// - Product performance patterns
// - Past recommendations and their outcomes
// - Persistent correlations (e.g., high labor always on low-revenue days)
//
// CONFIDENCE ON MEMORY:
// - New insight starts at 0.6
// - Each repeated observation adds 0.05 (max 1.0)
// - Stale memory (>60 days since last update) gets deprioritized
// - Memory that contradicts fresh data is ignored in favor of fresh data
//
// WHEN MEMORY MAY INFLUENCE ANSWER:
// - When the same pattern appears again (e.g., "Tuesday weak again")
// - When the user asks a strategic question and past patterns are relevant
// - When making recommendations — past outcomes inform future advice
//
// WHEN MEMORY MUST NOT OVERRIDE FRESH DATA:
// - Always. Fresh validated data trumps memory.
// - Memory enriches context but never replaces current metrics.

export const MEMORY_RULES = {
  MIN_CONFIDENCE_TO_STORE: 0.6,
  MIN_CONFIDENCE_TO_RETRIEVE: 0.6,
  CONFIDENCE_INCREMENT: 0.05,
  MAX_STALE_DAYS: 60,
  MAX_INSIGHTS_PER_QUERY: 5,
  MAX_EVIDENCE_REFS: 10,
} as const;

export {};
