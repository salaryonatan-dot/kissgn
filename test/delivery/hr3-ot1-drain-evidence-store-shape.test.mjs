// HR3 OT1 — the drain evidence report over receipts in their REAL-STORE shape (LOCAL successor of accepted S3 7fa1b6e1;
// pending independent Codex review; T-OT1-*). Operational rehearsal finding OR-F1 (2026-10-17, real RTDB emulator, real
// Admin SDK): lib/emailDelivery.js writes a first-attempt receipt with `history: []`; RTDB does not store an empty array, so
// the stored leaf has NO `history` key. S3's tools/daily-delivery/hold.mjs required an array and reported every such
// receipt as UNREADABLE — fail closed (C2 not_met), but a live first-attempt claim was never named, and a lost invocation's
// expired `sending` receipt never reached the P7 population (`scheduledSendingExpired`), where the operator must look.
//   OT1-01  the committed OT-02 fixture passed through the S3 RTDB elision model classifies exactly as the unelided fixture
//   OT1-02  the literal `sending` receipt the real emulator wrote (OR-21, process killed during the hand-off): live → a NAMED
//           live claim and C2 not_met; lease expired → C2 met and the receipt in scheduledSendingExpired
//   OT1-03  a first-attempt `claimed` without history: live → named; expired → scheduledClaimedExpired (not handed over)
//   OT1-04  a PRESENT non-array history stays unreadable (HR3-N3-X13 retained); an absent history on a terminal state is read
//   OT1-05  the report never claims quiescence; liveClaims is empty on the complete report
import { test } from "node:test";
import assert from "node:assert/strict";
import { releasedHoldRecord } from "../support/daily-email-harness.mjs";
import { rtdbHoldValue } from "../support/hr3-rtdb-hold-model.mjs";
import * as E from "../../lib/emailDelivery.js";
import * as Tool from "../../tools/daily-delivery/hold.mjs";

const NOW = Date.UTC(2026, 8, 9, 4, 5);
const heldRec = { ...releasedHoldRecord(), state: "held", version: 3, log: { ...releasedHoldRecord().log,
  v000000003: { action: "hold", state: "held", version: 3, prevVersion: 2, actor: "op", reason: "incident", at: NOW - 3_600_000 } } };
const rc = (state, businessDate, extra = {}) => ({ v: E.RECEIPT_VERSION, kind: E.DAILY_SNAPSHOT_KIND,
  tenantId: "t1", bizId: "b1", businessDate, claimId: "claim-1", recipientHash: "a".repeat(64), history: [], state, attempt: 1, ...extra });
const mr = (state, attemptId, extra = {}) => ({ v: E.MANUAL_ATTEMPT_VERSION, kind: E.DAILY_SNAPSHOT_KIND,
  tenantId: "t1", bizId: "b1", attemptId, state, startedAt: NOW - 1, settledAt: NOW, messageIdHeader: "<m2>", ...extra });
const full = (over = {}) => ({ holdRaw: heldRec, receiptsRaw: null, manualRaw: null, nowMs: NOW, maxDurationMs: 300_000,
  inventoryAttested: true, logsAttested: true, invocationReceiptAttested: true, providerAttested: true, ...over });
// the OT-02 fixture (test/delivery/hr1-operator-and-compat.test.mjs), unchanged
const ot02Receipts = { t1: { b1: {
  "2026-09-08": rc("accepted", "2026-09-08"),
  "2026-09-07": rc("unknown", "2026-09-07", { outcome: { code: "provider_connection_lost" }, messageIdHeader: "<m1>" }),
  "2026-09-06": rc("sending", "2026-09-06", { leaseUntil: NOW - 1 }),
  "2026-09-05": rc("claimed", "2026-09-05", { leaseUntil: NOW - 1, history: [{ state: "held_before_send" }] }),
} } };
const ot02Manual = { t1: { b1: { a1: mr("accepted", "a1"), a2: mr("unknown", "a2", { code: "provider_connection_lost" }) } } };
// the receipt the REAL emulator stored when the invocation was killed during the hand-off (rehearsal OR-21; verbatim)
const STORED_SENDING = { attempt: 1, bizId: "bizA", businessDate: "2026-10-25", claimId: "3d9cce2f-0802-4219-b47e-58ca95122b3d",
  claimedAt: 1792908300000, kind: "daily_snapshot", leaseUntil: 1792908900000,
  messageIdHeader: "<daily_snapshot.1.3d9cce2f-0802-4219-b47e-58ca95122b3d@delivery.marjin.app>",
  recipientHash: "84e1f3f311a2d3cf0eb3b59ac951ae46c317de465fb0eaffe7dde9dd3ce0d99a", sendingAt: 1792908300000, state: "sending",
  tenantId: "tenantA", updatedAt: 1792908300000, v: "MARJIN_EMAIL_RECEIPT/1" };
