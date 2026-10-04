import { DECIMAL_CONTRACT_VERSION, RAT_ZERO, parseAmountString, decAdd, decIsZero, ratAdd, ratDiv, ratFromDec, ratFromInt, ratIsNegative, ratIsZero, ratMul, ratSub, serializeDec, serializeRat, } from "../finance/decimal.js";
import { BUSINESS_TIMEZONE, addDays, isBusinessDate, monthBounds, datesInRange } from "../finance/businessDate.js";
import { NORMALIZATION_VERSION, sortFlags } from "../finance/normalize.js";
import { PURCHASE_BASIS_CONTRACT_VERSION, resolvePurchaseBasis, validatePurchaseBasisInput } from "../finance/purchaseBasis.js";
import { FIXED_COST_ALLOCATION, GLOBAL_COST_ALLOCATION, LABOR_CONTRACT_VERSION, validateLaborSource } from "../finance/labor.js";
import { FinanceContractError } from "../finance/types.js";
import { SUPPLIER_CREDITS_CONTRACT_VERSION } from "../finance/supplierCredits.js";
import { accrueWindow } from "./costTimeline.js";
export const FINANCIAL_FORMULA_VERSION = "MARJIN_FIN/4";
/** Manual-operation Actual window rule. A future live/same-day model is deferred and would be a new rule. */
export const ACTUAL_WINDOW_RULE = "completed_days_through_d_minus_1";
export const NO_DECLARED_CLOSURES = Object.freeze({ source: "none_declared", closedDates: Object.freeze([]) });
/**
 * Recognised Actual dates. open_month: month start through asOf − 1 (the last completed
 * business day); the as-of (current) day is never recognised. closed_month: the whole month
 * (asOf must be after the month, so its last day is completed).
 */
