// Commit 2 — "fix: retire unsupported hourly analytics workflow"
//
// Part 3/5: strict finite-metric validation for legacy-shaped daily analytics,
// plus static-source assertions that the hourly workflow is fully deactivated
// and no active code reaches the locked legacy analytics node.
//
// Run: node --test test/security/strict-daily-metrics.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseFiniteMetric, strictLegacyDailyMetric } from "../../lib/analytics/strictDailyMetrics.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");

// ─── parseFiniteMetric ───────────────────────────────────────────────────────
test("parseFiniteMetric: valid finite numbers pass through", () => {
  assert.equal(parseFiniteMetric(0), 0);
  assert.equal(parseFiniteMetric(1234.5), 1234.5);
  assert.equal(parseFiniteMetric(-50), -50);
});

test("parseFiniteMetric: valid numeric strings convert", () => {
  assert.equal(parseFiniteMetric("0"), 0);
  assert.equal(parseFiniteMetric("1234.5"), 1234.5);
  assert.equal(parseFiniteMetric("  42 "), 42); // surrounding whitespace trimmed
  assert.equal(parseFiniteMetric("-7"), -7);
});

test("parseFiniteMetric: explicit zero (number and string) is valid", () => {
  assert.equal(parseFiniteMetric(0), 0);
  assert.equal(parseFiniteMetric("0"), 0);
});

test("parseFiniteMetric: invalid values return undefined", () => {
  for (const bad of [undefined, null, "", "   ", "\t", NaN, Infinity, -Infinity,
                     "abc", "12abc", "1,234", true, false, {}, [], [1], () => 1]) {
    assert.equal(parseFiniteMetric(bad), undefined, `expected undefined for ${String(bad)}`);
  }
});

// ─── strictLegacyDailyMetric ─────────────────────────────────────────────────
const GOOD = { total: 1000, payroll: 300, food_cost: 200, extra: "ignored" };

test("strict: fully valid doc preserves exact mapping total→revenue/payroll→laborCost/food_cost→foodCost", () => {
  assert.deepEqual(strictLegacyDailyMetric(GOOD), { revenue: 1000, laborCost: 300, foodCost: 200 });
});

test("strict: valid numeric strings accepted and coerced", () => {
  assert.deepEqual(strictLegacyDailyMetric({ total: "1000", payroll: "0", food_cost: "200.5" }),
    { revenue: 1000, laborCost: 0, foodCost: 200.5 });
});

test("strict: explicit zeros are valid", () => {
  assert.deepEqual(strictLegacyDailyMetric({ total: 0, payroll: 0, food_cost: 0 }),
    { revenue: 0, laborCost: 0, foodCost: 0 });
});

test("strict: missing total → whole doc skipped (null)", () => {
  assert.equal(strictLegacyDailyMetric({ payroll: 300, food_cost: 200 }), null);
});
test("strict: missing payroll → skipped", () => {
  assert.equal(strictLegacyDailyMetric({ total: 1000, food_cost: 200 }), null);
});
test("strict: missing food_cost → skipped", () => {
  assert.equal(strictLegacyDailyMetric({ total: 1000, payroll: 300 }), null);
});

test("strict: null / empty / whitespace / non-finite / wrong-type field → skipped", () => {
  for (const bad of [null, undefined, "", "  ", NaN, Infinity, -Infinity, "text", true, {}, []]) {
    assert.equal(strictLegacyDailyMetric({ total: bad, payroll: 300, food_cost: 200 }), null,
      `total=${String(bad)} must skip`);
    assert.equal(strictLegacyDailyMetric({ total: 1000, payroll: bad, food_cost: 200 }), null,
      `payroll=${String(bad)} must skip`);
    assert.equal(strictLegacyDailyMetric({ total: 1000, payroll: 300, food_cost: bad }), null,
      `food_cost=${String(bad)} must skip`);
  }
});

test("strict: one invalid field skips the COMPLETE date (no partial/zero record)", () => {
  const r = strictLegacyDailyMetric({ total: 1000, payroll: "not-a-number", food_cost: 200 });
  assert.equal(r, null);
});

test("strict: non-object revenue (null/array/primitive) → skipped", () => {
  assert.equal(strictLegacyDailyMetric(null), null);
  assert.equal(strictLegacyDailyMetric([1, 2, 3]), null);
  assert.equal(strictLegacyDailyMetric("x"), null);
  assert.equal(strictLegacyDailyMetric(5), null);
});

// ─── mapping fidelity to the checkers loop (absence, not zero) ────────────────
// Mirror the checkers.ts readLegacyShapedDaily inclusion rule.
function shape(docsByDate, bizId) {
  const out = {};
  for (const [date, doc] of Object.entries(docsByDate)) {
    const rev = doc && doc.revenue ? doc.revenue : null;
    const strict = strictLegacyDailyMetric(rev);
    if (strict) out[date] = { [bizId]: strict };
  }
  return out;
}

