import { isCanonicalAmountString, parseAmountString, RAT_ZERO, ratAdd, ratDiv, ratFromInt, ratIsNegative, ratMul } from "../finance/decimal.js";
import { addDays, datesInRange, daysInMonthOf, isBusinessDate, monthBounds } from "../finance/businessDate.js";
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
// ── Eligible-day allocation (CDA-09 / CDA-10 / CDA-14) ─────────────────────────────
export const COST_ALLOCATION_POLICY = "eligible_days_excluding_completed_closures";
export const NO_CLOSURE_ALLOCATION = Object.freeze({ asOfBusinessDate: null, closedDates: Object.freeze([]) });
export function isCompletedClosure(date, ctx, closed) {
    return ctx.asOfBusinessDate !== null && closed.has(date) && date < ctx.asOfBusinessDate;
}
function validateAllocationContext(ctx) {
    if (!ctx || typeof ctx !== "object" || !Array.isArray(ctx.closedDates))
        throw new FinanceContractError("invalid_allocation_context");
    if (ctx.asOfBusinessDate !== null && !isBusinessDate(ctx.asOfBusinessDate))
        throw new FinanceContractError("invalid_as_of", ctx.asOfBusinessDate);
    for (const d of ctx.closedDates)
        if (!isBusinessDate(d))
            throw new FinanceContractError("invalid_allocation_context", d);
    return ctx;
}
/** Entitlement then eligible-date placement for every effective segment of one month. */
export function allocateMonth(resolved, month, ctx) {
    validateAllocationContext(ctx);
    const { first, last } = monthBounds(month);
    const dim = ratFromInt(daysInMonthOf(first));
    const closed = new Set(ctx.closedDates);
    const segments = [];
    const uncovered = [];
    const ordered = resolved.ordered;
    // dates before the first version in force are uncovered (never invented)
    const firstFrom = ordered.length ? ordered[0].effectiveFrom : null;
    for (const d of datesInRange(first, last))
        if (firstFrom === null || d < firstFrom)
            uncovered.push(d);
    for (let i = 0; i < ordered.length; i += 1) {
        const v = ordered[i];
        const next = i + 1 < ordered.length ? ordered[i + 1].effectiveFrom : null;
        const from = v.effectiveFrom > first ? v.effectiveFrom : first;
        const toExcl = next === null ? null : next;
        const to = toExcl !== null && toExcl <= last ? addDays(toExcl, -1) : last;
        if (from > last || to < first || from > to)
            continue;
        const dates = datesInRange(from, to);
        const completedClosureDates = dates.filter((d) => isCompletedClosure(d, ctx, closed));
        const eligibleDates = dates.filter((d) => !isCompletedClosure(d, ctx, closed));
        const share = ratDiv(ratFromInt(dates.length), dim);
        const entitlement = {
            global: ratMul(sumAmounts(v.globalEmployees.map((e) => e.monthlyAmount)), share),
            fixedRegular: ratMul(sumAmounts(v.fixedItems.map((f) => f.monthlyAmount)), share),
            rentFixed: v.rent.mode === "fixed" ? ratMul(parseAmountString(v.rent.monthlyAmount), share) : RAT_ZERO,
        };
        segments.push({ month, versionId: v.versionId, from, to, calendarDays: dates.length, eligibleDates, completedClosureDates, entitlement, state: eligibleDates.length >= 1 ? "allocated" : "no_eligible_allocation_days" });
    }
    return { month, segments, uncoveredDates: uncovered };
}
function placementIn(seg, date) {
    if (seg.state === "no_eligible_allocation_days")
        return { state: "no_eligible_allocation_days", versionId: seg.versionId, from: seg.from, to: seg.to };
    if (!seg.eligibleDates.includes(date))
        return { state: "placed", versionId: seg.versionId, global: RAT_ZERO, fixedRegular: RAT_ZERO, rentFixed: RAT_ZERO, completedClosure: true };
    const n = ratFromInt(seg.eligibleDates.length);
    return { state: "placed", versionId: seg.versionId, global: ratDiv(seg.entitlement.global, n), fixedRegular: ratDiv(seg.entitlement.fixedRegular, n), rentFixed: ratDiv(seg.entitlement.rentFixed, n), completedClosure: false };
}
function segmentOf(alloc, date) {
    for (const s of alloc.segments)
        if (s.from <= date && date <= s.to)
            return s;
    return null;
}
/** The monthly-cost placement of ONE date (its month/segment computed whole — the only divisor). */
export function dayPlacement(timeline, date, ctx = NO_CLOSURE_ALLOCATION) {
    if (!isBusinessDate(date))
        throw new FinanceContractError("invalid_date", date);
    const alloc = allocateMonth(resolveTimeline(timeline), date.slice(0, 7), ctx);
    const seg = segmentOf(alloc, date);
    return seg === null ? { state: "uncovered" } : placementIn(seg, date);
}
/**
 * Monthly-cost allocation summed over `dates` (any window). An allocated segment contributes
 * its placements on the window dates; a segment without eligible dates contributes its whole
 * entitlement when the window contains the whole segment (the aggregate is determinable), and
 * leaves the aggregate undeterminable otherwise. Percentage charges use each date's revenue.
 */
