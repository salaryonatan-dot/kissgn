// DE1 — the daily e-mail delivery receipts on the REAL local RTDB emulator (Rules engine + transaction engine).
//
//   part A  the receipt state machine (lib/emailDelivery.js deliverWithReceipt) over the Admin SDK's real ref().transaction —
//           first send / repeat / 5 concurrent invocations / retryable failure then re-claim / ambiguous outcome held /
//           stale "sending" lease converted to unknown / tenant + business + date isolation of receipts
//   part B  client access to the receipt node under the UNCHANGED Rules (top-level `$other` deny): every principal — unauth,
//           member, manager, owner, super_owner of the tenant — is denied read, set, update and transaction; the Admin
//           SDK (which the server routes use) can write
//
// Local only: refuses to run unless pointed at the demo namespace on 127.0.0.1:9000. Uses a fake `send` (no SMTP, no e-mail).
// Run: bash test/support/p1-r7-emu-run.sh <checkout> <abs-log-dir> de1=test/emulator/de1-receipt-emulator.mjs
import admin from "firebase-admin";
import assert from "node:assert/strict";
import { deliverWithReceipt, currentDeliveryAttempt, receiptPath, RECEIPT_VERSION } from "../../lib/emailDelivery.js";

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

const adminApp = admin.initializeApp({ databaseURL: DB_URL }, "de1-admin");
const db = adminApp.database();
const TO = "owner-a@example.test";

// a fake provider bound to the attempt exactly as lib/sendEmail.js binds a real one
function fakeSend(counter, behavior) {
  return async () => {
    const a = currentDeliveryAttempt();
    assert.ok(a, "send runs inside the delivery attempt");
    await a.beforeTransport();
    counter.n++;
    await new Promise((r) => setTimeout(r, 25));
    if (behavior === "accept") { a.info = { accepted: [TO], rejected: [], messageId: a.messageId, response: "250 OK" }; return; }
    const err = Object.assign(new Error("fake"), behavior === "transient" ? { code: "EMESSAGE", responseCode: 421, command: "DATA" } : { code: "ETIMEDOUT", command: "CONN" });
    a.error = err; throw err;
  };
}
const base = { db, tenantId: "tA", bizId: "bA", recipient: TO, backoffMs: 0, sleep: async () => {} };
const read = async (p) => (await db.ref(p).once("value")).val();

async function partA() {
  await db.ref("/").set({ tenants: { tA: { members: { u_member: true }, roles: { u_member: "viewer", u_manager: "manager", u_owner: "owner", u_super: "super_owner" } } } });

  await check("A1 first send is accepted and recorded; a repeat sends nothing", async () => {
    const c = { n: 0 };
    const r1 = await deliverWithReceipt({ ...base, businessDate: "2026-10-05", send: fakeSend(c, "accept") });
    assert.deepEqual([r1.outcome, r1.receipt, r1.attempt], ["accepted", "recorded", 1]);
    const rec = await read(receiptPath("daily_snapshot", "tA", "bA", "2026-10-05"));
    assert.equal(rec.v, RECEIPT_VERSION); assert.equal(rec.state, "accepted"); assert.equal(rec.leaseUntil, undefined);
    assert.match(rec.messageIdHeader, /^<daily_snapshot\.1\.[0-9a-f-]{36}@delivery\.marjin\.app>$/);
    assert.ok(!JSON.stringify(rec).includes(TO), "the receipt holds no recipient address");
    const r2 = await deliverWithReceipt({ ...base, businessDate: "2026-10-05", send: fakeSend(c, "accept") });
    assert.deepEqual([r2.outcome, r2.code], ["skipped", "already_accepted"]);
    assert.equal(c.n, 1);
  });

  await check("A2 five concurrent invocations on the real transaction engine send exactly once", async () => {
    const c = { n: 0 };
    const rs = await Promise.all(Array.from({ length: 5 }, () => deliverWithReceipt({ ...base, businessDate: "2026-10-06", send: fakeSend(c, "accept") })));
    assert.equal(c.n, 1, "one provider hand-off");
    assert.equal(rs.filter((r) => r.outcome === "accepted").length, 1);
    for (const r of rs.filter((r) => r.outcome !== "accepted")) assert.ok(r.outcome === "skipped" && ["in_progress", "already_accepted"].includes(r.code), JSON.stringify(r));
    assert.equal((await read(receiptPath("daily_snapshot", "tA", "bA", "2026-10-06"))).state, "accepted");
  });

  await check("A3 a definitive transient refusal is recorded retryable and the next invocation re-claims attempt 2", async () => {
    const c = { n: 0 };
    const r1 = await deliverWithReceipt({ ...base, businessDate: "2026-10-07", inRunAttempts: 1, send: fakeSend(c, "transient") });
    assert.deepEqual([r1.outcome, r1.code, r1.retryable, r1.receipt], ["failed", "provider_deferred_421", true, "recorded"]);
    const r2 = await deliverWithReceipt({ ...base, businessDate: "2026-10-07", send: fakeSend(c, "accept") });
    assert.deepEqual([r2.outcome, r2.attempt], ["accepted", 2]);
    const rec = await read(receiptPath("daily_snapshot", "tA", "bA", "2026-10-07"));
    assert.deepEqual(rec.history.map((h) => h.state), ["failed", "accepted"]);
  });

  await check("A4 an ambiguous outcome is held as unknown and never re-sent automatically", async () => {
    const c = { n: 0 };
    const r1 = await deliverWithReceipt({ ...base, businessDate: "2026-10-08", send: fakeSend(c, "ambiguous") });
    assert.deepEqual([r1.outcome, r1.code], ["unknown", "provider_timeout_unknown_phase"]);
    const r2 = await deliverWithReceipt({ ...base, businessDate: "2026-10-08", send: fakeSend(c, "accept") });
    assert.deepEqual([r2.outcome, r2.code], ["skipped", "unknown_requires_reconciliation"]);
    assert.equal(c.n, 1);
  });

  await check("A5 an invocation lost while 'sending' becomes unknown once its lease expires (no re-send)", async () => {
    const p = receiptPath("daily_snapshot", "tA", "bA", "2026-10-09");
    await db.ref(p).set({ v: RECEIPT_VERSION, kind: "daily_snapshot", tenantId: "tA", bizId: "bA", businessDate: "2026-10-09", state: "sending", claimId: "lost", attempt: 1, leaseUntil: 1, recipientHash: "x", updatedAt: 1 });
    const c = { n: 0 };
    const r = await deliverWithReceipt({ ...base, businessDate: "2026-10-09", send: fakeSend(c, "accept") });
    assert.deepEqual([r.outcome, r.code, r.receipt], ["skipped", "unknown_requires_reconciliation", "recorded"]);
    assert.equal(c.n, 0);
    assert.equal((await read(p)).state, "unknown");
  });

  await check("A6 receipts are isolated per tenant, business and business date", async () => {
    const c = { n: 0 };
    for (const [tenantId, bizId, businessDate] of [["tB", "bA", "2026-10-05"], ["tA", "bB", "2026-10-05"], ["tA", "bA", "2026-10-04"]]) {
      const r = await deliverWithReceipt({ ...base, tenantId, bizId, businessDate, send: fakeSend(c, "accept") });
      assert.equal(r.outcome, "accepted", `${tenantId}/${bizId}/${businessDate}`);
    }
    assert.equal(c.n, 3);
  });
}

