import { RAT_ZERO, decFromNumber, parseAmountString, ratAdd, ratFromDec, ratFromInt, ratMul, serializeRat } from "../finance/decimal.js";
import { addDays, datesInRange, monthBounds } from "../finance/businessDate.js";
import { accrueWindow, resolveTimeline, revenueLinkedCharges, versionForDay } from "./costTimeline.js";
import { contributionOf, operatingProfitOf, ratioOfTotals } from "./report.js";
import { FinanceContractError } from "../finance/types.js";
export const PROJECTION_FORMULA_VERSION = "MARJIN_PROJ/2";
function toRat(v) {
    return typeof v === "number" ? ratFromDec(decFromNumber(v)) : parseAmountString(v);
}
const GLOBAL_CONFIG_CODES = ["invalid_global_amount", "missing_global_amount"];
const FIXED_CONFIG_CODES = ["invalid_fixed_amount", "invalid_rate", "missing_fixed_amount", "missing_rate"];
export function applyProjection(actual, forecast, timeline) {
    if (!forecast || typeof forecast.formulaId !== "string")
        throw new FinanceContractError("forecast_formula_required");
    if (forecast.month !== actual.window.month)
        throw new FinanceContractError("projection_month_mismatch");
    const warnings = [];
    const { first, last } = monthBounds(forecast.month);
    const monthDates = datesInRange(first, last);
    const accrual = accrueWindow(timeline, monthDates, new Map());
    const globalConfigBad = (timeline.flags || []).some((f) => GLOBAL_CONFIG_CODES.includes(f.code));
    const globalKnown = !globalConfigBad && accrual.uncoveredDates.length < 1;
    if (!globalKnown)
        warnings.push("global_employer_cost_unavailable");
    const fixedKnown = !(timeline.flags || []).some((f) => FIXED_CONFIG_CODES.includes(f.code)) && accrual.uncoveredDates.length < 1;
    if (!fixedKnown)
        warnings.push("fixed_cost_unavailable");
    let fixed = ratAdd(accrual.fixedRegular, accrual.rentFixed);
    if (accrual.uncoveredDates.length)
        warnings.push("cost_config_absent");
    // Dates after the Actual window through month end (current day onward), cost context only.
    const afterFrom = actual.window.completedThrough === null ? first : addDays(actual.window.completedThrough, 1);
    let afterActual = null;
    if (afterFrom <= last && afterFrom >= first) {
        const after = accrueWindow(timeline, datesInRange(afterFrom, last), new Map());
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
    const amt = (a) => (a === null ? null : parseAmountString(a));
    const actualRevenue = amt(actual.actual.revenue.value);
    const share = (num) => {
        const r = ratioOfTotals(amt(num), actualRevenue, ratFromInt(1));
        return r.state === "value" ? parseAmountString(r.value) : null;
    };
    // Ratios are taken only from a COMPLETE Actual (TI-18); an incomplete Actual gives no
    // projected cost or profit rather than extrapolating a partial subtotal.
    const actualComplete = actual.actual.operatingProfit.state === "complete";
    if (!actualComplete)
        warnings.push("actual_components_incomplete");
    const pRatio = actualComplete ? share(actual.actual.purchases.value) : null;
    const lRatio = actualComplete ? share(actual.actual.labor.hourlyEmployerCost.value) : null;
    const oRatio = actualComplete ? (actual.actual.otherExpense.value === null ? RAT_ZERO : share(actual.actual.otherExpense.value)) : null;
    if (actualComplete && pRatio === null)
        warnings.push("purchases_ratio_unavailable");
    if (actualComplete && lRatio === null)
        warnings.push("labor_ratio_unavailable");
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
