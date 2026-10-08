// Run explicitly: node test/support/m1-r5-mutations.mjs <absolute log directory> [mutant-id]
// M1 R5 remediation — behavioural sensitivity of the R5 change (R4 review blocker A1/A2: the nightly tenant/business pair key)
// and of the controls it must keep. Each mutant re-introduces one defect in a NEW disposable copy WITHOUT .git, so no identity /
// pin / scope guard can count as the catch (R5G / R4G / B2G skip or are not run). A COMMITTED behavioural test must report
// `not ok` with a non-zero exit; a syntax / compile failure is never counted. The R4 sweep (test/support/m1-r4-mutations.mjs)
// is re-run separately on the R5 tree. No network, no hosted access, no e-mail.
import { cpSync, mkdtempSync, symlinkSync, readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = fileURLToPath(new URL("../../", import.meta.url));
const args = process.argv.slice(2);
const out = args[0], emulator = false, only = args.slice(1).find((a) => !a.startsWith("--"));
if (!out || !out.startsWith("/")) throw new Error("absolute log directory required");
mkdirSync(out, { recursive: true });
const NIGHT = "src/analytics/dailyBuilder.ts";
const PI = "test/analytics/m1-r5-pair-identity.test.mjs", RO = "test/analytics/m1-r4-run-outcome.test.mjs", IP = "test/analytics/m1-r4-identity-parity.test.mjs";
const KEY_FN = "  return JSON.stringify([tenantId, bizId]);\n";

// [id, defect class, file, [[from, to], …], unit suites, emulator cases (none for R5)]
const cases = [
  ["r5-pair-key-concatenated", "the pair key is the R4 `${tenantId}|${bizId}` concatenation (all sites)", NIGHT,
    [[KEY_FN, "  return `${tenantId}|${bizId}`;\n"]], [PI], []],
  ["r5-pair-key-colon", "the pair key is another delimiter concatenation (`${tenantId}:${bizId}`)", NIGHT,
    [[KEY_FN, "  return `${tenantId}:${bizId}`;\n"]], [PI], []],
  ["r5-pair-key-joined", "the pair key is [t, b].join(\"|\")", NIGHT,
    [[KEY_FN, "  return [tenantId, bizId].join(\"|\");\n"]], [PI], []],
  ["r5-discovered-site-concat", "only the discovery de-duplication site reverts to the concatenation", NIGHT,
    [["    const key = analyticsPairKey(t, b);\n", "    const key = `${t}|${b}`;\n"]], [PI], []],
  ["r5-ambiguity-site-concat", "only the ambiguity record site reverts to the concatenation", NIGHT,
    [["            const key = analyticsPairKey(tenantId, id);\n", "            const key = `${tenantId}|${id}`;\n"]], [PI], []],
  ["r5-ambiguity-filter-concat", "only the ambiguity filter reverts to the concatenation", NIGHT,
    [["      if (ambiguousTargets.has(analyticsPairKey(candidate.tenantId, candidate.bizId))) return false;\n", "      if (ambiguousTargets.has(`${candidate.tenantId}|${candidate.bizId}`)) return false;\n"]], [PI], []],
  ["r5-ambiguity-tenant-only", "ambiguity suppresses by tenant only", NIGHT,
    [["      if (ambiguousTargets.has(analyticsPairKey(candidate.tenantId, candidate.bizId))) return false;\n", "      if ([...ambiguousTargets.values()].some((a) => a.tenantId === candidate.tenantId)) return false;\n"]], [PI], []],
  ["r5-merge-ignores-source", "an index-only identity merges into a registered one regardless of identity (key by business only)", NIGHT,
    [["    const key = analyticsPairKey(t, b);\n", "    const key = analyticsPairKey(\"\", b.split(\"|\").pop() || b);\n"]], [PI], []],
  ["r5-build-failure-unattributed", "a build failure is recorded without its pair", NIGHT,
    [["      failures.push({ tenantId, bizId, error: String((err as Error)?.message ?? err) });", "      failures.push({ tenantId: null as any, bizId: null as any, error: String((err as Error)?.message ?? err) });"]], [PI, RO], []],
  // ── controls the correction must keep ──
  ["ctl-r5-distinct-pairs-collapsed", "control: every pair maps to one key (nothing is built twice, but distinct businesses vanish)", NIGHT,
    [[KEY_FN, "  return \"all\";\n"]], [PI, RO, IP], []],
  ["ctl-r5-trimmed-key", "control: a key built from trimmed ids merges a padded registered id with another", NIGHT,
    [[KEY_FN, "  return JSON.stringify([tenantId.trim(), bizId.trim()]);\n"]], [PI, IP], []],
];

const result = [];
for (const [id, klass, file, edits, tests, emuCases] of cases.filter((c) => !only || c[0] === only)) {
  const dir = mkdtempSync(join(tmpdir(), `m1r5-mut-${id}-`));
  cpSync(root, dir, { recursive: true, filter: (p) => ![".git", "node_modules", ".deps"].includes(p.split("/").at(-1)) });
  symlinkSync(join(root, "node_modules"), join(dir, "node_modules"), "dir");
  if (existsSync(join(root, "test", "historical", ".deps"))) symlinkSync(join(root, "test", "historical", ".deps"), join(dir, "test", "historical", ".deps"), "dir");
  const path = join(dir, file), before = readFileSync(path, "utf8");
  let after = before, missing = false;
  for (const [from, to] of edits) { if (after.split(from).length !== 2) { missing = true; break; } after = after.replace(from, () => to); }
  if (missing || after === before) { result.push({ id, klass, verdict: "ANCHOR_MISSING" }); rmSync(dir, { recursive: true, force: true }); continue; }
  writeFileSync(path, after);
  const run = spawnSync(process.execPath, ["--test", "--test-concurrency=1", "--test-reporter=tap", ...tests], { cwd: dir, encoding: "utf8", maxBuffer: 1 << 28, timeout: 1500000 });
  const tap = run.stdout + run.stderr;
  writeFileSync(join(out, `${id}.tap`), tap);
  const notOk = (tap.match(/^not ok \d+ - .*/gm) || []).filter((l) => !/ - test\//.test(l));
  const syntax = /SyntaxError|wrapper compile\/import failed|Cannot find module/.test(tap) && notOk.every((l) => /SyntaxError/.test(l));
  const verdict = run.status !== 0 && notOk.length > 0 && !syntax ? "DETECTED" : syntax ? "SYNTAX (not counted)" : "NOT_DETECTED";
  const r = { id, klass, file, tests, verdict, failing: notOk.map((l) => l.replace(/^not ok \d+ - /, "").slice(0, 140)) };
  if (emulator && emuCases.length) {
    const logs = join(out, `${id}-emulator`);
    const emu = spawnSync("bash", [join(root, "test", "support", "p1-r7-emu-run.sh"), dir, logs, "m1-r4-integration=test/emulator/m1-r4-integration-emulator.mjs"], { encoding: "utf8", maxBuffer: 1 << 28, timeout: 900000 });
    const log = existsSync(join(logs, "m1-r4-integration.log")) ? readFileSync(join(logs, "m1-r4-integration.log"), "utf8") : "";
    const failed = [...log.matchAll(/^FAIL (R4E\d+)/gm)].map((m) => m[1]);
    r.emulator = { expected: emuCases, failed, verdict: emu.status !== 0 && emuCases.some((c) => failed.includes(c)) ? "DETECTED" : "NOT_DETECTED" };
  }
  result.push(r);
  rmSync(dir, { recursive: true, force: true });
}
writeFileSync(join(out, "summary.json"), JSON.stringify(result, null, 1));
for (const r of result) console.log(`${r.id.padEnd(44)} ${r.verdict.padEnd(14)} ${(r.failing || []).length} failing${r.emulator ? `  emulator ${r.emulator.verdict} [${r.emulator.failed.join(",")}]` : ""}`);
if (result.some((r) => r.verdict !== "DETECTED" || (r.emulator && r.emulator.verdict !== "DETECTED"))) process.exitCode = 1;
