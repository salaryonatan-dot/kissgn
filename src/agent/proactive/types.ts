// Marjin AI — Proactive Insights Layer Types
// Deterministic-only. No LLM dependency.

export type ProactiveInsightType =
  | "revenue_underperformance"
  | "labor_inefficiency"
  | "weak_day_pattern"
  | "weak_hour_pattern"
  | "purchases_without_revenue"
  | "forecast_risk";

export type InsightSeverity = "high" | "medium" | "low";

export interface DetectorResult {
  type: ProactiveInsightType;
  severity: InsightSeverity;
  metric: string;
  currentValue: number;
  baselineValue: number;
  deviationPct: number;
  periodStart: string;           // ISO date
  periodEnd: string;             // ISO date
  dataPointCount: number;
  supportingFacts: string[];     // Hebrew fact strings
  evidenceRefs: string[];        // data pointers
}

export interface ProactiveInsight {
  id: string;                    // `${tenantId}:${bizId}:${type}:${dateKey}`
  tenantId: string;
  bizId: string;
  branchId?: string;

  type: ProactiveInsightType;
  severity: InsightSeverity;

  metric: string;
  currentValue: number;
  baselineValue: number;
  deviationPct: number;

  periodStart: string;
  periodEnd: string;
  dataPointCount: number;

  confidenceScore: number;
  confidenceLevel: "high" | "medium";

  fingerprint: string;
  firstDetectedAt: string;
  lastDetectedAt: string;
  occurrenceCount: number;

  suppressed: boolean;
  suppressionReason?: SuppressionReason;

  evidenceRefs: string[];
  supportingFacts: string[];

  writtenToMemory: boolean;
}

export type SuppressionReason =
  | "low_confidence"
  | "insufficient_data"
  | "duplicate"
  | "quota_exceeded"
  | "chronic_known_issue"
  | "closed_day"
  | "within_normal_variance"
  | "cooldown";

export interface ProactiveJobResult {
  tenantId: string;
  bizId: string;
  insightsGenerated: number;
  insightsSuppressed: number;
  insightsUpdated: number;
  errors: string[];
}

export interface ProactiveJobSummary {
  jobId: string;
  startedAt: string;
  completedAt: string;
  tenantsScanned: number;
  totalInsightsGenerated: number;
  totalInsightsSuppressed: number;
  totalErrors: number;
}

// ── Phase 2: Prioritization ─────────────────────────────────────────────────

export interface InsightScore {
  insightId: string;
  type: ProactiveInsightType;
  severity: InsightSeverity;
  confidence: number;
  recurrenceCount: number;
  impactScore: number;           // severityWeight * confidence * recurrenceWeight * bizValueWeight
}

// ── Phase 2: Daily Digest ────────────────────────────────────────────────────

export interface DailyDigest {
  tenantId: string;
  bizId: string;
  date: string;                  // ISO date
  topInsights: InsightScore[];   // max 3, sorted by impactScore desc
  totalDetected: number;
  totalSuppressed: number;
  generatedAt: string;           // ISO timestamp
}

// ── Phase 2: Weekly Summary ──────────────────────────────────────────────────

export interface WeeklySummary {
  tenantId: string;
  bizId: string;
  weekStr: string;               // e.g. "2026-W13"
  periodStart: string;           // ISO date
  periodEnd: string;             // ISO date
  highlights: InsightScore[];    // max 5, sorted by impactScore desc
  chronicPatterns: ChronicPattern[];
  totalInsightsGenerated: number;
  totalInsightsSuppressed: number;
  generatedAt: string;
}

export interface ChronicPattern {
  type: ProactiveInsightType;
  metric: string;
  occurrenceCount: number;
  firstSeen: string;             // ISO timestamp
  lastSeen: string;              // ISO timestamp
  avgDeviationPct: number;
}

// ── Phase 2: Enhanced Memory ─────────────────────────────────────────────────

export interface InsightMemoryEntry {
  fingerprint: string;
  type: ProactiveInsightType;
  metric: string;
  recurrenceCount: number;
  isChronic: boolean;            // flagged at recurrenceCount >= 7
  cooldownUntil: string | null;  // ISO timestamp — don't resurface before this
  firstDetectedAt: string;
  lastDetectedAt: string;
  lastConfidence: number;
  avgDeviationPct: number;
}
