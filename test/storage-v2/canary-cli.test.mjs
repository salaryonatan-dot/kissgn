// Marjin — CANARY TOOLING: CLI end-to-end over an in-memory RTDB (no network, no credentials).
// Covers CT-01 (identity), CT-08/09/10/12/13 (migration gates), CT-14/15/16/17/18 (verify/activate),
// CT-20/21 (live-check; clear-all has no command), CT-24/26/27 (classification, tokens, hold never automatic),
// CT-30/31/32 (probe lifecycle dry-run, warm-cache binding, unknown-outcome reconciliation).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import * as C from "../../tools/storage-v2/canary-contract.mjs";
import { commands, USAGE, parseArgs } from "../../tools/storage-v2/canary.mjs";
import * as X from "../support/canary-fixtures.mjs";

const restoreFetch = X.stubRulesFetch();
process.on("exit", () => restoreFetch());

function setup(over = {}) {
  const db = X.fakeRtdb(); X.seedBusiness(db, over.seed || {});
  const ev = X.tempEvidenceDir(); const m = X.manifestFor(over.manifest || {});
  const mp = X.writeJsonFile(ev, "manifest.json", m);
  const run = (cmd, extra = [], env) => X.runCli(X.args(cmd, mp, ev, m.environment, extra), { db, processEnv: env });
  return { db, ev, m, mp, run };
}
const tokenFor = (m, command, expectedRevision, sourceDigest = null) => C.confirmationToken({ manifest: m, command, expectedRevision, sourceDigest });
let ackN = 0;
const ackFile = (ev, stage, boundId) => X.writeJsonFile(ev, `ack-${stage}-${++ackN}.json`, { operationId: "canary-op-1", stage, by: "bob", at: "2026-09-25T09:00:00Z", evidenceId: boundId, checkpointId: boundId });

