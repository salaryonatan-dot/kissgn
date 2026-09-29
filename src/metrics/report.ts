// MARJIN_FIN/2 — actual financial report over canonical days.
//
// Owner decisions (R1.4; FINAL owner contract 2026-09-29): BD-1 net-of-VAT basis for revenue,
// purchases and fixed expenses. MARJIN_LABOR/2: canonical labor = hourly employees'
// authoritative employer cost (ShiftOrganizer, entered manually on `payroll`) + global
// employees' monthly employer cost allocated by calendar day; fixed costs allocated by
// calendar day; closed days still carry global and fixed cost; `hourly_payroll` is never
// counted. ACTUAL WINDOW (manual operation): Actual MTD = month start through the LAST
// COMPLETED BUSINESS DAY = D-1 of the as-of (current) business date. The current day is
// outside Actual for every amount, cost accrual and KPI; it belongs to projection context.
// Closed (declared non-operating) days and missing days are distinct: a day is closed only
// when the caller's operating calendar declares it; absent data is never inferred to be a
// closure. TI-13 ratios are ratios of totals. TI-14 presence comes from input state. TI-18: a
// profit/contribution/labor total is a typed result — a number exists ONLY when every
// required component is complete.
import type { AmountString, Dec, Rat } from "../finance/decimal.js";
import {
  DECIMAL_CONTRACT_VERSION, RAT_ZERO, parseAmountString, decAdd, decIsZero, ratAdd, ratDiv, ratFromDec, ratFromInt, ratIsNegative, ratIsZero, ratMul, ratSub,
  serializeDec, serializeRat,
} from "../finance/decimal.js";
import { BUSINESS_TIMEZONE, addDays, isBusinessDate, monthBounds, datesInRange } from "../finance/businessDate.js";
import { NORMALIZATION_VERSION, sortFlags } from "../finance/normalize.js";
import { PURCHASE_BASIS_CONTRACT_VERSION, resolvePurchaseBasis, validatePurchaseBasisInput } from "../finance/purchaseBasis.js";
import type { PurchaseBasisResolution } from "../finance/purchaseBasis.js";
import { FIXED_COST_ALLOCATION, GLOBAL_COST_ALLOCATION, LABOR_CONTRACT_VERSION, validateLaborSource } from "../finance/labor.js";
import type { LaborSourceInput } from "../finance/labor.js";
import type { BusinessDate, CanonicalDay, Flag, MetricValue, Presence, Quarantine } from "../finance/types.js";
import { FinanceContractError } from "../finance/types.js";
import type { CostTimeline, CostVersionBasis } from "./costTimeline.js";
import { accrueWindow } from "./costTimeline.js";

export const FINANCIAL_FORMULA_VERSION = "MARJIN_FIN/2";
/** Manual-operation Actual window rule. A future live/same-day model is deferred and would be a new rule. */
export const ACTUAL_WINDOW_RULE = "completed_days_through_d_minus_1";

/** `asOfBusinessDate` is the CURRENT business date; Actual ends at the last completed day before it. */
export type ReportWindow =
  | { readonly kind: "open_month"; readonly month: string; readonly asOfBusinessDate: BusinessDate }
  | { readonly kind: "closed_month"; readonly month: string; readonly asOfBusinessDate: BusinessDate };

/**
 * Declared non-operating days. A day is CLOSED only when declared here; a day without data
 * that is not declared closed is MISSING. `source` states where the declaration came from
 * ("none_declared" when the caller has no calendar — then every day is an expected day).
 */
export interface OperatingCalendar {
  readonly source: string;
  readonly closedDates: readonly BusinessDate[];
}
export const NO_DECLARED_CLOSURES: OperatingCalendar = Object.freeze({ source: "none_declared", closedDates: Object.freeze([]) as readonly BusinessDate[] });

export interface Coverage {
  /** operating (non-closed) recognised days */
  readonly expectedDays: number;
  readonly presentDays: number;
  readonly missingDays: readonly BusinessDate[];
  readonly invalidDays: readonly BusinessDate[];
  /** present days on which at least one contributing cell was invalid */
  readonly partialDays: readonly BusinessDate[];
  /** declared closed days in the window (not expected, never missing) */
  readonly closedDays: readonly BusinessDate[];
}

