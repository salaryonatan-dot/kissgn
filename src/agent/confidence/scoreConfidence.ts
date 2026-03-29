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
// Below MEDIUM_CONFIDENCE = refuse

export function scoreConfidence(input: ConfidenceInput): ConfidenceResult {
  const { validation, baseline, analysis, fetched, plan } = input;
  let score = 1.0;
  const reasons: string[] = [];

  // For direct queries, don't let validation sub-scores crush confidence
  // when data exists — only freshness matters
  const isDirectQuery = plan && (
    plan.intent === "direct_metric_query" || plan.intent === "direct_aggregation_query"
  );

  // Validation scores multiply into confidence
  score *= validation.completenessScore;
  score *= validation.freshnessScore;
  score *= validation.consistencyScore;

  // Sample adequacy — skip penalty for direct queries (they don't need large samples)
  if (!isDirectQuery && validation.sampleAdequacyScore < 0.7) {
    score *= 0.8;
    reasons.push("sample_size_low");
  }

  // Baseline validity — only penalize when baseline is actually required
  const needsBaseline = plan ? plan.requiresBaseline : true;
  if (needsBaseline && baseline && !baseline.valid) {
    score *= 0.4;
    reasons.push("invalid_baseline");
  } else if (needsBaseline && baseline && baseline.sampleSize < 7) {
    score *= 0.7;
    reasons.push("small_baseline_sample");
  }

  // Supporting facts
  const factCount = analysis.supportingFacts?.length ?? 0;
  if (factCount === 0) {
    score *= 0.5;
    reasons.push("no_supporting_facts");
  } else if (factCount < 2) {
    score *= 0.75;
    reasons.push("limited_supporting_facts");
  }

  // Raw record count — skip for direct queries (single-day queries legitimately have 1 record)
  if (!isDirectQuery && fetched.rawRecordCount < 3) {
    score *= 0.5;
    reasons.push("very_few_records");
  }

  // High severity validation issues
  const highIssues = validation.issues.filter((i) => i.severity === "high").length;
  if (highIssues > 0) {
    score *= Math.max(0.3, 1 - highIssues * 0.2);
    reasons.push(`high_severity_issues:${highIssues}`);
  }

  // Clamp
  score = Math.max(0, Math.min(1, score));

  const level = score >= HIGH_CONFIDENCE ? "high" : score >= MEDIUM_CONFIDENCE ? "medium" : "low";

  return {
    score,
    level,
    shouldAnswer: score >= MEDIUM_CONFIDENCE,
    shouldRefuse: score < MEDIUM_CONFIDENCE,
    reasons,
  };
}
