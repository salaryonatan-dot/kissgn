// Financial Core Slice A — structural guards: G-B1 artifact regeneration, G-B2 zero
// runtime consumers, G-S1 exactness/no-VAT scan, G-S2 import graph, G-S3 presence from
// state only, G-S4 required purchase basis, G-A1 legacy adapter shape, G-M1 consumer
// manifest coverage (file-level, enforcing; line-level stays report-only until Slice E).
// Financial Core B1: G-B2 is data-driven (AMEND-02: the union of test/finance/core-consumers/*.json);
// G-S2 gains exactly one edge (productFinance → revenueForecast, AMEND-04); G-S4 allows one
// runtime caller (src/policy/productFinance.ts, AMEND-01) with the product basis/source bound.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, sep } from "node:path";
import { REPO, loadCompiled } from "../support/fincore-load.mjs";
import { closureSources, generate } from "../../tools/finance-core/gen-browser.mjs";
import { importerVerdict, loadConsumerFiles, repoKindOf, validateConsumerFiles } from "../support/b1-fixtures.mjs";

const CORE_DIRS = ["src/finance", "src/metrics", "src/policy", "src/presenters", "src/browser"];

function walk(dir, base = REPO) {
  const out = [];
  for (const name of readdirSync(join(base, dir)).sort()) {
    const rel = dir + "/" + name;
    if (statSync(join(base, rel)).isDirectory()) out.push(...walk(rel, base));
    else out.push(rel);
  }
  return out;
}

function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").map((l) => {
    let inStr = null;
    for (let i = 0; i < l.length; i += 1) {
      const ch = l[i];
      if (inStr) { if (ch === "\\") i += 1; else if (ch === inStr) inStr = null; continue; }
      if (ch === '"' || ch === "'" || ch === "`") { inStr = ch; continue; }
      if (ch === "/" && l[i + 1] === "/") return l.slice(0, i);
    }
    return l;
  }).join("\n");
}

const coreFiles = CORE_DIRS.flatMap((d) => walk(d)).filter((f) => f.endsWith(".ts"));

