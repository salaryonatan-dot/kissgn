// Canonical server metrics (Slice B1, MARJIN_FIN_SERVER/1): thin, pure server wrappers over
// the shared product composition (src/policy/productFinance.ts). This module never calls
// computePeriodReport or toDailyMetric itself (G-S4) and adds no arithmetic, fallback,
// threshold or business rule: it selects fields, attaches provenance and encodes the
// persisted analytics doc. No I/O, no clock, no binary math.
import type { BusinessDate, CanonicalDay, MetricValue } from "../finance/types.js";
import { FinanceContractError } from "../finance/types.js";
import { isBusinessDate } from "../finance/businessDate.js";
import { DECIMAL_CONTRACT_VERSION, decIsNegative, decIsZero, serializeDec } from "../finance/decimal.js";
import { NORMALIZATION_VERSION, latestPresentDate } from "../finance/normalize.js";
import { LABOR_CONTRACT_VERSION } from "../finance/labor.js";
import { PURCHASE_BASIS_CONTRACT_VERSION } from "../finance/purchaseBasis.js";
import { amountToNumber } from "../metrics/adapters/legacyNumber.js";
import { ACTUAL_WINDOW_RULE, FINANCIAL_FORMULA_VERSION } from "../metrics/report.js";
import type { FinancialReport } from "../metrics/report.js";
import { PB_NET_POLICY_ID } from "../policy/purchaseBasis.js";
import { productLaborSource } from "../policy/laborSource.js";
import {
  PRODUCT_FINANCE_VERSION, REV_FORECAST_FORMULA_ID, productDailyMetrics, productDayRecord, productDays, productMonthProjection, productMonthReport, productTimeline,
} from "../policy/productFinance.js";
import type { ProductDailyMetric, ProductProjection, ProductRange } from "../policy/productFinance.js";
import { CANONICAL_SERVER_API_VERSION } from "./canonicalInputs.js";
import type { InputIssue, InputState, ServerInputs } from "./canonicalInputs.js";

export interface ServerProvenance {
  readonly api: string;
  readonly product: string;
  readonly fin: string;
  readonly norm: string;
  readonly dec: string;
  readonly labor: string;
  readonly pb: string;
  readonly pbPolicy: string;
  readonly laborSource: string;
  readonly windowRule: string;
  readonly asOfBusinessDate: BusinessDate;
  readonly timelineSource: string;
  readonly configurationBasis: readonly string[];
  readonly configState: InputState;
  readonly fixedState: InputState;
  readonly exceptionsState: ServerInputs["exceptionsState"];
  readonly operatingCalendar: "none_declared";
}

export function provenanceOf(inputs: ServerInputs): ServerProvenance {
  const timeline = productTimeline(inputs);
  const basis = Array.from(new Set(timeline.versions.map((v) => v.basis))).sort();
  return Object.freeze({
    api: CANONICAL_SERVER_API_VERSION,
    product: PRODUCT_FINANCE_VERSION,
    fin: FINANCIAL_FORMULA_VERSION,
    norm: NORMALIZATION_VERSION,
    dec: DECIMAL_CONTRACT_VERSION,
    labor: LABOR_CONTRACT_VERSION,
    pb: PURCHASE_BASIS_CONTRACT_VERSION,
    pbPolicy: PB_NET_POLICY_ID,
    laborSource: productLaborSource().policyId,
    windowRule: ACTUAL_WINDOW_RULE,
    asOfBusinessDate: inputs.asOfBusinessDate,
    timelineSource: timeline.timelineSource,
    configurationBasis: Object.freeze(basis),
    configState: inputs.configState,
    fixedState: inputs.fixedState,
    exceptionsState: inputs.exceptionsState,
    operatingCalendar: "none_declared" as const,
  });
}

export type CanonicalDailyMetric = ProductDailyMetric & { readonly fin: ServerProvenance };

export interface CanonicalDailySeries {
  readonly provenance: ServerProvenance;
  readonly window: ReturnType<typeof productDays>["window"];
  readonly days: CanonicalDailyMetric[];
  readonly missingDates: BusinessDate[];
  readonly quarantine: { readonly futureRows: number; readonly invalidDateRows: number };
  readonly flagCodes: string[];
  readonly inputIssues: readonly InputIssue[];
}

