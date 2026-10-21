// DP1 — the 1.0 owner delivery policies on the manual Daily (owner decisions P4 / E4, approved 2026-10-17), through the REAL
// route api/daily-snapshot/run.ts and lib/emailDelivery.js (test/support/daily-email-harness.mjs: only the database, the token
// verifier and the SMTP provider are replaced; no network, no real e-mail). Delivery identity = (daily_snapshot, tenant,
// business, business date): the scheduled receipt node and the manual record's own fields — never a time window or recipient.
//   DP1-01  P4: after a scheduled acceptance of the exact identity, a manual send is refused (409), nothing sent or written
//   DP1-02  P4: an accepted manual send is not repeated; another business date is another delivery
//   DP1-03  unknown outcomes are never retried by a manual send (scheduled unknown / sending, manual unknown / handing_off)
//   DP1-04  a definitive failure is no delivery: a manual send after it is an ordinary first-time send
//   DP1-05  E4: a business date the hold refused is never delivered by a manual send (committed refusal, legacy marker,
//           unreadable marker); the held Daily keeps its 503
//   DP1-06  malformed or missing evidence fails closed; exact tenant / business / date identity (no neighbour blocks)
//   DP1-07  concurrency: concurrent manual sends of one identity hand over exactly one message (also under the SDK's
//           guess-first transaction protocol); a running scheduled claim refuses the manual send
//   DP1-08  decideManualRepeat: the pure decision table and its precedence
//   DP1-09  preserved on parent and candidate: the first-time manual send, its response shape and record, the held Daily
import { test } from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { buildSandbox, installSmtp, SMTP, seedWorld, freezeClock, runCron, runManual, sdkTransactions, RECEIPTS, REPO, T, B, B2, T2, HOLD_PATH } from "../support/daily-email-harness.mjs";

const { route } = await buildSandbox();
const E = await import(pathToFileURL(REPO + "/lib/emailDelivery.js").href);
const AT = Date.UTC(2026, 8, 8, 4, 5), NEXT = AT + 86_400_000;   // 07:05 Israel: business dates 2026-09-08 / 2026-09-09
const DATE = "2026-09-08", NEXT_DATE = "2026-09-09";
const db = () => globalThis.__DB;
const receipt = (t = T, b = B, d = DATE) => db().read(`${RECEIPTS}/${t}/${b}/${d}`);
const records = (t = T, b = B) => db().read(`${E.MANUAL_ATTEMPT_ROOT}/${t}/${b}`);
async function at(ms, fn) { const restore = freezeClock(ms); try { return await fn(); } finally { restore(); } }
const cron = (ms = AT) => at(ms, () => runCron(route));
const manual = (ms = AT, o) => at(ms, () => runManual(route, o));
const refusal = (res) => [res.statusCode, res.body && res.body.code];
const manualRecord = (state, businessDate = DATE, extra = {}) => ({ v: E.MANUAL_ATTEMPT_VERSION, attemptId: extra.attemptId ?? "a0000000-0000-4000-8000-000000000001",
  kind: "daily_snapshot", tenantId: T, bizId: B, businessDate, state, messageIdHeader: "<manual.x@delivery.marjin.app>", startedAt: AT - 1000, updatedAt: AT - 1000, ...extra });
const seedRecord = (rec, t = T, b = B) => db().seed(`${E.MANUAL_ATTEMPT_ROOT}/${t}/${b}/${rec.attemptId}`, rec);
const scheduledReceipt = (state, extra = {}) => ({ v: "MARJIN_EMAIL_RECEIPT/1", kind: "daily_snapshot", tenantId: T, bizId: B, businessDate: DATE, state,
  claimId: "c0000000-0000-4000-8000-000000000001", attempt: 1, recipientHash: "0".repeat(64), updatedAt: AT - 1000, history: [], ...extra });

test("DP1-01 P4: a scheduled acceptance of the exact identity refuses the manual send; nothing is sent, no record, the receipt is untouched", async () => {
  seedWorld(); const smtp = installSmtp([SMTP.accept()]);
  assert.equal((await cron()).statusCode, 200);
  const before = JSON.stringify(receipt());
  const m = await manual();
  assert.deepEqual(refusal(m), [409, "manual_repeat_not_permitted"], JSON.stringify(m.body));
  assert.deepEqual([m.body.tenantId, m.body.bizId], [T, B]);
  assert.ok(!/@|rcpt:/.test(JSON.stringify(m.body)), "no address in the refusal");
  assert.equal(smtp.calls.length, 3, "only the three scheduled messages");
  assert.equal(records(), null, "no manual record is written for a refused send");
  assert.equal(JSON.stringify(receipt()), before, "the scheduled receipt is read, never changed");
  // the recipient is not the identity: a changed owner address is still the same Daily
  db().seed(`tenants/${T}/app/users`, { _v: JSON.stringify([{ id: 1, name: "Owner A", email: "new-owner@example.test", role: "owner", firebaseUid: "u_owner_a" }]) });
  assert.deepEqual(refusal(await manual()), [409, "manual_repeat_not_permitted"]);
  assert.equal(smtp.calls.length, 3);
});

