import type { AgentContext, AgentResponse } from "../types/agent.js";
import { runAgent } from "./runAgent.js";
import { classifyIntent, requiresAI } from "../classifier/classifyIntent.js";
import { logger } from "../../utils/logging.js";

/**
 * Top-level question router.
 *
 * ARCHITECTURE PRINCIPLE:
 * The deterministic brain (runAgent) handles EVERYTHING.
 * LLM is OPTIONAL — only used for rephrasing the ALREADY-COMPUTED answer.
 * If no LLM is available, the system works fully without it.
 * The LLM NEVER computes, decides, or invents — it only rephrases.
 */
export async function routeQuestion(context: AgentContext): Promise<AgentResponse> {
  // 1. Run the deterministic brain — this is the REAL answer
  const agentResponse = await runAgent(context);

  // 2. Optionally enrich with LLM (rephrasing only, never decision-making)
  //    Only attempt if:
  //    - Intent is strategic/recommendation (benefits from natural phrasing)
  //    - Confidence is HIGH (we trust the data)
  //    - LLM is available (ANTHROPIC_API_KEY set)
  const intent = classifyIntent(context.userQuestion, context);
  const llmAvailable = !!process.env.ANTHROPIC_API_KEY;

  if (llmAvailable && requiresAI(intent) && agentResponse.confidence.level === "high") {
    try {
      const enrichedText = await enrichWithLLM(context.userQuestion, agentResponse.text);
      if (enrichedText) {
        return { ...agentResponse, text: enrichedText };
      }
    } catch (err) {
      logger.warn("LLM enrichment failed, using deterministic response:", err);
      // Fall through — deterministic answer is always valid
    }
  }

  return agentResponse;
}

/**
 * LLM rephrasing layer — OPTIONAL.
 * Takes a verified structured answer and rephrases it naturally.
 * NEVER adds data. NEVER invents. Only rephrases.
 */
async function enrichWithLLM(question: string, structuredAnswer: string): Promise<string | null> {
  try {
    // Dynamic import — LLM service is not loaded unless needed
    const { callLLM } = await import("../../services/llmService.js");

    const prompt = `השאלה מהמשתמש: "${question}"

התשובה המובנית מהמערכת (מבוססת על נתונים מאומתים בלבד):
${structuredAnswer}

נסח מחדש את התשובה בסגנון טבעי ואנושי של מנהל תפעול בכיר.
חוקים מוחלטים:
- אל תוסיף מידע שלא קיים בתשובה המובנית
- אל תמציא נתונים
- אל תנחש סיבות
- אל תמציא המלצות
- רק נסח מחדש את מה שכבר קיים`;

    const response = await callLLM({
      userMessage: prompt,
      maxTokens: 512,
    });

    return response.text || null;
  } catch {
    return null;
  }
}
