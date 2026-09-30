import { sendEmail } from "../../lib/sendEmail.js";
import type { SnapshotData } from "./snapshotBuilder.js";
import type { AmountString } from "../finance/decimal.js";
import { decIsNegative, decIsZero, parseAmountString, ratAdd, ratCmp, ratFromInt, ratMul, ratSub, serializeDec, serializeRat } from "../finance/decimal.js";
import { parseAmount } from "../finance/cells.js";
import type { BusinessDate } from "../finance/types.js";
import { datesInRange, monthBounds } from "../finance/businessDate.js";
import type { FinancialReport, MetricTotal, RatioResult, TypedAmount } from "../metrics/report.js";
import { ratioOfTotals } from "../metrics/report.js";
import { PROJECTION_FORMULA_VERSION } from "../metrics/projected.js";
import { amountToNumber } from "../metrics/adapters/legacyNumber.js";
import type { PolicyEvaluation } from "../policy/evaluate.js";
import { evaluatePolicy } from "../policy/evaluate.js";
import type { PolicyValue } from "../policy/registry.js";
import { resolvePolicy } from "../policy/registry.js";
import type { ProductProjection } from "../policy/productFinance.js";
import { REV_FORECAST_FORMULA_ID } from "../policy/productFinance.js";
import { NOT_AVAILABLE, formatShekel } from "../presenters/money.js";
import { formatPercent } from "../presenters/percent.js";
import { LABELS } from "../presenters/labels.js";

// ─────────────────────────────────────────────────────────────────────────────
// Financial Core B2 — the morning snapshot e-mail (S09): its view model and its presenter.
//
// Ownership (B2-G22 / B2-G26, GUARD-02 / AMEND-02): this file is B2's ONLY core consumer. The
// builder (snapshotBuilder.ts) is B2's server-API consumer; a path may have ONE owner category,
// so the builder cannot import the core and this file cannot import src/finance-server/*. The
// view model therefore lives HERE, next to the presenter, as pure encoding of the canonical
// month report + the ONE canonical projection the builder obtained from the server API:
//   • amounts keep their exact decimal string; the legacy `number` is converted ONCE via the
//     core adapter `amountToNumber` (the builder copies it, never recomputes it);
//   • a value the core does not state as complete is "—" (never 0); a core sum over a window
//     with gaps is labelled "חלקי" together with the exact dates that make it partial;
//   • every displayed total and ratio is a core value; the ONLY derivation is `kpiShares`
//     (a component's share of revenue through the core `ratioOfTotals`; a zero revenue gives
//     "—", never a fabricated 100 %);
//   • no rent total and no revenue-vs-target percentage: the core states fixed rent and
//     percentage rent separately and has no target-comparison formula, so both are shown as
//     their own core values side by side;
//   • calendar progress / days left are calendar measures of the report window (CDA-20);
//     allocation and forecast eligibility are shown only under their own names.
// No new financial rule, no VAT conversion, no binary arithmetic.
// ─────────────────────────────────────────────────────────────────────────────

export const SNAPSHOT_VIEW_VERSION = "MARJIN_SNAPSHOT/2";
/** The e-mail's sales target has no policy-registry key (D owns it): the legacy fallback is kept. */
export const LEGACY_SALES_TARGET_FALLBACK: AmountString = "700000";

/** complete = a contract-complete fact; partial = a core value that is known to be incomplete; unavailable = no value. */
export type ValueState = "complete" | "partial" | "unavailable";

export interface SnapshotAmount {
  readonly exact: AmountString | null;
  readonly number: number | null;
  readonly state: ValueState;
  /** The core's typed state / reason when not complete (e.g. incomplete_components, incomplete_coverage). */
  readonly reason: string | null;
  /** The core's component-issue reasons behind a typed amount (e.g. no_eligible_allocation_days). */
  readonly issueReasons: readonly string[];
}

export interface SnapshotRatio {
  readonly exact: AmountString | null;
  readonly number: number | null;
  readonly state: "value" | "unavailable";
  readonly reason: string | null;
}

export interface SnapshotGoal {
  readonly exact: AmountString;
  readonly number: number;
  readonly source: PolicyValue["source"] | "legacy_config_key";
  readonly ownerApproved: false;
}

/** The server provenance fields the view carries (structural: the server API type is not imported here). */
export interface SnapshotProvenanceInput {
  readonly api: string; readonly product: string; readonly fin: string; readonly norm: string; readonly dec: string;
  readonly labor: string; readonly pb: string; readonly pbPolicy: string; readonly laborSource: string; readonly windowRule: string;
  readonly asOfBusinessDate: BusinessDate; readonly timelineSource: string; readonly configurationBasis: readonly string[];
  readonly configState: string; readonly fixedState: string; readonly exceptionsState: string; readonly operatingCalendar: string;
}

type DateList = readonly BusinessDate[];

