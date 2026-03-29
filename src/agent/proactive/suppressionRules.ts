// Marjin AI — Proactive Insights Suppression Rules
// Deterministic. Every suppression has an explicit reason.

import type { DetectorResult, ProactiveInsight, SuppressionReason } from "./types.js";
import type { ConfidenceResult, ValidationResult } from "../types/agent.js";
import { isChronicPattern } from "./deduplication.js";

// --- Constants ---
const MAX_ACTIVE_INSIGHTS_PER_BIZ = 3;
const MAX_INSIGHTS_PER_BIZ_PER_WEEK = 5;
const MIN_DEVIATION_PCT = 10; // suppress deviations below 10%

interface SuppressionInput {
  result: DetectorResult;
  confidence: ConfidenceResult;
  validation: ValidationResult;
  recentInsights: ProactiveInsight[];
  isDuplicate: boolean;
}

interface SuppressionOutput {
  suppressed: boolean;
  reason?: SuppressionReason;
}

/**
 * Evaluate all suppression rules in priority order.
 * First matching rule wins — insight is suppressed with that reason.
 */
export function evaluateSuppression(input: SuppressionInput): SuppressionOutput {
  const { result, confidence, validation, recentInsights, isDuplicate } = input;

  // Rule 1: Low confidence — don't surface
  if (confidence.shouldRefuse || confidence.score < 0.65) {
    return { suppressed: true, reason: "low_confidence" };
  }

  // Rule 2: Data validation failed
  if (!validation.ok) {
    return { suppressed: true, reason: "insufficient_data" };
  }

  // Rule 3: Duplicate (already handled by dedup — bump instead of create)
  if (isDuplicate) {
    return { suppressed: true, reason: "duplicate" };
  }

  // Rule 4: Deviation too small to be meaningful
  if (Math.abs(result.deviationPct) < MIN_DEVIATION_PCT) {
    return { suppressed: true, reason: "within_normal_variance" };
  }

  // Rule 5: Chronic known issue (7+ consecutive fires on same type+metric)
  if (isChronicPattern(recentInsights, result.type, result.metric)) {
    // Exception: if severity ESCALATED to high, allow through
    const existing = recentInsights.find(
      (i) => i.type === result.type && i.metric === result.metric && !i.suppressed
    );
    if (!(existing && existing.severity !== "high" && result.severity === "high")) {
      return { suppressed: true, reason: "chronic_known_issue" };
    }
  }

  // Rule 6: Weekly quota exceeded
  const thisWeekActive = recentInsights.filter((i) => {
    if (i.suppressed) return false;
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    return i.lastDetectedAt >= sevenDaysAgo.toISOString();
  });
  if (thisWeekActive.length >= MAX_INSIGHTS_PER_BIZ_PER_WEEK) {
    return { suppressed: true, reason: "quota_exceeded" };
  }

  // Rule 7: Max active insights cap
  const activeNonSuppressed = recentInsights.filter((i) => !i.suppressed);
  if (activeNonSuppressed.length >= MAX_ACTIVE_INSIGHTS_PER_BIZ) {
    // Only suppress if this is lower severity than all existing
    const hasLowerPriority = activeNonSuppressed.every(
      (i) => severityRank(i.severity) <= severityRank(result.severity)
    );
    if (hasLowerPriority) {
      return { suppressed: true, reason: "quota_exceeded" };
    }
    // Otherwise: this is higher priority — it passes, oldest low-severity will be archived
  }

  // Rule 8: Closed day detection (revenue = 0 on expected open day)
  if (result.type === "revenue_underperformance" && result.currentValue === 0) {
    return { suppressed: true, reason: "closed_day" };
  }

  // All rules passed — insight is allowed
  return { suppressed: false };
}

function severityRank(severity: string): number {
  if (severity === "high") return 0;
  if (severity === "medium") return 1;
  return 2;
}
