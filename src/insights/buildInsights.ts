/**
 * Insight Engine v1 — orchestrator (Phase 1, INERT).
 *
 * Pure. Runs all deterministic rules over (todayDoc, historyDocs), ranks the
 * results, and assembles an InsightsDailyDoc. No network/DB/LLM. Deterministic:
 * same inputs (and same `now`) → identical output.
 */

import type { AnalyticsDailyInput, Insight, InsightsDailyDoc, InsightType } from "./types.js";
import { ALL_RULES } from "./rules.js";

export const ENGINE_VERSION = "insights-v1";

// Severity ordering for ranking (higher = shown first).
const SEVERITY_RANK: Record<Insight["severity"], number> = {
  critical: 3,
  warning: 2,
  positive: 1,
  info: 0,
};

// Stable rule order for deterministic tie-breaks.
const TYPE_ORDER: InsightType[] = [
  "revenue_drop",
  "revenue_spike",
  "weak_weekday",
  "weather_impact",
  "alert_impact",
  "war_day_impact",
  "labor_risk",
  "supplier_spend_risk",
];

// Diversity groups so the top of the list isn't dominated by one family.
const GROUP_OF: Record<InsightType, string> = {
  revenue_drop: "revenue_movement",
  revenue_spike: "revenue_movement",
  weak_weekday: "revenue_movement",
  weather_impact: "external_context",
  alert_impact: "external_context",
  war_day_impact: "external_context",
  labor_risk: "cost",
  supplier_spend_risk: "cost",
};

/** Primary sort: severity → |deltaPct| → confidence → stable type order. */
function compareInsights(a: Insight, b: Insight): number {
  const s = SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity];
  if (s !== 0) return s;
  const da = Math.abs(a.deltaPct ?? 0);
  const db = Math.abs(b.deltaPct ?? 0);
  if (db !== da) return db - da;
  if (b.confidence !== a.confidence) return b.confidence - a.confidence;
  return TYPE_ORDER.indexOf(a.type) - TYPE_ORDER.indexOf(b.type);
}

/**
 * Rank + diversity cap: sort by importance, then rebuild so no single group
 * appears more than `maxPerGroupInHead` times within the first `headSize`.
 * Overflowed items are demoted (kept, just pushed lower). Deterministic.
 */
export function rankInsights(list: Insight[], headSize = 3, maxPerGroupInHead = 2): Insight[] {
  const sorted = list.slice().sort(compareInsights);
  const head: Insight[] = [];
  const overflow: Insight[] = [];
  const groupCount: Record<string, number> = {};
  for (const ins of sorted) {
    const g = GROUP_OF[ins.type];
    if (head.length < headSize && (groupCount[g] || 0) < maxPerGroupInHead) {
      head.push(ins);
      groupCount[g] = (groupCount[g] || 0) + 1;
    } else {
      overflow.push(ins);
    }
  }
  return head.concat(overflow);
}

/**
 * Build the daily insights doc. `now` is injectable for deterministic tests;
 * it only affects timestamp fields, never the set/order of insights.
 */
export function buildInsights(
  todayDoc: AnalyticsDailyInput | null | undefined,
  historyDocs: AnalyticsDailyInput[] = [],
  now: number = Date.now()
): InsightsDailyDoc {
  const empty = (date: string, bizId: string, tenantId: string | null): InsightsDailyDoc => ({
    date,
    bizId,
    tenantId,
    generatedAt: now,
    engineVersion: ENGINE_VERSION,
    insights: [],
  });

  if (!todayDoc || !todayDoc.date || !todayDoc.bizId) {
    return empty(todayDoc?.date || "", todayDoc?.bizId || "", todayDoc?.tenantId ?? null);
  }

  // No insights on a day with no real entry — never guess.
  if (!todayDoc.revenue || todayDoc.revenue.had_entry !== true) {
    return empty(todayDoc.date, todayDoc.bizId, todayDoc.tenantId ?? null);
  }

  const raw: Insight[] = [];
  for (const rule of ALL_RULES) {
    const r = rule(todayDoc, historyDocs, now);
    if (r) raw.push(r);
  }

  return {
    date: todayDoc.date,
    bizId: todayDoc.bizId,
    tenantId: todayDoc.tenantId ?? null,
    generatedAt: now,
    engineVersion: ENGINE_VERSION,
    insights: rankInsights(raw),
  };
}