export interface SnapshotFinancials {
  readonly version: string;
  /** VD-45: on a date with no completed day in the month the snapshot carries no financial figure. */
  readonly presentation: "month_actual" | "no_completed_days";
  readonly month: string;
  readonly window: {
    readonly asOfBusinessDate: BusinessDate;
    readonly completedThrough: BusinessDate | null;
    /** Completed CALENDAR days of the month (D-1), independent of entries and closures. */
    readonly recognizedDays: number;
    /** Completed days that carry at least one entered value. */
    readonly presentDays: number;
    readonly daysInMonth: number;
    /** Calendar days from the current day through month end (projection context; never Actual). */
    readonly daysLeft: number;
    /** Completed calendar days as a share of the month, in % (core ratio of totals; progress bar). */
    readonly progressPct: AmountString | null;
  };
  readonly amounts: {
    readonly revenue: SnapshotAmount;
    readonly purchases: SnapshotAmount;
    readonly laborEmployerCost: SnapshotAmount;
    readonly hourlyEmployerCost: SnapshotAmount;
    readonly globalEmployerCost: SnapshotAmount;
    readonly otherExpense: SnapshotAmount;
    readonly fixedRegular: SnapshotAmount;
    readonly rentFixed: SnapshotAmount;
    readonly rentPct: SnapshotAmount;
    readonly royalty: SnapshotAmount;
    readonly operatingProfit: SnapshotAmount;
  };
  readonly ratios: {
    readonly purchasesPct: SnapshotRatio;
    readonly laborPct: SnapshotRatio;
    readonly revenueShare: SnapshotRatio;
    readonly fixedRegularShare: SnapshotRatio;
    readonly rentFixedShare: SnapshotRatio;
    readonly rentPctShare: SnapshotRatio;
    readonly royaltyShare: SnapshotRatio;
    readonly operatingProfitShare: SnapshotRatio;
  };
  readonly projection: {
    readonly formulaIds: { readonly projection: string; readonly forecast: string };
    /** The core forecast state: complete / partial / insufficient_history / unavailable / no_completed_days. */
    readonly state: string;
    /** REV_FORECAST/v2 month-end revenue (exact string); "partial" when the core forecast is partial. */
    readonly revenue: SnapshotAmount;
    /** MARJIN_PROJ/2 month-end operating profit; "partial" when it rests on a partial forecast. */
    readonly operatingProfit: SnapshotAmount;
    readonly missingRevenueDates: DateList;
    readonly invalidRevenueDates: DateList;
    /** Declared closures still ahead in the month: forecast revenue 0, no cost change until completed (CDA-04/05). */
    readonly futureClosureDates: DateList;
    /** Forecast eligibility counter (distinct from calendar days, CDA-20); null without a forecast. */
    readonly forecastEligibleRemainingDays: number | null;
    readonly warnings: readonly string[];
  };
  readonly goals: { readonly sales: SnapshotGoal; readonly foodCostPct: SnapshotGoal; readonly laborPct: SnapshotGoal };
  readonly policy: PolicyEvaluation;
  /** Monthly-cost placement (CDA-09…16): allocation counters, distinct from calendar progress. */
  readonly costAllocation: {
    readonly allocationEligibleDays: number;
    readonly completedClosureDates: DateList;
    readonly dayPlacement: FinancialReport["actual"]["costAllocation"]["dayPlacement"];
    readonly placementUnavailableDates: DateList;
  };
  /** Dates only (never values): what keeps a figure from being complete, and declared closures. */
  readonly coverage: {
    readonly revenue: { readonly missing: DateList; readonly invalid: DateList; readonly partial: DateList };
    readonly purchases: { readonly missing: DateList; readonly invalid: DateList; readonly partial: DateList };
    readonly hourlyLabor: { readonly missing: DateList; readonly invalid: DateList; readonly partial: DateList };
    /** Completed declared closures in the Actual window (known zero revenue; never missing). */
    readonly closedDays: DateList;
    /** Closed days on which revenue was nevertheless recorded (CDA-02 contradiction; revenue invalid). */
    readonly closedWithRevenue: DateList;
    /** Dates whose legacy `hourly_payroll` field was recorded and NOT counted (VD-31). */
    readonly legacyHourlyPayrollDates: DateList;
  };
  readonly provenance: SnapshotProvenanceInput & { readonly proj: string; readonly forecast: string; readonly policy: string; readonly snapshot: string };
}

const unavailableAmount = (reason: string | null, issueReasons: readonly string[] = []): SnapshotAmount =>
  Object.freeze({ exact: null, number: null, state: "unavailable" as const, reason, issueReasons: Object.freeze([...issueReasons]) });
const unavailableRatio = (reason: string | null): SnapshotRatio => Object.freeze({ exact: null, number: null, state: "unavailable" as const, reason });
const valueAmount = (exact: AmountString, state: "complete" | "partial", reason: string | null): SnapshotAmount =>
  Object.freeze({ exact, number: amountToNumber(exact), state, reason, issueReasons: Object.freeze([]) as readonly string[] });
const reasonsOf = (issues: readonly { readonly reason: string }[]): string[] => Array.from(new Set(issues.map((i) => i.reason))).sort();

/** A per-metric total: complete ⇒ complete; a value over a window with gaps ⇒ partial; no value ⇒ unavailable. */
export function fromMetricTotal(m: MetricTotal): SnapshotAmount {
  if (m.value === null) return unavailableAmount("no_present_value");
  return m.complete ? valueAmount(m.value, "complete", null) : valueAmount(m.value, "partial", "incomplete_coverage");
}

/** A typed amount: only `complete` carries a value (TI-18); the issue reasons are kept for the notes. */
export function fromTyped(t: TypedAmount): SnapshotAmount {
  if (t.state !== "complete") return unavailableAmount(t.state, reasonsOf(t.issues));
  return valueAmount(t.value, "complete", null);
}

export function fromRatio(r: RatioResult | { readonly state: string; readonly value?: AmountString }): SnapshotRatio {
  const v = (r as { value?: AmountString }).value;
  if (r.state !== "value" || v === undefined) return unavailableRatio(r.state);
  return Object.freeze({ exact: v, number: amountToNumber(v), state: "value" as const, reason: null });
}

