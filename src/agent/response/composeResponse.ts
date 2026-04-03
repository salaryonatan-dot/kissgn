import type { AgentIntent, AnalysisResult, ConfidenceResult, AgentContext, AgentResponse } from "../types/agent.js";

interface ComposeInput {
  intent: AgentIntent;
  analysis: AnalysisResult;
  confidence: ConfidenceResult;
  context: AgentContext;
}

export function composeResponse(input: ComposeInput): AgentResponse {
  const { intent, analysis, confidence, context } = input;
  const parts: string[] = [];

  // Direct answer
  if (analysis.answer) {
    parts.push(analysis.answer);
  }

  // Supporting facts — natural phrasing
  // At "low" confidence: limit to at most 2 facts to keep response short
  if (analysis.supportingFacts.length > 0) {
    const nonMemoryFacts = analysis.supportingFacts.filter((f) => !f.startsWith("[זיכרון"));
    const factsToShow = confidence.level === "low"
      ? nonMemoryFacts.slice(0, 2)
      : nonMemoryFacts;
    if (factsToShow.length > 0) {
      parts.push(`מהנתונים רואים ש${factsToShow.join(", ")}.`);
    }
  }

  // Business meaning — suppress at "low" confidence
  if (analysis.meaning && confidence.level !== "low") {
    parts.push(analysis.meaning);
  }

  // Recommendations — only at high confidence
  if (analysis.recommendations?.length && confidence.level === "high") {
    parts.push(`אם הייתי צריך לפעול עכשיו, הייתי ${analysis.recommendations[0]}.`);
  }

  // Confidence hedges
  if (confidence.level === "low") {
    parts.push("(⚠️ הנתונים מוגבלים — יש להתייחס לתשובה בזהירות רבה)");
  } else if (confidence.level === "medium") {
    parts.push("(הנתונים חלקיים — ההערכה לא מלאה)");
  }

  const text = parts.join(" ").trim();

  // Determine memory update
  const shouldUpdateMemory =
    confidence.level === "high" &&
    ((analysis.patterns?.length ?? 0) > 0 || (analysis.anomalies?.length ?? 0) > 0);

  return {
    text,
    confidence,
    intent,
    usedSources: analysis.usedSources,
    shouldUpdateMemory,
  };
}
