// HR1 — the Daily-only delivery hold, through the REAL route api/daily-snapshot/run.ts, the REAL lib/emailDelivery.js and the
// REAL lib/sendEmail.js with a fake provider (test/support/daily-email-harness.mjs: in-memory RTDB with the SDK's cold-cache
// transaction protocol, fake nodemailer — no network, no real e-mail).
//   HR-01  the hold record: only a well-formed, logged "released" record releases; absent / deleted / malformed / log-less /
//          mismatched / unreadable / timed-out are held (fail closed)
//   HR-02  hold changes: one transaction writes state + version + log entry or nothing; init / hold / release / conflicts /
//          no-op / malformed repair / a failing transaction; the cold-cache protocol never overwrites an existing record
//   HR-03  G1: a held, absent, unreadable or timed-out hold refuses the scheduled run before any claim (after the read-only
//          build) — 503 held, no provider call, no receipt, the business date marked held
//   HR-04  G0: a hold set during a run — earlier messages delivered, later ones held without a claim, the run answers 503 held
//   HR-05  G3: a hold set after the claim, before the hand-off — no provider call; the claim expires at the SAME attempt with a
//          held_before_send entry; no terminal state
//   HR-06  a hold never consumes the provider-failure budget (MAX_AUTOMATIC_ATTEMPTS); provider failures keep their semantics
//   HR-07  release sends no held day automatically (held_day); the next day is delivered; the manual route remains available
//          under its existing owner authorization. This test is not blanket permission for operational catch-up.
//   HR-08  manual send: G2 / G3 held ⇒ 503, no provider call, no record; the durable attempt record before the hand-off
//          (refused when it cannot be written), finalized to accepted / failed / unknown, left handing_off when finalization
//          fails; the notice read is unaffected
//   HR-09  concurrent hold / send activity: every message is delivered at most once or held; concurrent runs still send once
//   HR-10  interrupted and unknown attempts stay held for reconciliation across hold / release
//   HR-11  other e-mail (alerts digest, any sendEmail outside a Daily attempt) is not affected by the hold
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { buildSandbox, installSmtp, SMTP, seedWorld, freezeClock, runCron, runManual, captureConsole, sdkTransactions, RECEIPTS, HOLD_PATH,
  releasedHoldRecord, T, B, B2, T2, B3, mkRes } from "../support/daily-email-harness.mjs";
import * as E from "../../lib/emailDelivery.js";

const DAY = Date.parse("2026-09-08T04:05:00Z");          // the Daily cron slot (Israel date 2026-09-08)
const D = "2026-09-08", D2 = "2026-09-09";
let sb, restoreClock;
before(async () => { sb = await buildSandbox(); restoreClock = freezeClock(DAY); });
after(() => restoreClock && restoreClock());
const setNow = (ms) => { Date.now = () => ms; };

const clone = (x) => (x === null || x === undefined ? null : JSON.parse(JSON.stringify(x)));
const held = (version = 3) => ({ ...releasedHoldRecord(), state: "held", version,
  inventory: { schema: 1, generation: '00000000-0000-4000-8000-000000000003', holdVersion: version, revision: 0,
    coverage: 'unverified', decisionProtocol: 'atomic_hold_refusal/1', openedBy: { version, action: 'hold' }, entries: {} }, log: { ...releasedHoldRecord().log,
  ["v" + String(version).padStart(9, "0")]: { action: "hold", state: "held", version, prevVersion: version - 1, actor: "op", reason: "incident", at: 1 } } });
const confirmCurrent = async (db) => { const v = E.deliveryInventoryView(db.read(HOLD_PATH));
  return E.confirmDeliveryInventory(db, { generation: v.generation, digest: v.digest, actor: 'op', reason: 'review exact inventory', nowMs: DAY }); };
