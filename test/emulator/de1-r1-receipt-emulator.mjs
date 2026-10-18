// DE1 R1 — the claim / finalization contract behind the run outcome (review finding D1) and the receipt contents (D4) on the
// REAL local RTDB emulator, through the REAL Admin SDK ref().transaction (cold client caches, real hash conflicts).
//
//   C1  a concurrent invocation BEFORE the owner finalizes: skipped in_progress with phase "sending" (decided on the server
//       value from a cold cache); after the owner's finalization the next invocation observes already_accepted; 1 hand-off
//   C2  an abandoned `claimed` (lease expired, provider never reached) is re-claimed at the same attempt and sent
//   C3  provider acceptance followed by a finalization failure: within the lease in_progress ("sending"), after it unknown;
//       never re-sent
//   C4  the acknowledgement of a STORED acceptance is lost: the invocation reports write_failed; the next one observes it
//   C5  a late provider answer after the attempt was recorded unknown changes nothing; a repeat never re-sends
//   C6  the stored receipt names OUR Message-ID; the provider-reported id is reduced to a bounded echo class; no address
//   C7  a second Admin app with a cold cache never takes over a live claim (in_progress), and finalization by a stale
//       claim id never lands on another invocation's receipt
//
// Local only: refuses to run unless pointed at the demo namespace on 127.0.0.1:9000. Fake `send` (no SMTP, no e-mail).
// Run: bash test/support/p1-r7-emu-run.sh <checkout> <abs-log-dir> de1r1=test/emulator/de1-r1-receipt-emulator.mjs
import admin from "firebase-admin";
import assert from "node:assert/strict";
import { deliverWithReceipt, currentDeliveryAttempt, receiptPath, RECEIPT_VERSION, CLAIM_LEASE_MS } from "../../lib/emailDelivery.js";

const PROJECT = "demo-marjin-rules";
const NS = "demo-marjin-rules-default-rtdb";
const DB_URL = `http://127.0.0.1:9000?ns=${NS}`;
const abort = (m) => { console.error("SAFETY ABORT: " + m); process.exit(2); };
if (process.env.FIREBASE_DATABASE_EMULATOR_HOST !== "127.0.0.1:9000") abort("FIREBASE_DATABASE_EMULATOR_HOST must be 127.0.0.1:9000");
if (process.env.GCLOUD_PROJECT !== PROJECT || process.env.GOOGLE_CLOUD_PROJECT !== PROJECT) abort("project must be " + PROJECT);
if (process.env.GOOGLE_APPLICATION_CREDENTIALS || process.env.FIREBASE_DATABASE_URL) abort("credentials / database URL must be absent");

const results = [];
async function check(id, fn) {
  try { await fn(); results.push({ id, ok: true }); console.log("ok   " + id); }
  catch (e) { results.push({ id, ok: false }); console.log("FAIL " + id + " — " + (e && e.message)); }
}
const appA = admin.initializeApp({ databaseURL: DB_URL }, "de1r1-a");
const appB = admin.initializeApp({ databaseURL: DB_URL }, "de1r1-b");   // a second server instance: its own (cold) cache
const dbA = appA.database(), dbB = appB.database();
const TO = "owner-a@example.test";
const read = async (p) => (await dbA.ref(p).once("value")).val();
const base = { tenantId: "tR", bizId: "bR", recipient: TO, backoffMs: 0, sleep: async () => {} };
const P = (d) => receiptPath("daily_snapshot", "tR", "bR", d);
const T0 = Date.UTC(2026, 9, 7, 4, 5);

/** a fake provider bound to the attempt as lib/sendEmail.js binds a real one; `gate` holds it after the hand-off */
function fakeSend(counter, { gate, info, error } = {}) {
  return async () => {
    const a = currentDeliveryAttempt();
    await a.beforeTransport();
    counter.n++;
    if (gate) await gate;
    if (error) { a.error = error; throw error; }
    a.info = info ? info(a) : { accepted: [TO], rejected: [], messageId: a.messageId, response: "250 OK" };
  };
}
/** a db whose transactions on `path` go through the real SDK, then fault as `fault(stateBefore)` decides */
// A3-T1 (test only, F-1): every other Reference member (once / get / child / ...) is the REAL Admin SDK reference, so the
// reads the DP routes now make (readBounded) reach the store unchanged; only `transaction` is wrapped and faulted, as before.
function faulty(db, fault) {
  return { ref: (p) => { const r = db.ref(p); return Object.assign(Object.create(r), { transaction: async (fn) => {
    const before = (await db.ref(p).once("value")).val();
    const f = fault(before && before.state);
    if (f === "throw_before") throw new Error("transaction failed");
    const out = await r.transaction(fn);
    if (f === "throw_after") throw new Error("acknowledgement lost");
    return out;
  } }); } };
}

