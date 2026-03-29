// Marjin AI — Proactive Detector: Labor Inefficiency
// Deterministic. No LLM. Returns null if insufficient data.

import type { FetchedData, BaselineResult } from "../../types/agent.js";
import type { DetectorResult } from "../types.js";
import { avg, round2 } from "../../../utils/math.js";
import { trendDirection } from "../../../utils/stats.js";

// --- Thresholds ---
const LABOR_PCT_WARNING = 30;         // trailing avg > 30% = flag
const LABOR_PCT_RISING_THRESHOLD = 28; // if trending UP and already > 28% = flag
const MIN_DATA_POINTS = 7;            // need at least 7 days with labor data
const TARGET_LABOR_PCT = 28;          // F&B industry target

interface DailyRecord {
  date: string;
  revenue: number;
  laborCost?: number;
  laborPct?: number;
}

/**
 * Detect labor inefficiency.
 *
 * Logic:
 * 1. Require ≥ 7 days with both revenue > 0 AND laborCost > 0
 * 2. Compute laborPct for each valid day: (laborCost / revenue) × 100
 * 3. Check: trailing 7-day avg laborPct > 30% → flag
 * 4. Check: laborPct trend rising over 14 days AND latest > 28% → flag
 * 5. Severity: trailing avg > 35% = high. 30-35% = medium. Rising trend > 28% = medium.
 *
 * Returns null if:
 * - Fewer than 7 valid data points (days where both revenue and labor exist)
 * - No inefficiency detected
 */
export function detectLaborInefficiency(
  fetched: FetchedData,
  _baseline: BaselineResult
): DetectorResult | null {
  const daily = (fetched.metrics["daily"] as DailyRecord[] | undefined) ?? [];

  const sorted = [...daily].sort((a, b) => a.date.localeCompare(b.date));

  // Filter to days with valid labor data (revenue > 0, laborCost defined)
  const validDays = sorted.filter(
    (d) => d.revenue > 0 && d.laborCost != null && d.laborCost > 0
  );

  if (validDays.length < MIN_DATA_POINTS) return null;

  // Compute laborPct for each day
  const laborPcts = validDays.map((d) => ({
    date: d.date,
    pct: round2((d.laborCost! / d.revenue) * 100),
  }));

  // Trailing 7-day average
  const trailing7 = laborPcts.slice(-7);
  const trailing7Avg = round2(avg(trailing7.map((d) => d.pct)));

  // Trend over all valid days
  const allPcts = laborPcts.map((d) => d.pct);
  const trend = trendDirection(allPcts);
  const latestPct = laborPcts[laborPcts.length - 1].pct;

  // Decision logic
  const isTrailingHigh = trailing7Avg > LABOR_PCT_WARNING;
  const isRisingAboveTarget = trend === "rising" && latestPct > LABOR_PCT_RISING_THRESHOLD;

  if (!isTrailingHigh && !isRisingAboveTarget) {
    return null; // no inefficiency detected
  }

  // Determine severity
  let severity: "high" | "medium" | "low";
  if (trailing7Avg > 35) {
    severity = "high";
  } else if (isTrailingHigh) {
    severity = "medium";
  } else {
    severity = "medium"; // rising trend above target
  }

  const currentValue = trailing7Avg;
  const baselineValue = TARGET_LABOR_PCT;
  const deviationPct = round2(((currentValue - baselineValue) / baselineValue) * 100);

  // Build supporting facts
  const facts: string[] = [];
  facts.push(`ממוצע כוח אדם (7 ימים): ${trailing7Avg}%`);
  facts.push(`יעד ענף: ${TARGET_LABOR_PCT}%`);
  facts.push(`סטייה מהיעד: +${round2(trailing7Avg - TARGET_LABOR_PCT)}%`);

  if (isRisingAboveTarget) {
    facts.push(`מגמה: עולה (כוח אדם מתייקר)`);
  }

  if (latestPct > 35) {
    facts.push(`היום האחרון: ${latestPct}% — גבוה באופן חריג`);
  }

  const periodStart = validDays[0].date;
  const periodEnd = validDays[validDays.length - 1].date;

  return {
    type: "labor_inefficiency",
    severity,
    metric: "labor_pct",
    currentValue,
    baselineValue,
    deviationPct,
    periodStart,
    periodEnd,
    dataPointCount: validDays.length,
    supportingFacts: facts,
    evidenceRefs: [`daily:${periodStart}..${periodEnd}`],
  };
}
