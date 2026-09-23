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
//
// CONTRACT (server readers R1, CTO D1): this repository is the per-BUSINESS-DATE daily
// series for every downstream analytical consumer (agent analyses, proactive
// detectors, baseline selection, forecast). It returns EXACTLY ONE DailyMetric per
// business date. When more than one immutable row carries the same date, every row
// contributes to that date's additive totals (revenue, laborCost, foodCost,
// transactionCount) and the ratios are recomputed from the totals — no row is chosen
// as "the" row for the date, so neither the legacy array position, a UUID, the
// `(date, id)` sort of the reader nor RTDB enumeration order can influence any
// downstream result.
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

// Per-row additive components, derived with the UNCHANGED per-row financial formulas.
function rowComponents(e: RawEntry): { revenue: number; laborCost: number; foodCost: number } {
  const revenue = num(e.sales) + num(e.deliveries) + num(e.other_income);
  const foodCost = sumObj(e.supplier_payments) || num(e.food_cost);
  const laborCost = num(e.payroll) + sumObj(e.hourly_payroll);
  return { revenue, laborCost, foodCost };
}

// One DailyMetric per business date. Additive components are summed over every row
// of the date; the ratios are derived from the sums. Insertion order of `rows` is
// irrelevant: sums are order-independent and the result is sorted by date.
function aggregateByDate(rows: RawEntry[]): DailyMetric[] {
  const byDate = new Map<string, { revenue: number; laborCost: number; foodCost: number }>();
  for (const e of rows) {
    const c = rowComponents(e);
    const acc = byDate.get(e.date);
    if (acc) {
      acc.revenue += c.revenue;
      acc.laborCost += c.laborCost;
      acc.foodCost += c.foodCost;
    } else {
      byDate.set(e.date, { revenue: c.revenue, laborCost: c.laborCost, foodCost: c.foodCost });
    }
  }
  return [...byDate.entries()]
    .map(([date, t]) => ({
      date,
      revenue: t.revenue,
      laborCost: t.laborCost,
      laborPct: t.revenue > 0 ? (t.laborCost / t.revenue) * 100 : 0,
      foodCost: t.foodCost,
      foodCostPct: t.revenue > 0 ? (t.foodCost / t.revenue) * 100 : 0,
      transactionCount: 0, // not available in manual entries
      avgTicket: 0,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
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

  return aggregateByDate(
    rows.filter((e) => typeof e.date === "string" && e.date >= startDate && e.date <= endDate)
  );
}

export async function getLatestDailyDate(tenantId: string, bizId: string): Promise<string | null> {
  const ref = bizEntriesRef(tenantId, bizId);
  const snapshot = await ref.once("value");
  const rows = readRows(snapshot, tenantId, bizId, "dailyMetricsRepo.getLatestDailyDate");
  if (rows.length === 0) return null;
  const sorted = rows.filter((e) => e.date).sort((a, b) => b.date.localeCompare(a.date));
  return sorted[0]?.date ?? null;
}
