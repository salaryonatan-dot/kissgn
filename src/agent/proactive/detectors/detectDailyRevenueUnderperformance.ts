// Marjin AI — Proactive Detector: Daily Revenue Underperformance
// Deterministic. No LLM. Returns null if insufficient data.

import type { FetchedData, BaselineResult } from "../../types/agent.js";
import type { DetectorResult } from "../types.js";
import { avg, pctChange, round2 } from "../../../utils/math.js";
import { zScore } from "../../../utils/stats.js";
import type { AgentFinancialMonth } from "../../financialMonth.js";
import { revenueClosedDates, trustedCompletedRevenueDays } from "../../financialMonth.js";
import { addDays } from "../../../finance/businessDate.js";
import { formatShekel } from "../../../presenters/money.js";
import { formatPercent } from "../../../presenters/percent.js";

// --- Thresholds ---
const Z_SCORE_EARLY_WARNING = 1.5;   // lower than anomaly's 2.0 — this is proactive
const MIN_DATA_POINTS = 14;          // need 2 weeks minimum
const CONSECUTIVE_DAYS_THRESHOLD = 3; // 3+ days below avg = trend signal

interface DailyRecord {
  date: string;
  revenue: number;
  presence?: { revenue?: string };
  partial?: { revenue?: boolean };
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
  _baseline: BaselineResult
): DetectorResult | null {
  const daily = (fetched.metrics["daily"] as DailyRecord[] | undefined) ?? [];
  const month = fetched.metrics["financialMonth"] as AgentFinancialMonth | undefined;
  if (fetched.fetchStatus?.daily !== "ok") return null;
  const asOfBusinessDate = month?.asOfBusinessDate ??
    (typeof fetched.metrics["asOfBusinessDate"] === "string" ? fetched.metrics["asOfBusinessDate"] : null);
  if (!asOfBusinessDate) return null;
  const end = month?.report.window.completedThrough ?? addDays(asOfBusinessDate, -1);
  const start = daily.reduce<string | null>((min, d) => min === null || d.date < min ? d.date : min, null);
  if (!start) return null;
  const closed = revenueClosedDates(fetched.metrics);
  if (closed === null) return null;
  const trusted = trustedCompletedRevenueDays(daily, { start, end }, asOfBusinessDate, closed);
  if (!trusted || !trusted.days.some((d) => d.date === end)) return null;
  const sorted = trusted.days;
  if (sorted.length < MIN_DATA_POINTS) return null;
  const revenues = sorted.map((d) => d.revenue);

  // The evaluated day must never influence its own expectation. The trusted
  // preceding operating days are the independent, period-scoped baseline.
  const baselineValues = revenues.slice(0, -1);
  if (baselineValues.length < MIN_DATA_POINTS) return null;

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
  facts.push(`הכנסות אתמול: ${formatShekel(String(recentRevenue))}`);
  facts.push(`ממוצע baseline: ${formatShekel(String(baselineAvg))}`);
  facts.push(`סטייה: ${formatPercent(String(deviation))}`);

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
