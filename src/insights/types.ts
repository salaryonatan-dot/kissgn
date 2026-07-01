/**
 * Insight Engine v1 — types (Phase 1, INERT).
 *
 * Pure type definitions. No runtime, no network, no DB, no LLM.
 * Consumes the existing analytics:daily doc shape (subset actually used) and
 * emits a deterministic InsightsDailyDoc. Imported by nothing in production
 * until a later wiring phase.
 */

export type InsightSeverity = "info" | "warning" | "critical" | "positive";

export type InsightType =
  | "revenue_drop"
  | "revenue_spike"
  | "weak_weekday"
  | "weather_impact"
  | "alert_impact"
  | "war_day_impact"
  | "labor_risk"
  | "supplier_spend_risk";

/** Subset of the analytics:daily doc that v1 rules actually read. */
export interface AnalyticsDailyInput {
  date: string; // "YYYY-MM-DD"
  bizId: string;
  tenantId?: string;
  revenue: {
    sales: number;
    deliveries: number;
    other_income?: number;
    total: number;
    food_cost: number; // aggregate supplier spend
    payroll: number; // labor
    had_entry: boolean;
  };
  weather: {
    is_rain_day: boolean | null;
    rain_mm: number | null;
  } | null;
  alerts: {
    alert_count: number;
    alert_minutes: number;
    is_alert_day: boolean;
  } | null;
  operational: {
    war_day: "regular" | "partial" | "full" | "unknown";
  };
  calendar: {
    dow: number; // 0=Sun..6=Sat
    weekend: boolean;
    holiday: boolean;
  };
}

export interface Insight {
  id: string; // stable per (bizId, date, type)
  date: string;
  bizId: string;
  type: InsightType;
  severity: InsightSeverity;
  title: string; // short Hebrew headline
  summary: string; // one-sentence deterministic explanation
  evidence: string[]; // the numbers behind it
  recommendation: string | null;
  metric: string; // e.g. "revenue_total" | "labor_pct" | "food_pct"
  currentValue: number | null;
  baselineValue: number | null;
  deltaPct: number | null; // fraction, e.g. -0.22
  confidence: number; // 0..1 deterministic (sample-size based, NOT a model)
  source: "analytics:daily";
  createdAt: number; // epoch ms
}

export interface InsightsDailyDoc {
  date: string;
  bizId: string;
  tenantId: string | null;
  generatedAt: number; // epoch ms
  engineVersion: string; // "insights-v1"
  insights: Insight[]; // ranked; [] if none
}
