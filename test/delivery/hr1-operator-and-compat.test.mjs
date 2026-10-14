// HR1 — the operator tool (tools/daily-delivery/hold.mjs) and deployment / rollback compatibility.
//   OT-01  status / init / hold / release through the tool's command runner: confirmation, expected version, audit log
//   OT-02  the drain evidence report: criteria C1–C7, the P7 population, the time bound; never "quiescent" / "drained"
//   OT-03  the tool's deadline constant is lib/sendEmail.js SEND_DEADLINE_MS
//   CP-01  an earlier lineage (exact I7 bytes of lib/emailDelivery.js) IGNORES the hold: it re-claims a G3-held receipt at the
//          same attempt and sends (forward-only while held; Instant Rollback ends a hold) — and HR1 honours every receipt an
//          earlier lineage wrote (no receipt format or state change)
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, cpSync, writeFileSync, symlinkSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { makeDb } from "../../tools/storage-v2/reader-sandbox.mjs";
import { sdkTransactions, releasedHoldRecord, REPO } from "../support/daily-email-harness.mjs";
import * as E from "../../lib/emailDelivery.js";
import * as Tool from "../../tools/daily-delivery/hold.mjs";

const I7 = "5bae812c9fde9f58bd9d1bc359dd3855c4658cf1";
const NOW = Date.parse("2026-09-08T05:00:00Z");
const P = "demo-marjin-rules";
const freshDb = () => { const db = makeDb(); sdkTransactions(db, ""); return db; };

test("OT-01 the operator tool: status / init / hold / release with confirmation, expected version and one log entry per change", async () => {
  const db = freshDb();
  let r = await Tool.runCommand(db, "status", {}, { project: P });
  assert.deepEqual([r.exitCode, r.result.gates, r.result.code, r.result.recordPresent], [0, "held", "delivery_hold_unreadable", false]);
  r = await Tool.runCommand(db, "init", { actor: "op1", reason: "bootstrap" }, { project: P, nowMs: 1 });
  assert.deepEqual([r.exitCode, r.result.error], [Tool.EXIT.REFUSED, "confirmation_required"]);
  assert.equal(db.read(E.DELIVERY_HOLD_PATH), null, "nothing written without the confirmation");
  r = await Tool.runCommand(db, "init", { actor: "op1", reason: "bootstrap", confirm: "init@other-project" }, { project: P, nowMs: 1 });
  assert.equal(r.exitCode, Tool.EXIT.REFUSED, "the confirmation names the VERIFIED project");
  r = await Tool.runCommand(db, "init", { actor: "op1", reason: "bootstrap", confirm: `init@${P}` }, { project: P, nowMs: 1 });
  assert.deepEqual([r.exitCode, r.result.code, r.result.state, r.result.version], [0, "applied", "held", 1]);
  r = await Tool.runCommand(db, "release", { actor: "op1", reason: "enable", confirm: `release@${P}` }, { project: P, nowMs: 2 });
  assert.deepEqual([r.exitCode, r.result.code], [Tool.EXIT.REFUSED, "invalid_request"], "a change needs --expect-version");
  r = await Tool.runCommand(db, "release", { actor: "op1", reason: "enable", "expect-version": "1", confirm: `release@${P}` }, { project: P, nowMs: 2 });
  assert.deepEqual([r.exitCode, r.result.state, r.result.version], [0, "released", 2]);
  r = await Tool.runCommand(db, "hold", { actor: "op2", reason: "incident", "expect-version": "1", confirm: `hold@${P}` }, { project: P, nowMs: 3 });
  assert.deepEqual([r.exitCode, r.result.code], [Tool.EXIT.REFUSED, "version_conflict"]);
  db.seed(E.heldDatePath("2026-09-08"), { businessDate: "2026-09-08" });
  r = await Tool.runCommand(db, "status", {}, { project: P });
  assert.deepEqual([r.result.gates, r.result.version, r.result.log.map((x) => x.action), r.result.heldDates], ["released", 2, ["init", "release"], ["2026-09-08"]]);
  assert.equal((await Tool.runCommand(db, "unhold", {}, { project: P })).exitCode, Tool.EXIT.USAGE);
  assert.deepEqual(Tool.parseArgs(["hold", "--project=x", "--expect-version=3", "--logs-attested"]), { _: ["hold"], project: "x", "expect-version": "3", "logs-attested": true });
  assert.equal(Tool.actualProjectId({ options: { projectId: "p1" } }), "p1");
});

