// Marjin AI — Proactive Detector: Weak Day Pattern
// Deterministic. No LLM. Returns null if insufficient data.

import type { FetchedData, BaselineResult } from "../../types/agent.js";
import type { DetectorResult } from "../types.js";
import { avg, round2 } from "../../../utils/math.js";
import { dowToHebDay } from "../../../utils/dates.js";
import { dowOf } from "../../../finance/businessDate.js";
import { formatShekel } from "../../../presenters/money.js";
import { formatPercent } from "../../../presenters/percent.js";
import type { AgentFinancialMonth } from "../../financialMonth.js";
import { revenueClosedDates, trustedCompletedRevenueDays } from "../../financialMonth.js";

// --- Thresholds ---
const MIN_WEEKS = 4;                  // need 4+ full weeks
const MIN_SAMPLES_PER_DAY = 4;        // each dow needs ≥ 4 samples
const WEAK_DAY_RATIO = 0.65;          // day avg < 65% of overall avg = weak
const UNIFORMITY_RATIO = 0.80;        // if all days within 80% of each other, skip

interface DailyRecord {
  date: string;
  revenue: number;
  presence?: { revenue?: string };
  partial?: { revenue?: boolean };
}

interface DowStats {
  dow: number;
  avg: number;
  count: number;
}

/**
 * Detect consistently weak day-of-week pattern.
 *
 * Logic:
 * 1. Require ≥ 4 full weeks of data (≥ 28 data points)
 * 2. Group by day-of-week, compute avg revenue per dow
 * 3. Each dow must have ≥ 4 samples
 * 4. Find weakest day: if its avg < 65% of overall avg → flag
 * 5. Uniformity check: if max dow avg / min dow avg < 1.25 → skip (business is uniform)
 * 6. Only report the single weakest day
 * 7. Severity: weak day avg < 50% of overall = high. 50-65% = medium.
 *
 * Returns null if:
 * - Less than 28 data points
 * - Any dow has < 4 samples
 * - No day below 65% threshold
 * - Business is too uniform (all days similar)
 */
export function detectWeakDayPattern(
  fetched: FetchedData,
  _baseline: BaselineResult
): DetectorResult | null {
  const daily = (fetched.metrics["daily"] as DailyRecord[] | undefined) ?? [];
  const month = fetched.metrics["financialMonth"] as AgentFinancialMonth | undefined;
  if (!month || !month.report.actual.revenue.complete || fetched.fetchStatus?.daily !== "ok" || !month.report.window.completedThrough) return null;
  const monthDays = daily.filter((d) => d.date.startsWith(month.month));
  const closed = revenueClosedDates(fetched.metrics);
  if (closed === null) return null;
  const trusted = trustedCompletedRevenueDays(monthDays,
    { start: `${month.month}-01`, end: month.report.window.completedThrough }, month.asOfBusinessDate, closed);
  if (!trusted) return null;
  const sorted = trusted.days;
  if (sorted.length < MIN_WEEKS * 7) return null;

  // Explicit zero on an operating day participates; only a declared closure
  // is excluded. Missing/invalid revenue makes the month report incomplete.
  const openDays = sorted;
  if (openDays.length < MIN_WEEKS * 5) return null; // need enough open days

  // Group by dow
  const byDow: Record<number, number[]> = {};
  for (const d of openDays) {
    const dow = dowOf(d.date);
    if (!byDow[dow]) byDow[dow] = [];
    byDow[dow].push(d.revenue);
  }

  // Compute stats per dow — only include dows with enough samples
  const dowStats: DowStats[] = [];
  for (const [dow, values] of Object.entries(byDow)) {
    if (values.length < MIN_SAMPLES_PER_DAY) continue;
    dowStats.push({
      dow: Number(dow),
      avg: avg(values),
      count: values.length,
    });
  }

  if (dowStats.length < 3) return null; // not enough different days with data

  const overallAvg = avg(openDays.map((d) => d.revenue));
  if (overallAvg <= 0) return null;

  // Uniformity check: if all days are similar, no point flagging
  const maxDowAvg = Math.max(...dowStats.map((d) => d.avg));
  const minDowAvg = Math.min(...dowStats.map((d) => d.avg));
  if (minDowAvg > 0 && maxDowAvg / minDowAvg < (1 / UNIFORMITY_RATIO)) {
    return null; // business is too uniform — no weak day pattern
  }

  // Find weakest day
  dowStats.sort((a, b) => a.avg - b.avg);
  const weakest = dowStats[0];

  const weakRatio = weakest.avg / overallAvg;
  if (weakRatio >= WEAK_DAY_RATIO) return null; // not weak enough

  // Determine severity
  const severity = weakRatio < 0.5 ? "high" : "medium";

  const deviationPct = round2(((weakest.avg - overallAvg) / overallAvg) * 100);

  // Build supporting facts
  const dayName = dowToHebDay(weakest.dow);
  const strongestDayName = dowToHebDay(dowStats[dowStats.length - 1].dow);

  const facts: string[] = [];
  facts.push(`יום ${dayName}: ממוצע ${formatShekel(String(weakest.avg))}`);
  facts.push(`ממוצע כללי: ${formatShekel(String(overallAvg))}`);
  facts.push(`סטייה: ${formatPercent(String(deviationPct))}`);
  facts.push(`מבוסס על ${weakest.count} דגימות`);
  facts.push(`היום החזק ביותר: ${strongestDayName} (${formatShekel(String(dowStats[dowStats.length - 1].avg))})`);

  const periodStart = sorted[0].date;
  const periodEnd = sorted[sorted.length - 1].date;

  return {
    type: "weak_day_pattern",
    severity,
    metric: "dow_revenue",
    currentValue: round2(weakest.avg),
    baselineValue: round2(overallAvg),
    deviationPct,
    periodStart,
    periodEnd,
    dataPointCount: openDays.length,
    supportingFacts: facts,
    evidenceRefs: [`daily:${periodStart}..${periodEnd}`, `dow:${weakest.dow}`],
  };
}