/** A component of the complete fixed accrual (the core states amounts only when the accrual is complete). */
function fixedPart(fa: FinancialReport["actual"]["fixedAccrual"], v: AmountString | null): SnapshotAmount {
  if (fa.state !== "complete") return unavailableAmount(fa.state, reasonsOf(fa.issues));
  return v === null ? unavailableAmount("not_stated") : valueAmount(v, "complete", null);
}

/** Share of revenue (in %) through the core ratio of totals — only for two complete values. */
function shareOfRevenue(part: SnapshotAmount, revenue: SnapshotAmount): SnapshotRatio {
  if (part.state !== "complete" || part.exact === null) return unavailableRatio("numerator_" + part.state);
  if (revenue.state !== "complete" || revenue.exact === null) return unavailableRatio("denominator_" + revenue.state);
  return fromRatio(ratioOfTotals(parseAmountString(part.exact), parseAmountString(revenue.exact)));
}

/**
 * E-03 / B2 §4 `kpiShares`: revenue / fixed / rent / royalty / operating profit as a share of
 * revenue, computed only from complete canonical values via `ratioOfTotals` (B2-R02: revenue's own
 * share is revenue ÷ revenue through the same core rule, so a zero revenue is "—", never 100 %).
 */
export function kpiShares(amounts: SnapshotFinancials["amounts"]): Pick<SnapshotFinancials["ratios"], "revenueShare" | "fixedRegularShare" | "rentFixedShare" | "rentPctShare" | "royaltyShare" | "operatingProfitShare"> {
  return {
    revenueShare: shareOfRevenue(amounts.revenue, amounts.revenue),
    fixedRegularShare: shareOfRevenue(amounts.fixedRegular, amounts.revenue),
    rentFixedShare: shareOfRevenue(amounts.rentFixed, amounts.revenue),
    rentPctShare: shareOfRevenue(amounts.rentPct, amounts.revenue),
    royaltyShare: shareOfRevenue(amounts.royalty, amounts.revenue),
    operatingProfitShare: shareOfRevenue(amounts.operatingProfit, amounts.revenue),
  };
}

function goalOf(v: PolicyValue): SnapshotGoal {
  return Object.freeze({ exact: v.value, number: amountToNumber(v.value) as number, source: v.source, ownerApproved: false as const });
}

/** B2-21: the sales target stays the legacy `config.targetSales` key with the 700,000 fallback (D owns a real sales goal). */
function salesGoal(config: Record<string, unknown> | null): SnapshotGoal {
  const cell = parseAmount(config ? config.targetSales : undefined, { allowSkip: false });
  if (cell.state === "present" && !decIsZero(cell.value) && !decIsNegative(cell.value)) {
    const exact = serializeDec(cell.value);
    return Object.freeze({ exact, number: amountToNumber(exact) as number, source: "legacy_config_key" as const, ownerApproved: false as const });
  }
  return Object.freeze({ exact: LEGACY_SALES_TARGET_FALLBACK, number: amountToNumber(LEGACY_SALES_TARGET_FALLBACK) as number, source: "compatibility_product_default" as const, ownerApproved: false as const });
}

function coverageOf(c: FinancialReport["coverage"]["revenue"]) {
  return Object.freeze({ missing: Object.freeze([...c.missingDays]), invalid: Object.freeze([...c.invalidDays]), partial: Object.freeze([...c.partialDays]) });
}

/** A projected figure: complete only when the core forecast is complete; partial when it is partial. */
function projected(v: AmountString | null, forecastState: string, reason: string): SnapshotAmount {
  if (v === null) return unavailableAmount(reason);
  if (forecastState === "complete") return valueAmount(v, "complete", null);
  if (forecastState === "partial") return valueAmount(v, "partial", "forecast_partial");
  return unavailableAmount(forecastState);
}

/**
 * Build the snapshot view from the canonical report + projection (both obtained by the builder
 * through the server API). `projection` is null when the report has no completed day (no
 * projection is requested for an empty window).
 */