const receipts = (db) => clone(db.read(RECEIPTS)) || {};
const receiptOf = (db, t, b, d) => clone(db.read(`${RECEIPTS}/${t}/${b}/${d}`));
const manualRecords = (db) => { const out = []; const r = clone(db.read(E.MANUAL_ATTEMPT_ROOT)) || {}; for (const bs of Object.values(r)) for (const as of Object.values(bs)) for (const x of Object.values(as)) out.push(x); return out; };
/** Script reads of the hold record: fn(readNo) → undefined (real value) | { value } | "throw" | "hang". */
function scriptHold(db, fn) {
  const ref = db.ref; let n = 0;
  db.ref = (p, q) => {
    const x = ref(p, q);
    if (p !== HOLD_PATH) return x;
    return { ...x, once: async (ev) => { n++; const s = fn(n); if (s === "throw") throw new Error("unavailable"); if (s === "hang") return new Promise(() => {}); if (s && "value" in s) return { val: () => clone(s.value), exists: () => s.value !== null }; return x.once(ev); } };
  };
  return () => n;
}
async function cron() { const c = await captureConsole(() => runCron(sb.route)); return c.value; }
async function manual(opts) { const c = await captureConsole(() => runManual(sb.route, opts)); return c.value; }
const changes = sdkTransactions;   // hold / marker / manual-record transactions follow the SDK cold-cache protocol too
function world(opts) { const db = seedWorld(opts); changes(db, "delivery_control"); changes(db, E.MANUAL_ATTEMPT_ROOT); return db; }

test("HR-01 the hold record: only a well-formed, logged released record releases; everything else is held (fail closed)", async () => {
  const rel = releasedHoldRecord();
  assert.deepEqual(E.classifyHoldRecord(rel), { state: "released", code: null, version: 2 });
  assert.deepEqual(E.classifyHoldRecord(held()), { state: "held", code: "delivery_held", version: 3 });
  const bad = {
    absent: null, string: "released", array: [rel], noSchema: { ...rel, schema: undefined }, schema2: { ...rel, schema: 2 },
    versionZero: { ...rel, version: 0 }, versionString: { ...rel, version: "2" }, stateOther: { ...rel, state: "paused" },
    noLog: { ...rel, log: undefined }, logArray: { ...rel, log: [] },
    logLess: { ...rel, version: 3 },                                                         // state changed without a log entry
    entryStateMismatch: { ...rel, log: { ...rel.log, v000000002: { ...rel.log.v000000002, state: "held" } } },
    entryVersionMismatch: { ...rel, log: { ...rel.log, v000000002: { ...rel.log.v000000002, version: 1 } } },
    entryActionMismatch: { ...rel, log: { ...rel.log, v000000002: { ...rel.log.v000000002, action: "hold" } } },
    releasedByInit: { ...rel, version: 1, log: { v000000001: { ...rel.log.v000000001, state: "released" } } },   // init leads to held only
  };
  for (const [k, v] of Object.entries(bad)) assert.deepEqual(E.classifyHoldRecord(v), { state: "held", code: "delivery_hold_unreadable", version: null }, k);
  const db = world();
  assert.deepEqual(await E.readDeliveryHold(db), { state: "released", code: null, version: 2 });
  scriptHold(db, () => "throw");
  assert.deepEqual(await E.readDeliveryHold(db), { state: "held", code: "delivery_hold_unavailable", version: null });
  const db2 = world(); scriptHold(db2, () => "hang");
  const t0 = process.hrtime.bigint();
  assert.deepEqual(await E.readDeliveryHold(db2, { timeoutMs: 30 }), { state: "held", code: "delivery_hold_unavailable", version: null });
  assert.ok(Number(process.hrtime.bigint() - t0) / 1e6 < 2000, "bounded wait");
  const db3 = world({ hold: "absent" });
  assert.equal((await E.readDeliveryHold(db3)).code, "delivery_hold_unreadable");
  // the manual gate and the scheduled gate agree on the record; the scheduled gate also honours the held-date marker
  assert.equal((await E.readManualDeliveryGate(db)).open, false);
  const db4 = world();
  assert.deepEqual(await E.readDailyDeliveryGate(db4, D), { open: true, code: null, version: 2 });
  db4.seed(E.heldDatePath(D), { businessDate: D });
  assert.equal((await E.readDailyDeliveryGate(db4, D)).code, "legacy_evidence_unresolved");
  assert.equal((await E.readDailyDeliveryGate(db4, "not-a-date")).code, "held_day_unverifiable");
  assert.equal((await E.readManualDeliveryGate(db4)).open, true, "a held-date marker does not block an explicit manual send");
});

