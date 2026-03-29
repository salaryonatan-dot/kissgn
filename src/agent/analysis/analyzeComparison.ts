import type { MetricsPlan, FetchedData, AnalysisResult, BaselineResult } from "../types/agent.js";
import type { AgentContext } from "../types/agent.js";
import { avg, pctChange, round2 } from "../../utils/math.js";

export function analyzeComparison(
  plan: MetricsPlan,
  fetched: FetchedData,
  baseline: BaselineResult,
  _context: AgentContext
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

  // Split current vs baseline
  const sorted = [...daily].sort((a, b) => a.date.localeCompare(b.date));
  const mid = Math.floor(sorted.length / 2);
  const currentPeriod = sorted.slice(mid);
  const currentAvg = avg(currentPeriod.map((d) => d.revenue));
  const baselineValue = baseline.value;
  const change = pctChange(currentAvg, baselineValue);

  answer = `ממוצע הכנסות בתקופה הנוכחית: ₪${round2(currentAvg)} | baseline: ₪${round2(baselineValue)}`;
  facts.push(`שינוי: ${change > 0 ? "+" : ""}${round2(change)}%`);
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
