// DP2 — P4 across routes on the REAL local RTDB emulator (transaction engine, real Admin SDK). AUTHOR evidence only: it does
// not replace an independent writer → RTDB → cold-reader execution.
//   DP2E-01  six SEPARATE PROCESSES (three scheduled, three manual) for one identity, started together: exactly one hand-off
//   DP2E-02  DP1 gap 1 over the real transport: a scheduled delivery from another instance completes inside the manual window
//   DP2E-03  DP1 gap 2 over the real transport: a scheduled attempt after an earlier manual send is skipped, not re-sent
//   DP2E-04  process interruption: a worker process that exits right after its hand-off, and one that exits right after the
//            admission commits (before its own record moves): both routes refused, in progress then unresolved; never released
//   DP2E-05  outcomes: a definitive refusal re-admits the other route; an unknown blocks it
//   DP2E-06  E4 / hold: a refused business date takes no admission on either route
//   DP2E-07  the operator evidence report on the real store: admissions visible, C2 / C3 not met, never quiescence
//   DP2E-08  client access under the unchanged Rules: every principal is denied on email_delivery_admission
// Local only: refuses to run unless pointed at the demo namespace on 127.0.0.1:9000. Fake `send` only (no SMTP, no e-mail).
// Run: bash test/support/p1-r7-emu-run.sh <checkout> <abs-log-dir> dp2=test/emulator/dp2-shared-admission-emulator.mjs
import admin from "firebase-admin";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import * as E from "../../lib/emailDelivery.js";
import * as Tool from "../../tools/daily-delivery/hold.mjs";

const PROJECT = "demo-marjin-rules", NS = "demo-marjin-rules-default-rtdb", DB_URL = `http://127.0.0.1:9000?ns=${NS}`;
const HERE = dirname(fileURLToPath(import.meta.url));
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
const cold = () => { const a = admin.initializeApp({ databaseURL: DB_URL }, "dp2-" + n++); apps.push(a); return a.database(); };
const seedDb = cold();
const read = async (p) => (await cold().ref(p).once("value")).val();
const op = { actor: "op.emu", reason: "emulator check" };
const T = "tA", B = "bA", TO = "owner-a@example.test";
const NOW = Date.now(), LATER = NOW + E.CLAIM_LEASE_MS + 60_000;
const admissionOf = (d) => read(E.admissionPath("daily_snapshot", T, B, d));
let calls = 0;
const accept = async () => { const a = E.currentDeliveryAttempt(); await a.beforeTransport(); calls++; a.info = { accepted: [TO], rejected: [], response: "250 OK" }; };
const fail = (code, response, command) => async () => { const a = E.currentDeliveryAttempt(); await a.beforeTransport(); calls++;
  const e = new Error("x"); e.code = code; if (response) { e.response = response; e.responseCode = Number(response.slice(0, 3)); } if (command) e.command = command; a.error = e; throw e; };   // what lib/sendEmail.js records
const manual = (d, send = accept, clock = () => NOW) => E.deliverManualDaily({ db: cold(), tenantId: T, bizId: B, businessDate: d, recipient: TO, recipientSelection: "owner", actorRole: "owner", send, clock });
const scheduled = (d, send = accept, clock = () => NOW) => { const db = cold(); return E.deliverWithReceipt({ db, tenantId: T, bizId: B, businessDate: d, recipient: TO, send, clock, gate: E.makeDailyDeliveryGate(db, d, { clock }) }); };
const worker = (route, d, startAt, mode = "accept", clockMs = "") => new Promise((resolve) => {
  const p = spawn(process.execPath, [join(HERE, "dp2-admission-worker.mjs"), route, d, String(startAt), mode, String(clockMs)], { env: process.env, stdio: ["ignore", "pipe", "pipe"] });
  let out = ""; p.stdout.on("data", (b) => { out += b; }); p.stderr.on("data", () => {});
  p.on("exit", (code) => { const line = out.trim().split("\n").filter((l) => l.startsWith("{")).pop(); resolve({ code, result: line ? JSON.parse(line) : null }); });
});

await seedDb.ref("/").set(null);
assert.equal((await E.changeDeliveryHold(cold(), { action: "init", ...op, nowMs: NOW - 3_600_000 })).code, "applied");
{ const v = E.deliveryInventoryView(await read(E.DELIVERY_HOLD_PATH));
  assert.equal((await E.confirmDeliveryInventory(cold(), { ...op, generation: v.generation, digest: v.digest, nowMs: NOW - 3_500_000 })).ok, true);
  assert.equal((await E.changeDeliveryHold(cold(), { action: "release", ...op, expectVersion: 1, nowMs: NOW - 3_400_000 })).code, "applied"); }

