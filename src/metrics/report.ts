// MARJIN_FIN/1 — actual financial report over canonical days.
//
// Owner decisions (R1.4): BD-1 net-of-VAT basis for revenue, purchases and fixed
// expenses; labor = full employer cost as recorded; BD-2 effective-dated cost timeline;
// BD-3 Actual MTD = recorded information through the current business date, today open,
// calendar-day recognition of fixed and salaried cost, future rows never Actual,
// projections never mixed into Actual. TI-13 ratios are ratios of totals. TI-14 presence
// comes from input state: a period with no recorded revenue has no profit (null), while a
// recorded revenue of 0 is a real fact and can produce a real loss.
import type { AmountString, Dec, Rat } from "../finance/decimal.js";
import {
  DECIMAL_CONTRACT_VERSION, RAT_ZERO, parseAmountString, decAdd, ratAdd, ratDiv, ratFromDec, ratFromInt, ratIsNegative, ratIsZero, ratMul, ratSub,
  serializeDec, serializeRat,
} from "../finance/decimal.js";
import { BUSINESS_TIMEZONE, isBusinessDate, monthBounds, datesInRange } from "../finance/businessDate.js";
import { NORMALIZATION_VERSION, sortFlags } from "../finance/normalize.js";
import { PURCHASE_BASIS_CONTRACT_VERSION, resolvePurchaseBasis, validatePurchaseBasisInput } from "../finance/purchaseBasis.js";
import type { PurchaseBasisResolution } from "../finance/purchaseBasis.js";
import type { BusinessDate, CanonicalDay, Flag, MetricValue, Presence, Quarantine } from "../finance/types.js";
import { FinanceContractError } from "../finance/types.js";
import type { CostTimeline, CostVersionBasis } from "./costTimeline.js";
import { accrueWindow } from "./costTimeline.js";

export const FINANCIAL_FORMULA_VERSION = "MARJIN_FIN/1";

export type ReportWindow =
  | { readonly kind: "open_month"; readonly month: string; readonly asOfBusinessDate: BusinessDate }
  | { readonly kind: "closed_month"; readonly month: string; readonly asOfBusinessDate: BusinessDate };

export interface Coverage {
  readonly expectedDays: number;
  readonly presentDays: number;
  readonly missingDays: readonly BusinessDate[];
  readonly invalidDays: readonly BusinessDate[];
  /** present days on which at least one contributing cell was invalid */
  readonly partialDays: readonly BusinessDate[];
}

export interface MetricTotal {
  /** Sum of recorded facts; null (never "0") when nothing was recorded in the window. */
  readonly value: AmountString | null;
  readonly presentDays: number;
  readonly complete: boolean;
}

export type RatioResult =
  | { readonly state: "value"; readonly value: AmountString }
  | { readonly state: "zero_denominator" | "negative_denominator" | "numerator_missing" | "denominator_missing" };

export type PurchasesPct =
  | { readonly state: "value"; readonly value: AmountString; readonly basisKind: "net_of_vat"; readonly comparability: "same_basis_as_revenue" }
  | { readonly state: "zero_denominator" | "negative_denominator" | "numerator_missing" | "denominator_missing" | "purchase_basis_unresolved" };

