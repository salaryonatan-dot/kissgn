import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { compileServer, offlineFetch, makeDb, installDb, seedBusiness } from "../support/server-reader-harness.mjs";
import { asLegacy, entry, uid, importerVerdict, loadConsumerFiles, repoKindOf, validateConsumerFiles } from "../support/b1-fixtures.mjs";

const ROOT = process.cwd();
const read = (file) => readFileSync(join(ROOT, file), "utf8");
const coreImport = /from\s+["'][^"']*\/(?:finance|metrics|policy|presenters|browser)\//;
const serverImport = /from\s+["'][^"']*\/finance-server\//;
function walk(dir) {
  return readdirSync(join(ROOT, dir)).flatMap((name) => {
    const rel = `${dir}/${name}`;
    return statSync(join(ROOT, rel)).isDirectory() ? walk(rel) : [rel];
  });
}

test("ADB05-01 AMEND-02 D/E records own disjoint, existing importers without a finance-server facade", () => {
  assert.equal(existsSync(join(ROOT, "src/finance-server/consumerBoundary.ts")), false);
  const files = loadConsumerFiles(ROOT);
  const result = validateConsumerFiles(files, repoKindOf(ROOT));
  assert.deepEqual(result.errors, []);
  const sources = Object.fromEntries(["index.html", ...walk("api"), ...walk("lib"), ...walk("src")]
    .filter((file) => /\.(?:ts|js|html)$/.test(file)).map((file) => [file, read(file)]));
  const importers = importerVerdict(sources, result);
  assert.deepEqual(importers, { ok: true, unlistedCore: [], unlistedServer: [] });
  const d = JSON.parse(read("test/finance/core-consumers/d.json"));
  const e = JSON.parse(read("test/finance/core-consumers/e.json"));
  assert.equal(d.slice, "D"); assert.equal(e.slice, "E");
  assert.equal(d.consumers.includes("src/agent/proactive/detectors/detectForecastRisk.ts"), true);
  assert.equal(e.consumers.includes("src/agent/proactive/detectors/detectForecastRisk.ts"), false);
  for (const file of [...d.consumers, ...e.consumers]) assert.match(read(file), coreImport, file);
  for (const file of d.serverApiConsumers) assert.match(read(file), serverImport, file);
});

test("ADB05-02 Core decisions and server-API reads remain in separate files", () => {
  for (const file of ["src/agent/financialMonth.ts", "src/alerts/checkers.ts"]) {
    assert.match(read(file), coreImport, file);
    assert.doesNotMatch(read(file), serverImport, file);
  }
  for (const file of ["src/agent/financialMonthSource.ts", "src/alerts/alertMonthReport.ts"]) {
    const src = read(file);
    assert.match(src, serverImport, file);
    assert.doesNotMatch(src, coreImport, file);
    for (const forbidden of [/\bNumber\(/, /\bMath\./, /parseFloat\(/, /Date\.now\(/, /new Date\(/])
      assert.doesNotMatch(src, forbidden, file);
  }
  const service = read("src/services/analyticsService.ts");
  assert.doesNotMatch(service, coreImport);
  assert.equal((service.match(/from\s+["'][^"']*\/finance-server\//g) ?? []).length, 1);
  assert.match(service, /import \{ isCanonicalFinanceError \} from "\.\.\/finance-server\/canonicalMetrics\.js"/);
  const reexport = /export\s+(?:type\s+)?(?:\*|\{[^}]*\})\s+from\s+["'][^"']*\/(?:finance|metrics|policy|presenters|browser)\//;
  for (const file of [...JSON.parse(read("test/finance/core-consumers/d.json")).consumers,
    ...JSON.parse(read("test/finance/core-consumers/e.json")).consumers,
    "src/agent/financialMonthSource.ts", "src/alerts/alertMonthReport.ts", "src/services/analyticsService.ts"])
    assert.doesNotMatch(read(file), reexport, file);
});

offlineFetch();
const srv = compileServer();
const FM = await srv.import("src/agent/financialMonth.js");
const ALERTS = await srv.import("src/alerts/checkers.js");

test("ADB05-03 exact request-window and closure-month boundaries are retained", () => {
  assert.deepEqual(FM.agentRequestWindow("2026-09-29T09:00:00Z", { start: "2026-09-01", end: "2026-09-30" }),
    { asOfBusinessDate: "2026-09-29", actualEnd: "2026-09-28" });
  assert.deepEqual(FM.agentRequestWindow("2026-09-29T09:00:00Z", { start: "2026-08-01", end: "2026-08-31" }),
    { asOfBusinessDate: "2026-09-29", actualEnd: "2026-08-31" });
  assert.deepEqual(FM.agentRequestWindow("invalid", { start: "2026-09-01", end: "2026-09-30" }),
    { asOfBusinessDate: "", actualEnd: "2026-09-30" });
  assert.equal(FM.isFullMonthRequest({ start: "2026-09-01", end: "2026-09-28" }, "2026-09-29"), true);
  assert.equal(FM.isFullMonthRequest({ start: "2026-09-02", end: "2026-09-28" }, "2026-09-29"), false);
  assert.deepEqual(FM.revenueCalendarMonths({ start: "2026-08-27", end: "2026-10-02" }), ["2026-08", "2026-09", "2026-10"]);
  assert.equal(FM.revenueCalendarMonths({ start: "2026-10-02", end: "2026-08-27" }), null);
  assert.equal(FM.revenueCalendarMonths({ start: "2026-01-01", end: "2027-03-01" }), null);
  assert.equal(FM.revenueCalendarMonths({ start: "2026-01-01", end: "2027-02-01" }).length, 14);
});

test("ADB05-04 unreadable config and closure ledger stay unavailable without altering the report", () => {
  const report = { window: { state: "actual", month: "2026-09" } };
  const projection = { state: "available" };
  const source = { month: "2026-09", asOfBusinessDate: "2026-09-29", report, projection,
    config: { state: "unreadable" }, inputIssues: ["config_unreadable"], exceptionsState: "unreadable" };
  const out = FM.assembleAgentFinancialMonth(source);
  assert.equal(out.policy, null);
  assert.equal(out.closureCalendarKnown, false);
  assert.equal(out.report, report);
  assert.equal(out.projection, projection);
  assert.deepEqual(out.inputIssues, ["config_unreadable"]);
  const known = FM.assembleAgentFinancialMonth({ ...source, config: { state: "absent" }, exceptionsState: "absent" });
  assert.notEqual(known.policy, null);
  assert.equal(known.closureCalendarKnown, true);
});

test("ADB05-05 monthly alerts keep exact threshold decisions, D-1 scope, and one clock read", async () => {
  const rows = Array.from({ length: 28 }, (_, i) => entry(uid(i + 1), `2026-09-${String(i + 1).padStart(2, "0")}`,
    { sales: "1000", payroll: "400", supplier_payments: { s1: "300" } }));
  const db = makeDb();
  seedBusiness(db, { entries: asLegacy(rows) });
  installDb(db);
  const originalNow = Date.now;
  let reads = 0;
  Date.now = () => { reads++; return Date.parse("2026-09-29T09:00:00Z"); };
  try {
    const labor = await ALERTS.checkLaborPct("tenantA", "bizA", { laborPctCritical: 40, laborPctMax: 30 });
    assert.equal(reads, 1);
    assert.deepEqual([labor?.severity, labor?.currentValue, labor?.context?.completedThrough], ["critical", 40, "2026-09-28"]);
    const warning = await ALERTS.checkLaborPct("tenantA", "bizA", { laborPctCritical: 41, laborPctMax: 40 });
    assert.equal(warning?.severity, "warning");
    assert.equal(await ALERTS.checkLaborPct("tenantA", "bizA", { laborPctCritical: 41, laborPctMax: 41 }), null);
    const food = await ALERTS.checkFoodCostPct("tenantA", "bizA", { foodCostPctCritical: 30, foodCostPctMax: 25 });
    assert.equal(food?.severity, "critical");
    assert.deepEqual([food?.currentValue, food?.context?.completedThrough], [30, "2026-09-28"]);
    assert.equal(await ALERTS.checkFoodCostPct("tenantA", "bizA", { foodCostPctCritical: Infinity, foodCostPctMax: Infinity }), null);
    const incompleteDb = makeDb();
    seedBusiness(incompleteDb, { entries: asLegacy(rows.slice(1)) });
    installDb(incompleteDb);
    assert.equal(await ALERTS.checkLaborPct("tenantA", "bizA", { laborPctCritical: 30, laborPctMax: 20 }), null,
      "a missing completed day cannot fire a labor-ratio alert");
  } finally {
    Date.now = originalNow;
  }
});