export interface MetricTotal {
  /** Sum of recorded facts; null (never "0") when nothing was recorded in the window. */
  readonly value: AmountString | null;
  readonly presentDays: number;
  /** every operating day recorded and no partially invalid value */
  readonly complete: boolean;
}

export type RatioResult =
  | { readonly state: "value"; readonly value: AmountString }
  | { readonly state: "zero_denominator" | "negative_denominator" | "numerator_missing" | "denominator_missing" | "incomplete_components" | "invalid_components" | "empty_window" };

export type PurchasesPct =
  | { readonly state: "value"; readonly value: AmountString; readonly basisKind: "net_of_vat"; readonly comparability: "same_basis_as_revenue" }
  | { readonly state: "zero_denominator" | "negative_denominator" | "numerator_missing" | "denominator_missing" | "purchase_basis_unresolved" | "incomplete_components" | "invalid_components" | "empty_window" };

export type ProfitComponent =
  | "revenue" | "purchases" | "hourly_employer_cost" | "global_employer_cost" | "other_expense" | "cost_configuration" | "operating_calendar";

export interface ComponentIssue {
  readonly component: ProfitComponent;
  readonly kind: "missing" | "invalid";
  readonly reason: string;
  readonly dates: readonly BusinessDate[];
}

/** TI-18: numeric value ONLY when state is "complete". "empty_window": no completed day yet. */
export type TypedAmount =
  | { readonly state: "complete"; readonly value: AmountString; readonly issues: readonly [] }
  | { readonly state: "revenue_missing" | "incomplete_components" | "invalid_components" | "empty_window"; readonly value: null; readonly issues: readonly ComponentIssue[] };

export interface LaborReport {
  readonly contract: string;
  /** provenance of the hourly employer cost (`payroll`) */
  readonly source: LaborSourceInput;
  /** Hourly employees' authoritative employer cost entered on `payroll`, recorded facts. */
  readonly hourlyEmployerCost: MetricTotal;
  /** Global employees' monthly employer cost allocated over the window's calendar days. */
  readonly globalEmployerCost: TypedAmount;
  readonly globalAllocation: "calendar_days";
  readonly globalEmployeesApplied: number;
  /** Canonical labor = hourly + global allocation. */
  readonly employerCost: TypedAmount;
  readonly employerCostPct: RatioResult;
  /** LEGACY `hourly_payroll`: recorded on these dates, never counted. */
  readonly legacyHourlyPayroll: { readonly counted: false; readonly dates: readonly BusinessDate[] };
}

export interface FinancialReport {
  readonly versions: { readonly fin: string; readonly norm: string; readonly dec: string; readonly pb: string; readonly labor: string };
  readonly window: {
    readonly kind: ReportWindow["kind"]; readonly month: string; readonly asOfBusinessDate: BusinessDate; readonly rule: string;
    readonly state: "actual" | "no_completed_days" | "future_period"; readonly from: BusinessDate | null; readonly to: BusinessDate | null;
    readonly completedThrough: BusinessDate | null; readonly recognizedDays: number;
    /** the current business date when it falls inside the month: always OUTSIDE Actual */
    readonly currentDay: { readonly date: BusinessDate; readonly inActual: false } | null;
  };
  readonly operatingCalendar: { readonly source: string; readonly closedDates: readonly BusinessDate[]; readonly operatingDays: number };
  readonly timezone: string;
  readonly vatBasis: "net_of_vat";
  readonly configurationBasis: readonly CostVersionBasis[];
  readonly costVersionsApplied: readonly string[];
  readonly timelineSource: CostTimeline["timelineSource"];
  readonly coverage: { readonly day: Coverage; readonly revenue: Coverage; readonly purchases: Coverage; readonly hourlyLabor: Coverage; readonly otherExpense: Coverage };
  readonly actual: {
    readonly revenue: MetricTotal;
    readonly purchases: MetricTotal & { readonly bySource: Readonly<Record<string, AmountString>>; readonly basis: PurchaseBasisResolution };
    readonly hourlyLabor: MetricTotal;
    readonly otherExpense: MetricTotal;
    readonly labor: LaborReport;
    /** Calendar-day fixed cost. Amounts exist ONLY when state is "complete" (configuration covers every day, no missing/invalid value, and — when a percentage rent/royalty applies — revenue is complete). */
    readonly fixedAccrual: {
      readonly allocation: "calendar_days";
      readonly state: TypedAmount["state"];
      readonly issues: readonly ComponentIssue[];
      readonly regular: AmountString | null; readonly rentFixed: AmountString | null; readonly rentPct: AmountString | null; readonly royaltyPct: AmountString | null; readonly total: AmountString | null;
    };
    readonly purchasesPct: PurchasesPct;
    readonly averages: { readonly revenuePerPresentDay: RatioResult; readonly purchasesPerPresentDay: RatioResult; readonly hourlyLaborPerPresentDay: RatioResult };
    readonly contributionBeforeFixed: TypedAmount;
    readonly operatingProfit: TypedAmount;
  };
  readonly quarantine: Quarantine;
  readonly flags: readonly Flag[];
}

