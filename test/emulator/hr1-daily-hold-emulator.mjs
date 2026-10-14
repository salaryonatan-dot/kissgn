// HR1 — the Daily-only delivery hold on the REAL local RTDB emulator (Rules engine + transaction engine), real Admin SDK.
//   HRE-01  hold changes over the real transport from cold instances: init / release / hold; five concurrent inits create ONE
//           record; two concurrent changes with the same expected version commit ONE; a deleted record reads as held
//   HRE-02  the scheduled gate over the real transport: G0 held ⇒ no claim; a hold set between G0 and the hand-off (by another
//           instance) ⇒ G3 expires the claim at the same attempt, no provider call; the date is marked held; release ⇒ held_day
//   HRE-03  the manual send over the real transport: the attempt record is created before the hand-off and finalized; a held
//           Daily writes no record and calls no provider
//   HRE-04  client access under the UNCHANGED Rules (top-level `$other` deny): unauth / member / manager / owner / super_owner
//           are denied read, set, update and transaction on delivery_control and email_delivery_manual; the Admin SDK writes
//   HRE-05  the operator tool end to end (status / refused write / project mismatch / init / release) against the emulator
// Local only: refuses to run unless pointed at the demo namespace on 127.0.0.1:9000. Fake `send` only (no SMTP, no e-mail).
// Run: bash test/support/p1-r7-emu-run.sh <checkout> <abs-log-dir> hr1=test/emulator/hr1-daily-hold-emulator.mjs
import admin from "firebase-admin";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import * as E from "../../lib/emailDelivery.js";

const PROJECT = "demo-marjin-rules", NS = "demo-marjin-rules-default-rtdb", DB_URL = `http://127.0.0.1:9000?ns=${NS}`;
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
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
const cold = () => { const a = admin.initializeApp({ databaseURL: DB_URL }, "hr1-" + n++); apps.push(a); return a.database(); };
const seedDb = cold();
const read = async (p) => (await cold().ref(p).once("value")).val();
const op = { actor: "op.emu", reason: "emulator check" };
const D = "2026-09-08";
const TO = "owner-a@example.test";

await seedDb.ref("/").set(null);

await check("HRE-01 hold changes over the real transport (cold instances): one record, one change per expected version, deletion holds", async () => {
  const inits = await Promise.all([0, 1, 2, 3, 4].map(() => E.changeDeliveryHold(cold(), { action: "init", ...op })));
  assert.deepEqual(inits.filter((r) => r.code === "applied").length, 1, "exactly one init applied: " + JSON.stringify(inits.map((r) => r.code)));
  assert.ok(inits.every((r) => r.code === "applied" || r.code === "exists"));
  assert.deepEqual(E.classifyHoldRecord(await read(E.DELIVERY_HOLD_PATH)), { state: "held", code: "delivery_held", version: 1 });
  assert.equal((await E.changeDeliveryHold(cold(), { action: "release", ...op, expectVersion: 1 })).code, "applied");
  assert.deepEqual(await E.readDeliveryHold(cold()), { state: "released", code: null, version: 2 });
  const race = await Promise.all([E.changeDeliveryHold(cold(), { action: "hold", ...op, expectVersion: 2 }), E.changeDeliveryHold(cold(), { action: "hold", actor: "op.two", reason: "second operator", expectVersion: 2 })]);
  assert.deepEqual(race.map((r) => r.code).sort(), ["applied", "version_conflict"], "the second change sees the first one's version");
  assert.equal(race.filter((r) => r.code === "applied").length, 1, "one change per expected version: " + JSON.stringify(race.map((r) => r.code)));
  const rec = await read(E.DELIVERY_HOLD_PATH);
  assert.equal(rec.version, 3); assert.deepEqual(Object.keys(rec.log), ["v000000001", "v000000002", "v000000003"]);
  await seedDb.ref(E.DELIVERY_HOLD_PATH).remove();
  assert.equal((await E.readDeliveryHold(cold())).code, "delivery_hold_unreadable", "a deleted record holds");
});

