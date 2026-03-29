import type { HourlyMetric } from "../../agent/types/analytics.js";
import { dailyMetricsRef } from "../../firebase/refs.js";

// Hourly metrics come from POS integration (Beecomm builder).
// Path: tenants/{tenantId}/analytics/daily/{branchId}/{date} → hourly field
// Falls back to empty if builder hasn't run.

export async function getHourlyMetrics(
  tenantId: string,
  startDate: string,
  endDate: string,
  _branchId?: string
): Promise<HourlyMetric[]> {
  // Try to read from builder analytics
  try {
    const branchId = _branchId || "main";
    const ref = dailyMetricsRef(tenantId).child(branchId);
    const snapshot = await ref
      .orderByKey()
      .startAt(startDate)
      .endAt(endDate)
      .once("value");

    const raw = snapshot.val();
    if (!raw) return [];

    const results: HourlyMetric[] = [];
    for (const [date, doc] of Object.entries(raw) as [string, any][]) {
      if (doc.hourly && typeof doc.hourly === "object") {
        for (const [hour, data] of Object.entries(doc.hourly) as [string, any][]) {
          results.push({
            date,
            hour: Number(hour),
            revenue: Number(data.revenue) || 0,
            laborCost: 0,
            transactionCount: Number(data.tickets) || 0,
          });
        }
      }
    }
    return results;
  } catch {
    return [];
  }
}