export interface ReportContext {
  readonly quarantine?: Quarantine;
  readonly flags?: readonly Flag[];
  readonly operatingCalendar?: OperatingCalendar;
}

interface WindowDates {
  readonly dates: BusinessDate[];
  readonly state: "actual" | "no_completed_days" | "future_period";
  readonly completedThrough: BusinessDate | null;
  readonly currentDay: BusinessDate | null;
}

/**
 * Recognised Actual dates. open_month: month start through asOf − 1 (the last completed
 * business day); the as-of (current) day is never recognised. closed_month: the whole month
 * (asOf must be after the month, so its last day is completed).
 */
export function actualWindowDates(window: ReportWindow): WindowDates {
  if (!window || (window.kind !== "open_month" && window.kind !== "closed_month")) throw new FinanceContractError("invalid_window_kind");
  if (!isBusinessDate(window.asOfBusinessDate)) throw new FinanceContractError("invalid_as_of", window.asOfBusinessDate);
  const { first, last } = monthBounds(window.month);
  const asOf = window.asOfBusinessDate;
  if (asOf < first) return { dates: [], state: "future_period", completedThrough: null, currentDay: null };
  if (window.kind === "open_month") {
    if (asOf > last) throw new FinanceContractError("open_month_already_closed", { month: window.month, asOf });
    const lastCompleted = addDays(asOf, -1);
    if (lastCompleted < first) return { dates: [], state: "no_completed_days", completedThrough: null, currentDay: asOf };
    return { dates: datesInRange(first, lastCompleted), state: "actual", completedThrough: lastCompleted, currentDay: asOf };
  }
  if (asOf <= last) throw new FinanceContractError("closed_month_not_closed", { month: window.month, asOf });
  return { dates: datesInRange(first, last), state: "actual", completedThrough: last, currentDay: null };
}

function validateCalendar(c: unknown): OperatingCalendar {
  if (c === undefined) return NO_DECLARED_CLOSURES;
  const o = c as Record<string, unknown>;
  if (!o || typeof o !== "object" || typeof o.source !== "string" || o.source === "" || !Array.isArray(o.closedDates)) {
    throw new FinanceContractError("invalid_operating_calendar");
  }
  const seen = new Set<string>();
  for (const d of o.closedDates) {
    if (!isBusinessDate(d) || seen.has(d)) throw new FinanceContractError("invalid_operating_calendar", d);
    seen.add(d);
  }
  return c as OperatingCalendar;
}

