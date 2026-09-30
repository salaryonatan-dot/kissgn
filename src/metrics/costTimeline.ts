// Effective-dated cost timeline and eligible-day cost allocation (R1.2 doc 02, owner decision
// BD-2; amended by the owner-approved closed-days decision 2026-09-30, CDA-08…CDA-15, CDA-22).
//
// Every amount is NET OF VAT (BD-1). MARJIN_LABOR/3: a global employee's monthly amount IS
// full employer cost (no gross/net concept, no multiplier). Monthly costs (global employer
// cost, fixed items, fixed rent) are ALLOCATED in two steps:
//   1. ENTITLEMENT per month / effective segment, exactly as the approved effective-date
//      contract states it: monthly × (calendar days of the segment) / (calendar days of the
//      month). A closure never changes an entitlement.
//   2. PLACEMENT of that entitlement, in exact rationals, across the segment's cost-allocation-
//      eligible dates: every date except a declared closure that is already COMPLETED (strictly
//      before the one captured business date, i.e. inside D-1). A recorded future closure keeps
//      its placement until it completes; then only its month/segment is recomputed.
// With no eligible date in a segment there is no division, no calendar fallback, no carry to
// another segment and no zero: the placement is typed `no_eligible_allocation_days` while the
// entitlement stays determinable. Percentage rent/royalty depend only on the day's recorded
// revenue. Allocation never depends on entry rows, duplicates, missing days or future rows.
// effectiveTo is always derived.
import type { AmountString, Rat } from "../finance/decimal.js";
import { isCanonicalAmountString, parseAmountString, RAT_ZERO, ratAdd, ratDiv, ratFromInt, ratIsNegative, ratMul } from "../finance/decimal.js";
import { addDays, datesInRange, daysInMonthOf, isBusinessDate, monthBounds } from "../finance/businessDate.js";
import type { BusinessDate, Flag } from "../finance/types.js";
import type { GlobalCostSourceSystem, LaborIngestionMethod } from "../finance/labor.js";
import { FinanceContractError } from "../finance/types.js";

/** A global/full-time employee's monthly FULL EMPLOYER COST. */
export interface GlobalEmployeeEntry {
  readonly employeeKey: string;
  readonly kind: "authoritative_employer_cost";
  readonly monthlyAmount: AmountString;
  readonly sourceSystem: GlobalCostSourceSystem;
  readonly ingestionMethod: LaborIngestionMethod;
}

export type CostVersionBasis = "recorded" | "attested_retroactive" | "current_applied_retrospectively";

export interface CostVersion {
  readonly versionId: string;
  readonly effectiveFrom: BusinessDate; // inclusive
  readonly recordedAt: number; // ms epoch; orders corrections of the same effectiveFrom only
  readonly basis: CostVersionBasis;
  readonly globalEmployees: ReadonlyArray<GlobalEmployeeEntry>;
  readonly fixedItems: ReadonlyArray<{ readonly itemKey: string; readonly monthlyAmount: AmountString }>;
  readonly rent: { readonly mode: "none" } | { readonly mode: "fixed"; readonly monthlyAmount: AmountString } | { readonly mode: "pct"; readonly ratePct: AmountString };
  readonly royalty: { readonly mode: "none" } | { readonly mode: "pct"; readonly ratePct: AmountString };
}

export interface CostTimeline {
  readonly versions: readonly CostVersion[];
  readonly timelineSource: "persisted" | "compat_current_config";
  readonly vatBasis: "net_of_vat";
  readonly flags?: readonly Flag[];
}

export interface ResolvedTimeline {
  /** effective versions ordered by effectiveFrom (corrections collapsed). */
  readonly ordered: readonly CostVersion[];
  readonly superseded: readonly string[];
}

function cmpVersion(a: CostVersion, b: CostVersion): number {
  if (a.recordedAt !== b.recordedAt) return a.recordedAt < b.recordedAt ? -1 : 1;
  return a.versionId < b.versionId ? -1 : a.versionId > b.versionId ? 1 : 0;
}