test("HR-02 hold changes: one transaction per change (state + version + log or nothing); conflicts, no-ops and repairs", async () => {
  const db = world({ hold: "absent" });
  const op = { actor: "op.one", reason: "pilot bootstrap" };
  assert.equal((await E.changeDeliveryHold(db, { action: "hold", ...op, expectVersion: 1 })).code, "not_initialized");
  let r = await E.changeDeliveryHold(db, { action: "init", ...op, nowMs: 10 });
  assert.deepEqual(r, { ok: true, code: "applied", state: "held", version: 1 });
  assert.deepEqual(db.read(HOLD_PATH), { schema: 1, state: "held", version: 1,
    inventory: { schema: 1, generation: db.read(HOLD_PATH).inventory.generation, holdVersion: 1, revision: 0,
      coverage: 'unverified', decisionProtocol: 'atomic_hold_refusal/1', openedBy: { version: 1, action: 'init' }, entries: {} },
    log: { v000000001: { action: "init", state: "held", version: 1, prevVersion: 0, actor: "op.one", reason: "pilot bootstrap", at: 10 } } });
  assert.equal((await E.changeDeliveryHold(db, { action: "init", ...op })).code, "exists", "init never overwrites a well-formed record");
  assert.equal((await E.changeDeliveryHold(db, { action: "release", ...op, expectVersion: 7 })).code, "version_conflict");
  assert.equal((await E.changeDeliveryHold(db, { action: "hold", ...op, expectVersion: 1 })).code, "no_change");
  assert.equal(Object.keys(db.read(HOLD_PATH).log).length, 1, "a refused change writes no log entry");
  assert.equal((await E.changeDeliveryHold(db, { action: "release", ...op, expectVersion: 1, nowMs: 20 })).code, 'inventory_confirmation_required');
  assert.equal((await confirmCurrent(db)).ok, true);
  r = await E.changeDeliveryHold(db, { action: "release", ...op, expectVersion: 1, nowMs: 20 });
  assert.deepEqual([r.ok,r.code,r.state,r.version,r.seal.generation], [true,'applied','released',2,db.read(HOLD_PATH).log.v000000002.seal.generation]);
  r = await E.changeDeliveryHold(db, { action: "hold", actor: "op.two", reason: "wrong totals in report", expectVersion: 2, nowMs: 30 });
  assert.deepEqual([r.code, r.version], ["applied", 3]);
  const rec = db.read(HOLD_PATH);
  assert.deepEqual(Object.keys(rec.log), ["v000000001", "v000000002", "v000000003"]);
  assert.deepEqual(rec.log.v000000003, { action: "hold", state: "held", version: 3, prevVersion: 2, actor: "op.two", reason: "wrong totals in report", at: 30 });
  assert.deepEqual(E.classifyHoldRecord(rec), { state: "held", code: "delivery_held", version: 3 });
  for (const bad of [{ action: "pause" }, { actor: "op one" }, { actor: "" }, { reason: "x" }, { reason: "bad\u0007reason" }, { expectVersion: undefined }])
    assert.equal((await E.changeDeliveryHold(db, { action: "release", ...op, expectVersion: 3, ...bad })).code, "invalid_request", JSON.stringify(bad));
  // a transaction that fails changes nothing
  const before = clone(db.read(HOLD_PATH)); const ref = db.ref;
  db.ref = (p, q) => (p === HOLD_PATH ? { ...ref(p, q), transaction: async () => { throw new Error("disconnected"); } } : ref(p, q));
  assert.equal((await E.changeDeliveryHold(db, { action: "release", ...op, expectVersion: 3 })).code, "transaction_failed");
  db.ref = ref;
  assert.deepEqual(db.read(HOLD_PATH), before);
  // a malformed record (e.g. a direct write that skipped the log): hold / release refuse; init re-creates it HELD with a digest
  db.seed(HOLD_PATH, { ...before, state: "released", version: 4 });
  assert.equal((await E.changeDeliveryHold(db, { action: "release", ...op, expectVersion: 4 })).code, "unreadable_record");
  r = await E.changeDeliveryHold(db, { action: "init", ...op, nowMs: 40 });
  assert.deepEqual([r.code, r.state, r.version], ["applied", "held", 1]);
  assert.match(db.read(HOLD_PATH).log.v000000001.replaced.sha256, /^[0-9a-f]{64}$/);
  // deleting the record holds (it does not release)
  db.seed(HOLD_PATH, null);
  assert.equal((await E.readDeliveryHold(db)).state, "held");
});