function coverageOf(
  days: readonly CanonicalDay[], closed: ReadonlySet<BusinessDate>, pick: (d: CanonicalDay) => Presence | "missing", partialOf: (d: CanonicalDay) => boolean,
): Coverage {
  const missing: BusinessDate[] = [];
  const invalid: BusinessDate[] = [];
  const partial: BusinessDate[] = [];
  const closedDays: BusinessDate[] = [];
  let present = 0;
  let expected = 0;
  for (const d of days) {
    if (closed.has(d.date)) {
      closedDays.push(d.date);
      continue;
    }
    expected += 1;
    const p = pick(d);
    if (p === "present") {
      present += 1;
      if (partialOf(d)) partial.push(d.date);
    } else if (p === "invalid") invalid.push(d.date);
    else missing.push(d.date);
  }
  return { expectedDays: expected, presentDays: present, missingDays: missing, invalidDays: invalid, partialDays: partial, closedDays };
}

function totalOf(days: readonly CanonicalDay[], closed: ReadonlySet<BusinessDate>, pick: (d: CanonicalDay) => MetricValue): { total: MetricTotal; rat: Rat | null; operatingPresent: number } {
  let sum: Dec | null = null;
  let present = 0;
  let operatingPresent = 0;
  let operating = 0;
  let partial = false;
  for (const d of days) {
    const m = pick(d);
    if (!closed.has(d.date)) operating += 1;
    if (m.presence === "present" && m.value !== null) {
      present += 1;
      if (!closed.has(d.date)) operatingPresent += 1;
      if (m.partial) partial = true;
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
export function ratioOfTotals(num: Rat | null, den: Rat | null, scale: Rat = HUNDRED): RatioResult {
  if (den === null) return { state: "denominator_missing" };
  if (num === null) return { state: "numerator_missing" };
  if (ratIsZero(den)) return { state: "zero_denominator" };
  if (ratIsNegative(den)) return { state: "negative_denominator" };
  return { state: "value", value: serializeRat(ratMul(ratDiv(num, den), scale)) };
}

/** Revenue minus variable costs (purchases, hourly employer cost, other expense). Only called when every operand is complete (TI-18). */
export function contributionOf(revenue: Rat, purchases: Rat, hourlyLabor: Rat, otherExpense: Rat): Rat {
  return ratSub(ratSub(ratSub(revenue, purchases), hourlyLabor), otherExpense);
}

/** Contribution minus the global employer-cost allocation and fixed/rent/royalty charges. */
export function operatingProfitOf(contribution: Rat, globalLabor: Rat, fixedTotal: Rat): Rat {
  return ratSub(ratSub(contribution, globalLabor), fixedTotal);
}

/** Issues of one day-level metric: invalid/partial on any recognised day; missing only on operating (non-closed) days. */
function metricIssues(days: readonly CanonicalDay[], closed: ReadonlySet<BusinessDate>, component: ProfitComponent, pick: (d: CanonicalDay) => MetricValue, required: boolean): ComponentIssue[] {
  const missing: BusinessDate[] = [];
  const invalid: BusinessDate[] = [];
  for (const d of days) {
    const m = pick(d);
    if (m.presence === "invalid" || (m.presence === "present" && m.partial)) invalid.push(d.date);
    else if (m.presence === "absent" && required && !closed.has(d.date)) missing.push(d.date);
  }
  const out: ComponentIssue[] = [];
  if (invalid.length >= 1) out.push({ component, kind: "invalid", reason: "invalid_or_partial_value", dates: invalid });
  if (missing.length >= 1) out.push({ component, kind: "missing", reason: "not_recorded", dates: missing });
  return out;
}

/** The value is computed ONLY when the window has days and no required component has an issue (TI-18). */
function typedAmount(compute: () => Rat, issues: readonly ComponentIssue[], revenueKnown: boolean, empty: boolean): TypedAmount {
  if (empty) return { state: "empty_window", value: null, issues: [] };
  if (issues.some((i) => i.kind === "invalid")) return { state: "invalid_components", value: null, issues };
  if (!revenueKnown) return { state: "revenue_missing", value: null, issues };
  if (issues.length >= 1) return { state: "incomplete_components", value: null, issues };
  return { state: "complete", value: serializeRat(compute()), issues: [] };
}

const CONFIG_INVALID_CODES: readonly string[] = ["invalid_fixed_amount", "invalid_rate"];
const CONFIG_MISSING_CODES: readonly string[] = ["missing_fixed_amount", "missing_rate"];

/** Average per recorded OPERATING day (declared closed days are not in the denominator). */
function perPresentDay(total: Rat | null, presentDays: number): RatioResult {
  if (total === null || presentDays < 1) return { state: "denominator_missing" };
  return { state: "value", value: serializeRat(ratDiv(total, ratFromInt(presentDays))) };
}

function flagIssue(flags: readonly Flag[], codes: readonly string[], component: ProfitComponent, kind: "missing" | "invalid", dates: readonly BusinessDate[]): ComponentIssue[] {
  const hit = flags.filter((f) => codes.includes(f.code));
  if (hit.length < 1 || dates.length < 1) return [];
  return [{ component, kind, reason: hit.map((f) => f.code + ":" + (f.key || f.field || "")).sort().join(","), dates }];
}

const nonZero = (m: MetricValue): boolean => m.presence === "present" && m.value !== null && !decIsZero(m.value);

/**
 * Compute the Actual report for one month window. `purchaseBasis` (TI-16) and `laborSource`
 * (MARJIN_LABOR/2) are REQUIRED: no purchase KPI without a stated basis and no labor cost
 * without the stated authoritative hourly employer-cost source.
 */
export function computePeriodReport(
  days: readonly CanonicalDay[],
  timeline: CostTimeline,
  purchaseBasis: unknown,
  laborSource: unknown,
  window: ReportWindow,
  context: ReportContext = {},
): FinancialReport {
  if (arguments.length < 5) throw new FinanceContractError("labor_source_required");
  validatePurchaseBasisInput(purchaseBasis);
  const labor = validateLaborSource(laborSource);
  const calendar = validateCalendar(context.operatingCalendar);
  const win = actualWindowDates(window);
  const dates = win.dates;
  const byDate = new Map<BusinessDate, CanonicalDay>();
  for (const d of days) {
    if (byDate.has(d.date)) throw new FinanceContractError("duplicate_day", d.date);
    byDate.set(d.date, d);
  }
  const missingObjects = dates.filter((d) => !byDate.has(d));
  if (missingObjects.length) throw new FinanceContractError("window_days_incomplete", missingObjects);
  // Only recognised (completed) dates enter Actual; a supplied current-day or later object is ignored.
  const inWindow = dates.map((d) => byDate.get(d) as CanonicalDay);
  const windowSet = new Set(dates);
  const closed = new Set(calendar.closedDates.filter((d) => windowSet.has(d)));
  const closedInWindow = dates.filter((d) => closed.has(d));
  const operatingCount = dates.length - closedInWindow.length;
  const empty = dates.length < 1;
  const noOperatingDays = operatingCount < 1;

  const revenue = totalOf(inWindow, closed, (d) => d.revenue);
  const purchases = totalOf(inWindow, closed, (d) => d.purchases);
  const hourly = totalOf(inWindow, closed, (d) => d.hourlyLabor);
  const other = totalOf(inWindow, closed, (d) => d.otherExpense);

  const bySource = new Map<string, Rat>();
  for (const d of inWindow) for (const [k, v] of Object.entries(d.purchases.bySource)) {
    const r = parseAmountString(v);
    bySource.set(k, bySource.has(k) ? ratAdd(bySource.get(k) as Rat, r) : r);
  }
  const purchaseDates = inWindow.filter((d) => d.purchases.presence === "present").map((d) => d.date);
  const basis = resolvePurchaseBasis(purchaseDates, purchaseBasis);

  const revenueByDate = new Map<BusinessDate, Rat | null>();
  for (const d of inWindow) revenueByDate.set(d.date, d.revenue.presence === "present" && d.revenue.value !== null ? ratFromDec(d.revenue.value) : null);
  // Calendar-day accrual over EVERY recognised date (closed days included).
  const accrual = accrueWindow(timeline, dates, revenueByDate);
  const timelineFlags = timeline.flags || [];

  const flags: Flag[] = [];
  for (const d of inWindow) flags.push(...d.flags);
  if (context.flags) flags.push(...context.flags);
  flags.push(...timelineFlags);
  for (const d of accrual.uncoveredDates) flags.push({ code: "cost_config_absent", date: d });
  for (const v of accrual.superseded) flags.push({ code: "superseded_versions", key: v });

  const revenuePresentDates = inWindow.filter((d) => d.revenue.presence === "present");
  for (const d of revenuePresentDates) {
    if (d.purchases.presence !== "present") flags.push({ code: "ratio_numerator_incomplete", date: d.date, field: "purchases" });
    if (d.hourlyLabor.presence !== "present") flags.push({ code: "ratio_numerator_incomplete", date: d.date, field: "hourlyLabor" });
  }

  // ── Completeness (TI-18). Required on every OPERATING recognised day: revenue, purchases
  // and the hourly employer cost (an explicit 0 / "skip" is a complete fact). Declared closed
  // days require none of them, but recorded non-zero revenue or hourly labor on a closed day
  // contradicts the declaration (invalid). other_expense is optional (absence = none
  // recorded); an invalid value is an invalid component on any day. Global employer cost and
  // fixed configuration must cover every recognised day and carry no missing/invalid value.
  const revenueIssues = metricIssues(inWindow, closed, "revenue", (d) => d.revenue, true);
  const purchaseIssues = metricIssues(inWindow, closed, "purchases", (d) => d.purchases, true);
  const hourlyIssues = metricIssues(inWindow, closed, "hourly_employer_cost", (d) => d.hourlyLabor, true);
  const otherIssues = metricIssues(inWindow, closed, "other_expense", (d) => d.otherExpense, false);
  const contradicted = inWindow.filter((d) => closed.has(d.date) && (nonZero(d.revenue) || nonZero(d.hourlyLabor))).map((d) => d.date);
  for (const d of contradicted) flags.push({ code: "closed_day_has_recorded_values", date: d });
  const calendarIssues: ComponentIssue[] = contradicted.length >= 1
    ? [{ component: "operating_calendar", kind: "invalid", reason: "closed_day_has_recorded_values", dates: contradicted }]
    : [];

  const globalIssues: ComponentIssue[] = [];
  if (accrual.uncoveredDates.length >= 1) globalIssues.push({ component: "global_employer_cost", kind: "missing", reason: "cost_config_absent", dates: accrual.uncoveredDates });
  globalIssues.push(...flagIssue(timelineFlags, ["invalid_global_amount"], "global_employer_cost", "invalid", dates));
  globalIssues.push(...flagIssue(timelineFlags, ["missing_global_amount"], "global_employer_cost", "missing", dates));

  const configIssues: ComponentIssue[] = [];
  if (accrual.uncoveredDates.length >= 1) configIssues.push({ component: "cost_configuration", kind: "missing", reason: "cost_config_absent", dates: accrual.uncoveredDates });
  configIssues.push(...flagIssue(timelineFlags, CONFIG_INVALID_CODES, "cost_configuration", "invalid", dates));
  configIssues.push(...flagIssue(timelineFlags, CONFIG_MISSING_CODES, "cost_configuration", "missing", dates));

  // Purchases % (food cost %) is an Actual KPI: a value only over complete revenue and purchases (TI-18).
  const purchasePctIssues = [...revenueIssues, ...purchaseIssues, ...calendarIssues];
  let purchasesPct: PurchasesPct;
  if (basis.kind === "unresolved") purchasesPct = { state: "purchase_basis_unresolved" };
  else if (empty) purchasesPct = { state: "empty_window" };
  else if (purchasePctIssues.length >= 1) purchasesPct = { state: purchasePctIssues.some((i) => i.kind === "invalid") ? "invalid_components" : "incomplete_components" };
  else {
    const r = ratioOfTotals(noOperatingDays && purchases.rat === null ? RAT_ZERO : purchases.rat, noOperatingDays && revenue.rat === null ? RAT_ZERO : revenue.rat);
    purchasesPct = r.state === "value" ? { state: "value", value: r.value, basisKind: "net_of_vat", comparability: "same_basis_as_revenue" } : (r as PurchasesPct);
  }

  // A recorded total, or a known zero when the window has no operating day (all days closed).
  const known = (r: Rat | null, component: ProfitComponent): Rat => {
    if (r !== null) return r;
    if (noOperatingDays) return RAT_ZERO;
    throw new FinanceContractError("required_component_absent", component);
  };
  const revenueKnown = revenue.total.presentDays >= 1 || noOperatingDays;
  const fixedTotal = ratAdd(ratAdd(accrual.fixedRegular, accrual.rentFixed), ratAdd(accrual.rentPct, accrual.royaltyPct));
  // Percentage rent/royalty are computed on recorded revenue: incomplete revenue makes them incomplete.
  const fixedIssues = [...configIssues, ...(accrual.revenueLinked ? revenueIssues : [])];
  const fixedTyped = typedAmount(() => fixedTotal, fixedIssues, true, empty);
  const fixedOut = (r: Rat) => (fixedTyped.state === "complete" ? serializeRat(r) : null);
  // other_expense is the only optional category: with no recorded value it contributes nothing.
  const otherRecorded = other.rat === null ? RAT_ZERO : other.rat;

  const globalEmployerCost = typedAmount(() => accrual.global, globalIssues, true, empty);
  const laborIssues = [...hourlyIssues, ...globalIssues, ...calendarIssues];
  const employerCost = typedAmount(() => ratAdd(known(hourly.rat, "hourly_employer_cost"), accrual.global), laborIssues, true, empty);
  // The labor % needs a complete numerator AND a complete denominator (TI-18).
  const pctIssues = [...laborIssues, ...revenueIssues];
  let employerCostPct: RatioResult;
  if (empty) employerCostPct = { state: "empty_window" };
  else if (employerCost.state === "complete" && pctIssues.length < 1) employerCostPct = ratioOfTotals(parseAmountString(employerCost.value), known(revenue.rat, "revenue"));
  else employerCostPct = { state: pctIssues.some((i) => i.kind === "invalid") ? "invalid_components" : "incomplete_components" };

  const contributionIssues = [...revenueIssues, ...purchaseIssues, ...hourlyIssues, ...otherIssues, ...calendarIssues];
  const contribution = () => contributionOf(known(revenue.rat, "revenue"), known(purchases.rat, "purchases"), known(hourly.rat, "hourly_employer_cost"), otherRecorded);
  const contributionBeforeFixed = typedAmount(contribution, contributionIssues, revenueKnown, empty);
  const profitIssues = [...contributionIssues, ...globalIssues, ...configIssues];
  // (percentage-rent revenue issues are already contribution issues)
  const operatingProfit = typedAmount(() => operatingProfitOf(contribution(), accrual.global, fixedTotal), profitIssues, revenueKnown, empty);

  const partialAny = (d: CanonicalDay) => d.revenue.partial || d.purchases.partial || d.hourlyLabor.partial || d.otherExpense.partial;
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
      revenue: coverageOf(inWindow, closed, (d) => d.presence.revenue, (d) => d.revenue.partial),
      purchases: coverageOf(inWindow, closed, (d) => d.presence.purchases, (d) => d.purchases.partial),
      hourlyLabor: coverageOf(inWindow, closed, (d) => d.presence.hourlyLabor, (d) => d.hourlyLabor.partial),
      otherExpense: coverageOf(inWindow, closed, (d) => d.presence.otherExpense, (d) => d.otherExpense.partial),
    },
    actual: {
      revenue: revenue.total,
      purchases: { ...purchases.total, bySource: Object.fromEntries([...bySource.keys()].sort().map((k) => [k, serializeRat(bySource.get(k) as Rat)])), basis },
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
        revenuePerPresentDay: perPresentDay(revenue.rat, revenue.operatingPresent),
        purchasesPerPresentDay: perPresentDay(purchases.rat, purchases.operatingPresent),
        hourlyLaborPerPresentDay: perPresentDay(hourly.rat, hourly.operatingPresent),
      },
      contributionBeforeFixed,
      operatingProfit,
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
