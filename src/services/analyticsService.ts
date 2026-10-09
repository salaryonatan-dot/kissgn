import type { MetricsPlan, FetchedData } from "../agent/types/agent.js";
import type { AgentContext } from "../agent/types/agent.js";
import { getDailyMetrics, getLatestDailyDate } from "../repositories/analytics/dailyMetricsRepo.js";
import { getLaborMetrics } from "../repositories/analytics/laborRepo.js";
import { getProductMetrics, getTopProducts } from "../repositories/analytics/productRepo.js";
import { getPurchaseMetrics } from "../repositories/analytics/purchasesRepo.js";
import { isWithinDays } from "../utils/guards.js";
import { isEntriesReadError } from "../../lib/analytics/entriesReader.js";
import { isCanonicalFinanceError } from "../finance-server/canonicalMetrics.js";
import { logger } from "../utils/logging.js";
import { withTimeout, TIMEOUT_CRITICAL_MS, TIMEOUT_SECONDARY_MS } from "../utils/async.js";
import { agentRequestWindow, assembleAgentFinancialMonth, isFullMonthRequest, revenueCalendarMonths } from "../agent/financialMonth.js";
import { loadAgentClosedDatesForMonths, loadAgentMonthSource } from "../agent/financialMonthSource.js";

export async function fetchPlannedData(
  plan: MetricsPlan,
  context: AgentContext
): Promise<FetchedData> {
  const { tenantId, branchId } = context;
  const { start, end } = plan.timeRange;
  const { asOfBusinessDate: asOfDate, actualEnd } = agentRequestWindow(context.nowIso, { start, end });

  const metrics: Record<string, unknown> = {};
  if (asOfDate) metrics["asOfBusinessDate"] = asOfDate;
  const sources: string[] = [];
  const evidenceRefs: string[] = [];
  const fetchStatus: Record<string, "ok" | "failed" | "skipped"> = {};
  let totalRecords = 0;

  // --- Daily: always fetch (critical source) ---
  try {
    const daily = await withTimeout(
      getDailyMetrics(tenantId, start, actualEnd, context.bizId, branchId),
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
    // Server reader convergence (CTO D3): a typed entries-storage failure is NOT a
    // soft "source failed" — it must reach the per-business boundary (proactive job
    // catch / agent request failure) so nothing derived is persisted for this
    // business from corrupt or ambiguous entries. Other errors keep the soft-fail.
    if (isEntriesReadError(err) || isCanonicalFinanceError(err)) throw err;
    fetchStatus["daily"] = "failed";
  }

  // --- Hourly: RETIRED (Foundation Release) ---
  // The per-business analytics source carries no POS hourly revenue/tickets, and
  // the legacy tenant-wide analytics/daily node is locked (.read/.write:false).
  // The weak_hour_pattern workflow is deactivated, so hourly metrics are never
  // fetched and no path reaches the legacy node. Re-enable under a dedicated
  // POS-ingestion release. See "fix: retire unsupported hourly analytics workflow".
  fetchStatus["hourly"] = "skipped";

  // --- Labor: if needed ---
  if (plan.metrics.some((m) => m.includes("labor"))) {
    try {
      const labor = await withTimeout(
        getLaborMetrics(tenantId, start, actualEnd, context.bizId, branchId),
        TIMEOUT_SECONDARY_MS,
        "getLaborMetrics"
      );
      metrics["labor"] = labor;
      totalRecords += labor.length;
      sources.push("analytics/labor");
      fetchStatus["labor"] = "ok";
    } catch (err) {
      logger.error("Failed to fetch labor metrics:", err);
      if (isEntriesReadError(err) || isCanonicalFinanceError(err)) throw err;
      fetchStatus["labor"] = "failed";
    }
  } else {
    fetchStatus["labor"] = "skipped";
  }

  // --- Products: if needed ---
  if (plan.metrics.some((m) => m.includes("product"))) {
    try {
      const products = await withTimeout(
        getTopProducts(tenantId, start, actualEnd, context.bizId),
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
        getPurchaseMetrics(tenantId, start, actualEnd, context.bizId, branchId),
        TIMEOUT_SECONDARY_MS,
        "getPurchaseMetrics"
      );
      metrics["purchases"] = purchases;
      totalRecords += purchases.length;
      sources.push("analytics/purchases");
      fetchStatus["purchases"] = "ok";
    } catch (err) {
      logger.error("Failed to fetch purchase metrics:", err);
      if (isEntriesReadError(err) || isCanonicalFinanceError(err)) throw err;
      fetchStatus["purchases"] = "failed";
    }
  } else {
    fetchStatus["purchases"] = "skipped";
  }

  // Month-level financial conclusions consume the canonical report. Daily metrics do not
  // include a supplier credit issued on a day without a gross purchase, so summing them
  // would silently give a different Food Cost. A non-month period needs a source API for
  // that exact window and is deliberately left unavailable here.
  const needsFinancialMonth = plan.metrics.some((m) => m === "food_cost" || m === "food_cost_pct" || m === "food_cost_mtd" || m === "labor_cost" || m === "labor_pct" || m === "labor_cost_mtd" || m === "supplier_purchases") || plan.requiresForecast;
  if (needsFinancialMonth) {
    const month = start.slice(0, 7);
    const asOfMs = Date.parse(context.nowIso);
    const fullMonth = isFullMonthRequest({ start, end }, asOfDate);
    const proactive = context.userQuestion === "__proactive_scan__";
    if (fullMonth || proactive || plan.requiresForecast) {
      try {
        const nowMs = Date.parse(context.nowIso);
        if (!Number.isFinite(nowMs)) throw new Error("invalid_agent_instant");
        const financial = await withTimeout(
          loadAgentMonthSource(tenantId, context.bizId, nowMs, proactive || plan.requiresForecast ? undefined : month)
            .then(assembleAgentFinancialMonth),
          TIMEOUT_CRITICAL_MS,
          "loadAgentFinancialMonth"
        );
        metrics["financialMonth"] = financial;
        sources.push("finance/month-report");
        fetchStatus["financialMonth"] = "ok";
      } catch (err) {
        logger.error("Failed to fetch canonical financial month: unavailable");
        if (isEntriesReadError(err) || isCanonicalFinanceError(err)) throw err;
        fetchStatus["financialMonth"] = "failed";
      }
    } else {
      fetchStatus["financialMonth"] = "skipped";
    }
  }

  if (plan.metrics.includes("daily_revenue") || (plan.metrics as readonly string[]).includes("daily")) {
    try {
      const nowMs = Date.parse(context.nowIso);
      const months = revenueCalendarMonths({ start, end });
      metrics["revenueClosedDates"] = Number.isFinite(nowMs) && months !== null
        ? await loadAgentClosedDatesForMonths(tenantId, context.bizId, nowMs, months) : null;
    } catch {
      metrics["revenueClosedDates"] = null;
    }
  }

  // Compute quality scores
  const daily = (metrics["daily"] as Array<{ date: string }>) ?? [];
  const expectedDays = Math.max(1, daysBetweenSimple(start, actualEnd) + 1);
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
  } catch (err) {
    if (isEntriesReadError(err) || isCanonicalFinanceError(err)) throw err;   // corrupt storage is never "default freshness"
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
  daily: Array<{ date: string; revenue?: number; laborCost?: number; foodCost?: number; presence?: { revenue?: string; purchases?: string }; partial?: { revenue?: boolean; purchases?: boolean } }>,
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
    if (d.presence?.revenue === "present" && !d.partial?.revenue && d.revenue != null && d.revenue > 0 && d.laborCost != null && d.laborCost > d.revenue * 1.5) failures++;
    // Food cost > revenue is suspicious
    if (d.presence?.revenue === "present" && d.presence?.purchases === "present" && !d.partial?.revenue && !d.partial?.purchases && d.revenue != null && d.revenue > 0 && d.foodCost != null && d.foodCost >= 0 && d.foodCost > d.revenue * 1.2) failures++;
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
