// P3 Finding 3/4 — narrow hourly-SALES classification + TypeScript declaration
// structural checks. Self-contained (no TypeScript toolchain invoked).
//
// Run: node --test test/security/hourly-sales-question.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { isUnsupportedHourlySalesQuestion as f } from "../../lib/analytics/hourlySalesQuestion.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");

// ─── Positives: hourly + sales intent ⇒ unsupported ──────────────────────────
const POSITIVE = [
  "hourly revenue yesterday",
  "revenue by hour",
  "sales per hour",
  "which hours have the weakest sales",
  "transactions by hour",
  "מה הפדיון לפי שעה",
  "מהן השעות החלשות במכירות",
  "באיזו שעה יש הכי מעט עסקאות",
];
for (const q of POSITIVE) {
  test(`positive: "${q}" ⇒ unsupported hourly-sales`, () => {
    assert.equal(f(q), true);
  });
}

// ─── Negatives: labor / payroll / opening hours ⇒ NOT unsupported ────────────
const NEGATIVE = [
  "what was hourly labor cost yesterday",
  "show hourly employee cost",
  "hourly payroll",
  "employee hours yesterday",
  "opening hours",
  "hourly wage",
  "salary per hour",
  "staff hours",
  "worked hours",
  "shift hours",
  "business hours",
  "שעות עובדים",
  "עלות שכר לשעה",
  "שכר שעתי",
  "שעות פתיחה",
  "שעות עבודה",
  "שעות משמרת",
];
for (const q of NEGATIVE) {
  test(`negative: "${q}" ⇒ NOT matched`, () => {
    assert.equal(f(q), false);
  });
}

// ─── Mixed: hourly sales + labor ⇒ still unsupported (sales part unavailable) ─
test('mixed: "compare hourly sales with labor cost" ⇒ true', () => {
  assert.equal(f("compare hourly sales with labor cost"), true);
});

test("guards: empty / non-string inputs are safe (false)", () => {
  assert.equal(f(""), false);
  assert.equal(f("   "), false);
  assert.equal(f(undefined), false);
  assert.equal(f(null), false);
  assert.equal(f(42), false);
});

// ─── runAgent integration: deterministic, before data fetch, no LLM ──────────
test("runAgent uses the narrow matcher before any data fetch (source)", () => {
  const r = read("src/agent/orchestrator/runAgent.ts");
  assert.match(r, /import \{ isUnsupportedHourlySalesQuestion \} from "\.\.\/\.\.\/\.\.\/lib\/analytics\/hourlySalesQuestion\.js"/);
  assert.match(r, /if \(isUnsupportedHourlySalesQuestion\(context\.userQuestion\)\)/);
  // The short-circuit must precede fetchPlannedData in the function body.
  const guardIdx = r.indexOf("isUnsupportedHourlySalesQuestion(context.userQuestion)");
  const fetchIdx = r.indexOf("fetchPlannedData(plan, context)");
  assert.ok(guardIdx > -1 && fetchIdx > -1 && guardIdx < fetchIdx, "matcher runs before data fetch");
  // Old broad matcher removed.
  assert.doesNotMatch(r, /HOURLY_QUESTION_RE|function isHourlyQuestion/, "broad matcher removed");
});

// ─── TypeScript declaration structural checks (no compilation) ───────────────
test("strictDailyMetrics.d.ts exists next to the .js and matches exports", () => {
  const dts = "lib/analytics/strictDailyMetrics.d.ts";
  assert.ok(existsSync(join(ROOT, dts)), "declaration file exists");
  const d = read(dts);
  const js = read("lib/analytics/strictDailyMetrics.js");
  // Every JS named export is declared.
  for (const name of ["parseFiniteMetric", "strictLegacyDailyMetric"]) {
    assert.match(js, new RegExp(`export function ${name}\\b`), `js exports ${name}`);
    assert.match(d, new RegExp(`export function ${name}\\b`), `d.ts declares ${name}`);
  }
  // Declared return shape contains the three legacy fields.
  assert.match(d, /revenue: number/);
  assert.match(d, /laborCost: number/);
  assert.match(d, /foodCost: number/);
  // Matches the real return types (undefined for parse; null for the mapper).
  assert.match(d, /parseFiniteMetric\(value: unknown\): number \| undefined/);
  assert.match(d, /strictLegacyDailyMetric\(revenue: unknown\): LegacyDailyMetric \| null/);
});

test("hourlySalesQuestion.d.ts exists and declares the exported matcher", () => {
  const dts = "lib/analytics/hourlySalesQuestion.d.ts";
  assert.ok(existsSync(join(ROOT, dts)), "declaration file exists");
  assert.match(read(dts), /export function isUnsupportedHourlySalesQuestion\(question: string\): boolean/);
});

test("checkers.ts imports the matching named export from the declared module", () => {
  const c = read("src/alerts/checkers.ts");
  assert.match(c, /import \{ strictLegacyDailyMetric \} from "\.\.\/\.\.\/lib\/analytics\/strictDailyMetrics\.js"/);
  assert.match(c, /strictLegacyDailyMetric\(rev\)/);
  // Null handling: `if (strict)` narrows the LegacyDailyMetric | null return.
  assert.match(c, /const strict = strictLegacyDailyMetric\(rev\);\s*\n\s*if \(strict\)/);
});

test("no allowJs / unrelated tsconfig relaxation was added", () => {
  const ts = read("tsconfig.json");
  assert.doesNotMatch(ts, /allowJs/);
  assert.doesNotMatch(ts, /checkJs/);
  // include not broadened to lib/**
  assert.doesNotMatch(ts, /"lib\/\*\*/);
});
