import { bizEntriesRef } from "../../firebase/refs.js";
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

function parseV(snapshot: any): RawEntry[] {
  const raw = snapshot.val();
  if (!raw) return [];
  // Data is wrapped in { _v: "JSON_STRING" }
  if (raw._v && typeof raw._v === "string") {
    try { return JSON.parse(raw._v); } catch { return []; }
  }
  // Fallback: might be direct array or object
  if (Array.isArray(raw)) return raw;
  if (typeof raw === "object") return Object.values(raw);
  return [];
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
  const entries = parseV(snapshot);

  return entries
    .filter((e) => e.date && e.date >= startDate && e.date <= endDate)
    .map(toDaily)
    .sort((a, b) => a.date.localeCompare(b.date));
}

export async function getLatestDailyDate(tenantId: string, bizId: string): Promise<string | null> {
  const ref = bizEntriesRef(tenantId, bizId);
  const snapshot = await ref.once("value");
  const entries = parseV(snapshot);
  if (entries.length === 0) return null;
  const sorted = entries.filter((e) => e.date).sort((a, b) => b.date.localeCompare(a.date));
  return sorted[0]?.date ?? null;
}
