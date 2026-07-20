// Pure parser/validator for the Anthropic Messages API response. The parsed JSON
// is untrusted (`unknown`); we validate only the fields actually consumed and
// return deterministic defaults for missing/malformed payloads. No external calls,
// no throwing — preserves the caller's existing fail-safe behavior.
function isObject(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function firstText(content) {
  if (!Array.isArray(content) || content.length === 0) return "";
  const first = content[0];
  if (isObject(first) && typeof first.text === "string") return first.text;
  return "";
}

function nonNegInt(v) {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0;
}

export function parseLlmResponse(data) {
  if (!isObject(data)) return { text: "", inputTokens: 0, outputTokens: 0 };
  const usage = isObject(data.usage) ? data.usage : {};
  return {
    text: firstText(data.content),
    inputTokens: nonNegInt(usage.input_tokens),
    outputTokens: nonNegInt(usage.output_tokens),
  };
}
