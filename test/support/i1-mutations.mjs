// Run explicitly: node test/support/i1-mutations.mjs <absolute log directory> [mutant-id]
// Agent/Daily integration I1 — behavioural sensitivity of the integrated route (the scheduled path consuming buildSnapshotRun)
// and of the controls it must keep. Each mutant re-introduces ONE defect in a NEW disposable copy WITHOUT .git (no identity /
// pin / scope / layering guard can count as the catch). A committed BEHAVIOURAL test must report `not ok` with a non-zero exit;
// a syntax failure is never counted. CONTROL is an exact no-op replacement: it must pass every suite. 23 mutants: 15 on the
// integrated route, 2 on the carried builder, and the 6 R5 gate / G4 controls whose detectors moved with the integration.
import { cpSync, mkdtempSync, symlinkSync, readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = fileURLToPath(new URL("../../", import.meta.url));
const out = process.argv[2], only = process.argv[3];
if (!out || !out.startsWith("/")) throw new Error("absolute log directory required");
mkdirSync(out, { recursive: true });
const ED = "lib/emailDelivery.js", RT = "api/daily-snapshot/run.ts", SB = "src/snapshot/snapshotBuilder.ts";
const ACC = "test/acceptance/builder-delivery-acceptance.test.mjs", I1 = "test/delivery/i1-integration.test.mjs";
const R8 = "test/delivery/de1-r8-refusal-provenance.test.mjs", R7 = "test/delivery/de1-r7-notice-integrity.test.mjs", R5 = "test/delivery/de1-r5-delivery.test.mjs", R1 = "test/delivery/de1-r1-remediation.test.mjs";
const DE = "test/delivery/daily-email-delivery.test.mjs", EU = "test/delivery/email-delivery-unit.test.mjs";
const SUITES = [ACC, I1, R8, R7, R5, R1, DE, EU];

const FAILED_ROW = '        const row: Row = { tenantId: expected.tenantId, bizId: expected.bizId, businessDate: expected.businessDate, outcome: "failed", code,\n          settlement: "failed", receipt: "not_written" };\n';
const PUSH = "        results.push(row);\n      }\n";
const NOTICE = '        if (code === "business_name_unavailable") row.notice = await recordMissingNameNotice(db, { tenantId: expected.tenantId, bizId: expected.bizId, businessDate: expected.businessDate });\n';
const BROKEN = "      const broken = failureCount > 0 || unknownCount > 0 || unrecordedCount > 0 || receiptWriteFailures > 0 || discoveryFailed;";
const COMPLETE = '      const complete = !broken && run.status === "complete" && inProgressCount === 0 && deliveredCount + skippedCount === results.length;';
const RUN = "      const run = await buildSnapshotRun({ nowMs: Date.now() });";
// [id, defect class, file, [[from, to], …]]
const cases = [
  ["CONTROL", "no-op (identical bytes)", ED, [["export const HISTORY_KEEP = 10;", "export const HISTORY_KEEP = 10;"]]],
  ["I-array-adapter", "the route consumes the lossy array adapter again (only the snapshots of the run)", RT,
    [["        if (built) { snapshots.push(built); continue; }\n", "        if (built) { snapshots.push(built); continue; }\n        continue;\n"]]],
  ["I-failed-dropped", "failed builds never become rows", RT, [[PUSH, "      }\n"]]],
  ["I-failed-as-no-send", "a failed build is pushed as a contract no-send (settlement no_send)", RT,
    [[FAILED_ROW, FAILED_ROW.replace('settlement: "failed"', 'settlement: "no_send"')]]],
  ["I-failed-as-skipped", "a failed build is pushed as skipped / delivered", RT,
    [[FAILED_ROW, FAILED_ROW.replace('outcome: "failed", code,', 'outcome: "skipped", code: "already_accepted",').replace('settlement: "failed"', 'settlement: "delivered"')]]],
  ["I-failed-receipt-written", "a receipt node is written for a failed build", RT,
    [[NOTICE, NOTICE + '        await db.ref(`email_delivery/daily_snapshot/${expected.tenantId}/${expected.bizId}/${expected.businessDate}`).set({ state: "failed" });\n']]],
  ["I-failed-wrong-date", "a failed row carries no business date", RT,
    [[FAILED_ROW, FAILED_ROW.replace("businessDate: expected.businessDate, outcome", "businessDate: null, outcome")]]],
  ["I-notice-not-recorded", "a missing name records no owner notice on the scheduled path", RT, [[NOTICE, ""]]],
  ["I-notice-for-every-failure", "every failed build records a missing-name notice", RT,
    [[NOTICE, NOTICE.replace('if (code === "business_name_unavailable") ', "")]]],
  ["I-discovery-ignored", "a failed discovery does not break the run", RT, [[BROKEN, BROKEN.replace(" || discoveryFailed;", ";")]]],
  ["I-status-ignored", "complete ignores the builder's own status and the discovery", RT,
    [[BROKEN, BROKEN.replace(" || discoveryFailed;", ";")], [COMPLETE, COMPLETE.replace(' && run.status === "complete"', "")]]],
  ["I-invariant-swallowed", "a throw from the builder run is caught as an empty successful run (G7)", RT,
    [[RUN, '      let run; try { run = await buildSnapshotRun({ nowMs: Date.now() }); } catch { run = { version: "MARJIN_SNAPSHOT_BUILD_RUN/1", businessDate: "", status: "complete", discovery: { status: "complete", failures: [] }, expectedBusinesses: [], snapshots: [], failedBuilds: [], exclusions: [] }; }']]],
  ["I-delimiter-key", "rows are matched by a delimiter concatenation of the ids", RT,
    [["      const pairKey = (t: string, b: string) => JSON.stringify([t, b]);", "      const pairKey = (t: string, b: string) => `${t}|${b}`;"]]],
  ["I-exclusions-as-failures", "legitimate exclusions break the run", RT,
    [[BROKEN, BROKEN.replace(" || discoveryFailed;", " || discoveryFailed || run.exclusions.length > 0;")]]],
  ["I-gate-removed", "the route gate on built snapshots is removed (defence in depth)", RT,
    [['        if (target.state !== "deliverable") {\n          console.warn("[daily-snapshot] business not deliverable", { tenantId: snapshot.tenantId, bizId: snapshot.bizId, code: target.code });', '        if (false) {\n          console.warn("[daily-snapshot] business not deliverable", { tenantId: snapshot.tenantId, bizId: snapshot.bizId, code: target.code });']]],
  ["I-raw-failure-code", "the failed row's code is the builder's raw value, unbounded", RT,
    [['        const code = boundedCode(failure?.code) ?? "snapshot_build_failed";', '        const code = (failure as any)?.code ?? "snapshot_build_failed";'], ['        const row: Row = { tenantId: expected.tenantId', '        const row: any = { tenantId: expected.tenantId']]],
  // builder-side controls the integrated route must surface (the carried Builder, ADB-06 layer)
  ["B-nameless-placeholder", "the builder hands a nameless business over with a placeholder name", SB,
    [['  if (!usableName(business.name)) throw new SnapshotIdentityRefusal("business_name_unavailable");\n  const bizName = business.name;', '  const bizName = usableName(business.name) ? business.name : "Unknown";']]],
  ["B-failure-dropped", "the builder drops a failed build from its accounting (invariant bypassed)", SB,
    [["      failedBuilds.push({ ...identity(tenantId, bizId), code });", "      void code;"], ["  if (expectedKeys.size !== expectedBusinesses.length || accounted.length !== expectedKeys.size ||", "  if (false && expectedKeys.size !== expectedBusinesses.length || accounted.length !== accounted.length ||"]]],
  // the R5 gate / G4 controls whose committed detectors moved with the integration (DR5-04 / DR5-07 now run the real builder,
  // which refuses these identities BEFORE the gate): copied verbatim from test/support/de1-r5-mutations.mjs; on this tree they
  // must be caught by the integrated suite's defence-in-depth tests (I1-04 numeric name, I1-07b, I1-08)
  ["G4-nonstring-name-deliverable", "a non-string name is stringified", ED,
    [["const usableName = (name) => (typeof name === \"string\" && name.trim() !== \"\" ? name : null);", "const usableName = (name) => (name !== null && name !== undefined && String(name).trim() !== \"\" ? String(name) : null);"]]],
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
];

const result = [];
for (const [id, klass, file, edits] of cases) {
  if (only && id !== only) continue;
  const dir = mkdtempSync(join(tmpdir(), "i1-mut-"));
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
