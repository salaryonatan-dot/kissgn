import { FinanceContractError } from "../finance/types.js";
import { addDays, isBusinessDate, monthBounds } from "../finance/businessDate.js";
import { groupByDate, normalizeRows } from "../finance/normalize.js";
import { resolvePurchaseBasis } from "../finance/purchaseBasis.js";
import { costTimelineFromCurrentConfig } from "../metrics/adapters/configCompat.js";
import { toDailyMetric } from "../metrics/adapters/legacyNumber.js";
import { computePeriodReport } from "../metrics/report.js";
import { applyProjection } from "../metrics/projected.js";
import { computeRevenueForecastV2, REV_FORECAST_V2_FORMULA_ID } from "../metrics/revenueForecast.js";
import { decIsZero } from "../finance/decimal.js";
import { productPurchaseBasis } from "./purchaseBasis.js";
import { applySupplierCreditsToDay, creditsByDate, decodeSupplierCredits, REVIEW_ISSUE_CODES, SUPPLIER_CREDITS_CONTRACT_VERSION } from "../finance/supplierCredits.js";
export { decodeSupplierCredits, REVIEW_ISSUE_CODES, SUPPLIER_CREDITS_CONTRACT_VERSION };
import { productLaborSource } from "./laborSource.js";
/**
 * MARJIN_PRODUCT/3 (P1 supplier credits): the composition applies the supplier credits issued on
 * each date (MARJIN_CREDITS/4 since P1 R1, `ProductInputs.supplierCredits`) to that date's purchases, so the
 * report, the daily metrics, the day record and the projection are all NET of credits.
 * MARJIN_PRODUCT/2 (closed-days amendment) is otherwise unchanged.
 */
export const PRODUCT_FINANCE_VERSION = "MARJIN_PRODUCT/3";
/** The one forecast formula the month projection is bound to (REV_FORECAST/v2; re-exported for the server wrappers). */
export const REV_FORECAST_FORMULA_ID = REV_FORECAST_V2_FORMULA_ID;
/** Source label of the product closure calendar (derived from the entry-exception domain). */
export const PRODUCT_CLOSURE_SOURCE = "entry_exception_closure";
/** The one exception reason code that declares an accounting closure (CD-01). */
export const CLOSURE_REASON_CODE = "closure";
/** Reserved flag key for an unreadable fixed-cost node (AMEND-03). Emitted ONLY for that state. */
export const FIXED_LIST_UNREADABLE_KEY = "__fixed_list_unreadable__";
function isPlainObject(v) {
    return typeof v === "object" && v !== null && !Array.isArray(v);
}
export function decodeEnvelope(raw, expect) {
    if (raw === null || raw === undefined)
        return { state: "absent" };
    if (!isPlainObject(raw))
        return { state: "unreadable", reason: "envelope_shape" };
    const keys = Object.keys(raw);
    if (!Object.prototype.hasOwnProperty.call(raw, "_v") || raw._v === null || raw._v === undefined) {
        return keys.filter((k) => k !== "_v").length === 0 ? { state: "absent" } : { state: "unreadable", reason: "envelope_shape" };
    }
    if (keys.length !== 1)
        return { state: "unreadable", reason: "envelope_shape" };
    if (typeof raw._v !== "string")
        return { state: "unreadable", reason: "envelope_shape" };
    let parsed;
    try {
        parsed = JSON.parse(raw._v);
    }
    catch (_) {
        return { state: "unreadable", reason: "envelope_json" };
    }
    if (expect === "array")
        return Array.isArray(parsed) ? { state: "present", value: parsed } : { state: "unreadable", reason: "envelope_shape" };
    return isPlainObject(parsed) ? { state: "present", value: parsed } : { state: "unreadable", reason: "envelope_shape" };
}
// ── Storage decoding shared by server and browser (one meaning for one raw input) ──
/** The two keyed-map fields of an entry row (the client's MarjinStorageV2.MAP_FIELDS). */
export const ENTRY_MAP_FIELDS = Object.freeze(["supplier_payments", "hourly_payroll"]);
/**
 * RTDB numeric-key readback (approved client contract R2-B3, index.html canonicalMapField):
 * RTDB returns a map whose keys are dense integers ("0", "1", …) as an ARRAY. For the two map
 * fields ONLY, an array is the same value as the map {index: element}; a null element is an
 * absent key. Every other field is untouched; stored rows are never mutated (a changed row is a
 * shallow copy). Applied inside the product composition, so the server and the browser give the
 * SAME result for the SAME raw rows.
 */
