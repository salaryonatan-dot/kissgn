// Product finance composition (Slice B1, AMEND-01/03/04): the ONE pure composition of the
// approved Slice A functions under the product policies. Server and browser run this same
// compiled source (fincore/v1), so there is never a second financial engine.
//
// Every function binds productPurchaseBasis() (PB_NET/BD-1), productLaborSource()
// (LABOR_SRC/shiftorganizer-hourly-manual/2026-09-29) and NO_DECLARED_CLOSURES internally;
// no caller can pass another basis, labor source or closure calendar. No clock read, no I/O,
// no binary number (the legacy adapter is the only conversion site), no new business rule.
//
// ProductInputs is the single extension point for later slices (F1: effective-dated cost
// versions; P1: purchase transactions and supplier credits). Purchases are folded from ALL
// contributions of a business date (zero or more per date, several per supplier allowed):
// nothing here assumes one value per supplier per day.
import type { BusinessDate, CanonicalDay, Flag, Quarantine } from "../finance/types.js";
import { FinanceContractError } from "../finance/types.js";
import { addDays, isBusinessDate, monthBounds } from "../finance/businessDate.js";
import { groupByDate, normalizeRows } from "../finance/normalize.js";
import type { NormalizeResult } from "../finance/normalize.js";
import { resolvePurchaseBasis } from "../finance/purchaseBasis.js";
import type { CostTimeline } from "../metrics/costTimeline.js";
import { costTimelineFromCurrentConfig } from "../metrics/adapters/configCompat.js";
import { toDailyMetric, toForecastDay } from "../metrics/adapters/legacyNumber.js";
import type { LegacyDailyMetric, LegacyForecastDay } from "../metrics/adapters/legacyNumber.js";
import { computePeriodReport, NO_DECLARED_CLOSURES } from "../metrics/report.js";
import type { FinancialReport } from "../metrics/report.js";
import { applyProjection } from "../metrics/projected.js";
import type { ProjectedFinancials } from "../metrics/projected.js";
import { computeRevenueForecast, REV_FORECAST_FORMULA_ID } from "../forecast/revenueForecast.js";
import type { AmountString } from "../finance/decimal.js";
import { decFromNumber, serializeDec } from "../finance/decimal.js";
import { productPurchaseBasis } from "./purchaseBasis.js";
import { productLaborSource } from "./laborSource.js";

export const PRODUCT_FINANCE_VERSION = "MARJIN_PRODUCT/1";
/** The one forecast formula the month projection is bound to (re-exported for the server wrappers). */
export { REV_FORECAST_FORMULA_ID };

/** Reserved flag key for an unreadable fixed-cost node (AMEND-03). Emitted ONLY for that state. */
export const FIXED_LIST_UNREADABLE_KEY = "__fixed_list_unreadable__";

export type EnvelopeState<T> =
  | { readonly state: "present"; readonly value: T }
  | { readonly state: "absent" }
  | { readonly state: "unreadable"; readonly reason: "envelope_json" | "envelope_shape" };

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Strict `{_v: "<JSON>"}` envelope decoding (config / fixed-cost list). Never throws, never
 * defaults to {} or [].
 *   null / undefined, or an envelope object without `_v` and without other keys ⇒ absent;
 *   `_v` a JSON string of the expected kind ⇒ present (an empty list is present, value []);
 *   `_v` not JSON ⇒ unreadable (envelope_json); anything else ⇒ unreadable (envelope_shape).
 */
export function decodeEnvelope(raw: unknown, expect: "object"): EnvelopeState<Record<string, unknown>>;
export function decodeEnvelope(raw: unknown, expect: "array"): EnvelopeState<unknown[]>;
export function decodeEnvelope(raw: unknown, expect: "object" | "array"): EnvelopeState<Record<string, unknown> | unknown[]> {
  if (raw === null || raw === undefined) return { state: "absent" };
  if (!isPlainObject(raw)) return { state: "unreadable", reason: "envelope_shape" };
  const keys = Object.keys(raw);
  if (!Object.prototype.hasOwnProperty.call(raw, "_v") || raw._v === null || raw._v === undefined) {
    return keys.filter((k) => k !== "_v").length === 0 ? { state: "absent" } : { state: "unreadable", reason: "envelope_shape" };
  }
  if (keys.length !== 1) return { state: "unreadable", reason: "envelope_shape" };
  if (typeof raw._v !== "string") return { state: "unreadable", reason: "envelope_shape" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw._v);
  } catch (_) {
    return { state: "unreadable", reason: "envelope_json" };
  }
  if (expect === "array") return Array.isArray(parsed) ? { state: "present", value: parsed } : { state: "unreadable", reason: "envelope_shape" };
  return isPlainObject(parsed) ? { state: "present", value: parsed } : { state: "unreadable", reason: "envelope_shape" };
}