export function resolveTimeline(timeline: CostTimeline): ResolvedTimeline {
  if (!timeline || !Array.isArray(timeline.versions)) throw new FinanceContractError("cost_timeline_required");
  const byFrom = new Map<string, CostVersion>();
  const superseded: string[] = [];
  for (const v of timeline.versions) {
    if (!isBusinessDate(v.effectiveFrom)) throw new FinanceContractError("invalid_effective_from", v.effectiveFrom);
    if (!Array.isArray(v.globalEmployees)) throw new FinanceContractError("global_employees_required", v.versionId);
    for (const e of v.globalEmployees) {
      if (!e || e.kind !== "authoritative_employer_cost") throw new FinanceContractError("global_cost_not_employer_cost", { versionId: v.versionId, employeeKey: e && e.employeeKey });
      if (typeof e.monthlyAmount !== "string" || !isCanonicalAmountString(e.monthlyAmount) || ratIsNegative(parseAmountString(e.monthlyAmount))) {
        throw new FinanceContractError("invalid_global_amount", { versionId: v.versionId, employeeKey: e.employeeKey });
      }
    }
    const prev = byFrom.get(v.effectiveFrom);
    if (!prev) byFrom.set(v.effectiveFrom, v);
    else if (cmpVersion(v, prev) > 0) {
      superseded.push(prev.versionId);
      byFrom.set(v.effectiveFrom, v);
    } else superseded.push(v.versionId);
  }
  const ordered = [...byFrom.values()].sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? -1 : a.effectiveFrom > b.effectiveFrom ? 1 : 0));
  return { ordered, superseded: superseded.sort() };
}

export function versionForDay(resolved: ResolvedTimeline, date: BusinessDate): CostVersion | null {
  let found: CostVersion | null = null;
  for (const v of resolved.ordered) if (v.effectiveFrom <= date) found = v;
  return found;
}

const HUNDRED = ratFromInt(100);

function sumAmounts(values: readonly AmountString[]): Rat {
  let acc = RAT_ZERO;
  for (const v of values) acc = ratAdd(acc, parseAmountString(v));
  return acc;
}

/** Percentage rent / royalty on a revenue amount under one version (shared by accrual and projection). */
export function revenueLinkedCharges(version: CostVersion, revenue: Rat): { rentPct: Rat; royaltyPct: Rat } {
  const rentPct = version.rent.mode === "pct" ? ratMul(ratDiv(parseAmountString(version.rent.ratePct), HUNDRED), revenue) : RAT_ZERO;
  const royaltyPct = version.royalty.mode === "pct" ? ratMul(ratDiv(parseAmountString(version.royalty.ratePct), HUNDRED), revenue) : RAT_ZERO;
  return { rentPct, royaltyPct };
}


// ── Eligible-day allocation (CDA-09 / CDA-10 / CDA-14) ─────────────────────────────
export const COST_ALLOCATION_POLICY = "eligible_days_excluding_completed_closures";

/**
 * The closure knowledge an allocation needs: the declared closures (any date) and the ONE
 * captured business date. A closure is COMPLETED when its date is < asOfBusinessDate (the D-1
 * Actual boundary); only completed closures leave the denominator. `asOfBusinessDate: null`
 * means no completion is known (then no closure is completed — pure calendar placement).
 */
export interface AllocationContext {
  readonly asOfBusinessDate: BusinessDate | null;
  readonly closedDates: readonly BusinessDate[];
}
export const NO_CLOSURE_ALLOCATION: AllocationContext = Object.freeze({ asOfBusinessDate: null, closedDates: Object.freeze([]) as readonly BusinessDate[] });

export function isCompletedClosure(date: BusinessDate, ctx: AllocationContext, closed: ReadonlySet<BusinessDate>): boolean {
  return ctx.asOfBusinessDate !== null && closed.has(date) && date < ctx.asOfBusinessDate;
}