test("DP1-02 P4: an accepted manual send is not repeated; the next business date is a different delivery", async () => {
  seedWorld(); const smtp = installSmtp([SMTP.accept()]);
  const first = await manual();
  assert.equal(first.statusCode, 200, JSON.stringify(first.body));
  const again = await manual();
  assert.deepEqual(refusal(again), [409, "manual_repeat_not_permitted"]);
  assert.equal(smtp.calls.length, 1);
  assert.deepEqual(Object.values(records()).map((r) => [r.state, r.businessDate]), [["accepted", DATE]], "one record, the accepted one");
  const next = await manual(NEXT);
  assert.equal(next.statusCode, 200, "another business date of the same business is a first-time send");
  assert.equal(smtp.calls.length, 2);
});

test("DP1-03 unknown outcomes stay unresolved: no manual send after a scheduled unknown / sending or a manual unknown / handing_off", async () => {
  seedWorld({ withSecondBiz: false, withSecondTenant: false }); let smtp = installSmtp([SMTP.closedAfterData()]);
  assert.equal((await cron()).statusCode, 500);
  assert.equal(receipt().state, "unknown");
  smtp = installSmtp([SMTP.accept()]);
  assert.deepEqual(refusal(await manual()), [409, "delivery_outcome_unresolved"]);
  assert.equal(smtp.calls.length, 0, "a possibly accepted Daily is never sent again");
  assert.equal(receipt().state, "unknown", "the unknown receipt is not reconciled, cleared or changed (P7)");
  // a manual send whose outcome is unknown
  seedWorld({ withSecondBiz: false, withSecondTenant: false }); smtp = installSmtp([SMTP.closedAfterData()]);
  assert.deepEqual([(await manual()).statusCode, smtp.calls.length], [504, 1]);
  smtp = installSmtp([SMTP.accept()]);
  assert.deepEqual(refusal(await manual()), [409, "delivery_outcome_unresolved"]);
  assert.equal(smtp.calls.length, 0);
  assert.deepEqual(Object.values(records()).map((r) => r.state), ["unknown"], "the unknown record is preserved as it is");
  // a stuck hand-off and a scheduled send that may be with the provider (running or expired lease)
  for (const seed of [() => seedRecord(manualRecord("handing_off")),
    () => db().seed(`${RECEIPTS}/${T}/${B}/${DATE}`, scheduledReceipt("sending", { leaseUntil: AT + 60_000 })),
    () => db().seed(`${RECEIPTS}/${T}/${B}/${DATE}`, scheduledReceipt("sending", { leaseUntil: AT - 60_000 }))]) {
    seedWorld({ withSecondBiz: false, withSecondTenant: false }); seed(); smtp = installSmtp([SMTP.accept()]);
    assert.deepEqual(refusal(await manual()), [409, "delivery_outcome_unresolved"]);
    assert.equal(smtp.calls.length, 0);
  }
});

test("DP1-04 a definitive failure is no delivery: the manual send after it is an ordinary first-time send, then not repeated", async () => {
  seedWorld({ withSecondBiz: false, withSecondTenant: false }); let smtp = installSmtp([SMTP.rejectRecipient()]);
  await cron();
  assert.equal(receipt().state, "failed");
  smtp = installSmtp([SMTP.accept()]);
  assert.equal((await manual()).statusCode, 200);
  assert.deepEqual(refusal(await manual()), [409, "manual_repeat_not_permitted"]);
  assert.equal(smtp.calls.length, 1);
  // a manual provider refusal, then a manual send that is accepted
  seedWorld({ withSecondBiz: false, withSecondTenant: false }); smtp = installSmtp([SMTP.rejectRecipient()]);
  assert.equal((await manual()).statusCode, 502);
  smtp = installSmtp([SMTP.accept()]);
  assert.equal((await manual()).statusCode, 200, "a definitive refusal is not a delivery");
  assert.deepEqual(Object.values(records()).map((r) => r.state).sort(), ["accepted", "failed"]);
});