function flagCodesOf(days: readonly CanonicalDay[], extra: ReadonlyArray<{ code: string }>): string[] {
  const s = new Set<string>();
  for (const d of days) for (const f of d.flags) s.add(f.code);
  for (const f of extra) s.add(f.code);
  return Array.from(s).sort();
}

/** Daily series: present completed days only (≤ asOf − 1), missing completed dates listed separately. */
export function canonicalDailySeries(inputs: ServerInputs, range: ProductRange): CanonicalDailySeries {
  const provenance = provenanceOf(inputs);
  const d = productDays(inputs, range);
  const metrics = productDailyMetrics(inputs, range);
  return {
    provenance,
    window: d.window,
    days: metrics.map((m) => ({ ...m, fin: provenance })),
    missingDates: d.days.filter((day) => day.presence.day === "missing").map((day) => day.date),
    quarantine: d.quarantine,
    flagCodes: flagCodesOf(d.days, d.flags),
    inputIssues: inputs.inputIssues,
  };
}

/** Latest completed business date whose day is present (explicit zeros count); current/future rows ignored. */
export function canonicalLatestCompletedPresentDate(inputs: ServerInputs): BusinessDate | null {
  let first: BusinessDate | null = null;
  for (const r of inputs.rows) {
    const date = r && typeof r === "object" ? (r as { date?: unknown }).date : undefined;
    if (isBusinessDate(date) && (first === null || date < first)) first = date;
  }
  if (first === null) return null;
  return latestPresentDate(productDays(inputs, { from: first, to: inputs.asOfBusinessDate }).days);
}

export interface CanonicalLaborMetric {
  readonly date: BusinessDate;
  readonly totalCost: number;
  readonly totalCostComplete: boolean;
  readonly hourlyEmployerCost: number | null;
  readonly globalEmployerCost: number | null;
  readonly laborPctOfRevenue: number | null;
  readonly totalHours: null;
  readonly employeeCount: null;
  readonly costPerHour: null;
  readonly fin: ServerProvenance;
}

export function canonicalLaborRecords(inputs: ServerInputs, range: ProductRange): CanonicalLaborMetric[] {
  return canonicalDailySeries(inputs, range).days.map((m) => ({
    date: m.date,
    totalCost: m.laborCost,
    totalCostComplete: m.laborCostComplete,
    hourlyEmployerCost: m.presence.hourlyLabor === "present" ? m.hourlyLaborCost : null,
    globalEmployerCost: m.globalLaborCost,
    laborPctOfRevenue: m.laborPct,
    totalHours: null,
    employeeCount: null,
    costPerHour: null,
    fin: m.fin,
  }));
}

export interface CanonicalPurchaseMetric {
  readonly date: BusinessDate;
  readonly source: "supplier" | "legacy_food_cost";
  readonly supplierId: string | null;
  readonly supplierName: string;
  /** Aggregate of ALL contributions of this (date, source) — several per supplier per day are summed. */
  readonly amount: number;
  readonly dayPurchases: "present" | "partial_invalid";
  readonly fin: ServerProvenance;
}

export function canonicalPurchaseRecords(inputs: ServerInputs, range: ProductRange, supplierNames: Readonly<Record<string, string>>): CanonicalPurchaseMetric[] {
  const provenance = provenanceOf(inputs);
  const out: CanonicalPurchaseMetric[] = [];
  for (const day of productDays(inputs, range).days) {
    if (day.presence.day !== "present") continue;
    for (const key of Object.keys(day.purchases.bySource).sort()) {
      const supplier = key.startsWith("supplier:") ? key.slice("supplier:".length) : null;
      out.push({
        date: day.date,
        source: supplier === null ? "legacy_food_cost" : "supplier",
        supplierId: supplier,
        supplierName: supplier === null ? "legacy_food_cost" : supplierNames[supplier] || `ספק ${supplier}`,
        amount: amountToNumber(day.purchases.bySource[key]) as number,
        dayPurchases: day.purchases.partial ? "partial_invalid" : "present",
        fin: provenance,
      });
    }
  }
  return out;
}

export type CanonicalDayRecord =
  | { readonly inActual: false; readonly date: BusinessDate; readonly reason: "current_day" | "future_date"; readonly presenceDay: "present" | "missing" | "not_examined"; readonly provenance: ServerProvenance }
  | { readonly inActual: true; readonly date: BusinessDate; readonly day: CanonicalDay; readonly metric: CanonicalDailyMetric; readonly provenance: ServerProvenance; readonly inputIssues: readonly InputIssue[] };

