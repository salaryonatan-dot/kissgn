import type { AgentContext, AgentIntent, MetricsPlan, TimeRange, MetricKey, DimensionKey } from "../types/agent.js";
import { todayIso, daysAgoIso, startOfMonthIso } from "../../utils/dates.js";

export function buildMetricsPlan(
  intent: AgentIntent,
  question: string,
  context: AgentContext
): MetricsPlan {
  const tz = context.timezone || "Asia/Jerusalem";
  const base: MetricsPlan = {
    intent,
    metrics: [],
    dimensions: [],
    filters: {},
    timeRange: defaultTimeRange(7, tz),
    requiresBaseline: false,
    requiresComparison: false,
    requiresAnomalyDetection: false,
    requiresForecast: false,
    requiresMemory: false,
    branchScope: context.branchId ? "single" : "all",
    preferredSources: ["processed_analytics"],
  };

  if (context.branchId) {
    base.filters = { branchId: context.branchId };
  }

  switch (intent) {
    case "direct_metric_query":
    case "direct_aggregation_query":
      return planDirectMetric(base, question, tz);
    case "comparison_query":
      return planComparison(base, question, tz);
    case "anomaly_detection":
      return planAnomaly(base, question, tz);
    case "trend_analysis":
      return planTrend(base, question, tz);
    case "forecast_request":
      return planForecast(base, question, tz);
    case "strategic_question":
    case "recommendation_request":
      return planStrategic(base, question, tz);
    default:
      return base;
  }
}

function planDirectMetric(base: MetricsPlan, q: string, tz: string): MetricsPlan {
  const metrics: MetricKey[] = [];
  const dimensions: DimensionKey[] = ["date"];

  if (/מוצר|הכי נמכר|product/i.test(q)) {
    metrics.push("product_quantity", "product_revenue");
    dimensions.push("product_name");
  } else if (/כוח אדם|עובדים|labor/i.test(q)) {
    metrics.push("labor_cost", "labor_pct");
  } else if (/עלות מזון|food/i.test(q)) {
    metrics.push("food_cost", "food_cost_pct");
  } else if (/ספק|רכישות|purchase/i.test(q)) {
    metrics.push("supplier_purchases");
    dimensions.push("supplier_name");
  } else {
    metrics.push("daily_revenue");
  }

  return {
    ...base,
    metrics,
    dimensions,
    timeRange: inferTimeRange(q, tz, 7),
  };
}

function planComparison(base: MetricsPlan, q: string, tz: string): MetricsPlan {
  return {
    ...base,
    metrics: ["daily_revenue", "labor_cost", "labor_pct", "food_cost_pct"],
    dimensions: ["date", "day_of_week"],
    timeRange: inferTimeRange(q, tz, 28),
    requiresBaseline: true,
    requiresComparison: true,
    requiresMemory: true,
  };
}

function planAnomaly(base: MetricsPlan, q: string, tz: string): MetricsPlan {
  const metrics: MetricKey[] = ["daily_revenue", "labor_cost", "labor_pct"];

  if (/כוח אדם|labor/i.test(q)) {
    metrics.push("hourly_revenue");
  }

  return {
    ...base,
    metrics,
    dimensions: ["date", "hour", "day_of_week"],
    timeRange: inferTimeRange(q, tz, 28),
    requiresBaseline: true,
    requiresComparison: true,
    requiresAnomalyDetection: true,
    requiresMemory: true,
  };
}

function planTrend(base: MetricsPlan, q: string, tz: string): MetricsPlan {
  return {
    ...base,
    metrics: ["daily_revenue", "hourly_revenue", "labor_pct"],
    dimensions: ["date", "day_of_week", "hour"],
    timeRange: inferTimeRange(q, tz, 56),
    requiresBaseline: true,
    requiresComparison: true,
    requiresMemory: true,
  };
}

function planForecast(base: MetricsPlan, q: string, tz: string): MetricsPlan {
  return {
    ...base,
    metrics: ["daily_revenue_mtd", "labor_cost_mtd", "food_cost_mtd"],
    dimensions: ["date"],
    timeRange: {
      start: startOfMonthIso(tz),
      end: todayIso(tz),
    },
    requiresBaseline: true,
    requiresComparison: true,
    requiresForecast: true,
    requiresMemory: true,
  };
}

function planStrategic(base: MetricsPlan, q: string, tz: string): MetricsPlan {
  return {
    ...base,
    metrics: ["daily_revenue", "hourly_revenue", "labor_pct", "food_cost_pct", "product_mix"],
    dimensions: ["date", "hour", "product_name", "day_of_week"],
    timeRange: inferTimeRange(q, tz, 56),
    requiresBaseline: true,
    requiresComparison: true,
    requiresAnomalyDetection: true,
    requiresMemory: true,
    preferredSources: ["processed_analytics", "raw_data"],
  };
}

function inferTimeRange(q: string, tz: string, fallbackDays: number): TimeRange {
  if (/היום/i.test(q)) {
    const today = todayIso(tz);
    return { start: today, end: today };
  }
  if (/אתמול/i.test(q)) {
    const yesterday = daysAgoIso(1, tz);
    return { start: yesterday, end: yesterday };
  }
  if (/השבוע/i.test(q)) {
    return { start: daysAgoIso(6, tz), end: todayIso(tz) };
  }
  if (/שבוע שעבר/i.test(q)) {
    return { start: daysAgoIso(13, tz), end: daysAgoIso(7, tz) };
  }
  if (/החודש/i.test(q)) {
    return { start: startOfMonthIso(tz), end: todayIso(tz) };
  }
  if (/חודש שעבר/i.test(q)) {
    const now = new Date();
    const prevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const prevMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0);
    return {
      start: prevMonth.toLocaleDateString("en-CA", { timeZone: tz }),
      end: prevMonthEnd.toLocaleDateString("en-CA", { timeZone: tz }),
    };
  }

  return defaultTimeRange(fallbackDays, tz);
}

function defaultTimeRange(days: number, tz: string): TimeRange {
  return {
    start: daysAgoIso(days, tz),
    end: todayIso(tz),
  };
}