await check("DP2E-01 six separate processes (three scheduled, three manual) for one identity: exactly one hand-off", async () => {
  const D = "2026-09-20", startAt = Date.now() + 1500;
  const rs = await Promise.all(["scheduled", "manual", "scheduled", "manual", "scheduled", "manual"].map((r) => worker(r, D, startAt)));
  const handed = rs.reduce((s, x) => s + (x.result ? x.result.handed : 0), 0);
  assert.equal(handed, 1, JSON.stringify(rs.map((x) => x.result)));
  assert.ok(rs.every((x) => x.code === 0 && x.result), "every process reported");
  assert.equal(rs.filter((x) => x.result.outcome === "accepted").length, 1);
  const blocked = ["delivery_in_progress", "delivery_already_accepted", "manual_repeat_not_permitted", "in_progress", "already_accepted"];
  assert.ok(rs.filter((x) => x.result.outcome !== "accepted").every((x) => blocked.includes(x.result.code)), JSON.stringify(rs.map((x) => x.result)));
  assert.equal((await admissionOf(D)).state, "accepted");
});

await check("DP2E-02 DP1 gap 1 over the real transport: a scheduled delivery inside the manual window — one hand-off, manual refused", async () => {
  const D = "2026-09-21", db = cold(); const ref = db.ref.bind(db); let armed = true;
  db.ref = (p) => { const x = ref(p);
    if (armed && (String(p).startsWith(E.MANUAL_ATTEMPT_ROOT + "/") || String(p).startsWith(E.ADMISSION_ROOT + "/"))) {
      const t = x.transaction.bind(x); x.transaction = async (...a) => { armed = false; assert.equal((await scheduled(D)).outcome, "accepted"); return t(...a); }; }
    return x; };
  const before = calls;
  const m = await E.deliverManualDaily({ db, tenantId: T, bizId: B, businessDate: D, recipient: TO, send: accept, clock: () => NOW });
  assert.deepEqual([m.outcome, m.code, m.record, calls - before], ["refused", "manual_repeat_not_permitted", "not_written", 1]);
  assert.deepEqual([(await admissionOf(D)).state, (await admissionOf(D)).route], ["accepted", "scheduled"]);
});

await check("DP2E-03 DP1 gap 2 over the real transport: a scheduled attempt after an earlier manual send is skipped, not re-sent", async () => {
  const D = "2026-09-22", before = calls;
  assert.equal((await manual(D)).outcome, "accepted");
  const s = await scheduled(D);
  assert.deepEqual([s.outcome, s.code, calls - before], ["skipped", "delivery_already_accepted", 1]);
  const r = await read(E.receiptPath("daily_snapshot", T, B, D));
  assert.deepEqual([r.state, r.history.at(-1).state], ["claimed", "admission_refused"], "no scheduled acceptance is fabricated");
});

await check("DP2E-04 process interruption: a holder process that exits is never released — in progress, then unresolved", async () => {
  for (const [D, route, mode] of [["2026-09-23", "manual", "exit-after-handoff"], ["2026-09-24", "scheduled", "exit-after-handoff"],
    ["2026-09-25", "manual", "exit-after-admission"], ["2026-09-26", "scheduled", "exit-after-admission"]]) {
    const w = await worker(route, D, 0, mode, NOW);
    assert.equal(w.result, null, `${route} ${mode}: the process exited without reporting`);
    const a = await admissionOf(D);
    assert.deepEqual([a.state, a.route], ["in_flight", route], `${route} ${mode}`);
    const before = calls;
    const m1 = await manual(D), s1 = await scheduled(D);
    assert.equal(m1.code, "delivery_in_progress", `${route} ${mode} during the lease`);
    // a scheduled holder's own claim answers first for the scheduled route (receipt in_progress); otherwise the admission does
    assert.ok(["delivery_in_progress", "in_progress"].includes(s1.code), `${route} ${mode} during the lease: ${s1.code}`);
    const m2 = await manual(D, accept, () => LATER), s2 = await scheduled(D, accept, () => LATER);
    assert.ok(["delivery_outcome_unresolved"].includes(m2.code), `${route} ${mode}: ${m2.code}`);
    assert.ok(["delivery_outcome_unresolved", "unknown_requires_reconciliation"].includes(s2.code), `${route} ${mode}: ${s2.code}`);
    assert.equal(calls - before, 0, "no hand-off");
    assert.equal((await admissionOf(D)).state, "in_flight", "never released or reclassified");
  }
});

