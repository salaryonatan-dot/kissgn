// DP3 — correction of the independent DP2 review (Codex, DP2_VERDICT: CHANGES_REQUIRED): the shared admission and the other
// stored delivery evidence are judged TOGETHER, and present-but-invalid evidence never permits a provider hand-off; the operator
// evidence report reads the admissions with the runtime's own validation. Owner policies unchanged (P4 across routes, E4, P7
// without a mechanism). Through the REAL route api/daily-snapshot/run.ts (GET cron / POST manual) and lib/emailDelivery.js
// (test/support/daily-email-harness.mjs: only the database, the token verifier and the SMTP provider are replaced; no network,
// no real e-mail). Every case counts provider hand-offs; the oracle is the approved policy, not the decision helper.
//   DP3-01  DP2-R01 scheduled: a failed admission beside an older manual accepted / unknown / handing_off / unreadable record ⇒
//           no hand-off; the stored evidence is left byte-identical (nothing repaired, cleared or re-classified)
//   DP3-02  DP2-R01 manual: a failed admission beside an older scheduled accepted / unknown / sending / active claimed receipt or
//           an older manual accepted / unknown / handing_off record ⇒ refused, nothing handed over
//   DP3-03  positive controls: a valid failed admission and NO other blocking evidence (absent, or only complete definitive
//           failures) ⇒ exactly one hand-off on each route; the earlier holder is carried in the history exactly
//   DP3-04  preserved: a consistent current holder keeps its precise classification (in progress during the lease, unresolved
//           after it); an accepted / unknown admission refuses with its own code; first-time delivery on both routes
//   DP3-05  DP2-R02 the admission schema (admissionRecordDefect / decideAdmission): every incomplete or contradictory failed
//           record is unreadable; complete records with legitimately absent optional fields (messageIdHeader, history, code
//           of accepted / unknown) are read as written
//   DP3-06  DP2-R02 through both routes: an incomplete failed admission and one with an accepted / unknown historical holder ⇒
//           no hand-off, the record left as it was
//   DP3-07  DP2-R02 (DP1 legacy reader): a claimed scheduled receipt with an absent / non-numeric / fractional lease is not
//           expired (no hand-off); a valid future lease blocks; a valid expired lease is legitimately no delivery (one hand-off)
//   DP3-08  DP2-R02: an incomplete failed receipt / failed manual record is not a definitive non-acceptance; complete ones are
//   DP3-09  DP2-R03 the evidence report: every admission the runtime refuses as unreadable is listed (with its defect) and keeps
//           the report incomplete; the runtime and the report agree on every sample; complete valid records stay reportable
//   DP3-10  writer representation: the records the real routes write (in_flight, accepted, failed + history, unknown) are
//           read back as valid by the same validation
//   DP3-11  concurrency: three scheduled invocations and three manual sends at once on a re-admittable failed admission ⇒
//           exactly one hand-off (plain and guess-first transactions); with older blocking evidence ⇒ none
//   DP3-12  DP2-N01 the declarations accept the implemented `legacy` input and list the codes the functions return
import { test } from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildSandbox, installSmtp, SMTP, seedWorld, freezeClock, runCron, runManual, sdkTransactions, RECEIPTS, REPO, T, B } from "../support/daily-email-harness.mjs";

const { route } = await buildSandbox();
const E = await import(pathToFileURL(REPO + "/lib/emailDelivery.js").href);
const Tool = await import(pathToFileURL(REPO + "/tools/daily-delivery/hold.mjs").href);
const AT = Date.UTC(2026, 8, 8, 4, 5), DATE = "2026-09-08";   // 07:05 Israel, business date 2026-09-08
const ADM = "email_delivery_admission/daily_snapshot";
const IDS = { kind: "daily_snapshot", tenantId: T, bizId: B, businessDate: DATE };
const MID = "a0000000-0000-4000-8000-000000000031", CID = "c0000000-0000-4000-8000-000000000031";
const db = () => globalThis.__DB;
const admission = () => db().read(`${ADM}/${T}/${B}/${DATE}`);
const receipt = () => db().read(`${RECEIPTS}/${T}/${B}/${DATE}`);
async function at(ms, fn) { const restore = freezeClock(ms); try { return await fn(); } finally { restore(); } }
const cron = (ms = AT) => at(ms, () => runCron(route));
const manual = (ms = AT) => at(ms, () => runManual(route));
const refusal = (res) => [res.statusCode, res.body && res.body.code];
const one = () => seedWorld({ withSecondBiz: false, withSecondTenant: false });
const row = (res) => res.body.results.find((x) => x.tenantId === T && x.bizId === B);
const clone = (x) => JSON.parse(JSON.stringify(x));