test("DP1-05 E4: a business date the hold refused is never delivered manually; the held Daily keeps its 503", async () => {
  // the production path: a scheduled run refused while held commits the refusal; the release is audited and confirmed
  const world = seedWorld({ hold: "absent", withSecondBiz: false, withSecondTenant: false }); sdkTransactions(world, "delivery_control");
  const op = { actor: "dp1.test", reason: "policy regression", nowMs: AT - 60_000 };
  assert.equal((await E.changeDeliveryHold(world, { ...op, action: "init" })).ok, true);
  let smtp = installSmtp([SMTP.accept()]);
  const held = await cron();
  assert.deepEqual([held.statusCode, held.body.status, held.body.heldDate], [503, "held", "recorded"]);
  const heldManual = await manual();
  assert.deepEqual([heldManual.statusCode, heldManual.body.code], [503, "delivery_held"], "while held: the existing 503");
  const v = E.deliveryInventoryView(world.read(HOLD_PATH));
  assert.equal((await E.confirmDeliveryInventory(world, { ...op, generation: v.generation, digest: v.digest })).ok, true);
  assert.equal((await E.changeDeliveryHold(world, { ...op, action: "release", expectVersion: 1 })).ok, true);
  const m = await manual();
  assert.deepEqual(refusal(m), [409, "held_day"], JSON.stringify(m.body));
  assert.equal(smtp.calls.length, 0, "no deliberate delivery of the refused day");
  assert.equal(records(), null);
  assert.equal((await manual(NEXT)).statusCode, 200, "the next business date is not a held day");
  assert.equal(smtp.calls.length, 1);
  // a legacy held-date marker (refusal not provable either way) and a marker that cannot be read: fail closed
  seedWorld({ withSecondBiz: false, withSecondTenant: false }); smtp = installSmtp([SMTP.accept()]);
  db().seed(E.heldDatePath(DATE), { businessDate: DATE });
  assert.deepEqual(refusal(await manual()), [409, "legacy_evidence_unresolved"]);
  const w = seedWorld({ withSecondBiz: false, withSecondTenant: false }); const ref = w.ref;
  w.ref = (p, q) => (p === E.heldDatePath(DATE) ? { ...ref(p, q), once: async () => { throw new Error("unavailable"); } } : ref(p, q));
  assert.deepEqual(refusal(await manual()), [503, "held_day_unverifiable"]);
  assert.equal(smtp.calls.length, 0);
});

