// DE1 R2 — the provider-outcome evidence (review findings E1 / E2) on the REAL local RTDB emulator, through the REAL Admin SDK
// ref().transaction (cold client caches, real hash conflicts) and two server instances.
//
//   R2E1  a provider error after the hand-off carrying the internal-looking `before_transport` marker: stored unknown; a
//         second instance (cold cache) skips it as unknown_requires_reconciliation; one provider call
//   R2E2  a "Connection timeout" / refused-connection error after the hand-off: unknown, no in-run retry, one call
//   R2E3  an indeterminate resolved result (recipient listed nowhere, 250): unknown, never a definite refusal, never re-sent
//   R2E4  a contradictory result (listed accepted AND rejected): unknown, never re-sent
//   R2E5  controls — a definite SMTP refusal (550 reply) is failed/final; a 4xx deferral is retried within the run and
//         accepted on attempt 2; a valid acceptance is accepted and then observed
//   R2E6  a failure confirmed BEFORE the provider call (the claim → sending transaction fails): failed/claim_lost, zero
//         provider calls; the next instance sends it (attempt 2)
//
// Local only: refuses to run unless pointed at the demo namespace on 127.0.0.1:9000. Fake `send` (no SMTP, no e-mail).
// Run: bash test/support/p1-r7-emu-run.sh <checkout> <abs-log-dir> de1r2=test/emulator/de1-r2-receipt-emulator.mjs
import admin from "firebase-admin";
import assert from "node:assert/strict";
import { deliverWithReceipt, currentDeliveryAttempt, receiptPath } from "../../lib/emailDelivery.js";

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
const appA = admin.initializeApp({ databaseURL: DB_URL }, "de1r2-a");
const appB = admin.initializeApp({ databaseURL: DB_URL }, "de1r2-b");   // a second server instance: its own (cold) cache
const dbA = appA.database(), dbB = appB.database();
const TO = "owner-a@example.test";
const read = async (p) => (await dbA.ref(p).once("value")).val();
const base = { tenantId: "tR2", bizId: "bR2", recipient: TO, backoffMs: 0, sleep: async () => {} };
const P = (d) => receiptPath("daily_snapshot", "tR2", "bR2", d);
const T0 = Date.UTC(2026, 9, 7, 4, 5);
const err = (message, code, extra = {}) => Object.assign(new Error(message), code === undefined ? {} : { code }, extra);
const reply = (message, code, response, command) => err(message + ": " + response, code, { response, responseCode: Number(response.slice(0, 3)), command });

/** a fake provider bound to the attempt exactly as lib/sendEmail.js binds a real one; `script` is consumed per call */
function provider(counter, script) {
  return async () => {
    const a = currentDeliveryAttempt();
    await a.beforeTransport();
    const step = script[Math.min(counter.n, script.length - 1)];
    counter.n++;
    const r = step(a);
    if (r instanceof Error || (r && r.__throw)) { const e = r.__throw || r; a.error = e; throw e; }
    a.info = r;
  };
}
const ok = (a) => ({ accepted: [TO], rejected: [], messageId: a.messageId, response: "250 2.0.0 OK" });
const view = (rec) => [rec.state, rec.code ?? null, rec.attempt];

await dbA.ref("/").set(null);

await check("R2E1 a spoofed `before_transport` provider error after the hand-off is stored unknown and never re-sent", async () => {
  const c = { n: 0 }, send = provider(c, [() => err("may have accepted", "ETIMEDOUT", { deliveryPhase: "before_transport", deliveryCode: "claim_lost" }), ok]);
  const r1 = await deliverWithReceipt({ ...base, db: dbA, businessDate: "2026-11-01", clock: () => T0, send });
  assert.deepEqual([r1.outcome, r1.code, r1.receipt], ["unknown", "provider_timeout_unknown_phase", "recorded"]);
  const r2 = await deliverWithReceipt({ ...base, db: dbB, businessDate: "2026-11-01", clock: () => T0 + 3600000, send });
  assert.deepEqual([r2.outcome, r2.code], ["skipped", "unknown_requires_reconciliation"]);
  assert.deepEqual(view(await read(P("2026-11-01"))), ["unknown", "provider_timeout_unknown_phase", 1]);
  assert.equal(c.n, 1);
});

await check("R2E2 a 'Connection timeout' / refused-connection error after the hand-off is unknown: no in-run retry", async () => {
  for (const [d, e, code] of [["2026-11-02", err("Connection timeout", "ETIMEDOUT", { command: "CONN" }), "provider_timeout_unknown_phase"],
    ["2026-11-03", err("connect ECONNREFUSED", "ESOCKET", { command: "CONN", syscall: "connect" }), "provider_connection_lost"]]) {
    const c = { n: 0 }, send = provider(c, [() => e, ok]);
    const r1 = await deliverWithReceipt({ ...base, db: dbA, businessDate: d, clock: () => T0, send });
    assert.deepEqual([r1.outcome, r1.code], ["unknown", code]);
    const r2 = await deliverWithReceipt({ ...base, db: dbB, businessDate: d, clock: () => T0 + 3600000, send });
    assert.equal(r2.code, "unknown_requires_reconciliation");
    assert.equal(c.n, 1, d + ": one call");
  }
});