// ── stored records exactly as their writers produce them (the fields each writer sets; RTDB omits absent / null ones) ─────────
/** a settled failed admission (settleAdmission after decideAdmission's admit): a definitive non-acceptance with its code */
const failedAdmission = (extra = {}) => ({ v: E.ADMISSION_VERSION, ...IDS, state: "failed", route: "scheduled", ref: "b0000000-0000-4000-8000-000000000031",
  attempt: 1, messageIdHeader: "<daily_snapshot.1.b0000000-0000-4000-8000-000000000031@delivery.marjin.app>", since: AT - 20_000,
  code: "provider_rejected_550", settledAt: AT - 19_000, updatedAt: AT - 19_000, ...extra });
const historyEntry = (extra = {}) => ({ route: "manual", ref: "a0000000-0000-4000-8000-000000000030", attempt: 1, state: "failed", code: "provider_rejected_550", at: AT - 40_000, ...extra });
/** a manual attempt record (deliverManualDaily): created handing_off, finalized with code + settledAt */
const manualRecord = (state, extra = {}) => ({ v: E.MANUAL_ATTEMPT_VERSION, attemptId: MID, kind: "daily_snapshot", tenantId: T, bizId: B, businessDate: DATE, state,
  messageIdHeader: `<manual.${MID}@delivery.marjin.app>`, startedAt: AT - 30_000, updatedAt: AT - 29_000,
  ...(state === "handing_off" ? {} : { settledAt: AT - 29_000, ...(state === "accepted" ? {} : { code: state === "failed" ? "provider_rejected_550" : "provider_connection_lost" }) }), ...extra });
/** a scheduled receipt (decideClaim + finalizer, DE1 onwards) */
const scheduledReceipt = (state, extra = {}) => {
  const base = { v: E.RECEIPT_VERSION, ...IDS, claimId: CID, attempt: 1, claimedAt: AT - 50_000, recipientHash: "a".repeat(64), updatedAt: AT - 49_000,
    history: [{ attempt: 1, state, code: null, at: AT - 49_000 }] };
  const by = {
    claimed: { leaseUntil: AT + 60_000 },
    sending: { leaseUntil: AT + 60_000, sendingAt: AT - 49_500, messageIdHeader: `<daily_snapshot.1.${CID}@delivery.marjin.app>` },
    accepted: { sendingAt: AT - 49_500, messageIdHeader: `<daily_snapshot.1.${CID}@delivery.marjin.app>`, messageId: `<daily_snapshot.1.${CID}@delivery.marjin.app>`, providerIdEcho: "ours", responseCode: 250, finishedAt: AT - 49_000 },
    failed: { sendingAt: AT - 49_500, messageIdHeader: `<daily_snapshot.1.${CID}@delivery.marjin.app>`, retryable: false, code: "provider_rejected_550", finishedAt: AT - 49_000 },
    unknown: { sendingAt: AT - 49_500, messageIdHeader: `<daily_snapshot.1.${CID}@delivery.marjin.app>`, code: "provider_connection_lost", finishedAt: AT - 49_000 },
  };
  return { ...base, state, ...by[state], ...extra };
};
const seedAdmission = (x) => db().seed(`${ADM}/${T}/${B}/${DATE}`, x);
const seedManual = (x) => db().seed(`email_delivery_manual/${T}/${B}/${x.attemptId}`, x);
const seedReceipt = (x) => db().seed(`${RECEIPTS}/${T}/${B}/${DATE}`, x);

