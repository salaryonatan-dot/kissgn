// Business Memory types — accumulated intelligence, NOT chat history

export interface MemoryEntry {
  id: string;
  tenantId: string;
  branchId?: string;
  type: MemoryType;
  title: string;
  description: string;
  confidence: number;       // 0-1
  occurrenceCount: number;  // how many times this pattern was seen
  firstSeen: string;
  lastSeen: string;
  validUntil?: string;      // after this date, memory is stale
  evidenceRefs: string[];   // e.g. ["daily:2026-03-15", "anomaly:abc123"]
  tags: string[];
  metadata?: Record<string, unknown>;
}

export type MemoryType =
  | "repeated_weak_day"
  | "labor_inefficiency"
  | "recurring_anomaly"
  | "product_pattern"
  | "recommendation"
  | "recommendation_outcome"
  | "persistent_correlation"
  | "seasonal_pattern";

export interface RecommendationRecord {
  id: string;
  tenantId: string;
  branchId?: string;
  recommendation: string;
  context: string;
  createdAt: string;
  outcome?: "implemented" | "ignored" | "partially_implemented";
  outcomeNotes?: string;
  outcomeRecordedAt?: string;
  resultMetricBefore?: number;
  resultMetricAfter?: number;
}

export interface MemoryQuery {
  tenantId: string;
  branchId?: string;
  types?: MemoryType[];
  tags?: string[];
  minConfidence?: number;
  limit?: number;
}
