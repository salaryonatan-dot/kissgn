// The ONLY binary-number conversion site of the Financial Core (MARJIN_DEC/1 §4.4).
// Legacy consumers keep receiving `number` fields; canonical truth stays in the exact
// strings. Rationals are rounded to 10 fractional digits (half away from zero) and then
// converted with the correctly-rounded ECMAScript string→double conversion, once.
import type { AmountString, Dec } from "../../finance/decimal.js";
import { decIsNegative, decIsZero, decToString, parseAmountString, ratFromDec, roundHalfAwayFromZero } from "../../finance/decimal.js";
import { ratioOfTotals } from "../report.js";
import type { CanonicalDay, DayPresence } from "../../finance/types.js";
import type { PurchaseBasisResolution } from "../../finance/purchaseBasis.js";
import type { LaborSourceInput } from "../../finance/labor.js";
import { validateLaborSource } from "../../finance/labor.js";

export function amountToNumber(a: AmountString | null): number | null {
  if (a === null) return null;
  const text = a.includes("/") ? decToString(roundHalfAwayFromZero(parseAmountString(a), 10)) : a;
  return Number(text);
}

export interface LegacyDailyMetric {
  date: string;
  revenue: number;
  laborCost: number;
  laborPct: number | null;
  foodCost: number;
  foodCostPct: number | null;
  transactionCount: number;
  avgTicket: number;
  presence: DayPresence;
  purchaseBasis: "net_of_vat" | "unresolved";
  purchaseBasisCompat: false;
  /** laborCost is the entered authoritative employer cost (MARJIN_LABOR/1) — never gross salary. */
  laborMeaning: "authoritative_employer_cost";
  laborSourceSystem: LaborSourceInput["sourceSystem"];
  laborIngestionMethod: LaborSourceInput["ingestionMethod"];
}

/**
 * DailyMetric-shaped adapter (Slice B1 consumer contract). Legacy amount fields cannot
 * express absence, so an absent metric is written as 0 FOR OLD READERS ONLY; the
 * `presence` block is authoritative. Ratios are null when not a value (never 0).
 */
export function toDailyMetric(day: CanonicalDay, basis: PurchaseBasisResolution, laborSource: LaborSourceInput): LegacyDailyMetric {
  const labor = validateLaborSource(laborSource);
  const val = (m: { presence: string; value: Dec | null }): Dec | null => (m.presence === "present" ? m.value : null);
  const rev = val(day.revenue);
  const lab = val(day.directLabor);
  const food = val(day.purchases);
  const pct = (num: Dec | null): number | null => {
    if (num === null || rev === null) return null;
    const r = ratioOfTotals(ratFromDec(num), ratFromDec(rev));
    return r.state === "value" ? amountToNumber(r.value) : null;
  };
  return {
    date: day.date,
    revenue: rev === null ? 0 : Number(decToString(rev)),
    laborCost: lab === null ? 0 : Number(decToString(lab)),
    laborPct: pct(lab),
    foodCost: food === null ? 0 : Number(decToString(food)),
    foodCostPct: basis.kind === "unresolved" ? null : pct(food),
    transactionCount: 0,
    avgTicket: 0,
    presence: day.presence,
    purchaseBasis: basis.kind,
    purchaseBasisCompat: false,
    laborMeaning: labor.meaning,
    laborSourceSystem: labor.sourceSystem,
    laborIngestionMethod: labor.ingestionMethod,
  };
}

export interface LegacyForecastDay {
  date: string;
  total: number;
  had_entry: boolean;
  has_sales: boolean;
  is_exception: boolean;
}

/**
 * REV_FORECAST input day. Missing revenue ⇒ null (the day is omitted, i.e. missing to the
 * engine). A recorded 0 is an entered day (had_entry true); `has_sales` is the engine's
 * descriptive closed-day attribute (revenue > 0), never a presence test.
 */
export function toForecastDay(day: CanonicalDay): LegacyForecastDay | null {
  if (day.revenue.presence !== "present" || day.revenue.value === null) return null;
  const v = day.revenue.value;
  return {
    date: day.date,
    total: Number(decToString(v)),
    had_entry: true,
    has_sales: !decIsZero(v) && !decIsNegative(v),
    is_exception: day.exception.isException,
  };
}