test("G-B1 committed fincore/v1 is byte-identical to a fresh deterministic generation", () => {
  const tmp = mkdtempSync(join(tmpdir(), "fincore-regen-"));
  const manifest = generate({ repo: REPO, outDir: tmp });
  const committed = walk("fincore/v1");
  const fresh = walk(".", tmp).map((p) => "fincore/v1/" + p.replace(/^\.\//, ""));
  assert.deepEqual(committed, fresh.sort(), "same file set");
  for (const rel of committed) {
    const a = readFileSync(join(REPO, rel));
    const b = readFileSync(join(tmp, rel.slice("fincore/v1/".length)));
    assert.ok(a.equals(b), rel + " differs from regenerated output — run node tools/finance-core/gen-browser.mjs");
  }
  assert.equal(manifest.typescript, "5.9.3", "pinned compiler");
  assert.deepEqual(manifest.sources, closureSources(REPO));
});

test("G-B1b the browser closure is exactly the core directories plus the forecast engine", () => {
  const closure = closureSources(REPO);
  for (const f of closure) assert.ok(CORE_DIRS.some((d) => f.startsWith(d + "/")) || f === "src/forecast/revenueForecast.ts", f);
  for (const f of coreFiles) assert.ok(closure.includes(f), "core file not reachable from the browser entry: " + f);
});

test("G-B2 core consumers are exactly the per-slice allowlists (AMEND-02: union of test/finance/core-consumers/*.json)", () => {
  const v = validateConsumerFiles(loadConsumerFiles(REPO), repoKindOf(REPO));
  assert.deepEqual(v.errors, [], "core-consumer allowlist files are valid");
  const sources = {};
  for (const f of ["index.html", ...walk("api"), ...walk("lib"), ...walk("src")].filter((x) => /\.(ts|js|html)$/.test(x))) sources[f] = readFileSync(join(REPO, f), "utf8");
  const verdict = importerVerdict(sources, v);
  assert.deepEqual(verdict.unlistedCore, [], "files loading the Financial Core must be listed as `consumers` of a slice");
  assert.deepEqual(verdict.unlistedServer, [], "files importing src/finance-server must be listed as `serverApiConsumers` of a slice");
});

test("G-S1 core arithmetic is exact: no binary math, clock reads or VAT constants", () => {
  const forbidden = [/Math\./, /\.toFixed\(/, /parseFloat/, /parseInt/, /Date\.now/, /new Date\(/, /1\.18/, /VAT_RATE/, /\bvat\w*\s*[*/]|[*/]\s*vat/i];
  for (const f of coreFiles) {
    const code = stripComments(readFileSync(join(REPO, f), "utf8"));
    for (const re of forbidden) assert.doesNotMatch(code, re, `${f} matches ${re}`);
    if (f !== "src/metrics/adapters/legacyNumber.ts") assert.doesNotMatch(code, /\bNumber\(/, f + " converts to binary outside the legacy adapter");
  }
});

test("G-S2 import graph respects the layering (finance ← metrics ← policy/presenters/browser)", () => {
  const allowed = {
    "src/finance": ["src/finance"],
    "src/metrics": ["src/finance", "src/metrics"],
    "src/policy": ["src/finance", "src/metrics", "src/policy"],
    // AMEND-04: exactly one cross-layer edge (the engine is already in the browser closure)
    "src/presenters": ["src/finance", "src/presenters"],
    "src/browser": ["src/finance", "src/metrics", "src/policy", "src/presenters", "src/forecast"],
  };
  for (const f of coreFiles) {
    const layer = CORE_DIRS.find((d) => f.startsWith(d + "/"));
    const src = readFileSync(join(REPO, f), "utf8");
    for (const m of src.matchAll(/(?:import|export)\s[^;]*?from\s+["']([^"']+)["']/g)) {
      const spec = m[1];
      assert.ok(spec.startsWith("."), `${f} imports a bare/node module ${spec}`);
      const target = join(dirname(f), spec).split(sep).join("/");
      const edge = f === "src/policy/productFinance.ts" && target === "src/forecast/revenueForecast.js";
      assert.ok(edge || allowed[layer].some((d) => target.startsWith(d + "/")), `${f} → ${target} breaks layering`);
    }
  }
  for (const f of walk("tools/storage-v2")) assert.doesNotMatch(readFileSync(join(REPO, f), "utf8"), /src\/(finance|metrics)|fincore/, "verification oracle must stay independent: " + f);
});

test("G-S3 presence is derived from input state only (no magnitude tests in normalization/report)", () => {
  for (const f of ["src/finance/normalize.ts", "src/metrics/report.ts"]) {
    const code = stripComments(readFileSync(join(REPO, f), "utf8"));
    assert.doesNotMatch(code, /(?:===|!==|==|!=|>=|<=|>|<)\s*0(?![\d.xn])/, f + " compares with numeric 0");
    assert.doesNotMatch(code, /\b0\s*(?:===|!==|<|>)/, f + " compares with numeric 0");
    assert.doesNotMatch(code, /\|\|\s*0(?![\d.xn])/, f + " defaults a value to 0");
  }
});

test("G-S4 computePeriodReport / toDailyMetric have ONE runtime caller (src/policy/productFinance.ts) with the product basis and labor source bound", () => {
  const CALLER = "src/policy/productFinance.ts";
  const defs = { computePeriodReport: "src/metrics/report.ts", toDailyMetric: "src/metrics/adapters/legacyNumber.ts" };
  const files = [...walk("api"), ...walk("lib"), ...walk("src")].filter((f) => /\.(ts|js)$/.test(f) && f !== CALLER && f !== "src/browser/marjinFinanceGlobal.ts");
  for (const [fn, def] of Object.entries(defs)) {
    const re = new RegExp(fn + "\\(");
    for (const f of files) if (f !== def) assert.doesNotMatch(stripComments(readFileSync(join(REPO, f), "utf8")), re, f + " calls " + fn);
  }
  const caller = stripComments(readFileSync(join(REPO, CALLER), "utf8"));
  const reportCalls = [...caller.matchAll(/computePeriodReport\(([^;]*)/g)];
  assert.equal(reportCalls.length, 1, "exactly one computePeriodReport call");
  assert.match(reportCalls[0][1], /^days, productTimeline\(inputs\), productPurchaseBasis\(\), productLaborSource\(\),/, "basis and labor source are the bound product policies");
  const dailyCalls = [...caller.matchAll(/toDailyMetric\(([^;]*)/g)];
  assert.equal(dailyCalls.length, 1, "exactly one toDailyMetric call");
  assert.match(dailyCalls[0][1], /^day, basis, productLaborSource\(\), timeline,/);
  assert.match(caller, /const basis = resolvePurchaseBasis\([^;]*productPurchaseBasis\(\)\);/, "the daily basis resolves from the bound product policy");
  assert.match(caller, /operatingCalendar: NO_DECLARED_CLOSURES/, "no closure is inferred");
  const src = readFileSync(join(REPO, "src/metrics/report.ts"), "utf8");
  assert.match(src, /purchaseBasis: unknown,\n\s*laborSource: unknown,\n\s*window: ReportWindow/, "purchaseBasis and laborSource are positional required parameters without default");
});

test("G-A1 legacy DailyMetric adapter keeps the consumer shape and adds presence/basis", async () => {
  const F = await loadCompiled();
  const types = readFileSync(join(REPO, "src/agent/types/analytics.ts"), "utf8");
  const block = types.slice(types.indexOf("interface DailyMetric"), types.indexOf("}", types.indexOf("interface DailyMetric")));
  const fields = [...block.matchAll(/^\s*(\w+):/gm)].map((m) => m[1]);
  assert.ok(fields.length >= 6, "DailyMetric fields found");
  const n = F.finance.normalize.normalizeRows([{ id: "a", date: "2026-09-01", sales: "100" }], { asOfBusinessDate: "2026-09-01" });
  const [day] = F.finance.normalize.groupByDate(n.rows, { from: "2026-09-01", to: "2026-09-01" });
  const dm = F.metrics.adapters.legacyNumber.toDailyMetric(day, F.finance.purchaseBasis.resolvePurchaseBasis([], F.policy.purchaseBasis.productPurchaseBasis()), F.policy.laborSource.productLaborSource(), F.metrics.adapters.configCompat.costTimelineFromCurrentConfig({}, []), { asOfBusinessDate: "2026-09-02" });
  for (const k of fields) assert.ok(k in dm, "DailyMetric field " + k);
  assert.equal(dm.purchaseBasis, "net_of_vat");
  assert.equal(dm.purchaseBasisCompat, false);
  assert.equal(dm.foodCostPct, null, "absent purchases ⇒ null ratio, not 0");
  assert.deepEqual(dm.presence, { day: "present", revenue: "present", purchases: "absent", hourlyLabor: "absent", otherExpense: "absent" });
  assert.deepEqual([dm.laborCost, dm.laborCostComplete, dm.hourlyLaborCost, dm.globalLaborCost], [0, false, 0, 0], "hourly absent ⇒ daily labor not complete (0 only for old readers)");
});

test("G-M1 consumer manifest covers every runtime file with financial terms (file level)", () => {
  const manifest = JSON.parse(readFileSync(join(REPO, "test/finance/consumer-manifest.json"), "utf8"));
  const covered = new Set(manifest.entries.map((e) => e.file));
  const ids = manifest.entries.map((e) => e.id);
  assert.equal(new Set(ids).size, ids.length, "manifest ids are unique");
  for (const e of manifest.entries) assert.ok(["MIGRATE", "DERIVE", "POLICY", "RETIRE", "RETAIN"].some((d) => e.disposition.startsWith(d) || e.disposition.includes(d)), e.id);
  const re = /\b(sales|deliveries|other_income|food_cost|supplier_payments|hourly_payroll|payroll|monthlySalary|foodCostPct|laborPct|laborCost|foodCost|revenue|totalSales)\b/;
  const files = ["index.html", ...walk("api"), ...walk("lib"), ...walk("src")]
    .filter((f) => /\.(ts|js|html)$/.test(f) && !f.endsWith(".d.ts") && !CORE_DIRS.some((d) => f.startsWith(d + "/")));
  const uncovered = files.filter((f) => re.test(readFileSync(join(REPO, f), "utf8")) && !covered.has(f));
  assert.deepEqual(uncovered, [], "financial files missing from test/finance/consumer-manifest.json");
  for (const f of covered) assert.ok(files.includes(f), "manifest names a file that does not exist: " + f);
});
