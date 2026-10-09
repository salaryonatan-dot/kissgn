// Run explicitly: node test/support/de1-r5-mutations.mjs <absolute log directory> [mutant-id]
// Delivery owner decisions R5 — behavioural sensitivity of the R5 change (G4, G10, control characters, receiptPath slots) and of
// the controls it must keep. Each mutant re-introduces one defect in a NEW disposable copy WITHOUT .git (no identity / pin /
// scope guard can count as the catch). A committed behavioural test must report `not ok` with a non-zero exit; a syntax failure
// is never counted. CONTROL is an exact no-op replacement: it must pass every suite. The R4 / R3 / R2 sweeps are re-run
// separately (their anchors are unchanged by R5: the classifier is byte-identical).
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
const R5 = "test/delivery/de1-r5-delivery.test.mjs", R4 = "test/delivery/de1-r4-remediation.test.mjs", R1 = "test/delivery/de1-r1-remediation.test.mjs";
const DE = "test/delivery/daily-email-delivery.test.mjs", EU = "test/delivery/email-delivery-unit.test.mjs";
const SUITES = [R5, R4, R1, DE, EU];

// [id, defect class, file, [[from, to], …]]
const cases = [
  ["CONTROL", "no-op (identical bytes)", ED, [["export const HISTORY_KEEP = 10;", "export const HISTORY_KEEP = 10;"]]],
  // ── identity rules / receiptPath ──
  ["ID-tenant-colon-refused", "the tenant slot refuses `:` again (the R4 rule)", ED,
    [["export function isTenantKey(v) { return isValidId(v) && !RTDB_CONTROL_CHARS.test(v); }", "export function isTenantKey(v) { return isValidId(v) && !RTDB_CONTROL_CHARS.test(v) && !v.includes(\":\"); }"]]],
  ["ID-biz-colon-accepted", "the business slot accepts `:`", ED,
    [["export function isBusinessKey(v) { return isRegistryBizId(v) && !RTDB_CONTROL_CHARS.test(v); }", "export function isBusinessKey(v) { return isValidId(v) && !RTDB_CONTROL_CHARS.test(v); }"]]],
  ["ID-ctrl-accepted-tenant", "control characters accepted in the tenant slot", ED,
    [["export function isTenantKey(v) { return isValidId(v) && !RTDB_CONTROL_CHARS.test(v); }", "export function isTenantKey(v) { return isValidId(v); }"]]],
  ["ID-ctrl-accepted-biz", "control characters accepted in the business slot", ED,
    [["export function isBusinessKey(v) { return isRegistryBizId(v) && !RTDB_CONTROL_CHARS.test(v); }", "export function isBusinessKey(v) { return isRegistryBizId(v); }"]]],
  ["ID-ctrl-partial", "only U+0000–U+001F refused (U+007F reaches the SDK)", ED,
    [["export const RTDB_CONTROL_CHARS = /[\\u0000-\\u001f\\u007f]/;", "export const RTDB_CONTROL_CHARS = /[\\u0000-\\u001f]/;"]]],
  ["ID-trim", "identities trimmed before the path is built (aliasing)", ED,
    [["  return `${RECEIPT_ROOT}/${kind}/${tenantId}/${bizId}/${businessDate}`;", "  return `${RECEIPT_ROOT}/${kind}/${tenantId.trim()}/${bizId.trim()}/${businessDate}`;"]]],
  ["ID-path-format", "the receipt path format changed (JSON-encoded segments: every existing receipt invisible)", ED,
    [["  return `${RECEIPT_ROOT}/${kind}/${tenantId}/${bizId}/${businessDate}`;", "  return `${RECEIPT_ROOT}/${kind}/${encodeURIComponent(tenantId)}/${encodeURIComponent(bizId)}/${businessDate}`;"]]],
  // ── the delivery target (G4) ──
  ["G4-blank-name-deliverable", "a blank name is a usable name", ED,
    [["const usableName = (name) => (typeof name === \"string\" && name.trim() !== \"\" ? name : null);", "const usableName = (name) => (typeof name === \"string\" ? name : null);"]]],
  ["G4-nonstring-name-deliverable", "a non-string name is stringified", ED,
    [["const usableName = (name) => (typeof name === \"string\" && name.trim() !== \"\" ? name : null);", "const usableName = (name) => (name !== null && name !== undefined && String(name).trim() !== \"\" ? String(name) : null);"]]],
  ["G4-unknown-literal-refused", "a business named \"Unknown\" is refused (the old placeholder comparison)", ED,
    [["const usableName = (name) => (typeof name === \"string\" && name.trim() !== \"\" ? name : null);", "const usableName = (name) => (typeof name === \"string\" && name.trim() !== \"\" && name.trim() !== \"Unknown\" ? name : null);"]]],
  ["G4-placeholder-name", "a missing name becomes the placeholder \"Unknown\" and is delivered", ED,
    [["  if (name === null) return { state: \"name_unavailable\", code: \"business_name_unavailable\" };\n  return { state: \"deliverable\", code: null, name };", "  return { state: \"deliverable\", code: null, name: name === null ? \"Unknown\" : name };"]]],
  ["G4-first-match-among-duplicates", "the first canonical record among duplicates is used", ED,
    [["  if (records.length !== 1) return { state: \"ambiguous\", code: \"ambiguous_business_identity\", reason: \"duplicate_target\" };", "  if (records.length === 0) return { state: \"ambiguous\", code: \"ambiguous_business_identity\", reason: \"duplicate_target\" };"],
     ["  if (c.state === \"ambiguous\") return { state: \"ambiguous\", code: \"ambiguous_business_identity\", reason: c.reason };", "  if (c.state === \"ambiguous\" && c.reason !== \"duplicate_target\") return { state: \"ambiguous\", code: \"ambiguous_business_identity\", reason: c.reason };"]]],
  ["G4-notice-not-recorded", "the notice is never written", ED,
    [["  const path = deliveryNoticePath(tenantId, bizId);\n  if (path === null) return \"not_recorded\";\n  try {", "  const path = deliveryNoticePath(tenantId, bizId);\n  if (path === null || path) return \"not_recorded\";\n  try {"]]],
  ["G4-notice-not-counted", "the notice forgets its first occurrence and its count", ED,
    [["        firstSeenAt: prev && Number.isFinite(prev.firstSeenAt) ? prev.firstSeenAt : nowMs, lastSeenAt: nowMs,\n        runs: prev && Number.isInteger(prev.runs) && prev.runs >= 0 ? prev.runs + 1 : 1 };", "        firstSeenAt: nowMs, lastSeenAt: nowMs, runs: 1 };"]]],
  ["G4-notice-not-cleared", "a repaired business keeps its notice", ED,
    [["  try { await db.ref(path).remove(); return true; } catch { return false; }", "  return true;"]]],
  // ── the route: the gate, G10, no-send ──
  ["RT-no-send-row", "a nameless business is a silent no-send row inside a completed run", RT,
    [["          const row: Row = { ...base, outcome: \"failed\", code: target.code, settlement: \"failed\", receipt: \"not_written\" };", "          const row: Row = { ...base, outcome: target.state === \"name_unavailable\" ? \"skipped\" : \"failed\", code: target.code, settlement: target.state === \"name_unavailable\" ? \"no_send\" : \"failed\", receipt: \"not_written\" };"]]],
  ["RT-nameless-passes-gate", "a nameless business passes the gate and is e-mailed under the builder's name field", RT,
    [["        if (target.state !== \"deliverable\") {\n          console.warn", "        if (target.state !== \"deliverable\" && target.state !== \"name_unavailable\") {\n          console.warn"]]],
  ["RT-ctrl-row-sent", "an identity refusal on the scheduled path is ignored (the business is sent)", RT,
    [["        if (target.state !== \"deliverable\") {", "        if (target.state !== \"deliverable\" && target.state !== \"invalid_identity\") {"]]],
  ["RT-manual-sends-after-refusal", "the manual POST sends despite a gate refusal", RT,
    [["      if (target.state !== \"deliverable\") return refuse(target.code);", "      if (target.state !== \"deliverable\" && target.state !== \"ambiguous\" && target.state !== \"unreadable\") return refuse(target.code);"]]],
  ["RT-manual-placeholder-sent", "the manual POST sends a nameless business under the builder's placeholder", RT,
    [["      if (target.state !== \"deliverable\") return refuse(target.code);", "      if (target.state !== \"deliverable\" && target.state !== \"name_unavailable\") return refuse(target.code);"],
     ["      snapshot = { ...snapshot, bizName: target.name };", "      snapshot = { ...snapshot, bizName: target.state === \"deliverable\" ? target.name : snapshot.bizName };"]]],
  ["RT-build-failure-generic-500", "a build failure falls through to the generic 500", RT,
    [["      catch (error) {\n        // the error is untrusted (D4): only its class is read; a registry SyntaxError is a malformed registry, the rest a build failure\n        console.error(`[daily-snapshot] manual build failed (${errorClass(error)})`);\n        return refuse(builderRefusal(error));\n      }", "      catch (error) { throw error; }"]]],
  ["RT-syntaxerror-as-build-failure", "a builder SyntaxError is a build failure (503), not a malformed registry (422)", RT,
    [["  return errorClass(error) === \"SyntaxError\" ? \"registry_unreadable\" : \"snapshot_build_failed\";", "  return \"snapshot_build_failed\";"]]],
  ["RT-status-ambiguous-409", "ambiguous identity returned as 409", RT,
    [["  ambiguous_business_identity: { status: 422,", "  ambiguous_business_identity: { status: 409,"]]],
  ["RT-status-not-registered-422", "not registered returned as 422", RT,
    [["  business_not_registered:     { status: 404,", "  business_not_registered:     { status: 422,"]]],
  ["RT-status-unavailable-500", "a registry read failure returned as 500", RT,
    [["  registry_unavailable:        { status: 503,", "  registry_unavailable:        { status: 500,"]]],
  ["RT-status-invalid-422", "an invalid identity returned as 422", RT,
    [["  invalid_business_identity:   { status: 400,", "  invalid_business_identity:   { status: 422,"]]],
  ["RT-body-raw-error", "the refusal body carries the error message", RT,
    [["        return refuse(builderRefusal(error));", "        return res.status(503).json({ error: String((error as { message?: unknown })?.message ?? error), code: builderRefusal(error), tenantId, bizId });"]]],
  ["RT-log-raw-error", "the refusal log carries the error message", RT,
    [["        console.error(`[daily-snapshot] manual build failed (${errorClass(error)})`);", "        console.error(`[daily-snapshot] manual build failed (${errorClass(error)}): ${String((error as { message?: unknown })?.message ?? error)}`);"]]],
  ["RT-notice-any-role", "the notice read skips the owner gate (reachable through the manager floor)", RT,
    [["      if (ctx.role !== \"owner\" && ctx.role !== \"super_owner\") {\n        return res.status(403).json({ error: \"owner_role_required\" });\n      }", "      if (ctx.role !== \"owner\" && ctx.role !== \"super_owner\" && (req.body as { action?: unknown })?.action !== \"notice\") {\n        return res.status(403).json({ error: \"owner_role_required\" });\n      }"]]],
  ["RT-notice-not-cleared-on-read", "a repaired business keeps reporting its notice", RT,
    [["          await clearDeliveryNotice(db, tenantId, bizId);\n          return res.status(200).json({ status: \"ok\", tenantId, bizId, deliverable: true, code: null, notice: null });", "          return res.status(200).json({ status: \"ok\", tenantId, bizId, deliverable: true, code: null, notice: null });"]]],
  ["RT-unknown-action-sends", "an unknown action is treated as a manual send", RT,
    [["      if (action !== undefined && action !== \"notice\") return res.status(400).json({ error: \"invalid_action\" });", ""]]],
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