test("DP1-06 malformed or missing evidence fails closed; only the exact tenant / business / business date identity blocks", async () => {
  const cases = [
    ["receipt of another version", () => db().seed(`${RECEIPTS}/${T}/${B}/${DATE}`, { ...scheduledReceipt("accepted"), v: "MARJIN_EMAIL_RECEIPT/0" }), [422, "delivery_history_unreadable"]],
    ["receipt in no known state", () => db().seed(`${RECEIPTS}/${T}/${B}/${DATE}`, scheduledReceipt("delivered")), [422, "delivery_history_unreadable"]],
    ["receipt that is not a record", () => db().seed(`${RECEIPTS}/${T}/${B}/${DATE}`, "accepted"), [422, "delivery_history_unreadable"]],
    ["record collection that is not a record", () => db().seed(`${E.MANUAL_ATTEMPT_ROOT}/${T}/${B}`, "x"), [422, "delivery_history_unreadable"]],
    ["record of another schema version", () => seedRecord({ ...manualRecord("failed"), v: "MARJIN_MANUAL_ATTEMPT/0" }), [422, "delivery_history_unreadable"]],
    ["record filed under another id", () => db().seed(`${E.MANUAL_ATTEMPT_ROOT}/${T}/${B}/b0000000`, manualRecord("failed")), [422, "delivery_history_unreadable"]],
    ["record without a readable date that may be accepted", () => seedRecord(manualRecord("accepted", null)), [422, "delivery_history_unreadable"]],
    ["running scheduled claim", () => db().seed(`${RECEIPTS}/${T}/${B}/${DATE}`, scheduledReceipt("claimed", { leaseUntil: AT + 60_000 })), [409, "delivery_in_progress"]],
    ["expired scheduled claim (never handed over)", () => db().seed(`${RECEIPTS}/${T}/${B}/${DATE}`, scheduledReceipt("claimed", { leaseUntil: AT - 1 })), [200, undefined]],
    // DP4 (T-DP4-TEST-EXPECTATIONS, DP3-R01): only a COMPLETE definitive failure excuses an unreadable date; the fixture carries
    // the fields its writer sets (settledAt, code) — the incomplete variant is refused (dp4-legacy-date-scope.test.mjs)
    ["failed record without a readable date", () => seedRecord(manualRecord("failed", null, { settledAt: AT - 500, code: "provider_rejected_550" })), [200, undefined]],
    ["accepted record of another business date", () => seedRecord(manualRecord("accepted", NEXT_DATE)), [200, undefined]],
    ["accepted receipt of another business date", () => db().seed(`${RECEIPTS}/${T}/${B}/${NEXT_DATE}`, { ...scheduledReceipt("accepted"), businessDate: NEXT_DATE }), [200, undefined]],
    ["accepted receipt of another business", () => db().seed(`${RECEIPTS}/${T}/${B2}/${DATE}`, { ...scheduledReceipt("accepted"), bizId: B2 }), [200, undefined]],
    ["accepted receipt of the same business id in another tenant", () => db().seed(`${RECEIPTS}/${T2}/${B}/${DATE}`, { ...scheduledReceipt("accepted"), tenantId: T2 }), [200, undefined]],
    ["accepted record of another business", () => seedRecord({ ...manualRecord("accepted"), bizId: B2 }, T, B2), [200, undefined]],
  ];
  for (const [name, seed, want] of cases) {
    seedWorld(); seed(); const smtp = installSmtp([SMTP.accept()]);
    const res = await manual();
    assert.deepEqual([res.statusCode, want[0] === 200 ? undefined : res.body.code], want, name + ": " + JSON.stringify(res.body));
    assert.equal(smtp.calls.length, want[0] === 200 ? 1 : 0, name);
  }
  // a receipt store that cannot be read
  const w = seedWorld(); const ref = w.ref; const smtp = installSmtp([SMTP.accept()]);
  w.ref = (p, q) => (p === `${RECEIPTS}/${T}/${B}/${DATE}` ? { ...ref(p, q), once: async () => { throw new Error("unavailable"); } } : ref(p, q));
  assert.deepEqual(refusal(await manual()), [503, "delivery_history_unavailable"]);
  assert.equal(smtp.calls.length, 0);
});

test("DP1-07 concurrency: one identity, many manual sends, exactly one hand-off (plain and guess-first transactions)", async () => {
  for (const guessFirst of [false, true]) {
    const w = seedWorld({ withSecondBiz: false, withSecondTenant: false }); if (guessFirst) sdkTransactions(w, E.MANUAL_ATTEMPT_ROOT);
    const smtp = installSmtp([SMTP.accept()]);
    const all = await at(AT, () => Promise.all(Array.from({ length: 5 }, () => runManual(route))));
    assert.deepEqual(all.map((r) => r.statusCode).sort(), [200, 409, 409, 409, 409], JSON.stringify(all.map(refusal)));
    assert.equal(smtp.calls.length, 1, "exactly one Daily handed over");
    assert.equal(Object.keys(records()).length, 1, "exactly one record");
    // DP2 (T-DP2-TEST-EXPECTATIONS): the shared admission reports a holder that is still handing over as delivery_in_progress
    assert.ok(all.filter((r) => r.statusCode === 409).every((r) => ["manual_repeat_not_permitted", "delivery_outcome_unresolved", "delivery_in_progress"].includes(r.body.code)));
  }
  // library level, with the hand-offs interleaved: both pass the gate and read the receipt before either creates its record
  const w = seedWorld({ withSecondBiz: false, withSecondTenant: false });
  let handed = 0;
  const send = async () => { await new Promise((r) => setImmediate(r)); const a = E.currentDeliveryAttempt(); await a.beforeTransport(); handed++;
    await new Promise((r) => setTimeout(r, 50)); a.info = { accepted: ["o@example.test"], rejected: [], response: "250 OK" }; };   // the provider answers late
  const go = () => E.deliverManualDaily({ db: w, tenantId: T, bizId: B, businessDate: DATE, recipient: "o@example.test", send, gate: async () => ({ open: true }), clock: () => AT });
  const rs = await Promise.all([go(), go()]);
  assert.deepEqual(rs.map((r) => r.outcome).sort(), ["accepted", "refused"]);
  assert.equal(rs.find((r) => r.outcome === "refused").code, "delivery_in_progress", "the other one's hand-off is in progress (DP2: the shared admission)");
  assert.equal(handed, 1);
});