test("HR-03 G1: held / absent / malformed / unavailable decisions refuse before any claim; only a committed refusal marks the date", async () => {
  for (const [label, setup, code] of [
    ["held", (db) => db.seed(HOLD_PATH, held()), "delivery_held"],
    ["absent", (db) => db.seed(HOLD_PATH, null), "delivery_hold_unreadable"],
    ["malformed", (db) => db.seed(HOLD_PATH, { schema: 1, state: "released" }), "delivery_hold_unreadable"],
    ["unavailable", (db) => { const ref=db.ref; db.ref=(p,q)=>p===HOLD_PATH?{...ref(p,q),transaction:async()=>{throw Error('down');}}:ref(p,q); }, "delivery_hold_unavailable"],
    ["timed out decision", (db) => { const ref=db.ref; db.ref=(p,q)=>p===HOLD_PATH?{...ref(p,q),transaction:()=>new Promise(()=>{})}:ref(p,q); }, "delivery_hold_unavailable"],
  ]) {
    const db = world(); setup(db); const smtp = installSmtp([SMTP.accept()]);
    const res = await cron();
    assert.equal(res.statusCode, 503, label);
    assert.deepEqual([res.body.status, res.body.code, res.body.businessDate, res.body.results.length], ["held", code, D, 3], label);
    assert.ok(res.body.results.every((row) => row.settlement === "held" && row.receipt === "not_written"), label);
    assert.equal(smtp.calls.length, 0, label + ": no provider call");
    assert.deepEqual(receipts(db), {}, label + ": no receipt, no claim");
    assert.equal(db.read('email_delivery/daily_snapshot_notices'),null,label+': no owner notice');
    assert.equal(db.read(E.heldDatePath(D))?.code ?? null, label === 'held' ? 'delivery_held' : null, label + ': only a committed refusal gets a marker');
  }
  // a held run writes no owner notice either (control: the same world, released, records one for the nameless business)
  const env = (v) => ({ _v: JSON.stringify(v) });
  for (const [label, hold, notices] of [["released (control)", false, 1], ["held", true, 0]]) {
    const db = world(); db.seed(`tenants/${T}/app/business`, env([{ id: B, name: "מסעדה א" }, { id: B2 }]));
    if (hold) db.seed(HOLD_PATH, held());
    installSmtp([SMTP.accept()]);
    await cron();
    const stored = clone(db.read("email_delivery/daily_snapshot_notices")) || {};
    assert.equal(Object.keys(stored[T] || {}).length, notices, label + ": owner notices written");
  }
});

test("HR-04 G0: a hold set during the run — earlier messages delivered, later ones held without a claim; 503 held", async () => {
  const db = world();
  // the provider accepts the FIRST message and the operator holds the Daily while it is being sent
  const smtp = installSmtp([async (mail, call) => { await E.changeDeliveryHold(db, { action: "hold", actor: "op", reason: "hold during run", expectVersion: 2 }); return SMTP.accept()(mail, call); }, SMTP.accept()]);
  const res = await cron();
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.status, "held");
  assert.deepEqual([res.body.successCount, res.body.heldCount, res.body.failureCount, res.body.unknownCount], [1, 2, 0, 0]);
  assert.equal(smtp.calls.length, 1, "nothing after the hold reached the provider");
  const rows = res.body.results;
  const deliveredRow = rows.find((x) => x.settlement === "delivered");
  for (const x of rows.filter((x) => x.settlement === "held")) {
    assert.equal(x.outcome, "held"); assert.equal(x.code, "delivery_held");
    assert.equal(receiptOf(db, x.tenantId, x.bizId, D), null, "G0: no claim written for a held message");
  }
  assert.equal(receiptOf(db, deliveredRow.tenantId, deliveredRow.bizId, D).state, "accepted");
  assert.equal(db.read(E.heldDatePath(D)).stage, "g0");
  // A real hold transition at the second message's decision boundary is durable even if marker storage fails.
  const db2 = world(); const ref = db2.ref; let decisions = 0;
  db2.ref = (p, q) => { const r=ref(p,q);
    if (String(p).startsWith(E.HELD_DATES_ROOT)) return { ...r, transaction: async () => { throw Error('marker down'); } };
    if (p !== HOLD_PATH) return r;
    return { ...r, transaction: async (fn) => {
      if (++decisions === 4) { const saved=db2.ref; db2.ref=ref;
        try { assert.equal((await E.changeDeliveryHold(db2,{ action:'hold',actor:'op',reason:'hold during run',expectVersion:2 })).ok,true); }
        finally { db2.ref=saved; } }
      return r.transaction(fn);
    } };
  };
  const smtp2 = installSmtp([SMTP.accept()]);
  const res2 = await cron();
  assert.equal(smtp2.calls.length, 1, "after one held message no later message of the run reaches the provider");
  assert.deepEqual(res2.body.results.map((x) => x.settlement), ["delivered", "held", "held"]);
  assert.equal(db2.read(E.heldDatePath(D)), null, "the marker could not be written");
  assert.equal(db2.read(HOLD_PATH).refusedDates[D].decision,'committed_hold_refusal');
});

