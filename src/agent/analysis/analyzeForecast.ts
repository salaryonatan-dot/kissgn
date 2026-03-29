import type { MetricsPlan, FetchedData, AnalysisResult, BaselineResult } from "../types/agent.js";
import type { AgentContext } from "../types/agent.js";
import { avg, round2 } from "../../utils/math.js";
import { todayIso } from "../../utils/dates.js";

export function analyzeForecast(
  plan: MetricsPlan,
  fetched: FetchedData,
  baseline: BaselineResult,
  context: AgentContext
): AnalysisResult {
  const daily = (fetched.metrics["daily"] as Array<{ date: string; revenue: number }>) ?? [];
  const facts: string[] = [];
  let answer = "";
  let meaning: string | undefined;
  const recommendations: string[] = [];

  if (daily.length < 7) {
    return {
      answer: "אין מספיק נתונים לתחזית",
      supportingFacts: [],
      usedSources: fetched.sources,
    };
  }

  const tz = context.timezone || "Asia/Jerusalem";
  const today = todayIso(tz);
  const dayOfMonth = new Date(today).getDate();
  const daysInMonth = new Date(new Date(today).getFullYear(), new Date(today).getMonth() + 1, 0).getDate();
  const remainingDays = daysInMonth - dayOfMonth;

  // MTD revenue
  const sorted = [...daily].sort((a, b) => a.date.localeCompare(b.date));
  const mtdRevenue = sorted.reduce((sum, d) => sum + d.revenue, 0);
  const dailyAvg = avg(sorted.map((d) => d.revenue));

  // Simple projection: MTD + remaining * daily avg
  const projectedTotal = mtdRevenue + remainingDays * dailyAvg;

  answer = `תחזית סוף חודש: ₪${round2(projectedTotal)}`;
  facts.push(`MTD עד היום: ₪${round2(mtdRevenue)}`);
  facts.push(`ממוצע יומי: ₪${round2(dailyAvg)}`);
  facts.push(`נותרו ${remainingDays} ימים בחודש`);

  // Compare to baseline if available
  if (baseline.valid && baseline.value) {
    const baselineMonthly = baseline.value * daysInMonth;
    const pctOfBaseline = (projectedTotal / baselineMonthly) * 100;
    facts.push(`${round2(pctOfBaseline)}% מהביצועים ההיסטוריים הצפויים`);
    if (pctOfBaseline < 90) {
      meaning = "התחזית מתחת לביצועים ההיסטוריים — ייתכן שצריך לפעול";
      recommendations.push("לבדוק מה גורם לביצועים נמוכים ולפעול בהתאם");
    } else if (pctOfBaseline > 110) {
      meaning = "התחזית מעל הצפי — חודש חזק";
    }
  }

  return {
    answer,
    supportingFacts: facts,
    meaning,
    recommendations: recommendations.length > 0 ? recommendations : undefined,
    usedSources: fetched.sources,
  };
}
