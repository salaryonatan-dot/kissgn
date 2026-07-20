// Part 7 — parseLlmResponse: typed, deterministic parsing of an untrusted payload.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseLlmResponse as parse } from "../../lib/llmResponse.js";

test("valid response", () => {
  assert.deepEqual(
    parse({ content: [{ type: "text", text: "hello" }], usage: { input_tokens: 12, output_tokens: 34 } }),
    { text: "hello", inputTokens: 12, outputTokens: 34 }
  );
});
test("missing usage -> zero tokens, text preserved", () => {
  assert.deepEqual(parse({ content: [{ text: "hi" }] }), { text: "hi", inputTokens: 0, outputTokens: 0 });
});
test("missing content -> empty text", () => {
  assert.deepEqual(parse({ usage: { input_tokens: 5, output_tokens: 6 } }), { text: "", inputTokens: 5, outputTokens: 6 });
});
test("malformed content (not array / no text) -> empty text", () => {
  assert.equal(parse({ content: "nope" }).text, "");
  assert.equal(parse({ content: [] }).text, "");
  assert.equal(parse({ content: [{ type: "image" }] }).text, "");
  assert.equal(parse({ content: [42] }).text, "");
});
test("wrong token types -> zero", () => {
  const r = parse({ content: [{ text: "x" }], usage: { input_tokens: "12", output_tokens: null } });
  assert.equal(r.inputTokens, 0);
  assert.equal(r.outputTokens, 0);
});
test("non-finite / negative tokens -> zero", () => {
  const r = parse({ usage: { input_tokens: Infinity, output_tokens: -5 } });
  assert.equal(r.inputTokens, 0);
  assert.equal(r.outputTokens, 0);
});
test("arbitrary object -> defaults", () => {
  assert.deepEqual(parse({ foo: "bar" }), { text: "", inputTokens: 0, outputTokens: 0 });
});
test("null -> defaults", () => {
  assert.deepEqual(parse(null), { text: "", inputTokens: 0, outputTokens: 0 });
});
test("array -> defaults", () => {
  assert.deepEqual(parse([1, 2, 3]), { text: "", inputTokens: 0, outputTokens: 0 });
});
test("primitive -> defaults", () => {
  assert.deepEqual(parse("string"), { text: "", inputTokens: 0, outputTokens: 0 });
  assert.deepEqual(parse(undefined), { text: "", inputTokens: 0, outputTokens: 0 });
});