await dbA.ref("/").set(null);

await check("C1 a concurrent invocation before finalization is in_progress (sending); the final outcome is then observed", async () => {
  const c = { n: 0 }; let release; const gate = new Promise((r) => { release = r; });
  const first = deliverWithReceipt({ ...base, db: dbA, businessDate: "2026-10-01", clock: () => T0, send: fakeSend(c, { gate }) });
  for (let i = 0; i < 400 && c.n === 0; i++) await new Promise((r) => setTimeout(r, 5));
  assert.equal(c.n, 1); assert.equal((await read(P("2026-10-01"))).state, "sending");
  const second = await deliverWithReceipt({ ...base, db: dbB, businessDate: "2026-10-01", clock: () => T0 + 1000, send: fakeSend(c) });
  assert.deepEqual([second.outcome, second.code, second.phase, second.receipt], ["skipped", "in_progress", "sending", "not_written"]);
  release();
  const r1 = await first;
  assert.deepEqual([r1.outcome, r1.receipt], ["accepted", "recorded"]);
  const third = await deliverWithReceipt({ ...base, db: dbB, businessDate: "2026-10-01", clock: () => T0 + 2000, send: fakeSend(c) });
  assert.deepEqual([third.outcome, third.code], ["skipped", "already_accepted"]);
  assert.equal(c.n, 1);
});

await check("C2 an abandoned claim (provider never reached) is re-claimed after its lease at the same attempt and sent", async () => {
  await dbA.ref(P("2026-10-02")).set({ v: RECEIPT_VERSION, kind: "daily_snapshot", tenantId: "tR", bizId: "bR", businessDate: "2026-10-02", state: "claimed", claimId: "dead", attempt: 1, claimedAt: T0 - 2 * CLAIM_LEASE_MS, leaseUntil: T0 - CLAIM_LEASE_MS, recipientHash: "x", updatedAt: 1, history: [] });
  const c = { n: 0 };
  const within = await deliverWithReceipt({ ...base, db: dbB, businessDate: "2026-10-02", clock: () => T0 - CLAIM_LEASE_MS - 1, send: fakeSend(c) });
  assert.deepEqual([within.outcome, within.code, within.phase], ["skipped", "in_progress", "claimed"]);
  const r = await deliverWithReceipt({ ...base, db: dbB, businessDate: "2026-10-02", clock: () => T0, send: fakeSend(c) });
  assert.deepEqual([r.outcome, r.attempt, r.receipt], ["accepted", 1, "recorded"]);
  const rec = await read(P("2026-10-02"));
  assert.deepEqual(rec.history.map((h) => h.state), ["abandoned_before_send", "accepted"]);
  assert.equal(c.n, 1);
});

await check("C3 acceptance followed by a finalization failure: in_progress within the lease, unknown after it, never re-sent", async () => {
  const c = { n: 0 };
  const r = await deliverWithReceipt({ ...base, db: faulty(dbA, (s) => (s === "sending" ? "throw_before" : null)), businessDate: "2026-10-03", clock: () => T0, send: fakeSend(c) });
  assert.deepEqual([r.outcome, r.receipt], ["accepted", "write_failed"]);
  assert.equal((await read(P("2026-10-03"))).state, "sending");
  const within = await deliverWithReceipt({ ...base, db: dbB, businessDate: "2026-10-03", clock: () => T0 + 60000, send: fakeSend(c) });
  assert.deepEqual([within.code, within.phase], ["in_progress", "sending"]);
  const after = await deliverWithReceipt({ ...base, db: dbB, businessDate: "2026-10-03", clock: () => T0 + CLAIM_LEASE_MS + 60000, send: fakeSend(c) });
  assert.deepEqual([after.outcome, after.code, after.receipt], ["skipped", "unknown_requires_reconciliation", "recorded"]);
  assert.deepEqual([(await read(P("2026-10-03"))).state, (await read(P("2026-10-03"))).outcome.code], ["unknown", "invocation_lost_during_send"]);
  assert.equal(c.n, 1);
});

