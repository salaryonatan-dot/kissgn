// DP4E — the DP4 legacy-date scope (DP3-R01 → DP4) over the REAL local RTDB emulator, through the REAL Admin SDK and the
// actual lib/emailDelivery.js routes (deliverManualDaily / deliverWithReceipt with the real Daily gate). Evidence is written
// to the store and read back by a SECOND (cold) Admin app; nothing is modelled in memory. (A3-T1, test only.)
//
// Documented behaviour (lib/emailDelivery.js manualEvidence, DP4 / DP3-R01): a manual record whose business date cannot be
// read (absent — RTDB stores no key — or not a valid date) may be THIS delivery. It is excused only by the same complete,
// definitive failure a same-date record needs (state failed + startedAt + messageIdHeader + settledAt + code); anything else
// is unreadable evidence and blocks BOTH routes with no hand-off. A record with a VALID other date is another delivery.
//
//   DP4E-01  control: no history — the manual route hands over once and records `accepted`
//   DP4E-02  undated + incomplete failure (no settlement) — manual refused delivery_history_unreadable; 0 hand-offs; the
//            evidence is unchanged (nothing repaired / defaulted); no admission trace
//   DP4E-03  undated + COMPLETE definitive failure — excused: one hand-off; the old record is kept byte-for-byte
//   DP4E-04  invalid date string + incomplete failure — refused as DP4E-02
//   DP4E-05  VALID other date + incomplete failure — another delivery, not this one: one hand-off
//   DP4E-06  the SCHEDULED route on undated incomplete evidence: no hand-off, skipped delivery_history_unreadable, no admission
//   DP4E-07  the SCHEDULED route on undated COMPLETE definitive failure: one hand-off, accepted (control)
//
// Local only: refuses to run unless pointed at the demo namespace on 127.0.0.1:9000. Fake `send` (no SMTP, no e-mail).
// Run: bash test/support/p1-r7-emu-run.sh <checkout> <abs-log-dir> dp4e=test/emulator/dp4-legacy-date-emulator.mjs
import admin from "firebase-admin";
import assert from "node:assert/strict";
import * as E from "../../lib/emailDelivery.js";

const PROJECT = "demo-marjin-rules";
const NS = "demo-marjin-rules-default-rtdb";
const DB_URL = `http://127.0.0.1:9000?ns=${NS}`;
const abort = (m) => { console.error("SAFETY ABORT: " + m); process.exit(2); };
if (process.env.FIREBASE_DATABASE_EMULATOR_HOST !== "127.0.0.1:9000") abort("FIREBASE_DATABASE_EMULATOR_HOST must be 127.0.0.1:9000");
if (process.env.GCLOUD_PROJECT !== PROJECT || process.env.GOOGLE_CLOUD_PROJECT !== PROJECT) abort("project must be " + PROJECT);
if (process.env.GOOGLE_APPLICATION_CREDENTIALS || process.env.FIREBASE_DATABASE_URL || process.env.FIREBASE_CONFIG) abort("credentials / database URL / config must be absent");

const results = [];
async function check(id, fn) {
  try { const notes = await fn(); results.push({ id, ok: true, notes }); console.log("ok   " + id + (notes ? " — " + JSON.stringify(notes) : "")); }
  catch (e) { results.push({ id, ok: false }); console.log("FAIL " + id + " — " + (e && e.message)); }
}
const writerApp = admin.initializeApp({ databaseURL: DB_URL, projectId: PROJECT }, "dp4e-writer");
const coldApp = admin.initializeApp({ databaseURL: DB_URL, projectId: PROJECT }, "dp4e-cold");   // its own (cold) cache
const db = writerApp.database(), cold = coldApp.database();
const read = async (p) => (await cold.ref(p).once("value")).val();
const T0 = Date.UTC(2026, 9, 18, 4, 5), TO = "owner-a@example.test", TENANT = "tL", DATE = "2026-10-18";
/** a fake provider bound to the attempt as lib/sendEmail.js binds a real one */
const sender = (c) => async () => { const a = E.currentDeliveryAttempt(); await a.beforeTransport(); c.n++; a.info = { accepted: [TO], rejected: [], messageId: a.messageId, response: "250 OK" }; };
const manual = (bizId, c) => E.deliverManualDaily({ db, tenantId: TENANT, bizId, businessDate: DATE, recipient: TO, send: sender(c), clock: () => T0 });
const scheduled = (bizId, c) => E.deliverWithReceipt({ db, tenantId: TENANT, bizId, businessDate: DATE, recipient: TO, send: sender(c), clock: () => T0,
  inRunAttempts: 1, backoffMs: 0, sleep: async () => {}, gate: E.makeDailyDeliveryGate(db, DATE) });
