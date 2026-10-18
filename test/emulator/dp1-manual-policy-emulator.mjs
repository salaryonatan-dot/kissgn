// DP1 — the 1.0 owner policies on the manual Daily (P4 / E4) on the REAL local RTDB emulator (transaction engine, real Admin
// SDK, cold instances). AUTHOR evidence only: it does not replace an independent writer → RTDB → cold-reader execution.
//   DPE-01  P4 over the real transport: a first-time manual send creates its record before the hand-off and is accepted; the
//           same identity is then refused with no provider call; another business date is a first-time send
//   DPE-02  concurrency: six manual sends of one identity from six cold instances hand over exactly ONE message (one record)
//   DPE-03  the scheduled receipt is the identity: accepted ⇒ repeat refused; unknown ⇒ unresolved; the receipt is not changed
//   DPE-04  E4: a business date refused while held (committed refusal) is refused to the manual send after the audited release
//   DPE-05  the parent-collection transaction preserves every other record byte-for-byte and writes the HR1 record shape
// Local only: refuses to run unless pointed at the demo namespace on 127.0.0.1:9000. Fake `send` only (no SMTP, no e-mail).
// Run: bash test/support/p1-r7-emu-run.sh <checkout> <abs-log-dir> dp1=test/emulator/dp1-manual-policy-emulator.mjs
import admin from "firebase-admin";
import assert from "node:assert/strict";
import * as E from "../../lib/emailDelivery.js";

const PROJECT = "demo-marjin-rules", NS = "demo-marjin-rules-default-rtdb", DB_URL = `http://127.0.0.1:9000?ns=${NS}`;
const abort = (m) => { console.error("SAFETY ABORT: " + m); process.exit(2); };
if (process.env.FIREBASE_DATABASE_EMULATOR_HOST !== "127.0.0.1:9000") abort("FIREBASE_DATABASE_EMULATOR_HOST must be 127.0.0.1:9000");
if (process.env.GCLOUD_PROJECT !== PROJECT || process.env.GOOGLE_CLOUD_PROJECT !== PROJECT) abort("project must be " + PROJECT);
if (process.env.GOOGLE_APPLICATION_CREDENTIALS || process.env.FIREBASE_DATABASE_URL) abort("credentials / database URL must be absent");

const results = [];
async function check(id, fn) {
  try { await fn(); results.push({ id, ok: true }); console.log("ok   " + id); }
  catch (e) { results.push({ id, ok: false }); console.log("FAIL " + id + " — " + (e && e.message)); }
}
let n = 0;
const apps = [];
const cold = () => { const a = admin.initializeApp({ databaseURL: DB_URL }, "dp1-" + n++); apps.push(a); return a.database(); };
const seedDb = cold();
const read = async (p) => (await cold().ref(p).once("value")).val();
const op = { actor: "op.emu", reason: "emulator check" };
const T = "tA", B = "bA", TO = "owner-a@example.test";
const NOW = Date.parse("2026-09-08T04:05:00Z");
let calls = 0;
const accept = async () => { const a = E.currentDeliveryAttempt(); await a.beforeTransport(); calls++; await new Promise((r) => setTimeout(r, 30));
  a.info = { accepted: [TO], rejected: [], response: "250 OK" }; };
const lost = async () => { const a = E.currentDeliveryAttempt(); await a.beforeTransport(); calls++; const e = new Error("Connection closed"); e.code = "ECONNECTION"; e.command = "CONN"; throw e; };
const manual = (date, db = cold(), send = accept) => E.deliverManualDaily({ db, tenantId: T, bizId: B, businessDate: date, recipient: TO, recipientSelection: "owner", actorRole: "owner", send, clock: () => NOW });
const records = async () => (await read(`${E.MANUAL_ATTEMPT_ROOT}/${T}/${B}`)) ?? {};
const release = async () => {
  const v = E.deliveryInventoryView(await read(E.DELIVERY_HOLD_PATH));
  assert.equal((await E.confirmDeliveryInventory(cold(), { ...op, generation: v.generation, digest: v.digest })).ok, true);
  const rec = await read(E.DELIVERY_HOLD_PATH);
  assert.equal((await E.changeDeliveryHold(cold(), { action: "release", ...op, expectVersion: rec.version })).code, "applied");
};

await seedDb.ref("/").set(null);
assert.equal((await E.changeDeliveryHold(cold(), { action: "init", ...op })).code, "applied");
await release();

await check("DPE-01 P4 over the real transport: first-time send recorded and accepted; the same identity refused; another date sent", async () => {
  let atHandoff = null;
  const r = await manual("2026-09-10", cold(), async () => { const a = E.currentDeliveryAttempt(); await a.beforeTransport();
    atHandoff = await read(E.manualAttemptPath(T, B, a.claimId)); calls++; a.info = { accepted: [TO], rejected: [], response: "250 OK" }; });
  assert.deepEqual([r.outcome, r.record, calls], ["accepted", "recorded", 1]);
  assert.equal(atHandoff.state, "handing_off", "the record existed when the provider was invoked");
  const again = await manual("2026-09-10");
  assert.deepEqual([again.outcome, again.code, again.record, calls], ["refused", "manual_repeat_not_permitted", "not_written", 1]);
  const other = await manual("2026-09-11");
  assert.deepEqual([other.outcome, calls], ["accepted", 2]);
  assert.equal(Object.keys(await records()).length, 2);
});

