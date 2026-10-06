// Financial Core B1 — downstream compatibility: COMPAT-01…08.
// Old readers on new docs, new code on old docs, agent analyzers / proactive detectors /
// alerts runner on the canonical series and docs, and the unchanged API wrapper. "Non-VD"
// fixtures (no hourly_payroll, positive revenue, every fact present, exact ratios) must give
// the SAME result as the pre-B1 code at BASE 213fb350 (compiled from git in the sandbox).
import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { compileServer, makeDb, installDb, offlineFetch, ROOT } from "../support/server-reader-harness.mjs";
import { T, B, asLegacy, entry, env, seedRaw, uid } from "../support/b1-fixtures.mjs";
import { gitIn } from "../support/git-context.mjs";
import { isM1R2Tree, M1_R2_PINS } from "../support/m1-r2-remediation.mjs";
import { strictLegacyDailyMetric } from "../../lib/analytics/strictDailyMetrics.js";

offlineFetch();
const BASE = "213fb350019c3e212156eb032e34f4da8c179d6f";
const srv = compileServer();
// the agent analyzers are not in the harness entry list: compile them in the same sandbox
{
  const tsc = join(ROOT, "node_modules", "typescript", "bin", "tsc");
  const files = ["analyzeDirectMetric", "analyzeAnomaly", "analyzeComparison", "analyzeTrend"].map((f) => join(srv.dir, "src", "agent", "analysis", f + ".ts"));
  spawnSync("node", [tsc, "--module", "esnext", "--target", "es2022", "--moduleResolution", "bundler", "--skipLibCheck", "--noEmitOnError", "false", "--allowJs", "false", ...files], { encoding: "utf8" });
}
const DBLD = await srv.import("src/analytics/dailyBuilder.js");
const BL = await srv.import("src/insights/baselines.js");
const RULES = await srv.import("src/insights/rules.js");
const INS = await srv.import("src/insights/buildInsights.js");
const AS = await srv.import("src/services/analyticsService.js");
const SB = await srv.import("src/agent/baseline/selectBaseline.js");
const PJ = await srv.import("src/agent/proactive/runProactiveJob.js");
const RUN = await srv.import("src/alerts/runner.js");
const AN = {
  direct: (await srv.import("src/agent/analysis/analyzeDirectMetric.js")).analyzeDirectMetric,
  anomaly: (await srv.import("src/agent/analysis/analyzeAnomaly.js")).analyzeAnomaly,
  comparison: (await srv.import("src/agent/analysis/analyzeComparison.js")).analyzeComparison,
  trend: (await srv.import("src/agent/analysis/analyzeTrend.js")).analyzeTrend,
};
const DET = {
  revenue: (await srv.import("src/agent/proactive/detectors/detectDailyRevenueUnderperformance.js")).detectDailyRevenueUnderperformance,
  labor: (await srv.import("src/agent/proactive/detectors/detectLaborInefficiency.js")).detectLaborInefficiency,
  weakDay: (await srv.import("src/agent/proactive/detectors/detectWeakDayPattern.js")).detectWeakDayPattern,
  purchases: (await srv.import("src/agent/proactive/detectors/detectPurchasesWithoutRevenueSupport.js")).detectPurchasesWithoutRevenueSupport,
  forecast: (await srv.import("src/agent/proactive/detectors/detectForecastRisk.js")).detectForecastRisk,
};