test("invalid doc produces NO row for that date (absence, never a zero row)", () => {
  const shaped = shape({
    "2026-07-01": { revenue: { total: 1000, payroll: 300, food_cost: 200 } },
    "2026-07-02": { revenue: { total: "", payroll: 300, food_cost: 200 } }, // invalid → absent
    "2026-07-03": { revenue: { total: 500, payroll: null, food_cost: 100 } }, // invalid → absent
  }, "bizA");
  assert.deepEqual(Object.keys(shaped), ["2026-07-01"], "only the valid date is present");
  assert.equal(shaped["2026-07-02"], undefined, "invalid date is absent, not zero");
  assert.equal(shaped["2026-07-03"], undefined);
});

test("invalid doc cannot become a purchase-trend input row", () => {
  // purchase-trend style consumer iterates Object.values(dayMap) and reads .revenue
  const shaped = shape({ "2026-07-02": { revenue: { total: "NaNish", payroll: 1, food_cost: 1 } } }, "bizA");
  const rows = Object.values(shaped).flatMap((d) => Object.values(d));
  assert.equal(rows.length, 0, "no input row from an invalid analytics doc");
});

test("downstream absence does not become zero: averaging over present rows only", () => {
  const shaped = shape({
    "d1": { revenue: { total: 900, payroll: 300, food_cost: 100 } },
    "d2": { revenue: { total: "bad", payroll: 300, food_cost: 100 } }, // skipped
  }, "b");
  const rows = Object.values(shaped).flatMap((d) => Object.values(d));
  const avgRevenue = rows.reduce((a, r) => a + r.revenue, 0) / rows.length;
  assert.equal(avgRevenue, 900, "skipped date is not averaged in as a zero");
});

// ─── static-source: hourly workflow retired + strict validation wired ────────
test("checkers.ts uses strict validation and no longer zero-coerces revenue fields", () => {
  const c = read("src/alerts/checkers.ts");
  assert.match(c, /strictLegacyDailyMetric\(rev\)/);
  assert.doesNotMatch(c, /Number\(rev\.total\) \|\| 0/, "old zero-coercion removed");
  assert.doesNotMatch(c, /db\.ref\(`tenants\/\$\{tenantId\}\/analytics\/daily`\)/, "no legacy tenant-wide read");
});

test("analyticsService no longer imports or calls getHourlyMetrics", () => {
  const a = read("src/services/analyticsService.ts");
  assert.doesNotMatch(a, /getHourlyMetrics/);
  assert.doesNotMatch(a, /hourlyMetricsRepo/);
  assert.match(a, /fetchStatus\["hourly"\] = "skipped"/);
});

test("runProactiveJob has no active weak_hour_pattern detector and no hourly plan metric", () => {
  const r = read("src/agent/proactive/runProactiveJob.ts");
  assert.doesNotMatch(r, /\{ name: "weak_hour_pattern", fn:/);
  assert.doesNotMatch(r, /detectWeakHourPattern/);
  assert.doesNotMatch(r, /"hourly_revenue"/, "proactive plan drops hourly_revenue");
});

test("buildMetricsPlan emits no hourly_revenue in any active planner", () => {
  const b = read("src/agent/planner/buildMetricsPlan.ts");
  assert.doesNotMatch(b, /push\("hourly_revenue"\)/);
  assert.doesNotMatch(b, /"hourly_revenue"/, "no plan array includes hourly_revenue");
});

test("refs.ts no longer exports dailyMetricsRef", () => {
  assert.doesNotMatch(read("src/firebase/refs.ts"), /dailyMetricsRef/);
});

test("runAgent returns deterministic unsupported response for hourly-SALES questions (no fabrication/LLM/daily fallback)", () => {
  const r = read("src/agent/orchestrator/runAgent.ts");
  // Matcher was narrowed to hourly-sales intersection (P3 Finding 3) and moved
  // to the pure module lib/analytics/hourlySalesQuestion.js.
  assert.match(r, /isUnsupportedHourlySalesQuestion\(context\.userQuestion\)/);
  assert.match(r, /unsupported_hourly/);
});

test("retired modules are inert (no legacy reachability, no active code)", () => {
  const repo = read("src/repositories/analytics/hourlyMetricsRepo.ts");
  assert.doesNotMatch(repo, /dailyMetricsRef|\.ref\(|^import /m, "no legacy ref / import in retired repo");
  assert.match(repo, /export \{\};/, "repo reduced to an inert module");
  const det = read("src/agent/proactive/detectors/detectWeakHourPattern.ts");
  assert.doesNotMatch(det, /^import |export function |\.ref\(/m, "no imports or detector fn in retired detector");
  assert.match(det, /export \{\};/, "detector reduced to an inert module");
});

test("legacy analytics node remains locked in Rules (unchanged)", () => {
  const rules = JSON.parse(read("database.rules.json"));
  const a = rules.rules.tenants.$tenantId.analytics;
  assert.equal(a[".read"], false);
  assert.equal(a[".write"], false);
});
