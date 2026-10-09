import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { compileServer, offlineFetch, makeDb, installDb } from "../support/server-reader-harness.mjs";
import { T, B, asLegacy, entry, env, seedRaw, uid } from "../support/b1-fixtures.mjs";
import { spec, creditNode, replaceIn, voidIn } from "../support/p1-credit-fixtures.mjs";

offlineFetch();
const srv = compileServer();
const extra = spawnSync("node", [join(srv.dir, "node_modules", "typescript", "bin", "tsc"),
  "--module", "esnext", "--target", "es2022", "--moduleResolution", "bundler", "--skipLibCheck", "--noEmitOnError", "false",
  join(srv.dir, "src/agent/analysis/analyzeDirectMetric.ts"), join(srv.dir, "src/agent/analysis/analyzeForecast.ts"),
  join(srv.dir, "src/agent/analysis/analyzeAnomaly.ts"), join(srv.dir, "src/agent/analysis/analyzeTrend.ts"),
  join(srv.dir, "src/agent/analysis/analyzeComparison.ts"), join(srv.dir, "src/agent/proactive/detectors/detectDailyRevenueUnderperformance.ts"),
  join(srv.dir, "src/agent/proactive/suppressionRules.ts"),
  join(srv.dir, "src/agent/validation/validateData.ts"), join(srv.dir, "src/agent/proactive/digestBuilder.ts"),
  join(srv.dir, "src/agent/orchestrator/runAgent.ts")], { encoding: "utf8" });
