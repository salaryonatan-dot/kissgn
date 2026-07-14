// Part 3 — mapProactiveTypeToMemoryType: every proactive insight type maps to a
// valid MemoryInsightType, unknown falls back to "recurring_anomaly".
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mapProactiveTypeToMemoryType as mapFn } from "../../lib/memoryInsightType.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

// Canonical MemoryInsightType union, parsed from source so the test tracks the type.
function memoryInsightTypeSet() {
  const src = readFileSync(join(ROOT, "src/agent/types/agent.ts"), "utf8");
  const m = src.match(/export type MemoryInsightType =([\s\S]*?);/);
  assert.ok(m, "MemoryInsightType union found");
  return new Set([...m[1].matchAll(/"([a-z_]+)"/g)].map((x) => x[1]));
}

const ALLOWED = memoryInsightTypeSet();

const EXPECTED = {
  revenue_underperformance: "recurring_anomaly",
  labor_inefficiency: "labor_inefficiency",
  weak_day_pattern: "repeated_weak_day",
  weak_hour_pattern: "recurring_anomaly",
  purchases_without_revenue: "recurring_anomaly",
  forecast_risk: "recurring_anomaly",
};

for (const [input, expected] of Object.entries(EXPECTED)) {
  test(`maps ${input} -> ${expected} (a valid MemoryInsightType)`, () => {
    const out = mapFn(input);
    assert.equal(out, expected);
    assert.ok(ALLOWED.has(out), `${out} is a valid MemoryInsightType`);
  });
}

test("every mapped value is a valid MemoryInsightType", () => {
  for (const v of Object.values(EXPECTED)) assert.ok(ALLOWED.has(v));
});

test("unknown / empty / weird inputs fall back to recurring_anomaly", () => {
  for (const bad of ["totally_unknown", "", "constructor", "__proto__", "repeated_weak_hour", "purchase_anomaly", "forecast_risk"]) {
    const out = mapFn(bad);
    assert.equal(out, "recurring_anomaly");
    assert.ok(ALLOWED.has(out));
  }
});

test("runProactiveJob uses the mapper, not an inline invalid map", () => {
  const src = readFileSync(join(ROOT, "src/agent/proactive/runProactiveJob.ts"), "utf8");
  assert.match(src, /mapProactiveTypeToMemoryType\(insight\.type\)/);
  assert.doesNotMatch(src, /"repeated_weak_hour"|"purchase_anomaly"/);
});
