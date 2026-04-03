import type { MetricsPlan, FetchedData } from "../agent/types/agent.js";
import type { AgentContext } from "../agent/types/agent.js";
import { getDailyMetrics, getLatestDailyDate } from "../repositories/analytics/dailyMetricsRepo.js";
import { getHourlyMetrics } from "../repositories/analytics/hourlyMetricsRepo.js";
import { getLaborMetrics } from "../repositories/analytics/laborRepo.js";
import { getProductMetrics, getTopProducts } from "../repositories/analytics/productRepo.js";
import { getPurchaseMetrics } from "../repositories/analytics/purchasesRepo.js";
import { isWithinDays } from "../utils/guards.js";
import { logger } from "../utils/logging.js";
import { withTimeout, TIMEOUT_CRITICAL_MS, TIMEOUT_SECONDARY_MS } from "../utils/async.js";

export async function fetchPlannedData(
  plan: MetricsPlan,
  context: AgentContext
): Promise<FetchedData> {
  const { tenantId, branchId } = context;
  const { start, end } = plan.timeRange;

  const metrics: Record<string, unknown> = {};
  const sources: string[] = [];
  const evidenceRefs: string[] = [];
  const fetchStatus: Record<string, "ok" | "failed" | "skipped"> = {};
  let totalRecords = 0;

  // --- Daily: always fetch (critical source) ---
  try {
    const daily = await withTimeout(
      getDailyMetrics(tenantId, start, end, context.bizId, branchId),
      TIMEOUT_CRITICAL_MS,
      "getDailyMetrics"
    );
    metrics["daily"] = daily;
    totalRecords += daily.length;
    sources.push("analytics/daily");
    fetchStatus["daily"] = "ok";
    if (daily.length > 0) {
      evidenceRefs.push(`daily:${daily[0].date}..${daily[daily.length - 1].date}`);
    }
  } catch (err) {
    logger.error("Failed to fetch daily metrics:", err);
    fetchStatus["daily"] = "failed";
  }

  // --- Hourly: if needed ---
  if (plan.metrics.some((m) => m.includes("hourly"))) {
    try {
      const hourly = await withTimeout(
        getHourlyMetrics(tenantId, start, end, branchId),
        TIMEOUT_SECONDARY_MS,
        "getHourlyMetrics"
      );
      metrics["hourly"] = hourly;
      totalRecords += hourly.length;
      sources.push("analytics/hourly");
      fetchStatus["hourly"] = "ok";
    } catch (err) {
      logger.error("Failed to fetch hourly metrics:", err);
      fetchStatus["hourly"] = "failed";
    }
  } else {
    fetchStatus["hourly"] = "skipped";
  }

  // --- Labor: if needed ---
  if (plan.metrics.some((m) => m.includes("labor"))) {
    try {
      const labor = await withTimeout(
        getLaborMetrics(tenantId, start, end, context.bizId, branchId),
        TIMEOUT_SECONDARY_MS,
        "getLaborMetrics"
      );
      metrics["labor"] = labor;
      totalRecords += labor.length;
      sources.push("analytics/labor");
      fetchStatus["labor"] = "ok";
    } catch (err) {
      logger.error("Failed to fetch labor metrics:", err);
      fetchStatus["labor"] = "failed";
    }
  } else {
    fetchStatus["labor"] = "skipped";
  }

  // --- Products: if needed ---
  if (plan.metrics.some((m) => m.includes("product"))) {
    try {
      const products = await withTimeout(
        getTopProducts(tenantId, start, end, context.bizId),
        TIMEOUT_SECONDARY_MS,
        "getTopProducts"
      );
      metrics["products"] = products;
      totalRecords += products.length;
      sources.push("analytics/products");
      fetchStatus["products"] = "ok";
    } catch (err) {
      logger.error("Failed to fetch product metrics:", err);
      fetchStatus["products"] = "failed";
    }
  } else {
    fetchStatus["products"] = "skipped";
  }

  // --- Purchases: if needed ---
  if (plan.metrics.some((m) => m.includes("supplier") || m.includes("purchase"))) {
    try {
      const purchases = await withTimeout(
        getPurchaseMetrics(tenantId, start, end, context.bizId, branchId),
        TIMEOUT_SECONDARY_MS,
        "getPurchaseMetrics"
      );
      metrics["purchases"] = purchases;
      totalRecords += purchases.length;
      sources.push("analytics/purchases");
      fetchStatus["purchases"] = "ok";
    } catch (err) {
      logger.error("Failed to fetch purchase metrics:", err);
      fetchStatus["purchases"] = "failed";
    }
  } else {
    fetchStatus["purchases"] = "skipped";
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
    fetchStatus,
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
