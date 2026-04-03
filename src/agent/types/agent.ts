// Marjin AI Brain — Core Types
// Every type here is production-grade and used across the entire agent pipeline.

export type AgentIntent =
  | "direct_metric_query"
  | "direct_aggregation_query"
  | "comparison_query"
  | "anomaly_detection"
  | "trend_analysis"
  | "forecast_request"
  | "strategic_question"
  | "recommendation_request"
  | "unknown_or_insufficient";

export interface AgentContext {
  tenantId: string;
  bizId: string;
  branchId?: string;
  timezone: string;
  locale: string;
  nowIso: string;
  userQuestion: string;
}

export interface MetricsPlan {
  intent: AgentIntent;
  metrics: MetricKey[];
  dimensions: DimensionKey[];
  filters: Record<string, unknown>;
  timeRange: TimeRange;
  requiresBaseline: boolean;
  requiresComparison: boolean;
  requiresAnomalyDetection: boolean;
  requiresForecast: boolean;
  requiresMemory: boolean;
  branchScope: "single" | "all" | "comparison";
  preferredSources: DataSource[];
}

export type MetricKey =
  | "daily_revenue"
  | "hourly_revenue"
  | "labor_cost"
  | "labor_pct"
  | "food_cost"
  | "food_cost_pct"
  | "product_quantity"
  | "product_revenue"
  | "product_mix"
  | "supplier_purchases"
  | "daily_revenue_mtd"
  | "labor_cost_mtd"
  | "food_cost_mtd";

export type DimensionKey =
  | "date"
  | "hour"
  | "day_of_week"
  | "product_name"
  | "supplier_name"
  | "branch_id"
  | "category";

export type DataSource = "processed_analytics" | "raw_data" | "live_fetch";

export interface TimeRange {
  start: string; // ISO date
  end: string;   // ISO date
}

export interface ValidationIssue {
  code: ValidationCode;
  severity: Severity;
  message: string;
}

export type ValidationCode =
  | "missing_data"
  | "stale_data"
  | "inconsistent_data"
  | "insufficient_sample"
  | "missing_baseline"
  | "wrong_branch_scope"
  | "wrong_time_range";

export type Severity = "low" | "medium" | "high";

export interface ValidationResult {
  ok: boolean;
  completenessScore: number;   // 0-1
  freshnessScore: number;      // 0-1
  consistencyScore: number;    // 0-1
  sampleAdequacyScore: number; // 0-1
  issues: ValidationIssue[];
}

export type BaselineType =
  | "day_of_week"
  | "hourly"
  | "rolling_4_weeks"
  | "rolling_8_weeks"
  | "same_day_across_weeks"
  | "branch"
  | "period_over_period"
  | "none";

export interface BaselineResult {
  baselineType: BaselineType;
  value?: number;
  values?: number[];
  sampleSize: number;
  valid: boolean;
  reason?: string;
}

export interface AnomalyResult {
  metric: string;
  detected: boolean;
  severity?: Severity;
  type?: "absolute" | "relative" | "baseline_deviation";
  currentValue?: number;
  baselineValue?: number;
  deviationPct?: number;
  explanation?: string;
}

export interface ConfidenceResult {
  score: number;      // 0-1
  level: "high" | "medium" | "low" | "very_low";
  shouldAnswer: boolean;
  shouldRefuse: boolean;
  reasons: string[];
}

export interface AnalysisResult {
  answer: string;
  supportingFacts: string[];
  meaning?: string;
  recommendations?: string[];
  anomalies?: AnomalyResult[];
  patterns?: string[];
  usedSources: string[];
}

export interface AgentResponse {
  text: string;
  confidence: ConfidenceResult;
  intent: AgentIntent;
  usedSources: string[];
  shouldUpdateMemory: boolean;
  memoryPayload?: Partial<MemoryInsight>;
}

export type MemoryInsightType =
  | "repeated_weak_day"
  | "labor_inefficiency"
  | "recurring_anomaly"
  | "product_pattern"
  | "recommendation"
  | "recommendation_outcome"
  | "persistent_correlation";

export interface MemoryInsight {
  id?: string;
  tenantId: string;
  branchId?: string;
  type: MemoryInsightType;
  title: string;
  description: string;
  confidence: number;
  createdAt: string;
  updatedAt: string;
  validUntil?: string;
  evidenceRefs?: string[];
  tags?: string[];
}

// Fetched data wrapper returned by analyticsService
export interface FetchedData {
  metrics: Record<string, unknown>;
  completenessScore: number;
  freshnessScore: number;
  consistencyScore: number;
  sampleAdequacyScore: number;
  sources: string[];
  evidenceRefs: string[];
  rawRecordCount: number;
  fetchStatus: Record<string, "ok" | "failed" | "skipped">;
}