await check("DP2E-05 outcomes: a definitive refusal re-admits the other route; an unknown blocks it", async () => {
  const D1 = "2026-09-27", D2 = "2026-09-28";
  let before = calls;
  assert.equal((await manual(D1, fail("EENVELOPE", "550 5.1.1 no such user", "RCPT TO"))).outcome, "failed");
  assert.equal((await scheduled(D1)).outcome, "accepted");
  assert.equal(calls - before, 2);
  assert.deepEqual((await admissionOf(D1)).history.map((h) => [h.route, h.state]), [["manual", "failed"]]);
  before = calls;
  assert.equal((await scheduled(D2, fail("ECONNECTION", null, "CONN"))).outcome, "unknown");
  assert.deepEqual([(await manual(D2)).code, calls - before], ["delivery_outcome_unresolved", 1]);
});

await check("DP2E-06 E4 / hold: a business date refused while held takes no admission on either route", async () => {
  const D = "2026-09-29", rec = await read(E.DELIVERY_HOLD_PATH);
  assert.equal((await E.changeDeliveryHold(cold(), { action: "hold", ...op, expectVersion: rec.version, nowMs: NOW })).code, "applied");
  assert.equal((await scheduled(D)).outcome, "held");
  const v = E.deliveryInventoryView(await read(E.DELIVERY_HOLD_PATH));
  assert.equal((await E.confirmDeliveryInventory(cold(), { ...op, generation: v.generation, digest: v.digest, nowMs: NOW })).ok, true);
  assert.equal((await E.changeDeliveryHold(cold(), { action: "release", ...op, expectVersion: rec.version + 1, nowMs: NOW })).code, "applied");
  const before = calls;
  assert.deepEqual([(await manual(D)).code, (await scheduled(D)).code, calls - before, await admissionOf(D)], ["held_day", "held_day", 0, null]);
});

await check("DP2E-07 the operator evidence report on the real store: admissions visible, C2 / C3 not met, never quiescence", async () => {
  const rec = await read(E.DELIVERY_HOLD_PATH);
  assert.equal((await E.changeDeliveryHold(cold(), { action: "hold", ...op, expectVersion: rec.version, nowMs: NOW })).code, "applied");
  const args = Tool.parseArgs(["evidence", "--max-duration-ms=300000", "--inventory-attested", "--logs-attested", "--invocation-receipt-attested", "--provider-attested"]);
  const r = await Tool.runCommand(cold(), "evidence", args, { project: PROJECT, nowMs: LATER + 3_600_000 });
  assert.equal(r.exitCode, 5);
  assert.equal(r.result.criteria.C3_no_manual_attempt_handing_off, "not_met", "the stopped manual holders");
  assert.deepEqual(r.result.admissions.inFlightExpired.map((x) => x.id).sort(), ["tA/bA/2026-09-23", "tA/bA/2026-09-24", "tA/bA/2026-09-25", "tA/bA/2026-09-26"]);
  assert.deepEqual(r.result.admissions.unknown.map((x) => x.id), ["tA/bA/2026-09-28"]);
  assert.doesNotMatch(JSON.stringify(r.result), /QUIESCENT|DRAINED|nothing sent/i);
});

await check("DP2E-08 client access under the unchanged Rules: every principal is denied on email_delivery_admission", async () => {
  await seedDb.ref("tenants/tA").set({ members: { u_owner: true, u_super: true }, roles: { u_owner: "owner", u_super: "super_owner" } });
  const before = await read(E.ADMISSION_ROOT);
  for (const [name, override] of Object.entries({ unauth: null, owner: { uid: "u_owner" }, super: { uid: "u_super" } })) {
    const c = admin.initializeApp({ databaseURL: DB_URL, databaseAuthVariableOverride: override }, "dp2-client-" + name); apps.push(c);
    for (const p of [E.ADMISSION_ROOT, E.admissionPath("daily_snapshot", T, B, "2026-09-22")]) {
      const denied = (op) => op.then(() => false, (e) => /permission[_ ]denied/i.test(String(e && (e.message + " " + e.code))));
      assert.ok(await denied(c.database().ref(p).once("value")), `${name} read ${p}`);
      assert.ok(await denied(c.database().ref(p).set(null)), `${name} set ${p}`);
      assert.ok(await denied(c.database().ref(p).transaction(() => null)), `${name} transaction ${p}`);
    }
  }
  assert.deepEqual(await read(E.ADMISSION_ROOT), before, "the client attempts changed nothing");
});

await Promise.all(apps.map((a) => a.delete()));
const failed = results.filter((r) => !r.ok).length;
console.log(`dp2 emulator: ${results.length - failed} passed / ${failed} failed / 0 skipped; fake hand-offs in this process: ${calls}`);
process.exit(failed ? 1 : 0);