// pre-B1 modules compiled from git (BASE) next to the B1 ones in the sandbox
const ts = (await import(pathToFileURL(join(ROOT, "node_modules", "typescript", "lib", "typescript.js")).href)).default;
async function baseModule(rel) {
  const show = gitIn(ROOT, ["show", `${BASE}:${rel}`]); assert.equal(show.status, 0, show.stderr);
  const dest = join(srv.dir, rel.replace(/\.ts$/, ".__base__.js"));
  writeFileSync(dest, ts.transpileModule(show.stdout, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText);
  return import(pathToFileURL(dest).href);
}
const BASE_DM = await baseModule("src/repositories/analytics/dailyMetricsRepo.ts");
const BASE_DB = await baseModule("src/analytics/dailyBuilder.ts");

const utcToday = () => new Date(Date.now()).toISOString().slice(0, 10);
const ago = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
/** Non-VD history: exact dyadic ratios, every fact present, no hourly_payroll, unique dates, no global employees. */
const REV = [800, 1600, 400, 3200, 1000, 2000];
const nonVdRows = (n = 35, from = 1) => Array.from({ length: n }, (_, i) => entry(uid(3000 + i), ago(from + i), { sales: String(REV[i % REV.length]), supplier_payments: { s1: String(REV[i % REV.length] / 4) }, payroll: String(REV[i % REV.length] / 8) }));
const legacyFields = (d) => ({ date: d.date, revenue: d.revenue, laborCost: d.laborCost, laborPct: d.laborPct, foodCost: d.foodCost, foodCostPct: d.foodCostPct, transactionCount: d.transactionCount, avgTicket: d.avgTicket });
const plan = (metrics = ["daily_revenue", "labor_cost", "labor_pct", "food_cost"]) => ({ intent: "anomaly_detection", metrics, dimensions: ["date", "day_of_week"], filters: {}, timeRange: { start: ago(28), end: utcToday() }, requiresBaseline: true, requiresComparison: true, requiresAnomalyDetection: true });
const ctx = () => ({ tenantId: T, bizId: B, timezone: "Asia/Jerusalem", locale: "he-IL", nowIso: new Date().toISOString(), userQuestion: "q" });
const seed = (rows, opts = {}) => installDb(seedRaw(makeDb(), { entries: asLegacy(rows), config: env({}), suppliers: env([{ id: "s1", name: "S1" }]), ...opts }));
const docOf = (revenue, extra = {}) => ({ date: "2026-09-10", bizId: B, tenantId: T, revenue, weather: null, alerts: null, operational: { war_day: "regular" }, calendar: { dow: 4, weekend: false, holiday: false }, ...extra });

test("COMPAT-01 strictLegacyDailyMetric: a new doc with an omitted field ⇒ null (date skipped); a complete new doc ⇒ the same metric as before", async () => {
  const D = ago(3);
  seed([entry(uid(1), D, { sales: "1000", supplier_payments: { s1: "250" }, payroll: "125" })]);
  const b1 = await DBLD.buildAnalyticsForBiz(T, B, D);
  seed([entry(uid(1), D, { sales: "1000", supplier_payments: { s1: "250" }, payroll: "125" })]);
  const base = await BASE_DB.buildAnalyticsForBiz(T, B, D);
  assert.deepEqual(strictLegacyDailyMetric(b1.revenue), strictLegacyDailyMetric(base.revenue));
  assert.deepEqual(strictLegacyDailyMetric(b1.revenue), { revenue: 1000, laborCost: 125, foodCost: 250 });
  seed([entry(uid(1), D, { sales: "1000", supplier_payments: { s1: "250" } })]);
  const noPayroll = await DBLD.buildAnalyticsForBiz(T, B, D);
  assert.equal(strictLegacyDailyMetric(noPayroll.revenue), null, "payroll omitted ⇒ the date is skipped, never a 0 labor record");
  seed([entry(uid(1), D, { notes: "x" })]);
  assert.equal(strictLegacyDailyMetric((await DBLD.buildAnalyticsForBiz(T, B, D)).revenue), null);
});

test("COMPAT-02 trailingRatioAvg: history with omitted payroll ⇒ the sample is excluded, never NaN", () => {
  const hist = [docOf({ total: 1000, payroll: 100, had_entry: true, has_sales: true }), docOf({ total: 1000, had_entry: true, has_sales: true }), docOf({ total: 2000, payroll: 400, had_entry: true, has_sales: true })];
  const r = BL.trailingRatioAvg(hist, (d) => d.revenue.payroll, 30);
  assert.equal(r.n, 2); assert.ok(Number.isFinite(r.avg)); assert.ok(Math.abs(r.avg - 0.15) < 1e-12);
  const none = BL.trailingRatioAvg([docOf({ total: 1000, had_entry: true, has_sales: true })], (d) => d.revenue.payroll, 30);
  assert.equal(none.n, 0); assert.equal(none.avg, null);
});

test("COMPAT-03 ruleLaborRisk: today without payroll ⇒ null (no NaN insight)", () => {
  const hist = Array.from({ length: 20 }, () => docOf({ total: 1000, payroll: 100, had_entry: true, has_sales: true }));
  assert.equal(RULES.ruleLaborRisk(docOf({ total: 1000, had_entry: true, has_sales: true }), hist, 0), null);
  const high = RULES.ruleLaborRisk(docOf({ total: 1000, payroll: 600, had_entry: true, has_sales: true }), hist, 0);
  assert.ok(high && Number.isFinite(high.currentValue), "a real labor value still produces the insight");
});

test("COMPAT-04 mixed deployment: an old reader on new docs and new code on old docs (no fin) both work", async () => {
  // old-shaped history docs (pre-B1: every numeric field, no fin) + a new-shaped doc
  const old = (date, total) => ({ date, bizId: B, tenantId: T, revenue: { sales: total, deliveries: 0, other_income: 0, total, food_cost: total / 4, payroll: total / 8, had_entry: true, has_sales: true }, weather: null, alerts: null, operational: { war_day: "regular" }, calendar: { dow: new Date(date + "T00:00:00Z").getUTCDay(), weekend: false, holiday: false } });
  const D = ago(2);
  const db = seed([entry(uid(1), D, { sales: "1000", supplier_payments: { s1: "250" } })]);
  for (let k = 3; k < 40; k++) db.seed(`tenants/${T}/biz:${B}:analytics:daily:${ago(k)}`, old(ago(k), 1000 + (k % 5) * 100));
  const fresh = await DBLD.buildAnalyticsForBiz(T, B, D);
  assert.ok(!("payroll" in fresh.revenue) && fresh.fin);
  // old reader (the unchanged insight engine / strict alert mapper) on the new doc: no throw, no NaN
  const oldReader = INS.buildInsights(fresh, (await DBLD.loadAnalyticsHistory(T, B, D, 45)));
  assert.ok(!JSON.stringify(oldReader).includes("NaN"));
  // new code on an OLD doc (no fin): legacy path (history load), identical to the direct engine
  const todayOld = old(D, 1500);
  await DBLD.buildAndSaveInsights(T, B, D, todayOld);
  const saved = db.read(`tenants/${T}/biz:${B}:insights:daily:${D}`);
  const direct = INS.buildInsights(todayOld, await DBLD.loadAnalyticsHistory(T, B, D, 45));
  const noTime = (v) => JSON.parse(JSON.stringify(v, (k, x) => (/^(?:generatedAt|createdAt)$/.test(k) ? undefined : x)));
  assert.deepEqual(noTime(saved), noTime(direct));
});

test("COMPAT-05 agent analyzers over the canonical series: no throw with null ratios; non-VD outputs equal the pre-B1 outputs", async () => {
  seed(nonVdRows());
  const b1Daily = await AS.fetchPlannedData(plan(), ctx());
  const baseDaily = (await BASE_DM.getDailyMetrics(T, ago(28), utcToday(), B)).slice().sort((a, b) => a.date.localeCompare(b.date));
  assert.deepEqual(b1Daily.metrics.daily.map(legacyFields), baseDaily.map(legacyFields), "non-VD: identical legacy DailyMetric fields");
  const fetchedBase = { ...b1Daily, metrics: { ...b1Daily.metrics, daily: baseDaily } };
  const fetchedB1Legacy = { ...b1Daily, metrics: { ...b1Daily.metrics, daily: b1Daily.metrics.daily.map(legacyFields) } };
  for (const [name, fn] of Object.entries(AN)) {
    for (const p of [plan(), plan(["daily_revenue"]), plan(["labor_pct", "food_cost_pct"])]) {
      const blB1 = SB.selectBaseline(p, b1Daily, ctx()), blBase = SB.selectBaseline(p, fetchedBase, ctx());
      assert.deepEqual(JSON.parse(JSON.stringify(blB1)), JSON.parse(JSON.stringify(blBase)), name + " baseline");
      assert.deepEqual(JSON.parse(JSON.stringify(fn(p, fetchedB1Legacy, blB1, ctx()))), JSON.parse(JSON.stringify(fn(p, fetchedBase, blBase, ctx()))), name);
      assert.doesNotThrow(() => fn(p, b1Daily, blB1, ctx()), name + " on the full canonical records");
    }
  }
  // a series with null ratios (zero revenue, missing purchases) never throws
  seed([...nonVdRows(20, 3), entry(uid(1), ago(1), { sales: "0", payroll: "10" }), entry(uid(2), ago(2), { sales: "500" })]);
  const withNulls = await AS.fetchPlannedData(plan(), ctx());
  assert.ok(withNulls.metrics.daily.some((d) => d.laborPct === null || d.foodCostPct === null));
  for (const [name, fn] of Object.entries(AN)) assert.doesNotThrow(() => fn(plan(), withNulls, SB.selectBaseline(plan(), withNulls, ctx()), ctx()), name);
});

test("COMPAT-06 the 5 active proactive detectors run on canonical series without throwing; non-VD verdicts equal pre-B1; runForBiz persists without detector errors", async () => {
  const bait = [...nonVdRows(30, 2), entry(uid(9), ago(1), { sales: "200", supplier_payments: { s1: "50" }, payroll: "150" })];
  for (const rows of [nonVdRows(), bait]) {
    seed(rows);
    const fetched = await AS.fetchPlannedData(plan(), ctx());
    const baseDaily = (await BASE_DM.getDailyMetrics(T, ago(28), utcToday(), B)).slice().sort((a, b) => a.date.localeCompare(b.date));
    const fetchedBase = { ...fetched, metrics: { ...fetched.metrics, daily: baseDaily } };
    const bl = SB.selectBaseline(plan(), fetched, ctx()), blBase = SB.selectBaseline(plan(), fetchedBase, ctx());
    for (const [name, fn] of Object.entries(DET)) {
      let got; assert.doesNotThrow(() => { got = fn(fetched, bl); }, name);
      assert.deepEqual(JSON.parse(JSON.stringify(got ?? null)), JSON.parse(JSON.stringify(fn(fetchedBase, blBase) ?? null)), name + " verdict identical to pre-B1");
    }
    const db = seed(rows);
    const r = await PJ.runForBiz(T, B);
    assert.ok(!r.errors.some((e) => /^detector_/.test(e)), JSON.stringify(r.errors));
    assert.ok(db.read(`tenants/${T}/proactive_digests/${B}`), "a digest was persisted");
  }
});

test("COMPAT-07 alerts runner on B1 docs: no false alert from an omitted field; non-VD docs give the same alerts as pre-B1 docs", async () => {
  const strip = (r) => JSON.parse(JSON.stringify(r, (k, v) => (/At$|^id$|^createdAt$|^timestamp$/.test(k) ? undefined : v)));
  const alertsFor = async (builder, rows, extraDays = []) => {
    const db = seed(rows);
    db.seed(`tenants/${T}/biz:${B}:alertConfig`, { minDailyRevenue: 5000 });
    for (let k = 1; k <= 8; k++) { const d = await builder.buildAnalyticsForBiz(T, B, ago(k)); await builder.saveAnalyticsDoc(d); }
    for (const k of extraDays) { const d = await builder.buildAnalyticsForBiz(T, B, ago(k)); await builder.saveAnalyticsDoc(d); }
    const res = await RUN.runAlertsForBiz(T, B);
    const saved = db.read(`tenants/${T}/alerts`) || db.read(`tenants/${T}/biz:${B}:alerts`) || {};
    return { res: strip(res), saved: strip(saved) };
  };
  const nonVd = nonVdRows(10, 1);
  const a = await alertsFor(DBLD, nonVd), b = await alertsFor(BASE_DB, nonVd);
  assert.deepEqual(a.res.errors, []); assert.deepEqual(a, b, "non-VD: identical alert outcome");
  // a non-VD set that DOES fire (labor and purchases at 50 % of revenue): identical alerts
  const hot = Array.from({ length: 10 }, (_, i) => entry(uid(800 + i), ago(i + 1), { sales: String(REV[i % REV.length]), supplier_payments: { s1: String(REV[i % REV.length] / 2) }, payroll: String(REV[i % REV.length] / 2) }));
  const h1 = await alertsFor(DBLD, hot), h0 = await alertsFor(BASE_DB, hot);
  assert.ok(h1.res.alertsFired > 0, "the fixture fires alerts"); assert.deepEqual(h1, h0, "non-VD firing: identical alerts");
  // omitted fields: purchases-only days (no revenue, no payroll) ⇒ B1 docs omit total/payroll ⇒ every date skipped
  const purchasesOnly = Array.from({ length: 8 }, (_, i) => entry(uid(700 + i), ago(i + 1), { supplier_payments: { s1: "900" } }));
  const c = await alertsFor(DBLD, purchasesOnly);
  assert.deepEqual(c.res.errors, []); assert.equal(c.res.alertsFired, 0, "no alert manufactured from an omitted field");
});

test("COMPAT-08 the API wrapper (api/analytics/daily-builder.ts — B1 leaves it unchanged; the approved P0 Scheduled Auth bytes when integrated): GET summary, manual POST and rebuild_after_entry_save work with B1 docs", async () => {
  const dir = mkdtempSync(join(tmpdir(), "b1-api-"));
  cpSync(srv.dir, dir, { recursive: true });
  cpSync(join(ROOT, "api", "analytics", "daily-builder.ts"), join(dir, "api", "analytics", "daily-builder.ts"), { recursive: true });
  writeFileSync(join(dir, "lib", "verifyToken.js"), `export async function requireAuth(){ return { uid: "u1" }; }\n`);
  writeFileSync(join(dir, "lib", "helpers.js"), `export async function requireTenantAccess(){ return "owner"; }\nexport async function isRateLimited(){ return false; }\n`);
  writeFileSync(join(dir, "lib", "analytics", "sources.js"), `export async function fetchBeecommDaily(){ throw { reason: "offline" }; }\n`);
  const tsc = join(ROOT, "node_modules", "typescript", "bin", "tsc");
  const r = spawnSync("node", [tsc, "--module", "esnext", "--target", "es2022", "--moduleResolution", "bundler", "--skipLibCheck", "--noEmitOnError", "false", join(dir, "api", "analytics", "daily-builder.ts")], { encoding: "utf8" });
  const API = await import(pathToFileURL(join(dir, "api", "analytics", "daily-builder.js")).href).catch((e) => { throw new Error("wrapper compile/import failed: " + e.message + "\n" + r.stdout); });
  const mkRes = () => { const x = { statusCode: 0, body: null, headers: {} }; x.setHeader = (k, v) => { x.headers[k] = v; }; x.status = (c) => { x.statusCode = c; return x; }; x.json = (b) => { x.body = b; return x; }; x.end = () => x; return x; };
  const yesterday = DBLD.yesterdayInIsrael();
  const db = seed([entry(uid(1), yesterday, { sales: "700", supplier_payments: { s1: "100" }, payroll: "50" })]);
  db.seed("proactive_biz_index", { [`${T}_${B}`]: { tenantId: T, bizId: B, active: true } });
  db.seed(`tenants/${T}/app/users`, env([{ firebaseUid: "u1", role: "owner", allowedBizIds: [B] }]));
  // RC 1.0 release assembly: the approved P0 Scheduled Auth commit (05bf5a59) authorizes the cron
  // GET and the operator backfill POST ONLY by `Authorization: Bearer ${CRON_SECRET}` (requireCron)
  // and never by x-vercel-cron. When that lineage is integrated the wrapper bytes must be P0's
  // approved blob, the B1 data path is exercised through the P0 auth (a test-only secret), and the
  // spoofable header alone is proven rejected. Pre-P0 trees keep the original header path.
  const P0 = "05bf5a59cd62bcfde2bc74f3ab0b9d38ba619661", WRAP = "api/analytics/daily-builder.ts";
  const p0In = gitIn(ROOT, ["merge-base", "--is-ancestor", P0, "HEAD"]).status === 0;
  const cronHeaders = p0In ? { authorization: "Bearer compat08-test-cron-secret" } : { "x-vercel-cron": "1" };
  const prevSecret = process.env.CRON_SECRET;
  if (p0In) {
    // M1 R2 (pending independent review) changes ONLY the wrapper's target-identity decision: on an R2 tree the wrapper is
    // held to its literal R2 pin, which R2G-02 re-derives from the P0 bytes by recorded exact edits (auth section unchanged, R2G-03)
    const want = isM1R2Tree(ROOT) ? M1_R2_PINS[WRAP] : gitIn(ROOT, ["rev-parse", `${P0}:${WRAP}`]).stdout.trim();
    assert.equal(gitIn(ROOT, ["hash-object", WRAP]).stdout.trim(), want, "wrapper = approved P0 blob (or the M1 R2 pin)");
    process.env.CRON_SECRET = "compat08-test-cron-secret";
  }
  try {
  if (p0In) {
    const spoof = mkRes(); await API.default({ method: "GET", headers: { "x-vercel-cron": "1" }, query: {}, body: {} }, spoof);
    assert.equal(spoof.statusCode, 401, "P0: x-vercel-cron alone is never authorization");
    const spoofPost = mkRes(); await API.default({ method: "POST", headers: { "x-vercel-cron": "1" }, query: {}, body: { tenantId: T, bizId: B, date: yesterday } }, spoofPost);
    assert.equal(spoofPost.statusCode, 401, "P0: x-vercel-cron alone never authorizes a backfill");
    assert.equal(db.read(`tenants/${T}/biz:${B}:analytics:daily:${yesterday}`), null, "…and nothing was written");
  }
  const get = mkRes(); await API.default({ method: "GET", headers: cronHeaders, query: {}, body: {} }, get);
  assert.equal(get.statusCode, 200); assert.equal(get.body.successCount, 1); assert.equal(get.body.summary[0].revenue_total, 700); assert.equal(get.body.summary[0].had_entry, true);
  const post = mkRes(); await API.default({ method: "POST", headers: cronHeaders, query: {}, body: { tenantId: T, bizId: B, date: yesterday } }, post);
  assert.equal(post.statusCode, 200); assert.equal(post.body.doc.revenue.total, 700); assert.equal(post.body.doc.fin.inActual, true);
  // the post-save rebuild of TODAY (the current day): a non-Actual doc + the empty insights path; readback confirmed
  const asOfToday = (await srv.import("src/finance/businessDate.js")).israelBusinessDate(Date.now());
  const rb = mkRes(); await API.default({ method: "POST", headers: { authorization: "Bearer x" }, query: {}, body: { action: "rebuild_after_entry_save", tenantId: T, bizId: B, date: asOfToday } }, rb);
  assert.equal(rb.statusCode, 200, JSON.stringify(rb.body)); assert.equal(rb.body.ok, true); assert.equal(rb.body.insightCount, 0);
  assert.equal(db.read(`tenants/${T}/biz:${B}:analytics:daily:${asOfToday}`).fin.inActual, false);
  } finally { if (prevSecret === undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = prevSecret; }
});
