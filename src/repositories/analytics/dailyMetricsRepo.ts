import { bizEntriesRef } from "../../firebase/refs.js";
import { requireEntriesRows } from "../../../lib/analytics/entriesReader.js";
import type { DailyMetric } from "../../agent/types/analytics.js";

interface RawEntry {
  date: string;
  sales?: number | string;
  deliveries?: number | string;
  other_income?: number | string;
  food_cost?: number | string;
  payroll?: number | string;
  hourly_payroll?: Record<string, number | string>;
  supplier_payments?: Record<string, number | string>;
}

// Server reader convergence: the shared dual-mode reader (legacy `_v` | Storage V2
// rows | absent). Every stored row is returned (duplicate business dates included —
// this repository aggregates, it never picks one row per date); a malformed node
// throws a typed EntriesStorageError instead of silently yielding an empty dataset.
function readRows(snapshot: any, tenantId: string, bizId: string, site: string): RawEntry[] {
  return requireEntriesRows(snapshot.val(), { tenantId, bizId, site }) as unknown as RawEntry[];
}

function num(v: unknown): number {
  return Number(v) || 0;
}

function sumObj(obj: Record<string, unknown> | undefined | null): number {
  if (!obj || typeof obj !== "object") return 0;
  return Object.values(obj).reduce((a: number, v) => a + num(v), 0);
}

function toDaily(e: RawEntry): DailyMetric {
  const revenue = num(e.sales) + num(e.deliveries) + num(e.other_income);
  const foodCost = sumObj(e.supplier_payments) || num(e.food_cost);
  const laborCost = num(e.payroll) + sumObj(e.hourly_payroll);
  return {
    date: e.date,
    revenue,
    laborCost,
    laborPct: revenue > 0 ? (laborCost / revenue) * 100 : 0,
    foodCost,
    foodCostPct: revenue > 0 ? (foodCost / revenue) * 100 : 0,
    transactionCount: 0, // not available in manual entries
    avgTicket: 0,
  };
}

export async function getDailyMetrics(
  tenantId: string,
  startDate: string,
  endDate: string,
  bizId: string,
  _branchId?: string
): Promise<DailyMetric[]> {
  const ref = bizEntriesRef(tenantId, bizId);
  const snapshot = await ref.once("value");
  const rows = readRows(snapshot, tenantId, bizId, "dailyMetricsRepo.getDailyMetrics");

  return rows
    .filter((e) => e.date && e.date >= startDate && e.date <= endDate)
    .map(toDaily)
    .sort((a, b) => a.date.localeCompare(b.date));
}

export async function getLatestDailyDate(tenantId: string, bizId: string): Promise<string | null> {
  const ref = bizEntriesRef(tenantId, bizId);
  const snapshot = await ref.once("value");
  const rows = readRows(snapshot, tenantId, bizId, "dailyMetricsRepo.getLatestDailyDate");
  if (rows.length === 0) return null;
  const sorted = rows.filter((e) => e.date).sort((a, b) => b.date.localeCompare(a.date));
  return sorted[0]?.date ?? null;
}
