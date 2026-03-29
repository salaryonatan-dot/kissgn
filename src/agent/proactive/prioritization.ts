// Marjin AI — Proactive Insights Prioritization
// Deterministic impact scoring. No LLM.
// Formula: severityWeight * confidence * recurrenceWeight * businessValueWeight

import type { ProactiveInsight, ProactiveInsightType, InsightScore } from "./types.js";

// --- Severity Weights ---
const SEVERITY_WEIGHTS: Record<string, number> = {
  high: 1.0,
  medium: 0.6,
  low: 0.3,
};

// --- Recurrence Weights ---
// More occurrences = more important (up to a cap)
function recurrenceWeight(count: number): number {
  if (count >= 5) return 1.5;    // chronic — deserves attention
  if (count >= 3) return 1.3;    // recurring — escalate
  if (count >= 2) return 1.1;    // confirmed pattern
  return 1.0;                    // first time
}

// --- Business Value Weights ---
// Revenue-related insights are weighted higher than operational ones
const BIZ_VALUE_WEIGHTS: Record<ProactiveInsightType, number> = {
  revenue_underperformance: 1.2,
  forecast_risk: 1.2,
  purchases_without_revenue: 1.1,
  labor_inefficiency: 1.0,
  weak_day_pattern: 0.8,
  weak_hour_pattern: 0.7,
};

/**
 * Score a single proactive insight.
 * Formula: severityWeight × confidence × recurrenceWeight × businessValueWeight
 * Range: ~0.0 to ~2.7 (theoretical max: 1.0 × 1.0 × 1.5 × 1.2 = 1.8)
 */
export function scoreInsight(insight: ProactiveInsight): InsightScore {
  const sevW = SEVERITY_WEIGHTS[insight.severity] ?? 0.3;
  const conf = insight.confidenceScore;
  const recW = recurrenceWeight(insight.occurrenceCount);
  const bizW = BIZ_VALUE_WEIGHTS[insight.type] ?? 1.0;

  const impactScore = Math.round(sevW * conf * recW * bizW * 1000) / 1000;

  return {
    insightId: insight.id,
    type: insight.type,
    severity: insight.severity,
    confidence: insight.confidenceScore,
    recurrenceCount: insight.occurrenceCount,
    impactScore,
  };
}

/**
 * Score and rank multiple insights by impact.
 * Returns sorted array (highest impact first).
 */
export function rankInsights(insights: ProactiveInsight[]): InsightScore[] {
  return insights
    .map(scoreInsight)
    .sort((a, b) => b.impactScore - a.impactScore);
}

/**
 * Pick the top N insights by impact score.
 * Used for daily digest (max 3) and weekly summary (max 5).
 */
export function pickTopInsights(insights: ProactiveInsight[], maxCount: number): InsightScore[] {
  return rankInsights(insights).slice(0, maxCount);
}