await check("HRE-02 the scheduled gate over the real transport: G0, G3 between claim and hand-off, held-date marker, no backfill after release", async () => {
  await seedDb.ref("/").set(null);
  await E.changeDeliveryHold(cold(), { action: "init", ...op, nowMs: Date.parse("2026-09-07T04:05:00Z") });
  await E.changeDeliveryHold(cold(), { action: "release", ...op, expectVersion: 1, nowMs: Date.parse("2026-09-07T04:05:00Z") });
  const db = cold();
  let calls = 0;
  const base = { db, tenantId: "tA", bizId: "bA", businessDate: D, recipient: TO, inRunAttempts: 1, backoffMs: 0, sleep: async () => {} };
  // a hold set by ANOTHER instance after the claim, before the hand-off
  const send = (flip) => async () => {
    const a = E.currentDeliveryAttempt();
    if (flip) await E.changeDeliveryHold(cold(), { action: "hold", ...op, expectVersion: 2, nowMs: Date.parse("2026-09-08T04:05:00Z") });
    await a.beforeTransport();
    calls++; a.info = { accepted: [TO], rejected: [], response: "250 OK" };
  };
  const r = await E.deliverWithReceipt({ ...base, send: send(true), gate: E.makeDailyDeliveryGate(db, D) });
  assert.deepEqual([r.outcome, r.code, r.attempt, r.receipt, calls], ["held", "delivery_held", 1, "recorded", 0]);
  const rc = await read(E.receiptPath("daily_snapshot", "tA", "bA", D));
  assert.deepEqual([rc.state, rc.attempt, rc.history.at(-1).state], ["claimed", 1, "held_before_send"]);
  assert.equal((await read(E.heldDatePath(D))).stage, "g3");
  // G0: a second business on the held day writes no claim
  const r2 = await E.deliverWithReceipt({ ...base, bizId: "bB", send: send(false), gate: E.makeDailyDeliveryGate(db, D) });
  assert.deepEqual([r2.outcome, calls], ["held", 0]);
  assert.equal(await read(E.receiptPath("daily_snapshot", "tA", "bB", D)), null);
  // release: the held day is not sent automatically; another day is
  await E.changeDeliveryHold(cold(), { action: "release", ...op, expectVersion: 3, nowMs: Date.parse("2026-09-08T04:05:00Z") });
  const r3 = await E.deliverWithReceipt({ ...base, send: send(false), gate: E.makeDailyDeliveryGate(db, D) });
  assert.deepEqual([r3.outcome, r3.code, calls], ["held", "held_day", 0]);
  const r4 = await E.deliverWithReceipt({ ...base, businessDate: "2026-09-09", send: send(false), gate: E.makeDailyDeliveryGate(db, "2026-09-09") });
  assert.deepEqual([r4.outcome, r4.attempt, calls], ["accepted", 1, 1]);
});

await check("HRE-03 the manual send over the real transport: record before the hand-off, finalized; a held Daily writes no record", async () => {
  const db = cold();
  let calls = 0, recordAtHandoff = null;
  const send = async () => {
    const a = E.currentDeliveryAttempt();
    await a.beforeTransport();
    recordAtHandoff = await read(E.manualAttemptPath("tA", "bA", a.claimId));
    calls++; a.info = { accepted: [TO], rejected: [], response: "250 OK" };
  };
  const r = await E.deliverManualDaily({ db, tenantId: "tA", bizId: "bA", businessDate: D, recipient: TO, recipientSelection: "owner", actorRole: "owner", send });
  assert.deepEqual([r.outcome, r.record, calls], ["accepted", "recorded", 1]);
  assert.equal(recordAtHandoff.state, "handing_off", "the record existed when the provider was invoked");
  const rec = await read(E.manualAttemptPath("tA", "bA", r.attemptId));
  assert.deepEqual([rec.state, rec.v, rec.actorRole], ["accepted", E.MANUAL_ATTEMPT_VERSION, "owner"]);
  await E.changeDeliveryHold(cold(), { action: "hold", ...op, expectVersion: 4 });
  const h = await E.deliverManualDaily({ db, tenantId: "tA", bizId: "bA", businessDate: D, recipient: TO, send });
  assert.deepEqual([h.outcome, h.code, h.record, calls], ["held", "delivery_held", "not_written", 1]);
  assert.equal(Object.keys(await read(`${E.MANUAL_ATTEMPT_ROOT}/tA/bA`)).length, 1, "no record for the held attempt");
});