test("HR-05 G3: a hold after the claim and before the hand-off — no provider call; the claim expires at the same attempt", async () => {
  const db = world({ withSecondBiz: false, withSecondTenant: false });
  const ref=db.ref;let switched=false;
  db.ref=(p,q)=>{const r=ref(p,q);if(!String(p).startsWith(RECEIPTS))return r;
    return {...r,transaction:async(fn)=>{const out=await r.transaction(fn);
      if(!switched && out?.snapshot?.val()?.state==='claimed') { switched=true; const saved=db.ref;db.ref=ref;
        try { assert.equal((await E.changeDeliveryHold(db,{action:'hold',actor:'op',reason:'hold before handoff',expectVersion:2})).ok,true); }
        finally {db.ref=saved;} }
      return out;}};};
  const smtp = installSmtp([SMTP.accept()]);
  const res = await cron();
  assert.equal(res.statusCode, 503); assert.equal(res.body.status, "held");
  assert.equal(smtp.calls.length, 0);
  const row = res.body.results[0];
  assert.deepEqual([row.outcome, row.code, row.attempt, row.receipt, row.settlement], ["held", "delivery_held", 1, "recorded", "held"]);
  const rc = receiptOf(db, T, B, D);
  assert.equal(rc.state, "claimed", "no terminal state was written");
  assert.equal(rc.attempt, 1);
  assert.ok(rc.leaseUntil <= Date.now(), "the claim is expired, not held for the lease");
  assert.equal(rc.sendingAt, undefined, "never moved to sending");
  assert.deepEqual(rc.history.at(-1), { attempt: 1, state: "held_before_send", code: "delivery_held", at: Date.now() });
  assert.equal(db.read(E.heldDatePath(D)).stage, "g3");
});

test("HR-06 a hold never consumes the provider-failure budget; provider failures keep their exact semantics", async () => {
  // library level, with an explicit gate: G3 holds three times, then opens; the provider then defers three times
  const db = world();
  const path = E.receiptPath("daily_snapshot", T, B, D);
  let closed = 3;
  const gate = async (stage) => (stage === "g3" && closed > 0 ? (closed--, { open: false, code: "delivery_held" }) : { open: true, code: null });
  const send = () => E.currentDeliveryAttempt().beforeTransport().then(() => { const a = E.currentDeliveryAttempt(); const e = Object.assign(new Error("defer"), { code: "EMESSAGE", response: "421 4.7.0 later", responseCode: 421, command: "DATA" }); a.error = e; throw e; });
  let now = DAY;
  const base = { db, tenantId: T, bizId: B, businessDate: D, recipient: "owner-a@example.test", send, gate, inRunAttempts: 1, clock: () => now, backoffMs: 0, sleep: async () => {} };
  for (let i = 0; i < 3; i++) {
    const r = await E.deliverWithReceipt(base);
    assert.deepEqual([r.outcome, r.attempt], ["held", 1], "held run " + (i + 1));
    now += 1000;
  }
  assert.deepEqual([db.read(path).state, db.read(path).attempt], ["claimed", 1], "three holds: still attempt 1");
  const outcomes = [];
  for (let i = 0; i < 4; i++) { outcomes.push((await E.deliverWithReceipt(base))); now += 1000; }
  assert.deepEqual(outcomes.map((r) => [r.outcome, r.attempt ?? null, r.code]), [["failed", 1, "provider_deferred_421"], ["failed", 2, "provider_deferred_421"], ["failed", 3, "provider_deferred_421"], ["skipped", null, "failed_final"]],
    "after the holds the provider still gets its full MAX_AUTOMATIC_ATTEMPTS");
  assert.equal(E.MAX_AUTOMATIC_ATTEMPTS, 3);
  // a gate that throws, or answers anything but { open: true }, is CLOSED (fail closed): no claim, no provider call
  for (const [label, g] of [["throws", async () => { throw new Error("gate down"); }], ["undefined", async () => undefined], ["open: 'yes'", async () => ({ open: "yes" })]]) {
    const db3 = world(); let sent = 0;
    const r = await E.deliverWithReceipt({ ...base, db: db3, gate: g, send: async () => { sent++; } });
    assert.deepEqual([r.outcome, r.receipt, sent], ["held", "not_written", 0], label);
    assert.equal(db3.read(path), null, label + ": no claim");
  }
  // through the route: three held scheduled runs leave the business date unconsumed (no receipt at all under G1)
  const db2 = world(); db2.seed(HOLD_PATH, held()); const smtp = installSmtp([SMTP.accept()]);
  for (let i = 0; i < 3; i++) assert.equal((await cron()).statusCode, 503);
  assert.deepEqual(receipts(db2), {}); assert.equal(smtp.calls.length, 0);
});

