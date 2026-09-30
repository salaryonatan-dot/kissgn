// MARJIN_PROJ/2 — projection adapter (owner decision BD-3; FINAL owner contract 2026-09-29).
// Projected month-end values are a separate object that never shares fields with Actual and
// is never merged into Actual MTD. Projected revenue is owned by the forecast engine
// (REV_FORECAST/*); this adapter applies the Actual cost ratios of totals to it and adds the
// FULL month ENTITLEMENT of global employer cost and fixed cost (MARJIN_LABOR/3: placed on
// eligible dates; the month total is preserved whatever the closures). The days after the
// Actual window (the current day and later) are reported separately in `afterActual`: they
// belong to projection context only and never change Actual. Only the report's COMPLETED
// closures change placements — a recorded future closure changes the forecast REVENUE (the
// forecast engine gives it zero) but not the cost denominator (CDA-04 / CDA-10).
import type { AmountString, Rat } from "../finance/decimal.js";
import { RAT_ZERO, decFromNumber, parseAmountString, ratAdd, ratFromDec, ratFromInt, ratMul, serializeRat } from "../finance/decimal.js";
import { addDays, datesInRange, monthBounds } from "../finance/businessDate.js";
import type { BusinessDate } from "../finance/types.js";
import type { CostTimeline } from "./costTimeline.js";
import { accrueWindow, resolveTimeline, revenueLinkedCharges, versionForDay } from "./costTimeline.js";
import type { FinancialReport } from "./report.js";
import { contributionOf, operatingProfitOf, ratioOfTotals } from "./report.js";
import { FinanceContractError } from "../finance/types.js";

export const PROJECTION_FORMULA_VERSION = "MARJIN_PROJ/2";

export interface ForecastRevenueInput {
  readonly formulaId: string; // e.g. "REV_FORECAST/v2" (the product forecast)
  readonly month: string;
  /** Projected month-end revenue from the forecast engine (number or canonical amount string); null ⇒ insufficient history. */
  readonly projectedRevenue: number | AmountString | null;
}

export interface ProjectedFinancials {
  readonly kind: "projected";
  readonly formulaIds: { readonly projection: string; readonly forecast: string; readonly actualReport: string };
  readonly month: string;
  readonly revenue: AmountString | null;
  readonly purchases: AmountString | null;
  readonly hourlyLabor: AmountString | null;
  readonly otherExpense: AmountString | null;
  /** Global employer cost for the FULL calendar month; null when global configuration is missing/invalid. */
  readonly globalEmployerCost: AmountString | null;
  /** Fixed regular + fixed rent for the full month, plus percentage charges on projected revenue; null when fixed configuration is missing/invalid/uncovered. */
  readonly fixed: AmountString | null;
  /** Calendar-day global and fixed cost of the dates AFTER the Actual window (current day onward). Never part of Actual. */
  readonly afterActual: {
    readonly from: BusinessDate; readonly to: BusinessDate; readonly days: number;
    readonly globalEmployerCost: AmountString | null; readonly fixedRegularAndRent: AmountString | null;
  } | null;
  readonly operatingProfit: AmountString | null;
  readonly warnings: readonly string[];
}

function toRat(v: number | AmountString): Rat {
  return typeof v === "number" ? ratFromDec(decFromNumber(v)) : parseAmountString(v);
}

const GLOBAL_CONFIG_CODES: readonly string[] = ["invalid_global_amount", "missing_global_amount"];
const FIXED_CONFIG_CODES: readonly string[] = ["invalid_fixed_amount", "invalid_rate", "missing_fixed_amount", "missing_rate"];