await check("R2E3 an indeterminate resolved result is unknown, never a definite refusal, never re-sent", async () => {
  const c = { n: 0 }, send = provider(c, [(a) => ({ accepted: [], rejected: [], messageId: a.messageId, response: "250 OK" }), ok]);
  const r1 = await deliverWithReceipt({ ...base, db: dbA, businessDate: "2026-11-04", clock: () => T0, send });
  assert.deepEqual([r1.outcome, r1.code], ["unknown", "provider_result_indeterminate"]);
  const r2 = await deliverWithReceipt({ ...base, db: dbB, businessDate: "2026-11-04", clock: () => T0 + 3600000, send });
  assert.equal(r2.code, "unknown_requires_reconciliation");
  assert.deepEqual(view(await read(P("2026-11-04"))), ["unknown", "provider_result_indeterminate", 1]);
  assert.equal(c.n, 1);
});

await check("R2E4 a contradictory result is unknown and never re-sent", async () => {
  const c = { n: 0 }, send = provider(c, [(a) => ({ accepted: [TO], rejected: [TO], messageId: a.messageId, response: "250 OK" }), ok]);
  const r1 = await deliverWithReceipt({ ...base, db: dbA, businessDate: "2026-11-05", clock: () => T0, send });
  assert.deepEqual([r1.outcome, r1.code], ["unknown", "provider_result_inconsistent"]);
  await deliverWithReceipt({ ...base, db: dbB, businessDate: "2026-11-05", clock: () => T0 + 3600000, send });
  assert.equal(c.n, 1);
});

await check("R2E5 controls: a definite refusal is final; a 4xx deferral is retried in the run; an acceptance is observed", async () => {
  let c = { n: 0 }, send = provider(c, [() => reply("Can't send mail - all recipients were rejected", "EENVELOPE", "550 5.1.1 no such user", "RCPT TO"), ok]);
  let r = await deliverWithReceipt({ ...base, db: dbA, businessDate: "2026-11-06", clock: () => T0, send });
  assert.deepEqual([r.outcome, r.code, r.retryable], ["failed", "provider_rejected_550", false]);
  r = await deliverWithReceipt({ ...base, db: dbB, businessDate: "2026-11-06", clock: () => T0 + 3600000, send });
  assert.equal(r.code, "failed_final"); assert.equal(c.n, 1);

  c = { n: 0 }; send = provider(c, [() => reply("Message failed", "EMESSAGE", "421 4.7.0 Try again later", "DATA"), ok]);
  r = await deliverWithReceipt({ ...base, db: dbA, businessDate: "2026-11-07", clock: () => T0, send });
  assert.deepEqual([r.outcome, r.attempt], ["accepted", 2]); assert.equal(c.n, 2);
  assert.deepEqual((await read(P("2026-11-07"))).history.map((h) => [h.attempt, h.state, h.code ?? null]), [[1, "failed", "provider_deferred_421"], [2, "accepted", null]]);

  c = { n: 0 }; send = provider(c, [ok]);
  r = await deliverWithReceipt({ ...base, db: dbA, businessDate: "2026-11-08", clock: () => T0, send });
  assert.deepEqual([r.outcome, r.receipt], ["accepted", "recorded"]);
  r = await deliverWithReceipt({ ...base, db: dbB, businessDate: "2026-11-08", clock: () => T0 + 1000, send });
  assert.equal(r.code, "already_accepted"); assert.equal(c.n, 1);
});

await check("R2E6 a failure confirmed before the provider call: failed/claim_lost, zero calls; the next instance sends it", async () => {
  const c = { n: 0 }, send = provider(c, [ok]);
  let refuse = true;
  // A3-T1 (test only, F-1): reads go through the real reference; only the claimed -> sending transaction is faulted, as before
  const faulty = { ref: (p) => { const r = dbA.ref(p); return Object.assign(Object.create(r), { transaction: async (fn) => {
    const before = (await dbA.ref(p).once("value")).val();
    if (refuse && before && before.state === "claimed") { refuse = false; throw new Error("transaction failed"); }
    return r.transaction(fn);
  } }); } };
  const r1 = await deliverWithReceipt({ ...base, db: faulty, businessDate: "2026-11-09", clock: () => T0, send });
  assert.deepEqual([r1.outcome, r1.code, r1.retryable], ["failed", "claim_lost", true]);
  assert.equal(c.n, 0, "the provider was never called");
  const r2 = await deliverWithReceipt({ ...base, db: dbB, businessDate: "2026-11-09", clock: () => T0 + 1000, send });
  assert.deepEqual([r2.outcome, r2.attempt], ["accepted", 2]); assert.equal(c.n, 1);
});

await appA.delete(); await appB.delete();
const failed = results.filter((r) => !r.ok);
console.log(`DE1R2_EMULATOR total=${results.length} pass=${results.length - failed.length} fail=${failed.length}`);
process.exit(failed.length || results.length !== 6 ? 1 : 0);
