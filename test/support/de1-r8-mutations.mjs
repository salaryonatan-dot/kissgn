// Run explicitly: node test/support/de1-r8-mutations.mjs <absolute log directory> [mutant-id]
// Delivery refusal provenance R8 — behavioural sensitivity of the R8 change (the builder refusal's provenance marker on the
// manual path, CF5-01 — the independent Builder CF R5 review's finding) and of the controls it must keep. Each mutant re-introduces one defect in a NEW disposable copy WITHOUT .git (no identity / pin /
// scope guard can count as the catch). A committed behavioural test must report `not ok` with a non-zero exit; a syntax failure
// is never counted. CONTROL is an exact no-op replacement: it must pass every suite. The R4 / R3 / R2 sweeps are re-run
// separately (R7 anchors on builderRefusal moved: re-anchored in the package tool; R6 / R5 / R4 anchors are unchanged by R8).
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
const R8 = "test/delivery/de1-r8-refusal-provenance.test.mjs", R7 = "test/delivery/de1-r7-notice-integrity.test.mjs", R6 = "test/delivery/de1-r6-provider-structure.test.mjs", R5 = "test/delivery/de1-r5-delivery.test.mjs", R4 = "test/delivery/de1-r4-remediation.test.mjs", R3 = "test/delivery/de1-r3-remediation.test.mjs", R1 = "test/delivery/de1-r1-remediation.test.mjs";
const DE = "test/delivery/daily-email-delivery.test.mjs", EU = "test/delivery/email-delivery-unit.test.mjs";
const SUITES = [R8, R7, R6, R5, R4, R3, R1, DE, EU];

