import type { MetricsPlan, FetchedData, AnalysisResult, BaselineResult } from "../types/agent.js";
import type { AgentContext } from "../types/agent.js";
import { avg, pctChange, round2 } from "../../utils/math.js";
import { israelBusinessDate } from "../../finance/businessDate.js";
import type { AgentFinancialMonth } from "../financialMonth.js";
import { revenueClosedDates, trustedCompletedRevenueDays } from "../financialMonth.js";
import { formatShekel } from "../../presenters/money.js";
import { formatPercent } from "../../presenters/percent.js";

export function analyzeComparison(
  plan: MetricsPlan,
  fetched: FetchedData,
  baseline: BaselineResult,
  context: AgentContext
): AnalysisResult {
  const daily = (fetched.metrics["daily"] as Array<{ date: string; revenue: number }>) ?? [];
  const facts: string[] = [];
  let answer = "";
  let meaning: string | undefined;

  if (!baseline.valid || !baseline.value) {
    return {
      answer: "אין מספיק נתונים לביצוע השוואה",
      supportingFacts: [],
      usedSources: fetched.sources,
    };
  }

  // Split only an exact, complete operating-day window; missing days are unknown.
  const asOfMs = Date.parse(context.nowIso);
  const month = fetched.metrics["financialMonth"] as AgentFinancialMonth | undefined;
  const closed = revenueClosedDates(fetched.metrics);
  const trusted = Number.isFinite(asOfMs) && fetched.fetchStatus?.daily === "ok" && closed !== null
    ? trustedCompletedRevenueDays(daily, plan.timeRange, israelBusinessDate(asOfMs), closed)
    : null;
  if (!trusted || trusted.days.length < 2) return { answer: "נתוני הכנסה מלאים לתקופה המבוקשת אינם זמינים להשוואה", supportingFacts: [], usedSources: fetched.sources };
  const sorted = [...trusted.days];
  const mid = Math.floor(sorted.length / 2);
  const currentPeriod = sorted.slice(mid);
  const currentAvg = avg(currentPeriod.map((d) => d.revenue));
  const baselineValue = baseline.value;
  const change = pctChange(currentAvg, baselineValue);

  answer = `ממוצע הכנסות בתקופה הנוכחית: ${formatShekel(String(currentAvg))} | baseline: ${formatShekel(String(baselineValue))}`;
  facts.push(`שינוי: ${change > 0 ? "+" : ""}${formatPercent(String(change))}`);
  facts.push(`תקופה נוכחית: ${currentPeriod.length} ימים`);
  facts.push(`baseline מבוסס על ${baseline.sampleSize} דגימות`);

  if (Math.abs(change) > 15) {
    meaning = change > 0
      ? `שיפור משמעותי של ${round2(Math.abs(change))}% — שווה לבדוק מה עובד`
      : `ירידה משמעותית של ${round2(Math.abs(change))}% — צריך לחקור`;
  } else if (Math.abs(change) > 5) {
    meaning = change > 0
      ? `שיפור מתון של ${round2(Math.abs(change))}%`
      : `ירידה מתונה של ${round2(Math.abs(change))}%`;
  } else {
    meaning = "ביצועים יציבים ללא שינוי משמעותי";
  }

  return { answer, supportingFacts: facts, meaning, usedSources: fetched.sources };
}