export function canonicalDayRecord(inputs: ServerInputs, date: BusinessDate): CanonicalDayRecord {
  const provenance = provenanceOf(inputs);
  const r = productDayRecord(inputs, date);
  if (!r.inActual) return { inActual: false, date: r.date, reason: r.reason, presenceDay: r.presenceDay, provenance };
  return { inActual: true, date: r.date, day: r.day, metric: { ...r.metric, fin: provenance }, provenance, inputIssues: inputs.inputIssues };
}

/** Legacy revenue fields of the persisted analytics doc: a numeric field exists ONLY when its fact is complete. */
export interface LegacyRevenueFields {
  sales?: number;
  deliveries?: number;
  other_income?: number;
  total?: number;
  food_cost?: number;
  payroll?: number;
  had_entry: boolean;
  has_sales: boolean;
}

export interface AnalyticsFinBlock {
  readonly api: string;
  readonly product: string;
  readonly v: string;
  readonly norm: string;
  readonly dec: string;
  readonly labor: string;
  readonly pb: string;
  readonly pbPolicy: string;
  readonly laborSource: string;
  readonly windowRule: string;
  readonly asOfBusinessDate: BusinessDate;
  readonly inActual: boolean;
  readonly outsideActualReason?: "current_day" | "future_date";
  readonly presence?: { day: string; revenue: string; purchases: string; hourlyLabor: string; otherExpense: string };
  readonly rowCount?: number;
  readonly revenue?: { state: string; value?: string };
  /** bySource is omitted when empty (RTDB drops empty arrays). */
  readonly purchases?: { state: string; value?: string; bySource?: Array<{ source: string; amount: string }> };
  readonly hourlyEmployerCost?: { state: string; value?: string };
  readonly derived?: { laborCostComplete: boolean; laborCost?: number; globalLaborCost?: number; laborPct?: number; foodCostPct?: number; conversion: string };
  readonly legacyHourlyPayroll?: { counted: false; recorded: boolean };
  readonly timelineSource?: string;
  readonly configurationBasis?: string[];
  readonly configState?: string;
  readonly flagCodes?: string[];
  readonly inputIssues?: string[];
}

const complete = (m: MetricValue): boolean => m.presence === "present" && !m.partial && m.value !== null;
const numOf = (m: MetricValue): number => amountToNumber(serializeDec(m.value as NonNullable<MetricValue["value"]>)) as number;

function stateOf(m: MetricValue): { state: string; value?: string } {
  if (m.presence === "present" && m.value !== null) return m.partial ? { state: "partial_invalid", value: serializeDec(m.value) } : { state: "present", value: serializeDec(m.value) };
  return { state: m.presence };
}

function finHeader(p: ServerProvenance): Pick<AnalyticsFinBlock, "api" | "product" | "v" | "norm" | "dec" | "labor" | "pb" | "pbPolicy" | "laborSource" | "windowRule" | "asOfBusinessDate"> {
  return { api: p.api, product: p.product, v: p.fin, norm: p.norm, dec: p.dec, labor: p.labor, pb: p.pb, pbPolicy: p.pbPolicy, laborSource: p.laborSource, windowRule: p.windowRule, asOfBusinessDate: p.asOfBusinessDate };
}