test("DP3-01 DP2-R01 scheduled: a failed admission never erases older blocking manual evidence", { timeout: 30_000 }, async () => {
  for (const [state, code, settlement] of [["accepted", "delivery_already_accepted", "delivered"], ["unknown", "delivery_outcome_unresolved", "unknown"],
    ["handing_off", "delivery_outcome_unresolved", "unknown"], ["unreadable", "delivery_history_unreadable", "failed"]]) {
    one(); const adm = failedAdmission(); seedAdmission(adm);
    const rec = state === "unreadable" ? { ...manualRecord("accepted"), v: "MARJIN_MANUAL_ATTEMPT/0" } : manualRecord(state); seedManual(rec);
    const smtp = installSmtp([SMTP.accept()]);
    const c = await cron();
    assert.equal(smtp.calls.length, 0, state + ": nothing handed over");
    assert.deepEqual([row(c).outcome, row(c).code, row(c).settlement], ["skipped", code, settlement], state);
    assert.deepEqual(admission(), adm, state + ": the admission is left exactly as it was");
    assert.deepEqual(db().read(`email_delivery_manual/${T}/${B}/${MID}`), rec, state + ": the older evidence is left exactly as it was");
    const r = receipt(); const h = r.history[r.history.length - 1];
    assert.deepEqual([r.state, r.attempt, h.state, h.code], ["claimed", 1, "admission_refused", code], state + ": the claim expired at the same attempt, nothing consumed");
  }
});

test("DP3-02 DP2-R01 manual: a failed admission never erases older blocking scheduled or manual evidence", { timeout: 30_000 }, async () => {
  const cases = [
    ["scheduled accepted", () => seedReceipt(scheduledReceipt("accepted")), "manual_repeat_not_permitted"],
    ["scheduled unknown", () => seedReceipt(scheduledReceipt("unknown")), "delivery_outcome_unresolved"],
    ["scheduled sending", () => seedReceipt(scheduledReceipt("sending")), "delivery_outcome_unresolved"],
    ["scheduled active claim", () => seedReceipt(scheduledReceipt("claimed")), "delivery_in_progress"],
    ["manual accepted", () => seedManual(manualRecord("accepted")), "manual_repeat_not_permitted"],
    ["manual unknown", () => seedManual(manualRecord("unknown")), "delivery_outcome_unresolved"],
    ["manual handing_off", () => seedManual(manualRecord("handing_off")), "delivery_outcome_unresolved"],
  ];
  for (const [name, seed, code] of cases) {
    one(); const adm = failedAdmission({ route: "manual", ref: "a0000000-0000-4000-8000-000000000032" }); seedAdmission(adm); seed();
    const smtp = installSmtp([SMTP.accept()]);
    const m = await manual();
    assert.deepEqual([refusal(m), smtp.calls.length], [[409, code], 0], name);
    assert.deepEqual(admission(), adm, name + ": the admission is left exactly as it was");
  }
});

