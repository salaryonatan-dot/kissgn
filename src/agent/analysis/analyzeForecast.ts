import type { MetricsPlan, FetchedData, AnalysisResult, BaselineResult } from "../types/agent.js";
import type { AgentContext } from "../types/agent.js";
import type { AgentFinancialMonth } from "../financialMonth.js";
import { formatShekel } from "../../presenters/money.js";

// Agent presents the same REV_FORECAST result used by the canonical month projection.
// Partial and unavailable forecasts have no displayable number.
export function analyzeForecast(
  plan: MetricsPlan,
  fetched: FetchedData,
  _baseline: BaselineResult,
  _context: AgentContext
): AnalysisResult {
  const month = fetched.metrics["financialMonth"] as AgentFinancialMonth | undefined;
  const forecast = month?.projection?.forecast;
  if (!forecast || forecast.state !== "complete" || forecast.projectedRevenue === null ||
      month?.report.window.kind !== "open_month" || !plan.timeRange.start.startsWith(month.month) ||
      !plan.timeRange.end.startsWith(month.month)) {
    return {
      answer: "תחזית סוף החודש אינה זמינה ממקור פיננסי שלם",
      supportingFacts: forecast ? [`מצב התחזית: ${forecast.state}`, ...forecast.warnings] : [],
      usedSources: fetched.sources,
    };
  }
  return {
    answer: `תחזית הכנסות סוף חודש: ${formatShekel(forecast.projectedRevenue)}`,
    supportingFacts: [`נוסחה: ${forecast.formulaId}`, `נתוני Actual עד ${month.report.window.completedThrough}`],
    usedSources: fetched.sources,
  };
}
