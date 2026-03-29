// Marjin AI — Proactive Detector: Weak Hour Pattern
// Deterministic. No LLM. Returns null if insufficient data.
// Analyzes hourly revenue over 4-8 weeks to detect hours consistently < 70% of avg.

import type { FetchedData, BaselineResult } from "../../types/agent.js";
import type { DetectorResult } from "../types.js";
import { avg, round2 } from "../../../utils/math.js";

// --- Thresholds ---
const MIN_WEEKS = 4;                  // need ≥4 weeks of hourly data
const MIN_SAMPLES_PER_HOUR = 4;       // each hour needs ≥4 observations
const WEAK_HOUR_RATIO = 0.70;         // hour avg < 70% of overall hourly avg = weak
const MAX_WEAK_HOURS = 3;             // report up to 3 weak hours
const MIN_HOURLY_REVENUE = 50;        // ignore hours with avg < ₪50 (noise floor)

interface HourlyRecord {
  date: string;
  hour: number;       // 0-23
  revenue: number;
}

interface HourStats {
  hour: number;
  avg: number;
  count: number;
  ratio: number;      // avg / overall avg
}

/**
 * Detect consistently weak hourly revenue patterns.
 *
 * Logic:
 * 1. Require ≥ 4 weeks of hourly data (≥ 28 unique dates)
 * 2. Group by hour (0-23), compute avg revenue per hour
 * 3. Each hour needs ≥ 4 samples to be considered
 * 4. Find hours where avg < 70% of overall hourly avg
 * 5. Only flag hours within business operating range (have data)
 * 6. Ignore hours below ₪50 noise floor (very early/late hours)
 * 7. Severity: weakest hour < 50% = high. 50-70% = medium.
 *
 * Returns null if:
 * - Less than 4 weeks of data
 * - No hour below 70% threshold
 * - All hours are uniformly low (no contrast)
 */
export function detectWeakHourPattern(
  fetched: FetchedData,
  _baseline: BaselineResult
): DetectorResult | null {
  // Hourly data can come from fetched.metrics["hourly"] or we derive from daily+hour
  const hourly = (fetched.metrics["hourly"] as HourlyRecord[] | undefined) ?? [];

  if (hourly.length === 0) return null;

  // Check we have enough unique dates
  const uniqueDates = new Set(hourly.map((h) => h.date));
  if (uniqueDates.size < MIN_WEEKS * 7) return null;

  // Filter out zero-revenue hours (closed hours)
  const activeHours = hourly.filter((h) => h.revenue > 0);
  if (activeHours.length < MIN_WEEKS * 5) return null;

  // Group by hour
  const byHour: Record<number, number[]> = {};
  for (const h of activeHours) {
    if (!byHour[h.hour]) byHour[h.hour] = [];
    byHour[h.hour].push(h.revenue);
  }

  // Compute stats per hour — only hours with enough samples
  const hourStats: HourStats[] = [];
  for (const [hour, values] of Object.entries(byHour)) {
    if (values.length < MIN_SAMPLES_PER_HOUR) continue;
    const hourAvg = avg(values);
    if (hourAvg < MIN_HOURLY_REVENUE) continue; // noise floor
    hourStats.push({
      hour: Number(hour),
      avg: hourAvg,
      count: values.length,
      ratio: 0, // filled below
    });
  }

  if (hourStats.length < 3) return null; // not enough hours with data

  // Compute overall average of active hour averages
  const overallAvg = avg(hourStats.map((h) => h.avg));
  if (overallAvg <= 0) return null;

  // Compute ratio for each hour
  for (const h of hourStats) {
    h.ratio = h.avg / overallAvg;
  }

  // Find weak hours (below threshold)
  const weakHours = hourStats
    .filter((h) => h.ratio < WEAK_HOUR_RATIO)
    .sort((a, b) => a.ratio - b.ratio)
    .slice(0, MAX_WEAK_HOURS);

  if (weakHours.length === 0) return null;

  // Determine severity based on weakest hour
  const weakestRatio = weakHours[0].ratio;
  const severity = weakestRatio < 0.5 ? "high" : "medium";

  const weakest = weakHours[0];
  const deviationPct = round2(((weakest.avg - overallAvg) / overallAvg) * 100);

  // Build supporting facts (Hebrew)
  const facts: string[] = [];

  for (const wh of weakHours) {
    const hourStr = `${String(wh.hour).padStart(2, "0")}:00`;
    const whDeviation = round2(((wh.avg - overallAvg) / overallAvg) * 100);
    facts.push(`שעה ${hourStr}: ממוצע ₪${round2(wh.avg)} (${whDeviation}% מהממוצע)`);
  }

  facts.push(`ממוצע שעתי כללי: ₪${round2(overallAvg)}`);
  facts.push(`מבוסס על ${uniqueDates.size} ימים`);

  // Find strongest hour for context
  const strongest = [...hourStats].sort((a, b) => b.avg - a.avg)[0];
  const strongestHourStr = `${String(strongest.hour).padStart(2, "0")}:00`;
  facts.push(`שעת שיא: ${strongestHourStr} (₪${round2(strongest.avg)})`);

  // Period
  const dates = Array.from(uniqueDates).sort();
  const periodStart = dates[0];
  const periodEnd = dates[dates.length - 1];

  return {
    type: "weak_hour_pattern",
    severity,
    metric: "hourly_revenue",
    currentValue: round2(weakest.avg),
    baselineValue: round2(overallAvg),
    deviationPct,
    periodStart,
    periodEnd,
    dataPointCount: activeHours.length,
    supportingFacts: facts,
    evidenceRefs: [
      `hourly:${periodStart}..${periodEnd}`,
      ...weakHours.map((wh) => `hour:${wh.hour}`),
    ],
  };
}