await check("C4 the acknowledgement of a stored acceptance is lost: reported write_failed; the next invocation observes it", async () => {
  const c = { n: 0 };
  const r = await deliverWithReceipt({ ...base, db: faulty(dbA, (s) => (s === "sending" ? "throw_after" : null)), businessDate: "2026-10-04", clock: () => T0, send: fakeSend(c) });
  assert.deepEqual([r.outcome, r.receipt], ["accepted", "write_failed"]);
  assert.equal((await read(P("2026-10-04"))).state, "accepted");
  const next = await deliverWithReceipt({ ...base, db: dbB, businessDate: "2026-10-04", clock: () => T0 + 1000, send: fakeSend(c) });
  assert.deepEqual([next.outcome, next.code], ["skipped", "already_accepted"]);
  assert.equal(c.n, 1);
});

await check("C5 a late provider answer after an unknown outcome changes nothing; a repeat never re-sends", async () => {
  const c = { n: 0 }; let lateCtx = null;
  const send = async () => {
    const a = currentDeliveryAttempt(); await a.beforeTransport(); c.n++; lateCtx = a;
    const e = Object.assign(new Error("no provider answer"), { code: "EDEADLINE" }); a.error = e; throw e;
  };
  const r = await deliverWithReceipt({ ...base, db: dbA, businessDate: "2026-10-05", clock: () => T0, send });
  assert.deepEqual([r.outcome, r.code], ["unknown", "provider_no_answer_deadline"]);
  const before = JSON.stringify(await read(P("2026-10-05")));
  lateCtx.info = { accepted: [TO], rejected: [], messageId: lateCtx.messageId, response: "250 OK" };   // the provider answers late
  await new Promise((res) => setTimeout(res, 100));
  assert.equal(JSON.stringify(await read(P("2026-10-05"))), before, "the receipt is unchanged");
  const again = await deliverWithReceipt({ ...base, db: dbB, businessDate: "2026-10-05", clock: () => T0 + 2 * CLAIM_LEASE_MS, send: fakeSend(c) });
  assert.deepEqual([again.outcome, again.code], ["skipped", "unknown_requires_reconciliation"]);
  assert.equal(c.n, 1);
});

await check("C6 the stored receipt names OUR Message-ID; the provider-reported id is a bounded echo class; no address", async () => {
  const c = { n: 0 };
  const r = await deliverWithReceipt({ ...base, db: dbA, businessDate: "2026-10-06", clock: () => T0,
    send: fakeSend(c, { info: () => ({ accepted: [TO], rejected: [], messageId: "<private@example.test>", response: "250 2.0.0 OK private@example.test" }) }) });
  assert.deepEqual([r.outcome, r.receipt], ["accepted", "recorded"]);
  const rec = await read(P("2026-10-06"));
  assert.match(rec.messageId, /^<daily_snapshot\.1\.[0-9a-f-]{36}@delivery\.marjin\.app>$/);
  assert.equal(rec.messageId, rec.messageIdHeader); assert.equal(r.messageId, rec.messageId);
  assert.deepEqual([rec.providerIdEcho, rec.responseCode], ["different", 250]);
  const { recipientHash, ...rest } = rec;
  assert.match(recipientHash, /^[0-9a-f]{64}$/);
  assert.ok(!/private@example\.test|owner-a@example\.test/.test(JSON.stringify(rest)), JSON.stringify(rest));
});

await check("C7 a cold-cache second instance never takes over a live claim; a stale claim id never finalizes another receipt", async () => {
  const c = { n: 0 }; let release; const gate = new Promise((r) => { release = r; });
  const first = deliverWithReceipt({ ...base, db: dbA, businessDate: "2026-10-07", clock: () => T0, newClaimId: () => "claim-first", send: fakeSend(c, { gate }) });
  for (let i = 0; i < 400 && c.n === 0; i++) await new Promise((r) => setTimeout(r, 5));
  // another invocation, much later (lease expired): converts the stale `sending` to unknown — the first one's finalization must not land
  const late = await deliverWithReceipt({ ...base, db: dbB, businessDate: "2026-10-07", clock: () => T0 + 2 * CLAIM_LEASE_MS, send: fakeSend(c) });
  assert.deepEqual([late.outcome, late.code, late.receipt], ["skipped", "unknown_requires_reconciliation", "recorded"]);
  release();
  const r1 = await first;
  assert.deepEqual([r1.outcome, r1.receipt], ["accepted", "write_failed"], "the first invocation's finalization was refused");
  const rec = await read(P("2026-10-07"));
  assert.deepEqual([rec.state, rec.claimId], ["unknown", "claim-first"], "the unknown verdict stands");
  assert.equal(c.n, 1);
});

await appA.delete(); await appB.delete();
const failed = results.filter((r) => !r.ok);
console.log(`DE1R1_EMULATOR total=${results.length} pass=${results.length - failed.length} fail=${failed.length}`);
process.exit(failed.length || results.length !== 7 ? 1 : 0);