test("HR-07 release sends no held day automatically; the next day is delivered; a manual send after release is the owner's catch-up", async () => {
  const db = world(); db.seed(HOLD_PATH, held(3));
  const smtp = installSmtp([SMTP.accept()]);
  assert.equal((await cron()).body.code, "delivery_held");
  assert.equal((await confirmCurrent(db)).ok, true);
  assert.equal((await E.changeDeliveryHold(db, { action: "release", actor: "op", reason: "fixed", expectVersion: 3 })).code, "applied");
  // a later automatic run for the SAME business date (e.g. a duplicate cron invocation) is held: the day is not backfilled
  const again = await cron();
  assert.deepEqual([again.statusCode, again.body.status, again.body.code], [503, "held", "held_day"]);
  assert.equal(smtp.calls.length, 0, "the held day was not sent after release");
  assert.deepEqual(receipts(db), {});
  // the next business day is delivered normally
  setNow(Date.parse("2026-09-09T04:05:00Z"));
  try {
    const next = await cron();
    assert.deepEqual([next.statusCode, next.body.status, next.body.successCount], [200, "completed", 3]);
    assert.deepEqual(Object.keys(receipts(db)[T][B]), [D2], "only the next day has receipts; the held day has none");
    // a manual send is the owner's explicit choice (not automatic) and is allowed after release
    const m = await manual();
    assert.equal(m.statusCode, 200);
  } finally { setNow(DAY); }
});

