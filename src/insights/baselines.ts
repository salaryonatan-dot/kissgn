/**
 * Insight Engine v1 — baseline helpers (Phase 1, INERT).
 *
 * Pure functions. No network/DB/LLM. Deterministic. Operate over the trailing
 * history of analytics:daily docs to produce averages the rules compare against.
 * Only days with revenue.had_entry === true are ever counted (real days).
 */

import type { AnalyticsDailyInput } from "./types.js";

/**
 * Real days only: an entry was recorded and revenue.total is a finite number.
 * Returned ASCENDING by date (old→new) so every trailing window is correct even
 * if the caller passes an unsorted history. .filter() returns a new array, so
 * the .sort() never mutates the caller's input. Dates are "YYYY-MM-DD" →
 * lexicographic order == chronological order.
 */
export function validDays(history: AnalyticsDailyInput[]): AnalyticsDailyInput[] {
  return (history || [])
    .filter(
      (d) => d && d.revenue && d.revenue.had_entry === true && Number.isFinite(d.revenue.total)
    )
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/** Arithmetic mean, or null on empty. */
export function mean(nums: number[]): number | null {
  if (!nums.length) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

/** Round a fraction/number to n decimals (deterministic). */
export function round(n: number, dp = 2): number {
  const f = Math.pow(10, dp);
  return Math.round(n * f) / f;
}

/** deltaPct = (current - baseline) / baseline; null if baseline is 0/absent. */
export function deltaPct(current: number, baseline: number | null): number | null {
  if (baseline === null || baseline === 0 || !Number.isFinite(baseline)) return null;
  return round((current - baseline) / baseline, 4);
}

/**
 * Deterministic confidence from sample size: 0.30 at n=0, +0.05 per sample,
 * capped at 0.95. NOT a model score — purely reflects how much history backs it.
 */
export function confidenceForSamples(n: number): number {
  return round(Math.min(0.95, 0.3 + 0.05 * Math.max(0, n)), 2);
}

/** Mean of revenue.total over the last `windowDays` valid days (excludes today). */
export function trailingRevenueAvg(
  history: AnalyticsDailyInput[],
  windowDays: number
): { avg: number | null; n: number } {
  const valid = validDays(history).slice(-windowDays);
  const avg = mean(valid.map((d) => d.revenue.total));
  return { avg, n: valid.length };
}

/** Mean of revenue.total over valid days matching a given weekday (0..6). */
export function sameWeekdayAvg(
  history: AnalyticsDailyInput[],
  dow: number
): { avg: number | null; n: number } {
  const valid = validDays(history).filter((d) => d.calendar && d.calendar.dow === dow);
  const avg = mean(valid.map((d) => d.revenue.total));
  return { avg, n: valid.length };
}

/** Mean of a ratio (numerator/total) over valid days with total>0. */
export function trailingRatioAvg(
  history: AnalyticsDailyInput[],
  pick: (d: AnalyticsDailyInput) => number,
  windowDays: number
): { avg: number | null; n: number } {
  const valid = validDays(history)
    .slice(-windowDays)
    .filter((d) => d.revenue.total > 0);
  const ratios = valid.map((d) => pick(d) / d.revenue.total);
  return { avg: mean(ratios), n: valid.length };
}

/** Mean revenue over valid days matching a predicate (e.g. dry days, no-alert days). */
export function condRevenueAvg(
  history: AnalyticsDailyInput[],
  predicate: (d: AnalyticsDailyInput) => boolean
): { avg: number | null; n: number } {
  const valid = validDays(history).filter(predicate);
  return { avg: mean(valid.map((d) => d.revenue.total)), n: valid.length };
}
