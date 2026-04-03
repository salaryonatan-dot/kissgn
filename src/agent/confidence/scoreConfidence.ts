import type { ValidationResult, BaselineResult, AnalysisResult, FetchedData, ConfidenceResult, MetricsPlan } from "../types/agent.js";

interface ConfidenceInput {
  validation: ValidationResult;
  baseline: BaselineResult;
  analysis: AnalysisResult;
  fetched: FetchedData;
  plan?: MetricsPlan;
}

// Thresholds
const HIGH_CONFIDENCE = 0.85;
const MEDIUM_CONFIDENCE = 0.65;
const CAUTIOUS_CONFIDENCE = 0.45;
// Below CAUTIOUS_CONFIDENCE = refuse (very_low)

// Quality dimension weights (must sum to 1.0)
const W_COMPLETENESS = 0.30;
const W_FRESHNESS = 0.25;
const W_CONSISTENCY = 0.25;
const W_SAMPLE = 0.20;

// Fixed penalty amounts
const PENALTY_INVALID_BASELINE = 0.25;
const PENALTY_SMALL_BASELINE = 0.10;
const PENALTY_NO_FACTS = 0.20;
const PENALTY_LIMITED_FACTS = 0.08;
const PENALTY_FEW_RECORDS = 0.15;
const PENALTY_HIGH_ISSUE = 0.10;
const PENALTY_SAMPLE_LOW = 0.08;
const MAX_TOTAL_PENALTY = 0.55;

export function scoreConfidence(input: ConfidenceInput): ConfidenceResult {
  const { validation, baseline, analysis, fetched, plan } = input;
  const reasons: string[] = [];

  // For direct queries, don't let validation sub-scores crush confidence
  // when data exists — only freshness matters
  const isDirectQuery = plan && (
    plan.intent === "direct_metric_query" || plan.intent === "direct_aggregation_query"
  );

  // --- Weighted additive base score ---
  const sampleScore = isDirectQuery
    ? Math.max(validation.sampleAdequacyScore, 0.8) // direct queries get generous sample score
    : validation.sampleAdequacyScore;

  const qualityBase =
    validation.completenessScore * W_COMPLETENESS +
    validation.freshnessScore * W_FRESHNESS +
    validation.consistencyScore * W_CONSISTENCY +
    sampleScore * W_SAMPLE;

  // --- Fixed penalty deductions ---
  let totalPenalty = 0;

  // Sample adequacy — skip penalty for direct queries
  if (!isDirectQuery && validation.sampleAdequacyScore < 0.7) {
    totalPenalty += PENALTY_SAMPLE_LOW;
    reasons.push("sample_size_low");
  }

  // Baseline validity — only penalize when baseline is actually required
  const needsBaseline = plan ? plan.requiresBaseline : true;
  if (needsBaseline && baseline && !baseline.valid) {
    totalPenalty += PENALTY_INVALID_BASELINE;
    reasons.push("invalid_baseline");
  } else if (needsBaseline && baseline && baseline.sampleSize < 7) {
    totalPenalty += PENALTY_SMALL_BASELINE;
    reasons.push("small_baseline_sample");
  }

  // Supporting facts
  const factCount = analysis.supportingFacts?.length ?? 0;
  if (factCount === 0) {
    totalPenalty += PENALTY_NO_FACTS;
    reasons.push("no_supporting_facts");
  } else if (factCount < 2) {
    totalPenalty += PENALTY_LIMITED_FACTS;
    reasons.push("limited_supporting_facts");
  }

  // Raw record count — skip for direct queries
  if (!isDirectQuery && fetched.rawRecordCount < 3) {
    totalPenalty += PENALTY_FEW_RECORDS;
    reasons.push("very_few_records");
  }

  // High severity validation issues
  const highIssues = validation.issues.filter((i) => i.severity === "high").length;
  if (highIssues > 0) {
    totalPenalty += Math.min(highIssues * PENALTY_HIGH_ISSUE, 0.30);
    reasons.push(`high_severity_issues:${highIssues}`);
  }

  // Cap total penalties
  totalPenalty = Math.min(totalPenalty, MAX_TOTAL_PENALTY);

  // Final score
  let score = qualityBase - totalPenalty;
  score = Math.max(0, Math.min(1, score));

  // Level mapping with cautious tier
  const level: ConfidenceResult["level"] =
    score >= HIGH_CONFIDENCE ? "high"
    : score >= MEDIUM_CONFIDENCE ? "medium"
    : score >= CAUTIOUS_CONFIDENCE ? "low"
    : "very_low";

  return {
    score,
    level,
    shouldAnswer: score >= CAUTIOUS_CONFIDENCE,
    shouldRefuse: score < CAUTIOUS_CONFIDENCE,
    reasons,
  };
}