async function partB() {
  const ids = { unauth: null, member: { uid: "u_member", token: { email: "m@demo.example" } }, manager: { uid: "u_manager", token: { email: "g@demo.example" } },
    owner: { uid: "u_owner", token: { email: "o@demo.example" } }, super: { uid: "u_super", token: { email: "s@demo.example" } } };
  const p = receiptPath("daily_snapshot", "tA", "bA", "2026-10-05");
  const denied = async (op) => { try { await op(); return false; } catch (e) { return /permission[_ ]denied/i.test(String(e && (e.message + " " + e.code))); } };
  for (const [name, override] of Object.entries(ids)) {
    const app = admin.initializeApp({ databaseURL: DB_URL, databaseAuthVariableOverride: override }, "de1-" + name);
    const cdb = app.database();
    await check(`B ${name}: read / set / update / transaction on email_delivery are denied`, async () => {
      assert.ok(await denied(() => cdb.ref("email_delivery").once("value")), "read root");
      assert.ok(await denied(() => cdb.ref(p).once("value")), "read receipt");
      assert.ok(await denied(() => cdb.ref(p).set({ state: "accepted" })), "set receipt");
      assert.ok(await denied(() => cdb.ref(p).update({ state: "failed" })), "update receipt");
      assert.ok(await denied(() => cdb.ref("email_delivery/daily_snapshot/tA/bA/2026-12-31").set({ state: "accepted" })), "pre-seed a future receipt");
      const t = await cdb.ref(p).transaction(() => null).then(() => false, (e) => /permission[_ ]denied/i.test(String(e && (e.message + " " + e.code))));
      assert.ok(t, "transaction");
    });
    await app.delete();
  }
  await check("B admin: the server's Admin SDK writes the node and the receipt is unchanged by the client attempts", async () => {
    assert.equal((await read(p)).state, "accepted");
    assert.equal(await read("email_delivery/daily_snapshot/tA/bA/2026-12-31"), null);
    await db.ref("email_delivery/__probe").set({ ok: true });
    assert.deepEqual(await read("email_delivery/__probe"), { ok: true });
  });
}

await partA();
await partB();
await adminApp.delete();
const failed = results.filter((r) => !r.ok);
console.log(`DE1_EMULATOR total=${results.length} pass=${results.length - failed.length} fail=${failed.length}`);
process.exit(failed.length || results.length !== 12 ? 1 : 0);