test("HR-08 manual send: G2 / G3 holds, the durable attempt record before the hand-off, its finalization, the notice read", async () => {
  // G2: held, absent and unreadable hold refuse before the build
  for (const [label, setup, code] of [["held", (db) => db.seed(HOLD_PATH, held()), "delivery_held"], ["absent", (db) => db.seed(HOLD_PATH, null), "delivery_hold_unreadable"], ["unreadable", (db) => scriptHold(db, () => "throw"), "delivery_hold_unavailable"]]) {
    const db = world(); setup(db); const smtp = installSmtp([SMTP.accept()]);
    const res = await manual();
    assert.deepEqual([res.statusCode, res.body.error, res.body.code], [503, "Daily delivery is held; email not sent", code], label);
    assert.equal(smtp.calls.length, 0); assert.deepEqual(manualRecords(db), [], label + ": no record");
  }
  // G2 refuses BEFORE the build: no business data is read for a held manual request
  { const db = world(); db.seed(HOLD_PATH, held()); const reads = []; const ref = db.ref;
    db.ref = (p, q) => { reads.push(String(p)); return ref(p, q); };
    installSmtp([SMTP.accept()]);
    assert.equal((await manual()).statusCode, 503);
    assert.deepEqual(reads.filter((p) => /:entries|:config|app\/business|app\/users/.test(p)), [], "no snapshot / registry / recipient read: " + reads.join(","));
  }
  // G3: the hold is set after G2 (during the build) — refused at the final boundary, no record, no provider call
  { const db = world(); scriptHold(db, (n) => (n >= 2 ? { value: held() } : undefined)); const smtp = installSmtp([SMTP.accept()]);
    const res = await manual();
    assert.deepEqual([res.statusCode, res.body.code], [503, "delivery_held"]); assert.equal(smtp.calls.length, 0); assert.deepEqual(manualRecords(db), []); }
  // the record cannot be written ⇒ refused before the hand-off
  { const db = world(); const ref = db.ref; db.ref = (p, q) => (String(p).startsWith(E.MANUAL_ATTEMPT_ROOT) ? { ...ref(p, q), transaction: async () => { throw new Error("down"); } } : ref(p, q));
    const smtp = installSmtp([SMTP.accept()]);
    const res = await manual();
    assert.deepEqual([res.statusCode, res.body.code], [503, "manual_record_unavailable"]); assert.equal(smtp.calls.length, 0); }
  // accepted / refused / unknown are each recorded; nothing in the record names the recipient
  for (const [behavior, status, state, code] of [[SMTP.accept(), 200, "accepted", null], [SMTP.rejectRecipient(), 502, "failed", "provider_rejected_550"], [SMTP.closedAfterData(), 504, "unknown", "provider_connection_lost"]]) {
    const db = world(); const smtp = installSmtp([behavior]);
    const res = await manual();
    assert.equal(res.statusCode, status); assert.equal(smtp.calls.length, 1);
    const [rec] = manualRecords(db);
    assert.deepEqual([rec.v, rec.state, rec.code ?? null, rec.kind, rec.tenantId, rec.bizId, rec.businessDate, rec.actorRole, rec.recipientSelection], [E.MANUAL_ATTEMPT_VERSION, state, code, "daily_snapshot", T, B, D, "owner", "owner"]);
    assert.equal(rec.messageIdHeader, smtp.calls[0].messageIdHeader, "the record names the Message-ID that was handed over");
    assert.ok(!JSON.stringify(rec).includes("owner-a@example.test"), "no recipient address in the record");
  }
  // finalization fails ⇒ the record stays handing_off (unresolved for a drain), the response still reports the provider outcome
  { const db = world(); const ref = db.ref; let n = 0;
    db.ref = (p, q) => { const x = ref(p, q); return String(p).startsWith(E.MANUAL_ATTEMPT_ROOT) ? { ...x, transaction: async (fn) => { if (++n >= 2) throw new Error("lost"); return x.transaction(fn); } } : x; };
    installSmtp([SMTP.accept()]);
    const res = await manual();
    assert.equal(res.statusCode, 200);
    assert.equal(manualRecords(db)[0].state, "handing_off"); }
  // the notice read is unaffected by the hold
  { const db = world(); db.seed(HOLD_PATH, held());
    process.env.SMTP_EMAIL = "sender@example.test"; process.env.SMTP_APP_PASSWORD = "x";
    globalThis.__DE = { requireAuth: async () => ({ uid: "u_owner_a", email: "owner-a@example.test" }) };
    const res = mkRes(); await sb.route({ method: "POST", headers: { authorization: "Bearer user-token" }, query: {}, body: { tenantId: T, bizId: B, action: "notice" } }, res);
    assert.equal(res.statusCode, 200); assert.equal(res.body.status, "ok"); }
});

