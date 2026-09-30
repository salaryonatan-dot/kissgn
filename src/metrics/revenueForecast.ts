// REV_FORECAST/v2 — closure-aware month revenue forecast over canonical days (owner-approved
// closed-days amendment 2026-09-30: CD-04/05/06/14/15/16, CDA-03…07, CDA-18, CDA-21/22).
//
//   monthForecast = Actual revenue of the month's COMPLETED dates (through D-1; a completed
//                   declared closure contributes its explicit zero ONCE)
//                 + Σ forecast(each remaining revenue-forecast-eligible date)
//   remaining date = the current business date and every later date of the month
//   forecast(d)    = 0 when d is a declared closure (immediately, even while d is future)
//                  = mean of the NEWEST SIX eligible same-weekday observations strictly before
//                    the current business date, when at least MIN_ELIGIBLE_SAMPLES exist
//                  = insufficient (nothing is fabricated) otherwise
//
// An eligible observation is a COMPLETED operating date whose revenue is present, complete and
// not negative — an explicitly entered 0 on an operating date IS eligible. A declared closure,
// missing or invalid/partial revenue, a negative total and a generic (non-closure) exception day
// are skipped, and the search continues earlier, so a closure never depresses a later average.
// Exact rational arithmetic only: no binary number, no rounding, no clock read. This is the
// shared core forecast of the product composition; REV_FORECAST/v1 (src/forecast, E-owned and
// mirrored in index.html) is untouched and no longer used by the product composition.
import type { AmountString, Rat } from "../finance/decimal.js";
import { RAT_ZERO, decIsNegative, decIsZero, ratAdd, ratDiv, ratFromDec, ratFromInt, serializeRat } from "../finance/decimal.js";
import { addDays, datesInRange, dowOf, isBusinessDate, monthBounds } from "../finance/businessDate.js";
import type { BusinessDate, CanonicalDay } from "../finance/types.js";
import { FinanceContractError } from "../finance/types.js";

export const REV_FORECAST_V2_FORMULA_ID = "REV_FORECAST/v2";
/** Newest eligible same-weekday observations used per weekday (CD-14). */
export const FORECAST_SAMPLE_WINDOW = 6;
/** Existing minimum-history threshold (unchanged from REV_FORECAST/v1). */
export const MIN_ELIGIBLE_SAMPLES = 3;

export type SampleExclusion = "declared_closure" | "missing_revenue" | "invalid_revenue" | "negative_revenue" | "exception_day";

/** Why a completed day is (not) a weekday observation. Pure. */
export function sampleEligibility(day: CanonicalDay, closed: ReadonlySet<BusinessDate>): { readonly eligible: true } | { readonly eligible: false; readonly reason: SampleExclusion } {
  if (closed.has(day.date)) return { eligible: false, reason: "declared_closure" };
  if (day.revenue.presence === "absent") return { eligible: false, reason: "missing_revenue" };
  if (day.revenue.presence === "invalid" || day.revenue.partial || day.revenue.value === null) return { eligible: false, reason: "invalid_revenue" };
  if (decIsNegative(day.revenue.value)) return { eligible: false, reason: "negative_revenue" };
  if (day.exception.isException) return { eligible: false, reason: "exception_day" };
  return { eligible: true };
}

export interface ForecastWeekday {
  readonly weekday: number; // 0 = Sunday … 6 = Saturday
  /** remaining revenue-forecast-eligible dates of this weekday */
  readonly remainingEligibleDates: readonly BusinessDate[];
  readonly sampleDates: readonly BusinessDate[];
  readonly sampleValues: readonly AmountString[];
  readonly sampleAverage: AmountString | null;
  readonly status: "ready" | "insufficient_history" | "not_needed";
}

export interface ForecastRemainingDate {
  readonly date: BusinessDate;
  readonly kind: "declared_closure" | "forecast";
  /** "0" for a declared closure; the weekday average when ready; null when insufficient */
  readonly value: AmountString | null;
}

export interface RevenueForecastV2 {
  readonly formulaId: typeof REV_FORECAST_V2_FORMULA_ID;
  readonly month: string;
  readonly asOfBusinessDate: BusinessDate;
  readonly sampleWindow: number;
  readonly minSamples: number;
  /** "insufficient_history": no remaining eligible weekday has enough observations ⇒ no month figure */
  readonly state: "complete" | "partial" | "insufficient_history";
  readonly actualCompletedRevenue: AmountString;
  readonly remainingForecastRevenue: AmountString;
  readonly monthEndForecastRevenue: AmountString | null;
  readonly completedThrough: BusinessDate | null;
  /** completed OPERATING dates of the month whose revenue is missing / invalid (never zero-imputed, CDA-18) */
  readonly missingRevenueDates: readonly BusinessDate[];
  readonly invalidRevenueDates: readonly BusinessDate[];
  /** declared closures of the month, by completion (CDA-03/04) */
  readonly completedClosureDates: readonly BusinessDate[];
  readonly futureClosureDates: readonly BusinessDate[];
  /** revenue-forecast eligibility counter (distinct from calendar counters, CDA-20) */
  readonly forecastEligibleRemainingDays: number;
  readonly remainingDates: readonly ForecastRemainingDate[];
  readonly weekdays: readonly ForecastWeekday[];
  readonly warnings: readonly string[];
}

export interface RevenueForecastV2Input {
  readonly month: string;
  /** the ONE captured current business date (Actual ends the day before) */
  readonly asOfBusinessDate: BusinessDate;
  /** canonical COMPLETED days (every date < asOf), one per date, any months */
  readonly history: readonly CanonicalDay[];
  /** declared closures (completed and future) */
  readonly closedDates: readonly BusinessDate[];
}