export function mapFieldReadback(rows) {
    return rows.map((row) => {
        if (!isPlainObject(row))
            return row;
        let out = null;
        for (const field of ENTRY_MAP_FIELDS) {
            const v = row[field];
            if (!Array.isArray(v))
                continue;
            const map = {};
            v.forEach((x, i) => { if (x !== null && x !== undefined)
                map[String(i)] = x; });
            if (out === null)
                out = { ...row };
            out[field] = map;
        }
        return out === null ? row : out;
    });
}
/**
 * Structured exception ledger (`tenants/{t}/entry_exceptions/{bizId}` = {[date]: {state, operations}})
 * → effective structured states. Same meaning as the parity-tested resolver (lib/entryExceptions.js
 * resolveEffectiveException / buildEffectiveRecord): a date whose envelope carries a truthy `state`
 * is structured; it is ACTIVE iff `state.status === "active"` (then its `reasonCode` is kept),
 * otherwise CLEARED (reason dropped, like the list API). A date without a state falls back to the
 * rows' embedded flag (it is omitted here). Invalid date keys are ignored. A non-object ledger is
 * unreadable (never defaulted to "no exceptions").
 */
export function decodeExceptionLedger(raw) {
    if (raw === null || raw === undefined)
        return { state: "absent" };
    if (!isPlainObject(raw))
        return { state: "unreadable", reason: "ledger_shape" };
    const value = {};
    for (const key of Object.keys(raw).sort()) {
        if (!isBusinessDate(key))
            continue;
        const env = raw[key];
        const st = isPlainObject(env) ? env.state : undefined;
        if (!st)
            continue;
        const active = isPlainObject(st) && st.status === "active";
        const reason = active && isPlainObject(st) && typeof st.reasonCode === "string" ? st.reasonCode : null;
        value[key] = { status: active ? "active" : "cleared", reasonCode: reason };
    }
    return { state: "present", value };
}
/** Structured states → the boolean exception ledger (active ⇔ exception). */
export function exceptionsByDateOf(states) {
    const out = {};
    for (const k of Object.keys(states).sort())
        out[k] = states[k].status === "active";
    return out;
}
function requireInputs(inputs) {
    if (!inputs || typeof inputs !== "object")
        throw new FinanceContractError("inputs_required");
    if (!isBusinessDate(inputs.asOfBusinessDate))
        throw new FinanceContractError("invalid_as_of", inputs && inputs.asOfBusinessDate);
    if (!Array.isArray(inputs.rows))
        throw new FinanceContractError("rows_not_array");
}
function requireRange(range) {
    if (!range || !isBusinessDate(range.from))
        throw new FinanceContractError("invalid_date", range && range.from);
    if (!isBusinessDate(range.to))
        throw new FinanceContractError("invalid_date", range.to);
}
function normalized(inputs) {
    requireInputs(inputs);
    return normalizeRows(mapFieldReadback(inputs.rows), { asOfBusinessDate: inputs.asOfBusinessDate });
}
/**
 * The closure calendar cannot be known when the structured ledger was unreadable or was not
 * loaded at all (R1 / F-01: "not_loaded" is never an empty ledger). "absent" and "present" are
 * loaded ledgers; an omitted state means the caller supplied the complete structured ledger.
 */
export function closureCalendarUnknown(inputs) {
    return inputs.exceptionLedgerState === "unreadable" || inputs.exceptionLedgerState === "not_loaded";
}
function exceptionsOf(inputs) {
    if (inputs.exceptionsByDate)
        return inputs.exceptionsByDate;
    return inputs.exceptionStates ? exceptionsByDateOf(inputs.exceptionStates) : undefined;
}
/**
 * The product closure calendar (CDA-01, CD-AT24): every declared closure, completed or future.
 *   structured state present  → closure ⇔ active with reasonCode "closure" (cleared wins over legacy);
 *   structured state absent   → narrow legacy fallback: exactly ONE row on the date, carrying
 *                               `is_exception:true` and `exception_reason:"closure"`.
 * A date listed only in the boolean `exceptionsByDate` is structured with an unknown reason: it
 * blocks the legacy fallback and is not a closure.
 */