/** THE input bundle. Later slices add optional fields; call sites never change. */
export interface ProductInputs {
  /** Stored entry rows exactly as returned by the shared entries reader (legacy `_v` array or V2 rows), unmodified; the product composition applies the shared storage decoding (mapFieldReadback). */
  readonly rows: readonly unknown[];
  readonly config: EnvelopeState<Record<string, unknown>>;
  readonly fixed: EnvelopeState<unknown[]>;
  /** The CURRENT Israel business date (supplied by the caller; Actual ends the day before). */
  readonly asOfBusinessDate: BusinessDate;
  /** Structured date-level exception ledger (authoritative when a date is present). */
  readonly exceptionsByDate?: Readonly<Record<BusinessDate, boolean>>;
  // RESERVED, not part of B1: `costVersions` (F1, F-OD-1 activation-boundary timeline);
  // `purchaseContributions` / `supplierCredits` (P1, purchases v2 — credits by issue date).
}

export interface ProductRange {
  readonly from: BusinessDate;
  readonly to: BusinessDate;
}

export interface ProductWindow {
  readonly requested: ProductRange;
  /** Requested range clamped to completed days (≤ asOf − 1); null when empty. */
  readonly effective: ProductRange | null;
  readonly asOfBusinessDate: BusinessDate;
  readonly completedThrough: BusinessDate;
}

export interface ProductDays {
  readonly window: ProductWindow;
  /** One canonical day per date of the effective range (present and missing days). */
  readonly days: CanonicalDay[];
  readonly quarantine: { readonly futureRows: number; readonly invalidDateRows: number };
  readonly flags: Flag[];
}

export type ProductDailyMetric = LegacyDailyMetric & {
  readonly partial: { readonly revenue: boolean; readonly purchases: boolean; readonly hourlyLabor: boolean };
};

export type ProductDayRecord =
  | { readonly inActual: false; readonly date: BusinessDate; readonly reason: "current_day" | "future_date"; readonly presenceDay: "present" | "missing" | "not_examined" }
  | { readonly inActual: true; readonly date: BusinessDate; readonly day: CanonicalDay; readonly metric: ProductDailyMetric };

export interface ProductProjection {
  readonly projection: ProjectedFinancials | null;
  /** Exact contract shape (06 §1): literal formula id; projected revenue as an exact decimal string. */
  readonly forecast: { readonly formulaId: typeof REV_FORECAST_FORMULA_ID; readonly projectedRevenue: AmountString | null; readonly warnings: readonly string[] };
}

// ── Storage decoding shared by server and browser (one meaning for one raw input) ──
/** The two keyed-map fields of an entry row (the client's MarjinStorageV2.MAP_FIELDS). */
export const ENTRY_MAP_FIELDS: readonly string[] = Object.freeze(["supplier_payments", "hourly_payroll"]);

/**
 * RTDB numeric-key readback (approved client contract R2-B3, index.html canonicalMapField):
 * RTDB returns a map whose keys are dense integers ("0", "1", …) as an ARRAY. For the two map
 * fields ONLY, an array is the same value as the map {index: element}; a null element is an
 * absent key. Every other field is untouched; stored rows are never mutated (a changed row is a
 * shallow copy). Applied inside the product composition, so the server and the browser give the
 * SAME result for the SAME raw rows.
 */
export function mapFieldReadback(rows: readonly unknown[]): unknown[] {
  return rows.map((row) => {
    if (!isPlainObject(row)) return row;
    let out: Record<string, unknown> | null = null;
    for (const field of ENTRY_MAP_FIELDS) {
      const v = row[field];
      if (!Array.isArray(v)) continue;
      const map: Record<string, unknown> = {};
      v.forEach((x, i) => { if (x !== null && x !== undefined) map[String(i)] = x; });
      if (out === null) out = { ...row };
      out[field] = map;
    }
    return out === null ? row : out;
  });
}

export type ExceptionLedgerState =
  | { readonly state: "present"; readonly value: Readonly<Record<BusinessDate, boolean>> }
  | { readonly state: "absent" }
  | { readonly state: "unreadable"; readonly reason: "ledger_shape" };

/**
 * Structured exception ledger (`tenants/{t}/entry_exceptions/{bizId}` = {[date]: {state, operations}})
 * → `exceptionsByDate`. Same meaning as the parity-tested resolver (lib/entryExceptions.js
 * resolveEffectiveException): a date whose envelope carries a truthy `state` is structured and
 * is an exception iff `state.status === "active"`; a date without a state falls back to the
 * rows' embedded flag (it is omitted here). Invalid date keys are ignored. A non-object ledger is
 * unreadable (never defaulted to "no exceptions").
 */
