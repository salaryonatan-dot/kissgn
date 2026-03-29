// Marjin AI — Proactive Detector: Purchases Without Revenue Support
// Deterministic. No LLM. Returns null if insufficient data.
// Detects when purchases increase but revenue doesn't — signals waste or overstocking.

import type { FetchedData, BaselineResult } from "../../types/agent.js";
import type { DetectorResult } from "../types.js";
import { avg, round2, pctChange } from "../../../utils/math.js";
import { trendDirection } from "../../../utils/stats.js";

// --- Thresholds ---
const MIN_DATA_POINTS = 14;             // need 2 weeks minimum
const PURCHASE_INCREASE_PCT = 15;       // purchases up ≥15% from baseline
const REVENUE_TOLERANCE_PCT = 5;        // revenue didn't grow more than 5%
const MIN_PURCHASE_AMOUNT = 500;        // ignore trivial purchase volumes

interface DailyRecord {
  date: string;
  revenue: number;
  purchases?: number;       // daily purchase/COGS amount
  foodCost?: number;        // alternative field name
}

/**
 * Detect purchases increasing without matching revenue growth.
 *
 * Logic:
 * 1. Require ≥ 14 days with both revenue AND purchase data
 * 2. Split into first half (baseline period) and second half (recent period)
 * 3. Compare purchase avg between periods — if up ≥15%…
 * 4. …and revenue didn't grow by more than 5% → flag
 * 5. Also check: purchase trend rising while revenue flat/falling
 * 6. Severity: purchase growth >30% with flat revenue = high. 15-30% = medium.
 *
 * Returns null if:
 * - Insufficient data
 * - Purchases not increasing relative to revenue
 * - Purchase amounts below noise floor
 */
export function detectPurchasesWithoutRevenueSupport(
  fetched: FetchedData,
  _baseline: BaselineResult
): DetectorResult | null {
  const daily = (fetched.metrics["daily"] as DailyRecord[] | undefined) ?? [];

  const sorted = [...daily].sort((a, b) => a.date.localeCompare(b.date));

  // Filter to days with valid purchase + revenue data
  const validDays = sorted.filter((d) => {
    const purchaseVal = d.purchases ?? d.foodCost ?? 0;
    return d.revenue > 0 && purchaseVal > 0;
  });

  if (validDays.length < MIN_DATA_POINTS) return null;

  // Extract purchase values (use purchases field, fall back to foodCost)
  const withPurchases = validDays.map((d) => ({
    date: d.date,
    revenue: d.revenue,
    purchases: d.purchases ?? d.foodCost ?? 0,
  }));

  // Split into baseline (first half) and recent (second half)
  const midpoint = Math.floor(withPurchases.length / 2);
  const baselinePeriod = withPurchases.slice(0, midpoint);
  const recentPeriod = withPurchases.slice(midpoint);

  const baselinePurchaseAvg = avg(baselinePeriod.map((d) => d.purchases));
  const recentPurchaseAvg = avg(recentPeriod.map((d) => d.purchases));
  const baselineRevenueAvg = avg(baselinePeriod.map((d) => d.revenue));
  const recentRevenueAvg = avg(recentPeriod.map((d) => d.revenue));

  // Noise floor check
  if (recentPurchaseAvg < MIN_PURCHASE_AMOUNT) return null;

  // Compute percentage changes
  const purchaseGrowth = pctChange(recentPurchaseAvg, baselinePurchaseAvg);
  const revenueGrowth = pctChange(recentRevenueAvg, baselineRevenueAvg);

  // Decision: purchases up significantly, revenue not matching
  if (purchaseGrowth < PURCHASE_INCREASE_PCT) return null;
  if (revenueGrowth > REVENUE_TOLERANCE_PCT) return null;

  // Trend confirmation: require actual sustained purchase trend, not a one-off spike
  const purchaseTrend = trendDirection(withPurchases.map((d) => d.purchases));
  if (purchaseTrend !== "rising") return null;

  const revenueTrend = trendDirection(withPurchases.map((d) => d.revenue));

  // Determine severity
  const severity = purchaseGrowth > 30 ? "high" : "medium";

  const deviationPct = round2(purchaseGrowth);

  // Build supporting facts (Hebrew)
  const facts: string[] = [];
  facts.push(`ממוצע רכישות (תקופה אחרונה): ₪${round2(recentPurchaseAvg)}/יום`);
  facts.push(`ממוצע רכישות (תקופת בסיס): ₪${round2(baselinePurchaseAvg)}/יום`);
  facts.push(`עלייה ברכישות: +${round2(purchaseGrowth)}%`);
  facts.push(`שינוי בהכנסות: ${revenueGrowth > 0 ? "+" : ""}${round2(revenueGrowth)}%`);

  if (revenueTrend === "falling") {
    facts.push(`מגמת הכנסות: יורדת — רכישות לא נתמכות`);
  } else if (revenueTrend === "flat") {
    facts.push(`מגמת הכנסות: יציבה — רכישות עולות ללא צידוק`);
  }

  const periodStart = validDays[0].date;
  const periodEnd = validDays[validDays.length - 1].date;

  return {
    type: "purchases_without_revenue",
    severity,
    metric: "purchase_vs_revenue",
    currentValue: round2(recentPurchaseAvg),
    baselineValue: round2(baselinePurchaseAvg),
    deviationPct,
    periodStart,
    periodEnd,
    dataPointCount: validDays.length,
    supportingFacts: facts,
    evidenceRefs: [`daily:${periodStart}..${periodEnd}`, "purchases_trend"],
  };
}
