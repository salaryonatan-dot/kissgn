// Run explicitly: node test/support/de1-r7-mutations.mjs <absolute log directory> [mutant-id]
// Delivery notice integrity R7 — behavioural sensitivity of the R7 change (G10 attribution by operation, OD-01; the notice
// read / clear integrity, OD-02 — the independent R5 review's findings) and of the controls it must keep. Each mutant re-introduces one defect in a NEW disposable copy WITHOUT .git (no identity / pin /
// scope guard can count as the catch). A committed behavioural test must report `not ok` with a non-zero exit; a syntax failure
// is never counted. CONTROL is an exact no-op replacement: it must pass every suite. The R4 / R3 / R2 sweeps are re-run
// separately (R6 / R5 / R4 anchors are unchanged by R7 outside the recorded edits).
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
const R7 = "test/delivery/de1-r7-notice-integrity.test.mjs", R6 = "test/delivery/de1-r6-provider-structure.test.mjs", R5 = "test/delivery/de1-r5-delivery.test.mjs", R4 = "test/delivery/de1-r4-remediation.test.mjs", R3 = "test/delivery/de1-r3-remediation.test.mjs", R1 = "test/delivery/de1-r1-remediation.test.mjs";
const DE = "test/delivery/daily-email-delivery.test.mjs", EU = "test/delivery/email-delivery-unit.test.mjs";
const SUITES = [R7, R6, R5, R4, R3, R1, DE, EU];