export function buildSnapshotView(input: {
  readonly report: FinancialReport;
  readonly projection: ProductProjection | null;
  readonly provenance: SnapshotProvenanceInput;
  readonly config: Record<string, unknown> | null;
}): SnapshotFinancials {
  const { report, projection, provenance, config } = input;
  const a = report.actual;
  const fa = a.fixedAccrual;
  const amounts: SnapshotFinancials["amounts"] = Object.freeze({
    revenue: fromMetricTotal(a.revenue),
    purchases: fromMetricTotal(a.purchases),
    laborEmployerCost: fromTyped(a.labor.employerCost),
    hourlyEmployerCost: fromMetricTotal(a.labor.hourlyEmployerCost),
    globalEmployerCost: fromTyped(a.labor.globalEmployerCost),
    otherExpense: fromMetricTotal(a.otherExpense),
    fixedRegular: fixedPart(fa, fa.regular),
    rentFixed: fixedPart(fa, fa.rentFixed),
    rentPct: fixedPart(fa, fa.rentPct),
    royalty: fixedPart(fa, fa.royaltyPct),
    operatingProfit: fromTyped(a.operatingProfit),
  });
  const ratios: SnapshotFinancials["ratios"] = Object.freeze({
    purchasesPct: fromRatio(a.purchasesPct),
    laborPct: fromRatio(a.labor.employerCostPct),
    ...kpiShares(amounts),
  });
  const policy = resolvePolicy(config);
  const goals = Object.freeze({ sales: salesGoal(config), foodCostPct: goalOf(policy.values["goal.foodCostPct"]), laborPct: goalOf(policy.values["goal.laborCostPct"]) });

  const fc = projection ? projection.forecast : null;
  const forecastState = fc ? fc.state : "no_completed_days";
  const warnings: string[] = fc ? [...fc.warnings, ...(projection && projection.projection ? projection.projection.warnings : [])] : ["no_completed_days"];
  const projRevenue = projected(fc ? fc.projectedRevenue : null, forecastState, fc ? (fc.warnings[0] || forecastState) : "no_completed_days");
  const projProfit = projected(projection && projection.projection ? projection.projection.operatingProfit : null, forecastState, "projection_unavailable");

  const { first, last, days: daysInMonth } = monthBounds(report.window.month);
  const asOf = report.window.asOfBusinessDate;
  const presentation = report.window.state === "actual" ? "month_actual" as const : "no_completed_days" as const;
  const closedWithRevenue: BusinessDate[] = [];
  for (const fl of report.flags) if (fl.code === "closed_day_has_recorded_values" && fl.date !== undefined && !closedWithRevenue.includes(fl.date)) closedWithRevenue.push(fl.date);
  closedWithRevenue.sort();
  return Object.freeze({
    version: SNAPSHOT_VIEW_VERSION,
    presentation,
    month: report.window.month,
    window: Object.freeze({
      asOfBusinessDate: asOf,
      completedThrough: report.window.completedThrough,
      recognizedDays: report.window.recognizedDays,
      presentDays: report.coverage.day.presentDays,
      daysInMonth,
      daysLeft: asOf > last ? 0 : datesInRange(asOf < first ? first : asOf, last).length,
      progressPct: fromRatio(ratioOfTotals(ratFromInt(report.window.recognizedDays), ratFromInt(daysInMonth))).exact,
    }),
    amounts,
    ratios,
    projection: Object.freeze({
      formulaIds: Object.freeze({ projection: PROJECTION_FORMULA_VERSION, forecast: fc ? fc.formulaId : REV_FORECAST_FORMULA_ID }),
      state: forecastState,
      revenue: projRevenue,
      operatingProfit: projProfit,
      missingRevenueDates: Object.freeze(fc ? [...fc.missingRevenueDates] : []),
      invalidRevenueDates: Object.freeze(fc ? [...fc.invalidRevenueDates] : []),
      futureClosureDates: Object.freeze(fc && fc.engine ? [...fc.engine.futureClosureDates] : []),
      forecastEligibleRemainingDays: fc && fc.engine ? fc.engine.forecastEligibleRemainingDays : null,
      warnings: Object.freeze(warnings),
    }),
    goals,
    policy: evaluatePolicy(report, policy),
    costAllocation: Object.freeze({
      allocationEligibleDays: a.costAllocation.allocationEligibleDays,
      completedClosureDates: Object.freeze([...a.costAllocation.completedClosureDates]),
      dayPlacement: a.costAllocation.dayPlacement,
      placementUnavailableDates: Object.freeze([...a.costAllocation.placementUnavailableDates]),
    }),
    coverage: Object.freeze({
      revenue: coverageOf(report.coverage.revenue),
      purchases: coverageOf(report.coverage.purchases),
      hourlyLabor: coverageOf(report.coverage.hourlyLabor),
      closedDays: Object.freeze([...report.coverage.revenue.closedDays]),
      closedWithRevenue: Object.freeze(closedWithRevenue),
      legacyHourlyPayrollDates: Object.freeze([...a.labor.legacyHourlyPayroll.dates]),
    }),
    provenance: Object.freeze({ ...provenance, proj: PROJECTION_FORMULA_VERSION, forecast: fc ? fc.formulaId : REV_FORECAST_FORMULA_ID, policy: policy.policyVersion, snapshot: SNAPSHOT_VIEW_VERSION }),
  });
}

// ── B2-22: the e-mail's inline insights — RETAINED rules and literals (D owns them), fed
// canonical values. VD-44: a rule whose input is not a complete value emits nothing
// (`evaluatePolicy` not_evaluable, an unavailable figure, or a forecast that is not complete).
// Comparisons are exact.
export interface SnapshotInsight {
  readonly type: "positive" | "negative" | "warning";
  readonly message: string;
  /** Which retained rule produced it (for tests / D's later digest). */
  readonly rule: "food_cost" | "labor" | "revenue_pace" | "net_profit";
}

const cmp = (a: AmountString, b: AmountString) => ratCmp(parseAmountString(a), parseAmountString(b));
const plus = (a: AmountString, k: string) => serializeRat(ratAdd(parseAmountString(a), parseAmountString(k)));
const minus = (a: AmountString, k: string) => serializeRat(ratSub(parseAmountString(a), parseAmountString(k)));
const times = (a: AmountString, k: string) => serializeRat(ratMul(parseAmountString(a), parseAmountString(k)));

