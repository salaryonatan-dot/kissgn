// Policy evaluation: compares exact Actual ratios with resolved goals. Financial truth
// (the report) never depends on a goal; this layer only labels the comparison and states
// where the goal came from. No warning/critical bands are invented here (BD-4).
import { parseAmountString, ratCmp } from "../finance/decimal.js";
import type { FinancialReport } from "../metrics/report.js";
import type { PolicyKey, PolicyValue, ResolvedPolicy } from "./registry.js";

export interface PolicyComparison {
  readonly metric: "purchasesPct" | "laborEmployerCostPct";
  readonly goalKey: PolicyKey;
  readonly goal: PolicyValue;
  readonly state: "above_goal" | "at_or_below_goal" | "not_evaluable";
}

export interface PolicyEvaluation {
  readonly policyVersion: string;
  readonly reportVersion: string;
  readonly comparisons: readonly PolicyComparison[];
}

/** A goal is evaluated only on a ratio whose components are complete over the window (TI-18). */
function complete(c: { missingDays: readonly string[]; invalidDays: readonly string[]; partialDays: readonly string[] }): boolean {
  return c.missingDays.length < 1 && c.invalidDays.length < 1 && c.partialDays.length < 1;
}

function compare(r: { state: string; value?: string }, goal: PolicyValue, componentsComplete: boolean): PolicyComparison["state"] {
  if (!componentsComplete || r.state !== "value" || r.value === undefined) return "not_evaluable";
  return ratCmp(parseAmountString(r.value), parseAmountString(goal.value)) > 0 ? "above_goal" : "at_or_below_goal";
}

export function evaluatePolicy(report: FinancialReport, policy: ResolvedPolicy): PolicyEvaluation {
  const food = policy.values["goal.foodCostPct"];
  const purchasesComplete = complete(report.coverage.revenue) && complete(report.coverage.purchases);
  const labor = policy.values["goal.laborCostPct"];
  return {
    policyVersion: policy.policyVersion,
    reportVersion: report.versions.fin,
    comparisons: [
      { metric: "purchasesPct", goalKey: "goal.foodCostPct", goal: food, state: compare(report.actual.purchasesPct as { state: string; value?: string }, food, purchasesComplete) },
      { metric: "laborEmployerCostPct", goalKey: "goal.laborCostPct", goal: labor, state: compare(report.actual.labor.employerCostPct as { state: string; value?: string }, labor, true) },
    ],
  };
}