// [id, defect class, file, [[from, to], …]]
const cases = [
  ["CONTROL", "no-op (identical bytes)", ED, [["export const HISTORY_KEEP = 10;", "export const HISTORY_KEEP = 10;"]]],
  // OD-01: attribution
  ["OD1-class-inference", "the R5 defect: a SyntaxError is a malformed registry by exception class", RT,
    [["  return typeof message === \"string\" && BUILDER_ATTRIBUTED_CODES.has(message) ? (message as DeliveryTargetCode) : \"snapshot_build_failed\";", "  return errorClass(error) === \"SyntaxError\" ? \"registry_unreadable\" : (typeof message === \"string\" && BUILDER_ATTRIBUTED_CODES.has(message) ? (message as DeliveryTargetCode) : \"snapshot_build_failed\");"]]],
  ["OD1-prefix-match", "a message that merely STARTS with a bounded code is attributed", RT,
    [["  return typeof message === \"string\" && BUILDER_ATTRIBUTED_CODES.has(message) ? (message as DeliveryTargetCode) : \"snapshot_build_failed\";", "  const hit = typeof message === \"string\" ? [...BUILDER_ATTRIBUTED_CODES].find((c) => message.startsWith(c)) : undefined;\n  return hit ? (hit as DeliveryTargetCode) : \"snapshot_build_failed\";"]]],
  ["OD1-attribution-ignored", "the builder's own bounded code is ignored (everything is a build failure)", RT,
    [["  return typeof message === \"string\" && BUILDER_ATTRIBUTED_CODES.has(message) ? (message as DeliveryTargetCode) : \"snapshot_build_failed\";", "  return \"snapshot_build_failed\";"]]],
  ["OD1-message-logged", "the builder error's message reaches the log", RT,
    [["        console.error(`[daily-snapshot] manual build failed (${errorClass(error)})`);", "        console.error(`[daily-snapshot] manual build failed (${errorClass(error)}) ${String((error as { message?: unknown } | null)?.message)}`);"]]],
  // OD-02: the store state
  ["OD2-read-failure-is-absent", "a failed store read is reported as an absent notice", ED,
    [["  try { v = (await db.ref(path).once(\"value\")).val(); } catch { return { state: \"unavailable\" }; }", "  try { v = (await db.ref(path).once(\"value\")).val(); } catch { return { state: \"absent\" }; }"]]],
  ["OD2-read-failure-is-none-200", "the route answers a failed read with 200 / none", RT,
    [["        if (stored.state === \"unavailable\") return reply(false, NOTICE_UNAVAILABLE.read, \"unavailable\", \"not_attempted\", null);", "        if (stored.state === \"unavailable\") return reply(true, null, \"none\", \"not_applicable\", null);"]]],
  ["OD2-read-failure-manufactured", "the R5 defect: a failed read is answered with a synthesized runs: 0 notice", RT,
    [["        if (stored.state === \"unavailable\") return reply(false, NOTICE_UNAVAILABLE.read, \"unavailable\", \"not_attempted\", null);", "        if (stored.state === \"unavailable\") return reply(true, null, \"active\", \"not_applicable\", target.state === \"name_unavailable\" ? { code: \"business_name_unavailable\", message: \"\\u05dc\\u05d0 \\u05e0\\u05d9\\u05ea\\u05df\", tenantId, bizId, businessDate: null, firstSeenAt: 0, lastSeenAt: 0, runs: 0 } : null);"]]],
  ["OD2-nothing-stored-manufactured", "nothing stored while the name is missing: a notice is manufactured", RT,
    [["        if (target.state === \"name_unavailable\") return reply(true, null, stored.state === \"present\" ? \"active\" : \"none\", \"not_applicable\", record);", "        if (target.state === \"name_unavailable\") return reply(true, null, \"active\", \"not_applicable\", record ?? { code: \"business_name_unavailable\", message: \"\\u05dc\\u05d0 \\u05e0\\u05d9\\u05ea\\u05df\", tenantId, bizId, businessDate: null, firstSeenAt: 0, lastSeenAt: 0, runs: 0 });"]]],
  ["OD2-clear-failure-ignored", "the R5 defect: a failed removal is answered 200 / cleared while the notice stays stored", RT,
    [["        return cleared ? reply(true, null, \"none\", \"cleared\", null) : reply(false, NOTICE_UNAVAILABLE.clear, \"stale\", \"failed\", record);", "        return reply(true, null, \"none\", \"cleared\", null);"]]],
  ["OD2-clear-failure-200", "a failed removal is reported truthfully but with HTTP 200", RT,
    [["        return cleared ? reply(true, null, \"none\", \"cleared\", null) : reply(false, NOTICE_UNAVAILABLE.clear, \"stale\", \"failed\", record);", "        return cleared ? reply(true, null, \"none\", \"cleared\", null) : reply(true, null, \"stale\", \"failed\", record);"]]],
  ["OD2-never-cleared", "a repaired business keeps its notice (no removal is ever attempted)", RT,
    [["        const cleared = await clearDeliveryNotice(db, tenantId, bizId);", "        const cleared = false;"]]],
  ["OD2-cleared-without-removal", "\"cleared\" is claimed without any removal", RT,
    [["        const cleared = await clearDeliveryNotice(db, tenantId, bizId);", "        const cleared = true;"]]],
  ["OD2-always-200", "every notice outcome is HTTP 200", RT,
    [["          return res.status(ok ? 200 : 503).json({ status: ok ? \"ok\" : \"unavailable\", ...(error === null ? {} : { error }),", "          return res.status(200).json({ status: ok ? \"ok\" : \"unavailable\", ...(error === null ? {} : { error }),"]]],
  ["OD2-clear-on-unknown-store", "a removal is attempted although the store could not be read", RT,
    [["        if (stored.state === \"unavailable\") return reply(false, NOTICE_UNAVAILABLE.read, \"unavailable\", \"not_attempted\", null);", "        if (stored.state === \"unavailable\" && target.state !== \"deliverable\") return reply(false, NOTICE_UNAVAILABLE.read, \"unavailable\", \"not_attempted\", null);"]]],
  ["OD2-store-read-on-unknown-registry", "the store is consulted although the registry could not be read", RT,
    [["        if (target.state === \"unavailable\") return reply(false, NOTICE_UNAVAILABLE.registry, \"unavailable\", \"not_attempted\", null);\n", ""]]],
  ["OD2-stale-cleared-without-healthy-state", "a stale notice is removed although the business is not deliverable", RT,
    [["        if (target.state !== \"deliverable\") return reply(true, null, stored.state === \"present\" ? \"stale\" : \"none\", \"not_applicable\", record);", "        if (target.state !== \"deliverable\") { await clearDeliveryNotice(db, tenantId, bizId); return reply(true, null, \"none\", \"cleared\", null); }"]]],
  ["OD2-foreign-node-is-absent", "a foreign node under the notice path counts as absent (never cleared)", ED,
    [["  if (v === null || v === undefined) return { state: \"absent\" };", "  if (!isRecord(v) || v.code !== \"business_name_unavailable\") return { state: \"absent\" };"]]],
  ["OD2-deliverable-unknown-as-false", "an unreadable registry reports deliverable: false instead of unknown", RT,
    [["          const deliverable = target.state === \"unavailable\" ? null : target.state === \"deliverable\";", "          const deliverable = target.state === \"deliverable\";"]]],
  // the controls R7 must keep
  ["K-manager-allowed", "the owner gate of the authorization section is dropped (a manager reads the notice)", RT,
    [["      if (ctx.role !== \"owner\" && ctx.role !== \"super_owner\") {\n        return res.status(403).json({ error: \"owner_role_required\" });\n      }\n", ""]]],
  ["K-notice-sends", "the notice action falls through to a send", RT,
    [["      if (action === \"notice\") {\n        const reply", "      if (action === \"notice\" && false) {\n        const reply"]]],
  ["K-unknown-name-refused", "a business named \"Unknown\" is refused again (the R4 string comparison)", ED,
    [["const usableName = (name) => (typeof name === \"string\" && name.trim() !== \"\" ? name : null);", "const usableName = (name) => (typeof name === \"string\" && name.trim() !== \"\" && name.trim() !== \"Unknown\" ? name : null);"]]],
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
