// Declarations for lib/llmResponse.js. Input is untrusted `unknown`; output is a
// fully-typed, always-present shape with deterministic defaults.
export interface LlmParsedResponse {
  text: string;
  inputTokens: number;
  outputTokens: number;
}

export function parseLlmResponse(data: unknown): LlmParsedResponse;