export function snapshotInsights(f: SnapshotFinancials): SnapshotInsight[] {
  const out: SnapshotInsight[] = [];
  if (f.presentation !== "month_actual") return out;
  const cmpState = (metric: string) => f.policy.comparisons.find((c) => c.metric === metric)?.state ?? "not_evaluable";
  const goalText = (g: SnapshotGoal) => formatPercent(g.exact).replace(/\.0%$/, "%");

  // Food cost (retained literals: goal ± 3 points)
  const food = f.ratios.purchasesPct;
  if (cmpState("purchasesPct") !== "not_evaluable" && food.exact !== null) {
    const g = f.goals.foodCostPct.exact;
    if (cmp(food.exact, plus(g, "3")) > 0) out.push({ type: "negative", rule: "food_cost", message: `עלות המזון גבוהה מהיעד: ${formatPercent(food.exact)} (יעד: ${goalText(f.goals.foodCostPct)})` });
    else if (cmp(food.exact, minus(g, "3")) < 0) out.push({ type: "positive", rule: "food_cost", message: `עלות המזון נמוכה מהיעד: ${formatPercent(food.exact)} (יעד: ${goalText(f.goals.foodCostPct)})` });
  }
  // Labor (retained literals: goal ± 3 points)
  const labor = f.ratios.laborPct;
  if (cmpState("laborEmployerCostPct") !== "not_evaluable" && labor.exact !== null) {
    const g = f.goals.laborPct.exact;
    if (cmp(labor.exact, plus(g, "3")) > 0) out.push({ type: "negative", rule: "labor", message: `עלות העובדים גבוהה מהיעד: ${formatPercent(labor.exact)} (יעד: ${goalText(f.goals.laborPct)})` });
    else if (cmp(labor.exact, minus(g, "3")) < 0) out.push({ type: "positive", rule: "labor", message: `עלות העובדים נמוכה מהיעד: ${formatPercent(labor.exact)} (יעד: ${goalText(f.goals.laborPct)})` });
  }
  // Revenue pace vs the sales target (retained literals 0.9 / 1.05) — a COMPLETE forecast only
  const pace = f.projection.revenue.state === "complete" ? f.projection.revenue.exact : null, target = f.goals.sales.exact;
  if (pace !== null) {
    if (cmp(pace, times(target, "0.9")) < 0) out.push({ type: "negative", rule: "revenue_pace", message: `קצב ההכנסות נמוך מהיעד: ${formatShekel(pace)} (יעד: ${formatShekel(target)})` });
    else if (cmp(pace, times(target, "1.05")) > 0) out.push({ type: "positive", rule: "revenue_pace", message: `קצב ההכנסות גבוה מהיעד: ${formatShekel(pace)} (יעד: ${formatShekel(target)})` });
  }
  // Net profit (retained literals: < 0; > 15 % of the sales target) — complete profit only
  const profit = f.amounts.operatingProfit.exact;
  if (f.amounts.operatingProfit.state === "complete" && profit !== null) {
    if (cmp(profit, "0") < 0) out.push({ type: "negative", rule: "net_profit", message: `רווח נקי שלילי: ${formatShekel(profit)}` });
    else if (cmp(profit, times(target, "0.15")) > 0) out.push({ type: "positive", rule: "net_profit", message: `רווח נקי חזק: ${formatShekel(profit)}` });
  }
  return out;
}

// ── Presenter: every figure is the exact canonical value from `snapshot.financials`, formatted
// ONCE by the shared presenters (₪ half away from zero, one-decimal %). A value the core does not
// state as complete shows "—"; a partial value is marked "חלקי" and the dates behind it are
// stated in text (never colour only). No arithmetic on money happens here.
const PARTIAL = "חלקי";

function money(a: SnapshotAmount): string {
  if (a.state === "unavailable" || a.exact === null) return NOT_AVAILABLE;
  return formatShekel(a.exact);
}

function pct(r: SnapshotRatio): string {
  return r.state === "value" && r.exact !== null ? formatPercent(r.exact) : NOT_AVAILABLE;
}

function shortDate(date: string | null): string {
  if (!date) return NOT_AVAILABLE;
  const [, m, d] = date.split("-");
  return `${d}.${m}`;
}

const dateList = (dates: readonly string[]): string => dates.map(shortDate).join(", ");

/** Hebrew text for the core reasons that keep a monthly cost from being stated (presentation only). */
const REASON_HE: Readonly<Record<string, string>> = Object.freeze({
  no_eligible_allocation_days: "אין ימי פעילות לחלוקת העלות החודשית",
  closure_calendar_unreadable: "יומן הימים הסגורים אינו קריא",
  cost_config_absent: "אין הגדרת עלות לחלק מהימים",
});

function getInsightEmoji(type: "positive" | "negative" | "warning"): string {
  switch (type) {
    case "positive":
      return "🟢";
    case "negative":
      return "🔴";
    case "warning":
      return "🟡";
  }
}

function getHebrewDateString(dateStr: string): string {
  const [year, month, day] = dateStr.split("-");
  const months = [
    "ינואר",
    "פברואר",
    "מרץ",
    "אפריל",
    "מאי",
    "יוני",
    "יולי",
    "אוגוסט",
    "ספטמבר",
    "אוקטובר",
    "נובמבר",
    "דצמבר",
  ];
  const monthNum = parseInt(month) - 1;
  return `${day} ${months[monthNum]} ${year}`;
}