await check("HRE-04 client access under the unchanged Rules: every principal denied on delivery_control and email_delivery_manual", async () => {
  assert.equal(createHash("sha1").update(`blob ${readFileSync(join(ROOT, "database.rules.json")).length}\0`).update(readFileSync(join(ROOT, "database.rules.json"))).digest("hex"), "27887d72da5431bd0b6ee69f53e0dfd10cc44caf", "Rules blob unchanged");
  await seedDb.ref("tenants/tA").set({ members: { u_member: true, u_manager: true, u_owner: true, u_super: true }, roles: { u_member: "viewer", u_manager: "manager", u_owner: "owner", u_super: "super_owner" } });
  const ids = { unauth: null, member: { uid: "u_member" }, manager: { uid: "u_manager" }, owner: { uid: "u_owner" }, super: { uid: "u_super" } };
  const denied = async (op) => { try { await op(); return false; } catch (e) { return /permission[_ ]denied/i.test(String(e && (e.message + " " + e.code))); } };
  const paths = [E.DELIVERY_HOLD_PATH, E.heldDatePath(D), "delivery_control", `${E.MANUAL_ATTEMPT_ROOT}/tA/bA/x0000000`, E.MANUAL_ATTEMPT_ROOT];
  for (const [name, override] of Object.entries(ids)) {
    const app = admin.initializeApp({ databaseURL: DB_URL, databaseAuthVariableOverride: override }, "hr1-client-" + name); apps.push(app);
    const c = app.database();
    for (const p of paths) {
      assert.ok(await denied(() => c.ref(p).once("value")), `${name} read ${p}`);
      assert.ok(await denied(() => c.ref(p).set({ schema: 1, state: "released" })), `${name} set ${p}`);
      assert.ok(await denied(() => c.ref(p).update({ state: "released" })), `${name} update ${p}`);
      assert.ok(await c.ref(p).transaction(() => null).then(() => false, (e) => /permission[_ ]denied/i.test(String(e && (e.message + " " + e.code)))), `${name} transaction ${p}`);
    }
  }
  assert.equal((await E.readDeliveryHold(cold())).code, "delivery_held", "the client attempts changed nothing");
});

await check("HRE-05 the operator tool end to end: status, refused write, project mismatch, init, release", async () => {
  await seedDb.ref(E.DELIVERY_HOLD_PATH).remove();
  const env = { ...process.env, FIREBASE_CONFIG: JSON.stringify({ projectId: PROJECT, databaseURL: DB_URL }) };
  const tool = (...args) => spawnSync(process.execPath, [join(ROOT, "tools/daily-delivery/hold.mjs"), ...args, `--database-url=${DB_URL}`], { env, encoding: "utf8", timeout: 60000 });
  let r = tool("status", `--project=${PROJECT}`);
  assert.equal(r.status, 0, r.stderr); assert.equal(JSON.parse(r.stdout).code, "delivery_hold_unreadable");
  r = tool("status", "--project=someone-else");
  assert.equal(r.status, 4, "project verification refuses a mismatch");
  r = spawnSync(process.execPath, [join(ROOT, "tools/daily-delivery/hold.mjs"), "init", `--project=${PROJECT}`,
    "--actor=op.cli", "--reason=missing target", `--confirm=init@${PROJECT}`], { env, encoding: "utf8", timeout: 60000 });
  assert.equal(r.status, 2, "missing database URL is refused before mutation");
  const wrongUrl = `http://127.0.0.1:9000?ns=demo-other-default-rtdb`;
  r = spawnSync(process.execPath, [join(ROOT, "tools/daily-delivery/hold.mjs"), "init", `--project=${PROJECT}`,
    `--database-url=${wrongUrl}`, "--actor=op.cli", "--reason=wrong target", `--confirm=init@${PROJECT}`],
    { env: { ...env, FIREBASE_CONFIG: JSON.stringify({ projectId: PROJECT, databaseURL: wrongUrl }) }, encoding: "utf8", timeout: 60000 });
  assert.equal(r.status, 4, "other namespace is refused before mutation");
  r = tool("init", `--project=${PROJECT}`, "--actor=op.cli", "--reason=bootstrap via tool");
  assert.equal(r.status, 3, "a write without --confirm is refused");
  assert.equal(await read(E.DELIVERY_HOLD_PATH), null);
  r = tool("init", `--project=${PROJECT}`, "--actor=op.cli", "--reason=bootstrap via tool", `--confirm=init@${PROJECT}`);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  r = tool("release", `--project=${PROJECT}`, "--actor=op.cli", "--reason=enable the daily", "--expect-version=1", `--confirm=release@${PROJECT}`);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.deepEqual(await E.readDeliveryHold(cold()), { state: "released", code: null, version: 2 });
  r = tool("evidence", `--project=${PROJECT}`);
  assert.equal(r.status, 5, "the evidence report on a released record is ABORT_D"); assert.match(r.stdout, /VERDICT ABORT_D/);
});

for (const a of apps) await a.delete().catch(() => {});
const failed = results.filter((r) => !r.ok);
console.log(`HR1_EMULATOR total=${results.length} pass=${results.length - failed.length} fail=${failed.length}`);
process.exit(failed.length || results.length !== 5 ? 1 : 0);
