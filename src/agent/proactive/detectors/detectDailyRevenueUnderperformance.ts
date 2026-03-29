// Marjin AI — Proactive Detector: Daily Revenue Underperformance
// Deterministic. No LLM. Returns null if insufficient data.

import type { FetchedData, BaselineResult } from "../../types/agent.js";
import type { DetectorResult } from "../types.js";
import { avg, pctChange, round2 } from "../../../utils/math.js";
import { zScore } from "../../../utils/stats.js";

// --- Thresholds ---
const Z_SCORE_EARLY_WARNING = 1.5;   // lower than anomaly's 2.0 — this is proactive
const MIN_DATA_POINTS = 14;          // need 2 weeks minimum
const CONSECUTIVE_DAYS_THRESHOLD = 3; // 3+ days below avg = trend signal

interface DailyRecord {
  date: string;
  revenue: number;
}

/**
 * Detect daily revenue underperformance.
 *
 * Logic:
 * 1. Require ≥ 14 data points
 * 2. Use baseline values (rolling 4 weeks) if available, else full dataset
 * 3. Check yesterday's revenue vs baseline with z-score < -1.5
 * 4. Also check: 3+ consecutive recent days below baseline avg → trend signal
 * 5. Severity: single day < -1.5σ = medium. 3+ consecutive = high.
 *
 * Returns null if:
 * - Less than 14 data points
 * - No underperformance detected
 * - Yesterday's revenue is 0 (closed day — handled by suppression)
 */
export function detectDailyRevenueUnderperformance(
  fetched: FetchedData,
  baseline: BaselineResult
): DetectorResult | null {
  const daily = (fetched.metrics["daily"] as DailyRecord[] | undefined) ?? [];

  if (daily.length < MIN_DATA_POINTS) return null;

  const sorted = [...daily].sort((a, b) => a.date.localeCompare(b.date));
  const revenues = sorted.map((d) => d.revenue);

  // Use baseline values if valid, otherwise full dataset
  const baselineValues = baseline.values && baseline.values.length >= 7
    ? baseline.values
    : revenues;

  const baselineAvg = avg(baselineValues);
  if (baselineAvg <= 0) return null; // no meaningful baseline

  // Check most recent day
  const recentRevenue = revenues[revenues.length - 1];
  const recentDate = sorted[sorted.length - 1].date;
  const periodStart = sorted[0].date;

  // Z-score check
  const zResult = zScore(recentRevenue, baselineValues, Z_SCORE_EARLY_WARNING);
  const isRecentBelow = zResult.direction === "low" && zResult.isAnomaly;

  // Consecutive days below baseline avg
  const consecutiveBelow = countConsecutiveBelowFromEnd(revenues, baselineAvg);

  // Decision: is there underperformance?
  if (!isRecentBelow && consecutiveBelow < CONSECUTIVE_DAYS_THRESHOLD) {
    return null; // no underperformance detected
  }

  // Determine severity
  const severity = consecutiveBelow >= CONSECUTIVE_DAYS_THRESHOLD ? "high" : "medium";

  const deviation = round2(pctChange(recentRevenue, baselineAvg));

  // Build supporting facts
  const facts: string[] = [];
  facts.push(`הכנסות אתמול: ₪${round2(recentRevenue)}`);
  facts.push(`ממוצע baseline: ₪${round2(baselineAvg)}`);
  facts.push(`סטייה: ${deviation}%`);

  if (consecutiveBelow >= CONSECUTIVE_DAYS_THRESHOLD) {
    facts.push(`${consecutiveBelow} ימים רצופים מתחת לממוצע`);
  }

  if (isRecentBelow) {
    facts.push(`z-score: ${round2(zResult.zScore)} (סף: -${Z_SCORE_EARLY_WARNING})`);
  }

  return {
    type: "revenue_underperformance",
    severity,
    metric: "daily_revenue",
    currentValue: round2(recentRevenue),
    baselineValue: round2(baselineAvg),
    deviationPct: deviation,
    periodStart,
    periodEnd: recentDate,
    dataPointCount: sorted.length,
    supportingFacts: facts,
    evidenceRefs: [`daily:${periodStart}..${recentDate}`],
  };
}

/**
 * Count how many consecutive days from the end of the array are below the given threshold.
 */
function countConsecutiveBelowFromEnd(values: number[], threshold: number): number {
  let count = 0;
  for (let i = values.length - 1; i >= 0; i--) {
    if (values[i] < threshold) {
      count++;
    } else {
      break;
    }
  }
  return count;
}
