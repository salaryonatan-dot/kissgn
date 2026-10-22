// Daily e-mail subscription (owner requirement 2026-10-22; author candidate, pending independent review) on the REAL local
// RTDB emulator: Admin SDK transport, Rules engine (the integrated database.rules.json loaded by the runner) and the REAL
// route through the harness sandbox (fake SMTP terminal; no e-mail).
//   DSE-A  the preference over the real transaction engine: default OFF, cold reader, no-op repeat, two concurrent writers
//   DSE-B  client access under the UNCHANGED Rules (top-level `$other` deny): every principal is denied read / set / update /
//          transaction on the preference root and record; only the server (Admin SDK) writes it
//   DSE-C  the real route on the real store: default OFF = no_send with zero provider calls; the owner enables through the
//          route; the scheduled run then delivers; disabling affects the next run only; the manual Daily is unaffected
// Local only: refuses to run unless pointed at the demo namespace on 127.0.0.1:9000.
// Run: bash test/support/p1-r7-emu-run.sh <checkout> <abs-log-dir> dse=test/emulator/daily-subscription-emulator.mjs
import admin from "firebase-admin";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { buildSandbox, seedWorld, installSmtp, SMTP, freezeClock, runCron, runManual, mkRes, T, B, SUBSCRIPTIONS, enabledSubscriptionRecord } from "../support/daily-email-harness.mjs";

const PROJECT = "demo-marjin-rules", HOST = "127.0.0.1:9000", NS = "demo-marjin-rules-default-rtdb", DB_URL = `http://${HOST}?ns=${NS}`;
const abort = (m) => { console.error("SAFETY ABORT: " + m); process.exit(2); };
if (process.env.FIREBASE_DATABASE_EMULATOR_HOST !== HOST) abort("FIREBASE_DATABASE_EMULATOR_HOST must be " + HOST);
if (process.env.GCLOUD_PROJECT !== PROJECT || process.env.GOOGLE_CLOUD_PROJECT !== PROJECT) abort("project must be " + PROJECT);
if (process.env.GOOGLE_APPLICATION_CREDENTIALS || process.env.FIREBASE_DATABASE_URL || process.env.FIREBASE_CONFIG) abort("credentials / database URL must be absent");

const results = [];
async function check(id, fn) {
  try { await fn(); results.push({ id, ok: true }); console.log("ok   " + id); }
  catch (e) { results.push({ id, ok: false }); console.log("FAIL " + id + " — " + (e && e.message)); }
}
const apps = [];
const app = (name, override) => { const a = admin.initializeApp({ databaseURL: DB_URL, ...(override === undefined ? {} : { databaseAuthVariableOverride: override }) }, name); apps.push(a); return a; };
const dbA = app("dse-a").database(), dbB = app("dse-b").database(), cold = app("dse-cold").database();
const read = async (p) => (await cold.ref(p).once("value")).val();
const S = await buildSandbox({ fresh: true });
// the preference module exactly as the route uses it (src/server/dailyEmailSubscription.ts, compiled with the route)
const { readDailySubscription, setDailySubscription, subscriptionPath } = await S.import("src/server/dailyEmailSubscription.js");
const P = subscriptionPath(T, B);
const AT = Date.UTC(2026, 8, 8, 4, 5), DATE = "2026-09-08", LEASE = 10 * 60 * 1000;
const at = async (ms, fn) => { const u = freezeClock(ms); try { return await fn(); } finally { u(); } };

