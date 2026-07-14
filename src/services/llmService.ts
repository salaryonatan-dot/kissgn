import { parseLlmResponse } from "../../lib/llmResponse.js";
import { SYSTEM_PROMPT } from "../agent/prompts/systemPrompt.js";
import { logger } from "../utils/logging.js";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-sonnet-4-20250514";

interface LLMRequest {
  userMessage: string;
  systemOverride?: string;
  maxTokens?: number;
}

interface LLMResponse {
  text: string;
  inputTokens: number;
  outputTokens: number;
}

export async function callLLM(req: LLMRequest): Promise<LLMResponse> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY not set");
  }

  const body = {
    model: MODEL,
    max_tokens: req.maxTokens ?? 1024,
    system: req.systemOverride ?? SYSTEM_PROMPT,
    messages: [
      { role: "user", content: req.userMessage },
    ],
  };

  const startMs = Date.now();
  const resp = await fetch(ANTHROPIC_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const errorText = await resp.text();
    logger.error("LLM API error:", resp.status, errorText);
    throw new Error(`LLM API error: ${resp.status}`);
  }

  const data: unknown = await resp.json();
  const latency = Date.now() - startMs;
  const parsed = parseLlmResponse(data);
  logger.info(`LLM call: ${latency}ms, in=${parsed.inputTokens}, out=${parsed.outputTokens}`);

  return {
    text: parsed.text,
    inputTokens: parsed.inputTokens,
    outputTokens: parsed.outputTokens,
  };
}
