// DP3 — the DP2 review corrections on the REAL local RTDB emulator (real serialization, transaction engine, real Admin SDK, cold
// clients). AUTHOR evidence only (Claude authored DP1–DP3): it does not replace an independent writer → RTDB → cold-reader
// execution, nor the reviewer's own probes.
//   DP3E-01  writer representation: the admissions, manual records and receipts the real writers store come back from a cold
//            client as valid records (admissionRecordDefect null; a definitive failure still re-admits)
//   DP3E-02  DP2-R01 over the real transport: a failed admission beside an older manual acceptance / handing_off ⇒ no hand-off on
//            either route; every stored value unchanged
//   DP3E-03  DP2-R02 over the real transport: an incomplete failed admission, an accepted historical holder, a claimed receipt
//            without a lease ⇒ no hand-off on either route; nothing repaired
//   DP3E-04  RTDB representation: a null written by a non-writer is DROPPED by the store (a history entry without its code is
//            unreadable); a legitimately absent optional field (messageIdHeader) is read as written
//   DP3E-05  six SEPARATE PROCESSES on a re-admittable failed admission ⇒ exactly one hand-off; with an older acceptance ⇒ none
//   DP3E-06  the operator evidence report on the real store lists a runtime-unreadable admission with its defect and aborts
// Local only: refuses to run unless pointed at the demo namespace on 127.0.0.1:9000. Fake `send` only (no SMTP, no e-mail).
// Run: bash test/support/p1-r7-emu-run.sh <checkout> <abs-log-dir> dp3=test/emulator/dp3-evidence-emulator.mjs
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
const cold = () => { const a = admin.initializeApp({ databaseURL: DB_URL }, "dp3-" + n++); apps.push(a); return a.database(); };
const seedDb = cold();
const read = async (p) => (await cold().ref(p).once("value")).val();
const op = { actor: "op.emu", reason: "emulator check" };
const T = "tA", B = "bA", TO = "owner-a@example.test", MID = "a0000000-0000-4000-8000-000000000051";
const NOW = Date.now();
const ids = (d) => ({ kind: "daily_snapshot", tenantId: T, bizId: B, businessDate: d });
const admissionOf = (d) => read(E.admissionPath("daily_snapshot", T, B, d));
let calls = 0;
const accept = async () => { const a = E.currentDeliveryAttempt(); await a.beforeTransport(); calls++; a.info = { accepted: [TO], rejected: [], response: "250 OK" }; };
const fail = (code, response, command) => async () => { const a = E.currentDeliveryAttempt(); await a.beforeTransport(); calls++;
  const e = new Error("x"); e.code = code; if (response) { e.response = response; e.responseCode = Number(response.slice(0, 3)); } if (command) e.command = command; a.error = e; throw e; };
const manual = (d, send = accept) => E.deliverManualDaily({ db: cold(), tenantId: T, bizId: B, businessDate: d, recipient: TO, recipientSelection: "owner", actorRole: "owner", send, clock: () => NOW });
const scheduled = (d, send = accept) => { const db = cold(); return E.deliverWithReceipt({ db, tenantId: T, bizId: B, businessDate: d, recipient: TO, send, clock: () => NOW, gate: E.makeDailyDeliveryGate(db, d, { clock: () => NOW }) }); };
const worker = (route, d, startAt) => new Promise((resolve) => {
  const p = spawn(process.execPath, [join(HERE, "dp2-admission-worker.mjs"), route, d, String(startAt), "accept", ""], { env: process.env, stdio: ["ignore", "pipe", "pipe"] });
  let out = ""; p.stdout.on("data", (b) => { out += b; }); p.stderr.on("data", () => {});
  p.on("exit", (code) => { const line = out.trim().split("\n").filter((l) => l.startsWith("{")).pop(); resolve({ code, result: line ? JSON.parse(line) : null }); });
});
const failedAdm = (d, extra = {}) => ({ v: E.ADMISSION_VERSION, ...ids(d), state: "failed", route: "scheduled", ref: "b0000000-0000-4000-8000-000000000051", attempt: 1,
  messageIdHeader: "<daily_snapshot.1.b0000000-0000-4000-8000-000000000051@delivery.marjin.app>", since: NOW - 20_000, code: "provider_rejected_550",
  settledAt: NOW - 19_000, updatedAt: NOW - 19_000, ...extra });
const manualRec = (d, state) => ({ v: E.MANUAL_ATTEMPT_VERSION, attemptId: MID, kind: "daily_snapshot", tenantId: T, bizId: B, businessDate: d, state,
  messageIdHeader: `<manual.${MID}@delivery.marjin.app>`, startedAt: NOW - 30_000, updatedAt: NOW - 29_000, ...(state === "handing_off" ? {} : { settledAt: NOW - 29_000 }) });
