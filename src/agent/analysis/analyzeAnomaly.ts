import type { MetricsPlan, FetchedData, AnalysisResult, AnomalyResult, BaselineResult } from "../types/agent.js";
import type { AgentContext } from "../types/agent.js";
import { avg, pctChange, round2 } from "../../utils/math.js";
import { zScore } from "../../utils/stats.js";

export function analyzeAnomaly(
  plan: MetricsPlan,
  fetched: FetchedData,
  baseline: BaselineResult,
  _context: AgentContext
): AnalysisResult {
  const daily = (fetched.metrics["daily"] as Array<{ date: string; revenue: number; laborPct?: number; laborCost?: number }>) ?? [];
  const anomalies: AnomalyResult[] = [];
  const facts: string[] = [];
  const patterns: string[] = [];
  let answer = "";
  let meaning: string | undefined;

  if (daily.length < 7) {
    return {
      answer: "אין מספיק נתונים לזיהוי חריגות",
      supportingFacts: [],
      anomalies: [],
      usedSources: fetched.sources,
    };
  }

  const sorted = [...daily].sort((a, b) => a.date.localeCompare(b.date));

  // Revenue anomalies — use baseline values if available, otherwise fall back to full dataset
  const revenues = sorted.map((d) => d.revenue);
  const recentRevenue = revenues[revenues.length - 1];
  const baselineRevenues = baseline.values && baseline.values.length >= 7
    ? baseline.values
    : revenues;
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

  // Labor % anomalies — use baseline window if available
  const laborPcts = sorted.filter((d) => d.laborPct != null).map((d) => d.laborPct!);
  if (laborPcts.length >= 7) {
    const recentLabor = laborPcts[laborPcts.length - 1];
    // Use baseline-length window for labor z-score when baseline is valid
    const baselineLaborWindow = baseline.valid && baseline.values && baseline.values.length >= 7
      ? laborPcts.slice(-(baseline.values.length))
      : laborPcts;
    const laborZ = zScore(recentLabor, baselineLaborWindow, 1.8); // slightly more sensitive for labor
    if (laborZ.isAnomaly) {
      anomalies.push({
        metric: "labor_pct",
        detected: true,
        severity: recentLabor > 32 ? "high" : "medium", // F&B threshold: 32%
        type: "baseline_deviation",
        currentValue: recentLabor,
        baselineValue: avg(laborPcts),
        deviationPct: round2(pctChange(recentLabor, avg(laborPcts))),
        explanation: laborZ.direction === "high"
          ? `אחוז כוח אדם גבוה חריג: ${round2(recentLabor)}% (ממוצע: ${round2(avg(laborPcts))}%)`
          : `אחוז כוח אדם נמוך חריג: ${round2(recentLabor)}%`,
      });
    }

    // Absolute threshold: labor > 32% is always a flag in F&B
    if (recentLabor > 32 && !laborZ.isAnomaly) {
      anomalies.push({
        metric: "labor_pct",
        detected: true,
        severity: recentLabor > 35 ? "high" : "medium",
        type: "absolute",
        currentValue: recentLabor,
        explanation: `אחוז כוח אדם ${round2(recentLabor)}% — מעל הסף המקובל`,
      });
    }
  }

  // Build answer
  if (anomalies.length === 0) {
    answer = "לא זוהו חריגות משמעותיות בתקופה האחרונה";
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