export function applyProjection(actual: FinancialReport, forecast: ForecastRevenueInput, timeline: CostTimeline): ProjectedFinancials {
  if (!forecast || typeof forecast.formulaId !== "string") throw new FinanceContractError("forecast_formula_required");
  if (forecast.month !== actual.window.month) throw new FinanceContractError("projection_month_mismatch");
  const warnings: string[] = [];
  const { first, last } = monthBounds(forecast.month);
  const monthDates = datesInRange(first, last);
  // The completed closures of the month are exactly the report's closed Actual dates.
  const allocation = { asOfBusinessDate: actual.window.asOfBusinessDate, closedDates: actual.operatingCalendar.closedDates };
  const accrual = accrueWindow(timeline, monthDates, new Map(), allocation);
  const globalConfigBad = (timeline.flags || []).some((f) => GLOBAL_CONFIG_CODES.includes(f.code));
  const globalKnown = !globalConfigBad && accrual.uncoveredDates.length < 1;
  if (!globalKnown) warnings.push("global_employer_cost_unavailable");
  const fixedKnown = !(timeline.flags || []).some((f) => FIXED_CONFIG_CODES.includes(f.code)) && accrual.uncoveredDates.length < 1;
  if (!fixedKnown) warnings.push("fixed_cost_unavailable");
  let fixed = ratAdd(accrual.fixedRegular, accrual.rentFixed);
  if (accrual.uncoveredDates.length) warnings.push("cost_config_absent");

  // Dates after the Actual window through month end (current day onward), cost context only.
  const afterFrom = actual.window.completedThrough === null ? first : addDays(actual.window.completedThrough, 1);
  let afterActual: ProjectedFinancials["afterActual"] = null;
  if (afterFrom <= last && afterFrom >= first) {
    const after = accrueWindow(timeline, datesInRange(afterFrom, last), new Map(), allocation);
    afterActual = {
      from: afterFrom, to: last, days: datesInRange(afterFrom, last).length,
      globalEmployerCost: globalKnown ? serializeRat(after.global) : null,
      fixedRegularAndRent: fixedKnown ? serializeRat(ratAdd(after.fixedRegular, after.rentFixed)) : null,
    };
  }
  const globalOut = globalKnown ? serializeRat(accrual.global) : null;

  if (forecast.projectedRevenue === null) {
    warnings.push("forecast_insufficient");
    return {
      kind: "projected",
      formulaIds: { projection: PROJECTION_FORMULA_VERSION, forecast: forecast.formulaId, actualReport: actual.versions.fin },
      month: forecast.month, revenue: null, purchases: null, hourlyLabor: null, otherExpense: null,
      globalEmployerCost: globalOut, fixed: fixedKnown ? serializeRat(fixed) : null, afterActual, operatingProfit: null, warnings,
    };
  }
  const revenue = toRat(forecast.projectedRevenue);
  // Actual ratios of totals (same function the report uses), applied to projected revenue.
  const amt = (a: string | null) => (a === null ? null : parseAmountString(a));
  const actualRevenue = amt(actual.actual.revenue.value);
  const share = (num: string | null): Rat | null => {
    const r = ratioOfTotals(amt(num), actualRevenue, ratFromInt(1));
    return r.state === "value" ? parseAmountString(r.value) : null;
  };
  // Ratios are taken only from a COMPLETE Actual (TI-18); an incomplete Actual gives no
  // projected cost or profit rather than extrapolating a partial subtotal.
  const actualComplete = actual.actual.operatingProfit.state === "complete";
  if (!actualComplete) warnings.push("actual_components_incomplete");
  const pRatio = actualComplete ? share(actual.actual.purchases.value) : null;
  const lRatio = actualComplete ? share(actual.actual.labor.hourlyEmployerCost.value) : null;
  const oRatio = actualComplete ? (actual.actual.otherExpense.value === null ? RAT_ZERO : share(actual.actual.otherExpense.value)) : null;
  if (actualComplete && pRatio === null) warnings.push("purchases_ratio_unavailable");
  if (actualComplete && lRatio === null) warnings.push("labor_ratio_unavailable");
  const purchases = pRatio === null ? null : ratMul(pRatio, revenue);
  const labor = lRatio === null ? null : ratMul(lRatio, revenue);
  const other = oRatio === null ? null : ratMul(oRatio, revenue);

  const v = versionForDay(resolveTimeline(timeline), last);
  if (v && (v.rent.mode === "pct" || v.royalty.mode === "pct")) {
    warnings.push("pct_rate_from_month_end_version");
    const charges = revenueLinkedCharges(v, revenue);
    fixed = ratAdd(fixed, ratAdd(charges.rentPct, charges.royaltyPct));
  }
  const profit = purchases === null || labor === null || other === null || !fixedKnown || !globalKnown
    ? null
    : operatingProfitOf(contributionOf(revenue, purchases, labor, other), accrual.global, fixed);
  return {
    kind: "projected",
    formulaIds: { projection: PROJECTION_FORMULA_VERSION, forecast: forecast.formulaId, actualReport: actual.versions.fin },
    month: forecast.month,
    revenue: serializeRat(revenue),
    purchases: purchases === null ? null : serializeRat(purchases),
    hourlyLabor: labor === null ? null : serializeRat(labor),
    otherExpense: other === null ? null : serializeRat(other),
    globalEmployerCost: globalOut,
    fixed: fixedKnown ? serializeRat(fixed) : null,
    afterActual,
    operatingProfit: profit === null ? null : serializeRat(profit),
    warnings,
  };
}