await check("DPE-02 six concurrent manual sends of one identity from six cold instances: exactly one hand-off, one record", async () => {
  const before = calls;
  const rs = await Promise.all(Array.from({ length: 6 }, () => manual("2026-09-12")));
  assert.equal(calls - before, 1, "exactly one message handed over: " + JSON.stringify(rs.map((x) => [x.outcome, x.code])));
  assert.equal(rs.filter((x) => x.outcome === "accepted").length, 1);
  assert.ok(rs.filter((x) => x.outcome !== "accepted").every((x) => x.outcome === "refused" &&
    // DP2 (T-DP2-TEST-EXPECTATIONS): the shared admission reports a holder still handing over as delivery_in_progress
    ["delivery_outcome_unresolved", "manual_repeat_not_permitted", "delivery_in_progress"].includes(x.code) && x.record === "not_written"), JSON.stringify(rs));
  assert.equal(Object.values(await records()).filter((x) => x.businessDate === "2026-09-12").length, 1);
});

await check("DPE-03 the scheduled receipt is the identity: accepted ⇒ repeat refused; unknown ⇒ unresolved; the receipt is unchanged", async () => {
  const base = { db: cold(), tenantId: T, bizId: B, recipient: TO, clock: () => NOW };
  const s = await E.deliverWithReceipt({ ...base, businessDate: "2026-09-13", send: accept, gate: E.makeDailyDeliveryGate(cold(), "2026-09-13") });
  assert.equal(s.outcome, "accepted");
  const u = await E.deliverWithReceipt({ ...base, businessDate: "2026-09-14", send: lost, gate: E.makeDailyDeliveryGate(cold(), "2026-09-14") });
  assert.equal(u.outcome, "unknown");
  const before = calls, r13 = await read(E.receiptPath("daily_snapshot", T, B, "2026-09-13")), r14 = await read(E.receiptPath("daily_snapshot", T, B, "2026-09-14"));
  assert.deepEqual([(await manual("2026-09-13")).code, (await manual("2026-09-14")).code], ["manual_repeat_not_permitted", "delivery_outcome_unresolved"]);
  assert.equal(calls, before);
  assert.deepEqual(await read(E.receiptPath("daily_snapshot", T, B, "2026-09-13")), r13);
  assert.deepEqual(await read(E.receiptPath("daily_snapshot", T, B, "2026-09-14")), r14, "the unknown receipt is not reconciled or cleared");
});

await check("DPE-04 E4: a business date refused while held is refused to the manual send after the audited release", async () => {
  const rec = await read(E.DELIVERY_HOLD_PATH);
  assert.equal((await E.changeDeliveryHold(cold(), { action: "hold", ...op, expectVersion: rec.version })).code, "applied");
  const g = await E.makeDailyDeliveryGate(cold(), "2026-09-15")("g1");
  assert.deepEqual([g.open, g.code, g.heldDate], [false, "delivery_held", "recorded"]);
  const whileHeld = await manual("2026-09-15");
  assert.deepEqual([whileHeld.outcome, whileHeld.code], ["held", "delivery_held"]);
  await release();
  const before = calls, n0 = Object.keys(await records()).length;
  const m = await manual("2026-09-15");
  assert.deepEqual([m.outcome, m.code, m.record, calls - before], ["held", "held_day", "not_written", 0]);
  assert.equal(Object.keys(await records()).length, n0, "no record for a refused day");
  assert.equal((await manual("2026-09-16")).outcome, "accepted", "a date the hold did not refuse is a first-time send");
});

await check("DPE-05 the collection transaction keeps every other record byte-for-byte and writes the HR1 record shape", async () => {
  const before = await records();
  const r = await manual("2026-09-17");
  assert.equal(r.outcome, "accepted");
  const after = await records();
  for (const [id, x] of Object.entries(before)) assert.deepEqual(after[id], x, id + " unchanged");
  const mine = after[r.attemptId];
  // RTDB stores no null: `code` (null on acceptance) and `deploymentId` (absent outside a deployment) are elided, as in HR1
  assert.deepEqual(Object.keys(mine).sort(), ["actorRole", "attemptId", "bizId", "businessDate", "kind", "messageIdHeader", "recipientSelection",
    "settledAt", "startedAt", "state", "tenantId", "updatedAt", "v"].sort());
  assert.deepEqual([mine.v, mine.state, mine.businessDate, mine.messageIdHeader], [E.MANUAL_ATTEMPT_VERSION, "accepted", "2026-09-17", r.messageId]);
});

await Promise.all(apps.map((a) => a.delete()));
const failed = results.filter((r) => !r.ok).length;
console.log(`dp1 emulator: ${results.length - failed} passed / ${failed} failed / 0 skipped`);
process.exit(failed ? 1 : 0);
