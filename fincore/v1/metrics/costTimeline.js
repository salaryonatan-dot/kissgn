import { parseAmountString, RAT_ZERO, ratAdd, ratDiv, ratFromInt, ratMul } from "../finance/decimal.js";
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
 * accrue as monthly / daysInMonth(day). Percentage rent/royalty apply to the day's
 * recorded revenue (null ⇒ no recorded revenue ⇒ nothing to apply the rate to).
 */
export function accrueDay(version, date, dayRevenue) {
    const dim = ratFromInt(daysInMonthOf(date));
    const perDay = (monthly) => ratDiv(monthly, dim);
    const revenue = dayRevenue === null ? RAT_ZERO : dayRevenue;
    const salaried = perDay(sumAmounts(version.salaried.map((s) => s.monthlyEmployerCost)));
    const fixedRegular = perDay(sumAmounts(version.fixedItems.map((f) => f.monthlyAmount)));
    const rentFixed = version.rent.mode === "fixed" ? perDay(parseAmountString(version.rent.monthlyAmount)) : RAT_ZERO;
    const { rentPct, royaltyPct } = revenueLinkedCharges(version, revenue);
    return { salaried, fixedRegular, rentFixed, rentPct, royaltyPct };
}
export function accrueWindow(timeline, dates, revenueByDate) {
    const resolved = resolveTimeline(timeline);
    let salaried = RAT_ZERO, fixedRegular = RAT_ZERO, rentFixed = RAT_ZERO, rentPct = RAT_ZERO, royaltyPct = RAT_ZERO;
    const bases = new Set();
    const applied = new Set();
    const salariedKeys = new Set();
    const uncovered = [];
    for (const d of dates) {
        const v = versionForDay(resolved, d);
        if (!v) {
            uncovered.push(d);
            continue;
        }
        bases.add(v.basis);
        applied.add(v.versionId);
        for (const e of v.salaried)
            salariedKeys.add(e.employeeKey);
        const a = accrueDay(v, d, revenueByDate.has(d) ? revenueByDate.get(d) : null);
        salaried = ratAdd(salaried, a.salaried);
        fixedRegular = ratAdd(fixedRegular, a.fixedRegular);
        rentFixed = ratAdd(rentFixed, a.rentFixed);
        rentPct = ratAdd(rentPct, a.rentPct);
        royaltyPct = ratAdd(royaltyPct, a.royaltyPct);
    }
    const total = [salaried, fixedRegular, rentFixed, rentPct, royaltyPct].reduce(ratAdd, RAT_ZERO);
    return {
        salaried, fixedRegular, rentFixed, rentPct, royaltyPct, total,
        configurationBasis: [...bases].sort(),
        versionsApplied: [...applied].sort(),
        superseded: resolved.superseded,
        uncoveredDates: uncovered,
        salariedEmployeesApplied: salariedKeys.size,
    };
}