test("DP3-03 positive controls: a definitive non-acceptance and nothing else blocking — exactly one hand-off on each route", { timeout: 30_000 }, async () => {
  // scheduled, failed admission and no other evidence
  one(); seedAdmission(failedAdmission()); let smtp = installSmtp([SMTP.accept()]);
  let c = await cron();
  assert.deepEqual([smtp.calls.length, row(c).outcome, row(c).settlement], [1, "accepted", "delivered"]);
  const a = admission();
  assert.deepEqual([a.state, a.route, a.history], ["accepted", "scheduled", [{ route: "scheduled", ref: failedAdmission().ref, attempt: 1, state: "failed", code: "provider_rejected_550", at: AT - 19_000 }]]);
  // scheduled, beside an older complete manual definitive failure, and with a carried failed history
  one(); seedAdmission(failedAdmission({ history: [historyEntry()] })); seedManual(manualRecord("failed")); smtp = installSmtp([SMTP.accept()]);
  c = await cron();
  assert.deepEqual([smtp.calls.length, row(c).outcome, admission().history.length], [1, "accepted", 2]);
  // manual, failed admission and no other evidence
  one(); seedAdmission(failedAdmission()); smtp = installSmtp([SMTP.accept()]);
  let m = await manual();
  assert.deepEqual([m.statusCode, smtp.calls.length, admission().state, admission().route], [200, 1, "accepted", "manual"]);
  // manual, beside an older complete scheduled definitive failure (the existing failure contract) and a manual one
  one(); seedAdmission(failedAdmission()); seedReceipt(scheduledReceipt("failed", { retryable: true })); seedManual(manualRecord("failed")); smtp = installSmtp([SMTP.accept()]);
  m = await manual();
  assert.deepEqual([m.statusCode, smtp.calls.length], [200, 1]);
  // a scheduled claim that expired before any hand-off is no delivery either (DP1 contract)
  one(); seedAdmission(failedAdmission()); seedReceipt(scheduledReceipt("claimed", { leaseUntil: AT - 1 })); smtp = installSmtp([SMTP.accept()]);
  m = await manual();
  assert.deepEqual([m.statusCode, smtp.calls.length], [200, 1]);
  // a real definitive refusal then a retry on the same identity through the routes (no fixture): refused, then delivered once
  one(); smtp = installSmtp([SMTP.rejectRecipient(), SMTP.accept()]);
  m = await manual();
  assert.deepEqual([m.statusCode >= 400, admission().state], [true, "failed"], JSON.stringify(m.body));
  c = await cron();
  assert.deepEqual([smtp.calls.length, row(c).outcome, admission().state, admission().history.length], [2, "accepted", "accepted", 1]);
});

test("DP3-04 preserved: a consistent current holder keeps its precise code; accepted / unknown admissions; first-time delivery", { timeout: 30_000 }, async () => {
  // the current manual holder's own handing_off record beside its in_flight admission: in progress, then unresolved — not "unreadable"
  const inFlight = (leaseUntil) => { const { code, settledAt, ...rest } = failedAdmission({ route: "manual", ref: MID, state: "in_flight", leaseUntil }); return rest; };
  for (const [lease, code, settlement] of [[AT + 60_000, "delivery_in_progress", "pending"], [AT - 1, "delivery_outcome_unresolved", "unknown"]]) {
    one(); seedAdmission(inFlight(lease)); seedManual(manualRecord("handing_off")); const smtp = installSmtp([SMTP.accept()]);
    const c = await cron(); const m = await manual();
    assert.deepEqual([row(c).code, row(c).settlement, refusal(m), smtp.calls.length], [code, settlement, [409, code], 0], code);
  }
  for (const [state, code] of [["accepted", "manual_repeat_not_permitted"], ["unknown", "delivery_outcome_unresolved"]]) {
    one(); const { code: _c, ...rest } = failedAdmission({ state }); seedAdmission(state === "unknown" ? { ...rest, code: "provider_connection_lost" } : rest);
    const smtp = installSmtp([SMTP.accept()]);
    assert.deepEqual([refusal(await manual()), smtp.calls.length], [[409, code], 0], state);
  }
  one(); let smtp = installSmtp([SMTP.accept()]);
  const c = await cron();
  assert.deepEqual([smtp.calls.length, row(c).outcome, admission().state, admission().history], [1, "accepted", "accepted", undefined], "first-time scheduled");
  one(); smtp = installSmtp([SMTP.accept()]);
  const m = await manual();
  assert.deepEqual([m.statusCode, smtp.calls.length, receipt()], [200, 1, null], "first-time manual (no scheduled receipt is written)");
});