test("HR-09 concurrent hold / send activity: every message is delivered at most once or held; concurrent runs still send once", async () => {
  const seen = { held: 0, delivered: 0 };
  for (let i = 0; i < 6; i++) {
    const db = world(); const smtp = installSmtp([async (m, c) => { await new Promise((r) => setTimeout(r, 2)); return SMTP.accept()(m, c); }]);
    const [a, b] = await Promise.all([cron(), (async () => { await new Promise((r) => setTimeout(r, i)); return E.changeDeliveryHold(db, { action: "hold", actor: "op", reason: "race test", expectVersion: 2 }); })()]);
    assert.equal(b.code, "applied");
    const delivered = a.body.results ? a.body.results.filter((x) => x.settlement === "delivered").length : 0;
    assert.equal(smtp.calls.length, delivered, "a provider call is a delivered message (nothing was handed over after a hold refused it)");
    const sentTo = smtp.calls.map((c) => c.messageIdHeader);
    assert.equal(new Set(sentTo).size, sentTo.length, "no message twice");
    for (const x of a.body.results || []) if (x.settlement === "held") { const rc = receiptOf(db, x.tenantId, x.bizId, D); assert.ok(rc === null || (rc.state === "claimed" && rc.attempt === 1)); }
    seen.held += a.body.results ? a.body.results.filter((x) => x.settlement === "held").length + (a.body.status === "held" && a.body.results.length === 0 ? 1 : 0) : 0;
    seen.delivered += delivered;
  }
  assert.ok(seen.held > 0 && seen.delivered > 0, "non-vacuous: the races produced both delivered and held messages " + JSON.stringify(seen));
  // two concurrent invocations while released: each message sent exactly once (the receipt protection is intact)
  const db = world(); const smtp = installSmtp([async (m, c) => { await new Promise((r) => setTimeout(r, 3)); return SMTP.accept()(m, c); }]);
  const [r1, r2] = await Promise.all([cron(), cron()]);
  assert.equal(smtp.calls.length, 3);
  assert.equal(new Set(smtp.calls.map((c) => c.to + "|" + c.subject)).size, smtp.calls.length);
  assert.ok([r1.statusCode, r2.statusCode].includes(200) || [r1, r2].every((r) => r.statusCode === 503 && r.body.status === "incomplete"));
});

test("HR-10 interrupted and unknown attempts stay held for reconciliation across hold / release", async () => {
  const db = world({ withSecondBiz: false, withSecondTenant: false });
  installSmtp([SMTP.closedAfterData()]);
  const first = await cron();
  assert.equal(first.body.results[0].settlement, "unknown");
  assert.equal(receiptOf(db, T, B, D).state, "unknown");
  // a hold and a release do not touch the receipt; a later run (no run happened during the hold) still never re-sends it
  assert.equal((await E.changeDeliveryHold(db, { action: "hold", actor: "op", reason: "check unknown", expectVersion: 2 })).code, "applied");
  assert.equal((await confirmCurrent(db)).ok, true);
  assert.equal((await E.changeDeliveryHold(db, { action: "release", actor: "op", reason: "resume", expectVersion: 3 })).code, "applied");
  const smtp = installSmtp([SMTP.accept()]);
  const again = await cron();
  assert.equal(again.body.results[0].code, "unknown_requires_reconciliation");
  assert.equal(receiptOf(db, T, B, D).state, "unknown", "the existing unknown receipt is not changed by release");
  assert.equal(smtp.calls.length, 0);
  // an invocation lost while sending: the hold leaves it `sending`; after the lease a run converts it to unknown, never re-sends
  const db2 = world({ withSecondBiz: false, withSecondTenant: false });
  db2.seed(`${RECEIPTS}/${T}/${B}/${D}`, { v: E.RECEIPT_VERSION, kind: "daily_snapshot", tenantId: T, bizId: B, businessDate: D, state: "sending", claimId: "c-lost", attempt: 1, leaseUntil: DAY - 1, recipientHash: "x", history: [] });
  const smtp2 = installSmtp([SMTP.accept()]);
  const r = await cron();
  assert.equal(r.body.results[0].code, "unknown_requires_reconciliation");
  assert.equal(receiptOf(db2, T, B, D).state, "unknown"); assert.equal(smtp2.calls.length, 0);
});

test("HR-11 other e-mail is not affected by the hold (alerts digest, any sendEmail outside a Daily attempt)", async () => {
  const db = world(); db.seed(HOLD_PATH, held());
  const smtp = installSmtp([SMTP.accept()]);
  process.env.SMTP_EMAIL = "sender@example.test"; process.env.SMTP_APP_PASSWORD = "fixture-app-password-not-real";
  const mail = await sb.import("lib/sendEmail.js");
  await captureConsole(() => mail.sendAlertDigest("owner-a@example.test", "מסעדה א", [{ severity: "warning", title: "t", message: "m" }]));
  await captureConsole(() => mail.sendEmail("invitee@example.test", "invite", "<p>x</p>"));
  assert.equal(smtp.calls.length, 2, "both non-Daily messages reached the provider while the Daily is held");
});