export function productClosureCalendar(inputs, n = normalized(inputs)) {
    const states = inputs.exceptionStates || {};
    const structured = new Set([...Object.keys(states), ...Object.keys(inputs.exceptionsByDate || {})]);
    const closed = new Set();
    for (const [date, st] of Object.entries(states))
        if (isBusinessDate(date) && st.status === "active" && st.reasonCode === CLOSURE_REASON_CODE)
            closed.add(date);
    const rowsByDate = new Map();
    for (const r of n.rows) {
        const l = rowsByDate.get(r.date) || [];
        l.push(r);
        rowsByDate.set(r.date, l);
    }
    for (const [date, list] of rowsByDate) {
        if (structured.has(date) || list.length !== 1)
            continue;
        const r = list[0];
        if (r.isException && r.annotations.exceptionReason.length === 1 && r.annotations.exceptionReason[0] === CLOSURE_REASON_CODE)
            closed.add(date);
    }
    return { source: PRODUCT_CLOSURE_SOURCE, closedDates: [...closed].sort() };
}
/**
 * Cost timeline under the current compatibility model (Slice A configCompat; F1 replaces it
 * with effective-dated versions). AMEND-03 / R-17: an ABSENT fixed list is zero fixed cost;
 * an UNREADABLE fixed node is invalid — never zero — via the core's own invalid path.
 */
export function productTimeline(inputs) {
    const config = inputs.config && inputs.config.state === "present" ? inputs.config.value : null;
    const fixed = inputs.fixed && inputs.fixed.state === "present" ? inputs.fixed.value : null;
    const base = costTimelineFromCurrentConfig(config, fixed);
    if (!inputs.fixed || inputs.fixed.state !== "unreadable")
        return base;
    const flag = { code: "invalid_fixed_amount", key: FIXED_LIST_UNREADABLE_KEY, reason: "wrong_type" };
    return { ...base, flags: [...(base.flags || []), flag] };
}
/** P1: the supplier credits issued on each day (by issue date), applied to its purchases. No credit source ⇒ unchanged days. */
function credited(days, inputs) {
    if (inputs.supplierCredits === undefined || inputs.supplierCredits.state === "absent")
        return days;
    const byDate = creditsByDate(inputs.supplierCredits, days.map((d) => d.date));
    return days.map((d) => applySupplierCreditsToDay(d, byDate.get(d.date)));
}
function daysOf(n, inputs, range) {
    requireRange(range);
    const completedThrough = addDays(inputs.asOfBusinessDate, -1);
    const to = range.to < completedThrough ? range.to : completedThrough;
    const effective = range.from <= to ? { from: range.from, to } : null;
    const days = effective ? credited(groupByDate(n.rows, { from: effective.from, to: effective.to, exceptionsByDate: exceptionsOf(inputs) }), inputs) : [];
    return {
        window: { requested: { from: range.from, to: range.to }, effective, asOfBusinessDate: inputs.asOfBusinessDate, completedThrough },
        days,
        quarantine: { futureRows: n.quarantine.futureRows.length, invalidDateRows: n.quarantine.invalidDateRows.length },
        flags: n.flags,
    };
}
/** Canonical completed days (≤ asOf − 1) of a range. Duplicate dates aggregate (C-22); duplicate ids throw (C-21). */
export function productDays(inputs, range) {
    return daysOf(normalized(inputs), inputs, range);
}
function metricOf(day, timeline, asOf, calendar, closureCalendarUnreadable) {
    const basis = resolvePurchaseBasis(day.purchases.presence === "present" ? [day.date] : [], productPurchaseBasis());
    const metric = toDailyMetric(day, basis, productLaborSource(), timeline, { asOfBusinessDate: asOf, operatingCalendar: calendar, closureCalendarUnreadable });
    // CDA-02 (R1 / F-02): non-zero revenue recorded on a declared closure is not a complete fact
    // on its date either — the recorded amount is kept, the revenue is marked partial/invalid.
    const conflict = calendar.closedDates.includes(day.date) && closedDayRevenueConflict(day);
    return { ...metric, partial: { revenue: day.revenue.partial || conflict, purchases: day.purchases.partial, hourlyLabor: day.hourlyLabor.partial } };
}
/** A declared closure's recorded revenue that is present and non-zero (CDA-02 contradiction). */
export function closedDayRevenueConflict(day) {
    return day.revenue.presence === "present" && day.revenue.value !== null && !decIsZero(day.revenue.value);
}
/** One DailyMetric-shaped record per PRESENT completed day of the range (missing days are omitted). */
export function productDailyMetrics(inputs, range) {
    const n = normalized(inputs);
    const d = daysOf(n, inputs, range);
    const timeline = productTimeline(inputs);
    const calendar = productClosureCalendar(inputs, n);
    const unknown = closureCalendarUnknown(inputs);
    return d.days.filter((day) => day.presence.day === "present").map((day) => metricOf(day, timeline, inputs.asOfBusinessDate, calendar, unknown));
}
/** The canonical record of one business date: Actual (≤ asOf − 1) or an explicit non-Actual context. */
export function productDayRecord(inputs, date) {
    if (!isBusinessDate(date))
        throw new FinanceContractError("invalid_date", date);
    const n = normalized(inputs);
    const asOf = inputs.asOfBusinessDate;
    if (date > asOf)
        return { inActual: false, date, reason: "future_date", presenceDay: "not_examined" };
    if (date === asOf) {
        const [today] = groupByDate(n.rows, { from: date, to: date, exceptionsByDate: exceptionsOf(inputs) });
        return { inActual: false, date, reason: "current_day", presenceDay: today.presence.day };
    }
    const [day] = daysOf(n, inputs, { from: date, to: date }).days;
    return { inActual: true, date, day, metric: metricOf(day, productTimeline(inputs), asOf, productClosureCalendar(inputs, n), closureCalendarUnknown(inputs)) };
}
/**
 * The Actual month report — the ONLY runtime call of computePeriodReport (G-S4). Quarantine
 * and flags are the dataset's; row-level `row_without_id` flags are limited to rows dated in
 * the month (provenance only; no arithmetic depends on flags of other months).
 */
