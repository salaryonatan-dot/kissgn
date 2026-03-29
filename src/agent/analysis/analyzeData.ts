// Central analysis router — dispatches to the correct analyzer based on intent

import type { AgentIntent, MetricsPlan, FetchedData, AnalysisResult, BaselineResult } from "../types/agent.js";
import type { AgentContext } from "../types/agent.js";
import type { MemoryInsight } from "../types/agent.js";
import { analyzeDirectMetric } from "./analyzeDirectMetric.js";
import { analyzeComparison } from "./analyzeComparison.js";
import { analyzeTrend } from "./analyzeTrend.js";
import { analyzeAnomaly } from "./analyzeAnomaly.js";
import { analyzeForecast } from "./analyzeForecast.js";

interface AnalyzeInput {
  intent: AgentIntent;
  plan: MetricsPlan;
  fetched: FetchedData;
  baseline: BaselineResult;
  memory: MemoryInsight[];
  context: AgentContext;
}

export async function analyzeData(input: AnalyzeInput): Promise<AnalysisResult> {
  const { intent, plan, fetched, baseline, memory, context } = input;

  let result: AnalysisResult;

  switch (intent) {
    case "direct_metric_query":
    case "direct_aggregation_query":
      result = analyzeDirectMetric(plan, fetched, baseline, context);
      break;
    case "comparison_query":
      result = analyzeComparison(plan, fetched, baseline, context);
      break;
    case "trend_analysis":
      result = analyzeTrend(plan, fetched, baseline, context);
      break;
    case "anomaly_detection":
      result = analyzeAnomaly(plan, fetched, baseline, context);
      break;
    case "forecast_request":
      result = analyzeForecast(plan, fetched, baseline, context);
      break;
    case "strategic_question":
    case "recommendation_request":
      // Strategic questions use anomaly + trend combined
      const anomalyResult = analyzeAnomaly(plan, fetched, baseline, context);
      const trendResult = analyzeTrend(plan, fetched, baseline, context);
      result = mergeStrategicAnalysis(anomalyResult, trendResult, memory);
      break;
    default:
      result = {
        answer: "",
        supportingFacts: [],
        usedSources: fetched.sources,
      };
  }

  // Enrich with memory if available
  if (memory.length > 0) {
    result = enrichWithMemory(result, memory);
  }

  return result;
}

function mergeStrategicAnalysis(
  anomaly: AnalysisResult,
  trend: AnalysisResult,
  memory: MemoryInsight[]
): AnalysisResult {
  const facts = [...(anomaly.supportingFacts || []), ...(trend.supportingFacts || [])];
  const patterns = [...(anomaly.patterns || []), ...(trend.patterns || [])];
  const recommendations = [...(anomaly.recommendations || []), ...(trend.recommendations || [])];

  let answer = "";
  if (anomaly.anomalies && anomaly.anomalies.length > 0) {
    answer += anomaly.answer + ". ";
  }
  answer += trend.answer;

  return {
    answer: answer.trim(),
    supportingFacts: facts,
    meaning: anomaly.meaning || trend.meaning,
    recommendations: recommendations.length > 0 ? recommendations : undefined,
    anomalies: anomaly.anomalies,
    patterns: patterns.length > 0 ? patterns : undefined,
    usedSources: [...new Set([...anomaly.usedSources, ...trend.usedSources])],
  };
}

function enrichWithMemory(result: AnalysisResult, memory: MemoryInsight[]): AnalysisResult {
  const relevantMemory = memory.filter((m) => m.confidence >= 0.7);
  if (relevantMemory.length === 0) return result;

  const memoryFacts = relevantMemory.map(
    (m) => `[זיכרון עסקי] ${m.title}: ${m.description}`
  );

  return {
    ...result,
    supportingFacts: [...result.supportingFacts, ...memoryFacts],
  };
}