// [id, defect class, file, [[from, to], …]]
const CHECK = '  if (name !== BUILDER_REFUSAL_NAME || !ownCode || typeof message !== "string" || code !== message) return "snapshot_build_failed";';
const cases = [
  ["CONTROL", "no-op (identical bytes)", ED, [["export const HISTORY_KEEP = 10;", "export const HISTORY_KEEP = 10;"]]],
  ["P-message-only", "the R7 defect: a throw is attributed by its message alone", RT,
    [[CHECK, '  if (typeof message !== "string") return "snapshot_build_failed";']]],
  ["P-name-not-checked", "the marker name is not required (own code = message suffices)", RT,
    [[CHECK, '  if (!ownCode || typeof message !== "string" || code !== message) return "snapshot_build_failed";']]],
  ["P-own-not-checked", "an inherited (prototype) code is accepted", RT,
    [['    ownCode = Object.prototype.hasOwnProperty.call(error, "code");', '    ownCode = "code" in error;']]],
  ["P-code-message-not-checked", "code need not equal the message", RT,
    [[CHECK, '  if (name !== BUILDER_REFUSAL_NAME || !ownCode || typeof message !== "string") return "snapshot_build_failed";']]],
  ["P-set-not-checked", "a marked throw with a message outside the bounded set is mapped as is", RT,
    [['  return BUILDER_ATTRIBUTED_CODES.has(message) ? (message as DeliveryTargetCode) : "snapshot_build_failed";', '  return message as DeliveryTargetCode;']]],
  ["P-instanceof-not-checked", "a record that is not an Error is attributed", RT,
    [['    if (!(error instanceof Error)) return "snapshot_build_failed";     // a revoked Proxy throws even here\n', '']]],
  ["P-instanceof-unguarded", "instanceof outside the guard (a revoked Proxy escapes as a 500)", RT,
    [['  let name: unknown, message: unknown, code: unknown, ownCode = false;\n  try {\n    if (!(error instanceof Error)) return "snapshot_build_failed";     // a revoked Proxy throws even here\n', '  if (!(error instanceof Error)) return "snapshot_build_failed";\n  let name: unknown, message: unknown, code: unknown, ownCode = false;\n  try {\n']]],
  ["P-accessor-unguarded", "a throwing accessor escapes (no try / catch)", RT,
    [['  try {\n    if (!(error instanceof Error)) return "snapshot_build_failed";     // a revoked Proxy throws even here\n    name = error.name;\n    message = error.message;\n    ownCode = Object.prototype.hasOwnProperty.call(error, "code");\n    code = ownCode ? (error as { code?: unknown }).code : undefined;\n  } catch { return "snapshot_build_failed"; }', '  if (!(error instanceof Error)) return "snapshot_build_failed";\n  name = error.name;\n  message = error.message;\n  ownCode = Object.prototype.hasOwnProperty.call(error, "code");\n  code = ownCode ? (error as { code?: unknown }).code : undefined;']]],
  ["P-name-loose", "the marker name is matched loosely (trimmed / case-folded)", RT,
    [['name !== BUILDER_REFUSAL_NAME ||', 'String(name).trim().toLowerCase() !== BUILDER_REFUSAL_NAME.toLowerCase() ||']]],
  ["P-code-loose", "code and message compared by coercion", RT,
    [['|| code !== message) return', '|| String(code) !== String(message)) return']]],
  ["P-marker-logged", "the thrown value's name reaches the log", RT,
    [['        console.error(`[daily-snapshot] manual build failed (${errorClass(error)})`);', '        console.error(`[daily-snapshot] manual build failed (${errorClass(error)}) ${String((error as { name?: unknown } | null)?.name)}`);']]],
  ["P-attributed-as-build-failure", "every marked refusal is a generic build failure (the §3 statuses lost)", RT,
    [['  return BUILDER_ATTRIBUTED_CODES.has(message) ? (message as DeliveryTargetCode) : "snapshot_build_failed";', '  return "snapshot_build_failed";']]],
  // the controls R8 must keep
  ["K-syntaxerror-as-registry", "the R5 defect: a SyntaxError is a malformed registry by class (before the marker is read)", RT,
    [['  let name: unknown, message: unknown, code: unknown, ownCode = false;\n', '  if (errorClass(error) === "SyntaxError") return "registry_unreadable";\n  let name: unknown, message: unknown, code: unknown, ownCode = false;\n']]],
  ["K-notice-sends", "the notice action falls through to a send", RT,
    [["      if (action === \"notice\") {\n        const reply", "      if (action === \"notice\" && false) {\n        const reply"]]],
  ["K-manager-allowed", "the owner gate of the authorization section is dropped (a manager reads the notice)", RT,
    [["      if (ctx.role !== \"owner\" && ctx.role !== \"super_owner\") {\n        return res.status(403).json({ error: \"owner_role_required\" });\n      }\n", ""]]],
  ["K-read-failure-manufactured", "the R5 defect: a failed notice read is answered with a synthesized record", RT,
    [["        if (stored.state === \"unavailable\") return reply(false, NOTICE_UNAVAILABLE.read, \"unavailable\", \"not_attempted\", null);", "        if (stored.state === \"unavailable\") return reply(true, null, \"none\", \"not_applicable\", null);"]]],
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
  // a compile / load failure of the mutated copy, never the route's own "(SyntaxError)" class log
  const syntax = /(^|\n)\s*SyntaxError: |Cannot find module|route compile failed|error TS\d+/.test(tap) && notOk.length === 0 && run.status !== 0;
  const verdict = id === "CONTROL"
    ? (notOk.length === 0 && run.status === 0 ? "CLEAN" : "CONTROL_FAILED")
    : syntax ? "SYNTAX_ONLY" : (notOk.length > 0 && run.status !== 0 ? "DETECTED" : "SURVIVED");
  result.push({ id, klass, verdict, notOk: notOk.length, firstFailure: notOk[0] ? notOk[0].trim().slice(0, 160) : null });
  rmSync(dir, { recursive: true, force: true });
}
writeFileSync(join(out, "summary.json"), JSON.stringify(result, null, 1));
for (const r of result) console.log(`${r.verdict.padEnd(14)} ${r.id.padEnd(36)} ${r.notOk ?? ""} ${r.firstFailure ?? ""}`);
if (result.some((r) => (r.id === "CONTROL" ? r.verdict !== "CLEAN" : r.verdict !== "DETECTED"))) process.exitCode = 1;