const heldAt = (at) => ({ ...heldRec, log: { ...heldRec.log, v000000003: { ...heldRec.log.v000000003, at } } });
const strip = (r) => { const { liveClaims, ...rest } = r; return rest; };

test("OT1-01 the OT-02 fixture through the RTDB elision model (no `history` key) classifies exactly as the unelided fixture", () => {
  const elided = rtdbHoldValue({ receipts: ot02Receipts, manual: ot02Manual });
  for (const d of ["2026-09-08", "2026-09-07", "2026-09-06"]) assert.equal(elided.receipts.t1.b1[d].history, undefined, d + " lost its empty history in the store");
  assert.deepEqual(elided.receipts.t1.b1["2026-09-05"].history, [{ state: "held_before_send" }], "a non-empty history survives");
  const a = Tool.drainEvidence(full({ receiptsRaw: ot02Receipts, manualRaw: ot02Manual }));
  const b = Tool.drainEvidence(full({ receiptsRaw: elided.receipts, manualRaw: elided.manual }));
  assert.equal(a.verdict, "EVIDENCE_COMPLETE_FOR_OWNER_REVIEW");
  assert.deepEqual(b, a, "the stored shape must read exactly as the written shape");
  assert.deepEqual(b.unreadable, { receipts: [], manual: [] });
  assert.deepEqual(b.p7Population.scheduledSendingExpired.map((x) => x.id), ["t1/b1/2026-09-06"]);
});

test("OT1-02 the literal real-store `sending` receipt: live → a NAMED live claim (C2 not_met); expired → P7 scheduledSendingExpired (C2 met)", () => {
  const receipts = { tenantA: { bizA: { "2026-10-25": STORED_SENDING } } };
  const id = "tenantA/bizA/2026-10-25";
  const live = Tool.drainEvidence(full({ holdRaw: heldAt(STORED_SENDING.claimedAt - 1), receiptsRaw: receipts, nowMs: STORED_SENDING.claimedAt + 60_000 }));
  assert.deepEqual([live.verdict, live.criteria.C2_no_live_scheduled_claim, live.unreadable.receipts], ["ABORT_D", "not_met", []]);
  assert.deepEqual(live.liveClaims, [{ id, state: "sending", attempt: 1 }], "the operator sees WHICH claim is live");
  assert.deepEqual(live.p7Population.scheduledSendingExpired, []);
  const expired = Tool.drainEvidence(full({ holdRaw: heldAt(STORED_SENDING.claimedAt - 1), receiptsRaw: receipts, nowMs: STORED_SENDING.leaseUntil }));
  assert.deepEqual([expired.criteria.C2_no_live_scheduled_claim, expired.liveClaims, expired.unreadable.receipts], ["met", [], []]);
  assert.deepEqual(expired.p7Population.scheduledSendingExpired, [{ id, attempt: 1 }], "the lost invocation is P7 population: provider evidence, never a reset or a re-send");
  assert.equal(expired.verdict, "ABORT_D", "the time bound is not passed at the lease end; nothing here declares a drain");
});