const seed = (p, v) => seedDb.ref(p).set(v);

await seedDb.ref("/").set(null);
assert.equal((await E.changeDeliveryHold(cold(), { action: "init", ...op, nowMs: NOW - 3_600_000 })).code, "applied");
{ const v = E.deliveryInventoryView(await read(E.DELIVERY_HOLD_PATH));
  assert.equal((await E.confirmDeliveryInventory(cold(), { ...op, generation: v.generation, digest: v.digest, nowMs: NOW - 3_500_000 })).ok, true);
  assert.equal((await E.changeDeliveryHold(cold(), { action: "release", ...op, expectVersion: 1, nowMs: NOW - 3_400_000 })).code, "applied"); }

await check("DP3E-01 writer representation: what the real writers store comes back from a cold client as valid records", async () => {
  const D1 = "2026-10-01", D2 = "2026-10-02";
  assert.equal((await manual(D1, fail("EENVELOPE", "550 5.1.1 no such user", "RCPT TO"))).outcome, "failed");
  const f = await admissionOf(D1);
  assert.deepEqual([f.state, E.admissionRecordDefect(f, ids(D1))], ["failed", null], JSON.stringify(f));
  const rec = Object.values(await read(`${E.MANUAL_ATTEMPT_ROOT}/${T}/${B}`))[0];
  assert.equal(E.decideManualRepeat({ receipt: null, records: { [rec.attemptId]: rec }, tenantId: T, bizId: B, businessDate: D1, nowMs: NOW }), null, "the stored failed record is complete");
  const before = calls;
  assert.equal((await scheduled(D1)).outcome, "accepted", "a definitive failure still re-admits");
  assert.equal(calls - before, 1);
  const a = await admissionOf(D1);
  assert.deepEqual([a.state, E.admissionRecordDefect(a, ids(D1)), a.history.length], ["accepted", null, 1]);
  assert.equal((await scheduled(D2, fail("ECONNECTION", null, "CONN"))).outcome, "unknown");
  const u = await admissionOf(D2); assert.deepEqual([u.state, E.admissionRecordDefect(u, ids(D2))], ["unknown", null]);
  const r = await read(E.receiptPath("daily_snapshot", T, B, D2));
  assert.equal(E.decideManualRepeat({ receipt: r, records: null, tenantId: T, bizId: B, businessDate: D2, nowMs: NOW }), "delivery_outcome_unresolved");
});

await check("DP3E-02 DP2-R01 over the real transport: a failed admission never erases an older acceptance / hand-off", async () => {
  for (const [D, state, sCode, mCode] of [["2026-10-03", "accepted", "delivery_already_accepted", "manual_repeat_not_permitted"], ["2026-10-04", "handing_off", "delivery_outcome_unresolved", "delivery_outcome_unresolved"]]) {
    await seed(E.admissionPath("daily_snapshot", T, B, D), failedAdm(D));
    await seed(`${E.MANUAL_ATTEMPT_ROOT}/${T}/${B}/${MID}`, manualRec(D, state));
    const adm = await admissionOf(D), before = calls;
    const s = await scheduled(D), m = await manual(D);
    assert.deepEqual([s.outcome, s.code, m.outcome, m.code, calls - before], ["skipped", sCode, "refused", mCode, 0], state);
    assert.deepEqual(await admissionOf(D), adm, state + ": unchanged");
    await seed(`${E.MANUAL_ATTEMPT_ROOT}/${T}/${B}/${MID}`, null);
  }
});

await check("DP3E-03 DP2-R02 over the real transport: incomplete or contradictory evidence never permits a hand-off; nothing repaired", async () => {
  const { attempt, since, settledAt, updatedAt, code, ...incomplete } = failedAdm("2026-10-05");
  const cases = [["2026-10-05", "admission", incomplete], ["2026-10-06", "admission", failedAdm("2026-10-06", { history: [{ route: "manual", ref: MID, attempt: 1, state: "accepted", code: "x", at: NOW - 40_000 }] })],
    ["2026-10-07", "receipt", { v: E.RECEIPT_VERSION, ...ids("2026-10-07"), state: "claimed", claimId: "c0000000-0000-4000-8000-000000000051", attempt: 1, claimedAt: NOW - 2000, updatedAt: NOW - 2000, recipientHash: "a".repeat(64) }]];
  for (const [D, kind, value] of cases) {
    const path = kind === "admission" ? E.admissionPath("daily_snapshot", T, B, D) : E.receiptPath("daily_snapshot", T, B, D);
    await seed(path, value); const stored = await read(path), before = calls;
    const m = await manual(D);
    assert.deepEqual([m.outcome, calls - before], ["refused", 0], `${D} ${kind} manual ${m.code}`);
    if (kind === "admission") { const s = await scheduled(D); assert.deepEqual([s.outcome, s.code, calls - before], ["skipped", "delivery_admission_unreadable", 0], `${D} scheduled`); }
    assert.deepEqual(kind === "admission" ? await read(path) : (await read(path)).leaseUntil, kind === "admission" ? stored : undefined, `${D}: nothing repaired, no lease invented`);
  }
});

