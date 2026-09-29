// Policy evaluation: compares exact Actual ratios with resolved goals. Financial truth
// (the report) never depends on a goal; this layer only labels the comparison and states
// where the goal came from. No warning/critical bands are invented here (BD-4).
import { parseAmountString, ratCmp } from "../finance/decimal.js";
/** A goal is evaluated only on a ratio whose components are complete over the window (TI-18). */
function complete(c) {
    return c.missingDays.length < 1 && c.invalidDays.length < 1 && c.partialDays.length < 1;
}
function compare(r, goal, componentsComplete) {
    if (!componentsComplete || r.state !== "value" || r.value === undefined)
        return "not_evaluable";
    return ratCmp(parseAmountString(r.value), parseAmountString(goal.value)) > 0 ? "above_goal" : "at_or_below_goal";
}
export function evaluatePolicy(report, policy) {
    const food = policy.values["goal.foodCostPct"];
    const purchasesComplete = complete(report.coverage.revenue) && complete(report.coverage.purchases);
    const labor = policy.values["goal.laborCostPct"];
    return {
        policyVersion: policy.policyVersion,
        reportVersion: report.versions.fin,
        comparisons: [
            { metric: "purchasesPct", goalKey: "goal.foodCostPct", goal: food, state: compare(report.actual.purchasesPct, food, purchasesComplete) },
            { metric: "laborEmployerCostPct", goalKey: "goal.laborCostPct", goal: labor, state: compare(report.actual.labor.employerCostPct, labor, true) },
        ],
    };
}
