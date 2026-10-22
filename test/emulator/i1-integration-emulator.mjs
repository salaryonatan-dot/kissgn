// Agent/Daily integration I1 — the integrated scheduled path on the REAL local RTDB emulator through the REAL Admin SDK (LOCAL;
// pending independent Codex review). The route is this tree's compiled api/daily-snapshot/run.ts (the harness sandbox: only
// the terminal seams are replaced — the database is the Admin SDK app below, the identity a fixture, the provider a fake); the
// builder is this tree's carried Builder (690a07d9) over the approved canonical financial source; receipts and notices are
// written by the REAL receipt module through REAL Admin SDK transactions. Faults are injected on ONE Reference at a time.
//   I1E0  control: three named businesses in two tenants — 200 completed, three provider calls, three accepted receipts read
//         back COLD by a second Admin app; a repeat run is already_accepted with no further provider call
//   I1E1  X1 on the real store: one business's entries read fails — a failed row with the run date, no receipt node (cold),
//         the other businesses delivered; the run is completed_with_failures
//   I1E2  scheduled G4 on the real store: a registered business without a name — failed row business_name_unavailable, the
//         notice stored (cold read, the fixed sentence), no receipt; the named businesses delivered; the owner's read returns
//         the stored notice with zero provider calls; the name is repaired; the read clears the notice (cold: gone); the next
//         run delivers the repaired business once
//   I1E3  X3 on the real store: the tenant list cannot be read — 500 with the discovery failure, zero provider calls, zero
//         receipt nodes
//   I1E4  G10 on the real store (manual path, D-G10): an ambiguous registry is 422, a nameless business 422, nothing sent
// Local only: refuses to run unless pointed at the demo namespace on 127.0.0.1:9000. Fake provider (no SMTP, no e-mail).
// Run: bash test/support/p1-r7-emu-run.sh <checkout> <abs-log-dir> i1=test/emulator/i1-integration-emulator.mjs
import admin from "firebase-admin";
import assert from "node:assert/strict";
import { buildSandbox, installSmtp, SMTP, mkRes, runCron, T, B, B2, T2, B3, HOLD_PATH, releasedHoldRecord, SUBSCRIPTIONS, enabledSubscriptionRecord } from "../support/daily-email-harness.mjs";
import { deliveryNoticePath, MISSING_NAME_NOTICE_HE } from "../../lib/emailDelivery.js";

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
const appA = admin.initializeApp({ databaseURL: DB_URL }, "i1-a");
const appB = admin.initializeApp({ databaseURL: DB_URL }, "i1-b");
const dbA = appA.database(), dbB = appB.database();
const cold = async (p) => (await dbB.ref(p).once("value")).val();           // the second app: no local cache of A's writes
const T0 = Date.UTC(2026, 9, 9, 4, 5), DATE = "2026-10-09", LEASE = 10 * 60 * 1000;
const env = (v) => ({ _v: JSON.stringify(v) });
const SECRET = "fault-injected-text-never-shown";
const RECEIPTS = "email_delivery/daily_snapshot";

