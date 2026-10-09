import type { MetricsPlan, FetchedData, AnalysisResult, AnomalyResult, BaselineResult } from "../types/agent.js";
import type { AgentContext } from "../types/agent.js";
import { avg, pctChange, round2 } from "../../utils/math.js";
import { zScore } from "../../utils/stats.js";
import type { AgentFinancialMonth } from "../financialMonth.js";
import { completeRatio, coversRequestedMonth, revenueClosedDates, trustedCompletedRevenueDays } from "../financialMonth.js";
import { israelBusinessDate } from "../../finance/businessDate.js";
import { formatPercent } from "../../presenters/percent.js";

export function analyzeAnomaly(
  plan: MetricsPlan,
  fetched: FetchedData,
  _baseline: BaselineResult,
  _context: AgentContext
): AnalysisResult {
  const daily = (fetched.metrics["daily"] as Array<{ date: string; revenue: number; presence?: { revenue?: string }; partial?: { revenue?: boolean } }>) ?? [];
  const anomalies: AnomalyResult[] = [];
  const facts: string[] = [];
  const patterns: string[] = [];
  let answer = "";
  let meaning: string | undefined;

  const asOfMs = Date.parse(_context.nowIso);
  const month = fetched.metrics["financialMonth"] as AgentFinancialMonth | undefined;
  const closed = revenueClosedDates(fetched.metrics);
  const trusted = Number.isFinite(asOfMs) && fetched.fetchStatus?.daily === "ok" && closed !== null
    ? trustedCompletedRevenueDays(daily, plan.timeRange, israelBusinessDate(asOfMs), closed)
    : null;
  const sorted = trusted?.days ?? [];

  // Revenue anomalies — use baseline values if available, otherwise fall back to full dataset
  if (sorted.length >= 7) {
    const revenues = sorted.map((d) => d.revenue);
    const recentRevenue = revenues[revenues.length - 1];
    const baselineRevenues = revenues;
    const revZScore = zScore(recentRevenue, baselineRevenues, 2.0);
    if (revZScore.isAnomaly) {
    anomalies.push({
      metric: "daily_revenue",
      detected: true,
      severity: Math.abs(revZScore.zScore) > 3 ? "high" : "medium",
      type: "baseline_deviation",
      currentValue: recentRevenue,
      baselineValue: avg(baselineRevenues),
      deviationPct: round2(pctChange(recentRevenue, avg(baselineRevenues))),
      explanation: revZScore.direction === "high"
        ? `הכנסות גבוהות באופן חריג (z=${round2(revZScore.zScore)})`
        : `הכנסות נמוכות באופן חריג (z=${round2(revZScore.zScore)})`,
    });
    }
  } else facts.push("מסקנת הכנסות לא זמינה: חסר כיסוי מלא של ימי הפעילות בטווח המבוקש");

  // Labor: one period ratio of totals from the trusted report, with the
  // business's resolved alert thresholds. No mean of daily percentages.
  const laborRatio = month ? completeRatio(month.report.actual.labor.employerCostPct) : null;
  const laborEvaluated = coversRequestedMonth(month, plan.timeRange) && month.policy !== null && month.report.actual.labor.employerCost.state === "complete" && laborRatio !== null;
  if (laborEvaluated) {
    const warning = Number(month.policy.values["alert.laborPctMax"].value);
    const critical = Number(month.policy.values["alert.laborPctCritical"].value);
    if (Number.isFinite(warning) && Number.isFinite(critical) && laborRatio > warning) {
      anomalies.push({
        metric: "labor_pct", detected: true, severity: laborRatio > critical ? "high" : "medium",
        type: "absolute", currentValue: laborRatio, baselineValue: warning,
        deviationPct: round2(laborRatio - warning),
        explanation: `שיעור עלות מעסיק MTD: ${formatPercent(String(laborRatio))} (סף: ${formatPercent(String(warning))})`,
      });
    }
  } else {
    facts.push("מסקנת כוח אדם לא זמינה: דוח חודשי או יחס מעסיק אינם שלמים");
  }

  // Build answer
  if (anomalies.length === 0) {
    answer = sorted.length < 7 ? "אין מספיק נתונים מאומתים לזיהוי חריגות הכנסה" :
      !laborEvaluated ? "לא זוהו חריגות הכנסה בנתונים המאומתים; מצב כוח אדם אינו זמין" : "לא זוהו חריגות משמעותיות בתקופה האחרונה";
    facts.push(`נבדקו ${sorted.length} ימים`);
  } else {
    const highAnomalies = anomalies.filter((a) => a.severity === "high");
    const medAnomalies = anomalies.filter((a) => a.severity === "medium");
    answer = `זוהו ${anomalies.length} חריגות`;
    if (highAnomalies.length > 0) {
      answer += ` (${highAnomalies.length} חמורות)`;
    }
    for (const a of anomalies) {
      if (a.explanation) facts.push(a.explanation);
    }
    if (highAnomalies.length > 0) {
      meaning = "יש חריגות שדורשות טיפול מיידי";
      patterns.push("חריגות חמורות בתקופה האחרונה");
    }
  }

  return {
    answer,
    supportingFacts: facts,
    meaning,
    anomalies,
    patterns,
    usedSources: fetched.sources,
  };
}