test("OT-02 the drain evidence report: C1–C7, the P7 population and the time bound; evidence for an owner, never a proof", async () => {
  const heldRec = { ...releasedHoldRecord(), state: "held", version: 3, log: { ...releasedHoldRecord().log, v000000003: { action: "hold", state: "held", version: 3, prevVersion: 2, actor: "op", reason: "incident", at: NOW - 3_600_000 } } };
  const rc = (state, businessDate, extra = {}) => ({ v: E.RECEIPT_VERSION, kind: E.DAILY_SNAPSHOT_KIND,
    tenantId: "t1", bizId: "b1", businessDate, claimId: "claim-1", recipientHash: "a".repeat(64), history: [], state, attempt: 1, ...extra });
  const receipts = { t1: { b1: {
    "2026-09-08": rc("accepted", "2026-09-08"),
    "2026-09-07": rc("unknown", "2026-09-07", { outcome: { code: "provider_connection_lost" }, messageIdHeader: "<m1>" }),
    "2026-09-06": rc("sending", "2026-09-06", { leaseUntil: NOW - 1 }),
    "2026-09-05": rc("claimed", "2026-09-05", { leaseUntil: NOW - 1, history: [{ state: "held_before_send" }] }),
  } } };
  const mr = (state, attemptId, extra = {}) => ({ v: E.MANUAL_ATTEMPT_VERSION, kind: E.DAILY_SNAPSHOT_KIND,
    tenantId: "t1", bizId: "b1", attemptId, state, startedAt: NOW - 1, settledAt: NOW, messageIdHeader: "<m2>", ...extra });
  const manual = { t1: { b1: { a1: mr("accepted", "a1"), a2: mr("unknown", "a2", { code: "provider_connection_lost" }) } } };
  const full = { holdRaw: heldRec, receiptsRaw: receipts, manualRaw: manual, nowMs: NOW, maxDurationMs: 300_000,
    inventoryAttested: true, logsAttested: true, invocationReceiptAttested: true, providerAttested: true };
  let r = Tool.drainEvidence(full);
  assert.equal(r.verdict, "EVIDENCE_COMPLETE_FOR_OWNER_REVIEW");
  assert.equal(r.hold.tHold, NOW - 3_600_000);
  assert.deepEqual(r.p7Population.scheduledUnknown.map((x) => x.id), ["t1/b1/2026-09-07"]);
  assert.deepEqual(r.p7Population.scheduledSendingExpired.map((x) => x.id), ["t1/b1/2026-09-06"]);
  assert.deepEqual(r.p7Population.manualUnknown.map((x) => x.id), ["t1/b1/a2"]);
  assert.deepEqual(r.notHandedOver.scheduledHeldBeforeSend.map((x) => x.id), ["t1/b1/2026-09-05"]);
  assert.equal(r.timeBound.earliestMs, NOW - 3_600_000 + 300_000 + Tool.SEND_DEADLINE_MS + E.CLAIM_LEASE_MS + Tool.DRAIN_MARGIN_MS);
  // each missing input or live activity ⇒ ABORT_D, with the criterion that failed
  const cases = [
    [{ maxDurationMs: null }, "C4_time_bound_passed", "not_evaluable"],
    [{ maxDurationMs: 7_200_000 }, "C4_time_bound_passed", "not_met"],
    [{ inventoryAttested: false }, "C5_every_reachable_deployment_gated", "not_evaluable"],
    [{ logsAttested: false }, "C6_hosted_logs_complete", "not_evaluable"],
    [{ providerAttested: false }, "C7_provider_evidence_for_unresolved_manual", "not_evaluable"],
    [{ holdRaw: releasedHoldRecord() }, "C1_hold_continuously_held", "not_met"],
    [{ holdRaw: { ...heldRec, version: 4 } }, "C1_hold_continuously_held", "not_met"],
    [{ receiptsRaw: { t1: { b1: { "2026-09-08": rc("sending", "2026-09-08", { leaseUntil: NOW + 1000 }) } } } }, "C2_no_live_scheduled_claim", "not_met"],
    [{ receiptsRaw: { t1: { b1: { "2026-09-08": "garbage" } } } }, "C2_no_live_scheduled_claim", "not_met"],
    [{ manualRaw: { t1: { b1: { a3: mr("handing_off", "a3", { startedAt: 1 }) } } } }, "C3_no_manual_attempt_handing_off", "not_met"],
  ];
  for (const [over, criterion, value] of cases) {
    r = Tool.drainEvidence({ ...full, ...over });
    assert.equal(r.verdict, "ABORT_D", criterion); assert.equal(r.criteria[criterion], value, criterion);
  }
  r = Tool.drainEvidence({ holdRaw: heldRec, receiptsRaw: null, manualRaw: null, nowMs: NOW });
  assert.equal(r.verdict, "ABORT_D", "without hosted evidence the tool never completes");
  for (const x of [Tool.drainEvidence(full), r]) assert.doesNotMatch(JSON.stringify(x), /QUIESCENT|DRAINED|nothing sent/i);
  // the runner reads the live tree once and maps ABORT_D to a non-zero exit
  const db = freshDb(); db.seed(E.DELIVERY_HOLD_PATH, heldRec); db.seed("email_delivery/daily_snapshot", receipts); db.seed(E.MANUAL_ATTEMPT_ROOT, manual);
  const run = await Tool.runCommand(db, "evidence", { "max-duration-ms": "300000" }, { project: P, nowMs: NOW });
  assert.deepEqual([run.exitCode, run.result.verdict], [Tool.EXIT.ABORT_D, "ABORT_D"]);
  const ok = await Tool.runCommand(db, "evidence", { "max-duration-ms": "300000", "inventory-attested": true, "logs-attested": true,
    "invocation-receipt-attested": true, "provider-attested": true }, { project: P, nowMs: NOW });
  assert.deepEqual([ok.exitCode, ok.result.verdict], [0, "EVIDENCE_COMPLETE_FOR_OWNER_REVIEW"]);
});

