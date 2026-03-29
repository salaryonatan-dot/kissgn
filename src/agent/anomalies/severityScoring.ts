import type { Severity } from "../types/agent.js";

export function scoreSeverity(
  deviationPct: number,
  metric: string
): Severity {
  const abs = Math.abs(deviationPct);

  if (metric === "labor_pct") {
    if (abs > 30) return "high";
    if (abs > 15) return "medium";
    return "low";
  }

  if (metric === "daily_revenue") {
    if (abs > 25) return "high";
    if (abs > 15) return "medium";
    return "low";
  }

  if (metric === "food_cost_pct") {
    if (abs > 20) return "high";
    if (abs > 10) return "medium";
    return "low";
  }

  // Default
  if (abs > 25) return "high";
  if (abs > 15) return "medium";
  return "low";
}