/** Persisted-doc encoding (RTDB-safe: no undefined/null values, no empty arrays, arrays for keyed maps, no row ids or free text). */
export function toAnalyticsFinancials(rec: CanonicalDayRecord): { revenue: LegacyRevenueFields; fin: AnalyticsFinBlock } {
  if (!rec.inActual) {
    return {
      revenue: { had_entry: rec.presenceDay === "present", has_sales: false },
      fin: { ...finHeader(rec.provenance), inActual: false, outsideActualReason: rec.reason },
    };
  }
  const { day, metric } = rec;
  const revenue: LegacyRevenueFields = { had_entry: day.presence.day === "present", has_sales: false };
  const parts = day.revenue.parts;
  if (complete(parts.sales)) revenue.sales = numOf(parts.sales);
  if (complete(parts.deliveries)) revenue.deliveries = numOf(parts.deliveries);
  if (complete(parts.otherIncome)) revenue.other_income = numOf(parts.otherIncome);
  if (complete(day.revenue)) {
    revenue.total = metric.revenue;
    const v = day.revenue.value as NonNullable<MetricValue["value"]>;
    revenue.has_sales = !decIsZero(v) && !decIsNegative(v);
  }
  if (complete(day.purchases)) revenue.food_cost = metric.foodCost;
  if (metric.laborCostComplete && !day.hourlyLabor.partial) revenue.payroll = metric.laborCost;

  const derived: NonNullable<AnalyticsFinBlock["derived"]> = { laborCostComplete: metric.laborCostComplete, conversion: `legacyNumber/${DECIMAL_CONTRACT_VERSION}/10dp` };
  if (metric.laborCostComplete) derived.laborCost = metric.laborCost;
  if (metric.globalLaborCost !== null) derived.globalLaborCost = metric.globalLaborCost;
  if (metric.laborPct !== null) derived.laborPct = metric.laborPct;
  if (metric.foodCostPct !== null) derived.foodCostPct = metric.foodCostPct;
  const p = rec.provenance;
  const bySource = Object.keys(day.purchases.bySource).sort().map((source) => ({ source, amount: day.purchases.bySource[source] }));
  const flagCodes = Array.from(new Set(day.flags.map((f) => f.code))).sort();
  // RTDB drops empty arrays: an empty list is OMITTED here so the in-memory doc is exactly
  // the persisted-and-read-back doc (readers treat an absent list as empty).
  const fin: AnalyticsFinBlock = {
    ...finHeader(p),
    inActual: true,
    presence: { day: day.presence.day, revenue: day.presence.revenue, purchases: day.presence.purchases, hourlyLabor: day.presence.hourlyLabor, otherExpense: day.presence.otherExpense },
    rowCount: day.rowCount,
    revenue: stateOf(day.revenue),
    purchases: bySource.length ? { ...stateOf(day.purchases), bySource } : stateOf(day.purchases),
    hourlyEmployerCost: stateOf(day.hourlyLabor),
    derived,
    legacyHourlyPayroll: { counted: false, recorded: day.legacyHourlyPayroll.rows.length > 0 },
    timelineSource: p.timelineSource,
    ...(p.configurationBasis.length ? { configurationBasis: [...p.configurationBasis] } : {}),
    configState: p.configState,
    ...(flagCodes.length ? { flagCodes } : {}),
    ...(rec.inputIssues.length ? { inputIssues: [...rec.inputIssues] } : {}),
  };
  return { revenue, fin };
}

/** Server month report (B2's first runtime consumer): the product composition + provenance. */
export function canonicalMonthReport(inputs: ServerInputs, sel: { readonly kind: "open_month" | "closed_month"; readonly month: string }): { provenance: ServerProvenance; report: FinancialReport; inputIssues: readonly InputIssue[] } {
  return { provenance: provenanceOf(inputs), report: productMonthReport(inputs, sel), inputIssues: inputs.inputIssues };
}

/**
 * Server month projection (AMEND-04; B2's first runtime consumer). The forecast history must
 * know the structured exception days, so the inputs must be loaded with `need.exceptions`
 * (a programming error otherwise); an unreadable ledger yields no projection (never a forecast
 * that silently treats exception days as ordinary history).
 */
export function canonicalMonthProjection(inputs: ServerInputs, report: FinancialReport, opts: { readonly nowMs: number }): ProductProjection & { provenance: ServerProvenance } {
  if (inputs.exceptionsState === "not_loaded") throw new FinanceContractError("exceptions_required", "canonicalMonthProjection");
  const provenance = provenanceOf(inputs);
  if (inputs.exceptionsState === "unreadable") {
    return { projection: null, forecast: { formulaId: REV_FORECAST_FORMULA_ID, projectedRevenue: null, warnings: ["exception_ledger_unreadable"] }, provenance };
  }
  return { ...productMonthProjection(inputs, report, { nowMs: opts.nowMs, tenantId: inputs.tenantId, bizId: inputs.bizId }), provenance };
}

/** A Financial Core contract error (e.g. duplicate_row_id) — never a soft source failure. */
export function isCanonicalFinanceError(e: unknown): boolean {
  return !!e && typeof e === "object" && (e as { name?: unknown }).name === "FinanceContractError";
}