test("DP3-05 DP2-R02 the admission schema: incomplete or contradictory records are unreadable; complete ones are read as written", () => {
  const d = (cur, extra = {}) => E.decideAdmission(cur, { route: "manual", ref: "r1", nowMs: AT, ids: IDS, ...extra }).result;
  const without = (x, ...keys) => { const y = clone(x); for (const k of keys) delete y[k]; return y; };
  const ok = failedAdmission();
  assert.equal(E.admissionRecordDefect(ok, IDS), null);
  assert.deepEqual(d(ok), { admitted: true });
  // legitimately absent optional fields: messageIdHeader (admit writes it only when given), history (an empty list is not stored)
  assert.deepEqual(d(without(ok, "messageIdHeader")), { admitted: true });
  const defects = [
    [without(ok, "attempt"), "attempt"], [without(ok, "since"), "times"], [without(ok, "updatedAt"), "times"], [without(ok, "settledAt"), "settled_at"],
    [without(ok, "code"), "failed_code"], [{ ...ok, attempt: 0 }, "attempt"], [{ ...ok, attempt: 1.5 }, "attempt"], [{ ...ok, settledAt: "yesterday" }, "settled_at"],
    [{ ...ok, leaseUntil: AT + 1 }, "settled_lease"], [{ ...ok, code: 550 }, "code"], [{ ...ok, messageIdHeader: 7 }, "message_id"],
    [{ ...ok, history: { corrupt: true } }, "history"], [{ ...ok, history: [historyEntry({ state: "accepted" })] }, "history_entry"],
    [{ ...ok, history: [historyEntry({ state: "unknown" })] }, "history_entry"], [{ ...ok, history: [without(historyEntry(), "code")] }, "history_entry"],
    [{ ...ok, history: [without(historyEntry(), "at")] }, "history_entry"], [{ ...ok, history: [historyEntry({ route: "replay" })] }, "history_entry"],
    [{ ...ok, history: [null] }, "history_entry"], [{ ...ok, ref: "" }, "holder"], [{ ...ok, route: "other" }, "holder"], [{ ...ok, businessDate: "2026-09-09" }, "identity"],
    [{ ...ok, v: "MARJIN_DELIVERY_ADMISSION/0" }, "version"], [{ ...ok, state: "released" }, "state"], [[], "not_a_record"], ["x", "not_a_record"],
    [without({ ...ok, state: "in_flight" }, "settledAt", "code"), "lease"], [{ ...ok, state: "in_flight", leaseUntil: "soon" }, "lease"],
    [without({ ...ok, state: "accepted" }, "code", "settledAt"), "settled_at"], [without({ ...ok, state: "unknown" }, "settledAt"), "settled_at"],
  ];
  for (const [x, defect] of defects) {
    assert.equal(E.admissionRecordDefect(x, IDS), defect, JSON.stringify(x));
    assert.deepEqual(d(x), { admitted: false, code: "delivery_admission_unreadable" }, JSON.stringify(x));
    assert.deepEqual(d(x, { legacy: null }), { admitted: false, code: "delivery_admission_unreadable" });
  }
  // accepted / unknown without their optional code are complete and keep their own refusal
  assert.deepEqual(d(without({ ...ok, state: "accepted" }, "code")), { admitted: false, code: "delivery_already_accepted" });
  assert.deepEqual(d(without({ ...ok, state: "unknown" }, "code")), { admitted: false, code: "delivery_outcome_unresolved" });
  // a valid failed record with blocking legacy evidence refuses with the legacy code (DP2-R01); absent ⇒ the legacy code too
  for (const legacy of ["delivery_already_accepted", "manual_repeat_not_permitted", "delivery_outcome_unresolved", "delivery_in_progress", "delivery_history_unreadable"]) {
    assert.deepEqual(d(ok, { legacy }), { admitted: false, code: legacy }, legacy);
    assert.deepEqual(d(null, { legacy }), { admitted: false, code: legacy }, legacy);
  }
  // nothing is repaired: a refusal never writes
  assert.equal(E.decideAdmission(without(ok, "code"), { route: "manual", ref: "r1", nowMs: AT, ids: IDS }).next, undefined);
});

test("DP3-06 DP2-R02 through both routes: incomplete or contradictory failed admissions never permit a hand-off; nothing is repaired", { timeout: 30_000 }, async () => {
  const incomplete = (() => { const { attempt, since, messageIdHeader, settledAt, updatedAt, code, ...x } = failedAdmission(); return x; })();
  for (const [name, adm] of [["incomplete", incomplete], ["no code", (({ code, ...x }) => x)(failedAdmission())],
    ["accepted history", failedAdmission({ history: [historyEntry({ state: "accepted" })] })], ["unknown history", failedAdmission({ history: [historyEntry({ state: "unknown" })] })],
    ["malformed history", failedAdmission({ history: { corrupt: true } })]]) {
    for (const via of ["scheduled", "manual"]) {
      one(); seedAdmission(adm); const smtp = installSmtp([SMTP.accept()]);
      const res = via === "scheduled" ? await cron() : await manual();
      if (via === "scheduled") assert.deepEqual([row(res).code, row(res).settlement], ["delivery_admission_unreadable", "failed"], name);
      else assert.deepEqual(refusal(res), [422, "delivery_admission_unreadable"], name);
      assert.equal(smtp.calls.length, 0, `${name} via ${via}: nothing handed over`);
      assert.deepEqual(admission(), adm, `${name} via ${via}: left exactly as it was`);
    }
  }
});