export function accrueWindow(timeline, dates, revenueByDate, ctx = NO_CLOSURE_ALLOCATION) {
    const resolved = resolveTimeline(timeline);
    validateAllocationContext(ctx);
    let global = RAT_ZERO, fixedRegular = RAT_ZERO, rentFixed = RAT_ZERO, rentPct = RAT_ZERO, royaltyPct = RAT_ZERO;
    const bases = new Set();
    const applied = new Set();
    const globalKeys = new Set();
    let revenueLinked = false;
    const uncovered = [];
    const months = new Map();
    const windowSet = new Set(dates);
    const noEligible = new Map();
    const unavailable = [];
    const completedClosures = [];
    let eligible = 0;
    let determinable = true;
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
        const month = d.slice(0, 7);
        if (!months.has(month))
            months.set(month, allocateMonth(resolved, month, ctx));
        const seg = segmentOf(months.get(month), d);
        const p = placementIn(seg, d);
        if (p.state === "placed") {
            if (p.completedClosure)
                completedClosures.push(d);
            else
                eligible += 1;
            global = ratAdd(global, p.global);
            fixedRegular = ratAdd(fixedRegular, p.fixedRegular);
            rentFixed = ratAdd(rentFixed, p.rentFixed);
        }
        else if (p.state === "no_eligible_allocation_days") {
            unavailable.push(d);
            completedClosures.push(d);
            const key = seg.versionId + "|" + seg.from;
            if (!noEligible.has(key)) {
                noEligible.set(key, { versionId: seg.versionId, from: seg.from, to: seg.to });
                const whole = datesInRange(seg.from, seg.to).every((x) => windowSet.has(x));
                if (whole) {
                    global = ratAdd(global, seg.entitlement.global);
                    fixedRegular = ratAdd(fixedRegular, seg.entitlement.fixedRegular);
                    rentFixed = ratAdd(rentFixed, seg.entitlement.rentFixed);
                }
                else
                    determinable = false;
            }
        }
        const charges = revenueLinkedCharges(v, revenueByDate.has(d) ? (revenueByDate.get(d) ?? RAT_ZERO) : RAT_ZERO);
        rentPct = ratAdd(rentPct, charges.rentPct);
        royaltyPct = ratAdd(royaltyPct, charges.royaltyPct);
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
        allocation: {
            policy: COST_ALLOCATION_POLICY,
            eligibleDates: eligible,
            completedClosureDates: completedClosures,
            noEligibleSegments: [...noEligible.values()],
            placementUnavailableDates: unavailable,
            aggregateDeterminable: determinable,
        },
    };
}
