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

// ── Server readers R2 — DETERMINISTIC DECIMAL ACCUMULATION (CTO D-R2-1 / D-R2-2) ──
// The per-row components above are the semantic operands and are NOT recomputed. When
// more than one row carries a business date, their existing Number values are summed
// EXACTLY in decimal: each finite operand is taken as its canonical round-trip decimal
// (`Number.prototype.toString`), split into a BigInt coefficient and a decimal scale,
// aligned by powers of ten and added as integers; the exact total is converted to a
// Number exactly once. Binary intermediate addition — whose rounding and whose
// intermediate overflow both depend on operand order — never happens, so the aggregate
// is identical for every physical row order and every UUID assignment. A single row
// passes its component through unchanged. No rounding, clamp or monetary limit is
// introduced: the one final Number conversion is the existing output representation
// (a final exact total beyond the finite range still becomes ±Infinity, as before).
// Non-finite operands keep their category semantics: any NaN → NaN; +∞ with −∞ → NaN;
// otherwise the surviving infinity.
const CANONICAL_DECIMAL = /^(-?)([0-9]+)(?:\.([0-9]+))?(?:e([+-]?[0-9]+))?$/;

function canonicalDecimal(x: number): { coefficient: bigint; scale: number } {
  const m = CANONICAL_DECIMAL.exec(x.toString());
  if (!m) throw new Error("non_canonical_number:" + String(x));
  const digits = m[2] + (m[3] || "");
  let coefficient = BigInt(digits);
  if (m[1] === "-") coefficient = -coefficient;
  let scale = (m[3] || "").length - (m[4] ? parseInt(m[4], 10) : 0);
  if (scale < 0) {
    coefficient *= 10n ** BigInt(-scale);
    scale = 0;
  }
  return { coefficient, scale };
}

function decimalSum(values: number[]): number {
  if (values.length === 1) return values[0];
  let posInf = false;
  let negInf = false;
  for (const v of values) {
    if (Number.isNaN(v)) return NaN;
    if (v === Infinity) posInf = true;
    else if (v === -Infinity) negInf = true;
  }
  if (posInf && negInf) return NaN;
  if (posInf) return Infinity;
  if (negInf) return -Infinity;
  let total = 0n;
  let scale = 0;
  for (const v of values) {
    const d = canonicalDecimal(v);
    if (d.scale > scale) {
      total *= 10n ** BigInt(d.scale - scale);
      scale = d.scale;
    }
    const c = d.scale < scale ? d.coefficient * 10n ** BigInt(scale - d.scale) : d.coefficient;
    total += c;
  }
  if (total === 0n) return 0;
  return Number(total.toString() + "e-" + String(scale));
}

// One DailyMetric per business date. Additive components are summed over every row
// of the date exactly in decimal (above); the ratios are derived from the final sums.
// Insertion order of `rows` is irrelevant: the exact sums are order-independent and
// the result is sorted by date.
function aggregateByDate(rows: RawEntry[]): DailyMetric[] {
  const byDate = new Map<string, { revenue: number[]; laborCost: number[]; foodCost: number[] }>();
  for (const e of rows) {
    const c = rowComponents(e);
    const acc = byDate.get(e.date);
    if (acc) {
      acc.revenue.push(c.revenue);
      acc.laborCost.push(c.laborCost);
      acc.foodCost.push(c.foodCost);
    } else {
      byDate.set(e.date, { revenue: [c.revenue], laborCost: [c.laborCost], foodCost: [c.foodCost] });
    }
  }
  return [...byDate.entries()]
    .map(([date, parts]) => {
      const revenue = decimalSum(parts.revenue);
      const laborCost = decimalSum(parts.laborCost);
      const foodCost = decimalSum(parts.foodCost);
      return {
        date,
        revenue,
        laborCost,
        laborPct: revenue > 0 ? (laborCost / revenue) * 100 : 0,
        foodCost,
        foodCostPct: revenue > 0 ? (foodCost / revenue) * 100 : 0,
        transactionCount: 0, // not available in manual entries
        avgTicket: 0,
      };
    })
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
