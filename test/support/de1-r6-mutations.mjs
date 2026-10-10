// Run explicitly: node test/support/de1-r6-mutations.mjs <absolute log directory> [mutant-id]
// Delivery provider structure R6 — behavioural sensitivity of the R6 change (the structural validation of the resolved provider
// result: the independent R4 review's blocking finding E4-01) and of the controls it must keep. Each mutant re-introduces one defect in a NEW disposable copy WITHOUT .git (no identity / pin /
// scope guard can count as the catch). A committed behavioural test must report `not ok` with a non-zero exit; a syntax failure
// is never counted. CONTROL is an exact no-op replacement: it must pass every suite. The R4 / R3 / R2 sweeps are re-run
// separately (R5 / R4 / R3 anchors are unchanged by R6 outside the five recorded edits).
import { cpSync, mkdtempSync, symlinkSync, readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = fileURLToPath(new URL("../../", import.meta.url));
const out = process.argv[2], only = process.argv[3];
if (!out || !out.startsWith("/")) throw new Error("absolute log directory required");
mkdirSync(out, { recursive: true });
const ED = "lib/emailDelivery.js", RT = "api/daily-snapshot/run.ts";
const R6 = "test/delivery/de1-r6-provider-structure.test.mjs", R5 = "test/delivery/de1-r5-delivery.test.mjs", R4 = "test/delivery/de1-r4-remediation.test.mjs", R3 = "test/delivery/de1-r3-remediation.test.mjs", R1 = "test/delivery/de1-r1-remediation.test.mjs";
const DE = "test/delivery/daily-email-delivery.test.mjs", EU = "test/delivery/email-delivery-unit.test.mjs";
const SUITES = [R6, R5, R4, R3, R1, DE, EU];

// [id, defect class, file, [[from, to], …]]
const cases = [
  ["CONTROL", "no-op (identical bytes)", ED, [["export const HISTORY_KEEP = 10;", "export const HISTORY_KEEP = 10;"]]],
  ["E4-array-is-record", "an array is a record again (the R4 defect: a decorated array establishes acceptance)", ED,
    [["      if (Array.isArray(x)) return false;\n", ""], ["      return proto === Object.prototype || proto === null;", "      return proto === Object.prototype || proto === null || proto === Array.prototype;"]]],
  ["E4-typeof-only", "the top-level check is the R4 typeof-only check", ED,
    [["  if (!isPlainRecord(info)) return malformed(null);     // R6: the result itself must be a plain record (never an array)", "  if (info === null || typeof info !== \"object\") return malformed(null);"]]],
  ["E4-any-prototype", "an object with any prototype (a class instance, inherited evidence) is a record", ED,
    [["      return proto === Object.prototype || proto === null;", "      return proto !== undefined;"]]],
  ["E4-unreadable-prototype-is-record", "a Proxy whose prototype cannot be read / a revoked Proxy counts as a record", ED,
    [["    try {                                             // a revoked Proxy throws even on Array.isArray: unreadable, not a record\n      if (Array.isArray(x)) return false;\n      const proto = Object.getPrototypeOf(x);\n      return proto === Object.prototype || proto === null;\n    } catch { return false; }", "    try {\n      if (Array.isArray(x)) return false;\n      const proto = Object.getPrototypeOf(x);\n      return proto === Object.prototype || proto === null;\n    } catch { return true; }"]]],
  ["E4-envelope-typeof-only", "the envelope check is the R4 typeof-only check (an array envelope accepted)", ED,
    [["    if (!isPlainRecord(envelope)) return malformed(rc);   // R6: the envelope is a plain record (never an array / instance)", "    if (envelope === UNREADABLE || envelope === null || typeof envelope !== \"object\") return malformed(rc);"]]],
  ["E4-detail-list-allowed", "a list-shaped refusal detail is read as a record", ED,
    [["        if (e === null || typeof e !== \"object\" || Array.isArray(e)) return malformed(rc);   // a detail is a record, never a list", "        if (e === null || typeof e !== \"object\") return malformed(rc);"]]],
  ["E4-malformed-retryable", "a malformed result becomes a retryable failure (unsafe retry)", ED,
    [["  const malformed = (rc) => ({ outcome: \"unknown\", code: \"provider_result_malformed\", responseCode: rc });", "  const malformed = (rc) => ({ outcome: \"failed\", retryable: true, inRunRetry: true, code: \"provider_result_malformed\", responseCode: rc });"]]],
  ["E4-malformed-accepted", "a malformed result is accepted", ED,
    [["  const malformed = (rc) => ({ outcome: \"unknown\", code: \"provider_result_malformed\", responseCode: rc });", "  const malformed = (rc) => ({ outcome: \"accepted\", responseCode: rc });"]]],
];

const result = [];
for (const [id, klass, file, edits] of cases) {
  if (only && id !== only) continue;
  const dir = mkdtempSync(join(tmpdir(), "de1-r5-mut-"));
  for (const entry of ["api", "lib", "src", "test", "tools", "fincore", "docs", "package.json", "tsconfig.json", "database.rules.json", "vercel.json"]) if (existsSync(join(root, entry))) cpSync(join(root, entry), join(dir, entry), { recursive: true });
  symlinkSync(join(root, "node_modules"), join(dir, "node_modules"));
  const p = join(dir, file);
  const before = readFileSync(p, "utf8");
  let after = before, missing = false;
  for (const [from, to] of edits) { if (after.split(from).length !== 2) { missing = true; break; } after = after.replace(from, () => to); }
  if (missing || (id !== "CONTROL" && after === before)) { result.push({ id, klass, verdict: "ANCHOR_MISSING" }); rmSync(dir, { recursive: true, force: true }); continue; }
  writeFileSync(p, after);
  const run = spawnSync(process.execPath, ["--test", "--test-concurrency=1", "--test-reporter=tap", ...SUITES], { cwd: dir, encoding: "utf8", maxBuffer: 1 << 28, timeout: 900000 });
  const tap = run.stdout + "\n" + run.stderr;
  writeFileSync(join(out, `${id}.tap`), tap);
  const notOk = tap.split("\n").filter((l) => /^\s*not ok\b/.test(l) && !/# (TODO|SKIP)/.test(l));
  const syntax = /SyntaxError|Cannot find module|route compile failed/.test(tap) && notOk.length === 0;
  const verdict = id === "CONTROL"
    ? (notOk.length === 0 && run.status === 0 ? "CLEAN" : "CONTROL_FAILED")
    : syntax ? "SYNTAX_ONLY" : (notOk.length > 0 && run.status !== 0 ? "DETECTED" : "SURVIVED");
  result.push({ id, klass, verdict, notOk: notOk.length, firstFailure: notOk[0] ? notOk[0].trim().slice(0, 160) : null });
  rmSync(dir, { recursive: true, force: true });
}
writeFileSync(join(out, "summary.json"), JSON.stringify(result, null, 1));
for (const r of result) console.log(`${r.verdict.padEnd(14)} ${r.id.padEnd(36)} ${r.notOk ?? ""} ${r.firstFailure ?? ""}`);
if (result.some((r) => (r.id === "CONTROL" ? r.verdict !== "CLEAN" : r.verdict !== "DETECTED"))) process.exitCode = 1;