export function actualWindowDates(window) {
    if (!window || (window.kind !== "open_month" && window.kind !== "closed_month"))
        throw new FinanceContractError("invalid_window_kind");
    if (!isBusinessDate(window.asOfBusinessDate))
        throw new FinanceContractError("invalid_as_of", window.asOfBusinessDate);
    const { first, last } = monthBounds(window.month);
    const asOf = window.asOfBusinessDate;
    if (asOf < first)
        return { dates: [], state: "future_period", completedThrough: null, currentDay: null };
    if (window.kind === "open_month") {
        if (asOf > last)
            throw new FinanceContractError("open_month_already_closed", { month: window.month, asOf });
        const lastCompleted = addDays(asOf, -1);
        if (lastCompleted < first)
            return { dates: [], state: "no_completed_days", completedThrough: null, currentDay: asOf };
        return { dates: datesInRange(first, lastCompleted), state: "actual", completedThrough: lastCompleted, currentDay: asOf };
    }
    if (asOf <= last)
        throw new FinanceContractError("closed_month_not_closed", { month: window.month, asOf });
    return { dates: datesInRange(first, last), state: "actual", completedThrough: last, currentDay: null };
}
function validateCalendar(c) {
    if (c === undefined)
        return NO_DECLARED_CLOSURES;
    const o = c;
    if (!o || typeof o !== "object" || typeof o.source !== "string" || o.source === "" || !Array.isArray(o.closedDates)) {
        throw new FinanceContractError("invalid_operating_calendar");
    }
    const seen = new Set();
    for (const d of o.closedDates) {
        if (!isBusinessDate(d) || seen.has(d))
            throw new FinanceContractError("invalid_operating_calendar", d);
        seen.add(d);
    }
    return c;
}
function coverageOf(days, closed, pick, partialOf, conflicted = new Set()) {
    const missing = [];
    const invalid = [];
    const partial = [];
    const closedDays = [];
    let present = 0;
    let expected = 0;
    for (const d of days) {
        // A declared closure whose recorded value contradicts it (CDA-02) is not a known zero: it is
        // an expected date whose value is INVALID until repaired (the declaration itself stays in
        // report.operatingCalendar and in the closed_day_has_recorded_values flag / issue).
        if (conflicted.has(d.date)) {
            expected += 1;
            invalid.push(d.date);
            continue;
        }
        if (closed.has(d.date)) {
            closedDays.push(d.date);
            continue;
        }
        expected += 1;
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
    return { expectedDays: expected, presentDays: present, missingDays: missing, invalidDays: invalid, partialDays: partial, closedDays };
}
function totalOf(days, closed, pick) {
    let sum = null;
    let present = 0;
    let operatingPresent = 0;
    let operating = 0;
    let partial = false;
    for (const d of days) {
        const m = pick(d);
        if (!closed.has(d.date))
            operating += 1;
        if (m.presence === "present" && m.value !== null) {
            present += 1;
            if (!closed.has(d.date))
                operatingPresent += 1;
            if (m.partial)
                partial = true;
            sum = sum === null ? m.value : decAdd(sum, m.value);
        }
    }
    return {
        total: { value: sum === null ? null : serializeDec(sum), presentDays: present, complete: operatingPresent === operating && !partial },
        rat: sum === null ? null : ratFromDec(sum),
        operatingPresent,
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
/** Revenue minus variable costs (purchases, hourly employer cost, other expense). Only called when every operand is complete (TI-18). */
export function contributionOf(revenue, purchases, hourlyLabor, otherExpense) {
    return ratSub(ratSub(ratSub(revenue, purchases), hourlyLabor), otherExpense);
}
/** Contribution minus the global employer-cost allocation and fixed/rent/royalty charges. */
export function operatingProfitOf(contribution, globalLabor, fixedTotal) {
    return ratSub(ratSub(contribution, globalLabor), fixedTotal);
}
/** Issues of one day-level metric: invalid/partial on any recognised day; missing only on operating (non-closed) days. */
function metricIssues(days, closed, component, pick, required) {
    const missing = [];
    const invalid = [];
    for (const d of days) {
        const m = pick(d);
        if (m.presence === "invalid" || (m.presence === "present" && m.partial))
            invalid.push(d.date);
        else if (m.presence === "absent" && required && !closed.has(d.date))
            missing.push(d.date);
    }
    const out = [];
    if (invalid.length >= 1)
        out.push({ component, kind: "invalid", reason: "invalid_or_partial_value", dates: invalid });
    if (missing.length >= 1)
        out.push({ component, kind: "missing", reason: "not_recorded", dates: missing });
    return out;
}
/** The value is computed ONLY when the window has days and no required component has an issue (TI-18). */
function typedAmount(compute, issues, revenueKnown, empty) {
    if (empty)
        return { state: "empty_window", value: null, issues: [] };
    if (issues.some((i) => i.kind === "invalid"))
        return { state: "invalid_components", value: null, issues };
    if (!revenueKnown)
        return { state: "revenue_missing", value: null, issues };
    if (issues.length >= 1)
        return { state: "incomplete_components", value: null, issues };
    return { state: "complete", value: serializeRat(compute()), issues: [] };
}
const CONFIG_INVALID_CODES = ["invalid_fixed_amount", "invalid_rate"];
const CONFIG_MISSING_CODES = ["missing_fixed_amount", "missing_rate"];
/** Average per recorded OPERATING day (declared closed days are not in the denominator). */
function perPresentDay(total, presentDays) {
    if (total === null || presentDays < 1)
        return { state: "denominator_missing" };
    return { state: "value", value: serializeRat(ratDiv(total, ratFromInt(presentDays))) };
}
function flagIssue(flags, codes, component, kind, dates) {
    const hit = flags.filter((f) => codes.includes(f.code));
    if (hit.length < 1 || dates.length < 1)
        return [];
    return [{ component, kind, reason: hit.map((f) => f.code + ":" + (f.key || f.field || "")).sort().join(","), dates }];
}
const nonZero = (m) => m.presence === "present" && m.value !== null && !decIsZero(m.value);
/**
 * Compute the Actual report for one month window. `purchaseBasis` (TI-16) and `laborSource`
 * (MARJIN_LABOR/2) are REQUIRED: no purchase KPI without a stated basis and no labor cost
 * without the stated authoritative hourly employer-cost source.
 */
export function computePeriodReport(days, timeline, purchaseBasis, laborSource, window, context = {}) {
    if (arguments.length < 5)
        throw new FinanceContractError("labor_source_required");
    validatePurchaseBasisInput(purchaseBasis);
    const labor = validateLaborSource(laborSource);
    const calendar = validateCalendar(context.operatingCalendar);
    const win = actualWindowDates(window);
    const dates = win.dates;
    const byDate = new Map();
    for (const d of days) {
        if (byDate.has(d.date))
            throw new FinanceContractError("duplicate_day", d.date);
        byDate.set(d.date, d);
    }
    const missingObjects = dates.filter((d) => !byDate.has(d));
    if (missingObjects.length)
        throw new FinanceContractError("window_days_incomplete", missingObjects);
    // Only recognised (completed) dates enter Actual; a supplied current-day or later object is ignored.
    const inWindow = dates.map((d) => byDate.get(d));
    const windowSet = new Set(dates);
    const closed = new Set(calendar.closedDates.filter((d) => windowSet.has(d)));
    const closedInWindow = dates.filter((d) => closed.has(d));
    const operatingCount = dates.length - closedInWindow.length;
    const empty = dates.length < 1;
    const noOperatingDays = operatingCount < 1;
    // CDA-02: recorded NON-ZERO revenue on a declared closure contradicts the declaration. The
    // recorded amount is kept (diagnosis; never zeroed or clamped), but revenue is then NOT a
    // complete fact: the total is incomplete, the date is an invalid revenue date, and every
    // revenue-dependent output carries an invalid revenue issue.
    const contradicted = inWindow.filter((d) => closed.has(d.date) && nonZero(d.revenue)).map((d) => d.date);
    const contradictedSet = new Set(contradicted);
    const revenueTotal = totalOf(inWindow, closed, (d) => d.revenue);
    const revenue = contradicted.length >= 1 ? { ...revenueTotal, total: { ...revenueTotal.total, complete: false } } : revenueTotal;
    // MARJIN_FIN/4: d.purchases is already NET on dates whose gross purchases are present
    // (applySupplierCreditsToDay); credits issued on a date WITHOUT present gross purchases are
    // subtracted here, so the total is exactly Σ gross − Σ credits of the window.
    const grossTotal = totalOf(inWindow, closed, (d) => d.purchasesGross || d.purchases);
    const netOnPresent = totalOf(inWindow, closed, (d) => d.purchases);
    let creditsOffGross = null;
    const creditBy = new Map();
    const offGrossBy = new Map();
    let creditsSum = null;
    let creditCount = 0;
    const creditDates = [];
    const creditInvalidDates = [];
    const creditPendingDates = [];
    const creditFlaggedDates = [];
    for (const d of inWindow) {
        const c = d.supplierCredits;
        if (!c)
            continue;
        if (c.presence === "invalid" || c.partial) {
            creditInvalidDates.push(d.date);
            if (c.reason === "supplier_credit_review_pending")
                creditPendingDates.push(d.date);
            if (c.reason === "supplier_credit_review_flagged")
                creditFlaggedDates.push(d.date);
        }
        if (c.presence !== "present" || c.value === null)
            continue;
        creditDates.push(d.date);
        creditCount += c.count;
        creditsSum = creditsSum === null ? c.value : decAdd(creditsSum, c.value);
        const grossPresent = d.purchases.presence === "present" && d.purchases.value !== null;
        if (!grossPresent)
            creditsOffGross = creditsOffGross === null ? c.value : decAdd(creditsOffGross, c.value);
        for (const [k, v] of Object.entries(c.bySupplier)) {
            const r = parseAmountString(v);
            creditBy.set(k, creditBy.has(k) ? ratAdd(creditBy.get(k), r) : r);
            if (!grossPresent)
                offGrossBy.set(k, offGrossBy.has(k) ? ratAdd(offGrossBy.get(k), r) : r);
        }
    }
    const netRat = creditsOffGross === null ? netOnPresent.rat : ratSub(netOnPresent.rat === null ? RAT_ZERO : netOnPresent.rat, ratFromDec(creditsOffGross));
    const purchases = {
        total: { value: netRat === null ? null : serializeRat(netRat), presentDays: netOnPresent.total.presentDays, complete: netOnPresent.total.complete && creditInvalidDates.length < 1 },
        rat: netRat,
        operatingPresent: netOnPresent.operatingPresent,
    };
    const hourly = totalOf(inWindow, closed, (d) => d.hourlyLabor);
    const other = totalOf(inWindow, closed, (d) => d.otherExpense);
    const bySource = new Map();
    const grossBySource = new Map();
    for (const d of inWindow)
        for (const [k, v] of Object.entries(d.purchases.bySource)) {
            const r = parseAmountString(v);
            bySource.set(k, bySource.has(k) ? ratAdd(bySource.get(k), r) : r);
        }
    for (const [k, r] of offGrossBy)
        bySource.set(k, bySource.has(k) ? ratSub(bySource.get(k), r) : ratSub(RAT_ZERO, r));
    for (const d of inWindow)
        for (const [k, v] of Object.entries((d.purchasesGross || d.purchases).bySource)) {
            const r = parseAmountString(v);
            grossBySource.set(k, grossBySource.has(k) ? ratAdd(grossBySource.get(k), r) : r);
        }
    const sortedOut = (m) => Object.fromEntries([...m.keys()].sort().map((k) => [k, serializeRat(m.get(k))]));
    const purchaseDates = inWindow.filter((d) => d.purchases.presence === "present").map((d) => d.date);
    const basis = resolvePurchaseBasis(purchaseDates, purchaseBasis);
    const revenueByDate = new Map();
    for (const d of inWindow)
        revenueByDate.set(d.date, d.revenue.presence === "present" && d.revenue.value !== null ? ratFromDec(d.revenue.value) : null);
    // Entitlement-then-placement over the recognised dates: a completed declared closure has no
    // monthly-cost placement; the one captured business date decides completion (CDA-10).
    const accrual = accrueWindow(timeline, dates, revenueByDate, { asOfBusinessDate: window.asOfBusinessDate, closedDates: calendar.closedDates });
    const timelineFlags = timeline.flags || [];
    const flags = [];
    for (const d of inWindow)
        flags.push(...d.flags);
    if (context.flags)
        flags.push(...context.flags);
    flags.push(...timelineFlags);
    for (const d of accrual.uncoveredDates)
        flags.push({ code: "cost_config_absent", date: d });
    for (const v of accrual.superseded)
        flags.push({ code: "superseded_versions", key: v });
    const revenuePresentDates = inWindow.filter((d) => d.revenue.presence === "present");
    for (const d of revenuePresentDates) {
        if (d.purchases.presence !== "present")
            flags.push({ code: "ratio_numerator_incomplete", date: d.date, field: "purchases" });
        if (d.hourlyLabor.presence !== "present")
            flags.push({ code: "ratio_numerator_incomplete", date: d.date, field: "hourlyLabor" });
    }
    // ── Completeness (TI-18). Required on every OPERATING recognised day: revenue, purchases
    // and the hourly employer cost (an explicit 0 / "skip" is a complete fact). Declared closed
    // days require none of them and are known zero revenue; recorded NON-ZERO REVENUE on a closed
    // day contradicts the declaration (invalid, CDA-02). Costs actually recorded on a closed day
    // (purchases, payroll, other) are kept on it and are no contradiction (CDA-08). other_expense is optional (absence = none
    // recorded); an invalid value is an invalid component on any day. Global employer cost and
    // fixed configuration must cover every recognised day and carry no missing/invalid value.
    const revenueIssues = metricIssues(inWindow, closed, "revenue", (d) => d.revenue, true);
    if (contradicted.length >= 1)
        revenueIssues.push({ component: "revenue", kind: "invalid", reason: "closed_day_has_recorded_values", dates: contradicted });
    const purchaseIssues = metricIssues(inWindow, closed, "purchases", (d) => d.purchases, true);
    // MARJIN_CREDITS/4: an invalid / unreadable / review-unresolved credit fact on ANY recognised date (closed dates
    // included — a credit's period is its issue date, not the operating calendar) is an invalid
    // purchases component: purchases, Food Cost and every dependent figure are never complete.
    const creditOnlyInvalid = creditInvalidDates.filter((dt) => !purchaseIssues.some((i) => i.kind === "invalid" && i.dates.includes(dt)));
    const reviewOnly = new Set([...creditPendingDates, ...creditFlaggedDates]);
    const creditDefectDates = creditOnlyInvalid.filter((dt) => !reviewOnly.has(dt));
    const creditReviewDates = creditOnlyInvalid.filter((dt) => reviewOnly.has(dt));
    if (creditDefectDates.length >= 1)
        purchaseIssues.push({ component: "purchases", kind: "invalid", reason: "supplier_credit_invalid_or_unreadable", dates: creditDefectDates });
    if (creditReviewDates.length >= 1)
        purchaseIssues.push({ component: "purchases", kind: "invalid", reason: "supplier_credit_review_unresolved", dates: creditReviewDates });
    if (netRat !== null && ratIsNegative(netRat))
        flags.push({ code: "negative_net_purchases", key: "window" });
    for (const [k, r] of bySource)
        if (ratIsNegative(r))
            flags.push({ code: "negative_supplier_net", key: k });
    const hourlyIssues = metricIssues(inWindow, closed, "hourly_employer_cost", (d) => d.hourlyLabor, true);
    const otherIssues = metricIssues(inWindow, closed, "other_expense", (d) => d.otherExpense, false);
    for (const d of contradicted)
        flags.push({ code: "closed_day_has_recorded_values", date: d });
    const calendarIssues = contradicted.length >= 1
        ? [{ component: "operating_calendar", kind: "invalid", reason: "closed_day_has_recorded_values", dates: contradicted }]
        : [];
    const globalIssues = [];
    if (accrual.uncoveredDates.length >= 1)
        globalIssues.push({ component: "global_employer_cost", kind: "missing", reason: "cost_config_absent", dates: accrual.uncoveredDates });
    // A segment without eligible dates that the window only partly covers has no determinable window share (CDA-14).
    const allocationUndetermined = !accrual.allocation.aggregateDeterminable ? accrual.allocation.placementUnavailableDates : [];
    if (allocationUndetermined.length >= 1)
        globalIssues.push({ component: "global_employer_cost", kind: "missing", reason: "no_eligible_allocation_days", dates: allocationUndetermined });
    // An unreadable closure source leaves the placement of an OPEN window unknown; a closed month's
    // total is its entitlement whatever the closures, so it stays determinable.
    const calendarUnknownDates = context.closureCalendarUnreadable === true && window.kind === "open_month" ? dates : [];
    if (calendarUnknownDates.length >= 1)
        globalIssues.push({ component: "global_employer_cost", kind: "invalid", reason: "closure_calendar_unreadable", dates: calendarUnknownDates });
    globalIssues.push(...flagIssue(timelineFlags, ["invalid_global_amount"], "global_employer_cost", "invalid", dates));
    globalIssues.push(...flagIssue(timelineFlags, ["missing_global_amount"], "global_employer_cost", "missing", dates));
    const configIssues = [];
    if (accrual.uncoveredDates.length >= 1)
        configIssues.push({ component: "cost_configuration", kind: "missing", reason: "cost_config_absent", dates: accrual.uncoveredDates });
    if (allocationUndetermined.length >= 1)
        configIssues.push({ component: "cost_configuration", kind: "missing", reason: "no_eligible_allocation_days", dates: allocationUndetermined });
    if (calendarUnknownDates.length >= 1)
        configIssues.push({ component: "cost_configuration", kind: "invalid", reason: "closure_calendar_unreadable", dates: calendarUnknownDates });
    configIssues.push(...flagIssue(timelineFlags, CONFIG_INVALID_CODES, "cost_configuration", "invalid", dates));
    configIssues.push(...flagIssue(timelineFlags, CONFIG_MISSING_CODES, "cost_configuration", "missing", dates));
    // Purchases % (food cost %) is an Actual KPI: a value only over complete revenue and purchases (TI-18).
    const purchasePctIssues = [...revenueIssues, ...purchaseIssues, ...calendarIssues];
    let purchasesPct;
    if (basis.kind === "unresolved")
        purchasesPct = { state: "purchase_basis_unresolved" };
    else if (empty)
        purchasesPct = { state: "empty_window" };
    else if (purchasePctIssues.length >= 1)
        purchasesPct = { state: purchasePctIssues.some((i) => i.kind === "invalid") ? "invalid_components" : "incomplete_components" };
    else {
        const r = ratioOfTotals(noOperatingDays && purchases.rat === null ? RAT_ZERO : purchases.rat, noOperatingDays && revenue.rat === null ? RAT_ZERO : revenue.rat);
        purchasesPct = r.state === "value" ? { state: "value", value: r.value, basisKind: "net_of_vat", comparability: "same_basis_as_revenue" } : r;
    }
    // A recorded total, or a known zero when the window has no operating day (all days closed).
    const known = (r, component) => {
        if (r !== null)
            return r;
        if (noOperatingDays)
            return RAT_ZERO;
        throw new FinanceContractError("required_component_absent", component);
    };
    const revenueKnown = revenue.total.presentDays >= 1 || noOperatingDays;
    const fixedTotal = ratAdd(ratAdd(accrual.fixedRegular, accrual.rentFixed), ratAdd(accrual.rentPct, accrual.royaltyPct));
    // Percentage rent/royalty are computed on recorded revenue: incomplete revenue makes them incomplete.
    const fixedIssues = [...configIssues, ...(accrual.revenueLinked ? revenueIssues : [])];
    const fixedTyped = typedAmount(() => fixedTotal, fixedIssues, true, empty);
    const fixedOut = (r) => (fixedTyped.state === "complete" ? serializeRat(r) : null);
    // other_expense is the only optional category: with no recorded value it contributes nothing.
    const otherRecorded = other.rat === null ? RAT_ZERO : other.rat;
    const globalEmployerCost = typedAmount(() => accrual.global, globalIssues, true, empty);
    const laborIssues = [...hourlyIssues, ...globalIssues, ...calendarIssues];
    const employerCost = typedAmount(() => ratAdd(known(hourly.rat, "hourly_employer_cost"), accrual.global), laborIssues, true, empty);
    // The labor % needs a complete numerator AND a complete denominator (TI-18).
    const pctIssues = [...laborIssues, ...revenueIssues];
    let employerCostPct;
    if (empty)
        employerCostPct = { state: "empty_window" };
    else if (employerCost.state === "complete" && pctIssues.length < 1)
        employerCostPct = ratioOfTotals(parseAmountString(employerCost.value), known(revenue.rat, "revenue"));
    else
        employerCostPct = { state: pctIssues.some((i) => i.kind === "invalid") ? "invalid_components" : "incomplete_components" };
    const contributionIssues = [...revenueIssues, ...purchaseIssues, ...hourlyIssues, ...otherIssues, ...calendarIssues];
    const contribution = () => contributionOf(known(revenue.rat, "revenue"), known(purchases.rat, "purchases"), known(hourly.rat, "hourly_employer_cost"), otherRecorded);
    const contributionBeforeFixed = typedAmount(contribution, contributionIssues, revenueKnown, empty);
    const profitIssues = [...contributionIssues, ...globalIssues, ...configIssues];
    // (percentage-rent revenue issues are already contribution issues)
    const operatingProfit = typedAmount(() => operatingProfitOf(contribution(), accrual.global, fixedTotal), profitIssues, revenueKnown, empty);
    const partialAny = (d) => d.revenue.partial || d.purchases.partial || d.hourlyLabor.partial || d.otherExpense.partial;
    return {
        versions: { fin: FINANCIAL_FORMULA_VERSION, norm: NORMALIZATION_VERSION, dec: DECIMAL_CONTRACT_VERSION, pb: PURCHASE_BASIS_CONTRACT_VERSION, labor: LABOR_CONTRACT_VERSION },
        window: {
            kind: window.kind, month: window.month, asOfBusinessDate: window.asOfBusinessDate, rule: ACTUAL_WINDOW_RULE, state: win.state,
            from: dates[0] || null, to: dates[dates.length - 1] || null, completedThrough: win.completedThrough, recognizedDays: dates.length,
            currentDay: win.currentDay === null ? null : { date: win.currentDay, inActual: false },
        },
        operatingCalendar: { source: calendar.source, closedDates: closedInWindow, operatingDays: operatingCount },
        timezone: BUSINESS_TIMEZONE,
        vatBasis: "net_of_vat",
        configurationBasis: accrual.configurationBasis,
        costVersionsApplied: accrual.versionsApplied,
        timelineSource: timeline.timelineSource,
        coverage: {
            day: coverageOf(inWindow, closed, (d) => d.presence.day, partialAny),
            revenue: coverageOf(inWindow, closed, (d) => d.presence.revenue, (d) => d.revenue.partial, contradictedSet),
            purchases: coverageOf(inWindow, closed, (d) => d.presence.purchases, (d) => d.purchases.partial),
            hourlyLabor: coverageOf(inWindow, closed, (d) => d.presence.hourlyLabor, (d) => d.hourlyLabor.partial),
            otherExpense: coverageOf(inWindow, closed, (d) => d.presence.otherExpense, (d) => d.otherExpense.partial),
        },
        actual: {
            revenue: revenue.total,
            purchases: {
                ...purchases.total, bySource: sortedOut(bySource), basis,
                gross: grossTotal.total, grossBySource: sortedOut(grossBySource),
                credits: {
                    contract: SUPPLIER_CREDITS_CONTRACT_VERSION,
                    state: creditInvalidDates.length >= 1 ? "invalid" : creditCount >= 1 ? "present" : "absent",
                    value: creditsSum === null ? null : serializeDec(creditsSum),
                    count: creditCount,
                    bySupplier: sortedOut(creditBy),
                    dates: creditDates,
                    invalidDates: creditInvalidDates,
                    reviewPendingDates: creditPendingDates,
                    reviewFlaggedDates: creditFlaggedDates,
                },
            },
            hourlyLabor: hourly.total,
            otherExpense: other.total,
            labor: {
                contract: LABOR_CONTRACT_VERSION,
                source: labor,
                hourlyEmployerCost: hourly.total,
                globalEmployerCost,
                globalAllocation: GLOBAL_COST_ALLOCATION,
                globalEmployeesApplied: accrual.globalEmployeesApplied,
                employerCost,
                employerCostPct,
                legacyHourlyPayroll: { counted: false, dates: inWindow.filter((d) => d.legacyHourlyPayroll.rows.length >= 1).map((d) => d.date) },
            },
            fixedAccrual: {
                allocation: FIXED_COST_ALLOCATION,
                state: fixedTyped.state,
                issues: fixedTyped.issues,
                regular: fixedOut(accrual.fixedRegular),
                rentFixed: fixedOut(accrual.rentFixed),
                rentPct: fixedOut(accrual.rentPct),
                royaltyPct: fixedOut(accrual.royaltyPct),
                total: fixedOut(fixedTotal),
            },
            purchasesPct,
            averages: {
                revenuePerPresentDay: contradicted.length >= 1 ? { state: "invalid_components" } : perPresentDay(revenue.rat, revenue.operatingPresent),
                purchasesPerPresentDay: perPresentDay(purchases.rat, purchases.operatingPresent),
                hourlyLaborPerPresentDay: perPresentDay(hourly.rat, hourly.operatingPresent),
            },
            contributionBeforeFixed,
            operatingProfit,
            costAllocation: {
                policy: accrual.allocation.policy,
                allocationEligibleDays: accrual.allocation.eligibleDates,
                completedClosureDates: accrual.allocation.completedClosureDates,
                dayPlacement: context.closureCalendarUnreadable === true ? "closure_calendar_unreadable" : accrual.allocation.placementUnavailableDates.length >= 1 ? "no_eligible_allocation_days" : "available",
                noEligibleSegments: accrual.allocation.noEligibleSegments,
                placementUnavailableDates: accrual.allocation.placementUnavailableDates,
            },
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