/** The text lines directly below MTD revenue (CDA-18): exact dates, never colour only. */
export function revenueDisclosure(f: SnapshotFinancials): { warning: string; closures: string } {
  const c = f.coverage.revenue;
  const parts: string[] = [];
  if (c.missing.length > 0) parts.push(`חסרות הכנסות בימים: ${dateList(c.missing)}`);
  const invalid = c.invalid.filter((d) => !f.coverage.closedWithRevenue.includes(d)); // a contradiction is named once, as such
  if (invalid.length > 0) parts.push(`ערך הכנסה לא תקין בימים: ${dateList(invalid)}`);
  if (c.partial.length > 0) parts.push(`הכנסה חלקית (תא לא תקין) בימים: ${dateList(c.partial)}`);
  if (f.coverage.closedWithRevenue.length > 0) parts.push(`סומנו כסגורים אך נרשמו בהם הכנסות: ${dateList(f.coverage.closedWithRevenue)}`);
  const warning = parts.length > 0 ? `⚠ ${parts.join(" · ")} — סכום ההכנסות אינו מלא; רווח ואחוזים שתלויים בו אינם מוצגים` : "";
  const closures = f.coverage.closedDays.length > 0 ? `${LABELS.presence.closedDay} (הכנסה 0, לא חסר): ${dateList(f.coverage.closedDays)}` : "";
  return { warning, closures };
}