const record = (bizId, attemptId, fields) => ({ v: E.MANUAL_ATTEMPT_VERSION, attemptId, kind: "daily_snapshot", tenantId: TENANT, bizId, ...fields });
const INCOMPLETE = { state: "failed", startedAt: T0 - 86400000, messageIdHeader: "<legacy@delivery.marjin.app>" };   // no settledAt / code
const COMPLETE = { ...INCOMPLETE, settledAt: T0 - 86300000, code: "provider_rejected_550" };
const seed = async (bizId, fields) => {
  const id = "x" + bizId.padStart(7, "0");
  await db.ref(`${E.MANUAL_ATTEMPT_ROOT}/${TENANT}/${bizId}/${id}`).set(record(bizId, id, fields));
  const stored = await read(`${E.MANUAL_ATTEMPT_ROOT}/${TENANT}/${bizId}`);
  return { id, stored };
};
const admission = (bizId) => read(E.admissionPath("daily_snapshot", TENANT, bizId, DATE));

await db.ref("/").set(null);
const op = { actor: "dp4e", reason: "synthetic local verification" };
assert.equal((await E.changeDeliveryHold(db, { ...op, action: "init", nowMs: T0 - 3600000 })).ok, true);
const inv = E.deliveryInventoryView(await read(E.DELIVERY_HOLD_PATH));
assert.equal((await E.confirmDeliveryInventory(db, { ...op, generation: inv.generation, digest: inv.digest, nowMs: T0 - 3500000 })).ok, true);
assert.equal((await E.changeDeliveryHold(db, { ...op, action: "release", expectVersion: 1, nowMs: T0 - 3400000 })).ok, true);

await check("DP4E-01 control: no history — the manual route hands over once and records accepted", async () => {
  const c = { n: 0 }; const r = await manual("b1", c);
  assert.deepEqual([r.outcome, c.n], ["accepted", 1]);
  return { outcome: r.outcome, handoffs: c.n };
});

for (const [id, title, bizId, fields, block] of [
  ["DP4E-02", "undated + incomplete failure: the manual route is refused delivery_history_unreadable, nothing handed over or repaired", "b2", INCOMPLETE, true],
  ["DP4E-03", "undated + COMPLETE definitive failure is excused: one hand-off; the old record is kept byte-for-byte", "b3", COMPLETE, false],
  ["DP4E-04", "an invalid business-date string + incomplete failure is refused as an undated one", "b4", { ...INCOMPLETE, businessDate: "2026-02-30" }, true],
  ["DP4E-05", "a VALID other business date + incomplete failure is another delivery: one hand-off", "b5", { ...INCOMPLETE, businessDate: "2026-10-17" }, false]]) {
  await check(id + " " + title, async () => {
    const { id: key, stored } = await seed(bizId, fields);
    if (!("businessDate" in fields)) assert.equal(Object.hasOwn(stored[key], "businessDate"), false, "the store holds no businessDate key");
    assert.equal(Object.hasOwn(stored[key], "settledAt"), fields === COMPLETE, "settlement present only on the complete record");
    const c = { n: 0 }; const r = await manual(bizId, c);
    const after = await read(`${E.MANUAL_ATTEMPT_ROOT}/${TENANT}/${bizId}`);
    if (block) {
      assert.deepEqual([r.outcome, r.code, r.record, c.n], ["refused", "delivery_history_unreadable", "not_written", 0]);
      assert.deepEqual(after, stored, "the stored evidence is unchanged: nothing repaired, deleted or defaulted");
      assert.equal(await admission(bizId), null, "a refused send leaves no admission trace");
    } else {
      assert.deepEqual([r.outcome, c.n], ["accepted", 1]);
      assert.deepEqual(after[key], stored[key], "the older record is kept byte-for-byte");
      assert.equal((await admission(bizId)).state, "accepted");
    }
    return { outcome: r.outcome, code: r.code ?? null, handoffs: c.n, storedKeys: Object.keys(stored[key]).sort() };
  });
}

await check("DP4E-06 the SCHEDULED route on undated incomplete evidence: no hand-off, skipped delivery_history_unreadable, no admission", async () => {
  const bizId = "b6"; await seed(bizId, INCOMPLETE);
  const c = { n: 0 }; const r = await scheduled(bizId, c);
  assert.deepEqual([r.outcome, r.code, c.n], ["skipped", "delivery_history_unreadable", 0]);
  assert.equal(await admission(bizId), null, "no admission");
  const receipt = await read(E.receiptPath("daily_snapshot", TENANT, bizId, DATE));
  assert.notEqual(receipt.state, "accepted"); assert.notEqual(receipt.state, "sending");
  return { outcome: r.outcome, code: r.code, receiptState: receipt.state };
});

await check("DP4E-07 the SCHEDULED route on undated COMPLETE definitive failure: one hand-off, accepted (control)", async () => {
  const bizId = "b7"; await seed(bizId, COMPLETE);
  const c = { n: 0 }; const r = await scheduled(bizId, c);
  assert.deepEqual([r.outcome, c.n], ["accepted", 1]);
  assert.equal((await read(E.receiptPath("daily_snapshot", TENANT, bizId, DATE))).state, "accepted");
  return { outcome: r.outcome, handoffs: c.n };
});

await writerApp.delete(); await coldApp.delete();
const failed = results.filter((x) => !x.ok).length;
console.log(JSON.stringify({ results }));
console.log(`DP4E_EMULATOR total=${results.length} pass=${results.length - failed} fail=${failed}`);
process.exit(failed ? 1 : 0);