test("OT-03 the tool's send deadline is lib/sendEmail.js SEND_DEADLINE_MS", async () => {
  const mail = await import("../../lib/sendEmail.js");
  assert.equal(Tool.SEND_DEADLINE_MS, mail.SEND_DEADLINE_MS);
});

test("CP-01 an earlier lineage ignores the hold (forward-only while held); HR1 honours every receipt an earlier lineage wrote", async () => {
  const dir = mkdtempSync(join(tmpdir(), "hr1-i7-"));
  cpSync(join(REPO, "lib"), join(dir, "lib"), { recursive: true });
  const show = spawnSync("git", ["-C", REPO, "cat-file", "blob", `${I7}:lib/emailDelivery.js`], { encoding: "buffer" });
  assert.equal(show.status, 0, "I7 bytes readable");
  writeFileSync(join(dir, "lib", "emailDelivery.js"), show.stdout);
  symlinkSync(realpathSync(join(REPO, "node_modules")), join(dir, "node_modules"), "dir");
  const Old = await import(pathToFileURL(join(dir, "lib", "emailDelivery.js")).href);
  assert.equal(typeof Old.deliverWithReceipt, "function"); assert.equal(Old.readDeliveryHold, undefined, "the earlier lineage has no hold");
  const db = freshDb();
  db.seed(E.DELIVERY_HOLD_PATH, { ...releasedHoldRecord(), state: "held", version: 3, log: { ...releasedHoldRecord().log, v000000003: { action: "hold", state: "held", version: 3, prevVersion: 2, actor: "op", reason: "x", at: 1 } } });
  // HR1 G3 holds the claim (attempt 1, expired)
  const base = { db, tenantId: "t1", bizId: "b1", businessDate: "2026-09-08", recipient: "o@example.test", inRunAttempts: 1, backoffMs: 0, sleep: async () => {} };
  let calls = 0;
  const send = (mod) => async () => { const a = mod.currentDeliveryAttempt(); await a.beforeTransport(); calls++; a.info = { accepted: [base.recipient], rejected: [], response: "250 OK" }; };
  const gate = async (stage) => (stage === "g3" ? { open: false, code: "delivery_held" } : { open: true, code: null });
  const h = await E.deliverWithReceipt({ ...base, send: send(E), gate, clock: () => NOW });
  assert.deepEqual([h.outcome, h.attempt, calls], ["held", 1, 0]);
  // an earlier deployment reads that receipt: an expired claim is re-claimed at the SAME attempt — and it SENDS (no gate)
  const o = await Old.deliverWithReceipt({ ...base, send: send(Old), clock: () => NOW + 1000 });
  assert.deepEqual([o.outcome, o.attempt, calls], ["accepted", 1, 1], "documented: deployments without HR1 ignore the hold");
  // HR1 honours what the earlier lineage recorded: accepted is never re-sent, unknown stays held
  const again = await E.deliverWithReceipt({ ...base, send: send(E), gate: async () => ({ open: true, code: null }), clock: () => NOW + 2000 });
  assert.deepEqual([again.outcome, again.code, calls], ["skipped", "already_accepted", 1]);
  db.seed(E.receiptPath("daily_snapshot", "t1", "b1", "2026-09-09"), { v: E.RECEIPT_VERSION, state: "unknown", attempt: 1, claimId: "c", outcome: { code: "provider_connection_lost" } });
  const unk = await E.deliverWithReceipt({ ...base, businessDate: "2026-09-09", send: send(E), gate: async () => ({ open: true, code: null }), clock: () => NOW });
  assert.deepEqual([unk.outcome, unk.code, calls], ["skipped", "unknown_requires_reconciliation", 1]);
});
