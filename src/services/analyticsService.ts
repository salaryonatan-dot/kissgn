import type { MetricsPlan, FetchedData } from "../agent/types/agent.js";
import type { AgentContext } from "../agent/types/agent.js";
import { getDailyMetrics, getLatestDailyDate } from "../repositories/analytics/dailyMetricsRepo.js";
import { getHourlyMetrics } from "../repositories/analytics/hourlyMetricsRepo.js";
import { getLaborMetrics } from "../repositories/analytics/laborRepo.js";
import { getProductMetrics, getTopProducts } from "../repositories/analytics/productRepo.js";
import { getPurchaseMetrics } from "../repositories/analytics/purchasesRepo.js";
import { isWithinDays } from "../utils/guards.js";
import { logger } from "../utils/logging.js";

export async function fetchPlannedData(
  plan: MetricsPlan,
  context: AgentContext
): Promise<FetchedData> {
  const { tenantId, branchId } = context;
  const { start, end } = plan.timeRange;
  const metrics: Record<string, unknown> = {};
  const sources: string[] = [];
  const evidenceRefs: string[] = [];
  let totalRecords = 0;

  try {
    // Always fetch daily — it's the backbone
    const daily = await getDailyMetrics(tenantId, start, end, context.bizId, branchId);
    metrics["daily"] = daily;
    totalRecords += daily.length;
    sources.push("analytics/daily");
    if (daily.length > 0) {
      evidenceRefs.push(`daily:${daily[0].date}..${daily[daily.length - 1].date}`);
    }

    // Hourly if needed
    if (plan.metrics.some((m) => m.includes("hourly"))) {
      const hourly = await getHourlyMetrics(tenantId, start, end, branchId);
      metrics["hourly"] = hourly;
      totalRecords += hourly.length;
      sources.push("analytics/hourly");
    }

    // Labor if needed
    if (plan.metrics.some((m) => m.includes("labor"))) {
      const labor = await getLaborMetrics(tenantId, start, end, context.bizId, branchId);
      metrics["labor"] = labor;
      totalRecords += labor.length;
      sources.push("analytics/labor");
    }

    // Products if needed
    if (plan.metrics.some((m) => m.includes("product"))) {
      const products = await getTopProducts(tenantId, start, end, context.bizId);
      metrics["products"] = products;
      totalRecords += products.length;
      sources.push("analytics/products");
    }

    // Purchases if needed
    if (plan.metrics.some((m) => m.includes("supplier") || m.includes("purchase"))) {
      const purchases = await getPurchaseMetrics(tenantId, start, end, context.bizId, branchId);
      metrics["purchases"] = purchases;
      totalRecords += purchases.length;
      sources.push("analytics/purchases");
    }
  } catch (err) {
    logger.error("Failed to fetch planned data:", err);
  }

  // Compute quality scores
  const daily = (metrics["daily"] as Array<{ date: string }>) ?? [];
  const expectedDays = Math.max(1, daysBetweenSimple(start, end) + 1);
  const completenessScore = Math.min(1, daily.length / expectedDays);

  // Freshness: check if latest data is recent
  let freshnessScore = 0.5;
  try {
    const latestDate = await getLatestDailyDate(tenantId, context.bizId);
    if (latestDate && isWithinDays(latestDate, 2)) {
      freshnessScore = 1.0;
    } else if (latestDate && isWithinDays(latestDate, 4)) {
      freshnessScore = 0.75;
    }
  } catch {
    // keep default
  }

  // Consistency: cross-check daily data for suspicious patterns
  const consistencyScore = computeConsistencyScore(daily, totalRecords);
  const sampleAdequacyScore = Math.min(1, daily.length / 14); // 14 days = fully adequate

  return {
    metrics,
    completenessScore,
    freshnessScore,
    consistencyScore,
    sampleAdequacyScore,
    sources,
    evidenceRefs,
    rawRecordCount: totalRecords,
  };
}

function daysBetweenSimple(a: string, b: string): number {
  const da = new Date(a).getTime();
  const db = new Date(b).getTime();
  return Math.round(Math.abs(db - da) / 86_400_000);
}

/**
 * Compute consistency score by checking for data anomalies that indicate
 * unreliable or contradictory data (not business anomalies — data quality issues).
 */
function computeConsistencyScore(
  daily: Array<{ date: string; revenue?: number; laborCost?: number; foodCost?: number }>,
  totalRecords: number
): number {
  if (totalRecords === 0) return 0.0;
  if (daily.length === 0) return 0.5;

  let score = 1.0;
  let checks = 0;
  let failures = 0;

  for (const d of daily) {
    checks++;
    // Negative revenue is a data inconsistency
    if (d.revenue != null && d.revenue < 0) failures++;
    // Labor cost > revenue is suspicious (possible data error)
    if (d.revenue != null && d.laborCost != null && d.laborCost > d.revenue * 1.5) failures++;
    // Food cost > revenue is suspicious
    if (d.revenue != null && d.foodCost != null && d.foodCost > d.revenue * 1.2) failures++;
  }

  // Check for duplicate dates
  const dates = daily.map((d) => d.date);
  const uniqueDates = new Set(dates);
  if (uniqueDates.size < dates.length) {
    failures += dates.length - uniqueDates.size;
    checks += dates.length - uniqueDates.size;
  }

  if (checks > 0) {
    score = Math.max(0, 1 - (failures / checks));
  }

  return Math.round(score * 100) / 100;
}
