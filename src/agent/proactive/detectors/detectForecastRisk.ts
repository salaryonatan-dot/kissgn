// Marjin AI — Proactive Detector: Forecast Risk (MTD Projection)
// Deterministic. No LLM. Returns null if insufficient data.
// Projects month-to-date metrics vs baseline to detect whether the month
// is on track to miss targets for revenue, labor%, or food cost%.

import type { FetchedData, BaselineResult } from "../../types/agent.js";
import type { DetectorResult } from "../types.js";
import { avg, round2 } from "../../../utils/math.js";
import { startOfMonthIso, todayIso } from "../../../utils/dates.js";

// --- Thresholds ---
const MIN_MTD_DAYS = 7;                  // need ≥7 days into the month
const REVENUE_MISS_PCT = -15;            // projected revenue < 85% of baseline monthly = flag
const LABOR_OVER_PCT = 5;               // projected labor% >5 pp above target = flag
const FOOD_OVER_PCT = 5;                // projected food cost% >5 pp above target = flag
const TARGET_LABOR_PCT = 28;            // F&B industry target
const TARGET_FOOD_COST_PCT = 33;        // F&B industry target

interface DailyRecord {
  date: string;
  revenue: number;
  laborCost?: number;
  foodCost?: number;
}

interface ForecastMetric {
  name: string;
  projected: number;
  baseline: number;
  deviationPct: number;
  breachesThreshold: boolean;
}

/**
 * Detect forecast risk — MTD projection vs baseline.
 *
 * Logic:
 * 1. Require ≥ 7 days into the current month
 * 2. For revenue: compute MTD daily avg → project to month end → compare to baseline monthly avg
 * 3. For labor%: compute MTD avg → compare to target (28%)
 * 4. For food cost%: compute MTD avg → compare to target (33%)
 * 5. Flag if any metric projects a significant miss
 * 6. Report the worst-offending metric
 * 7. Severity: revenue miss >25% = high. Labor or food >10pp over = high. Otherwise medium.
 *
 * Returns null if:
 * - Less than 7 days into month
 * - All metrics on track
 * - Insufficient baseline data
 */