try {
  await check("DSE-A1 default OFF on the real store; an enable is visible to a cold reader; a repeat is a no-op", async () => {
    await dbA.ref("/").set(null);
    assert.equal((await readDailySubscription(dbB, T, B)).state, "disabled");
    assert.deepEqual(await setDailySubscription(dbA, { tenantId: T, bizId: B, enabled: true, actorRole: "owner", nowMs: 1000 }), { ok: true, enabled: true, version: 1, changed: true });
    assert.deepEqual(await read(P), { schema: 1, enabled: true, version: 1, updatedAt: 1000, updatedByRole: "owner" });
    assert.equal((await readDailySubscription(cold, T, B)).state, "enabled");
    assert.deepEqual(await setDailySubscription(dbB, { tenantId: T, bizId: B, enabled: true, actorRole: "super_owner", nowMs: 2000 }), { ok: true, enabled: true, version: 1, changed: false }, "a cold second app sees the stored value");
    assert.deepEqual(await read(P), { schema: 1, enabled: true, version: 1, updatedAt: 1000, updatedByRole: "owner" });
  });

  await check("DSE-A2 two concurrent writers: one well-formed record, versions advance, the last decision is stored", async () => {
    const [x, y] = await Promise.all([setDailySubscription(dbA, { tenantId: T, bizId: B, enabled: false, actorRole: "owner", nowMs: 3000 }),
      setDailySubscription(dbB, { tenantId: T, bizId: B, enabled: false, actorRole: "super_owner", nowMs: 3001 })]);
    assert.ok(x.ok && y.ok, JSON.stringify([x, y]));
    assert.deepEqual([x.changed, y.changed].sort(), [false, true], "exactly one writer changed it; the other observed the committed value");
    const stored = await read(P); assert.deepEqual([stored.enabled, stored.version], [false, 2]);
    await dbA.ref(P).set({ enabled: true, schema: 1 });
    assert.equal((await readDailySubscription(cold, T, B)).state, "unreadable", "a malformed record is never enabled");
  });

  const ids = { unauth: null, member: { uid: "u_member", token: { email: "m@demo.example" } }, viewer: { uid: "u_viewer", token: { email: "v@demo.example" } },
    manager: { uid: "u_manager", token: { email: "g@demo.example" } }, owner: { uid: "u_owner", token: { email: "o@demo.example" } }, super: { uid: "u_super", token: { email: "s@demo.example" } } };
  const denied = async (op) => { try { await op(); return false; } catch (e) { return /permission[_ ]denied/i.test(String(e && (e.message + " " + e.code))); } };
  await dbA.ref("/").set({ tenants: { [T]: { members: { u_member: true, u_viewer: true, u_manager: true, u_owner: true, u_super: true },
    roles: { u_member: "viewer", u_viewer: "viewer", u_manager: "manager", u_owner: "owner", u_super: "super_owner" } } } });
  await dbA.ref(P).set(enabledSubscriptionRecord());
  for (const [name, override] of Object.entries(ids)) {
    const cdb = app("dse-client-" + name, override).database();
    await check(`DSE-B ${name}: read / set / update / transaction on the preference are denied`, async () => {
      assert.ok(await denied(() => cdb.ref("email_delivery_subscriptions").once("value")), "read root");
      assert.ok(await denied(() => cdb.ref(P).once("value")), "read record");
      assert.ok(await denied(() => cdb.ref(P).set({ schema: 1, enabled: false, version: 9, updatedAt: 0, updatedByRole: "owner" })), "set record");
      assert.ok(await denied(() => cdb.ref(P).update({ enabled: false })), "update record");
      assert.ok(await denied(() => cdb.ref(`${SUBSCRIPTIONS}/${T}/bizNew`).set(enabledSubscriptionRecord())), "create a record");
      const t = await cdb.ref(P).transaction(() => null).then(() => false, (e) => /permission[_ ]denied/i.test(String(e && (e.message + " " + e.code))));
      assert.ok(t, "transaction");
    });
  }
  await check("DSE-B admin: the record is unchanged by every client attempt; the server writes it", async () => {
    assert.deepEqual(await read(P), enabledSubscriptionRecord());
    assert.equal(await read(`${SUBSCRIPTIONS}/${T}/bizNew`), null);
  });

  // ── DSE-C: the real route on the real store ──────────────────────────────────────────────────────────────────────────
  const reset = async (subscriptions) => { const f = seedWorld({ withSecondBiz: false, withSecondTenant: false, subscriptions }); await dbA.ref("/").set(f.store); globalThis.__DB = dbA; };
  const cron = (ms = AT) => at(ms, () => runCron(S.route));
  const post = (body) => at(AT, async () => {
    globalThis.__DE = { requireAuth: async () => ({ uid: "u_owner_a", email: "owner-a@example.test" }) };
    const res = mkRes(); await S.route({ method: "POST", headers: { authorization: "Bearer user-token" }, query: {}, body }, res); return res;
  });
  const row = (r) => (r.body.results || []).find((x) => x.tenantId === T && x.bizId === B);
  const RECEIPT = `email_delivery/daily_snapshot/${T}/${B}/${DATE}`;

  await check("DSE-C1 default OFF on the real store: a clean run with a no_send row, zero provider calls, no receipt or admission", async () => {
    await reset("absent"); const smtp = installSmtp([SMTP.accept()]);
    const r = await cron();
    assert.deepEqual([r.statusCode, r.body.status, row(r).settlement, row(r).code, smtp.calls.length], [200, "completed", "no_send", "daily_email_not_enabled", 0], JSON.stringify(r.body).slice(0, 400));
    assert.deepEqual([await read("email_delivery"), await read("email_delivery_admission"), await read(P)], [null, null, null]);
  });

  await check("DSE-C2 the owner enables through the route; the next scheduled run delivers once; disabling affects only later runs", async () => {
    await reset("absent"); const smtp = installSmtp([SMTP.accept(), SMTP.accept()]);
    let r = await post({ tenantId: T, bizId: B, action: "subscription_set", enabled: true });
    assert.deepEqual([r.statusCode, r.body.enabled, r.body.version], [200, true, 1]);
    assert.deepEqual(await read(P), { schema: 1, enabled: true, version: 1, updatedAt: AT, updatedByRole: "owner" });
    r = await cron();
    assert.deepEqual([r.statusCode, row(r).settlement, smtp.calls.length, (await read(RECEIPT)).state], [200, "delivered", 1, "accepted"]);
    const accepted = JSON.stringify(await read(RECEIPT));
    r = await post({ tenantId: T, bizId: B, action: "subscription_set", enabled: false }); assert.deepEqual([r.statusCode, r.body.enabled, r.body.version], [200, false, 2]);
    r = await cron(AT + 2 * LEASE);
    assert.deepEqual([row(r).settlement, smtp.calls.length, JSON.stringify(await read(RECEIPT))], ["no_send", 1, accepted], "the accepted receipt is untouched");
    r = await post({ tenantId: T, bizId: B, action: "subscription" }); assert.deepEqual([r.statusCode, r.body.enabled, r.body.state], [200, false, "disabled"]);
  });

  await check("DSE-C3 the manual Daily is separate: delivered with no preference stored, and the preference stays absent", async () => {
    await reset("absent"); const smtp = installSmtp([SMTP.accept()]);
    const r = await at(AT, () => runManual(S.route));
    assert.deepEqual([r.statusCode, r.body.status, smtp.calls.length, await read(P)], [200, "success", 1, null], JSON.stringify(r.body).slice(0, 300));
  });
} finally {
  await Promise.all(apps.map((a) => a.delete()));
  rmSync(S.dir, { recursive: true, force: true });
}
const failed = results.filter((x) => !x.ok);
console.log(JSON.stringify({ results, failed: failed.length }));
console.log(`DSE_EMULATOR total=${results.length} pass=${results.length - failed.length} fail=${failed.length}`);
process.exitCode = failed.length || results.length !== 12 ? 1 : 0;
