// Financial Core Slice A — structural guards: G-B1 artifact regeneration, G-B2 zero
// runtime consumers, G-S1 exactness/no-VAT scan, G-S2 import graph, G-S3 presence from
// state only, G-S4 required purchase basis, G-A1 legacy adapter shape, G-M1 consumer
// manifest coverage (file-level, enforcing; line-level stays report-only until Slice E).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, sep } from "node:path";
import { REPO, loadCompiled } from "../support/fincore-load.mjs";
import { closureSources, generate } from "../../tools/finance-core/gen-browser.mjs";

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

test("G-B2 Slice A has zero runtime consumers (index.html, api, lib and non-core src do not load the core)", () => {
  assert.doesNotMatch(readFileSync(join(REPO, "index.html"), "utf8"), /fincore|MarjinFinance/);
  const others = [...walk("api"), ...walk("lib"), ...walk("src")].filter((f) => /\.(ts|js)$/.test(f) && !CORE_DIRS.some((d) => f.startsWith(d + "/")));
  for (const f of others) {
    const src = readFileSync(join(REPO, f), "utf8");
    assert.doesNotMatch(src, /from\s+["'][^"']*\/(finance|metrics|policy|presenters|browser)\/[^"']*["']/, f + " imports the Financial Core (consumer slices only)");
    assert.doesNotMatch(src, /fincore/, f);
  }
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
      assert.ok(allowed[layer].some((d) => target.startsWith(d + "/")), `${f} → ${target} breaks layering`);
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

test("G-S4 computePeriodReport has no caller that could omit the purchase basis (Slice A: no callers)", () => {
  const files = [...walk("api"), ...walk("lib"), ...walk("src")].filter((f) => /\.(ts|js)$/.test(f) && f !== "src/metrics/report.ts" && f !== "src/browser/marjinFinanceGlobal.ts");
  for (const f of files) assert.doesNotMatch(readFileSync(join(REPO, f), "utf8"), /computePeriodReport\(/, f);
  const src = readFileSync(join(REPO, "src/metrics/report.ts"), "utf8");
  assert.match(src, /purchaseBasis: unknown,\n\s*window: ReportWindow/, "purchaseBasis is a positional required parameter without default");
});

test("G-A1 legacy DailyMetric adapter keeps the consumer shape and adds presence/basis", async () => {
  const F = await loadCompiled();
  const types = readFileSync(join(REPO, "src/agent/types/analytics.ts"), "utf8");
  const block = types.slice(types.indexOf("interface DailyMetric"), types.indexOf("}", types.indexOf("interface DailyMetric")));
  const fields = [...block.matchAll(/^\s*(\w+):/gm)].map((m) => m[1]);
  assert.ok(fields.length >= 6, "DailyMetric fields found");
  const n = F.finance.normalize.normalizeRows([{ id: "a", date: "2026-09-01", sales: "100" }], { asOfBusinessDate: "2026-09-01" });
  const [day] = F.finance.normalize.groupByDate(n.rows, { from: "2026-09-01", to: "2026-09-01" });
  const dm = F.metrics.adapters.legacyNumber.toDailyMetric(day, F.finance.purchaseBasis.resolvePurchaseBasis([], F.policy.purchaseBasis.productPurchaseBasis()));
  for (const k of fields) assert.ok(k in dm, "DailyMetric field " + k);
  assert.equal(dm.purchaseBasis, "net_of_vat");
  assert.equal(dm.purchaseBasisCompat, false);
  assert.equal(dm.foodCostPct, null, "absent purchases ⇒ null ratio, not 0");
  assert.deepEqual(dm.presence, { day: "present", revenue: "present", purchases: "absent", directLabor: "absent", otherExpense: "absent" });
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