export interface SegmentAllocation {
  readonly month: string;
  readonly versionId: string;
  readonly from: BusinessDate;
  readonly to: BusinessDate;
  readonly calendarDays: number;
  /** cost-allocation-eligible dates of the segment (all dates except COMPLETED declared closures) */
  readonly eligibleDates: readonly BusinessDate[];
  /** completed declared closures of the segment (placement 0) */
  readonly completedClosureDates: readonly BusinessDate[];
  readonly entitlement: { readonly global: Rat; readonly fixedRegular: Rat; readonly rentFixed: Rat };
  readonly state: "allocated" | "no_eligible_allocation_days";
}

export interface MonthAllocation {
  readonly month: string;
  readonly segments: readonly SegmentAllocation[];
  /** month dates with no version in force (pre-activation / uncovered history) */
  readonly uncoveredDates: readonly BusinessDate[];
}

function validateAllocationContext(ctx: AllocationContext): AllocationContext {
  if (!ctx || typeof ctx !== "object" || !Array.isArray(ctx.closedDates)) throw new FinanceContractError("invalid_allocation_context");
  if (ctx.asOfBusinessDate !== null && !isBusinessDate(ctx.asOfBusinessDate)) throw new FinanceContractError("invalid_as_of", ctx.asOfBusinessDate);
  for (const d of ctx.closedDates) if (!isBusinessDate(d)) throw new FinanceContractError("invalid_allocation_context", d);
  return ctx;
}