test("DP3-07 DP2-R02 (DP1 legacy reader): an absent or invalid claim lease is not an expiry", { timeout: 30_000 }, async () => {
  for (const [name, lease, expected] of [["valid active", AT + 60_000, [409, "delivery_in_progress"]], ["valid expired", AT - 1, [200, undefined]],
    ["absent", undefined, [422, "delivery_history_unreadable"]], ["non-numeric", "unreadable", [422, "delivery_history_unreadable"]],
    ["numeric string", String(AT - 1), [422, "delivery_history_unreadable"]], ["fractional", AT - 0.5, [422, "delivery_history_unreadable"]]]) {
    one(); const r = scheduledReceipt("claimed", { leaseUntil: lease }); if (lease === undefined) delete r.leaseUntil; seedReceipt(r);
    const smtp = installSmtp([SMTP.accept()]);
    const m = await manual();
    assert.deepEqual([m.statusCode, m.statusCode === 200 ? undefined : m.body.code], expected, name);
    assert.equal(smtp.calls.length, expected[0] === 200 ? 1 : 0, name);
    assert.deepEqual(receipt(), r, name + ": the receipt is left exactly as it was (no lease is invented or extended)");
  }
  // the same reader judges identity: a receipt naming another business under this path is not this identity's evidence
  one(); seedReceipt(scheduledReceipt("failed", { bizId: "bizOther" })); const smtp = installSmtp([SMTP.accept()]);
  assert.deepEqual([refusal(await manual()), smtp.calls.length], [[422, "delivery_history_unreadable"], 0]);
});

test("DP3-08 DP2-R02: an incomplete failed receipt or manual record is not a definitive non-acceptance", { timeout: 30_000 }, async () => {
  for (const missing of ["code", "retryable", "finishedAt", "claimId", "attempt", "tenantId"]) {
    one(); const r = scheduledReceipt("failed"); delete r[missing]; seedReceipt(r); const smtp = installSmtp([SMTP.accept()]);
    assert.deepEqual([refusal(await manual()), smtp.calls.length], [[422, "delivery_history_unreadable"], 0], "receipt without " + missing);
  }
  for (const missing of ["code", "settledAt", "startedAt", "messageIdHeader"]) {
    one(); const r = manualRecord("failed"); delete r[missing]; seedManual(r); const smtp = installSmtp([SMTP.accept()]);
    const c = await cron();
    assert.deepEqual([row(c).code, smtp.calls.length], ["delivery_history_unreadable", 0], "manual record without " + missing);
    one(); seedManual(r); const s2 = installSmtp([SMTP.accept()]);
    assert.deepEqual([refusal(await manual()), s2.calls.length], [[422, "delivery_history_unreadable"], 0], "manual route, record without " + missing);
  }
  // complete definitive failures (both writers' shapes) are no delivery on either route
  one(); seedReceipt(scheduledReceipt("failed", { retryable: true })); let smtp = installSmtp([SMTP.accept()]);
  assert.deepEqual([(await manual()).statusCode, smtp.calls.length], [200, 1]);
  one(); seedManual(manualRecord("failed")); smtp = installSmtp([SMTP.accept()]);
  assert.deepEqual([row(await cron()).outcome, smtp.calls.length], ["accepted", 1]);
});

