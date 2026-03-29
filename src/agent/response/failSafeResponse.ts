import type { AgentIntent, ValidationResult, AgentResponse } from "../types/agent.js";
import { SAFE_FAIL_RESPONSE_HE } from "../types/shared.js";

export function failSafeResponse(
  intent: AgentIntent,
  validation: ValidationResult,
  usedSources: string[]
): AgentResponse {
  // Build specific failure context if possible
  let text = SAFE_FAIL_RESPONSE_HE;

  const highIssues = validation.issues.filter((i) => i.severity === "high");
  if (highIssues.length === 1) {
    // Give a slightly more specific reason
    const issue = highIssues[0];
    if (issue.code === "stale_data") {
      text = "הנתונים לא עדכניים מספיק כדי לתת תשובה מדויקת";
    } else if (issue.code === "missing_data") {
      text = "חסרים נתונים מהותיים — לא ניתן לתת תשובה מדויקת כרגע";
    } else if (issue.code === "insufficient_sample") {
      text = "אין מספיק היסטוריה כדי לנתח את זה בצורה אמינה";
    } else if (issue.code === "missing_baseline") {
      text = "אין מספיק נתונים היסטוריים להשוואה — צריך עוד כמה שבועות של מידע";
    }
  }

  return {
    text,
    confidence: {
      score: 0,
      level: "low",
      shouldAnswer: false,
      shouldRefuse: true,
      reasons: ["safe_fail", ...validation.issues.map((i) => i.code)],
    },
    intent,
    usedSources,
    shouldUpdateMemory: false,
  };
}
