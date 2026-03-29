import { getDailyMetrics } from "../repositories/analytics/dailyMetricsRepo.js";
import { avg } from "../utils/math.js";
import { todayIso, startOfMonthIso } from "../utils/dates.js";
import { logger } from "../utils/logging.js";

export interface ForecastResult {
  projectedRevenue: number;
  mtdRevenue: number;
  dailyAvg: number;
  daysElapsed: number;
  daysRemaining: number;
  confidence: number;
  method: string;
}

export async function forecastMonthEnd(
  tenantId: string,
  branchId?: string
): Promise<ForecastResult | null> {
  try {
    const tz = "Asia/Jerusalem";
    const today = todayIso(tz);
    const monthStart = startOfMonthIso(tz);

    const daily = await getDailyMetrics(tenantId, monthStart, today, branchId);
    if (daily.length < 5) return null; // not enough data for forecast

    const revenues = daily.map((d) => d.revenue);
    const mtdRevenue = revenues.reduce((a, b) => a + b, 0);
    const dailyAvg = avg(revenues);

    const dayOfMonth = new Date(today).getDate();
    const daysInMonth = new Date(
      new Date(today).getFullYear(),
      new Date(today).getMonth() + 1,
      0
    ).getDate();
    const daysRemaining = daysInMonth - dayOfMonth;

    const projectedRevenue = mtdRevenue + daysRemaining * dailyAvg;

    // Confidence based on how far into the month we are
    const confidence = Math.min(1, dayOfMonth / daysInMonth + 0.3);

    return {
      projectedRevenue,
      mtdRevenue,
      dailyAvg,
      daysElapsed: dayOfMonth,
      daysRemaining,
      confidence,
      method: "linear_daily_avg_projection",
    };
  } catch (err) {
    logger.error("Forecast failed:", err);
    return null;
  }
}
