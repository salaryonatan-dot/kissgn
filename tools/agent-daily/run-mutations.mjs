// Focused, disposable source mutations. Each runs the committed consumer tests
// against a copied tree; the real worktree is never changed.
import { mkdtempSync, cpSync, readFileSync, writeFileSync, symlinkSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const mutations = [
  { id: "legacy-mean-food-ratio", path: "src/agent/analysis/analyzeDirectMetric.ts", test: "consumer-migration.test.mjs",
    expectedTest: "period Food Cost uses",
    before: '`שיעור עלות מזון לתקופה: ${formatPercent(month.report.actual.purchasesPct)}`;',
    after: '`שיעור עלות מזון לתקופה: ${formatPercent(String(avg(daily.filter((d) => d.foodCostPct != null).map((d) => d.foodCostPct!))))}`;' },
  { id: "drop-supplier-credits", path: "src/agent/analysis/analyzeDirectMetric.ts", test: "consumer-migration.test.mjs",
    expectedTest: "period Food Cost uses",
    before: "const purchases = month.report.actual.purchases;", after: "const purchases = { ...month.report.actual.purchases, value: month.report.actual.purchases.gross.value };" },
  { id: "include-current-day", path: "src/agent/financialMonth.ts", test: "consumer-migration.test.mjs",
    expectedTest: "manual Actual remains",
    before: 'site: "agent.financialMonth", nowMs,', after: 'site: "agent.financialMonth", nowMs: nowMs + 86_400_000,' },
  { id: "partial-as-complete", path: "src/agent/validation/validateData.ts", test: "consumer-migration.test.mjs",
    expectedTest: "partial purchases",
    before: "month.report.actual.purchases.complete && month.report.actual.purchases.value", after: "true && month.report.actual.purchases.value" },
  { id: "unavailable-as-zero", path: "src/agent/financialMonth.ts", test: "consumer-migration.test.mjs",
    expectedTest: "period Food Cost uses",
    before: 'if (ratio.state !== "value" || ratio.value === undefined) return null;', after: 'if (ratio.state !== "value" || ratio.value === undefined) return 0;' },
  { id: "divergent-threshold", path: "src/alerts/types.ts", test: "consumer-migration.test.mjs",
    expectedTest: "alert compatibility defaults",
    before: 'laborPctMax: Number(COMPATIBILITY_PRODUCT_DEFAULTS["alert.laborPctMax"].value),', after: "laborPctMax: 31," },
  { id: "missing-day-as-complete", path: "src/agent/financialMonth.ts", test: "consumer-migration.test.mjs",
    expectedTest: "daily revenue conclusions require",
    before: 'if (open.length === 0 || open.some((date) => !byDate.has(date))) return null;',
    after: 'if (open.length === 0) return null;' },
  { id: "percentage-points-as-relative", path: "src/agent/proactive/detectors/detectLaborInefficiency.ts", test: "consumer-migration.test.mjs",
    expectedTest: "labor amount, relative deviation",
    before: 'deviationPct: ((ratio - warning) / warning) * 100,', after: 'deviationPct: ratio - warning,' },
  { id: "closed-month-forecast-as-current", path: "src/agent/analysis/analyzeForecast.ts", test: "consumer-migration.test.mjs",
    expectedTest: "partial purchases, unsupported period",
    before: 'month?.report.window.kind !== "open_month" ||', after: 'false ||' },
  { id: "closure-counted-as-operating-zero", path: "src/agent/financialMonth.ts", test: "consumer-migration.test.mjs",
    expectedTest: "real planner reaches D-1 amounts",
    before: 'const open = expected.filter((date) => !closed.has(date));', after: 'const open = expected;' },
  { id: "current-month-planner-refused", path: "src/agent/financialMonth.ts", test: "consumer-migration.test.mjs",
    expectedTest: "real planner reaches D-1 amounts",
    before: 'range.end >= month.asOfBusinessDate && range.end <= monthBounds(window.month).last', after: 'false' },
  { id: "complete-amount-withheld-with-ratio", path: "src/agent/analysis/analyzeDirectMetric.ts", test: "consumer-migration.test.mjs",
    expectedTest: "real planner reaches D-1 amounts",
    before: 'if (!purchases.complete || purchases.value === null) {', after: 'if (!purchases.complete || purchases.value === null || ratio === null) {' },
  { id: "raw-rational-forecast", path: "src/agent/analysis/analyzeForecast.ts", test: "consumer-migration.test.mjs",
    expectedTest: "real planner reaches D-1 amounts",
    before: 'formatShekel(forecast.projectedRevenue)', after: '`₪${forecast.projectedRevenue}`' },
  { id: "duplicate-forecast-risk", path: "src/agent/proactive/runProactiveJob.ts", test: "daily-flow.test.mjs",
    expectedTest: "real analyzer source",
    before: 'result.type !== "forecast_risk" || !detectorResults.some', after: 'true || !detectorResults.some' },
  { id: "self-referential-revenue-baseline", path: "src/agent/proactive/detectors/detectDailyRevenueUnderperformance.ts", test: "consumer-migration.test.mjs",
    expectedTest: "today is excluded and the evaluated revenue day",
    before: 'const baselineValues = revenues.slice(0, -1);', after: 'const baselineValues = revenues;' },
];

let uncaught = 0;
for (const m of mutations) {
  const dir = mkdtempSync(join(tmpdir(), "agent-daily-mut-"));
  try {
    for (const part of ["src", "lib", "test", "tools", "fincore"]) cpSync(join(root, part), join(dir, part), { recursive: true });
    cpSync(join(root, "package.json"), join(dir, "package.json"));
    symlinkSync(realpathSync(join(root, "node_modules")), join(dir, "node_modules"), "dir");
    const file = join(dir, m.path);
    const source = readFileSync(file, "utf8");
    if (source.split(m.before).length !== 2) throw new Error(`mutation target not unique: ${m.id}`);
    writeFileSync(file, source.replace(m.before, m.after));
    const run = spawnSync(process.execPath, ["--test", "--test-reporter=spec", join(dir, "test/agent-daily", m.test)], {
      cwd: dir, encoding: "utf8", maxBuffer: 16 * 1024 * 1024,
    });
    const output = run.stdout + run.stderr;
    const detected = run.status !== 0 && output.includes(`✖ ${m.expectedTest}`);
    if (!detected) uncaught++;
    process.stdout.write(`${m.id}: ${detected ? "CAUGHT" : "UNCAUGHT"} (exit ${run.status})\n`);
    if (!detected) process.stdout.write(output.slice(0, 500) + "\n");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
process.exitCode = uncaught ? 1 : 0;
