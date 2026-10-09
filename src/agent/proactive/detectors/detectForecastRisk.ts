import type { FetchedData, BaselineResult } from "../../types/agent.js";
import type { DetectorResult } from "../types.js";
import type { AgentFinancialMonth } from "../../financialMonth.js";
import { completeRatio } from "../../financialMonth.js";
import { formatShekel } from "../../../presenters/money.js";
import { formatPercent } from "../../../presenters/percent.js";

// Compatibility signal bands from the former detector. Goals themselves come
// only from the resolved business policy, never from local 28/33 constants.
const WARNING_OVER_GOAL_POINTS = 5;
const HIGH_OVER_GOAL_POINTS = 10;

export function detectForecastRisk(fetched: FetchedData, _baseline: BaselineResult): DetectorResult | null {
  const month = fetched.metrics["financialMonth"] as AgentFinancialMonth | undefined;
  if (!month?.policy || !month.projection || month.projection.forecast.state !== "complete" || month.report.window.state !== "actual") return null;
  const report = month.report;
  const candidates: Array<{ metric: string; ratio: number; goal: number; gap: number }> = [];
  const food = completeRatio(report.actual.purchasesPct);
  const labor = completeRatio(report.actual.labor.employerCostPct);
  const foodGoal = Number(month.policy.values["goal.foodCostPct"].value);
  const laborGoal = Number(month.policy.values["goal.laborCostPct"].value);
  if (report.actual.purchases.complete && food !== null && Number.isFinite(foodGoal) && foodGoal > 0 && food - foodGoal > WARNING_OVER_GOAL_POINTS) {
    candidates.push({ metric: "food_cost_pct", ratio: food, goal: foodGoal, gap: food - foodGoal });
  }
  if (report.actual.labor.employerCost.state === "complete" && labor !== null && Number.isFinite(laborGoal) && laborGoal > 0 && labor - laborGoal > WARNING_OVER_GOAL_POINTS) {
    candidates.push({ metric: "labor_pct", ratio: labor, goal: laborGoal, gap: labor - laborGoal });
  }
  if (!candidates.length) return null;
  candidates.sort((a, b) => b.gap - a.gap || a.metric.localeCompare(b.metric));
  const worst = candidates[0];
  const limitations: string[] = [];
  if (food === null || !report.actual.purchases.complete) limitations.push(`עלות מזון לא שלמה: ${report.actual.purchasesPct.state}`);
  if (labor === null || report.actual.labor.employerCost.state !== "complete") limitations.push(`עלות מעסיק לא שלמה: ${report.actual.labor.employerCostPct.state}`);
  return {
    type: "forecast_risk",
    severity: worst.gap > HIGH_OVER_GOAL_POINTS ? "high" : "medium",
    metric: worst.metric,
    currentValue: worst.ratio,
    baselineValue: worst.goal,
    deviationPct: (worst.gap / worst.goal) * 100,
    periodStart: report.window.from!,
    periodEnd: report.window.to!,
    dataPointCount: report.coverage.revenue.presentDays,
    supportingFacts: [
      `שיעור ${worst.metric} ב-Actual MTD: ${formatPercent(String(worst.ratio))} (יעד: ${formatPercent(String(worst.goal))})`,
      `תחזית הכנסות קנונית: ${formatShekel(month.projection.forecast.projectedRevenue)} (${month.projection.forecast.formulaId})`,
      ...limitations,
    ],
    evidenceRefs: [`finance:${report.window.month}:${report.versions.fin}`, `policy:${month.policy.policyVersion}`],
  };
}
