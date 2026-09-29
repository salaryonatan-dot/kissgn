// Projection adapter (owner decision BD-3): projected month-end values are a separate
// object that never shares fields with Actual and is never merged into Actual MTD.
// Projected revenue is owned by the forecast engine (REV_FORECAST/*); this adapter only
// applies the Actual cost ratios and the full-month cost accrual to it.
import type { AmountString, Rat } from "../finance/decimal.js";
import { RAT_ZERO, decFromNumber, parseAmountString, ratAdd, ratFromDec, ratFromInt, ratMul, serializeRat } from "../finance/decimal.js";
import { datesInRange, monthBounds } from "../finance/businessDate.js";
import type { CostTimeline } from "./costTimeline.js";
import { accrueWindow, resolveTimeline, revenueLinkedCharges, versionForDay } from "./costTimeline.js";
import type { FinancialReport } from "./report.js";
import { contributionOf, operatingProfitOf, ratioOfTotals } from "./report.js";
import { FinanceContractError } from "../finance/types.js";

export const PROJECTION_FORMULA_VERSION = "MARJIN_PROJ/1";

export interface ForecastRevenueInput {
  readonly formulaId: string; // e.g. "REV_FORECAST/v1"
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
  readonly directLabor: AmountString | null;
  readonly otherExpense: AmountString | null;
  /** Authoritative salaried employer cost for the full month; null when the labor scope makes it not applicable (all_staff). */
  readonly salaried: AmountString | null;
  readonly fixed: AmountString;
  readonly operatingProfit: AmountString | null;
  readonly warnings: readonly string[];
}

function toRat(v: number | AmountString): Rat {
  return typeof v === "number" ? ratFromDec(decFromNumber(v)) : parseAmountString(v);
}

export function applyProjection(actual: FinancialReport, forecast: ForecastRevenueInput, timeline: CostTimeline): ProjectedFinancials {
  if (!forecast || typeof forecast.formulaId !== "string") throw new FinanceContractError("forecast_formula_required");
  if (forecast.month !== actual.window.month) throw new FinanceContractError("projection_month_mismatch");
  const warnings: string[] = [];
  const { first, last } = monthBounds(forecast.month);
  const monthDates = datesInRange(first, last);
  const accrual = accrueWindow(timeline, monthDates, new Map());
  const salariedApplies = actual.actual.labor.source.scope === "excludes_salaried";
  const salaried = salariedApplies ? accrual.salaried : RAT_ZERO;
  let fixed = ratAdd(accrual.fixedRegular, accrual.rentFixed);
  if (accrual.uncoveredDates.length) warnings.push("cost_config_absent");

  if (forecast.projectedRevenue === null) {
    warnings.push("forecast_insufficient");
    return {
      kind: "projected",
      formulaIds: { projection: PROJECTION_FORMULA_VERSION, forecast: forecast.formulaId, actualReport: actual.versions.fin },
      month: forecast.month, revenue: null, purchases: null, directLabor: null, otherExpense: null,
      salaried: salariedApplies ? serializeRat(salaried) : null, fixed: serializeRat(fixed), operatingProfit: null, warnings,
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
  const lRatio = actualComplete ? share(actual.actual.labor.enteredEmployerCost.value) : null;
  const oRatio = actualComplete ? (actual.actual.otherExpense.value === null ? RAT_ZERO : share(actual.actual.otherExpense.value)) : null;
  if (actualComplete && pRatio === null) warnings.push("purchases_ratio_unavailable");
  if (actualComplete && lRatio === null) warnings.push("labor_ratio_unavailable");
  const purchases = pRatio === null ? null : ratMul(pRatio, revenue);
  const labor = lRatio === null ? null : ratMul(lRatio, revenue);
  const other = oRatio === null ? null : ratMul(oRatio, revenue);
  if (salariedApplies && accrual.grossSalaryOnlyDates.length >= 1) warnings.push("salaried_employer_cost_missing");

  const v = versionForDay(resolveTimeline(timeline), last);
  if (v && (v.rent.mode === "pct" || v.royalty.mode === "pct")) {
    warnings.push("pct_rate_from_month_end_version");
    const charges = revenueLinkedCharges(v, revenue);
    fixed = ratAdd(fixed, ratAdd(charges.rentPct, charges.royaltyPct));
  }
  const salariedMissing = salariedApplies && accrual.grossSalaryOnlyDates.length >= 1;
  const profit = purchases === null || labor === null || other === null || accrual.uncoveredDates.length >= 1 || salariedMissing
    ? null
    : operatingProfitOf(contributionOf(revenue, purchases, labor, other), salaried, fixed);
  return {
    kind: "projected",
    formulaIds: { projection: PROJECTION_FORMULA_VERSION, forecast: forecast.formulaId, actualReport: actual.versions.fin },
    month: forecast.month,
    revenue: serializeRat(revenue),
    purchases: purchases === null ? null : serializeRat(purchases),
    directLabor: labor === null ? null : serializeRat(labor),
    otherExpense: other === null ? null : serializeRat(other),
    salaried: salariedApplies ? serializeRat(salaried) : null,
    fixed: serializeRat(fixed),
    operatingProfit: profit === null ? null : serializeRat(profit),
    warnings,
  };
}