export function decodeExceptionLedger(raw: unknown): ExceptionLedgerState {
  if (raw === null || raw === undefined) return { state: "absent" };
  if (!isPlainObject(raw)) return { state: "unreadable", reason: "ledger_shape" };
  const value: Record<BusinessDate, boolean> = {};
  for (const key of Object.keys(raw).sort()) {
    if (!isBusinessDate(key)) continue;
    const env = raw[key];
    const st = isPlainObject(env) ? env.state : undefined;
    if (!st) continue;
    value[key] = isPlainObject(st) && st.status === "active";
  }
  return { state: "present", value };
}

function requireInputs(inputs: ProductInputs): void {
  if (!inputs || typeof inputs !== "object") throw new FinanceContractError("inputs_required");
  if (!isBusinessDate(inputs.asOfBusinessDate)) throw new FinanceContractError("invalid_as_of", inputs && inputs.asOfBusinessDate);
  if (!Array.isArray(inputs.rows)) throw new FinanceContractError("rows_not_array");
}

function requireRange(range: ProductRange): void {
  if (!range || !isBusinessDate(range.from)) throw new FinanceContractError("invalid_date", range && range.from);
  if (!isBusinessDate(range.to)) throw new FinanceContractError("invalid_date", range.to);
}

function normalized(inputs: ProductInputs): NormalizeResult {
  requireInputs(inputs);
  return normalizeRows(mapFieldReadback(inputs.rows), { asOfBusinessDate: inputs.asOfBusinessDate });
}

/**
 * Cost timeline under the current compatibility model (Slice A configCompat; F1 replaces it
 * with effective-dated versions). AMEND-03 / R-17: an ABSENT fixed list is zero fixed cost;
 * an UNREADABLE fixed node is invalid — never zero — via the core's own invalid path.
 */
export function productTimeline(inputs: ProductInputs): CostTimeline {
  const config = inputs.config && inputs.config.state === "present" ? inputs.config.value : null;
  const fixed = inputs.fixed && inputs.fixed.state === "present" ? inputs.fixed.value : null;
  const base = costTimelineFromCurrentConfig(config, fixed);
  if (!inputs.fixed || inputs.fixed.state !== "unreadable") return base;
  const flag: Flag = { code: "invalid_fixed_amount", key: FIXED_LIST_UNREADABLE_KEY, reason: "wrong_type" };
  return { ...base, flags: [...(base.flags || []), flag] };
}

function daysOf(n: NormalizeResult, inputs: ProductInputs, range: ProductRange): ProductDays {
  requireRange(range);
  const completedThrough = addDays(inputs.asOfBusinessDate, -1);
  const to = range.to < completedThrough ? range.to : completedThrough;
  const effective = range.from <= to ? { from: range.from, to } : null;
  const days = effective ? groupByDate(n.rows, { from: effective.from, to: effective.to, exceptionsByDate: inputs.exceptionsByDate }) : [];
  return {
    window: { requested: { from: range.from, to: range.to }, effective, asOfBusinessDate: inputs.asOfBusinessDate, completedThrough },
    days,
    quarantine: { futureRows: n.quarantine.futureRows.length, invalidDateRows: n.quarantine.invalidDateRows.length },
    flags: n.flags,
  };
}

/** Canonical completed days (≤ asOf − 1) of a range. Duplicate dates aggregate (C-22); duplicate ids throw (C-21). */
export function productDays(inputs: ProductInputs, range: ProductRange): ProductDays {
  return daysOf(normalized(inputs), inputs, range);
}

function metricOf(day: CanonicalDay, timeline: CostTimeline, asOf: BusinessDate): ProductDailyMetric {
  const basis = resolvePurchaseBasis(day.purchases.presence === "present" ? [day.date] : [], productPurchaseBasis());
  const metric = toDailyMetric(day, basis, productLaborSource(), timeline, { asOfBusinessDate: asOf, operatingCalendar: NO_DECLARED_CLOSURES });
  return { ...metric, partial: { revenue: day.revenue.partial, purchases: day.purchases.partial, hourlyLabor: day.hourlyLabor.partial } };
}

/** One DailyMetric-shaped record per PRESENT completed day of the range (missing days are omitted). */
export function productDailyMetrics(inputs: ProductInputs, range: ProductRange): ProductDailyMetric[] {
  const d = productDays(inputs, range);
  const timeline = productTimeline(inputs);
  return d.days.filter((day) => day.presence.day === "present").map((day) => metricOf(day, timeline, inputs.asOfBusinessDate));
}