export interface FinancialReport {
  readonly versions: { readonly fin: string; readonly norm: string; readonly dec: string; readonly pb: string };
  readonly window: {
    readonly kind: ReportWindow["kind"]; readonly month: string; readonly asOfBusinessDate: BusinessDate;
    readonly state: "actual" | "future_period"; readonly from: BusinessDate | null; readonly to: BusinessDate | null; readonly recognizedDays: number;
  };
  readonly timezone: string;
  readonly vatBasis: "net_of_vat";
  readonly laborCostBasis: "full_employer_cost_as_recorded";
  readonly configurationBasis: readonly CostVersionBasis[];
  readonly costVersionsApplied: readonly string[];
  readonly timelineSource: CostTimeline["timelineSource"];
  readonly today: { readonly date: BusinessDate; readonly state: "open"; readonly dayPresence: "present" | "missing" } | null;
  readonly coverage: { readonly day: Coverage; readonly revenue: Coverage; readonly purchases: Coverage; readonly directLabor: Coverage; readonly otherExpense: Coverage };
  readonly actual: {
    readonly revenue: MetricTotal;
    readonly purchases: MetricTotal & { readonly bySource: Readonly<Record<string, AmountString>>; readonly basis: PurchaseBasisResolution };
    readonly directLabor: MetricTotal;
    readonly otherExpense: MetricTotal;
    readonly salaryAccrued: AmountString;
    readonly fixedAccrual: { readonly regular: AmountString; readonly rentFixed: AmountString; readonly rentPct: AmountString; readonly royaltyPct: AmountString; readonly total: AmountString };
    readonly fullyLoadedLabor: AmountString | null;
    readonly purchasesPct: PurchasesPct;
    readonly directLaborPct: RatioResult;
    readonly fullyLoadedLaborPct: RatioResult;
    readonly averages: { readonly revenuePerPresentDay: RatioResult; readonly purchasesPerPresentDay: RatioResult; readonly directLaborPerPresentDay: RatioResult };
    readonly contributionBeforeFixed: AmountString | null;
    readonly operatingProfit: AmountString | null;
  };
  readonly quarantine: Quarantine;
  readonly flags: readonly Flag[];
}

export interface ReportContext {
  readonly quarantine?: Quarantine;
  readonly flags?: readonly Flag[];
}

function recognizedDates(window: ReportWindow): { dates: BusinessDate[]; state: "actual" | "future_period" } {
  if (!window || (window.kind !== "open_month" && window.kind !== "closed_month")) throw new FinanceContractError("invalid_window_kind");
  if (!isBusinessDate(window.asOfBusinessDate)) throw new FinanceContractError("invalid_as_of", window.asOfBusinessDate);
  const { first, last } = monthBounds(window.month);
  const asOf = window.asOfBusinessDate;
  if (asOf < first) return { dates: [], state: "future_period" };
  if (window.kind === "open_month") {
    if (asOf > last) throw new FinanceContractError("open_month_already_closed", { month: window.month, asOf });
    return { dates: datesInRange(first, asOf), state: "actual" };
  }
  if (asOf <= last) throw new FinanceContractError("closed_month_not_closed", { month: window.month, asOf });
  return { dates: datesInRange(first, last), state: "actual" };
}

function coverageOf(days: readonly CanonicalDay[], pick: (d: CanonicalDay) => Presence | "missing", partialOf: (d: CanonicalDay) => boolean): Coverage {
  const missing: BusinessDate[] = [];
  const invalid: BusinessDate[] = [];
  const partial: BusinessDate[] = [];
  let present = 0;
  for (const d of days) {
    const p = pick(d);
    if (p === "present") {
      present += 1;
      if (partialOf(d)) partial.push(d.date);
    } else if (p === "invalid") invalid.push(d.date);
    else missing.push(d.date);
  }
  return { expectedDays: days.length, presentDays: present, missingDays: missing, invalidDays: invalid, partialDays: partial };
}

