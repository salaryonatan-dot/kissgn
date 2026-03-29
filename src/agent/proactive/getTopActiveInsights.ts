// Marjin AI — Dashboard Retrieval: Top Active Proactive Insights
// Returns non-suppressed insights for display. No LLM.

import type { ProactiveInsight } from "./types.js";
import { getActiveInsights } from "../../repositories/proactive/insightsRepo.js";

/** Formatted insight for dashboard display */
export interface DashboardInsight {
  id: string;
  type: ProactiveInsight["type"];
  severity: ProactiveInsight["severity"];
  headline: string;            // short Hebrew headline
  details: string[];           // supporting facts
  confidenceLevel: string;
  lastDetected: string;        // ISO timestamp
  occurrenceCount: number;
}

/**
 * Get top active insights for a tenant+biz, formatted for dashboard.
 * Returns at most `limit` insights, sorted by severity then recency.
 * All text is deterministic Hebrew — no LLM involved.
 */
export async function getTopActiveInsights(
  tenantId: string,
  bizId: string,
  limit: number = 5
): Promise<DashboardInsight[]> {
  const insights = await getActiveInsights(tenantId, bizId, limit);

  return insights.map((insight) => ({
    id: insight.id,
    type: insight.type,
    severity: insight.severity,
    headline: buildHeadline(insight),
    details: insight.supportingFacts,
    confidenceLevel: insight.confidenceLevel,
    lastDetected: insight.lastDetectedAt,
    occurrenceCount: insight.occurrenceCount,
  }));
}

/**
 * Build a deterministic Hebrew headline for each insight type.
 * No LLM — pure template mapping from structured data.
 */
function buildHeadline(insight: ProactiveInsight): string {
  switch (insight.type) {
    case "revenue_underperformance":
      return insight.severity === "high"
        ? `ירידת הכנסות מתמשכת — ${Math.abs(insight.deviationPct)}% מתחת לממוצע`
        : `הכנסות מתחת לממוצע — סטייה של ${Math.abs(insight.deviationPct)}%`;

    case "labor_inefficiency":
      return insight.severity === "high"
        ? `עלות כוח אדם גבוהה חריגית — ${insight.currentValue}%`
        : `כוח אדם מעל היעד — ${insight.currentValue}% (יעד: ${insight.baselineValue}%)`;

    case "weak_day_pattern":
      return `יום חלש קבוע — הכנסות נמוכות ב-${Math.abs(insight.deviationPct)}% מהממוצע`;

    case "weak_hour_pattern":
      return `שעה חלשה קבועה — הכנסות נמוכות ב-${Math.abs(insight.deviationPct)}% מהממוצע השעתי`;

    case "purchases_without_revenue":
      return insight.severity === "high"
        ? `רכישות עולות חדות (+${Math.abs(insight.deviationPct)}%) ללא גידול בהכנסות`
        : `רכישות עולות (+${Math.abs(insight.deviationPct)}%) — הכנסות לא תומכות`;

    case "forecast_risk":
      if (insight.metric === "revenue") {
        return insight.severity === "high"
          ? `תחזית חודשית בסיכון — הכנסות צפויות לפספס ב-${Math.abs(insight.deviationPct)}%`
          : `הכנסות חודשיות מתחת לצפי — סטייה של ${Math.abs(insight.deviationPct)}%`;
      }
      if (insight.metric === "labor_pct") {
        return `עלות כוח אדם חודשית מעל היעד — +${insight.deviationPct} נ״א`;
      }
      if (insight.metric === "food_cost_pct") {
        return `עלות מזון חודשית מעל היעד — +${insight.deviationPct} נ״א`;
      }
      return `תחזית חודשית בסיכון — סטייה של ${Math.abs(insight.deviationPct)}%`;

    default:
      return "תובנה פרואקטיבית";
  }
}
