import { DECIMAL_CONTRACT_VERSION, RAT_ZERO, parseAmountString, decAdd, ratAdd, ratDiv, ratFromDec, ratFromInt, ratIsNegative, ratIsZero, ratMul, ratSub, serializeDec, serializeRat, } from "../finance/decimal.js";
import { BUSINESS_TIMEZONE, isBusinessDate, monthBounds, datesInRange } from "../finance/businessDate.js";
import { NORMALIZATION_VERSION, sortFlags } from "../finance/normalize.js";
import { PURCHASE_BASIS_CONTRACT_VERSION, resolvePurchaseBasis, validatePurchaseBasisInput } from "../finance/purchaseBasis.js";
import { LABOR_CONTRACT_VERSION, validateLaborSource } from "../finance/labor.js";
import { FinanceContractError } from "../finance/types.js";
import { accrueWindow } from "./costTimeline.js";
export const FINANCIAL_FORMULA_VERSION = "MARJIN_FIN/1";
function recognizedDates(window) {
    if (!window || (window.kind !== "open_month" && window.kind !== "closed_month"))
        throw new FinanceContractError("invalid_window_kind");
    if (!isBusinessDate(window.asOfBusinessDate))
        throw new FinanceContractError("invalid_as_of", window.asOfBusinessDate);
    const { first, last } = monthBounds(window.month);
    const asOf = window.asOfBusinessDate;
    if (asOf < first)
        return { dates: [], state: "future_period" };
    if (window.kind === "open_month") {
        if (asOf > last)
            throw new FinanceContractError("open_month_already_closed", { month: window.month, asOf });
        return { dates: datesInRange(first, asOf), state: "actual" };
    }
    if (asOf <= last)
        throw new FinanceContractError("closed_month_not_closed", { month: window.month, asOf });
    return { dates: datesInRange(first, last), state: "actual" };
}
function coverageOf(days, pick, partialOf) {
    const missing = [];
    const invalid = [];
    const partial = [];
    let present = 0;
    for (const d of days) {
        const p = pick(d);
        if (p === "present") {
            present += 1;
            if (partialOf(d))
                partial.push(d.date);
        }
        else if (p === "invalid")
            invalid.push(d.date);
        else
            missing.push(d.date);
    }
    return { expectedDays: days.length, presentDays: present, missingDays: missing, invalidDays: invalid, partialDays: partial };
}
function totalOf(days, pick) {
    let sum = null;
    let present = 0;
    let partial = false;
    for (const d of days) {
        const m = pick(d);
        if (m.presence === "present" && m.value !== null) {
            present += 1;
            if (m.partial)
                partial = true;
            sum = sum === null ? m.value : decAdd(sum, m.value);
        }
    }
    return {
        total: { value: sum === null ? null : serializeDec(sum), presentDays: present, complete: present === days.length && !partial },
        rat: sum === null ? null : ratFromDec(sum),
    };
}
const HUNDRED = ratFromInt(100);
/** TI-13 ratio of totals with typed non-value states (shared by report, projection and adapters). */
export function ratioOfTotals(num, den, scale = HUNDRED) {
    if (den === null)
        return { state: "denominator_missing" };
    if (num === null)
        return { state: "numerator_missing" };
    if (ratIsZero(den))
        return { state: "zero_denominator" };
    if (ratIsNegative(den))
        return { state: "negative_denominator" };
    return { state: "value", value: serializeRat(ratMul(ratDiv(num, den), scale)) };
}
/** Revenue minus variable costs. Only called when every operand is complete (TI-18). */
export function contributionOf(revenue, purchases, laborEntered, otherExpense) {
    return ratSub(ratSub(ratSub(revenue, purchases), laborEntered), otherExpense);
}
/** Contribution minus salaried employer cost and fixed/rent/royalty charges. */
export function operatingProfitOf(contribution, salaried, fixedTotal) {
    return ratSub(ratSub(contribution, salaried), fixedTotal);
}
/** Issues of one day-level metric over the recognised days (missing, invalid, partial). */
function metricIssues(days, component, pick, required) {
    const missing = [];
    const invalid = [];
    for (const d of days) {
        const m = pick(d);
        if (m.presence === "invalid" || (m.presence === "present" && m.partial))
            invalid.push(d.date);
        else if (m.presence === "absent" && required)
            missing.push(d.date);
    }
    const out = [];
    if (invalid.length >= 1)
        out.push({ component, kind: "invalid", reason: "invalid_or_partial_value", dates: invalid });
    if (missing.length >= 1)
        out.push({ component, kind: "missing", reason: "not_recorded", dates: missing });
    return out;
}
/** The value is computed ONLY when no required component has an issue (TI-18). */
function typedAmount(compute, issues, revenueRecorded) {
    if (issues.some((i) => i.kind === "invalid"))
        return { state: "invalid_components", value: null, issues };
    if (!revenueRecorded)
        return { state: "revenue_missing", value: null, issues };
    if (issues.length >= 1)
        return { state: "incomplete_components", value: null, issues };
    return { state: "complete", value: serializeRat(compute()), issues: [] };
}
/** A required component inside a complete result is always recorded; anything else is a contract bug. */
function required(r, component) {
    if (r === null)
        throw new FinanceContractError("required_component_absent", component);
    return r;
}
const CONFIG_INVALID_CODES = ["invalid_fixed_amount", "invalid_rate"];
const CONFIG_MISSING_CODES = ["missing_fixed_amount", "missing_rate"];
function perPresentDay(total, presentDays) {
    if (total === null || presentDays < 1)
        return { state: "denominator_missing" };
    return { state: "value", value: serializeRat(ratDiv(total, ratFromInt(presentDays))) };
}
/**
 * Compute the Actual report for one month window. `purchaseBasis` is REQUIRED (TI-16):
 * a purchase KPI is never produced without a stated basis.
 */