await check("DP3E-04 RTDB representation: a null is dropped by the store (unreadable); a legitimately absent optional field is read as written", async () => {
  const D1 = "2026-10-08", D2 = "2026-10-09";
  await seed(E.admissionPath("daily_snapshot", T, B, D1), failedAdm(D1, { history: [{ route: "manual", ref: MID, attempt: 1, state: "failed", code: null, at: NOW - 40_000 }] }));
  const stored = await admissionOf(D1);
  assert.equal(Object.prototype.hasOwnProperty.call(stored.history[0], "code"), false, "the store dropped the null code");
  assert.equal(E.admissionRecordDefect(stored, ids(D1)), "history_entry");
  let before = calls;
  assert.deepEqual([(await manual(D1)).code, calls - before], ["delivery_admission_unreadable", 0]);
  const { messageIdHeader, ...noMid } = failedAdm(D2);
  await seed(E.admissionPath("daily_snapshot", T, B, D2), noMid);
  before = calls;
  assert.deepEqual([(await scheduled(D2)).outcome, calls - before], ["accepted", 1], "complete without the optional Message-ID: re-admitted");
});

await check("DP3E-05 six separate processes on a re-admittable failed admission: one hand-off; with an older acceptance none", async () => {
  const D = "2026-10-10";
  await seed(E.admissionPath("daily_snapshot", T, B, D), failedAdm(D));
  let startAt = Date.now() + 1500;
  let rs = await Promise.all(["scheduled", "manual", "scheduled", "manual", "scheduled", "manual"].map((r) => worker(r, D, startAt)));
  assert.equal(rs.reduce((s, x) => s + (x.result ? x.result.handed : 0), 0), 1, JSON.stringify(rs.map((x) => x.result)));
  assert.deepEqual([(await admissionOf(D)).state, (await admissionOf(D)).history.length], ["accepted", 1]);
  const D2 = "2026-10-11";
  await seed(E.admissionPath("daily_snapshot", T, B, D2), failedAdm(D2));
  await seed(`${E.MANUAL_ATTEMPT_ROOT}/${T}/${B}/${MID}`, manualRec(D2, "accepted"));
  startAt = Date.now() + 1500;
  rs = await Promise.all(["scheduled", "manual", "scheduled", "manual"].map((r) => worker(r, D2, startAt)));
  assert.equal(rs.reduce((s, x) => s + (x.result ? x.result.handed : 0), 0), 0, JSON.stringify(rs.map((x) => x.result)));
  assert.equal((await admissionOf(D2)).state, "failed");
  await seed(`${E.MANUAL_ATTEMPT_ROOT}/${T}/${B}/${MID}`, null);
});

await check("DP3E-06 the operator evidence report on the real store: a runtime-unreadable admission is listed and aborts the report", async () => {
  const D = "2026-10-12";
  await seed(E.admissionPath("daily_snapshot", T, B, D), failedAdm(D, { history: { corrupt: true } }));
  const rec = await read(E.DELIVERY_HOLD_PATH);
  assert.equal((await E.changeDeliveryHold(cold(), { action: "hold", ...op, expectVersion: rec.version, nowMs: NOW })).code, "applied");
  const args = Tool.parseArgs(["evidence", "--max-duration-ms=300000", "--inventory-attested", "--logs-attested", "--invocation-receipt-attested", "--provider-attested"]);
  const r = await Tool.runCommand(cold(), "evidence", args, { project: PROJECT, nowMs: NOW + 7_200_000 });
  assert.equal(r.exitCode, 5);
  assert.equal(r.result.criteria.C2_no_live_scheduled_claim, "not_met");
  assert.deepEqual(r.result.admissions.unreadableDetail.filter((x) => x.id === `tA/bA/${D}`), [{ id: `tA/bA/${D}`, defect: "history" }]);
  assert.ok(r.result.admissions.unreadable.includes(`tA/bA/${D}`));
  assert.deepEqual(await admissionOf(D), failedAdm(D, { history: { corrupt: true } }), "the report changed nothing");
  assert.doesNotMatch(JSON.stringify(r.result), /QUIESCENT|DRAINED|nothing sent/i);
});

await Promise.all(apps.map((a) => a.delete()));
const failed = results.filter((r) => !r.ok).length;
console.log(`dp3 emulator: ${results.length - failed} passed / ${failed} failed / 0 skipped; fake hand-offs in this process: ${calls}`);
process.exit(failed ? 1 : 0);