// fault injection on ONE path of the REAL Admin database: the route and the builder see the Admin SDK for everything else
const fault = { path: null };
const faulty = (r) => new Proxy(r, { get(t, k) { if (k === "once" || k === "get") return async () => { throw new Error(SECRET); }; const v = t[k]; return typeof v === "function" ? v.bind(t) : v; } });
globalThis.__DB = new Proxy(dbA, { get(t, k) {
  if (k === "ref") return (p, ...a) => { const r = t.ref(p, ...a); return p === fault.path ? faulty(r) : r; };
  const v = t[k]; return typeof v === "function" ? v.bind(t) : v;
} });
const { route } = await buildSandbox({ fresh: true });
const lines = [];
const origWarn = console.warn, origError = console.error, origLog = console.log;
const capture = () => { console.warn = (...a) => lines.push(a.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" ")); console.error = console.warn; };
const release = () => { console.warn = origWarn; console.error = origError; };
const realNow = Date.now;
const cron = async (ms = T0) => { Date.now = () => ms; capture(); try { return await runCron(route); } finally { release(); Date.now = realNow; } };
async function post(body, { uid = "u_owner_a", email = "owner-a@example.test" } = {}) {
  process.env.SMTP_EMAIL = "sender@example.test"; process.env.SMTP_APP_PASSWORD = "fixture-app-password-not-real";
  globalThis.__DE = { requireAuth: async () => ({ uid, email }) };
  const res = mkRes(); Date.now = () => T0; capture();
  try { await route({ method: "POST", headers: { authorization: "Bearer user-token" }, query: {}, body }, res); } finally { release(); Date.now = realNow; }
  return res;
}
const rowOf = (r, t, b) => (r.body.results || []).find((x) => x.tenantId === t && x.bizId === b);
const days = ["2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04", "2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08"];
const day = (date, n) => ({ id: `de000000-0000-4000-8000-${String(n).padStart(12, "0")}`, date, sales: "1000", supplier_payments: { s1: "300" }, payroll: "200" });
async function world({ nameB2 = "מסעדה ב", registryA } = {}) {
  // IV-T1: explicit synthetic server recipients; keep the real resolver and every refusal/assertion.
  process.env.MARJIN_DAILY_RECIPIENTS_JSON = JSON.stringify([[T, B, "owner-a@example.test"], [T, B2, "owner-a@example.test"], [T2, B3, "owner-b@example.test"]]);
  fault.path = null;
  await dbA.ref("/").set(null);
  // HR1 (T-HR1-TEST-EMU): the bootstrapped RELEASED Daily hold record (absent = held, fail closed); every assertion unchanged
  await dbA.ref(HOLD_PATH).set(releasedHoldRecord());
  for (const [t, b, name] of [[T, B, "מסעדה א"], [T, B2, nameB2 ?? "x"], [T2, B3, "מסעדה ג"]]) {
    // Daily e-mail subscription (runtime default OFF): explicit ENABLED fixture preference; every assertion unchanged
    await dbA.ref(`${SUBSCRIPTIONS}/${t}/${b}`).set(enabledSubscriptionRecord());
    await dbA.ref(`tenants/${t}/biz:${b}:entries`).set(env(days.map((d, i) => day(d, i + 1))));
    await dbA.ref(`tenants/${t}/biz:${b}:config`).set(env({ businessName: name }));
    await dbA.ref(`tenants/${t}/biz:${b}:fixed`).set(env([]));
  }
  await dbA.ref(`tenants/${T}/app/business`).set(registryA ?? env([{ id: B, name: "מסעדה א" }, nameB2 === null ? { id: B2 } : { id: B2, name: nameB2 }]));
  await dbA.ref(`tenants/${T}/app/users`).set(env([{ id: 1, name: "Owner A", email: "owner-a@example.test", role: "owner", firebaseUid: "u_owner_a" }]));
  await dbA.ref(`tenants/${T}/members`).set({ u_owner_a: true, u_viewer_a: true }); await dbA.ref(`tenants/${T}/roles`).set({ u_owner_a: "owner", u_viewer_a: "viewer" });
  await dbA.ref(`tenants/${T2}/app/business`).set(env([{ id: B3, name: "מסעדה ג" }]));
  await dbA.ref(`tenants/${T2}/app/users`).set(env([{ id: 1, name: "Owner B", email: "owner-b@example.test", role: "owner", firebaseUid: "u_owner_b" }]));
  await dbA.ref(`tenants/${T2}/members/u_owner_b`).set(true); await dbA.ref(`tenants/${T2}/roles/u_owner_b`).set("owner");
}

await check("I1E0 control: three named businesses — 200, three sends, three accepted receipts (cold); a repeat run is already_accepted", async () => {
  await world(); const smtp = installSmtp([SMTP.accept()]);
  const r = await cron();
  assert.deepEqual([r.statusCode, r.body.status, r.body.expectedBusinesses, r.body.discovery.status, smtp.calls.length], [200, "completed", 3, "complete", 3], JSON.stringify(r.body).slice(0, 600));
  for (const [t, b] of [[T, B], [T, B2], [T2, B3]]) assert.equal((await cold(`${RECEIPTS}/${t}/${b}/${DATE}`)).state, "accepted", `${t}/${b}`);
  const r2 = await cron(T0 + 2 * LEASE);
  assert.deepEqual([r2.statusCode, rowOf(r2, T, B).code, smtp.calls.length], [200, "already_accepted", 3]);
});