/** Entitlement then eligible-date placement for every effective segment of one month. */
export function allocateMonth(resolved: ResolvedTimeline, month: string, ctx: AllocationContext): MonthAllocation {
  validateAllocationContext(ctx);
  const { first, last } = monthBounds(month);
  const dim = ratFromInt(daysInMonthOf(first));
  const closed = new Set(ctx.closedDates);
  const segments: SegmentAllocation[] = [];
  const uncovered: BusinessDate[] = [];
  const ordered = resolved.ordered;
  // dates before the first version in force are uncovered (never invented)
  const firstFrom = ordered.length ? ordered[0].effectiveFrom : null;
  for (const d of datesInRange(first, last)) if (firstFrom === null || d < firstFrom) uncovered.push(d);
  for (let i = 0; i < ordered.length; i += 1) {
    const v = ordered[i];
    const next = i + 1 < ordered.length ? ordered[i + 1].effectiveFrom : null;
    const from = v.effectiveFrom > first ? v.effectiveFrom : first;
    const toExcl = next === null ? null : next;
    const to = toExcl !== null && toExcl <= last ? addDays(toExcl, -1) : last;
    if (from > last || to < first || from > to) continue;
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

export type DayPlacement =
  | { readonly state: "placed"; readonly versionId: string; readonly global: Rat; readonly fixedRegular: Rat; readonly rentFixed: Rat; readonly completedClosure: boolean }
  | { readonly state: "no_eligible_allocation_days"; readonly versionId: string; readonly from: BusinessDate; readonly to: BusinessDate }
  | { readonly state: "uncovered" };

function placementIn(seg: SegmentAllocation, date: BusinessDate): DayPlacement {
  if (seg.state === "no_eligible_allocation_days") return { state: "no_eligible_allocation_days", versionId: seg.versionId, from: seg.from, to: seg.to };
  if (!seg.eligibleDates.includes(date)) return { state: "placed", versionId: seg.versionId, global: RAT_ZERO, fixedRegular: RAT_ZERO, rentFixed: RAT_ZERO, completedClosure: true };
  const n = ratFromInt(seg.eligibleDates.length);
  return { state: "placed", versionId: seg.versionId, global: ratDiv(seg.entitlement.global, n), fixedRegular: ratDiv(seg.entitlement.fixedRegular, n), rentFixed: ratDiv(seg.entitlement.rentFixed, n), completedClosure: false };
}

function segmentOf(alloc: MonthAllocation, date: BusinessDate): SegmentAllocation | null {
  for (const s of alloc.segments) if (s.from <= date && date <= s.to) return s;
  return null;
}

/** The monthly-cost placement of ONE date (its month/segment computed whole — the only divisor). */
export function dayPlacement(timeline: CostTimeline, date: BusinessDate, ctx: AllocationContext = NO_CLOSURE_ALLOCATION): DayPlacement {
  if (!isBusinessDate(date)) throw new FinanceContractError("invalid_date", date);
  const alloc = allocateMonth(resolveTimeline(timeline), date.slice(0, 7), ctx);
  const seg = segmentOf(alloc, date);
  return seg === null ? { state: "uncovered" } : placementIn(seg, date);
}

export interface WindowAccrual {
  readonly global: Rat;
  readonly fixedRegular: Rat;
  readonly rentFixed: Rat;
  readonly rentPct: Rat;
  readonly royaltyPct: Rat;
  readonly total: Rat;
  readonly configurationBasis: readonly CostVersionBasis[];
  readonly versionsApplied: readonly string[];
  readonly superseded: readonly string[];
  readonly uncoveredDates: readonly BusinessDate[];
  /** distinct global employees with an employer-cost entry in the window */
  readonly globalEmployeesApplied: number;
  /** true when a percentage rent or royalty was in force on at least one recognised date */
  readonly revenueLinked: boolean;
  /** CDA-14 / CDA-15: how the monthly costs of the window were placed. */
  readonly allocation: {
    readonly policy: string;
    /** cost-allocation-eligible window dates (with a version in force) */
    readonly eligibleDates: number;
    /** completed declared closures in the window (placement 0) */
    readonly completedClosureDates: readonly BusinessDate[];
    /** segments without any eligible date: placement unavailable, entitlement kept */
    readonly noEligibleSegments: ReadonlyArray<{ readonly versionId: string; readonly from: BusinessDate; readonly to: BusinessDate }>;
    /** window dates whose daily placement is unavailable */
    readonly placementUnavailableDates: readonly BusinessDate[];
    /** false only when a no-eligible segment lies partly outside the window (its window share is not determinable) */
    readonly aggregateDeterminable: boolean;
  };
}

/**
 * Monthly-cost allocation summed over `dates` (any window). An allocated segment contributes
 * its placements on the window dates; a segment without eligible dates contributes its whole
 * entitlement when the window contains the whole segment (the aggregate is determinable), and
 * leaves the aggregate undeterminable otherwise. Percentage charges use each date's revenue.
 */
export function accrueWindow(timeline: CostTimeline, dates: readonly BusinessDate[], revenueByDate: ReadonlyMap<BusinessDate, Rat | null>, ctx: AllocationContext = NO_CLOSURE_ALLOCATION): WindowAccrual {
  const resolved = resolveTimeline(timeline);
  validateAllocationContext(ctx);
  let global = RAT_ZERO, fixedRegular = RAT_ZERO, rentFixed = RAT_ZERO, rentPct = RAT_ZERO, royaltyPct = RAT_ZERO;
  const bases = new Set<CostVersionBasis>();
  const applied = new Set<string>();
  const globalKeys = new Set<string>();
  let revenueLinked = false;
  const uncovered: BusinessDate[] = [];
  const months = new Map<string, MonthAllocation>();
  const windowSet = new Set(dates);
  const noEligible = new Map<string, { versionId: string; from: BusinessDate; to: BusinessDate }>();
  const unavailable: BusinessDate[] = [];
  const completedClosures: BusinessDate[] = [];
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
    for (const e of v.globalEmployees) globalKeys.add(e.employeeKey);
    if (v.rent.mode === "pct" || v.royalty.mode === "pct") revenueLinked = true;
    const month = d.slice(0, 7);
    if (!months.has(month)) months.set(month, allocateMonth(resolved, month, ctx));
    const seg = segmentOf(months.get(month) as MonthAllocation, d) as SegmentAllocation;
    const p = placementIn(seg, d);
    if (p.state === "placed") {
      if (p.completedClosure) completedClosures.push(d);
      else eligible += 1;
      global = ratAdd(global, p.global);
      fixedRegular = ratAdd(fixedRegular, p.fixedRegular);
      rentFixed = ratAdd(rentFixed, p.rentFixed);
    } else if (p.state === "no_eligible_allocation_days") {
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
        } else determinable = false;
      }
    }
    const charges = revenueLinkedCharges(v, revenueByDate.has(d) ? ((revenueByDate.get(d) as Rat | null) ?? RAT_ZERO) : RAT_ZERO);
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
