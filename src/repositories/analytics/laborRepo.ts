import { bizEntriesRef } from "../../firebase/refs.js";
import { requireEntriesRows } from "../../../lib/analytics/entriesReader.js";
import type { LaborMetric } from "../../agent/types/analytics.js";

function num(v: unknown): number {
  return Number(v) || 0;
}

function sumObj(obj: Record<string, unknown> | undefined | null): number {
  if (!obj || typeof obj !== "object") return 0;
  return Object.values(obj).reduce((a: number, v) => a + num(v), 0);
}

// Server reader convergence: shared dual-mode reader; all rows; typed failure on a
// malformed node (never an empty labor dataset from corrupt storage).

export async function getLaborMetrics(
  tenantId: string,
  startDate: string,
  endDate: string,
  bizId: string,
  _branchId?: string
): Promise<LaborMetric[]> {
  const ref = bizEntriesRef(tenantId, bizId);
  const snapshot = await ref.once("value");
  const rows: any[] = requireEntriesRows(snapshot.val(), { tenantId, bizId, site: "laborRepo.getLaborMetrics" });

  return rows
    .filter((e: any) => e.date && e.date >= startDate && e.date <= endDate)
    .map((e: any) => {
      const revenue = num(e.sales) + num(e.deliveries) + num(e.other_income);
      const payroll = num(e.payroll);
      const hourly = sumObj(e.hourly_payroll);
      const totalCost = payroll + hourly;
      const hourlyCount = e.hourly_payroll ? Object.keys(e.hourly_payroll).length : 0;
      return {
        date: e.date,
        totalHours: 0, // not tracked in manual entries
        totalCost,
        employeeCount: hourlyCount + (payroll > 0 ? 1 : 0),
        costPerHour: 0,
        laborPctOfRevenue: revenue > 0 ? (totalCost / revenue) * 100 : 0,
      };
    })
    .sort((a: LaborMetric, b: LaborMetric) => a.date.localeCompare(b.date));
}