/** The canonical record of one business date: Actual (≤ asOf − 1) or an explicit non-Actual context. */
export function productDayRecord(inputs: ProductInputs, date: BusinessDate): ProductDayRecord {
  if (!isBusinessDate(date)) throw new FinanceContractError("invalid_date", date);
  const n = normalized(inputs);
  const asOf = inputs.asOfBusinessDate;
  if (date > asOf) return { inActual: false, date, reason: "future_date", presenceDay: "not_examined" };
  if (date === asOf) {
    const [today] = groupByDate(n.rows, { from: date, to: date, exceptionsByDate: inputs.exceptionsByDate });
    return { inActual: false, date, reason: "current_day", presenceDay: today.presence.day };
  }
  const [day] = daysOf(n, inputs, { from: date, to: date }).days;
  return { inActual: true, date, day, metric: metricOf(day, productTimeline(inputs), asOf) };
}

/**
 * The Actual month report — the ONLY runtime call of computePeriodReport (G-S4). Quarantine
 * and flags are the dataset's; row-level `row_without_id` flags are limited to rows dated in
 * the month (provenance only; no arithmetic depends on flags of other months).
 */
export function productMonthReport(inputs: ProductInputs, sel: { readonly kind: "open_month" | "closed_month"; readonly month: string }): FinancialReport {
  const n = normalized(inputs);
  const { first, last } = monthBounds(sel && sel.month);
  const days = groupByDate(n.rows, { from: first, to: last, exceptionsByDate: inputs.exceptionsByDate });
  const inMonth = new Set(n.rows.filter((r) => r.date >= first && r.date <= last).map((r) => r.id));
  const flags = n.flags.filter((f) => f.code !== "row_without_id" || (f.rowId !== undefined && inMonth.has(f.rowId)));
  const quarantine: Quarantine = n.quarantine;
  return computePeriodReport(days, productTimeline(inputs), productPurchaseBasis(), productLaborSource(),
    { kind: sel.kind, month: sel.month, asOfBusinessDate: inputs.asOfBusinessDate },
    { quarantine, flags, operatingCalendar: NO_DECLARED_CLOSURES });
}

/**
 * Month projection (AMEND-04; first runtime consumer: B2): approved REV_FORECAST/v1 over the
 * canonical completed-day history → approved MARJIN_PROJ/2 applyProjection on the Actual report.
 * `nowMs` is required so the engine never reads the clock. Insufficient history ⇒ projection null.
 */
export function productMonthProjection(
  inputs: ProductInputs, report: FinancialReport, opts: { readonly nowMs: number; readonly tenantId?: string; readonly bizId?: string },
): ProductProjection {
  if (!opts || typeof opts.nowMs !== "number" || !isFinite(opts.nowMs)) throw new FinanceContractError("now_required", opts && opts.nowMs);
  const n = normalized(inputs);
  let firstDate: BusinessDate | null = null;
  for (const r of n.rows) if (firstDate === null || r.date < firstDate) firstDate = r.date;
  const history: LegacyForecastDay[] = [];
  if (firstDate !== null) {
    for (const day of daysOf(n, inputs, { from: firstDate, to: inputs.asOfBusinessDate }).days) {
      const f = toForecastDay(day);
      if (f !== null) history.push(f);
    }
  }
  const forecast = computeRevenueForecast({
    tenantId: opts.tenantId || "", bizId: opts.bizId || "", targetMonth: report.window.month,
    today: inputs.asOfBusinessDate, nowMs: opts.nowMs, history,
  });
  if (forecast.formulaId !== REV_FORECAST_FORMULA_ID) throw new FinanceContractError("forecast_formula_mismatch", forecast.formulaId);
  const warnings: string[] = [...forecast.warnings];
  if (forecast.monthEndForecastRevenue === null) {
    warnings.push("insufficient_history");
    return { projection: null, forecast: { formulaId: REV_FORECAST_FORMULA_ID, projectedRevenue: null, warnings } };
  }
  // The engine's number is converted ONCE to the exact decimal of its canonical round-trip
  // string (no binary arithmetic); the projection and the output use that exact string.
  let projectedRevenue: AmountString;
  try {
    projectedRevenue = serializeDec(decFromNumber(forecast.monthEndForecastRevenue));
  } catch (_) {
    warnings.push("forecast_revenue_not_exact");
    return { projection: null, forecast: { formulaId: REV_FORECAST_FORMULA_ID, projectedRevenue: null, warnings } };
  }
  const projection = applyProjection(report, { formulaId: REV_FORECAST_FORMULA_ID, month: report.window.month, projectedRevenue }, productTimeline(inputs));
  return { projection, forecast: { formulaId: REV_FORECAST_FORMULA_ID, projectedRevenue, warnings } };
}