const ZERO: AmountString = "0";

export function computeRevenueForecastV2(input: RevenueForecastV2Input): RevenueForecastV2 {
  if (!input || !isBusinessDate(input.asOfBusinessDate)) throw new FinanceContractError("invalid_as_of", input && input.asOfBusinessDate);
  if (!Array.isArray(input.history) || !Array.isArray(input.closedDates)) throw new FinanceContractError("forecast_inputs_required");
  const asOf = input.asOfBusinessDate;
  const { first, last } = monthBounds(input.month);
  const closed = new Set<BusinessDate>();
  for (const d of input.closedDates) {
    if (!isBusinessDate(d)) throw new FinanceContractError("invalid_operating_calendar", d);
    closed.add(d);
  }
  const byDate = new Map<BusinessDate, CanonicalDay>();
  for (const d of input.history) {
    if (d.date >= asOf) throw new FinanceContractError("day_outside_actual", d.date);
    if (byDate.has(d.date)) throw new FinanceContractError("duplicate_day", d.date);
    byDate.set(d.date, d);
  }

  const lastCompleted = addDays(asOf, -1);
  const completedTo = lastCompleted < last ? lastCompleted : last;
  const completedDates = first <= completedTo ? datesInRange(first, completedTo) : [];
  const remainingFrom = asOf > first ? asOf : first;
  const remaining = remainingFrom <= last ? datesInRange(remainingFrom, last) : [];

  // ── Actual through D-1: closures count once (their explicit zero), missing is never 0 ──
  let actual: Rat = RAT_ZERO;
  const missing: BusinessDate[] = [];
  const invalid: BusinessDate[] = [];
  const completedClosures: BusinessDate[] = [];
  for (const date of completedDates) {
    const day = byDate.get(date);
    const isClosed = closed.has(date);
    if (isClosed) completedClosures.push(date);
    if (day && day.revenue.presence === "present" && day.revenue.value !== null) {
      actual = ratAdd(actual, ratFromDec(day.revenue.value));
      if (day.revenue.partial) invalid.push(date);
      else if (isClosed && !decIsZero(day.revenue.value)) invalid.push(date); // closure with revenue: contradiction (CDA-02)
    } else if (day && day.revenue.presence === "invalid") invalid.push(date);
    else if (!isClosed) missing.push(date);
  }

  // ── Weekday observations: newest six eligible completed same-weekday dates (CD-14/15/16) ──
  const eligibleByWeekday = new Map<number, CanonicalDay[]>();
  for (const day of [...byDate.values()].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))) {
    if (!sampleEligibility(day, closed).eligible) continue;
    const wd = dowOf(day.date);
    const list = eligibleByWeekday.get(wd) || [];
    if (list.length < FORECAST_SAMPLE_WINDOW) list.push(day);
    eligibleByWeekday.set(wd, list);
  }

  const weekdayState = new Map<number, { dates: BusinessDate[]; samples: CanonicalDay[]; avg: Rat | null }>();
  const remainingDates: ForecastRemainingDate[] = [];
  const futureClosures: BusinessDate[] = [];
  let remainingForecast: Rat = RAT_ZERO;
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
        ? ratDiv(samples.reduce((acc: Rat, d) => ratAdd(acc, ratFromDec(d.revenue.value as NonNullable<typeof d.revenue.value>)), RAT_ZERO), ratFromInt(samples.length))
        : null;
      weekdayState.set(wd, { dates: [], samples, avg });
    }
    const w = weekdayState.get(wd) as { dates: BusinessDate[]; samples: CanonicalDay[]; avg: Rat | null };
    w.dates.push(date);
    if (w.avg === null) {
      anyInsufficient = true;
      remainingDates.push({ date, kind: "forecast", value: null });
    } else {
      remainingForecast = ratAdd(remainingForecast, w.avg);
      remainingDates.push({ date, kind: "forecast", value: serializeRat(w.avg) });
    }
  }

  const weekdays: ForecastWeekday[] = [];
  for (let wd = 0; wd < 7; wd += 1) {
    const w = weekdayState.get(wd);
    if (!w) continue;
    weekdays.push({
      weekday: wd,
      remainingEligibleDates: w.dates,
      // oldest → newest (the six newest eligible observations)
      sampleDates: [...w.samples].reverse().map((d) => d.date),
      sampleValues: [...w.samples].reverse().map((d) => serializeRat(ratFromDec(d.revenue.value as NonNullable<typeof d.revenue.value>))),
      sampleAverage: w.avg === null ? null : serializeRat(w.avg),
      status: w.avg === null ? "insufficient_history" : "ready",
    });
  }

  const readyAny = weekdays.some((w) => w.status === "ready");
  const allInsufficient = eligibleRemaining >= 1 && !readyAny;
  const warnings: string[] = [];
  if (missing.length >= 1) warnings.push("missing_completed_days");
  if (invalid.length >= 1) warnings.push("invalid_completed_days");
  if (anyInsufficient) warnings.push("insufficient_weekday_history");
  if (futureClosures.length >= 1) warnings.push("declared_closures_receive_no_forecast");
  if (remaining.includes(asOf) && !closed.has(asOf)) warnings.push("partial_current_day");
  const state: RevenueForecastV2["state"] = allInsufficient ? "insufficient_history" : missing.length + invalid.length >= 1 || anyInsufficient ? "partial" : "complete";
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
