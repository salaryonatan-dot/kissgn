import { RAT_ZERO, decIsNegative, decIsZero, ratAdd, ratDiv, ratFromDec, ratFromInt, serializeRat } from "../finance/decimal.js";
import { addDays, datesInRange, dowOf, isBusinessDate, monthBounds } from "../finance/businessDate.js";
import { FinanceContractError } from "../finance/types.js";
export const REV_FORECAST_V2_FORMULA_ID = "REV_FORECAST/v2";
/** Newest eligible same-weekday observations used per weekday (CD-14). */
export const FORECAST_SAMPLE_WINDOW = 6;
/** Existing minimum-history threshold (unchanged from REV_FORECAST/v1). */
export const MIN_ELIGIBLE_SAMPLES = 3;
/** Why a completed day is (not) a weekday observation. Pure. */
export function sampleEligibility(day, closed) {
    if (closed.has(day.date))
        return { eligible: false, reason: "declared_closure" };
    if (day.revenue.presence === "absent")
        return { eligible: false, reason: "missing_revenue" };
    if (day.revenue.presence === "invalid" || day.revenue.partial || day.revenue.value === null)
        return { eligible: false, reason: "invalid_revenue" };
    if (decIsNegative(day.revenue.value))
        return { eligible: false, reason: "negative_revenue" };
    if (day.exception.isException)
        return { eligible: false, reason: "exception_day" };
    return { eligible: true };
}
const ZERO = "0";
export function computeRevenueForecastV2(input) {
    if (!input || !isBusinessDate(input.asOfBusinessDate))
        throw new FinanceContractError("invalid_as_of", input && input.asOfBusinessDate);
    if (!Array.isArray(input.history) || !Array.isArray(input.closedDates))
        throw new FinanceContractError("forecast_inputs_required");
    const asOf = input.asOfBusinessDate;
    const { first, last } = monthBounds(input.month);
    const closed = new Set();
    for (const d of input.closedDates) {
        if (!isBusinessDate(d))
            throw new FinanceContractError("invalid_operating_calendar", d);
        closed.add(d);
    }
    const byDate = new Map();
    for (const d of input.history) {
        if (d.date >= asOf)
            throw new FinanceContractError("day_outside_actual", d.date);
        if (byDate.has(d.date))
            throw new FinanceContractError("duplicate_day", d.date);
        byDate.set(d.date, d);
    }
    const lastCompleted = addDays(asOf, -1);
    const completedTo = lastCompleted < last ? lastCompleted : last;
    const completedDates = first <= completedTo ? datesInRange(first, completedTo) : [];
    const remainingFrom = asOf > first ? asOf : first;
    const remaining = remainingFrom <= last ? datesInRange(remainingFrom, last) : [];
    // ── Actual through D-1: closures count once (their explicit zero), missing is never 0 ──
    let actual = RAT_ZERO;
    const missing = [];
    const invalid = [];
    const completedClosures = [];
    for (const date of completedDates) {
        const day = byDate.get(date);
        const isClosed = closed.has(date);
        if (isClosed)
            completedClosures.push(date);
        if (day && day.revenue.presence === "present" && day.revenue.value !== null) {
            actual = ratAdd(actual, ratFromDec(day.revenue.value));
            if (day.revenue.partial)
                invalid.push(date);
            else if (isClosed && !decIsZero(day.revenue.value))
                invalid.push(date); // closure with revenue: contradiction (CDA-02)
        }
        else if (day && day.revenue.presence === "invalid")
            invalid.push(date);
        else if (!isClosed)
            missing.push(date);
    }
    // ── Weekday observations: newest six eligible completed same-weekday dates (CD-14/15/16) ──
    const eligibleByWeekday = new Map();
    for (const day of [...byDate.values()].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))) {
        if (!sampleEligibility(day, closed).eligible)
            continue;
        const wd = dowOf(day.date);
        const list = eligibleByWeekday.get(wd) || [];
        if (list.length < FORECAST_SAMPLE_WINDOW)
            list.push(day);
        eligibleByWeekday.set(wd, list);
    }
    const weekdayState = new Map();
    const remainingDates = [];
    const futureClosures = [];
    let remainingForecast = RAT_ZERO;
    let eligibleRemaining = 0;
    let anyInsufficient = false;
    for (const date of remaining) {
        if (closed.has(date)) {
            futureClosures.push(date);
            remainingDates.push({ date, kind: "declared_closure", value: ZERO });
            continue;
        }
        eligibleRemaining += 1;
        const wd = dowOf(date);
        if (!weekdayState.has(wd)) {
            const samples = eligibleByWeekday.get(wd) || [];
            const avg = samples.length >= MIN_ELIGIBLE_SAMPLES
                ? ratDiv(samples.reduce((acc, d) => ratAdd(acc, ratFromDec(d.revenue.value)), RAT_ZERO), ratFromInt(samples.length))
                : null;
            weekdayState.set(wd, { dates: [], samples, avg });
        }
        const w = weekdayState.get(wd);
        w.dates.push(date);
        if (w.avg === null) {
            anyInsufficient = true;
            remainingDates.push({ date, kind: "forecast", value: null });
        }
        else {
            remainingForecast = ratAdd(remainingForecast, w.avg);
            remainingDates.push({ date, kind: "forecast", value: serializeRat(w.avg) });
        }
    }
    const weekdays = [];
    for (let wd = 0; wd < 7; wd += 1) {
        const w = weekdayState.get(wd);
        if (!w)
            continue;
        weekdays.push({
            weekday: wd,
            remainingEligibleDates: w.dates,
            // oldest → newest (the six newest eligible observations)
            sampleDates: [...w.samples].reverse().map((d) => d.date),
            sampleValues: [...w.samples].reverse().map((d) => serializeRat(ratFromDec(d.revenue.value))),
            sampleAverage: w.avg === null ? null : serializeRat(w.avg),
            status: w.avg === null ? "insufficient_history" : "ready",
        });
    }
    const readyAny = weekdays.some((w) => w.status === "ready");
    const allInsufficient = eligibleRemaining >= 1 && !readyAny;
    const warnings = [];
    if (missing.length >= 1)
        warnings.push("missing_completed_days");
    if (invalid.length >= 1)
        warnings.push("invalid_completed_days");
    if (anyInsufficient)
        warnings.push("insufficient_weekday_history");
    if (futureClosures.length >= 1)
        warnings.push("declared_closures_receive_no_forecast");
    if (remaining.includes(asOf) && !closed.has(asOf))
        warnings.push("partial_current_day");
    const state = allInsufficient ? "insufficient_history" : missing.length + invalid.length >= 1 || anyInsufficient ? "partial" : "complete";
    return {
        formulaId: REV_FORECAST_V2_FORMULA_ID,
        month: input.month,
        asOfBusinessDate: asOf,
        sampleWindow: FORECAST_SAMPLE_WINDOW,
        minSamples: MIN_ELIGIBLE_SAMPLES,
        state,
        actualCompletedRevenue: serializeRat(actual),
        remainingForecastRevenue: serializeRat(remainingForecast),
        monthEndForecastRevenue: allInsufficient ? null : serializeRat(ratAdd(actual, remainingForecast)),
        completedThrough: completedDates.length ? completedDates[completedDates.length - 1] : null,
        missingRevenueDates: missing,
        invalidRevenueDates: invalid,
        completedClosureDates: completedClosures,
        futureClosureDates: futureClosures,
        forecastEligibleRemainingDays: eligibleRemaining,
        remainingDates,
        weekdays,
        warnings,
    };
}