assert.ok(existsSync(join(srv.dir, "src/agent/analysis/analyzeDirectMetric.js")), extra.stdout + extra.stderr);
assert.doesNotMatch(extra.stdout + extra.stderr, /src\/agent\//, "no diagnostics in the migrated Agent consumers");
const FM = await srv.import("src/agent/financialMonth.js");
const FMS = await srv.import("src/agent/financialMonthSource.js");
const DIRECT = await srv.import("src/agent/analysis/analyzeDirectMetric.js");
const ANOMALY = await srv.import("src/agent/analysis/analyzeAnomaly.js");
const TREND = await srv.import("src/agent/analysis/analyzeTrend.js");
const COMPARISON = await srv.import("src/agent/analysis/analyzeComparison.js");
const FORECAST = await srv.import("src/agent/analysis/analyzeForecast.js");
const VALIDATE = await srv.import("src/agent/validation/validateData.js");
const LABOR = await srv.import("src/agent/proactive/detectors/detectLaborInefficiency.js");
const RISK = await srv.import("src/agent/proactive/detectors/detectForecastRisk.js");
const PURCHASE = await srv.import("src/agent/proactive/detectors/detectPurchasesWithoutRevenueSupport.js");
const WEAK = await srv.import("src/agent/proactive/detectors/detectWeakDayPattern.js");
const DIGEST = await srv.import("src/agent/proactive/digestBuilder.js");
const RANK = await srv.import("src/agent/proactive/prioritization.js");
const REVENUE = await srv.import("src/agent/proactive/detectors/detectDailyRevenueUnderperformance.js");
const SUPPRESSION = await srv.import("src/agent/proactive/suppressionRules.js");
const ALERT_TYPES = await srv.import("src/alerts/types.js");
const ALERT_CHECKERS = await srv.import("src/alerts/checkers.js");
const POLICY = await srv.import("src/policy/registry.js");
const ALERT_CONFIG = await srv.import("src/alerts/configRepo.js");
const AGENT = await srv.import("src/agent/orchestrator/runAgent.js");
const PLANNER = await srv.import("src/agent/planner/buildMetricsPlan.js");
const SERVICE = await srv.import("src/services/analyticsService.js");
const MONEY = await srv.import("src/presenters/money.js");
const PERCENT = await srv.import("src/presenters/percent.js");

const policy = {
  policyVersion: "MARJIN_POLICY/0-compat",
  values: {
    "goal.foodCostPct": { value: "25", source: "business_config" },
    "goal.laborCostPct": { value: "25", source: "business_config" },
    "alert.laborPctMax": { value: "30", source: "compatibility_product_default" },
    "alert.laborPctCritical": { value: "35", source: "compatibility_product_default" },
  },
};
const report = {
  window: { state: "actual", kind: "closed_month", month: "2026-08", from: "2026-08-01", to: "2026-08-31", completedThrough: "2026-08-31" },
  versions: { fin: "MARJIN_FIN/4" },
  coverage: { revenue: { presentDays: 31 } },
  actual: {
    purchases: { complete: true, value: "8900", gross: { complete: true, value: "9000" }, credits: { state: "present", value: "100" }, bySource: { "supplier:s1": "8900" } },
    purchasesPct: { state: "value", value: "890/31" },
    labor: { employerCost: { state: "complete", value: "10850" }, employerCostPct: { state: "value", value: "35" } },
  },
};
const month = { month: "2026-08", asOfBusinessDate: "2026-09-01", report, policy,
  projection: { forecast: { state: "complete", formulaId: "REV_FORECAST/v2", projectedRevenue: "32000", warnings: [] } }, inputIssues: [] };
const fetched = { metrics: { financialMonth: month, daily: [
  { date: "2026-08-01", foodCostPct: 5, revenue: 100 },
  { date: "2026-08-02", foodCostPct: 60, revenue: 1000 },
] }, sources: ["finance/month-report"], fetchStatus: { daily: "ok", financialMonth: "ok" },
  completenessScore: 1, freshnessScore: 1, consistencyScore: 1, sampleAdequacyScore: 1, rawRecordCount: 31 };
const plan = { intent: "direct_metric_query", metrics: ["food_cost_pct"], timeRange: { start: "2026-08-01", end: "2026-08-31" }, requiresBaseline: false };
const context = { tenantId: "t", bizId: "b", nowIso: "2026-09-01T10:00:00Z", userQuestion: "עלות מזון באוגוסט" };
const baseline = { valid: true, baselineType: "none", sampleSize: 31 };

test("period Food Cost uses the canonical net ratio, including a positive supplier credit, rather than mean daily ratios", () => {
  assert.equal(FM.completeRatio({ state: "value", value: "890/31" }).toFixed(2), "28.71");
  assert.equal(FM.completeRatio({ state: "invalid_components" }), null);
  const out = DIRECT.analyzeDirectMetric(plan, fetched, baseline, context);
  assert.match(out.answer, /28\.7%/);
  assert.doesNotMatch(out.answer, /32\.5%/);
  assert.ok(out.supportingFacts.includes("רכישות נטו: ₪8,900"));
  assert.ok(out.supportingFacts.includes("קרדיטים לספקים: ₪100"));
});

test("the approved presenter rounds a rational forecast only at the display boundary", () => {
  assert.equal(MONEY.formatShekel("92000/3"), "₪30,667");
  assert.equal(PERCENT.formatPercent("890/31"), "28.7%");
  const f = structuredClone(fetched);
  f.metrics.financialMonth.projection.forecast.projectedRevenue = "92000/3";
  const risk = RISK.detectForecastRisk(f, baseline);
  assert.ok(risk?.supportingFacts.some((fact) => fact.includes("₪30,667")));
  assert.doesNotMatch(risk.supportingFacts.join(" "), /92000\/3/);
});

test("alert compatibility defaults are sourced from the policy registry", () => {
  for (const [field, key] of [["laborPctMax", "alert.laborPctMax"], ["laborPctCritical", "alert.laborPctCritical"], ["foodCostPctMax", "alert.foodCostPctMax"], ["foodCostPctCritical", "alert.foodCostPctCritical"]]) {
    assert.equal(ALERT_TYPES.DEFAULT_THRESHOLDS[field], Number(POLICY.COMPATIBILITY_PRODUCT_DEFAULTS[key].value));
  }
});

test("financial alert ratios come from the canonical month with supplier credits and full employer labor", async () => {
  const rows = Array.from({ length: 28 }, (_, i) => entry(uid(i + 500), `2026-09-${String(i + 1).padStart(2, "0")}`, {
    sales: "1000", supplier_payments: { s1: "400" }, payroll: "500", other_expense: "0",
  }));
  const db = installDb(seedRaw(makeDb(), { entries: asLegacy(rows), config: env({}) }));
  db.seed(`tenants/${T}/biz:${B}:supplier_credits`, creditNode([spec(500, "s1", "2026-09-14", "2800")]));
  const RealDate = Date;
  const nowMs = RealDate.parse("2026-09-29T09:00:00Z");
  class FrozenDate extends RealDate { constructor(...args) { super(...(args.length ? args : [nowMs])); } static now() { return nowMs; } }
  globalThis.Date = FrozenDate;
  try {
    const thresholds = { foodCostPctMax: 31, foodCostPctCritical: 40, laborPctMax: 30, laborPctCritical: 60 };
    const food = await ALERT_CHECKERS.checkFoodCostPct(T, B, thresholds);
    const labor = await ALERT_CHECKERS.checkLaborPct(T, B, thresholds);
    assert.equal(food, null, "(28×400−2800)/28000 = 30%, below the 31% threshold");
    assert.equal(labor?.type, "labor_pct_exceeded");
    assert.ok(labor.currentValue > 30, "employer cost includes more than nominal payroll");
  } finally { globalThis.Date = RealDate; }
});

test("configured alert thresholds override compatibility defaults; malformed or unreadable configuration never falls back", async () => {
  const db = installDb(makeDb());
  const path = `tenants/${T}/alert_config/${B}`;
  assert.equal((await ALERT_CONFIG.getThresholds(T, B)).foodCostPctMax, 33);
  db.seed(path, { foodCostPctMax: 29 });
  assert.equal((await ALERT_CONFIG.getThresholds(T, B)).foodCostPctMax, 29);
  db.seed(path, { foodCostPctMax: "29" });
  await assert.rejects(() => ALERT_CONFIG.getThresholds(T, B), /alert_config_invalid/);
  db.seed(path, "not-an-object");
  await assert.rejects(() => ALERT_CONFIG.getThresholds(T, B), /alert_config_malformed/);
  const originalRef = db.ref;
  db.ref = (p) => p === path ? { once: async () => { throw new Error("rtdb_unreadable"); } } : originalRef(p);
  await assert.rejects(() => ALERT_CONFIG.getThresholds(T, B), /rtdb_unreadable/);
});

test("partial purchases, unsupported period and partial forecast do not pass validation or produce a financial number", () => {
  const partial = structuredClone(fetched);
  partial.metrics.financialMonth.report.actual.purchases.complete = false;
  partial.metrics.financialMonth.report.actual.purchasesPct = { state: "invalid_components" };
  assert.equal(VALIDATE.validateData({ fetched: partial, plan, context }).ok, false);
  assert.doesNotMatch(DIRECT.analyzeDirectMetric(plan, partial, baseline, context).answer, /₪8,900/);
  const contradictory = structuredClone(fetched);
  contradictory.metrics.financialMonth.report.actual.purchases.complete = false;
  assert.equal(VALIDATE.validateData({ fetched: contradictory, plan, context }).ok, false);
  const weekly = { ...plan, timeRange: { start: "2026-08-25", end: "2026-08-31" } };
  assert.equal(VALIDATE.validateData({ fetched, plan: weekly, context }).ok, false);
  const forecastPlan = { ...plan, intent: "forecast_request", requiresForecast: true };
  const future = structuredClone(fetched);
  future.metrics.financialMonth.projection.forecast.state = "partial";
  assert.equal(VALIDATE.validateData({ fetched: future, plan: forecastPlan, context }).ok, false);
  assert.doesNotMatch(FORECAST.analyzeForecast(forecastPlan, future, baseline, context).answer, /₪32,000/);
  assert.doesNotMatch(FORECAST.analyzeForecast(forecastPlan, fetched, baseline, context).answer, /₪32,000/,
    "a closed August month cannot answer a September forecast request");
});

test("D-1 open month is an exact eligible financial period; the current day is excluded", () => {
  const current = structuredClone(fetched);
  current.metrics.financialMonth.month = "2026-09";
  current.metrics.financialMonth.asOfBusinessDate = "2026-09-29";
  current.metrics.financialMonth.report.window = { state: "actual", kind: "open_month", month: "2026-09",
    from: "2026-09-01", to: "2026-09-28", completedThrough: "2026-09-28" };
  const d1 = { ...plan, timeRange: { start: "2026-09-01", end: "2026-09-28" } };
  assert.equal(FM.coversRequestedMonth(current.metrics.financialMonth, d1.timeRange), true);
  assert.match(DIRECT.analyzeDirectMetric(d1, current, baseline, { ...context, nowIso: "2026-09-29T09:00:00Z" }).answer, /28\.7%/);
  for (const end of ["2026-09-27", "2026-10-01"]) {
    assert.equal(FM.coversRequestedMonth(current.metrics.financialMonth, { start: "2026-09-01", end }), false);
  }
  for (const end of ["2026-09-29", "2026-09-30"]) {
    assert.equal(FM.coversRequestedMonth(current.metrics.financialMonth, { start: "2026-09-01", end }), true,
      "planner current-month end maps to Actual through D-1");
  }
  const forecastPlan = { ...d1, intent: "forecast_request", requiresForecast: true };
  assert.match(FORECAST.analyzeForecast(forecastPlan, current, baseline, { ...context, nowIso: "2026-09-29T09:00:00Z" }).answer, /₪32,000/);
  assert.equal(VALIDATE.validateData({ fetched: current, plan: forecastPlan, context }).issues.some((i) => i.code === "financial_unavailable"), false);
  const wrongMonth = { ...forecastPlan, timeRange: { start: "2026-08-01", end: "2026-08-31" } };
  assert.doesNotMatch(FORECAST.analyzeForecast(wrongMonth, current, baseline, context).answer, /₪32,000/);
  assert.equal(VALIDATE.validateData({ fetched: current, plan: wrongMonth, context }).issues.some((i) => i.code === "financial_unavailable"), true);
});

test("daily revenue conclusions require every requested completed operating day", () => {
  const rows = Array.from({ length: 8 }, (_, i) => ({ date: `2026-08-${String(i + 1).padStart(2, "0")}`,
    revenue: i === 7 ? 20 : 100, presence: { revenue: "present" }, partial: { revenue: false } }));
  const q = { ...plan, metrics: ["daily_revenue"], timeRange: { start: "2026-08-01", end: "2026-08-08" } };
  const f = { ...fetched, metrics: { daily: rows, revenueClosedDates: [] }, fetchStatus: { daily: "ok" } };
  assert.match(DIRECT.analyzeDirectMetric(q, f, baseline, context).answer, /₪720/);
  assert.match(TREND.analyzeTrend(q, f, baseline, context).answer, /מגמת/);
  const missing = structuredClone(f); missing.metrics.daily.splice(3, 1);
  assert.equal(FM.trustedCompletedRevenueDays(missing.metrics.daily, q.timeRange, "2026-09-01"), null);
  for (const analyze of [DIRECT.analyzeDirectMetric, TREND.analyzeTrend, COMPARISON.analyzeComparison]) {
    const out = analyze(q, missing, { ...baseline, value: 100 }, context);
    assert.doesNotMatch(out.answer, /₪720|מגמת הכנסות|ממוצע הכנסות בתקופה הנוכחית/);
  }
  assert.equal(ANOMALY.analyzeAnomaly(q, missing, baseline, context).anomalies?.some((a) => a.metric === "daily_revenue"), false);
  const partial = structuredClone(f); partial.metrics.daily[7].partial.revenue = true;
  assert.doesNotMatch(DIRECT.analyzeDirectMetric(q, partial, baseline, context).answer, /₪720/);
  const duplicate = structuredClone(f); duplicate.metrics.daily.push({ ...duplicate.metrics.daily[7] });
  assert.doesNotMatch(DIRECT.analyzeDirectMetric(q, duplicate, baseline, context).answer, /₪720/);
  const closure = structuredClone(f); closure.metrics.financialMonth = structuredClone(month);
  closure.metrics.financialMonth.report.operatingCalendar = { closedDates: ["2026-08-04"] };
  closure.metrics.revenueClosedDates = ["2026-08-04"];
  closure.metrics.daily.splice(3, 1);
  assert.match(DIRECT.analyzeDirectMetric(q, closure, baseline, context).answer, /₪620/);
});

test("revenue detector withholds a trend when a completed day is missing", () => {
  const f = structuredClone(fetched);
  f.metrics.daily = Array.from({ length: 15 }, (_, i) => ({ date: `2026-08-${String(i + 17).padStart(2, "0")}`,
    revenue: i >= 12 ? 20 : 100, presence: { revenue: "present" }, partial: { revenue: false } }));
  f.metrics.revenueClosedDates = [];
  f.metrics.financialMonth.report.operatingCalendar = { closedDates: [] };
  assert.equal(FM.trustedCompletedRevenueDays(f.metrics.daily, { start: "2026-08-17", end: "2026-08-31" }, "2026-09-01")?.days.length, 15);
  assert.equal(REVENUE.detectDailyRevenueUnderperformance(f, baseline)?.type, "revenue_underperformance");
  f.metrics.daily.splice(7, 1);
  assert.equal(REVENUE.detectDailyRevenueUnderperformance(f, baseline), null);
});

test("today is excluded and the evaluated revenue day does not enter its own baseline", () => {
  const f = structuredClone(fetched);
  f.metrics.daily = Array.from({ length: 17 }, (_, i) => ({
    date: `2026-08-${String(i + 15).padStart(2, "0")}`,
    revenue: i >= 14 ? 20 : 100,
    presence: { revenue: "present" }, partial: { revenue: false },
  }));
  f.metrics.revenueClosedDates = [];
  const result = REVENUE.detectDailyRevenueUnderperformance(f, baseline);
  assert.equal(result?.baselineValue, 90, "14×100 + 2×20 across 16 prior days");
  assert.equal(result?.currentValue, 20);
  f.metrics.daily.push({ date: "2026-09-01", revenue: 999999,
    presence: { revenue: "present" }, partial: { revenue: false } });
  assert.equal(REVENUE.detectDailyRevenueUnderperformance(f, baseline)?.baselineValue, 90);
  const trusted = FM.trustedCompletedRevenueDays(f.metrics.daily,
    { start: "2026-08-15", end: "2026-09-01" }, "2026-09-01", []);
  assert.equal(trusted?.days.length, 17);
});

test("Daily date follows the Israel business date at the UTC boundary", () => {
  const RealDate = Date;
  const nowMs = RealDate.parse("2026-10-01T21:30:00Z");
  class FrozenDate extends RealDate { constructor(...args) { super(...(args.length ? args : [nowMs])); } static now() { return nowMs; } }
  globalThis.Date = FrozenDate;
  try { assert.equal(DIGEST.buildDailyDigest("t", "b", [], 0).date, "2026-10-02"); }
  finally { globalThis.Date = RealDate; }
});

test("labor amount, relative deviation and ranking retain canonical threshold meaning", () => {
  const laborPlan = { ...plan, metrics: ["labor_cost"] };
  assert.match(DIRECT.analyzeDirectMetric(laborPlan, fetched, baseline, context).answer, /₪10,850/);
  assert.match(DIRECT.analyzeDirectMetric({ ...laborPlan, metrics: ["labor_cost_mtd"] }, fetched, baseline, context).answer, /₪10,850/);
  const labor = LABOR.detectLaborInefficiency(fetched, baseline);
  assert.ok(labor.deviationPct > 16 && labor.deviationPct < 17);
  const risk = RISK.detectForecastRisk(fetched, baseline);
  assert.equal(risk.deviationPct, 40);
  const validation = { ok: true };
  const confidence = { shouldRefuse: false, score: 0.9 };
  assert.equal(SUPPRESSION.evaluateSuppression({ result: labor, validation, confidence, recentInsights: [], isDuplicate: false }).suppressed, false);
});

test("complete canonical amount remains available when its revenue denominator is unavailable", () => {
  const f = structuredClone(fetched);
  f.metrics.financialMonth.report.actual.purchasesPct = { state: "invalid_components" };
  f.metrics.financialMonth.report.actual.labor.employerCostPct = { state: "invalid_components" };
  for (const [metric, amount] of [["supplier_purchases", "8900"], ["food_cost", "8900"], ["labor_cost", "10850"]]) {
    const p = { ...plan, metrics: [metric] };
    assert.equal(VALIDATE.validateData({ fetched: f, plan: p, context }).issues.some((i) => i.code === "financial_unavailable"), false);
    assert.match(DIRECT.analyzeDirectMetric(p, f, baseline, context).answer, new RegExp(`₪${Number(amount).toLocaleString("en-US")}`));
  }
  for (const metric of ["food_cost_pct", "labor_pct"]) {
    const p = { ...plan, metrics: [metric] };
    assert.equal(VALIDATE.validateData({ fetched: f, plan: p, context }).issues.some((i) => i.code === "financial_unavailable"), false,
      "complete amount remains answerable when the paired ratio is unavailable");
    assert.match(DIRECT.analyzeDirectMetric(p, f, baseline, context).answer, /₪8,900|₪10,850/);
    assert.doesNotMatch(DIRECT.analyzeDirectMetric(p, f, baseline, context).answer, /28\.7%|35\.0%/);
  }
  const foodFacts = DIRECT.analyzeDirectMetric({ ...plan, metrics: ["food_cost_pct"] }, f, baseline, context).supportingFacts;
  assert.ok(foodFacts.some((fact) => fact.includes("שיעור עלות המזון אינו זמין")),
    "the supporting evidence discloses the missing denominator as well as the answer");
  const incompleteLabor = structuredClone(f);
  incompleteLabor.metrics.financialMonth.report.actual.labor.employerCost.state = "incomplete_components";
  assert.equal(VALIDATE.validateData({ fetched: incompleteLabor,
    plan: { ...plan, metrics: ["labor_cost"] }, context }).issues.some((i) => i.code === "financial_unavailable"), true,
    "validation refuses an incomplete amount even when the analyzer also checks it");
});

test("current-month labor fetch stops at D-1 before analyzer consumption", async () => {
  const rows = Array.from({ length: 29 }, (_, i) => entry(uid(i + 3300),
    `2026-09-${String(i + 1).padStart(2, "0")}`, {
      sales: i === 28 ? "900000" : "1000", payroll: i === 28 ? "900000" : "400",
    }));
  installDb(seedRaw(makeDb(), { entries: asLegacy(rows), config: env({}) }));
  const p = { ...plan, metrics: ["labor_cost"], timeRange: { start: "2026-09-01", end: "2026-09-30" } };
  const ctx = { ...context, tenantId: T, bizId: B, nowIso: "2026-09-29T09:00:00Z" };
  const data = await SERVICE.fetchPlannedData(p, ctx);
  assert.equal(data.fetchStatus.labor, "ok");
  assert.ok(data.metrics.labor.length > 0, JSON.stringify({ labor: data.metrics.labor, status: data.fetchStatus }));
  assert.equal(data.metrics.labor.some((row) => row.date >= "2026-09-29"), false,
    "the fetched input itself excludes the current and future business dates");
});

test("Daily detectors use trusted monthly ratios and configured goals; unsupported purchase trend is disclosed", () => {
  const labor = LABOR.detectLaborInefficiency(fetched, baseline);
  assert.equal(labor.currentValue, 35);
  assert.equal(labor.severity, "medium"); // existing proactive boundary is >35 for high
  assert.ok(labor.supportingFacts.includes("עלות מעסיק מלאה MTD: ₪10,850"),
    "Daily labor facts use the approved money presenter");
  const risk = RISK.detectForecastRisk(fetched, baseline);
  assert.equal(risk.metric, "labor_pct");
  assert.equal(risk.currentValue, 35);
  const invalid = structuredClone(fetched);
  invalid.metrics.financialMonth.report.actual.labor.employerCost.state = "incomplete_components";
  invalid.metrics.financialMonth.report.actual.labor.employerCostPct = { state: "incomplete_components" };
  assert.equal(LABOR.detectLaborInefficiency(invalid, baseline), null);
  assert.equal(RISK.detectForecastRisk(invalid, baseline), null); // food gap is 3.71 pp, below warning
  assert.equal(PURCHASE.detectPurchasesWithoutRevenueSupport(fetched, baseline), null);
  const digest = DIGEST.buildDailyDigest("t", "b", [], 0, ["purchase_trend_exact_window_source_unavailable"]);
  assert.deepEqual(digest.limitations, ["purchase_trend_exact_window_source_unavailable"]);
  assert.deepEqual(digest.topInsights, []);
});

test("trend, comparison and anomaly analyzers use planner ranges and exact closure-aware operating days", () => {
  const RealDate = Date;
  const nowMs = RealDate.parse("2026-09-01T09:00:00Z");
  class FrozenDate extends RealDate { constructor(...args) { super(...(args.length ? args : [nowMs])); } static now() { return nowMs; } }
  const ctx = { ...context, nowIso: new RealDate(nowMs).toISOString(), timezone: "Asia/Jerusalem" };
  let plans;
  globalThis.Date = FrozenDate;
  try {
    plans = [
      ["trend_analysis", "מה מגמת ההכנסות באוגוסט", TREND.analyzeTrend],
      ["comparison_query", "השווה את ההכנסות באוגוסט", COMPARISON.analyzeComparison],
      ["anomaly_detection", "האם יש חריגה בהכנסות באוגוסט", ANOMALY.analyzeAnomaly],
    ].map(([intent, question, analyze]) => ({ intent, plan: PLANNER.buildMetricsPlan(intent, question, ctx), analyze }));
  } finally { globalThis.Date = RealDate; }
  const closure = "2026-08-04";
  const daily = Array.from({ length: 31 }, (_, i) => {
    const date = `2026-08-${String(i + 1).padStart(2, "0")}`;
    return { date, revenue: date === "2026-08-05" ? 0 : 100,
      presence: { revenue: "present" }, partial: { revenue: false } };
  }).filter((row) => row.date !== closure);
  const evidence = { ...fetched, metrics: { daily, revenueClosedDates: [closure] },
    fetchStatus: { daily: "ok" }, sources: ["analytics/daily"] };
  const base = { valid: true, value: 100, baselineType: "period_average", sampleSize: 30 };
  for (const { intent, plan, analyze } of plans) {
    assert.deepEqual(plan.timeRange, { start: "2026-08-01", end: "2026-08-31" }, intent);
    const out = analyze(plan, evidence, base, ctx);
    if (intent === "trend_analysis") {
      assert.match(out.answer, /מגמת הכנסות/);
      assert.ok(out.supportingFacts.includes("ממוצע יומי: ₪97"), "2,900 / 30 operating days rounds to ₪97");
    } else if (intent === "comparison_query") {
      assert.ok(out.supportingFacts.includes("תקופה נוכחית: 15 ימים"));
    } else {
      assert.ok(out.supportingFacts.includes("נבדקו 30 ימים"));
      assert.equal(out.anomalies?.some((a) => a.metric === "daily_revenue"), false);
    }
    const unknown = analyze(plan, { ...evidence, metrics: { ...evidence.metrics, revenueClosedDates: [] } }, base, ctx);
    assert.doesNotMatch(unknown.supportingFacts.join(" "), /ממוצע יומי|תקופה נוכחית|נבדקו 30 ימים/,
      `${intent} must not infer a missing day is an operating zero`);
    const conflict = analyze(plan, { ...evidence, metrics: { daily: [...daily, {
      date: closure, revenue: 500, presence: { revenue: "present" }, partial: { revenue: false },
    }], revenueClosedDates: [closure] } }, base, ctx);
    assert.doesNotMatch(conflict.supportingFacts.join(" "), /ממוצע יומי|תקופה נוכחית|נבדקו 30 ימים/,
      `${intent} must refuse revenue recorded on a declared closure`);
  }
});

test("the authoritative closure loader spans months and fails closed on an unreadable ledger", async () => {
  const db = installDb(seedRaw(makeDb(), { entries: asLegacy([
    entry(uid(3000), "2026-09-30", { sales: "0" }),
    entry(uid(3001), "2026-10-01", { sales: "0" }),
  ]), config: env({}) }));
  const path = `tenants/${T}/entry_exceptions/${B}`;
  db.seed(path, {
    "2026-09-30": { state: { status: "active", reasonCode: "closure" } },
    "2026-10-01": { state: { status: "active", reasonCode: "closure" } },
  });
  const nowMs = Date.parse("2026-10-04T09:00:00Z");
  const range = { start: "2026-09-29", end: "2026-10-03" };
  assert.deepEqual(await FMS.loadAgentRevenueClosedDates(T, B, nowMs, range),
    ["2026-09-30", "2026-10-01"]);
  db.seed(path, "corrupt");
  assert.equal(await FMS.loadAgentRevenueClosedDates(T, B, nowMs, range), null);
});

test("a failed closure-calendar read cannot become a known-empty calendar", async () => {
  const rows = Array.from({ length: 8 }, (_, i) => entry(uid(i + 3100), `2026-08-${String(i + 1).padStart(2, "0")}`, { sales: "100" }));
  const db = installDb(seedRaw(makeDb(), { entries: asLegacy(rows), config: env({}) }));
  const exceptionPath = `tenants/${T}/entry_exceptions/${B}`;
  const prior = db.ref;
  let exceptionReads = 0;
  const readPaths = [];
  db.ref = (path, query) => {
    readPaths.push(path);
    const ref = prior(path, query);
    if (path !== exceptionPath) return ref;
    return { ...ref, once: async (...args) => {
      exceptionReads++;
      if (exceptionReads > 1) throw Error("private@example.test token=secret");
      return ref.once(...args);
    } };
  };
  const p = { ...plan, metrics: ["daily_revenue"], timeRange: { start: "2026-08-01", end: "2026-08-08" } };
  const ctx = { ...context, tenantId: T, bizId: B, nowIso: "2026-08-09T09:00:00Z" };
  const data = await SERVICE.fetchPlannedData(p, ctx);
  assert.equal(data.fetchStatus.daily, "ok");
  assert.ok(exceptionReads > 1, `the calendar read was independently faulted after daily revenue loaded: ${JSON.stringify({ exceptionReads, readPaths, status: data.fetchStatus, keys: Object.keys(data.metrics) })}`);
  assert.equal(data.metrics.revenueClosedDates, null);
  const out = TREND.analyzeTrend(p, data, baseline, ctx);
  assert.match(out.answer, /אין מספיק נתוני הכנסות מאומתים/);
});

test("canonical-month fetch errors log a bounded fixed message", async () => {
  const db = installDb(seedRaw(makeDb(), { entries: asLegacy([
    entry(uid(3200), "2026-08-01", { sales: "100" }),
  ]), config: env({}) }));
  const configPath = `tenants/${T}/biz:${B}:config`;
  const priorRef = db.ref;
  let configReads = 0;
  const readPaths = [];
  db.ref = (path, query) => {
    readPaths.push(path);
    const ref = priorRef(path, query);
    if (path !== configPath) return ref;
    return { ...ref, once: async (...args) => {
      configReads++;
      if (configReads > 1) throw Error("private@example.test token=secret");
      return ref.once(...args);
    } };
  };
  const captured = [];
  const priorError = console.error;
  console.error = (...args) => captured.push(args.map(String).join(" "));
  try {
    await SERVICE.fetchPlannedData({ ...plan, metrics: ["food_cost"],
      timeRange: { start: "2026-08-01", end: "2026-08-31" } },
      { ...context, tenantId: T, bizId: B, nowIso: "2026-09-01T09:00:00Z" });
  } finally { console.error = priorError; }
  assert.ok(configReads > 1, `configReads=${configReads}; paths=${readPaths.join(" | ")}; logs=${captured.join(" | ")}`);
  assert.match(captured.join("\n"), /Failed to fetch canonical financial month: unavailable/);
  assert.doesNotMatch(captured.join("\n"), /private@example\.test|token=secret/);
});

test("forecast risk severity uses the approved goal gap bands", () => {
  const f = structuredClone(fetched);
  f.metrics.financialMonth.report.actual.purchasesPct = { state: "denominator_missing" };
  f.metrics.financialMonth.report.actual.labor.employerCostPct = { state: "value", value: "31" };
  assert.equal(RISK.detectForecastRisk(f, baseline)?.severity, "medium", "31% is 6 pp over the 25% goal");
  f.metrics.financialMonth.report.actual.labor.employerCostPct.value = "36";
  assert.equal(RISK.detectForecastRisk(f, baseline)?.severity, "high", "36% is 11 pp over goal");
  f.metrics.financialMonth.report.actual.labor.employerCostPct.value = "30";
  assert.equal(RISK.detectForecastRisk(f, baseline), null, "5 pp is the non-alert boundary");
});

test("labor detector requires seven covered revenue days", () => {
  const f = structuredClone(fetched);
  f.metrics.financialMonth.report.coverage.revenue.presentDays = 6;
  assert.equal(LABOR.detectLaborInefficiency(f, baseline), null);
  f.metrics.financialMonth.report.coverage.revenue.presentDays = 7;
  assert.equal(LABOR.detectLaborInefficiency(f, baseline)?.type, "labor_inefficiency");
});

test("equal impact scores have stable Daily top-three ordering", () => {
  const items = ["c", "a", "d", "b"].map((id) => ({ id, type: "labor_inefficiency", severity: "medium", confidenceScore: 0.9, occurrenceCount: 1 }));
  assert.deepEqual(RANK.pickTopInsights(items, 3).map((x) => x.insightId), ["a", "b", "c"]);
  assert.deepEqual(RANK.pickTopInsights(items.reverse(), 3).map((x) => x.insightId), ["a", "b", "c"]);
});

test("weekday averages include explicit operating zero and exclude declared closure; missing revenue suppresses conclusion", () => {
  const days = Array.from({ length: 31 }, (_, i) => {
    const date = `2026-08-${String(i + 1).padStart(2, "0")}`;
    return { date, revenue: ["2026-08-02", "2026-08-09", "2026-08-16", "2026-08-23", "2026-08-30"].includes(date) ? 0 : 100,
      presence: { revenue: "present" }, partial: { revenue: false } };
  });
  const f = structuredClone(fetched);
  f.metrics.daily = days;
  f.metrics.revenueClosedDates = [];
  f.metrics.financialMonth.month = "2026-08";
  f.metrics.financialMonth.report.operatingCalendar = { closedDates: [] };
  f.metrics.financialMonth.report.actual.revenue = { complete: true };
  const operating = WEAK.detectWeakDayPattern(f, baseline);
  assert.equal(operating?.type, "weak_day_pattern");
  assert.equal(operating?.currentValue, 0);
  f.metrics.financialMonth.report.operatingCalendar.closedDates = ["2026-08-02", "2026-08-09", "2026-08-16", "2026-08-23", "2026-08-30"];
  f.metrics.revenueClosedDates = [...f.metrics.financialMonth.report.operatingCalendar.closedDates];
  assert.equal(WEAK.detectWeakDayPattern(f, baseline), null);
  f.metrics.financialMonth.report.operatingCalendar.closedDates = [];
  f.metrics.revenueClosedDates = [];
  f.metrics.financialMonth.report.actual.revenue.complete = false;
  assert.equal(WEAK.detectWeakDayPattern(f, baseline), null);
});

test("real source: supplier credit create, replace and void change net monthly Food Cost at the issue date", async () => {
  const rows = Array.from({ length: 31 }, (_, i) => entry(uid(i + 1), `2026-08-${String(i + 1).padStart(2, "0")}`, {
    sales: i === 0 ? "100" : "1000", supplier_payments: { s1: "300" }, payroll: "100",
  }));
  const db = installDb(seedRaw(makeDb(), { entries: asLegacy(rows), config: env({}), suppliers: env([{ id: "s1", name: "Supplier" }]) }));
  const creditPath = `tenants/${T}/biz:${B}:supplier_credits`;
  const nowMs = Date.parse("2026-09-01T09:00:00Z");
  const report = async () => (await FMS.loadAgentFinancialMonth(T, B, nowMs, "2026-08")).report;
  let node = creditNode([spec(1, "s1", "2026-08-15", "100")]);
  db.seed(creditPath, node);
  assert.equal((await report()).actual.purchases.value, "9200");
  assert.equal((await report()).actual.purchases.credits.value, "100");
  node = replaceIn(node, 1, 2, { amount: "200" });
  db.seed(creditPath, node);
  assert.equal((await report()).actual.purchases.value, "9100");
  node = voidIn(node, 2);
  db.seed(creditPath, node);
  assert.equal((await report()).actual.purchases.value, "9300");
  db.seed(creditPath, creditNode([spec(3, "s1", "2026-08-15", "100", { review: "pending" })]));
  const pending = await report();
  assert.equal(pending.actual.purchases.complete, false);
  assert.notEqual(pending.actual.purchasesPct.state, "value");
  db.seed(creditPath, "unreadable");
  const unreadable = await FMS.loadAgentFinancialMonth(T, B, nowMs, "2026-08");
  assert.equal(unreadable.inputIssues.includes("supplier_credits_unreadable"), true);
  assert.equal(unreadable.report.actual.purchases.complete, false);
  assert.equal(unreadable.report.actual.purchasesPct.state, "invalid_components");
});

test("real source: issue dates cross the year boundary without restating the earlier month", async () => {
  const db = installDb(seedRaw(makeDb(), { entries: asLegacy([
    entry(uid(80), "2026-12-31", { sales: "1000", supplier_payments: { s1: "300" } }),
    entry(uid(81), "2027-01-01", { sales: "1000", supplier_payments: { s1: "300" } }),
  ]), config: env({}) }));
  db.seed(`tenants/${T}/biz:${B}:supplier_credits`, creditNode([
    spec(80, "s1", "2026-12-31", "50"), spec(81, "s1", "2027-01-01", "80"),
  ]));
  const nowMs = Date.parse("2027-01-03T09:00:00Z");
  const december = (await FMS.loadAgentFinancialMonth(T, B, nowMs, "2026-12")).report;
  const january = (await FMS.loadAgentFinancialMonth(T, B, nowMs, "2027-01")).report;
  assert.equal(december.actual.purchases.credits.value, "50");
  assert.equal(january.actual.purchases.credits.value, "80");
  assert.equal(december.actual.purchases.value, "250");
  assert.equal(january.actual.purchases.value, "220");
});

test("manual Actual remains at D-1 despite a very large current-day row", async () => {
  const db = installDb(seedRaw(makeDb(), { entries: asLegacy([
    entry(uid(90), "2026-09-28", { sales: "1000", supplier_payments: { s1: "300" }, payroll: "100" }),
    entry(uid(91), "2026-09-29", { sales: "999999", supplier_payments: { s1: "999999" }, payroll: "999999" }),
  ]), config: env({}) }));
  assert.ok(db);
  const nowMs = Date.parse("2026-09-29T09:00:00Z");
  const current = await FMS.loadAgentFinancialMonth(T, B, nowMs);
  assert.equal(current.report.window.completedThrough, "2026-09-28");
  assert.equal(current.report.actual.revenue.value, "1000");
  assert.equal(current.report.actual.purchases.value, "300");
});

test("an unrelated business's unreadable credit node cannot contaminate the target report", async () => {
  const db = installDb(seedRaw(makeDb(), { entries: asLegacy([
    entry(uid(100), "2026-08-31", { sales: "1000", supplier_payments: { s1: "300" } }),
  ]), config: env({}) }));
  db.seed(`tenants/${T}/biz:other:supplier_credits`, "malformed");
  db.seed(`tenants/${T}/biz:${B}:supplier_credits`, creditNode([spec(100, "s1", "2026-08-31", "50")]));
  const result = await FMS.loadAgentFinancialMonth(T, B, Date.parse("2026-09-01T09:00:00Z"), "2026-08");
  assert.equal(result.report.actual.purchases.value, "250");
  assert.equal(result.report.actual.purchases.credits.value, "50");
  assert.equal(result.inputIssues.includes("supplier_credits_unreadable"), false);
});

test("real planner reaches D-1 amounts, unavailable ratios and declared-closure revenue", async () => {
  const RealDate = Date;
  const nowMs = RealDate.parse("2026-09-29T09:00:00Z");
  class FrozenDate extends RealDate { constructor(...args) { super(...(args.length ? args : [nowMs])); } static now() { return nowMs; } }
  const ask = async (q) => (await AGENT.runAgent({ tenantId: T, bizId: B, userQuestion: q,
    nowIso: new RealDate(nowMs).toISOString(), timezone: "Asia/Jerusalem" })).text;
  globalThis.Date = FrozenDate;
  try {
    const august = Array.from({ length: 31 }, (_, i) => entry(uid(i + 700), `2026-08-${String(i + 1).padStart(2, "0")}`,
      { sales: "0", supplier_payments: { s1: "300" }, payroll: "400", other_expense: "0" }));
    const september = Array.from({ length: 29 }, (_, i) => entry(uid(i + 800), `2026-09-${String(i + 1).padStart(2, "0")}`,
      i === 28 ? { sales: "900000", supplier_payments: { s1: "900000" }, payroll: "900000" } :
        { sales: "1000", supplier_payments: { s1: "300" }, payroll: "400", other_expense: "0" }));
    installDb(seedRaw(makeDb(), { entries: asLegacy([...august, ...september]), config: env({}) }));
    assert.match(await ask("מה עלות מזון החודש"), /30\.0%/);
    assert.match(await ask("מה עלות מזון החודש"), /2026-09-28/);
    assert.match(await ask("כמה עלות כוח אדם באוגוסט"), /₪12,400.*שיעור כוח האדם אינו זמין/);
    assert.match(await ask("מה עלות מזון באוגוסט"), /₪9,300.*שיעור עלות המזון אינו זמין/);

    const closed = september.map((row, i) => i === 25
      ? entry(uid(900), "2026-09-26", { sales: "0", is_exception: true, exception_reason: "closure" })
      : i === 24 ? entry(uid(901), "2026-09-25", { sales: "0", supplier_payments: { s1: "300" }, payroll: "400" }) : row);
    installDb(seedRaw(makeDb(), { entries: asLegacy([...august, ...closed]), config: env({}) }));
    const revenue = await ask("מה ממוצע ההכנסות השבוע");
    assert.match(revenue, /ממוצע יומי: ₪800/);
    assert.match(revenue, /5 ימי פעילות מאומתים/);
    assert.doesNotMatch(revenue, /666\.67|900000/);
    for (const question of ["מה מגמת ההכנסות", "השווה את ההכנסות לחודש הקודם", "האם יש חריגה בהכנסות"]) {
      const answer = await ask(question);
      assert.doesNotMatch(answer, /נתוני הכנסה מלאים.*אינם זמינים|אין מספיק נתוני הכנסות מאומתים/,
        `a declared closure must not masquerade as missing revenue: ${question}`);
      assert.doesNotMatch(answer, /900000/);
    }
    installDb(seedRaw(makeDb(), { entries: asLegacy([...august, ...september]), config: env({}) }));
    const forecast = await ask("מה התחזית לסוף החודש");
    assert.match(forecast, /תחזית הכנסות סוף חודש: ₪[0-9,]+/);
    assert.doesNotMatch(forecast, /\d+\/\d+/);
  } finally { globalThis.Date = RealDate; }
});
