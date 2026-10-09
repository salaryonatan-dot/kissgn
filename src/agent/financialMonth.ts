// Consumer adapter: one canonical month report, projection and resolved business policy.
// No financial arithmetic is performed here. A report is bound to one tenant/business
// and one as-of instant; callers must not substitute daily sums for unavailable facts.
import type { FinancialReport } from "../metrics/report.js";
import type { ProductProjection } from "../policy/productFinance.js";
import { resolvePolicy } from "../policy/registry.js";
import type { ResolvedPolicy } from "../policy/registry.js";
import { amountToNumber } from "../metrics/adapters/legacyNumber.js";
import { addDays, isBusinessDate, israelBusinessDate, monthBounds } from "../finance/businessDate.js";

export interface AgentFinancialMonth {
  readonly month: string;
  readonly asOfBusinessDate: string;
  readonly report: FinancialReport;
  readonly projection: ProductProjection | null;
  readonly policy: ResolvedPolicy | null;
  readonly inputIssues: readonly string[];
  readonly closureCalendarKnown: boolean;
}

export interface AgentMonthSource {
  readonly month: string;
  readonly asOfBusinessDate: string;
  readonly report: FinancialReport;
  readonly projection: ProductProjection | null;
  readonly config: { readonly state: string; readonly value?: Record<string, unknown> };
  readonly inputIssues: readonly string[];
  readonly exceptionsState: string;
}

/** The exact calendar months needed for a requested revenue range. */
export function revenueCalendarMonths(range: { readonly start: string; readonly end: string }): readonly string[] | null {
  if (!isBusinessDate(range.start) || !isBusinessDate(range.end) || range.start > range.end) return null;
  const months: string[] = [];
  let month = range.start.slice(0, 7);
  const lastMonth = range.end.slice(0, 7);
  while (month <= lastMonth) {
    if (months.length >= 14) return null;
    months.push(month);
    const next = addDays(monthBounds(month).last, 1);
    month = next.slice(0, 7);
  }
  return months;
}

export function assembleAgentFinancialMonth(source: AgentMonthSource): AgentFinancialMonth {
  return {
    month: source.month,
    asOfBusinessDate: source.asOfBusinessDate,
    report: source.report,
    projection: source.projection,
    policy: source.config.state === "unreadable" ? null : resolvePolicy(source.config.state === "present" ? source.config.value ?? null : null),
    inputIssues: source.inputIssues,
    closureCalendarKnown: source.exceptionsState === "present" || source.exceptionsState === "absent",
  };
}

export function agentRequestWindow(nowIso: string, range: { readonly start: string; readonly end: string }):
  { readonly asOfBusinessDate: string; readonly actualEnd: string } {
  const nowMs = Date.parse(nowIso);
  const asOfBusinessDate = Number.isFinite(nowMs) ? israelBusinessDate(nowMs) : "";
  const actualEnd = range.start.slice(0, 7) === asOfBusinessDate.slice(0, 7) && range.end >= asOfBusinessDate
    ? addDays(asOfBusinessDate, -1) : range.end;
  return { asOfBusinessDate, actualEnd };
}

export function isFullMonthRequest(range: { readonly start: string; readonly end: string }, asOfBusinessDate: string): boolean {
  const month = range.start.slice(0, 7);
  return range.start === `${month}-01` && (range.end === monthBounds(month).last ||
    (month === asOfBusinessDate.slice(0, 7) && (range.end === addDays(asOfBusinessDate, -1) ||
      (range.end >= asOfBusinessDate && range.end <= monthBounds(month).last))));
}

export function completeRatio(ratio: { readonly state: string; readonly value?: string }): number | null {
  if (ratio.state !== "value" || ratio.value === undefined) return null;
  return amountToNumber(ratio.value);
}

export function coversRequestedMonth(month: AgentFinancialMonth | undefined, range: { start: string; end: string }): month is AgentFinancialMonth {
  if (!month || month.report.window.state !== "actual") return false;
  const window = month.report.window;
  if (range.start !== `${window.month}-01`) return false;
  return window.kind === "closed_month"
    ? range.end === monthBounds(window.month).last
    : window.completedThrough !== null && (range.end === window.completedThrough ||
      (range.end >= month.asOfBusinessDate && range.end <= monthBounds(window.month).last));
}

export interface TrustedRevenueDay {
  readonly date: string;
  readonly revenue: number;
}

export function revenueClosedDates(metrics: Readonly<Record<string, unknown>>): readonly string[] | null {
  const dates = metrics["revenueClosedDates"];
  return Array.isArray(dates) && dates.every(isBusinessDate) ? dates : null;
}

/** Exact completed-date revenue coverage. Missing/partial dates are unknown, not zero. */
export function trustedCompletedRevenueDays(
  raw: unknown,
  range: { readonly start: string; readonly end: string },
  asOfBusinessDate: string,
  closedDates: readonly string[] = [],
): { readonly days: readonly TrustedRevenueDay[]; readonly completedThrough: string } | null {
  if (!Array.isArray(raw) || !isBusinessDate(range.start) || !isBusinessDate(range.end) ||
      !isBusinessDate(asOfBusinessDate) || range.start > range.end ||
      range.end > monthBounds(asOfBusinessDate.slice(0, 7)).last) return null;
  const completedThrough = addDays(asOfBusinessDate, -1);
  if (range.start > completedThrough) return null;
  const to = range.end < completedThrough ? range.end : completedThrough;
  const expected: string[] = [];
  for (let date = range.start; date <= to; date = addDays(date, 1)) {
    if (expected.length === 400) return null;
    expected.push(date);
  }
  const closed = new Set(closedDates);
  const byDate = new Map<string, TrustedRevenueDay>();
  for (const row of raw) {
    if (!row || typeof row !== "object") return null;
    const d = row as { date?: unknown; revenue?: unknown; presence?: { revenue?: unknown }; partial?: { revenue?: unknown } };
    if (!isBusinessDate(d.date) || d.date < range.start || byDate.has(d.date)) return null;
    // A planner may ask through today or month-end, while Actual stops at D-1.
    if (d.date > to) continue;
    if (closed.has(d.date)) {
      if (d.presence?.revenue === "present" && d.revenue === 0 && !d.partial?.revenue) {
        byDate.set(d.date, { date: d.date, revenue: 0 });
        continue;
      }
      return null;
    }
    if (d.presence?.revenue !== "present" || d.partial?.revenue ||
        typeof d.revenue !== "number" || !Number.isFinite(d.revenue)) return null;
    byDate.set(d.date, { date: d.date, revenue: d.revenue });
  }
  const open = expected.filter((date) => !closed.has(date));
  if (open.length === 0 || open.some((date) => !byDate.has(date))) return null;
  return { days: open.map((date) => byDate.get(date)!), completedThrough: to };
}
