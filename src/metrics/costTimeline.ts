// Effective-dated cost timeline and calendar-day accrual (R1.2 doc 02, owner decision BD-2).
//
// Every amount is NET OF VAT (BD-1). MARJIN_LABOR/2: a global employee's monthly amount IS
// full employer cost (no gross/net concept, no multiplier). Global employer cost and fixed
// costs accrue by CALENDAR DAY (monthly / calendar days of the month) on every recognised
// date — closed days included, never conditioned on revenue or on operating-day counts.
// Only percentage rent/royalty depend on the day's recorded revenue.
// Accrual never depends on entry rows, duplicates, missing days or future rows.
// effectiveTo is always derived.
import type { AmountString, Rat } from "../finance/decimal.js";
import { isCanonicalAmountString, parseAmountString, RAT_ZERO, ratAdd, ratDiv, ratFromInt, ratIsNegative, ratMul } from "../finance/decimal.js";
import { daysInMonthOf, isBusinessDate } from "../finance/businessDate.js";
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

export interface DayAccrual {
  readonly global: Rat;
  readonly fixedRegular: Rat;
  readonly rentFixed: Rat;
  readonly rentPct: Rat;
  readonly royaltyPct: Rat;
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

/**
 * One calendar day's recognised cost under the version in force that day. Monthly amounts
 * (global employer cost, fixed items, fixed rent) accrue as monthly / daysInMonth(day) on
 * EVERY calendar day. Percentage rent/royalty apply to the day's recorded revenue (null ⇒
 * no recorded revenue ⇒ nothing to apply the rate to).
 */
export function accrueDay(version: CostVersion, date: BusinessDate, dayRevenue: Rat | null): DayAccrual {
  const dim = ratFromInt(daysInMonthOf(date));
  const perDay = (monthly: Rat) => ratDiv(monthly, dim);
  const revenue = dayRevenue === null ? RAT_ZERO : dayRevenue;
  const global = perDay(sumAmounts(version.globalEmployees.map((e) => e.monthlyAmount)));
  const fixedRegular = perDay(sumAmounts(version.fixedItems.map((f) => f.monthlyAmount)));
  const rentFixed = version.rent.mode === "fixed" ? perDay(parseAmountString(version.rent.monthlyAmount)) : RAT_ZERO;
  const { rentPct, royaltyPct } = revenueLinkedCharges(version, revenue);
  return { global, fixedRegular, rentFixed, rentPct, royaltyPct };
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
}

export function accrueWindow(timeline: CostTimeline, dates: readonly BusinessDate[], revenueByDate: ReadonlyMap<BusinessDate, Rat | null>): WindowAccrual {
  const resolved = resolveTimeline(timeline);
  let global = RAT_ZERO, fixedRegular = RAT_ZERO, rentFixed = RAT_ZERO, rentPct = RAT_ZERO, royaltyPct = RAT_ZERO;
  const bases = new Set<CostVersionBasis>();
  const applied = new Set<string>();
  const globalKeys = new Set<string>();
  let revenueLinked = false;
  const uncovered: BusinessDate[] = [];
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
    const a = accrueDay(v, d, revenueByDate.has(d) ? (revenueByDate.get(d) as Rat | null) : null);
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