test("DP3-09 DP2-R03 the evidence report lists every admission the runtime cannot read and never completes on it", () => {
  const holdRaw = { schema: 1, state: "held", version: 1, log: { v000000001: { action: "init", state: "held", version: 1, prevVersion: 0, actor: "op", reason: "evidence check", at: AT - 10 * 3_600_000 } } };
  const base = { holdRaw, receiptsRaw: null, manualRaw: null, nowMs: AT, maxDurationMs: 300000, inventoryAttested: true, logsAttested: true, invocationReceiptAttested: true, providerAttested: true };
  const tree = (x) => ({ [T]: { [B]: { [DATE]: x } } });
  const id = `${T}/${B}/${DATE}`;
  assert.equal(Tool.drainEvidence(base).verdict, "EVIDENCE_COMPLETE_FOR_OWNER_REVIEW", "control: no admission");
  // complete, settled, non-blocking-for-the-report records keep the report completable (they are not live work)
  for (const x of [failedAdmission(), (({ messageIdHeader, ...y }) => y)(failedAdmission()), failedAdmission({ history: [historyEntry()] }), (({ code, ...y }) => ({ ...y, state: "accepted" }))(failedAdmission())]) {
    const r = Tool.drainEvidence({ ...base, admissionRaw: tree(x) });
    assert.deepEqual([r.verdict, r.admissions.unreadable], ["EVIDENCE_COMPLETE_FOR_OWNER_REVIEW", []], JSON.stringify(x));
  }
  const bad = [
    [failedAdmission({ history: { corrupt: true } }), "history"],
    [failedAdmission({ history: [historyEntry({ state: "accepted" })] }), "history_entry"],
    [(({ code, ...y }) => y)(failedAdmission()), "failed_code"],
    [(({ attempt, since, settledAt, updatedAt, code, ...y }) => y)(failedAdmission()), "attempt"],
    [failedAdmission({ leaseUntil: AT + 1 }), "settled_lease"],
    [failedAdmission({ tenantId: "other" }), "identity"],
  ];
  for (const [x, defect] of bad) {
    const runtime = E.decideAdmission(x, { route: "scheduled", ref: "new", ids: IDS, nowMs: AT }).result;
    const r = Tool.drainEvidence({ ...base, admissionRaw: tree(x) });
    assert.deepEqual(runtime, { admitted: false, code: "delivery_admission_unreadable" }, defect);
    assert.deepEqual([r.verdict, r.criteria.C2_no_live_scheduled_claim, r.admissions.unreadable, r.admissions.unreadableDetail], ["ABORT_D", "not_met", [id], [{ id, defect }]], defect);
    assert.doesNotMatch(JSON.stringify(r), /QUIESCENT|DRAINED|nothing sent/i);
  }
  // runtime ⇔ report agreement over every sample above and the DP3-05 table: unreadable for one iff unreadable for the other
  const samples = [failedAdmission(), ...bad.map(([x]) => x), { ...failedAdmission(), state: "in_flight", leaseUntil: AT + 1 }, (({ settledAt, ...y }) => ({ ...y, state: "unknown" }))(failedAdmission())];
  for (const x of samples) {
    const runtimeUnreadable = E.decideAdmission(x, { route: "manual", ref: "n", ids: IDS, nowMs: AT }).result.code === "delivery_admission_unreadable";
    const reportUnreadable = Tool.drainEvidence({ ...base, admissionRaw: tree(x) }).admissions.unreadable.length === 1;
    assert.equal(reportUnreadable, runtimeUnreadable, JSON.stringify(x));
  }
});

test("DP3-10 writer representation: the records the real routes write are read back as valid by the same validation", { timeout: 30_000 }, async () => {
  const seen = [];
  // in_flight: a manual holder held at the provider
  one(); let release, arrived; const gate = new Promise((r) => { release = r; }); const entered = new Promise((r) => { arrived = r; });
  let smtp = installSmtp([async (mail) => { arrived(); await gate; return { messageId: mail.messageId, accepted: [mail.to], rejected: [], response: "250 2.0.0 OK" }; }]);
  const running = manual(); await entered; seen.push(["in_flight", admission()]); release(); await running;
  seen.push(["accepted (manual)", admission()]);
  // failed, then accepted with a carried history (scheduled in-run retry after a definitive transient refusal)
  one(); smtp = installSmtp([SMTP.rejectRecipient()]); await manual(); seen.push(["failed (manual)", admission()]);
  smtp = installSmtp([SMTP.transient(), SMTP.accept()]); await cron(); seen.push(["accepted after failures (scheduled)", admission()]);
  // unknown
  one(); smtp = installSmtp([SMTP.closedAfterData()]); await cron(); seen.push(["unknown (scheduled)", admission()]);
  for (const [name, x] of seen) {
    assert.ok(x && typeof x === "object", name);
    // the store's JSON form (what an RTDB read returns: no undefined, no null-valued keys written by these writers)
    const stored = clone(x);
    assert.equal(E.admissionRecordDefect(stored, IDS), null, name + " " + JSON.stringify(stored));
    for (const v of Object.values(stored)) assert.notEqual(v, null, name + ": no null-valued field is written");
  }
  assert.ok(seen.find(([n]) => n.startsWith("accepted after"))[1].history.length >= 1, "a carried failed holder");
});

