// Run explicitly: node test/support/m1-resolution-mutations.mjs <absolute log directory>
// M1 integration — behavioral sensitivity of the RESOLVED / auto-merged integration regions. Every mutant is a new
// disposable copy of the working tree (no .git: identity / pin guards cannot run there, so only BEHAVIORAL committed
// tests can detect it). src/ mutants regenerate fincore with the committed generator first; a generator or syntax
// failure is never counted as detection. DETECTED = a targeted committed test reports `not ok` with a non-zero exit.
import { cpSync, mkdtempSync, symlinkSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = fileURLToPath(new URL("../../", import.meta.url));
const out = process.argv[2];
if (!out || !out.startsWith("/")) throw new Error("absolute log directory required");
mkdirSync(out, { recursive: true });
const MIC = "test/finance/m1-integration-contracts.test.mjs";
const cases = [
  // index.html — the three recorded page resolutions
  ["page-inputs-drop-costhistory", "index.html", 'rows: src.rows, config: src.config, fixed: src.fixed, costHistory: src.costHistory || { state: "absent" }, asOfBusinessDate: src.asOf,', "rows: src.rows, config: src.config, fixed: src.fixed, asOfBusinessDate: src.asOf,", [MIC]],
  ["page-inputs-drop-credits", "index.html", "      if (C) inputs.supplierCredits = C;", "      void C;", [MIC, "test/finance/p1-browser-credits.test.mjs"]],
  ["page-inputs-credits-loading-ignored", "index.html", '      if (C && C.state === "loading") return { status: "loading", reason: "supplier_credits" };', "", ["test/finance/p1-browser-credits.test.mjs"]],
  ["page-finsrc-drop-credits", "index.html", "costHistory, asOf: finAsOf, ledger, rowsReady: finRowsReady, credits };", "costHistory, asOf: finAsOf, ledger, rowsReady: finRowsReady };", ["test/finance/f1-r4-page-binding.test.mjs", "test/finance/p1-browser-credits.test.mjs"]],
  ["page-finsrc-unbound-history", "index.html", "finF.costHistory.codec.decodeHistory({ exists: raw.costHistory.kind !== \"absent\", value: raw.costHistory.raw }, histBind.bind)", "finF.costHistory.codec.decodeHistory({ exists: raw.costHistory.kind !== \"absent\", value: raw.costHistory.raw }, { tenantId: finSel.tenantId, bizId: currentBizId })", ["test/finance/f1-r4-page-binding.test.mjs"]],
  // M1 R1: no longer claimed equivalent — PBR1-01 (key ⇔ bind coherence) detects it; PBR1-02 records why the two bindings
  // never differ on a ready node in a reachable state (test/finance/m1-r1-page-credit-binding.test.mjs)
  ["page-finsrc-credits-unbound", "index.html", "finSel && finSel.tenantId && finSel.bizId ? { tenantId: finSel.tenantId, bizId: finSel.bizId } : null) : { state: \"not_loaded\" };", "{ tenantId: finSel.tenantId, bizId: currentBizId }) : { state: \"not_loaded\" };", ["test/finance/m1-r1-page-credit-binding.test.mjs", "test/finance/f1-r4-page-binding.test.mjs", "test/finance/p1-browser-credits.test.mjs"]],
  ["page-bootstrap-drop-costh-check", "index.html", '          v.costHistory !== "MARJIN_COSTH/6" || ', "          ", ["test/finance/f1-r4-page-binding.test.mjs"]],
  ["page-bootstrap-product-identity", "index.html", 'v.product !== "MARJIN_PRODUCT/3"', 'v.product !== "MARJIN_PRODUCT/2"', ["test/finance/c1-browser-surfaces.test.mjs", "test/finance/p1-browser-credits.test.mjs"]],
  // server loader — union of both reads
  ["server-drop-credits-read", "src/finance-server/canonicalInputs.ts", "const supplierCredits: SupplierCreditsState = decodeSupplierCredits(creditsSnap.val(), { tenantId, bizId });", "const supplierCredits: SupplierCreditsState = decodeSupplierCredits(null, { tenantId, bizId }); void creditsSnap;", [MIC, "test/finance/p1-supplier-credits-server.test.mjs"]],
  ["server-drop-history-read", "src/finance-server/canonicalInputs.ts", "const needHistory = opts.need.costHistory === undefined ? opts.need.config || opts.need.fixed : opts.need.costHistory;", "const needHistory = false;", [MIC, "test/finance/f1-r4-review-lifecycle.test.mjs"]],
  ["server-credits-unbound", "src/finance-server/canonicalInputs.ts", "decodeSupplierCredits(creditsSnap.val(), { tenantId, bizId })", "decodeSupplierCredits(creditsSnap.val(), creditsSnap.val() && creditsSnap.val().tenantId ? { tenantId: creditsSnap.val().tenantId, bizId: creditsSnap.val().bizId } : { tenantId, bizId })", [MIC, "test/finance/p1-supplier-credits-server.test.mjs"]],
  // browser global — union of both finance members
  ["global-drop-supplierCredits", "src/browser/marjinFinanceGlobal.ts", "labor, canonical, supplierCredits }),", "labor, canonical }),", ["test/finance/p1-browser-credits.test.mjs", MIC]],
  ["global-drop-canonical", "src/browser/marjinFinanceGlobal.ts", "labor, canonical, supplierCredits }),", "labor, supplierCredits }),", ["test/finance/f1-r4-canonical.test.mjs"]],
  // auto-merged report: VD-50 over net purchases
  ["report-vd50-on-gross", "src/metrics/report.ts", "    () => ratSub(ratSub(known(revenue.rat, \"revenue\"), known(purchases.rat, \"purchases\")),\n      ratAdd(known(hourly.rat, \"hourly_employer_cost\"), accrual.global)),", "    () => ratSub(ratSub(known(revenue.rat, \"revenue\"), known(grossTotal.rat, \"purchases\")),\n      ratAdd(known(hourly.rat, \"hourly_employer_cost\"), accrual.global)),", [MIC]],
  ["report-vd50-ignores-credit-issues", "src/metrics/report.ts", "  const grossIssues = [...revenueIssues, ...purchaseIssues, ...laborIssues];", "  const grossIssues = [...revenueIssues, ...laborIssues];", [MIC]],
];
const result = [];
for (const [id, file, from, to, tests, equivalent] of cases) {
  const dir = mkdtempSync(join(tmpdir(), `m1-rm-${id}-`));
  cpSync(root, dir, { recursive: true, filter: (p) => ![".git", "node_modules", ".deps"].includes(p.split("/").at(-1)) });
  symlinkSync(join(root, "node_modules"), join(dir, "node_modules"), "dir");
  const path = join(dir, file), before = readFileSync(path, "utf8");
  if (before.split(from).length !== 2) { result.push({ id, verdict: "ANCHOR_MISSING" }); continue; }
  writeFileSync(path, before.replace(from, to));
  let gen = { status: 0, stdout: "", stderr: "" };
  if (file.startsWith("src/")) gen = spawnSync(process.execPath, ["tools/finance-core/gen-browser.mjs"], { cwd: dir, encoding: "utf8" });
  if (gen.status !== 0) { writeFileSync(join(out, `${id}.gen.log`), gen.stdout + gen.stderr); result.push({ id, verdict: "BUILD_FAILED (not counted)" }); continue; }
  const run = spawnSync(process.execPath, ["--test", "--test-reporter=tap", ...tests], { cwd: dir, encoding: "utf8", maxBuffer: 1 << 28, timeout: 900000 });
  const tap = run.stdout + run.stderr;
  writeFileSync(join(out, `${id}.tap`), tap);
  const notOk = (tap.match(/^not ok \d+ - .*/gm) || []).filter((l) => !/ - test\/finance\//.test(l));
  const syntax = /SyntaxError|ReferenceError: .* is not defined at .*gen-browser/.test(tap);
  const verdict = run.status !== 0 && notOk.length > 0 && !syntax ? "DETECTED" : syntax ? "SYNTAX (not counted)" : equivalent ? "NOT_DETECTED (documented equivalent)" : "NOT_DETECTED";
  result.push({ id, file, tests, verdict, ...(equivalent ? { equivalent } : {}), failing: notOk.map((l) => l.replace(/^not ok \d+ - /, "").slice(0, 140)) });
}
writeFileSync(join(out, "summary.json"), JSON.stringify(result, null, 1));
for (const r of result) console.log(`${r.id.padEnd(38)} ${r.verdict}  ${(r.failing || []).length} failing`);
if (result.some((r) => r.verdict !== "DETECTED" && r.verdict !== "NOT_DETECTED (documented equivalent)")) process.exitCode = 1;
