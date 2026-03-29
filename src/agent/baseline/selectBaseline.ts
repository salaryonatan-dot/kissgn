import type { MetricsPlan, BaselineResult, FetchedData } from "../types/agent.js";
import type { AgentContext } from "../types/agent.js";
import { dayOfWeek } from "../../utils/dates.js";
import { avg, stdDev } from "../../utils/math.js";

export function selectBaseline(
  plan: MetricsPlan,
  fetched: FetchedData,
  context: AgentContext
): BaselineResult {
  const dailyData = (fetched.metrics["daily"] as Array<{ date: string; revenue: number }>) ?? [];

  if (dailyData.length < 7) {
    return {
      baselineType: "none",
      sampleSize: dailyData.length,
      valid: false,
      reason: "אין מספיק נתונים היסטוריים",
    };
  }

  // Decide baseline type based on intent and question context
  const intent = plan.intent;

  // For trend on specific day of week
  if (intent === "trend_analysis" && plan.dimensions.includes("day_of_week")) {
    return buildDayOfWeekBaseline(dailyData, context);
  }

  // For anomaly detection — use rolling 4-week average
  if (intent === "anomaly_detection") {
    return buildRollingBaseline(dailyData, 28);
  }

  // For forecast — use rolling 4-week
  if (intent === "forecast_request") {
    return buildRollingBaseline(dailyData, 28);
  }

  // For comparison — period over period
  if (intent === "comparison_query") {
    return buildPeriodOverPeriodBaseline(dailyData);
  }

  // Default: rolling 4 weeks
  return buildRollingBaseline(dailyData, 28);
}

function buildDayOfWeekBaseline(
  data: Array<{ date: string; revenue: number }>,
  context: AgentContext
): BaselineResult {
  const today = context.nowIso || new Date().toISOString().slice(0, 10);
  const targetDow = dayOfWeek(today);

  const sameDayValues = data
    .filter((d) => dayOfWeek(d.date) === targetDow)
    .map((d) => d.revenue);

  if (sameDayValues.length < 3) {
    return {
      baselineType: "day_of_week",
      sampleSize: sameDayValues.length,
      valid: false,
      reason: `רק ${sameDayValues.length} דגימות ליום זה — לא מספיק`,
    };
  }

  return {
    baselineType: "day_of_week",
    value: avg(sameDayValues),
    values: sameDayValues,
    sampleSize: sameDayValues.length,
    valid: true,
  };
}

function buildRollingBaseline(
  data: Array<{ date: string; revenue: number }>,
  windowDays: number
): BaselineResult {
  const sorted = [...data].sort((a, b) => a.date.localeCompare(b.date));
  const window = sorted.slice(-windowDays);
  const values = window.map((d) => d.revenue);

  if (values.length < 7) {
    return {
      baselineType: windowDays <= 28 ? "rolling_4_weeks" : "rolling_8_weeks",
      sampleSize: values.length,
      valid: false,
      reason: "אין מספיק נתונים בחלון הזמן",
    };
  }

  return {
    baselineType: windowDays <= 28 ? "rolling_4_weeks" : "rolling_8_weeks",
    value: avg(values),
    values,
    sampleSize: values.length,
    valid: true,
  };
}

function buildPeriodOverPeriodBaseline(
  data: Array<{ date: string; revenue: number }>
): BaselineResult {
  const sorted = [...data].sort((a, b) => a.date.localeCompare(b.date));
  const mid = Math.floor(sorted.length / 2);
  const previousPeriod = sorted.slice(0, mid);
  const values = previousPeriod.map((d) => d.revenue);

  if (values.length < 7) {
    return {
      baselineType: "period_over_period",
      sampleSize: values.length,
      valid: false,
      reason: "תקופת ההשוואה קצרה מדי",
    };
  }

  return {
    baselineType: "period_over_period",
    value: avg(values),
    values,
    sampleSize: values.length,
    valid: true,
  };
}