test("import is inert: no command table entry for clear-all, restore, repair or force (CT-21)", () => {
  const names = Object.keys(commands);
  assert.deepEqual(names.sort(), [...C.COMMANDS].sort());
  for (const bad of ["clear-all", "clearAll", "clear_all", "restore", "repair", "rollback", "force", "test-legacy-write", "probe-legacy-write"]) assert.ok(!names.includes(bad), bad);
  const src = readFileSync(new URL("../../tools/storage-v2/canary.mjs", import.meta.url), "utf8");
  assert.ok(!/submitClearAll|clearAll\(|flags\.force|flags\["force"\]|--force/.test(src), "no clear-all / force code path");
  assert.equal(parseArgs(["plan", "--manifest", "m", "--execute"]).flags.execute, true);
  assert.match(USAGE, /probe-legacy-denial/);
});

test("usage errors exit 2 without touching the database", async () => {
  const { db, run } = setup();
  const r0 = await X.runCli([], { db }); assert.equal(r0.exitCode, 2);
  const r1 = await X.runCli(["bogus", "--manifest", "x"], { db }); assert.equal(r1.exitCode, 2); assert.equal(r1.error.error, "unknown_command");
  const r2 = await run("live-check"); assert.equal(r2.exitCode, 2); assert.equal(r2.error.error, "action_required");
  assert.equal(db.writes.length, 0);
});

test("environment gates: --env required, mismatch, production-shaped manifest under emulator ⇒ 14 (CT-25)", async () => {
  const { db, mp, ev, run } = setup();
  const r0 = await X.runCli(["plan", "--manifest", mp, "--evidence-dir", ev], { db }); assert.equal(r0.exitCode, 14); assert.equal(r0.error.error, "environment_not_explicit");
  const r1 = await run("plan", [], { ...X.EMU_ENV, GOOGLE_APPLICATION_CREDENTIALS: "/x/sa.json" }); assert.equal(r1.exitCode, 14); assert.equal(r1.error.error, "credentials_forbidden_in_emulator");
  const r2 = await run("plan", [], X.PROD_ENV); assert.equal(r2.exitCode, 14); assert.equal(r2.error.error, "emulator_host_required");
  const prod = setup({ manifest: { environment: "production" } });
  const r3 = await X.runCli(X.args("plan", prod.mp, prod.ev, "emulator"), { db: prod.db }); assert.equal(r3.exitCode, 14); assert.equal(r3.error.error, "environment_mismatch");
  const r4 = await X.runCli(X.args("plan", prod.mp, prod.ev, "production"), { db: prod.db, processEnv: X.PROD_ENV }); assert.equal(r4.exitCode, 14); assert.equal(r4.error.error, "credentials_file_required");
  const r5 = await X.runCli(X.args("plan", prod.mp, prod.ev, "production"), { db: prod.db, processEnv: X.EMU_ENV }); assert.equal(r5.exitCode, 14); assert.equal(r5.error.error, "emulator_host_set_in_production");
  assert.equal(db.writes.length + prod.db.writes.length, 0);
});

test("wrong business identity ⇒ every mutating/evidence command exits 14 with zero writes (CT-01)", async () => {
  const { db, run, m } = setup({ seed: { businessName: "Other Business" } });
  for (const cmd of ["enroll", "quiesce", "abort", "capture", "migrate", "activate", "hold", "resume", "drain-check", "probe-legacy-denial", "monitor"]) {
    const extra = cmd === "monitor" ? ["--cycle", "2026-09-25"] : cmd === "activate" ? ["--checkpoint", "x"] : [];
    const r = await run(cmd, extra); assert.equal(r.exitCode, 14, cmd + " " + JSON.stringify(r.error)); assert.equal(r.error.error, "identity_mismatch", cmd);
  }
  const p = await run("plan"); assert.equal(p.exitCode, 14); assert.equal(X.readReport(p.summary.report).identity.error, "identity_mismatch");
  assert.equal(db.writes.length, 0);
  void m;
});

test("plan + preflight on a clean legacy business: PASS report, Rules fingerprint byte-equal, tokens printed (CT-02, CT-26)", async () => {
  const { db, run, m } = setup();
  const p = await run("plan"); assert.equal(p.exitCode, 0, JSON.stringify(p.error));
  const plan = X.readReport(p.summary.report);
  assert.equal(plan.environment.deployedRulesMatch, "byte"); assert.equal(plan.policy.phase, "legacy");
  assert.equal(plan.confirmationTokens.quiesce, tokenFor(m, "quiesce", 1));
  assert.equal(plan.confirmationTokens.migrate, tokenFor(m, "migrate", 1, null));
  const f = await run("preflight"); assert.equal(f.exitCode, 0, JSON.stringify(f.error));
  const rep = X.readReport(f.summary.report);
  assert.ok(["PASS", "WARNING"].includes(rep.aggregate), rep.aggregate); assert.equal(rep.reportVersion, 1); assert.equal(rep.transportMode, "admin-read-surface");
  assert.ok(rep.findings.filter((f) => f.classification !== "PASS").every((f) => /^tool_/.test(f.code)), JSON.stringify(rep.findings));
  assert.ok(rep.findings.some((x) => x.code === "rules_fingerprint_match"));
  assert.ok(rep.findings.some((x) => x.code === "identity_match"));
  assert.equal(db.writes.length, 0);
});

test("write commands are dry-run by default; --execute without/with wrong token ⇒ 15; zero writes (CT-26)", async () => {
  const { db, run, m } = setup();
  const d = await run("quiesce", ["--expected-revision", "1"]); assert.equal(d.exitCode, 0, JSON.stringify(d.error)); assert.equal(X.readReport(d.summary.report).executed, false);
  assert.equal(X.readReport(d.summary.report).confirmationToken, tokenFor(m, "quiesce", 1));
  const e = await run("quiesce", ["--expected-revision", "1", "--execute"]); assert.equal(e.exitCode, 15); assert.equal(e.error.error, "confirmation_missing");
  const w = await run("quiesce", ["--expected-revision", "1", "--execute", "--confirm", "deadbeefdeadbeef"]); assert.equal(w.exitCode, 15);
  const wrongCmd = await run("quiesce", ["--expected-revision", "1", "--execute", "--confirm", tokenFor(m, "enroll", 1)]); assert.equal(wrongCmd.exitCode, 15);
  assert.equal(db.writes.length, 0);
});

test("policy transitions: enroll refuses an existing record; quiesce/abort round trip with owned operation", async () => {
  const { db, run, m } = setup();
  const en = await run("enroll", ["--expected-revision", "0", "--execute", "--confirm", tokenFor(m, "enroll", 0)]); assert.equal(en.exitCode, 10); assert.equal(en.error.error, "policy_already_exists");
  const q = await run("quiesce", ["--expected-revision", "1", "--execute", "--confirm", tokenFor(m, "quiesce", 1)]); assert.equal(q.exitCode, 0, JSON.stringify(q.error));
  assert.equal(X.controlOf(db).phase, "quiesced"); assert.equal(X.controlOf(db).policyRevision, 2); assert.deepEqual(X.controlOf(db).operation.id, "canary-op-1");
  const stale = await run("quiesce", ["--expected-revision", "1", "--execute", "--confirm", tokenFor(m, "quiesce", 1)]); assert.equal(stale.exitCode, 10); assert.equal(stale.error.error, "wrong_phase");
  const ab = await run("abort", ["--expected-revision", "2", "--execute", "--confirm", tokenFor(m, "abort", 2)]); assert.equal(ab.exitCode, 0, JSON.stringify(ab.error));
  assert.equal(X.controlOf(db).phase, "legacy"); assert.equal(X.controlOf(db).policyRevision, 3); assert.ok(X.controlOf(db).operation == null);
  const receipts = readFileSync(join(setupDirOf(q), "actions.jsonl"), "utf8").trim().split("\n").map(JSON.parse);
  assert.ok(receipts.some((r) => r.stage === "quiesce" && r.result === "committed"));
  // absent record: enroll creates legacy at revision 1
  const fresh = setup({ seed: { control: null } });
  const en2 = await fresh.run("enroll", ["--expected-revision", "0", "--execute", "--confirm", tokenFor(fresh.m, "enroll", 0)]); assert.equal(en2.exitCode, 0, JSON.stringify(en2.error));
  assert.equal(X.controlOf(fresh.db).phase, "legacy"); assert.equal(X.controlOf(fresh.db).policyRevision, 1);
});
const setupDirOf = (r) => join(r.summary.report, "..", "..");

async function quiesceAndCapture(s, extraCapture = []) {
  const q = await s.run("quiesce", ["--expected-revision", "1", "--execute", "--confirm", tokenFor(s.m, "quiesce", 1)]); assert.equal(q.exitCode, 0, JSON.stringify(q.error));
  const att = X.writeJsonFile(s.ev, "attestation.json", X.ATTESTATION());
  const d = await s.run("drain-check", ["--interval", "1", "--writer-bound", "0", "--attest", att]); assert.equal(d.exitCode, 0, JSON.stringify(d.error) + JSON.stringify(d.summary));
  assert.equal(X.readReport(d.summary.report).verdict, "DRAIN_EVIDENCE_COMPLETE");
  const c = await s.run("capture", extraCapture); return { q, d, c, capture: c.exitCode === 0 || c.exitCode === 11 ? X.readReport(c.summary.report) : null };
}
test("drain-check: unstable fingerprint ⇒ STOP (CT-12); missing attestation ⇒ not proven; floor honoured (CT-11)", async () => {
  const s = setup();
  const notQ = await s.run("drain-check", ["--interval", "1", "--writer-bound", "0"]); assert.equal(notQ.exitCode, 10); assert.equal(X.readReport(notQ.summary.report).findings[0].code, "not_quiesced");
  await s.run("quiesce", ["--expected-revision", "1", "--execute", "--confirm", tokenFor(s.m, "quiesce", 1)]);
  const noAtt = await s.run("drain-check", ["--interval", "1", "--writer-bound", "0"]); assert.equal(noAtt.exitCode, 11); const nr = X.readReport(noAtt.summary.report);
  assert.equal(nr.verdict, "STABLE_INTERVAL"); assert.equal(nr.proven, false); assert.ok(nr.findings.some((f) => f.code === "attestation_missing"));
  const att = X.writeJsonFile(s.ev, "attestation.json", X.ATTESTATION());
  const low = await s.run("drain-check", ["--interval", "1", "--writer-bound", "5", "--attest", att]); const lr = X.readReport(low.summary.report); assert.ok(lr.findings.some((f) => f.code === "interval_below_floor")); assert.equal(lr.proven, false);
  const partial = X.writeJsonFile(s.ev, "attestation-partial.json", X.ATTESTATION({ items: { ...X.ATTESTATION().items, unknowns: ["one phone unaccounted"] } }));
  const pr = X.readReport((await s.run("drain-check", ["--interval", "1", "--writer-bound", "0", "--attest", partial])).summary.report); assert.equal(pr.proven, false); assert.ok(pr.findings.some((f) => f.code === "attestation_incomplete"));
  // Admin write mid-interval ⇒ unstable ⇒ STOP
  const p = s.run("drain-check", ["--interval", "2", "--writer-bound", "0", "--attest", att]);
  await new Promise((r) => setTimeout(r, 600)); s.db.seed(`tenants/${X.T}/biz:${X.B}:entries/_v`, JSON.stringify([...X.LEGACY_ROWS(), X.row("late", "2026-09-04")]));
  const u = await p; assert.equal(u.exitCode, 10); const ur = X.readReport(u.summary.report); assert.equal(ur.stable, false); assert.ok(ur.findings.some((f) => f.code === "unstable_fingerprint"));
  assert.ok(!/mathematical|proof/i.test(JSON.stringify(ur).replace(ur.honesty, "")), "never claims proof");
});

test("capture: requires owned quiesced; produces a COMPLETE bundle with exact raw _v bytes; migrate token bound to source digest (CT-08 precondition, CT-33)", async () => {
  const s = setup();
  const early = await s.run("capture"); assert.equal(early.exitCode, 10); assert.equal(early.error.error, "capture_requires_owned_quiesced");
  const { capture } = await quiesceAndCapture(s);
  assert.ok(capture, "captured"); assert.equal(capture.captured, true); assert.ok(["PASS", "WARNING"].includes(capture.preflightAggregate), capture.preflightAggregate);
  const pf = JSON.parse(readFileSync(join(capture.dir, "preflight.json"), "utf8"));
  assert.ok(pf.findings.filter((f) => f.classification === "WARNING").every((f) => /^tool_/.test(f.code)), "only tool-identity warnings on a work tree: " + JSON.stringify(pf.findings.filter((f) => f.classification === "WARNING").map((f) => f.code)));
  assert.ok(pf.findings.some((f) => f.code === "final_held_conditions" && f.classification === "PASS"));
  const dir = capture.dir; assert.ok(existsSync(join(dir, "COMPLETE.json")));
  const rawV = readFileSync(join(dir, "entries.raw-v.utf8"), "utf8"); assert.equal(rawV, X.entriesOf(s.db)._v);
  assert.ok(rawV.includes("יום שקט 🙂"));
  assert.equal(capture.rowCount, 3); assert.equal(capture.tokens.migrate, tokenFor(s.m, "migrate", 2, capture.sourceDigest));
  const complete = JSON.parse(readFileSync(join(dir, "COMPLETE.json"), "utf8"));
  assert.ok(complete.files.map((f) => f.name).includes("reader-baseline.json"));
  assert.equal(s.db.writes.filter((w) => w.path.includes("entries")).length, 0, "capture never writes entries");
});

test("migrate: refused when not quiesced (CT-09), stale revision (CT-10), no evidence; dry-run reports the intent (CT-30 shape)", async () => {
  const s = setup();
  const notQ = await s.run("migrate", ["--expected-revision", "1"]); assert.equal(notQ.exitCode, 10); assert.equal(notQ.error.error, "evidence_required");
  const { capture } = await quiesceAndCapture(s); assert.ok(capture);
  const dry = await s.run("migrate", ["--expected-revision", "2"]); assert.equal(dry.exitCode, 0, JSON.stringify(dry.error));
  const rep = X.readReport(dry.summary.report); assert.equal(rep.executed, false); assert.equal(rep.wouldWrite.expectedSourceDigest, capture.sourceDigest);
  assert.equal(rep.confirmationToken, tokenFor(s.m, "migrate", 2, capture.sourceDigest));
  const stale = await s.run("migrate", ["--expected-revision", "1"]); assert.equal(stale.exitCode, 10); assert.equal(stale.error.error, "stale_revision");
  // abort back to legacy: migrate must refuse before any write
  const ab = await s.run("abort", ["--expected-revision", "2", "--execute", "--confirm", tokenFor(s.m, "abort", 2)]); assert.equal(ab.exitCode, 0);
  const before = s.db.writes.length;
  const nq = await s.run("migrate", ["--expected-revision", "3", "--execute", "--confirm", tokenFor(s.m, "migrate", 3, capture.sourceDigest), "--ack", ackFile(s.ev, "migrate", capture.bundleId)]);
  assert.equal(nq.exitCode, 10); assert.equal(nq.error.error, "not_quiesced"); assert.equal(s.db.writes.length, before);
  assert.equal(C.digestV1(X.entriesOf(s.db)), capture.sourceDigest, "source intact");
});

test("migrate: source drift after capture ⇒ abort before the core runs, node preserved, conversionAttempted marked (CT-08, CT-12)", async () => {
  const s = setup();
  const { capture } = await quiesceAndCapture(s); assert.ok(capture);
  // out-of-band Admin change (owner writes are denied under quiesced; this is the injected case)
  const rows = JSON.parse(X.entriesOf(s.db)._v); rows[0].sales = "101"; s.db.seed(`tenants/${X.T}/biz:${X.B}:entries`, { _v: JSON.stringify(rows) });
  const drifted = C.digestV1(X.entriesOf(s.db));
  const r = await s.run("migrate", ["--expected-revision", "2", "--execute", "--confirm", tokenFor(s.m, "migrate", 2, capture.sourceDigest), "--ack", ackFile(s.ev, "migrate", capture.bundleId)]);
  assert.equal(r.exitCode, 10); assert.equal(r.error.error, "drain_evidence_stale", "R1-F3: the drain-bound digest no longer matches — refused before the warm read");
  assert.equal(C.digestV1(X.entriesOf(s.db)), drifted, "node untouched"); assert.ok(!X.controlOf(s.db).conversionAttempted, "no CAS marker when the pre-check fails");
  // drift INSIDE the transaction window (after warm read): bound transaction aborts, core never called
  s.db.seed(`tenants/${X.T}/biz:${X.B}:entries`, JSON.parse(readFileSync(join(capture.dir, "entries.source.json"), "utf8")));
  s.db.hooks.beforeTransaction = async (path) => { if (path.endsWith(":entries")) { rows[0].sales = "102"; s.db.seed(`tenants/${X.T}/biz:${X.B}:entries`, { _v: JSON.stringify(rows) }); } };
  const r2 = await s.run("migrate", ["--expected-revision", "2", "--execute", "--confirm", tokenFor(s.m, "migrate", 2, capture.sourceDigest), "--ack", ackFile(s.ev, "migrate", capture.bundleId)]);
  assert.equal(r2.exitCode, 13, JSON.stringify(r2.error)); const rep = X.readReport(r2.summary.report);
  assert.equal(rep.outcome.status, "SOURCE_DRIFT"); assert.equal(rep.transactionStats.coreRuns, 0); assert.equal(rep.transactionStats.drift, true);
  assert.equal(X.entriesOf(s.db).schemaVersion, undefined, "still legacy"); assert.equal(X.controlOf(s.db).conversionAttempted, true); assert.equal(X.controlOf(s.db).phase, "quiesced");
  const again = await s.run("migrate", ["--expected-revision", "3", "--execute", "--confirm", tokenFor(s.m, "migrate", 3, capture.sourceDigest), "--ack", ackFile(s.ev, "migrate", capture.bundleId)]);
  assert.equal(again.exitCode, 13); assert.equal(again.error.error, "reconcile_required", "no blind retry after an attempt");
  // the node now matches neither the captured source nor the expected V2 node ⇒ HOLD, recommendation only
  const st = await s.run("status"); assert.equal(st.exitCode, 12); const sr = X.readReport(st.summary.report).reconciliation;
  assert.equal(sr.state, "HOLD_UNRECOGNISED_STATE"); assert.equal(sr.recommendation, "REMAIN_QUIESCED_AND_ESCALATE"); assert.equal(sr.automaticTransition, false); assert.equal(X.controlOf(s.db).phase, "quiesced");
});

test("migrate happy path ⇒ MIGRATED_HELD, core exactly once, cold-cache first run tolerated (CT-13/14/15/17, CT-31); verify post PASS twice (CT-28) ⇒ checkpoint; activate needs checkpoint + ack (CT-18); hold/resume explicit only (CT-27)", async () => {
  const s = setup();
  const { capture } = await quiesceAndCapture(s); assert.ok(capture);
  s.db.hooks.coldCacheOnce = true;
  const badAck = await s.run("migrate", ["--expected-revision", "2", "--execute", "--confirm", tokenFor(s.m, "migrate", 2, capture.sourceDigest)]); assert.equal(badAck.exitCode, 15); assert.equal(badAck.error.error, "observer_ack_required");
  const r = await s.run("migrate", ["--expected-revision", "2", "--execute", "--confirm", tokenFor(s.m, "migrate", 2, capture.sourceDigest), "--ack", ackFile(s.ev, "migrate", capture.bundleId)]);
  assert.equal(r.exitCode, 0, JSON.stringify(r.error)); const rep = X.readReport(r.summary.report);
  assert.equal(rep.outcome.status, "MIGRATED_HELD"); assert.equal(rep.transactionStats.coreRuns, 1); assert.equal(rep.coreResult.status, "committed");
  assert.equal(rep.afterDigest, capture.expectedV2Digest); assert.equal(X.controlOf(s.db).phase, "quiesced"); assert.equal(X.controlOf(s.db).conversionAttempted, true); assert.equal(X.controlOf(s.db).policyRevision, 3);
  const node = X.entriesOf(s.db); assert.equal(node.schemaVersion, 2); assert.equal(node._v, readFileSync(join(capture.dir, "entries.raw-v.utf8"), "utf8"));
  const v1 = await s.run("verify", ["--phase", "post"]); assert.equal(v1.exitCode, 0, JSON.stringify(v1.error)); const vr1 = X.readReport(v1.summary.report);
  assert.equal(vr1.classification.level, "OK"); assert.ok(vr1.checkpointId.startsWith("post-")); assert.ok(vr1.findings.some((f) => f.code === "no_v_fallback")); assert.ok(vr1.findings.some((f) => f.code === "reader_parity"));
  const v2 = await s.run("verify", ["--phase", "post"]); const vr2 = X.readReport(v2.summary.report);
  assert.deepEqual(vr2.findings, vr1.findings, "repeatable"); assert.equal(vr2.checkpointId, vr1.checkpointId);
  const noCp = await s.run("activate", ["--expected-revision", "3", "--execute", "--confirm", tokenFor(s.m, "activate", 3, C.digestV1(node))]); assert.equal(noCp.exitCode, 10); assert.equal(noCp.error.error, "checkpoint_required");
  const noAck = await s.run("activate", ["--checkpoint", vr1.checkpointId, "--expected-revision", "3", "--execute", "--confirm", tokenFor(s.m, "activate", 3, C.digestV1(node))]); assert.equal(noAck.exitCode, 15);
  const act = await s.run("activate", ["--checkpoint", vr1.checkpointId, "--expected-revision", "3", "--execute", "--confirm", tokenFor(s.m, "activate", 3, C.digestV1(node)), "--ack", ackFile(s.ev, "activate", vr1.checkpointId)]);
  assert.equal(act.exitCode, 0, JSON.stringify(act.error));
  const ctl = X.controlOf(s.db); assert.equal(ctl.phase, "v2_active"); assert.equal(ctl.policyRevision, 4); assert.equal(ctl.minStorageProtocol, 2); assert.equal(ctl.allowV2Initialization, false); assert.ok(ctl.operation == null);
  const va = await s.run("verify", ["--phase", "active"]); assert.equal(va.exitCode, 0, JSON.stringify(va.error));
  // STOP finding under v2_active ⇒ recommendation only, NO transition
  s.db.seed(`tenants/${X.T}/biz:${X.B}:entries`, { ...node, rows: { ...node.rows, junk: { id: "junk" } } });
  const vs = await s.run("verify", ["--phase", "active"]); assert.equal(vs.exitCode, 12); const vsr = X.readReport(vs.summary.report);
  assert.equal(vsr.recommendation, "RECOVERY_HOLD_RECOMMENDED"); assert.equal(vsr.automaticTransition, false); assert.equal(X.controlOf(s.db).phase, "v2_active", "never auto-held");
  const hd = await s.run("hold", ["--expected-revision", "4"]); assert.equal(hd.exitCode, 0, JSON.stringify(hd.error)); assert.equal(X.controlOf(s.db).phase, "v2_active", "dry-run hold does not transition");
  const hx = await s.run("hold", ["--expected-revision", "4", "--execute", "--confirm", tokenFor(s.m, "hold", 4), "--reason", "inc-1"]); assert.equal(hx.exitCode, 0, JSON.stringify(hx.error));
  assert.equal(X.controlOf(s.db).phase, "recovery_hold"); assert.equal(X.controlOf(s.db).operation.kind, "recovery");
  const rs = await s.run("resume", ["--expected-revision", "5", "--execute", "--confirm", tokenFor(s.m, "resume", 5)]); assert.equal(rs.exitCode, 0, JSON.stringify(rs.error)); assert.equal(X.controlOf(s.db).phase, "v2_active");
});

test("unknown outcome: transport throws after the CAS marker ⇒ status reconciles A2 (source intact) / B (V2 present) (CT-32)", async () => {
  const s = setup(); const { capture } = await quiesceAndCapture(s); assert.ok(capture);
  const hangup = () => Object.assign(new Error("socket hang up"), { code: "ECONNRESET" });
  s.db.hooks.throwAfterCommit = (path) => (path.startsWith("storage_v2_control/") ? hangup() : null);
  const r = await s.run("migrate", ["--expected-revision", "2", "--execute", "--confirm", tokenFor(s.m, "migrate", 2, capture.sourceDigest), "--ack", ackFile(s.ev, "migrate", capture.bundleId)]);
  assert.equal(r.exitCode, 13, JSON.stringify(r.error)); const rep = X.readReport(r.summary.report); assert.equal(rep.outcome.status, "UNKNOWN_OR_REFUSED");
  const st = await s.run("status"); const sr = X.readReport(st.summary.report); assert.equal(sr.reconciliation.state, "A2_SOURCE_INTACT_AFTER_ATTEMPT"); assert.equal(sr.reconciliation.level, "OK");
  assert.equal(X.controlOf(s.db).conversionAttempted, true); assert.equal(X.entriesOf(s.db).schemaVersion, undefined);
  const again = await s.run("migrate", ["--expected-revision", "3", "--execute", "--confirm", tokenFor(s.m, "migrate", 3, capture.sourceDigest), "--ack", ackFile(s.ev, "migrate", capture.bundleId)]);
  assert.equal(again.exitCode, 13); assert.equal(again.error.error, "reconcile_required");
  // the same failure AFTER the entries commit ⇒ B (converted, held)
  const s2 = setup(); const c2 = await quiesceAndCapture(s2); assert.ok(c2.capture);
  s2.db.hooks.throwAfterCommit = (path) => (path.endsWith(":entries") ? hangup() : null);
  const r2 = await s2.run("migrate", ["--expected-revision", "2", "--execute", "--confirm", tokenFor(s2.m, "migrate", 2, c2.capture.sourceDigest), "--ack", ackFile(s2.ev, "migrate", c2.capture.bundleId)]);
  assert.equal(r2.exitCode, 13, JSON.stringify(r2.error)); assert.equal(X.readReport(r2.summary.report).outcome.status, "NOT_COMMITTED");
  const st2 = await s2.run("status"); const sr2 = X.readReport(st2.summary.report); assert.equal(sr2.reconciliation.state, "B_CONVERTED_HELD"); assert.equal(sr2.reconciliation.mode, "v2");
  assert.equal(X.entriesOf(s2.db).schemaVersion, 2, "the commit happened; the tool reports it instead of retrying");
});

test("live-check: create/edit/delete observed and reconciled; generation change ⇒ STOP; no clear-all action (CT-20/21)", async () => {
  const s = setup(); const { capture } = await quiesceAndCapture(s); assert.ok(capture);
  await s.run("migrate", ["--expected-revision", "2", "--execute", "--confirm", tokenFor(s.m, "migrate", 2, capture.sourceDigest), "--ack", ackFile(s.ev, "migrate", capture.bundleId)]);
  const v = await s.run("verify", ["--phase", "post"]); const cp = X.readReport(v.summary.report).checkpointId;
  const node = X.entriesOf(s.db);
  await s.run("activate", ["--checkpoint", cp, "--expected-revision", "3", "--execute", "--confirm", tokenFor(s.m, "activate", 3, C.digestV1(node)), "--ack", ackFile(s.ev, "activate", cp)]);
  const H = C.helpersFrom((await import("../../tools/storage-v2/production-window.mjs")).loadProductionWindow());
  const key = `tenants/${X.T}/biz:${X.B}:entries`;
  const b = await s.run("live-check", ["--action", "create", "--step", "before"]); assert.equal(b.exitCode, 0, JSON.stringify(b.error));
  const newId = X.uuid("live"); const planned = { ...X.LIVE_ROW(), id: newId };
  s.db.seed(key + "/rows/" + newId, H.stampRow(planned, 1));
  const a = await s.run("live-check", ["--action", "create", "--step", "after"]); assert.equal(a.exitCode, 0, JSON.stringify(a.error)); const ar = X.readReport(a.summary.report);
  assert.deepEqual(ar.diff.added, [newId]); assert.equal(ar.liveRowId, newId); assert.equal(ar.frozenVUnchanged, true); assert.equal(ar.classification.level, "OK");
  const eb = await s.run("live-check", ["--action", "edit", "--step", "before"]); assert.equal(eb.exitCode, 0);
  s.db.seed(key + "/rows/" + newId + "/sales", "34");
  const ea = await s.run("live-check", ["--action", "edit", "--step", "after"]); const er = X.readReport(ea.summary.report); assert.equal(er.classification.level, "OK", JSON.stringify(er.findings)); assert.deepEqual(er.diff.changed.map((c) => c.id), [newId]);
  const db0 = await s.run("live-check", ["--action", "delete", "--step", "before"]); assert.equal(db0.exitCode, 0);
  s.db.seed(key + "/rows/" + newId, null);
  const da = await s.run("live-check", ["--action", "delete", "--step", "after"]); const dr = X.readReport(da.summary.report); assert.equal(dr.classification.level, "OK", JSON.stringify(dr.findings)); assert.deepEqual(dr.diff.removed, [newId]);
  // a generation change (clear-all from a client) during an observation ⇒ STOP, recommendation only
  const s2 = setup({ seed: { entries: X.asV2(X.LEGACY_ROWS(), { keepV: true }), control: X.ACTIVE() } });
  const b2 = await s2.run("live-check", ["--action", "create", "--step", "before"]); assert.equal(b2.exitCode, 0, JSON.stringify(b2.error));
  s2.db.seed(`tenants/${X.T}/biz:${X.B}:entries`, { schemaVersion: 2, generation: 2, _v: X.entriesOf(s2.db)._v });
  const a2 = await s2.run("live-check", ["--action", "create", "--step", "after"]); assert.equal(a2.exitCode, 12); const r2 = X.readReport(a2.summary.report);
  assert.ok(r2.findings.some((f) => f.code === "generation_changed_without_clear" && f.level === "STOP"), JSON.stringify(r2.findings)); assert.equal(r2.automaticTransition, false); assert.equal(X.controlOf(s2.db).phase, "v2_active");
  const bad = await s2.run("live-check", ["--action", "clear-all"]); assert.equal(bad.exitCode, 2);
});

test("monitor: cycle record appended, idempotent re-run, correction on change; window arithmetic never counts UNKNOWN as PASS (CT-23)", async () => {
  const s = setup({ seed: { entries: X.asV2(X.LEGACY_ROWS(), { keepV: true }), control: X.ACTIVE() } });
  const rec = X.writeJsonFile(s.ev, "receipts.json", { creates: 0, deletes: 0, edits: 0, ui: { status: "PRESENT", by: "bob" }, snapshotEmail: { messageId: "m1", recipient: "owner@example" }, alerts: { ran: true } });
  const m1 = await s.run("monitor", ["--cycle", "2026-09-02", "--receipts", rec]); assert.equal(m1.exitCode, 0, JSON.stringify(m1.error)); const r1 = X.readReport(m1.summary.report);
  assert.equal(r1.appended, true); assert.equal(r1.record.cycle, "INCOMPLETE", "derived docs missing ⇒ INCOMPLETE, never PASS");
  assert.ok(!JSON.stringify(r1.record).includes("owner@example"), "recipient is hashed");
  const m1b = await s.run("monitor", ["--cycle", "2026-09-02", "--receipts", rec]); assert.equal(X.readReport(m1b.summary.report).appended, false);
  s.db.seed(`tenants/${X.T}/biz:${X.B}:analytics:daily:2026-09-02`, { date: "2026-09-02", revenue: { total: 250 } });
  const m1c = await s.run("monitor", ["--cycle", "2026-09-02", "--receipts", rec]); const r1c = X.readReport(m1c.summary.report); assert.equal(r1c.appended, true); assert.equal(r1c.reason, "correction"); assert.equal(r1c.record.correction, 1);
  const ledger = readdirSync(join(s.ev, "canary-op-1", "ledger")); assert.ok(ledger.includes("cycle-2026-09-02.json") && ledger.includes("cycle-2026-09-02-c1.json"));
  assert.equal(r1c.window.windowMet, false); assert.ok(r1c.window.cleanStreak <= 1);
  const st = await s.run("status"); assert.equal(st.exitCode, 0); assert.equal(X.readReport(st.summary.report).window.windowMet, false);
});

test("probe-legacy-denial (Option B): dry-run lists only the control same-value PUT and the authenticated read; no entries write path exists", async () => {
  const s = setup();
  const d = await s.run("probe-legacy-denial", ["--expected-revision", "1"]); assert.equal(d.exitCode, 0, JSON.stringify(d.error)); const r = X.readReport(d.summary.report);
  assert.equal(r.option, "B"); assert.equal(r.executed, false); assert.equal(r.wouldAttempt.length, 2); assert.ok(r.wouldAttempt.every((x) => !/entries[^,]*PUT|\/_v\b|"_v"/.test(x)), JSON.stringify(r.wouldAttempt));
  assert.ok(r.evidenceRefs.emulator.length >= 4);
  const src = readFileSync(new URL("../../tools/storage-v2/canary-transport.mjs", import.meta.url), "utf8");
  assert.ok(!/entries[^\n]*method: "PUT"|_v[^\n]*method: "PUT"/.test(src), "transport has no legacy-shape write probe");
  assert.equal(s.db.writes.length, 0);
});

// ── R1 FINDING 1: operator-supplied expected revision is mandatory for every write command ──
test("R1-F1 expected revision: missing / malformed / stale ⇒ typed refusal with zero writes; exact ⇒ proceeds; token for N with N+1 ⇒ refused", async () => {
  const cases = [
    { cmd: "enroll", seed: { control: null }, observed: 0 },
    { cmd: "quiesce", seed: {}, observed: 1 },
    { cmd: "abort", seed: { control: X.QUIESCED() }, observed: 2 },
    { cmd: "hold", seed: { entries: X.asV2(X.LEGACY_ROWS(), { keepV: true }), control: X.ACTIVE() }, observed: 4 },
    { cmd: "resume", seed: { entries: X.asV2(X.LEGACY_ROWS(), { keepV: true }), control: X.POLICY({ phase: "recovery_hold", policyRevision: 5, minStorageProtocol: 2, operation: { id: "recovery-canary-op-1", kind: "recovery", owner: "alice", startedAt: 1 } }) }, observed: 5 },
    { cmd: "probe-legacy-denial", seed: {}, observed: 1 },
  ];
  for (const c of cases) {
    const s = setup({ seed: c.seed }); const before = s.db.writes.length; const tok = tokenFor(s.m, c.cmd, c.observed);
    const a = await s.run(c.cmd, ["--execute", "--confirm", tok]); assert.equal(a.exitCode, 10, c.cmd + " A"); assert.equal(a.error.error, "expected_revision_required", c.cmd + " A");
    const a2 = await s.run(c.cmd); assert.equal(a2.error.error, "expected_revision_required", c.cmd + " dry-run also requires it");
    for (const bad of ["abc", "1.5", "-1", "", "0x1", "9007199254740992"]) { const b = await s.run(c.cmd, ["--expected-revision", bad, "--execute", "--confirm", tok]); assert.equal(b.exitCode, 10, c.cmd + " B " + bad); assert.equal(b.error.error, "expected_revision_invalid", c.cmd + " B " + bad); }
    const st = await s.run(c.cmd, ["--expected-revision", String(c.observed + 1), "--execute", "--confirm", tok]); assert.equal(st.exitCode, 10, c.cmd + " C"); assert.equal(st.error.error, "stale_revision", c.cmd + " C");
    if (c.observed > 0) { const st2 = await s.run(c.cmd, ["--expected-revision", String(c.observed - 1), "--execute", "--confirm", tok]); assert.equal(st2.exitCode, 10, c.cmd + " C-"); assert.equal(st2.error.error, "stale_revision", c.cmd + " C-"); }
    // E: the tool DID read the current record (plan shows it) yet still refuses without the operator's statement
    const p = await s.run("plan"); assert.equal(X.readReport(p.summary.report).tokensForRevision, c.observed, c.cmd + " E");
    assert.equal(s.db.writes.length, before, c.cmd + " zero writes");
    // D: exact revision passes the gate (dry-run proves the gate; executed paths are covered by the lifecycle tests)
    const ok = await s.run(c.cmd, ["--expected-revision", String(c.observed)]); assert.equal(ok.exitCode, 0, c.cmd + " D " + JSON.stringify(ok.error)); assert.equal(X.readReport(ok.summary.report).executed, false);
    // F: a token minted for N presented with --expected-revision N+1 ⇒ refused
    const f = await s.run(c.cmd, ["--expected-revision", String(c.observed + 1), "--execute", "--confirm", tok]); assert.equal(f.exitCode, 10, c.cmd + " F"); assert.equal(f.error.error, "stale_revision");
    assert.equal(s.db.writes.length, before, c.cmd + " zero writes after F");
  }
  // F′: the record moved to N+1 (a real transition) and the operator restates N+1 with the OLD token(N) ⇒ token mismatch, refused
  const s = setup(); await s.run("quiesce", ["--expected-revision", "1", "--execute", "--confirm", tokenFor(s.m, "quiesce", 1)]);
  const w = s.db.writes.length;
  const f2 = await s.run("abort", ["--expected-revision", "2", "--execute", "--confirm", tokenFor(s.m, "abort", 1)]); assert.equal(f2.exitCode, 15); assert.equal(f2.error.error, "confirmation_mismatch"); assert.equal(s.db.writes.length, w);
  // migrate and activate families
  const m = setup(); const { capture } = await quiesceAndCapture(m); assert.ok(capture);
  const mm = await m.run("migrate", ["--execute", "--confirm", tokenFor(m.m, "migrate", 2, capture.sourceDigest), "--ack", ackFile(m.ev, "migrate", capture.bundleId)]); assert.equal(mm.error.error, "expected_revision_required");
  const mb = await m.run("migrate", ["--expected-revision", "two", "--execute", "--confirm", tokenFor(m.m, "migrate", 2, capture.sourceDigest), "--ack", ackFile(m.ev, "migrate", capture.bundleId)]); assert.equal(mb.error.error, "expected_revision_invalid");
  const ms = await m.run("migrate", ["--expected-revision", "3", "--execute", "--confirm", tokenFor(m.m, "migrate", 2, capture.sourceDigest), "--ack", ackFile(m.ev, "migrate", capture.bundleId)]); assert.equal(ms.error.error, "stale_revision");
  assert.equal(X.entriesOf(m.db).schemaVersion, undefined, "no conversion"); assert.ok(!X.controlOf(m.db).conversionAttempted, "no CAS marker");
  const mok = await m.run("migrate", ["--expected-revision", "2", "--execute", "--confirm", tokenFor(m.m, "migrate", 2, capture.sourceDigest), "--ack", ackFile(m.ev, "migrate", capture.bundleId)]); assert.equal(mok.exitCode, 0, JSON.stringify(mok.error));
  const v = await m.run("verify", ["--phase", "post"]); const cp = X.readReport(v.summary.report).checkpointId; const d = C.digestV1(X.entriesOf(m.db));
  const am = await m.run("activate", ["--checkpoint", cp, "--execute", "--confirm", tokenFor(m.m, "activate", 3, d), "--ack", ackFile(m.ev, "activate", cp)]); assert.equal(am.error.error, "expected_revision_required");
  const as = await m.run("activate", ["--checkpoint", cp, "--expected-revision", "2", "--execute", "--confirm", tokenFor(m.m, "activate", 3, d), "--ack", ackFile(m.ev, "activate", cp)]); assert.equal(as.error.error, "stale_revision");
  assert.equal(X.controlOf(m.db).phase, "quiesced");
  const aok = await m.run("activate", ["--checkpoint", cp, "--expected-revision", "3", "--execute", "--confirm", tokenFor(m.m, "activate", 3, d), "--ack", ackFile(m.ev, "activate", cp)]); assert.equal(aok.exitCode, 0, JSON.stringify(aok.error)); assert.equal(X.controlOf(m.db).phase, "v2_active");
});

// ── R1 FINDING 3: drain evidence is bound to the exact state it observed ──
test("R1-F3 drain binding: capture after entries / policy / exceptions / context change ⇒ DRAIN_EVIDENCE_STALE; restored state ⇒ accepted by digest; migrate revalidates and never reaches the core on a mismatch", async () => {
  const s = setup(); await s.run("quiesce", ["--expected-revision", "1", "--execute", "--confirm", tokenFor(s.m, "quiesce", 1)]);
  const att = X.writeJsonFile(s.ev, "attestation.json", X.ATTESTATION());
  const drain = async () => { const d = await s.run("drain-check", ["--interval", "1", "--writer-bound", "0", "--attest", att]); assert.equal(d.exitCode, 0, JSON.stringify(d.error)); return X.readReport(d.summary.report); };
  const key = `tenants/${X.T}/biz:${X.B}:entries`;
  const d1 = await drain();
  assert.ok(d1.bound && d1.bound.accepted && d1.bound.start && d1.bound.mid && d1.bound.end, "start/mid/end + accepted digests recorded");
  assert.equal(d1.bound.accepted.entries, C.digestV1(X.entriesOf(s.db))); assert.equal(d1.bound.policyRevision, 2); assert.equal(d1.bound.phase, "quiesced"); assert.equal(d1.bound.operation.id, "canary-op-1");
  // B: entries change after the drain ⇒ capture refused, nothing captured
  const stateA = X.entriesOf(s.db); const rows = JSON.parse(stateA._v); rows[0].sales = "999";
  s.db.seed(key, { _v: JSON.stringify(rows) });
  const cB = await s.run("capture"); assert.equal(cB.exitCode, 11); assert.equal(cB.error.error, "drain_evidence_stale"); assert.ok(/entries/.test(cB.error.detail));
  assert.equal(E_listBundles(s), 0, "no bundle written");
  // E: restore A ⇒ the bound evidence agrees again ⇒ accepted (digests, not timestamps, decide)
  s.db.seed(key, stateA);
  const cE = await s.run("capture"); assert.equal(cE.exitCode, 0, JSON.stringify(cE.error)); const capE = X.readReport(cE.summary.report);
  const bundled = JSON.parse(readFileSync(join(capE.dir, "drain.json"), "utf8")); assert.equal(bundled.bound.accepted.entries, capE.sourceDigest); assert.equal(bundled.binding.status, "BOUND");
  // C: policy revision change (same phase/owner) ⇒ stale
  const s2 = setup(); await s2.run("quiesce", ["--expected-revision", "1", "--execute", "--confirm", tokenFor(s2.m, "quiesce", 1)]);
  const att2 = X.writeJsonFile(s2.ev, "attestation.json", X.ATTESTATION());
  const dr2 = await s2.run("drain-check", ["--interval", "1", "--writer-bound", "0", "--attest", att2]); assert.equal(dr2.exitCode, 0);
  s2.db.seed(`storage_v2_control/${X.T}/${X.B}/policyRevision`, 3);
  const cC = await s2.run("capture"); assert.equal(cC.exitCode, 11); assert.equal(cC.error.error, "drain_evidence_stale"); assert.ok(/policyRevision/.test(cC.error.detail) && /control/.test(cC.error.detail));
  s2.db.seed(`storage_v2_control/${X.T}/${X.B}/policyRevision`, 2);
  // D: exceptions change ⇒ stale; context (config) change ⇒ stale
  s2.db.seed(`tenants/${X.T}/entry_exceptions/${X.B}/2026-09-03`, { state: { status: "active", reasonCode: "x", revision: 1 } });
  const cD = await s2.run("capture"); assert.equal(cD.error.error, "drain_evidence_stale"); assert.ok(/exceptions/.test(cD.error.detail));
  s2.db.seed(`tenants/${X.T}/entry_exceptions/${X.B}`, null);
  s2.db.seed(`tenants/${X.T}/biz:${X.B}:fixed`, { _v: JSON.stringify([{ name: "rent", amount: "1" }]) });
  const cD2 = await s2.run("capture"); assert.equal(cD2.error.error, "drain_evidence_stale"); assert.ok(/context/.test(cD2.error.detail));
  // no drain at all ⇒ capture proceeds only as OPERATOR_ACTION_REQUIRED (unchanged behaviour), and migrate refuses without a bound drain
  // G: bound evidence captured, then the state moves before migrate ⇒ migrate refuses BEFORE the CAS marker and the core (zero writes)
  const s3 = setup(); const { capture: cap3 } = await quiesceAndCapture(s3); assert.ok(cap3);
  s3.db.seed(`tenants/${X.T}/biz:${X.B}:fixed`, { _v: JSON.stringify([{ name: "rent", amount: "2" }]) });
  const w3 = s3.db.writes.length;
  const g = await s3.run("migrate", ["--expected-revision", "2", "--execute", "--confirm", tokenFor(s3.m, "migrate", 2, cap3.sourceDigest), "--ack", ackFile(s3.ev, "migrate", cap3.bundleId)]);
  assert.equal(g.exitCode, 10); assert.equal(g.error.error, "drain_evidence_stale"); assert.equal(s3.db.writes.length, w3, "zero writes"); assert.ok(!X.controlOf(s3.db).conversionAttempted); assert.equal(X.entriesOf(s3.db).schemaVersion, undefined);
  // F: restore ⇒ evidence digest == drain digest == current ⇒ migrate proceeds, plan records the drain-bound digest
  s3.db.seed(`tenants/${X.T}/biz:${X.B}:fixed`, { _v: "[]" });
  const dry = await s3.run("migrate", ["--expected-revision", "2"]); assert.equal(dry.exitCode, 0, JSON.stringify(dry.error)); const plan = X.readReport(dry.summary.report).wouldWrite; assert.equal(plan.drainBoundDigest, plan.expectedSourceDigest); assert.equal(plan.drainPolicyRevision, 2);
  const f = await s3.run("migrate", ["--expected-revision", "2", "--execute", "--confirm", tokenFor(s3.m, "migrate", 2, cap3.sourceDigest), "--ack", ackFile(s3.ev, "migrate", cap3.bundleId)]); assert.equal(f.exitCode, 0, JSON.stringify(f.error)); assert.equal(X.readReport(f.summary.report).outcome.status, "MIGRATED_HELD");
});
const E_listBundles = (s) => readdirSync(join(s.ev, "canary-op-1")).filter((n) => !["reports", "ledger", "live", "actions.jsonl"].includes(n) && !n.startsWith("ack-") && !n.startsWith("attestation") && !n.startsWith("manifest")).length;