export function productMonthReport(inputs, sel) {
    // R1 / F-01: coverage, contradiction and the monthly-cost placement all depend on the closure
    // calendar; a ledger that was never loaded is refused, never read as "no closures".
    if (inputs && inputs.exceptionLedgerState === "not_loaded")
        throw new FinanceContractError("closure_calendar_not_loaded", "productMonthReport");
    const n = normalized(inputs);
    const { first, last } = monthBounds(sel && sel.month);
    const days = credited(groupByDate(n.rows, { from: first, to: last, exceptionsByDate: exceptionsOf(inputs) }), inputs);
    const inMonth = new Set(n.rows.filter((r) => r.date >= first && r.date <= last).map((r) => r.id));
    const flags = n.flags.filter((f) => f.code !== "row_without_id" || (f.rowId !== undefined && inMonth.has(f.rowId)));
    const quarantine = n.quarantine;
    return computePeriodReport(days, productTimeline(inputs), productPurchaseBasis(), productLaborSource(), { kind: sel.kind, month: sel.month, asOfBusinessDate: inputs.asOfBusinessDate }, { quarantine, flags, operatingCalendar: productClosureCalendar(inputs, n), closureCalendarUnreadable: closureCalendarUnknown(inputs) });
}
/**
 * Month projection (AMEND-04; first runtime consumer: B2): REV_FORECAST/v2 over the canonical
 * completed-day history and the product closure calendar → approved MARJIN_PROJ/2
 * applyProjection on the Actual report. `nowMs` stays required (the caller's one captured clock;
 * the business date is `asOfBusinessDate`, the engine reads no clock). No month figure when no
 * remaining eligible weekday has enough history (projection null).
 */
export function productMonthProjection(inputs, report, opts) {
    if (!opts || typeof opts.nowMs !== "number" || !isFinite(opts.nowMs))
        throw new FinanceContractError("now_required", opts && opts.nowMs);
    if (report.window.asOfBusinessDate !== inputs.asOfBusinessDate)
        throw new FinanceContractError("projection_clock_mismatch", report.window.asOfBusinessDate);
    const n = normalized(inputs);
    let firstDate = null;
    for (const r of n.rows)
        if (firstDate === null || r.date < firstDate)
            firstDate = r.date;
    if (closureCalendarUnknown(inputs))
        throw new FinanceContractError("closure_calendar_unknown", "productMonthProjection");
    const history = firstDate === null ? [] : daysOf(n, inputs, { from: firstDate, to: inputs.asOfBusinessDate }).days;
    const calendar = productClosureCalendar(inputs, n);
    const engine = computeRevenueForecastV2({ month: report.window.month, asOfBusinessDate: inputs.asOfBusinessDate, history, closedDates: calendar.closedDates });
    if (engine.formulaId !== REV_FORECAST_FORMULA_ID)
        throw new FinanceContractError("forecast_formula_mismatch", engine.formulaId);
    const warnings = [...engine.warnings];
    const base = { formulaId: REV_FORECAST_FORMULA_ID, state: engine.state, missingRevenueDates: engine.missingRevenueDates, invalidRevenueDates: engine.invalidRevenueDates, engine };
    if (engine.monthEndForecastRevenue === null) {
        warnings.push("insufficient_history");
        return { projection: null, forecast: { ...base, projectedRevenue: null, warnings } };
    }
    const projectedRevenue = engine.monthEndForecastRevenue;
    const projection = applyProjection(report, { formulaId: REV_FORECAST_FORMULA_ID, month: report.window.month, projectedRevenue }, productTimeline(inputs));
    return { projection, forecast: { ...base, projectedRevenue, warnings } };
}
