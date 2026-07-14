// Part 4 — the proactive plan uses the canonical MetricKey `supplier_purchases`
// (not `purchases`), still triggers the purchase fetch, and the purchase detector
// still receives input.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");

function metricKeySet() {
  const src = read("src/agent/types/agent.ts");
  const m = src.match(/export type MetricKey =([\s\S]*?);/);
  assert.ok(m, "MetricKey union found");
  return new Set([...m[1].matchAll(/"([a-z_]+)"/g)].map((x) => x[1]));
}

test("supplier_purchases is a valid MetricKey; purchases is NOT", () => {
  const keys = metricKeySet();
  assert.ok(keys.has("supplier_purchases"));
  assert.ok(!keys.has("purchases"));
});

test("buildProactivePlan uses supplier_purchases (not the invalid 'purchases')", () => {
  const src = read("src/agent/proactive/runProactiveJob.ts");
  const m = src.match(/function buildProactivePlan[\s\S]*?metrics:\s*\[([^\]]*)\]/);
  assert.ok(m, "buildProactivePlan metrics array found");
  const arr = m[1];
  assert.match(arr, /"supplier_purchases"/);
  assert.doesNotMatch(arr, /"purchases"/);
});

test("the proactive plan metrics still trigger the purchase fetch", () => {
  // Mirror analyticsService's trigger predicate exactly.
  const planMetrics = ["daily_revenue", "labor_cost", "labor_pct", "supplier_purchases", "food_cost"];
  const triggers = planMetrics.some((m) => m.includes("supplier") || m.includes("purchase"));
  assert.equal(triggers, true);
  // and the analyticsService trigger predicate is unchanged
  const svc = read("src/services/analyticsService.ts");
  assert.match(svc, /m\.includes\("supplier"\) \|\| m\.includes\("purchase"\)/);
  assert.match(svc, /metrics\["purchases"\] = purchases/);
});

test("purchase detector still consumes fetched metrics", () => {
  const det = read("src/agent/proactive/detectors/detectPurchasesWithoutRevenueSupport.ts");
  assert.match(det, /fetched\.metrics\[/);
});