function totalOf(days: readonly CanonicalDay[], pick: (d: CanonicalDay) => MetricValue): { total: MetricTotal; rat: Rat | null } {
  let sum: Dec | null = null;
  let present = 0;
  let partial = false;
  for (const d of days) {
    const m = pick(d);
    if (m.presence === "present" && m.value !== null) {
      present += 1;
      if (m.partial) partial = true;
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
export function ratioOfTotals(num: Rat | null, den: Rat | null, scale: Rat = HUNDRED): RatioResult {
  if (den === null) return { state: "denominator_missing" };
  if (num === null) return { state: "numerator_missing" };
  if (ratIsZero(den)) return { state: "zero_denominator" };
  if (ratIsNegative(den)) return { state: "negative_denominator" };
  return { state: "value", value: serializeRat(ratMul(ratDiv(num, den), scale)) };
}

/** Revenue minus recorded variable costs (absent metrics contribute nothing; coverage says so). */
export function contributionOf(revenue: Rat, purchases: Rat | null, directLabor: Rat | null, otherExpense: Rat | null): Rat {
  let c = revenue;
  for (const v of [purchases, directLabor, otherExpense]) if (v !== null) c = ratSub(c, v);
  return c;
}

/** Contribution minus salaried employer cost and fixed/rent/royalty charges. */
export function operatingProfitOf(contribution: Rat, salaried: Rat, fixedTotal: Rat): Rat {
  return ratSub(ratSub(contribution, salaried), fixedTotal);
}

function perPresentDay(total: Rat | null, presentDays: number): RatioResult {
  if (total === null || presentDays < 1) return { state: "denominator_missing" };
  return { state: "value", value: serializeRat(ratDiv(total, ratFromInt(presentDays))) };
}

/**
 * Compute the Actual report for one month window. `purchaseBasis` is REQUIRED (TI-16):
 * a purchase KPI is never produced without a stated basis.
 */
export function computePeriodReport(
  days: readonly CanonicalDay[],
  timeline: CostTimeline,
  purchaseBasis: unknown,
  window: ReportWindow,
  context: ReportContext = {},
): FinancialReport {
  if (arguments.length < 4) throw new FinanceContractError("purchase_basis_required");
  validatePurchaseBasisInput(purchaseBasis);
  const { dates, state } = recognizedDates(window);
  const byDate = new Map<BusinessDate, CanonicalDay>();
  for (const d of days) {
    if (byDate.has(d.date)) throw new FinanceContractError("duplicate_day", d.date);
    byDate.set(d.date, d);
  }
  const missingObjects = dates.filter((d) => !byDate.has(d));
  if (missingObjects.length) throw new FinanceContractError("window_days_incomplete", missingObjects);
  const inWindow = dates.map((d) => byDate.get(d) as CanonicalDay);

  const revenue = totalOf(inWindow, (d) => d.revenue);
  const purchases = totalOf(inWindow, (d) => d.purchases);
  const labor = totalOf(inWindow, (d) => d.directLabor);
  const other = totalOf(inWindow, (d) => d.otherExpense);

  const bySource = new Map<string, Rat>();
  for (const d of inWindow) for (const [k, v] of Object.entries(d.purchases.bySource)) {
    const r = parseAmountString(v);
    bySource.set(k, bySource.has(k) ? ratAdd(bySource.get(k) as Rat, r) : r);
  }
  const purchaseDates = inWindow.filter((d) => d.purchases.presence === "present").map((d) => d.date);
  const basis = resolvePurchaseBasis(purchaseDates, purchaseBasis);

  const revenueByDate = new Map<BusinessDate, Rat | null>();
  for (const d of inWindow) revenueByDate.set(d.date, d.revenue.presence === "present" && d.revenue.value !== null ? ratFromDec(d.revenue.value) : null);
  const accrual = accrueWindow(timeline, dates, revenueByDate);

  const flags: Flag[] = [];
  for (const d of inWindow) flags.push(...d.flags);
  if (context.flags) flags.push(...context.flags);
  if (timeline.flags) flags.push(...timeline.flags);
  for (const d of accrual.uncoveredDates) flags.push({ code: "cost_config_absent", date: d });
  for (const v of accrual.superseded) flags.push({ code: "superseded_versions", key: v });

  const revenuePresentDates = inWindow.filter((d) => d.revenue.presence === "present");
  for (const d of revenuePresentDates) {
    if (d.purchases.presence !== "present") flags.push({ code: "ratio_numerator_incomplete", date: d.date, field: "purchases" });
    if (d.directLabor.presence !== "present") flags.push({ code: "ratio_numerator_incomplete", date: d.date, field: "directLabor" });
  }

  let purchasesPct: PurchasesPct;
  if (basis.kind === "unresolved") purchasesPct = { state: "purchase_basis_unresolved" };
  else {
    const r = ratioOfTotals(purchases.rat, revenue.rat);
    purchasesPct = r.state === "value" ? { state: "value", value: r.value, basisKind: "net_of_vat", comparability: "same_basis_as_revenue" } : r;
  }

  // Cost configuration unknown for any recognised day ⇒ costs are missing, not zero.
  const costKnown = accrual.uncoveredDates.length < 1;
  const salaryConfigured = accrual.salariedEmployeesApplied >= 1;
  // Fully loaded labor = recorded employer cost + accrued salaried employer cost. With neither
  // recorded labor nor any salaried employee configured it is missing (never a "0 %" labor).
  const fullyLoaded = !costKnown || (labor.rat === null && !salaryConfigured)
    ? null
    : ratAdd(labor.rat === null ? RAT_ZERO : labor.rat, accrual.salaried);
  const fixedTotal = ratAdd(ratAdd(accrual.fixedRegular, accrual.rentFixed), ratAdd(accrual.rentPct, accrual.royaltyPct));
  const contribution = revenue.rat === null ? null : contributionOf(revenue.rat, purchases.rat, labor.rat, other.rat);
  const profit = contribution === null || !costKnown ? null : operatingProfitOf(contribution, accrual.salaried, fixedTotal);
  if (profit !== null && flags.some((f) => f.code === "ratio_numerator_incomplete")) flags.push({ code: "profit_components_incomplete" });

  const today = window.kind === "open_month" && state === "actual"
    ? { date: window.asOfBusinessDate, state: "open" as const, dayPresence: (byDate.get(window.asOfBusinessDate) as CanonicalDay).presence.day }
    : null;
  if (today) flags.push({ code: "today_open", date: today.date });

  return {
    versions: { fin: FINANCIAL_FORMULA_VERSION, norm: NORMALIZATION_VERSION, dec: DECIMAL_CONTRACT_VERSION, pb: PURCHASE_BASIS_CONTRACT_VERSION },
    window: { kind: window.kind, month: window.month, asOfBusinessDate: window.asOfBusinessDate, state, from: dates[0] || null, to: dates[dates.length - 1] || null, recognizedDays: dates.length },
    timezone: BUSINESS_TIMEZONE,
    vatBasis: "net_of_vat",
    laborCostBasis: "full_employer_cost_as_recorded",
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
      purchases: { ...purchases.total, bySource: Object.fromEntries([...bySource.keys()].sort().map((k) => [k, serializeRat(bySource.get(k) as Rat)])), basis },
      directLabor: labor.total,
      otherExpense: other.total,
      salaryAccrued: serializeRat(accrual.salaried),
      fixedAccrual: {
        regular: serializeRat(accrual.fixedRegular),
        rentFixed: serializeRat(accrual.rentFixed),
        rentPct: serializeRat(accrual.rentPct),
        royaltyPct: serializeRat(accrual.royaltyPct),
        total: serializeRat(fixedTotal),
      },
      fullyLoadedLabor: fullyLoaded === null ? null : serializeRat(fullyLoaded),
      purchasesPct,
      directLaborPct: ratioOfTotals(labor.rat, revenue.rat),
      fullyLoadedLaborPct: ratioOfTotals(fullyLoaded, revenue.rat),
      averages: {
        revenuePerPresentDay: perPresentDay(revenue.rat, revenue.total.presentDays),
        purchasesPerPresentDay: perPresentDay(purchases.rat, purchases.total.presentDays),
        directLaborPerPresentDay: perPresentDay(labor.rat, labor.total.presentDays),
      },
      contributionBeforeFixed: contribution === null ? null : serializeRat(contribution),
      operatingProfit: profit === null ? null : serializeRat(profit),
    },
    quarantine: context.quarantine || { futureRows: [], invalidDateRows: [] },
    flags: sortFlags(dedupeFlags(flags)),
  };
}

function dedupeFlags(flags: readonly Flag[]): Flag[] {
  const seen = new Set<string>();
  const out: Flag[] = [];
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
export function serializeReport(value: unknown): string {
  const walk = (v: unknown): string => {
    if (v === null || typeof v !== "object") return JSON.stringify(v === undefined ? null : v);
    if (Array.isArray(v)) return "[" + v.map(walk).join(",") + "]";
    const o = v as Record<string, unknown>;
    return "{" + Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => JSON.stringify(k) + ":" + walk(o[k])).join(",") + "}";
  };
  return walk(value);
}
