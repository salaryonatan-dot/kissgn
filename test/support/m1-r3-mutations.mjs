// Run explicitly: node test/support/m1-r3-mutations.mjs <absolute log directory> [--rendered] [mutant-id]
// M1 R3 remediation — behavioural sensitivity of the R3 changes. Each mutant reintroduces one defect of the R2 review (or
// breaks a valid-data control) in a NEW disposable copy WITHOUT .git, so no identity / pin / scope guard can count as the
// catch (the R3G / R2G / B2G guards skip or are not run). A targeted COMMITTED behavioural test must report `not ok` with a
// non-zero exit; a syntax failure is never counted. With --rendered, the mutants that carry rendered expectations are also
// run through the REAL rendered page over the local RTDB emulator (test/emulator/m1-rendered-integration.mjs through the
// own-PID runner) and are DETECTED there only when one of the listed RM cases FAILS. No network, no hosted access.
import { cpSync, mkdtempSync, symlinkSync, readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = fileURLToPath(new URL("../../", import.meta.url));
const args = process.argv.slice(2);
const out = args[0], rendered = args.includes("--rendered"), only = args.slice(1).find((a) => !a.startsWith("--"));
if (!out || !out.startsWith("/")) throw new Error("absolute log directory required");
mkdirSync(out, { recursive: true });
const PAGE = "index.html", NIGHT = "src/analytics/dailyBuilder.ts";
const PR3 = "test/finance/m1-r3-page-registry.test.mjs", PBR2 = "test/finance/m1-r2-page-registry.test.mjs";
const NR3 = "test/analytics/m1-r3-nightly-registry.test.mjs", DBR2 = "test/analytics/m1-r2-daily-builder-registry.test.mjs";
const between = (s, a, b) => { const i = s.indexOf(a), j = s.indexOf(b, i); if (i < 0 || j < 0) throw new Error("region " + a); return s.slice(i, j + b.length); };
const R2_SETUP_WRITE = '    const updatedBizList = [...businesses.filter(b=>b.id!==bizId), {id:bizId, name:bizName}];\n    setBusinesses(updatedBizList);\n    try { await window.storage.set("app-businesses", JSON.stringify(updatedBizList), true); } catch(e){ console.error("[setup] businesses save failed:", e.message); }\n';

// [id, defect class, file, edits: [[from, to]] | fn, unit tests, rendered RM cases expected to FAIL]
const cases = [
  // ── defect class A: first-business setup exposed over an existing malformed registry (review R2-01) ──
  ["pg-no-business-as-ready", "setup exposed over a malformed registry", PAGE,
    [['      if (view.selectable.length === 0) return { state: "unreadable", reason: "registry_no_business" };\n', ""]], [PR3], ["RM3-01", "RM3-02"]],
  ["pg-eligible-unconditionally", "setup exposed over a malformed registry", PAGE,
    [['      if (registryState === "unknown" || registryState === "absent" || registryState === "empty") return true;', "      return true;"]], [PR3], []],
  // ── defect class B: an actual unsafe setup completion / write ──
  ["pg-setup-blind-whole-node-write", "unsafe setup completion write", PAGE,
    (s) => s.replace(between(s, "    const expectedBizList = businesses;\n", '    setBizRegistry({ state: "ready" });\n'), R2_SETUP_WRITE), [PR3], ["RM3-09", "RM3-10"]],
  ["pg-cas-no-compare", "unsafe setup completion write", PAGE,
    [['      if (JSON.stringify(view.list) !== JSON.stringify(expected)) return { ok: false, reason: "registry_changed" };\n', ""]], [PR3], ["RM3-10"]],
  ["pg-cas-malformed-replaced", "unsafe setup completion write", PAGE,
    [['      if (view.state === "unreadable") return { ok: false, reason: view.reason };\n      if (JSON.stringify(view.list) !== JSON.stringify(expected)) return { ok: false, reason: "registry_changed" };\n',
      '      if (view.state === "unreadable") view = { list: expected };\n      if (JSON.stringify(view.list) !== JSON.stringify(expected)) return { ok: false, reason: "registry_changed" };\n']], [PR3], ["RM3-09"]],
  // ── defect class D: financial page output from a server-unreadable registry (review R2-03) ──
  ["pg-raw-array-as-list", "page figures from a server-unreadable registry", PAGE,
    [['      if (node === null || node === undefined) return { state: "absent", list: [], selectable: [] };\n',
      '      if (node === null || node === undefined) return { state: "absent", list: [], selectable: [] };\n      if (Array.isArray(node)) node = { _v: JSON.stringify(node) };\n']], [PR3], ["RM3-03", "RM3-04"]],
  ["pg-json-text-read", "page figures from a server-unreadable registry", PAGE,
    [['      try { node = await window.storage.getNode("app-businesses"); registryLoad = "read"; }',
      '      try { const rb = await window.storage.get("app-businesses", true); node = { _v: rb.value }; registryLoad = "read"; }']], [PR3], ["RM3-03", "RM3-04"]],
  // ── defect class C: nightly persistence from an unsupported raw-array registry (review R2-02) ──
  ["nt-raw-array-persisted", "nightly persistence from a raw-array registry", NIGHT,
    [["        const decoded = decodeRegistryNode(node);", "        const decoded = decodeRegistryNode(Array.isArray(node) ? { _v: JSON.stringify(node) } : node);"],
     ["          const state = classifyRegistryTarget(node, id).state;", "          const state = classifyRegistryTarget(Array.isArray(node) ? { _v: JSON.stringify(node) } : node, id).state;"],
     ["  const target = resolveRegistryTarget(businessSnap.val(), bizId);", "  const target = resolveRegistryTarget(Array.isArray(businessSnap.val()) ? { _v: JSON.stringify(businessSnap.val()) } : businessSnap.val(), bizId);"]], [NR3], []],
  ["nt-discovery-lenient-only", "nightly persistence from a raw-array registry (discovery layer)", NIGHT,
    [["        const decoded = decodeRegistryNode(node);", "        const decoded = decodeRegistryNode(Array.isArray(node) ? { _v: JSON.stringify(node) } : node);"],
     ["          const state = classifyRegistryTarget(node, id).state;", "          const state = classifyRegistryTarget(Array.isArray(node) ? { _v: JSON.stringify(node) } : node, id).state;"]], [NR3], []],
  ["nt-build-recheck-dropped", "nightly persistence from a raw-array registry (build layer)", NIGHT,
    [["buildAnalyticsForBiz(tenantId, bizId, date, { requireRegistered: true })", "buildAnalyticsForBiz(tenantId, bizId, date)"]], [NR3], []],
  ["nt-registry-failures-dropped", "inaccurate failure reporting", NIGHT, [["  failures.push(...registryFailures);\n", ""]], [NR3], []],
  ["nt-discovery-failure-clean", "inaccurate failure reporting", NIGHT,
    [['    reportRegistryFailure({ tenantId: null, bizId: null, error: "business_discovery_failed" });\n', ""]], [NR3], []],
  ["nt-no-valid-record-clean", "inaccurate failure reporting", NIGHT,
    [['          reportRegistryFailure({ tenantId, bizId: null, error: "business_registry_no_valid_record" });\n', ""]], [NR3], []],
  ["nt-padded-id-trimmed", "padded / coercion-only identity", NIGHT,
    [["          if (!isExactNightlyBizId(id)) {", "          if (false) {"]], [NR3], []],
  // ── valid-data controls: a correct target / a legitimate setup must stay available ──
  ["ctl-nt-null-sibling-fatal", "valid target beside an unrelated null refused (nightly)", NIGHT,
    [["        if (!decoded.ok) {", "        if (!decoded.ok || (decoded.list as unknown[]).includes(null)) {"]], [NR3, DBR2], []],
  ["ctl-pg-null-sibling-unavailable", "valid target beside an unrelated null refused (page)", PAGE,
    [["      if (JSON.parse(node._v).length === 0) return { state: \"empty\", list: [], selectable: [] };", "      if (JSON.parse(node._v).length === 0) return { state: \"empty\", list: [], selectable: [] };\n      if (JSON.parse(node._v).indexOf(null) >= 0) return { state: \"unreadable\", reason: \"null_sibling\" };"]], [PR3], ["RM2-01", "RM2-03"]],
  ["ctl-pg-empty-not-eligible", "legitimate first setup over the empty registry refused", PAGE,
    [['      if (registryState === "unknown" || registryState === "absent" || registryState === "empty") return true;', '      if (registryState === "unknown" || registryState === "absent") return true;']], [PR3], ["RM3-07"]],
  ["ctl-pg-absent-setup-refused", "legitimate first setup over an absent registry refused", PAGE,
    [['      if (node === null || node === undefined) return { state: "absent", list: [], selectable: [] };\n', '      if (node === null || node === undefined) return { state: "unreadable", reason: "absent" };\n']], [PR3], ["RM2-07", "RM3-08"]],
];

const result = [];
for (const [id, klass, file, edits, tests, rmCases] of cases.filter((c) => !only || c[0] === only)) {
  const dir = mkdtempSync(join(tmpdir(), `m1r3-mut-${id}-`));
  cpSync(root, dir, { recursive: true, filter: (p) => ![".git", "node_modules", ".deps"].includes(p.split("/").at(-1)) });
  symlinkSync(join(root, "node_modules"), join(dir, "node_modules"), "dir");
  if (existsSync(join(root, "test", "historical", ".deps"))) symlinkSync(join(root, "test", "historical", ".deps"), join(dir, "test", "historical", ".deps"), "dir");
  const path = join(dir, file), before = readFileSync(path, "utf8");
  let after = before, missing = false;
  if (typeof edits === "function") after = edits(before);
  else for (const [from, to] of edits) { if (after.split(from).length !== 2) { missing = true; break; } after = after.replace(from, () => to); }
  if (missing || after === before) { result.push({ id, klass, verdict: "ANCHOR_MISSING" }); rmSync(dir, { recursive: true, force: true }); continue; }
  writeFileSync(path, after);
  const run = spawnSync(process.execPath, ["--test", "--test-reporter=tap", ...tests], { cwd: dir, encoding: "utf8", maxBuffer: 1 << 28, timeout: 900000 });
  const tap = run.stdout + run.stderr;
  writeFileSync(join(out, `${id}.tap`), tap);
  const notOk = (tap.match(/^not ok \d+ - .*/gm) || []).filter((l) => !/ - test\//.test(l));
  const syntax = /SyntaxError|TS\d{4}:|Cannot find module/.test(tap) && notOk.length === 0;
  const verdict = run.status !== 0 && notOk.length > 0 && !syntax ? "DETECTED" : syntax ? "SYNTAX (not counted)" : "NOT_DETECTED";
  const r = { id, klass, file, tests, verdict, failing: notOk.map((l) => l.replace(/^not ok \d+ - /, "").slice(0, 140)) };
  if (rendered && rmCases.length) {
    const logs = join(out, `${id}-rendered`);
    const emu = spawnSync("bash", [join(root, "test", "support", "p1-r7-emu-run.sh"), dir, logs, "m1-rendered-integration=test/emulator/m1-rendered-integration.mjs"], { encoding: "utf8", maxBuffer: 1 << 28, timeout: 1500000 });
    const log = existsSync(join(logs, "m1-rendered-integration.log")) ? readFileSync(join(logs, "m1-rendered-integration.log"), "utf8") : "";
    const failed = [...log.matchAll(/^(RM\d-\d+[a-z]?)\s+FAIL/gm)].map((m) => m[1]);
    r.rendered = { expected: rmCases, failed, verdict: emu.status !== 0 && rmCases.some((c) => failed.includes(c)) ? "DETECTED" : "NOT_DETECTED" };
  }
  result.push(r);
  rmSync(dir, { recursive: true, force: true });
}
writeFileSync(join(out, "summary.json"), JSON.stringify(result, null, 1));
for (const r of result) console.log(`${r.id.padEnd(34)} ${r.verdict.padEnd(14)} ${(r.failing || []).length} failing${r.rendered ? `  rendered ${r.rendered.verdict} [${r.rendered.failed.join(",")}]` : ""}`);
if (result.some((r) => r.verdict !== "DETECTED" || (r.rendered && r.rendered.verdict !== "DETECTED"))) process.exitCode = 1;
