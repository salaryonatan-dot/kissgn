import { isCanonicalAmountString, parseAmountString, RAT_ZERO, ratAdd, ratDiv, ratFromInt, ratIsNegative, ratMul } from "../finance/decimal.js";
import { daysInMonthOf, isBusinessDate } from "../finance/businessDate.js";
import { FinanceContractError } from "../finance/types.js";
function cmpVersion(a, b) {
    if (a.recordedAt !== b.recordedAt)
        return a.recordedAt < b.recordedAt ? -1 : 1;
    return a.versionId < b.versionId ? -1 : a.versionId > b.versionId ? 1 : 0;
}
export function resolveTimeline(timeline) {
    if (!timeline || !Array.isArray(timeline.versions))
        throw new FinanceContractError("cost_timeline_required");
    const byFrom = new Map();
    const superseded = [];
    for (const v of timeline.versions) {
        if (!isBusinessDate(v.effectiveFrom))
            throw new FinanceContractError("invalid_effective_from", v.effectiveFrom);
        if (!Array.isArray(v.globalEmployees))
            throw new FinanceContractError("global_employees_required", v.versionId);
        for (const e of v.globalEmployees) {
            if (!e || e.kind !== "authoritative_employer_cost")
                throw new FinanceContractError("global_cost_not_employer_cost", { versionId: v.versionId, employeeKey: e && e.employeeKey });
            if (typeof e.monthlyAmount !== "string" || !isCanonicalAmountString(e.monthlyAmount) || ratIsNegative(parseAmountString(e.monthlyAmount))) {
                throw new FinanceContractError("invalid_global_amount", { versionId: v.versionId, employeeKey: e.employeeKey });
            }
        }
        const prev = byFrom.get(v.effectiveFrom);
        if (!prev)
            byFrom.set(v.effectiveFrom, v);
        else if (cmpVersion(v, prev) > 0) {
            superseded.push(prev.versionId);
            byFrom.set(v.effectiveFrom, v);
        }
        else
            superseded.push(v.versionId);
    }
    const ordered = [...byFrom.values()].sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? -1 : a.effectiveFrom > b.effectiveFrom ? 1 : 0));
    return { ordered, superseded: superseded.sort() };
}
export function versionForDay(resolved, date) {
    let found = null;
    for (const v of resolved.ordered)
        if (v.effectiveFrom <= date)
            found = v;
    return found;
}
const HUNDRED = ratFromInt(100);
function sumAmounts(values) {
    let acc = RAT_ZERO;
    for (const v of values)
        acc = ratAdd(acc, parseAmountString(v));
    return acc;
}
/** Percentage rent / royalty on a revenue amount under one version (shared by accrual and projection). */
export function revenueLinkedCharges(version, revenue) {
    const rentPct = version.rent.mode === "pct" ? ratMul(ratDiv(parseAmountString(version.rent.ratePct), HUNDRED), revenue) : RAT_ZERO;
    const royaltyPct = version.royalty.mode === "pct" ? ratMul(ratDiv(parseAmountString(version.royalty.ratePct), HUNDRED), revenue) : RAT_ZERO;
    return { rentPct, royaltyPct };
}
/**
 * One calendar day's recognised cost under the version in force that day. Monthly amounts
 * (global employer cost, fixed items, fixed rent) accrue as monthly / daysInMonth(day) on
 * EVERY calendar day. Percentage rent/royalty apply to the day's recorded revenue (null ⇒
 * no recorded revenue ⇒ nothing to apply the rate to).
 */
export function accrueDay(version, date, dayRevenue) {
    const dim = ratFromInt(daysInMonthOf(date));
    const perDay = (monthly) => ratDiv(monthly, dim);
    const revenue = dayRevenue === null ? RAT_ZERO : dayRevenue;
    const global = perDay(sumAmounts(version.globalEmployees.map((e) => e.monthlyAmount)));
    const fixedRegular = perDay(sumAmounts(version.fixedItems.map((f) => f.monthlyAmount)));
    const rentFixed = version.rent.mode === "fixed" ? perDay(parseAmountString(version.rent.monthlyAmount)) : RAT_ZERO;
    const { rentPct, royaltyPct } = revenueLinkedCharges(version, revenue);
    return { global, fixedRegular, rentFixed, rentPct, royaltyPct };
}
export function accrueWindow(timeline, dates, revenueByDate) {
    const resolved = resolveTimeline(timeline);
    let global = RAT_ZERO, fixedRegular = RAT_ZERO, rentFixed = RAT_ZERO, rentPct = RAT_ZERO, royaltyPct = RAT_ZERO;
    const bases = new Set();
    const applied = new Set();
    const globalKeys = new Set();
    let revenueLinked = false;
    const uncovered = [];
    for (const d of dates) {
        const v = versionForDay(resolved, d);
        if (!v) {
            uncovered.push(d);
            continue;
        }
        bases.add(v.basis);
        applied.add(v.versionId);
        for (const e of v.globalEmployees)
            globalKeys.add(e.employeeKey);
        if (v.rent.mode === "pct" || v.royalty.mode === "pct")
            revenueLinked = true;
        const a = accrueDay(v, d, revenueByDate.has(d) ? revenueByDate.get(d) : null);
        global = ratAdd(global, a.global);
        fixedRegular = ratAdd(fixedRegular, a.fixedRegular);
        rentFixed = ratAdd(rentFixed, a.rentFixed);
        rentPct = ratAdd(rentPct, a.rentPct);
        royaltyPct = ratAdd(royaltyPct, a.royaltyPct);
    }
    const total = [global, fixedRegular, rentFixed, rentPct, royaltyPct].reduce(ratAdd, RAT_ZERO);
    return {
        global, fixedRegular, rentFixed, rentPct, royaltyPct, total,
        configurationBasis: [...bases].sort(),
        versionsApplied: [...applied].sort(),
        superseded: resolved.superseded,
        uncoveredDates: uncovered,
        globalEmployeesApplied: globalKeys.size,
        revenueLinked,
    };
}