await check("I1E1 X1 on the real store: one entries read fails — a failed row with the run date, no receipt node; the others delivered", async () => {
  await world(); const smtp = installSmtp([SMTP.accept()]);
  fault.path = `tenants/${T}/biz:${B2}:entries`;
  const r = await cron();
  assert.deepEqual([r.statusCode, r.body.status, r.body.failedBuildCount, smtp.calls.length], [500, "completed_with_failures", 1, 2]);
  assert.deepEqual(rowOf(r, T, B2), { tenantId: T, bizId: B2, businessDate: DATE, outcome: "failed", code: "snapshot_build_failed", settlement: "failed", receipt: "not_written" });
  assert.equal(await cold(`${RECEIPTS}/${T}/${B2}`), null, "no receipt node for the failed build (cold read)");
  assert.equal((await cold(`${RECEIPTS}/${T}/${B}/${DATE}`)).state, "accepted");
  assert.ok(!JSON.stringify(r.body).includes(SECRET) && !lines.some((l) => l.includes(SECRET)), "nothing of the fault reaches the body or the log");
});

await check("I1E2 scheduled G4 on the real store: failed row + stored notice; owner read; repair; cleared; delivered once", async () => {
  await world({ nameB2: null }); const smtp = installSmtp([SMTP.accept()]);
  const r1 = await cron();
  assert.deepEqual([r1.statusCode, rowOf(r1, T, B2).code, rowOf(r1, T, B2).notice, rowOf(r1, T, B2).receipt, smtp.calls.length], [500, "business_name_unavailable", "recorded", "not_written", 2]);
  const n = await cold(deliveryNoticePath(T, B2));
  assert.deepEqual([n.code, n.message, n.businessDate, n.runs], ["business_name_unavailable", MISSING_NAME_NOTICE_HE, DATE, 1], "the notice on the real store (cold read)");
  assert.equal(await cold(`${RECEIPTS}/${T}/${B2}`), null, "no receipt for the nameless business");
  const read1 = await post({ tenantId: T, bizId: B2, action: "notice" });
  assert.deepEqual([read1.statusCode, read1.body.noticeState, read1.body.notice.runs, smtp.calls.length], [200, "active", 1, 2], "the owner's read: zero provider calls");
  assert.equal((await post({ tenantId: T, bizId: B2, action: "notice" }, { uid: "u_viewer_a", email: "viewer-a@example.test" })).statusCode, 403, "a viewer is refused");
  await dbA.ref(`tenants/${T}/app/business`).set(env([{ id: B, name: "מסעדה א" }, { id: B2, name: "מסעדה ב" }]));
  const read2 = await post({ tenantId: T, bizId: B2, action: "notice" });
  assert.deepEqual([read2.statusCode, read2.body.deliverable, read2.body.clearState], [200, true, "cleared"]);
  assert.equal(await cold(deliveryNoticePath(T, B2)), null, "removed on the real store");
  const r2 = await cron(T0 + 2 * LEASE);
  assert.deepEqual([r2.statusCode, rowOf(r2, T, B2).settlement, smtp.calls.length], [200, "delivered", 3], "the repaired business is delivered once");
});

await check("I1E3 X3 on the real store: the tenant list cannot be read — 500 with the discovery failure, zero sends, zero receipts", async () => {
  await world(); const smtp = installSmtp([SMTP.accept()]);
  fault.path = "tenants";
  const r = await cron();
  assert.deepEqual([r.statusCode, r.body.status, r.body.results.length, smtp.calls.length], [500, "completed_with_failures", 0, 0]);
  assert.deepEqual(r.body.discovery, { status: "failed", failures: [{ source: "app_business", code: "read_failed" }] });
  fault.path = null;
  assert.equal(await cold(RECEIPTS), null, "no receipt node at all");
});

await check("I1E4 G10 on the real store (manual, D-G10): ambiguous 422, nameless 422 — nothing sent", async () => {
  await world({ registryA: env([{ id: B, name: "א" }, { id: B, name: "א (twin)" }]) }); const smtp = installSmtp([SMTP.accept()]);
  const a = await post({ tenantId: T, bizId: B });
  await dbA.ref(`tenants/${T}/app/business`).set(env([{ id: B }]));
  const n = await post({ tenantId: T, bizId: B });
  assert.deepEqual([a.statusCode, a.body.code, n.statusCode, n.body.code, smtp.calls.length], [422, "ambiguous_business_identity", 422, "business_name_unavailable", 0]);
});

await appA.delete(); await appB.delete();
const failed = results.filter((r) => !r.ok);
origLog(JSON.stringify({ results, failed: failed.length }));
process.exit(failed.length ? 1 : 0);