export function detectForecastRisk(
  fetched: FetchedData,
  baseline: BaselineResult
): DetectorResult | null {
  const daily = (fetched.metrics["daily"] as DailyRecord[] | undefined) ?? [];
  const today = todayIso();
  const monthStart = startOfMonthIso();

  // Get MTD days only
  const mtdDays = daily
    .filter((d) => d.date >= monthStart && d.date <= today && d.revenue > 0)
    .sort((a, b) => a.date.localeCompare(b.date));

  if (mtdDays.length < MIN_MTD_DAYS) return null;

  // Estimate days in month (use 30 as approximation, or compute from month)
  const monthDate = new Date(monthStart + "T12:00:00");
  const daysInMonth = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0).getDate();
  const daysPassed = mtdDays.length;
  const projectionFactor = daysInMonth / daysPassed;

  // Baseline monthly revenue (from baseline values if available, else from full dataset)
  const baselineValues = baseline.values && baseline.values.length >= 14
    ? baseline.values
    : daily.filter((d) => d.date < monthStart && d.revenue > 0).map((d) => d.revenue);

  if (baselineValues.length < 14) return null; // need baseline data

  const baselineDailyAvg = avg(baselineValues);
  const baselineMonthlyRevenue = baselineDailyAvg * daysInMonth;

  // Evaluate each metric
  const metrics: ForecastMetric[] = [];

  // 1. Revenue projection
  const mtdRevenue = mtdDays.reduce((s, d) => s + d.revenue, 0);
  const projectedRevenue = mtdRevenue * projectionFactor;
  const revenueDeviation = baselineMonthlyRevenue > 0
    ? round2(((projectedRevenue - baselineMonthlyRevenue) / baselineMonthlyRevenue) * 100)
    : 0;

  if (revenueDeviation < REVENUE_MISS_PCT) {
    metrics.push({
      name: "revenue",
      projected: round2(projectedRevenue),
      baseline: round2(baselineMonthlyRevenue),
      deviationPct: revenueDeviation,
      breachesThreshold: true,
    });
  }

  // 2. Labor% projection
  const laborDays = mtdDays.filter((d) => d.laborCost != null && d.laborCost > 0);
  if (laborDays.length >= MIN_MTD_DAYS) {
    const mtdLaborPct = avg(laborDays.map((d) => (d.laborCost! / d.revenue) * 100));
    const laborDeviation = round2(mtdLaborPct - TARGET_LABOR_PCT);

    if (laborDeviation > LABOR_OVER_PCT) {
      metrics.push({
        name: "labor_pct",
        projected: round2(mtdLaborPct),
        baseline: TARGET_LABOR_PCT,
        deviationPct: laborDeviation,
        breachesThreshold: true,
      });
    }
  }

  // 3. Food cost% projection
  const foodDays = mtdDays.filter((d) => d.foodCost != null && d.foodCost > 0);
  if (foodDays.length >= MIN_MTD_DAYS) {
    const mtdFoodPct = avg(foodDays.map((d) => (d.foodCost! / d.revenue) * 100));
    const foodDeviation = round2(mtdFoodPct - TARGET_FOOD_COST_PCT);

    if (foodDeviation > FOOD_OVER_PCT) {
      metrics.push({
        name: "food_cost_pct",
        projected: round2(mtdFoodPct),
        baseline: TARGET_FOOD_COST_PCT,
        deviationPct: foodDeviation,
        breachesThreshold: true,
      });
    }
  }

  if (metrics.length === 0) return null; // all on track

  // Find worst metric (largest absolute deviation)
  metrics.sort((a, b) => Math.abs(b.deviationPct) - Math.abs(a.deviationPct));
  const worst = metrics[0];

  // Determine severity
  let severity: "high" | "medium" | "low";
  if (worst.name === "revenue" && worst.deviationPct < -25) {
    severity = "high";
  } else if ((worst.name === "labor_pct" || worst.name === "food_cost_pct") && worst.deviationPct > 10) {
    severity = "high";
  } else {
    severity = "medium";
  }

  // Build supporting facts (Hebrew)
  const facts: string[] = [];

  for (const m of metrics) {
    if (m.name === "revenue") {
      facts.push(`תחזית הכנסות חודשית: ₪${round2(m.projected)} (בסיס: ₪${round2(m.baseline)})`);
      facts.push(`סטייה צפויה: ${m.deviationPct}%`);
    } else if (m.name === "labor_pct") {
      facts.push(`עלות כוח אדם MTD: ${round2(m.projected)}% (יעד: ${m.baseline}%)`);
      facts.push(`חריגה: +${round2(m.deviationPct)} נקודות אחוז`);
    } else if (m.name === "food_cost_pct") {
      facts.push(`עלות מזון MTD: ${round2(m.projected)}% (יעד: ${m.baseline}%)`);
      facts.push(`חריגה: +${round2(m.deviationPct)} נקודות אחוז`);
    }
  }

  facts.push(`מבוסס על ${daysPassed} ימים מתוך ${daysInMonth} בחודש`);
  facts.push(`גורם הקצה: ×${round2(projectionFactor)}`);

  const periodStart = mtdDays[0].date;
  const periodEnd = mtdDays[mtdDays.length - 1].date;

  return {
    type: "forecast_risk",
    severity,
    metric: worst.name,
    currentValue: worst.projected,
    baselineValue: worst.baseline,
    deviationPct: worst.deviationPct,
    periodStart,
    periodEnd,
    dataPointCount: mtdDays.length,
    supportingFacts: facts,
    evidenceRefs: [
      `daily:${periodStart}..${periodEnd}`,
      `forecast:${worst.name}`,
      ...metrics.map((m) => `metric:${m.name}`),
    ],
  };
}