test("OT1-03 a first-attempt `claimed` receipt without history: live → named; expired → not handed over (scheduledClaimedExpired)", () => {
  const { history, ...claimed } = rc("claimed", "2026-09-08", { leaseUntil: NOW + 1000 });
  assert.equal(claimed.history, undefined);
  const live = Tool.drainEvidence(full({ receiptsRaw: { t1: { b1: { "2026-09-08": claimed } } } }));
  assert.deepEqual([live.criteria.C2_no_live_scheduled_claim, live.liveClaims, live.unreadable.receipts], ["not_met", [{ id: "t1/b1/2026-09-08", state: "claimed", attempt: 1 }], []]);
  const expired = Tool.drainEvidence(full({ receiptsRaw: { t1: { b1: { "2026-09-08": { ...claimed, leaseUntil: NOW - 1 } } } } }));
  assert.deepEqual([expired.criteria.C2_no_live_scheduled_claim, expired.liveClaims, expired.notHandedOver.scheduledClaimedExpired], ["met", [], [{ id: "t1/b1/2026-09-08", attempt: 1 }]]);
  assert.deepEqual(expired.notHandedOver.scheduledHeldBeforeSend, [], "without a held_before_send entry it is not a G3 refusal");
});

test("OT1-04 a PRESENT non-array history is still unreadable; an absent history on terminal states is read", () => {
  for (const bad of ["x", 1, {}, { 0: { state: "x" } }, null, true]) {
    const r = Tool.drainEvidence(full({ receiptsRaw: { t1: { b1: { "2026-09-08": rc("accepted", "2026-09-08", { history: bad }) } } } }));
    assert.deepEqual([r.verdict, r.unreadable.receipts], ["ABORT_D", ["t1/b1/2026-09-08"]], JSON.stringify(bad));
  }
  const { history: _h, ...accepted } = rc("accepted", "2026-09-08");
  const { history: _u, ...unknown } = rc("unknown", "2026-09-07", { outcome: { code: "provider_no_answer_deadline" }, messageIdHeader: "<m1>" });
  const { history: _f, ...failed } = rc("failed", "2026-09-06", { retryable: false });
  const r = Tool.drainEvidence(full({ receiptsRaw: { t1: { b1: { "2026-09-08": accepted, "2026-09-07": unknown, "2026-09-06": failed } } } }));
  assert.deepEqual([r.verdict, r.unreadable.receipts, r.p7Population.scheduledUnknown.map((x) => [x.id, x.code])], ["EVIDENCE_COMPLETE_FOR_OWNER_REVIEW", [], [["t1/b1/2026-09-07", "provider_no_answer_deadline"]]]);
  // HR3-N3-X13 retained: a complete leaf with an unknown state, or `sending` without a lease, is unreadable whatever its history
  for (const x of [{ ...accepted, state: "lost" }, { ...accepted, state: "sending" }]) {
    const u = Tool.drainEvidence(full({ receiptsRaw: { t1: { b1: { "2026-09-08": x } } } }));
    assert.deepEqual(u.unreadable.receipts, ["t1/b1/2026-09-08"]);
  }
});

test("OT1-05 the report shape: liveClaims is a list beside the P7 population; the complete report has none; no quiescence wording", () => {
  const complete = Tool.drainEvidence(full({ receiptsRaw: ot02Receipts, manualRaw: ot02Manual }));
  assert.deepEqual(complete.liveClaims, []);
  assert.deepEqual(Object.keys(complete).sort(), ["criteria", "hold", "limits", "liveClaims", "notHandedOver", "p7Population", "timeBound", "unreadable", "verdict"]);
  const liveOne = Tool.drainEvidence(full({ receiptsRaw: { t1: { b1: { "2026-09-08": rc("sending", "2026-09-08", { leaseUntil: NOW + 1 }) } } } }));
  assert.deepEqual([liveOne.verdict, liveOne.liveClaims.length], ["ABORT_D", 1]);
  for (const x of [complete, liveOne]) assert.doesNotMatch(JSON.stringify(x), /QUIESCENT|DRAINED|nothing sent/i);
  // everything except the new list is what S3 reported for a readable tree
  assert.deepEqual(Object.keys(strip(complete)).sort(), ["criteria", "hold", "limits", "notHandedOver", "p7Population", "timeBound", "unreadable", "verdict"]);
});