/**
 * Compute the Actual report for one month window. `purchaseBasis` (TI-16) and `laborSource`
 * (MARJIN_LABOR/1) are REQUIRED: no purchase KPI without a stated basis and no labor cost
 * without a stated authoritative employer-cost source.
 */
export function computePeriodReport(days, timeline, purchaseBasis, laborSource, window, context = {}) {
    if (arguments.length < 5)
        throw new FinanceContractError("labor_source_required");
    validatePurchaseBasisInput(purchaseBasis);
    const labor = validateLaborSource(laborSource);
    const { dates, state } = recognizedDates(window);
    const byDate = new Map();
    for (const d of days) {
        if (byDate.has(d.date))
            throw new FinanceContractError("duplicate_day", d.date);
        byDate.set(d.date, d);
    }
    const missingObjects = dates.filter((d) => !byDate.has(d));
    if (missingObjects.length)
        throw new FinanceContractError("window_days_incomplete", missingObjects);
    const inWindow = dates.map((d) => byDate.get(d));
    const revenue = totalOf(inWindow, (d) => d.revenue);
    const purchases = totalOf(inWindow, (d) => d.purchases);
    const entered = totalOf(inWindow, (d) => d.directLabor);
    const other = totalOf(inWindow, (d) => d.otherExpense);
    const bySource = new Map();
    for (const d of inWindow)
        for (const [k, v] of Object.entries(d.purchases.bySource)) {
            const r = parseAmountString(v);
            bySource.set(k, bySource.has(k) ? ratAdd(bySource.get(k), r) : r);
        }
    const purchaseDates = inWindow.filter((d) => d.purchases.presence === "present").map((d) => d.date);
    const basis = resolvePurchaseBasis(purchaseDates, purchaseBasis);
    const revenueByDate = new Map();
    for (const d of inWindow)
        revenueByDate.set(d.date, d.revenue.presence === "present" && d.revenue.value !== null ? ratFromDec(d.revenue.value) : null);
    const accrual = accrueWindow(timeline, dates, revenueByDate);
    const flags = [];
    for (const d of inWindow)
        flags.push(...d.flags);
    if (context.flags)
        flags.push(...context.flags);
    if (timeline.flags)
        flags.push(...timeline.flags);
    for (const d of accrual.uncoveredDates)
        flags.push({ code: "cost_config_absent", date: d });
    for (const v of accrual.superseded)
        flags.push({ code: "superseded_versions", key: v });
    for (const k of accrual.grossSalaryOnlyEmployees)
        flags.push({ code: "gross_salary_not_labor_cost", key: k });
    const revenuePresentDates = inWindow.filter((d) => d.revenue.presence === "present");
    for (const d of revenuePresentDates) {
        if (d.purchases.presence !== "present")
            flags.push({ code: "ratio_numerator_incomplete", date: d.date, field: "purchases" });
        if (d.directLabor.presence !== "present")
            flags.push({ code: "ratio_numerator_incomplete", date: d.date, field: "directLabor" });
    }
    let purchasesPct;
    if (basis.kind === "unresolved")
        purchasesPct = { state: "purchase_basis_unresolved" };
    else {
        const r = ratioOfTotals(purchases.rat, revenue.rat);
        purchasesPct = r.state === "value" ? { state: "value", value: r.value, basisKind: "net_of_vat", comparability: "same_basis_as_revenue" } : r;
    }
    // ── Completeness (TI-18). Required on every recognised day: revenue, purchases and the
    // entered authoritative employer cost (an explicit 0 / "skip" is a complete fact).
    // other_expense is an optional category (absence = none recorded) but an invalid value
    // is an invalid component. Configuration must cover every day and carry no invalid
    // fixed/rate value. Salaried employer cost is required only for scope "excludes_salaried".
    const revenueIssues = metricIssues(inWindow, "revenue", (d) => d.revenue, true);
    const purchaseIssues = metricIssues(inWindow, "purchases", (d) => d.purchases, true);
    const laborIssues = metricIssues(inWindow, "labor_employer_cost", (d) => d.directLabor, true);
    const otherIssues = metricIssues(inWindow, "other_expense", (d) => d.otherExpense, false);
    const configIssues = [];
    if (accrual.uncoveredDates.length >= 1)
        configIssues.push({ component: "cost_configuration", kind: "missing", reason: "cost_config_absent", dates: accrual.uncoveredDates });
    const invalidConfig = (timeline.flags || []).filter((f) => CONFIG_INVALID_CODES.includes(f.code));
    if (invalidConfig.length >= 1)
        configIssues.push({ component: "cost_configuration", kind: "invalid", reason: invalidConfig.map((f) => f.code + ":" + (f.key || f.field || "")).sort().join(","), dates: dates });
    const missingConfig = (timeline.flags || []).filter((f) => CONFIG_MISSING_CODES.includes(f.code));
    if (missingConfig.length >= 1)
        configIssues.push({ component: "cost_configuration", kind: "missing", reason: missingConfig.map((f) => f.code + ":" + (f.key || f.field || "")).sort().join(","), dates: dates });
    const salariedIssues = [];
    const salariedApplies = labor.scope === "excludes_salaried";
    if (salariedApplies && accrual.grossSalaryOnlyDates.length >= 1) {
        salariedIssues.push({ component: "salaried_employer_cost", kind: "missing", reason: "gross_salary_not_employer_cost", dates: accrual.grossSalaryOnlyDates });
    }
    if (salariedApplies && (timeline.flags || []).some((f) => f.code === "invalid_salary")) {
        salariedIssues.push({ component: "salaried_employer_cost", kind: "invalid", reason: "invalid_salary", dates: dates });
    }
    const revenueRecorded = revenue.total.presentDays >= 1;
    const fixedTotal = ratAdd(ratAdd(accrual.fixedRegular, accrual.rentFixed), ratAdd(accrual.rentPct, accrual.royaltyPct));
    const salariedCost = salariedApplies ? accrual.salaried : RAT_ZERO;
    // other_expense is the only optional category: with no recorded value it contributes nothing
    // by contract (its invalid values are issues above). Every other operand is required.
    const otherRecorded = other.rat === null ? RAT_ZERO : other.rat;
    const days0 = inWindow.length >= 1;
    const laborCompleteIssues = [...laborIssues, ...salariedIssues];
    const employerCost = days0
        ? typedAmount(() => ratAdd(required(entered.rat, "labor_employer_cost"), salariedCost), laborCompleteIssues, true)
        : { state: "incomplete_components", value: null, issues: [] };
    // The labor % needs a complete numerator AND a complete denominator (TI-18).
    const pctIssues = [...laborCompleteIssues, ...revenueIssues];
    const employerCostPct = employerCost.state === "complete" && pctIssues.length < 1
        ? ratioOfTotals(parseAmountString(employerCost.value), revenue.rat)
        : { state: pctIssues.some((i) => i.kind === "invalid") ? "invalid_components" : "incomplete_components" };
    const contributionIssues = [...revenueIssues, ...purchaseIssues, ...laborIssues, ...otherIssues];
    const contribution = () => contributionOf(required(revenue.rat, "revenue"), required(purchases.rat, "purchases"), required(entered.rat, "labor_employer_cost"), otherRecorded);
    const contributionBeforeFixed = typedAmount(contribution, contributionIssues, revenueRecorded);
    const profitIssues = [...contributionIssues, ...salariedIssues, ...configIssues];
    const operatingProfit = typedAmount(() => operatingProfitOf(contribution(), salariedCost, fixedTotal), profitIssues, revenueRecorded);
    const today = window.kind === "open_month" && state === "actual"
        ? { date: window.asOfBusinessDate, state: "open", dayPresence: byDate.get(window.asOfBusinessDate).presence.day }
        : null;
    if (today)
        flags.push({ code: "today_open", date: today.date });
    return {
        versions: { fin: FINANCIAL_FORMULA_VERSION, norm: NORMALIZATION_VERSION, dec: DECIMAL_CONTRACT_VERSION, pb: PURCHASE_BASIS_CONTRACT_VERSION, labor: LABOR_CONTRACT_VERSION },
        window: { kind: window.kind, month: window.month, asOfBusinessDate: window.asOfBusinessDate, state, from: dates[0] || null, to: dates[dates.length - 1] || null, recognizedDays: dates.length },
        timezone: BUSINESS_TIMEZONE,
        vatBasis: "net_of_vat",
        configurationBasis: accrual.configurationBasis,
        costVersionsApplied: accrual.versionsApplied,
        timelineSource: timeline.timelineSource,
        today,
        coverage: {
            day: coverageOf(inWindow, (d) => d.presence.day, (d) => d.revenue.partial || d.purchases.partial || d.directLabor.partial || d.otherExpense.partial),
            revenue: coverageOf(inWindow, (d) => d.presence.revenue, (d) => d.revenue.partial),
            purchases: coverageOf(inWindow, (d) => d.presence.purchases, (d) => d.purchases.partial),
            directLabor: coverageOf(inWindow, (d) => d.presence.directLabor, (d) => d.directLabor.partial),
            otherExpense: coverageOf(inWindow, (d) => d.presence.otherExpense, (d) => d.otherExpense.partial),
        },
        actual: {
            revenue: revenue.total,
            purchases: { ...purchases.total, bySource: Object.fromEntries([...bySource.keys()].sort().map((k) => [k, serializeRat(bySource.get(k))])), basis },
            directLabor: entered.total,
            otherExpense: other.total,
            labor: {
                contract: LABOR_CONTRACT_VERSION,
                source: labor,
                enteredEmployerCost: entered.total,
                salariedEmployerCost: salariedApplies && salariedIssues.length < 1 ? serializeRat(accrual.salaried) : null,
                grossSalaryDatumPresent: accrual.grossSalaryOnlyEmployees.length >= 1,
                employerCost,
                employerCostPct,
            },
            fixedAccrual: {
                regular: serializeRat(accrual.fixedRegular),
                rentFixed: serializeRat(accrual.rentFixed),
                rentPct: serializeRat(accrual.rentPct),
                royaltyPct: serializeRat(accrual.royaltyPct),
                total: serializeRat(fixedTotal),
            },
            purchasesPct,
            directLaborPct: ratioOfTotals(entered.rat, revenue.rat),
            averages: {
                revenuePerPresentDay: perPresentDay(revenue.rat, revenue.total.presentDays),
                purchasesPerPresentDay: perPresentDay(purchases.rat, purchases.total.presentDays),
                directLaborPerPresentDay: perPresentDay(entered.rat, entered.total.presentDays),
            },
            contributionBeforeFixed,
            operatingProfit,
        },
        quarantine: context.quarantine || { futureRows: [], invalidDateRows: [] },
        flags: sortFlags(dedupeFlags(flags)),
    };
}
function dedupeFlags(flags) {
    const seen = new Set();
    const out = [];
    for (const f of flags) {
        const k = JSON.stringify([f.code, f.rowId, f.date, f.field, f.key, f.reason]);
        if (!seen.has(k)) {
            seen.add(k);
            out.push(f);
        }
    }
    return out;
}
/** Canonical byte-stable serialization: sorted keys, amounts already canonical strings. */
export function serializeReport(value) {
    const walk = (v) => {
        if (v === null || typeof v !== "object")
            return JSON.stringify(v === undefined ? null : v);
        if (Array.isArray(v))
            return "[" + v.map(walk).join(",") + "]";
        const o = v;
        return "{" + Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => JSON.stringify(k) + ":" + walk(o[k])).join(",") + "}";
    };
    return walk(value);
}