test("DP3-11 concurrency on a re-admittable failed admission: exactly one hand-off; with older blocking evidence none", { timeout: 30_000 }, async () => {
  for (const guessFirst of [false, true]) {
    const w = one(); if (guessFirst) sdkTransactions(w, ADM);
    seedAdmission(failedAdmission()); const smtp = installSmtp([SMTP.accept()]);
    const all = await at(AT, () => Promise.all([runCron(route), runManual(route), runCron(route), runManual(route), runCron(route), runManual(route)]));
    assert.equal(smtp.calls.length, 1, `guessFirst=${guessFirst}: ` + JSON.stringify(all.map((r) => [r.statusCode, r.body.code ?? r.body.status])));
    assert.deepEqual([admission().state, admission().history.length], ["accepted", 1]);
    const w2 = one(); if (guessFirst) sdkTransactions(w2, ADM);
    seedAdmission(failedAdmission()); seedManual(manualRecord("accepted")); const s2 = installSmtp([SMTP.accept()]);
    await at(AT, () => Promise.all([runCron(route), runManual(route), runCron(route), runManual(route)]));
    assert.deepEqual([s2.calls.length, admission().state], [0, "failed"], `guessFirst=${guessFirst}: an older acceptance blocks every concurrent attempt`);
  }
});

test("DP3-12 DP2-N01 the declarations accept the implemented legacy input and the returned codes", { timeout: 60_000 }, () => {
  const dir = mkdtempSync(join(tmpdir(), "dp3-decl-"));
  try {
    const file = join(dir, "api.mts");
    writeFileSync(file, [
      `import { admitHandoff, decideAdmission, admissionRecordDefect, type AdmissionCode, type AdmissionDefect } from ${JSON.stringify(REPO + "/lib/emailDelivery.js")};`,
      "const ids = { kind: 'daily_snapshot', tenantId: 'tenantA', bizId: 'bizA', businessDate: '2026-09-08' };",
      "void admitHandoff(null, { ...ids, route: 'scheduled', ref: 'holder', nowMs: 0, legacy: 'delivery_outcome_unresolved' });",
      "const r = decideAdmission(null, { ids, route: 'manual', ref: 'holder', nowMs: 0, legacy: 'manual_repeat_not_permitted' });",
      "if (!r.result.admitted) { const c: AdmissionCode = r.result.code; void c; }",
      "const legacyCodes: AdmissionCode[] = ['manual_repeat_not_permitted', 'delivery_history_unreadable', 'delivery_already_accepted'];",
      "const d: AdmissionDefect | null = admissionRecordDefect({}, ids); void d; void legacyCodes;",
      "// @ts-expect-error an unknown legacy code is refused by the declaration",
      "void admitHandoff(null, { ...ids, route: 'scheduled', ref: 'holder', nowMs: 0, legacy: 'anything' });",
    ].join("\n"));
    const tsc = spawnSync(process.execPath, [join(REPO, "node_modules/typescript/bin/tsc"), "--noEmit", "--strict", "--skipLibCheck", "--module", "nodenext",
      "--moduleResolution", "nodenext", "--target", "es2022", "--preserveSymlinks", file], { encoding: "utf8", timeout: 55_000 });
    assert.equal(tsc.status, 0, tsc.stdout + tsc.stderr);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
