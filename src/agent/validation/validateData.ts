import type { MetricsPlan, ValidationResult, ValidationIssue, FetchedData } from "../types/agent.js";
import type { AgentContext } from "../types/agent.js";

interface ValidateInput {
  fetched: FetchedData;
  plan: MetricsPlan;
  context: AgentContext;
}

// Thresholds — match spec exactly
const COMPLETENESS_THRESHOLD = 0.85;
const FRESHNESS_THRESHOLD = 0.80;
const CONSISTENCY_THRESHOLD = 0.90;
const SAMPLE_THRESHOLD_BASELINE = 0.70;
const SAMPLE_THRESHOLD_BASIC = 0.50;

export function validateData({ fetched, plan, context }: ValidateInput): ValidationResult {
  const issues: ValidationIssue[] = [];

  const completeness = fetched.completenessScore;
  const freshness = fetched.freshnessScore;
  const consistency = fetched.consistencyScore;
  const sampleAdequacy = fetched.sampleAdequacyScore;

  // Completeness check
  if (completeness < COMPLETENESS_THRESHOLD) {
    issues.push({
      code: "missing_data",
      severity: completeness < 0.5 ? "high" : "medium",
      message: `נתונים חסרים: ${Math.round(completeness * 100)}% שלמות`,
    });
  }

  // Freshness check
  if (freshness < FRESHNESS_THRESHOLD) {
    issues.push({
      code: "stale_data",
      severity: freshness < 0.4 ? "high" : "medium",
      message: `הנתונים לא עדכניים מספיק`,
    });
  }

  // Consistency check
  if (consistency < CONSISTENCY_THRESHOLD) {
    issues.push({
      code: "inconsistent_data",
      severity: consistency < 0.6 ? "high" : "medium",
      message: `חוסר עקביות בין מקורות נתונים`,
    });
  }

  // Sample size for baseline/anomaly
  // Direct queries (metric/aggregation) only need data existence — never block on sample size
  const isDirectQuery = plan.intent === "direct_metric_query" || plan.intent === "direct_aggregation_query";
  if (!isDirectQuery) {
    const sampleThreshold = plan.requiresBaseline ? SAMPLE_THRESHOLD_BASELINE : SAMPLE_THRESHOLD_BASIC;
    if (sampleAdequacy < sampleThreshold) {
      issues.push({
        code: "insufficient_sample",
        severity: sampleAdequacy < 0.3 ? "high" : "medium",
        message: `גודל מדגם לא מספיק לניתוח אמין`,
      });
    }
  }

  // Check if baseline is needed but might be missing
  if (plan.requiresBaseline && fetched.rawRecordCount < 7) {
    issues.push({
      code: "missing_baseline",
      severity: "high",
      message: `אין מספיק נתונים היסטוריים לחישוב baseline`,
    });
  }

  // Partial fetch check — flag failed data sources
  if (fetched.fetchStatus) {
    const failedSources = Object.entries(fetched.fetchStatus)
      .filter(([_, status]) => status === "failed")
      .map(([source]) => source);

    if (failedSources.length > 0) {
      issues.push({
        code: "missing_data",
        severity: failedSources.includes("daily") ? "high" : "medium",
        message: `מקורות נתונים שלא נטענו: ${failedSources.join(", ")}`,
      });
    }
  }

  // Determine overall ok: high-severity issues block answer
  const hasHighSeverity = issues.some((i) => i.severity === "high");
  const ok = !hasHighSeverity;

  return {
    ok,
    completenessScore: completeness,
    freshnessScore: freshness,
    consistencyScore: consistency,
    sampleAdequacyScore: sampleAdequacy,
    issues,
  };
}