export async function sendSnapshotEmail(
  to: string,
  snapshot: SnapshotData
): Promise<void> {
  const f = snapshot.financials;
  const hebrewDate = getHebrewDateString(snapshot.date);
  const noDays = f.presentation === "no_completed_days";
  const subject = noDays
    ? `📊 ${snapshot.bizName} — דוח בוקר ${hebrewDate} | ${LABELS.incomplete.empty_window}`
    : `📊 ${snapshot.bizName} — דוח בוקר ${hebrewDate} | רווח: ${money(f.amounts.operatingProfit)}`;

  // Progress = completed calendar days of the month (D-1), as computed by the core
  const progressWidth = f.window.progressPct === null ? "0%" : formatPercent(f.window.progressPct);

  // KPI rows: exact canonical values; shares of revenue only from complete values (kpiShares)
  const goal = (g: { exact: string }) => formatPercent(g.exact);
  const kpiRows: Array<{ label: string; amount: SnapshotAmount; share: SnapshotRatio; target: string | null }> = [
    { label: "הכנסות", amount: f.amounts.revenue, share: f.ratios.revenueShare, target: null },
    { label: "קניות (מזון)", amount: f.amounts.purchases, share: f.ratios.purchasesPct, target: goal(f.goals.foodCostPct) },
    { label: "עלות עובדים", amount: f.amounts.laborEmployerCost, share: f.ratios.laborPct, target: goal(f.goals.laborPct) },
    { label: "הוצאות קבועות", amount: f.amounts.fixedRegular, share: f.ratios.fixedRegularShare, target: null },
    { label: "שכר דירה קבוע", amount: f.amounts.rentFixed, share: f.ratios.rentFixedShare, target: null },
    { label: "שכר דירה באחוזים", amount: f.amounts.rentPct, share: f.ratios.rentPctShare, target: null },
    { label: "תמלוגים", amount: f.amounts.royalty, share: f.ratios.royaltyShare, target: null },
    { label: "רווח נקי", amount: f.amounts.operatingProfit, share: f.ratios.operatingProfitShare, target: null },
  ];
  const revenueNote = revenueDisclosure(f);

  // Completeness of the cost inputs (revenue has its own dated line above): days are counted, never valued
  const costGapDays = new Set([...f.coverage.purchases.missing, ...f.coverage.purchases.invalid, ...f.coverage.purchases.partial, ...f.coverage.hourlyLabor.missing, ...f.coverage.hourlyLabor.invalid, ...f.coverage.hourlyLabor.partial]).size;
  const completenessNote = costGapDays > 0 ? `חסרים או לא תקינים נתוני קניות או שכר ב-${costGapDays} ימים — סכומים מסומנים "${PARTIAL}", ואחוזים ורווח שתלויים בהם אינם מוצגים` : "";
  const costReasons = Array.from(new Set([...f.amounts.globalEmployerCost.issueReasons, ...f.amounts.fixedRegular.issueReasons])).filter((r) => r in REASON_HE).sort();
  const reasonNote = costReasons.length > 0 ? `עלויות חודשיות לא מוצגות: ${costReasons.map((r) => REASON_HE[r]).join(" · ")}` : "";
  const allocationNote = f.costAllocation.completedClosureDates.length > 0
    ? `עלויות חודשיות (עובדים גלובליים והוצאות קבועות) מחולקות על ${f.costAllocation.allocationEligibleDays} ימים שאינם סגורים; ימים סגורים שהסתיימו (${dateList(f.costAllocation.completedClosureDates)}) אינם נושאים עלות חודשית`
    : "";
  const basisNote = [LABELS.basis.net_of_vat, ...f.provenance.configurationBasis.map((b) => (LABELS.configurationBasis as Record<string, string>)[b] || b)].join(" · ");
  const hourlyNote = f.coverage.legacyHourlyPayrollDates.length > 0 ? LABELS.labor.legacyHourlyPayrollNotCounted : "";

  // Projection: the core's REV_FORECAST/v2 month-end revenue next to the sales target (no B2 comparison formula)
  const p = f.projection;
  const partialMark = (a: SnapshotAmount) => (a.state === "partial" ? ` (${PARTIAL})` : "");
  const forecastNotes: string[] = [];
  if (p.missingRevenueDates.length > 0 || p.invalidRevenueDates.length > 0) forecastNotes.push(`תחזית חלקית — חסרות או לא תקינות הכנסות בימים: ${dateList([...p.missingRevenueDates, ...p.invalidRevenueDates].sort())}`);
  if (p.futureClosureDates.length > 0) forecastNotes.push(`ימים סגורים מתוכננים: ${dateList(p.futureClosureDates)} — ללא תחזית הכנסות`);
  if (p.revenue.state === "unavailable" && p.warnings.length > 0) forecastNotes.push(`תחזית הכנסות לא זמינה (${p.warnings.join(", ")})`);
  else if (p.state === "partial" && p.warnings.includes("insufficient_weekday_history")) forecastNotes.push("אין מספיק היסטוריה לחלק מימי השבוע — התחזית חלקית");
  const projectionNote = p.operatingProfit.state === "complete"
    ? "רווח נקי חזוי בסיום החודש"
    : p.operatingProfit.state === "partial"
      ? `רווח נקי חזוי בסיום החודש — ${PARTIAL} (על בסיס תחזית הכנסות חלקית)`
      : "רווח נקי חזוי בסיום החודש — לא זמין (" + (p.warnings.join(", ") || "projection_unavailable") + ")";

  const htmlBody = `
<!DOCTYPE html>
<html dir="rtl" lang="he">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      direction: rtl;
      margin: 0;
      padding: 0;
      background-color: #f3f4f6;
    }
    .container {
      max-width: 600px;
      margin: 20px auto;
      background-color: white;
      border-radius: 8px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.1);
      overflow: hidden;
    }
    .header {
      background: linear-gradient(135deg, #111827 0%, #1f2937 100%);
      color: white;
      padding: 32px 24px;
      text-align: center;
    }
    .header-title {
      font-size: 28px;
      font-weight: bold;
      margin: 0 0 12px 0;
    }
    .header-subtitle {
      font-size: 14px;
      opacity: 0.9;
      margin: 0;
    }
    .content {
      padding: 24px;
    }
    .date-line {
      text-align: center;
      margin-bottom: 24px;
      padding-bottom: 12px;
      border-bottom: 1px solid #e5e7eb;
    }
    .date-line-date {
      font-size: 16px;
      font-weight: 600;
      color: #1f2937;
      margin-bottom: 4px;
    }
    .date-line-day {
      font-size: 12px;
      color: #6b7280;
    }
    .progress-section {
      margin-bottom: 24px;
    }
    .progress-label {
      font-size: 13px;
      color: #6b7280;
      margin-bottom: 8px;
      text-align: right;
    }
    .progress-bar-container {
      width: 100%;
      height: 8px;
      background-color: #e5e7eb;
      border-radius: 4px;
      overflow: hidden;
    }
    .progress-bar-fill {
      height: 100%;
      background-color: #3b82f6;
      transition: width 0.3s ease;
    }
    .progress-stats {
      display: flex;
      justify-content: space-between;
      margin-top: 8px;
      font-size: 12px;
      color: #6b7280;
    }
    .kpi-section {
      margin-bottom: 24px;
    }
    .kpi-title {
      font-size: 14px;
      font-weight: 600;
      color: #1f2937;
      margin-bottom: 12px;
      text-align: right;
    }
    .kpi-table {
      width: 100%;
      border-collapse: collapse;
    }
    .kpi-row {
      border-bottom: 1px solid #e5e7eb;
    }
    .kpi-row:last-child {
      border-bottom: none;
      background-color: #f9fafb;
      font-weight: 600;
    }
    .kpi-cell {
      padding: 12px 8px;
      font-size: 13px;
      text-align: right;
    }
    .kpi-label {
      color: #374151;
    }
    .kpi-value {
      color: #1f2937;
      font-weight: 500;
      text-align: left;
    }
    .kpi-pct {
      color: #6b7280;
      font-size: 12px;
      text-align: left;
    }
    .pace-section {
      margin-bottom: 24px;
      padding: 16px;
      background-color: #eff6ff;
      border-radius: 6px;
      border-right: 4px solid #3b82f6;
    }
    .pace-title {
      font-size: 14px;
      font-weight: 600;
      color: #1f2937;
      margin-bottom: 12px;
      text-align: right;
    }
    .pace-row {
      display: flex;
      justify-content: space-between;
      margin: 8px 0;
      font-size: 13px;
    }
    .pace-label {
      color: #374151;
    }
    .pace-value {
      color: #1f2937;
      font-weight: 500;
    }
    .forecast-section {
      margin-bottom: 24px;
      padding: 16px;
      background-color: #fef3c7;
      border-radius: 6px;
      border-right: 4px solid #f59e0b;
    }
    .forecast-title {
      font-size: 14px;
      font-weight: 600;
      color: #1f2937;
      margin-bottom: 12px;
      text-align: right;
    }
    .forecast-value {
      font-size: 20px;
      font-weight: bold;
      color: #1f2937;
      text-align: right;
    }
    .forecast-label {
      font-size: 12px;
      color: #6b7280;
      margin-top: 4px;
      text-align: right;
    }
    .insights-section {
      margin-bottom: 24px;
    }
    .insights-title {
      font-size: 14px;
      font-weight: 600;
      color: #1f2937;
      margin-bottom: 12px;
      text-align: right;
    }
    .insight-item {
      margin: 12px 0;
      padding: 12px;
      background-color: #f9fafb;
      border-right: 4px solid #cbd5e1;
      border-radius: 4px;
      text-align: right;
    }
    .insight-positive {
      border-right-color: #10b981;
    }
    .insight-negative {
      border-right-color: #ef4444;
    }
    .insight-warning {
      border-right-color: #f59e0b;
    }
    .insight-emoji {
      font-size: 16px;
      margin-left: 8px;
    }
    .insight-text {
      color: #374151;
      font-size: 14px;
    }
    .footer {
      background-color: #f9fafb;
      padding: 16px 24px;
      text-align: center;
      border-top: 1px solid #e5e7eb;
    }
    .footer-text {
      font-size: 12px;
      color: #6b7280;
      margin: 4px 0;
    }
    .footer-link {
      color: #3b82f6;
      text-decoration: none;
    }
    .footer-link:hover {
      text-decoration: underline;
    }
    .kpi-warning {
      color: #b91c1c;
      font-size: 12px;
      font-weight: 600;
      text-align: right;
      padding-top: 0;
    }
    .kpi-note {
      color: #6b7280;
      font-size: 12px;
      text-align: right;
      padding-top: 0;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="header-title">📊 דוח בוקר יומי — Marjin</div>
      <div class="header-subtitle">${snapshot.bizName}</div>
    </div>

    <div class="content">
      <div class="date-line">
        <div class="date-line-date">${hebrewDate}</div>
        <div class="date-line-day">${noDays ? LABELS.incomplete.empty_window : `נתונים עד ${shortDate(f.window.completedThrough)} · ${f.window.recognizedDays} ימים שהושלמו מתוך ${f.window.daysInMonth} · ${f.window.presentDays} ימים עם נתונים`}</div>
      </div>

      <div class="progress-section">
        <div class="progress-label">התקדמות החודש</div>
        <div class="progress-bar-container">
          <div class="progress-bar-fill" style="width: ${progressWidth}"></div>
        </div>
        <div class="progress-stats">
          <span>${f.window.daysLeft} ימים נותרים (כולל היום)</span>
          <span>${progressWidth}</span>
        </div>
      </div>

      ${noDays ? "" : `
      <div class="kpi-section">
        <div class="kpi-title">📊 מדדי ביצוע עיקריים</div>
        <table class="kpi-table">
          <tbody>
            ${kpiRows
              .map(
                (row, i) => `
              <tr class="kpi-row">
                <td class="kpi-cell kpi-label" style="width: 40%;">${row.label}</td>
                <td class="kpi-cell kpi-value" style="width: 35%; text-align: left;">${money(row.amount)}${partialMark(row.amount)}</td>
                <td class="kpi-cell kpi-pct" style="width: 25%; text-align: left;">
                  ${pct(row.share)}${row.target !== null ? ` (יעד: ${row.target})` : ""}
                </td>
              </tr>${i === 0 && revenueNote.warning ? `
              <tr class="kpi-note-row">
                <td class="kpi-cell kpi-warning" colspan="3" role="alert">${revenueNote.warning}</td>
              </tr>` : ""}${i === 0 && revenueNote.closures ? `
              <tr class="kpi-note-row">
                <td class="kpi-cell kpi-note" colspan="3">${revenueNote.closures}</td>
              </tr>` : ""}
            `
              )
              .join("")}
          </tbody>
        </table>
        ${completenessNote ? `<div class="forecast-label">${completenessNote}</div>` : ""}
        ${reasonNote ? `<div class="forecast-label">${reasonNote}</div>` : ""}
        ${allocationNote ? `<div class="forecast-label">${allocationNote}</div>` : ""}
        ${hourlyNote ? `<div class="forecast-label">${hourlyNote}</div>` : ""}
      </div>

      <div class="pace-section">
        <div class="pace-title">📈 הכנסה חזויה לחודש</div>
        <div class="pace-row">
          <span class="pace-value">${money(p.revenue)}${partialMark(p.revenue)}</span>
          <span class="pace-label">תחזית הכנסות (${p.formulaIds.forecast})</span>
        </div>
        <div class="pace-row">
          <span class="pace-value">${formatShekel(f.goals.sales.exact)}</span>
          <span class="pace-label">יעד מכירות חודשי</span>
        </div>
        ${forecastNotes.map((n) => `<div class="forecast-label">${n}</div>`).join("")}
      </div>

      <div class="forecast-section">
        <div class="forecast-title">🎯 תחזית לסוף החודש</div>
        <div class="forecast-value" style="color: ${p.operatingProfit.exact === null ? "#6b7280" : !p.operatingProfit.exact.startsWith("-") ? "#10b981" : "#ef4444"};">${money(p.operatingProfit)}${partialMark(p.operatingProfit)}</div>
        <div class="forecast-label">${projectionNote}</div>
      </div>
      `}

      ${
        snapshot.insights.length > 0
          ? `
      <div class="insights-section">
        <div class="insights-title">💡 התראות חכמות</div>
        ${snapshot.insights
          .map((insight) => {
            const typeClass =
              insight.type === "positive"
                ? "insight-positive"
                : insight.type === "negative"
                  ? "insight-negative"
                  : "insight-warning";
            return `
          <div class="insight-item ${typeClass}">
            <span class="insight-emoji">${getInsightEmoji(insight.type)}</span>
            <span class="insight-text">${insight.message}</span>
          </div>
        `;
          })
          .join("")}
      </div>
      `
          : ""
      }
    </div>

    <div class="footer">
      <div class="footer-text">
        <a href="https://app.marjin.app" class="footer-link">🔗 לחץ כאן לחזרה לאפליקציה</a>
      </div>
      <div class="footer-text">דוח זה נשלח אליך אוטומטית על ידי מערכת Marjin</div>
      <div class="footer-text">${basisNote} · בפועל עד אתמול (היום אינו נכלל)</div>
    </div>
  </div>
</body>
</html>
  `;

  await sendEmail(to, subject, htmlBody);
}