test("DP1-08 decideManualRepeat: decision table, precedence and identity validation", () => {
  const d = (receipt, recs, extra = {}) => E.decideManualRepeat({ receipt, records: recs, tenantId: T, bizId: B, businessDate: DATE, nowMs: AT, ...extra });
  const rec = (state, date = DATE, id = "a0000000-0000-4000-8000-000000000001", extra = {}) => ({ [id]: manualRecord(state, date, { attemptId: id, ...extra }) });
  assert.equal(d(null, null), null, "nothing known: first-time send");
  assert.equal(d(scheduledReceipt("accepted"), null), "manual_repeat_not_permitted");
  assert.equal(d(scheduledReceipt("unknown"), null), "delivery_outcome_unresolved");
  // DP3 (T-DP3-TEST-EXPECTATIONS): a definitive failure is "no delivery" only as the COMPLETE record its writer produces
  // (receipt: code, retryable, finishedAt; manual record: settledAt, code) — the fixtures carry the writer's fields
  const failedReceipt = (retryable) => scheduledReceipt("failed", { retryable, code: "provider_rejected_550", finishedAt: AT - 500 });
  const failedRecord = () => rec("failed", DATE, undefined, { settledAt: AT - 500, code: "provider_rejected_550" });
  assert.equal(d(failedReceipt(true), null), null);
  assert.equal(d(failedReceipt(false), null), null);
  assert.equal(d(null, rec("accepted")), "manual_repeat_not_permitted");
  assert.equal(d(null, failedRecord()), null);
  assert.equal(d(null, rec("unknown")), "delivery_outcome_unresolved");
  assert.equal(d(null, { ...rec("unknown"), ...rec("accepted", DATE, "a0000000-0000-4000-8000-000000000002") }), "manual_repeat_not_permitted", "a definitive acceptance outranks");
  assert.equal(d(scheduledReceipt("claimed", { leaseUntil: AT + 1 }), { x: 1 }), "delivery_in_progress", "an active claim outranks unreadable evidence");
  assert.equal(d(scheduledReceipt("unknown"), { x: 1 }), "delivery_outcome_unresolved");
  assert.equal(d(null, rec("accepted"), { tenantId: T2 }), "delivery_history_unreadable", "a record naming another tenant under this path is not well-formed");
  for (const bad of [{ businessDate: null }, { businessDate: "2026-02-30" }, { tenantId: "a/b" }, { bizId: "x:y" }, { nowMs: NaN }])
    assert.equal(d(null, null, bad), "delivery_history_unreadable", JSON.stringify(bad));
});

test("DP1-09 preserved: the first-time manual send, its response, its record; the held Daily and the identity refusals keep their replies", async () => {
  seedWorld(); const smtp = installSmtp([SMTP.accept()]);
  const m = await manual();
  assert.equal(m.statusCode, 200, JSON.stringify(m.body));
  assert.deepEqual([m.body.status, m.body.delivery], ["success", { outcome: "accepted", recipient: "server_configured" }]);
  assert.deepEqual([m.body.snapshot.tenantId, m.body.snapshot.bizId, m.body.snapshot.date], [T, B, DATE]);
  assert.match(smtp.calls[0].messageIdHeader, /^<manual\.[0-9a-f-]{36}@delivery\.marjin\.app>$/);
  const [rec] = Object.values(records());
  assert.deepEqual([rec.v, rec.kind, rec.tenantId, rec.bizId, rec.businessDate, rec.state, rec.actorRole, rec.recipientSelection],
    [E.MANUAL_ATTEMPT_VERSION, "daily_snapshot", T, B, DATE, "accepted", "owner", "server_configured"]);
  assert.equal(receipt(), null, "the manual send writes no scheduled receipt");
  // after the manual send the scheduled path is unchanged: its own receipt decides (no new receipt state)
  const other = await manual(AT, { bizId: B2 });
  assert.equal(other.statusCode, 200, "another business of the tenant is its own first-time send");
  // a held Daily: 503 delivery_held before the build (G2), nothing sent
  seedWorld({ hold: "absent" }); const s2 = installSmtp([SMTP.accept()]);
  const h = await manual();
  assert.deepEqual([h.statusCode, h.body.code], [503, "delivery_hold_unreadable"]);
  assert.equal(s2.calls.length, 0);
  // an unregistered business: the identity gate's 404 before anything else
  seedWorld();
  assert.deepEqual(refusal(await manual(AT, { bizId: "bizZ" })), [404, "business_not_registered"]);
});
