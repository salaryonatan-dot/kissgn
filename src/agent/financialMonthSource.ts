// I/O half of the Agent month adapter. Financial decisions remain in the Core
// report and the pure Agent consumer; this file only loads canonical inputs.
import { getDb } from "../firebase/admin.js";
import { loadCanonicalInputs } from "../finance-server/canonicalInputs.js";
import { canonicalMonthProjection, canonicalMonthReport } from "../finance-server/canonicalMetrics.js";
import type { AgentMonthSource } from "./financialMonth.js";
import { assembleAgentFinancialMonth, revenueCalendarMonths } from "./financialMonth.js";

export async function loadAgentMonthSource(tenantId: string, bizId: string, nowMs: number, requestedMonth?: string): Promise<AgentMonthSource> {
  const inputs = await loadCanonicalInputs(getDb(), tenantId, bizId, {
    site: "agent.financialMonth", nowMs, need: { config: true, fixed: true, exceptions: true },
  });
  const month = requestedMonth ?? inputs.asOfBusinessDate.slice(0, 7);
  const kind = month === inputs.asOfBusinessDate.slice(0, 7) ? "open_month" : "closed_month";
  const { report, inputIssues } = canonicalMonthReport(inputs, { kind, month });
  return {
    month,
    asOfBusinessDate: inputs.asOfBusinessDate,
    report,
    projection: kind === "open_month" && report.window.state === "actual" ? canonicalMonthProjection(inputs, report, { nowMs }) : null,
    config: inputs.config,
    inputIssues,
    exceptionsState: inputs.exceptionsState,
  };
}

/** Compatibility entrypoint for the previously exported adapter. */
export async function loadAgentFinancialMonth(tenantId: string, bizId: string, nowMs: number, requestedMonth?: string) {
  return assembleAgentFinancialMonth(await loadAgentMonthSource(tenantId, bizId, nowMs, requestedMonth));
}

/** Same canonical exception ledger and month reports as the financial adapter. */
export async function loadAgentClosedDatesForMonths(tenantId: string, bizId: string, nowMs: number, months: readonly string[]): Promise<readonly string[] | null> {
  const inputs = await loadCanonicalInputs(getDb(), tenantId, bizId, {
    site: "agent.revenueCalendar", nowMs, need: { config: false, fixed: false, exceptions: true, costHistory: false },
  });
  if (inputs.exceptionsState !== "present" && inputs.exceptionsState !== "absent") return null;
  const closed: string[] = [];
  for (const month of months) {
    const kind = month === inputs.asOfBusinessDate.slice(0, 7) ? "open_month" : "closed_month";
    const { report } = canonicalMonthReport(inputs, { kind, month });
    closed.push(...report.operatingCalendar.closedDates);
  }
  return closed;
}

/** Compatibility entrypoint for callers that still specify a date range. */
export async function loadAgentRevenueClosedDates(tenantId: string, bizId: string, nowMs: number,
  range: { readonly start: string; readonly end: string }): Promise<readonly string[] | null> {
  const months = revenueCalendarMonths(range);
  return months === null ? null : loadAgentClosedDatesForMonths(tenantId, bizId, nowMs, months);
}
