// DP2 — owner decision P4 extended (2026-10-17): for one exact (tenant, business, business date) no second provider hand-off
// across the scheduled AND manual routes, including concurrent attempts. Through the REAL route api/daily-snapshot/run.ts
// (GET cron and POST manual) and lib/emailDelivery.js (test/support/daily-email-harness.mjs: only the database, the token
// verifier and the SMTP provider are replaced; no network, no real e-mail). Every case counts provider hand-offs.
//   DP2-01  DP1 gap 1: a scheduled delivery that completes INSIDE the manual send's check window (a barrier at the manual
//           send's first manual-side transaction, and inside the admission transaction's guess-first protocol)
//   DP2-02  DP1 gap 2: a scheduled run AFTER an earlier first-time manual send of the same business date
//   DP2-03  the scheduled hand-off in progress ⇒ the manual send is refused; after acceptance it is a repeat
//   DP2-04  the manual hand-off in progress ⇒ the scheduled row is pending; after acceptance a re-run is delivered, not re-sent
//   DP2-05  outcomes: unknown blocks both routes; a definitive non-acceptance re-admits under the existing retry contract;
//           the scheduled in-run retry after a definitive transient refusal is preserved
//   DP2-06  process interruption: a holder that stops after taking the admission (before or after the hand-off) blocks both
//           routes — in progress during its lease, unresolved after it; it is never released or reclassified as non-acceptance
//   DP2-07  concurrency: three scheduled invocations and three manual sends at once ⇒ exactly one hand-off (plain and
//           guess-first transactions)
//   DP2-08  preserved: first-time scheduled and manual delivery; scheduled/scheduled de-duplication; no scheduled receipt for a
//           manual send; E4 and the hold refuse before any admission is taken
//   DP2-09  missing / malformed shared evidence fails closed; exact identity separation
//   DP2-10  decideAdmission: the pure decision table
//   DP2-11  the operator evidence report reads the admissions: in-flight work is visible and keeps the report from completing
//   DP2-12  preserved behaviour, statuses and hand-off counts only (green on DP1 and DP2)
//   DP2-13  evidence written before the admission existed (both routes, no admission trace); a settlement never overwrites a
//           state it does not hold
import { test } from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { buildSandbox, installSmtp, SMTP, seedWorld, freezeClock, runCron, runManual, sdkTransactions, RECEIPTS, REPO, T, B, B2, T2 } from "../support/daily-email-harness.mjs";

const { route } = await buildSandbox();
const E = await import(pathToFileURL(REPO + "/lib/emailDelivery.js").href);
const AT = Date.UTC(2026, 8, 8, 4, 5), EARLY = Date.UTC(2026, 8, 8, 3, 0), LATER = AT + 11 * 60_000;   // 07:05 / 06:00 / 07:16 Israel
const DATE = "2026-09-08", OTHER_DATE = "2026-09-09";
const ADM = "email_delivery_admission/daily_snapshot";
const db = () => globalThis.__DB;
const receipt = (t = T, b = B, d = DATE) => db().read(`${RECEIPTS}/${t}/${b}/${d}`);
const admission = (t = T, b = B, d = DATE) => db().read(`${ADM}/${t}/${b}/${d}`);
const records = (t = T, b = B) => db().read(`email_delivery_manual/${t}/${b}`);
async function at(ms, fn) { const restore = freezeClock(ms); try { return await fn(); } finally { restore(); } }
const cron = (ms = AT) => at(ms, () => runCron(route));
const manual = (ms = AT, o) => at(ms, () => runManual(route, o));
const refusal = (res) => [res.statusCode, res.body && res.body.code];
const one = () => seedWorld({ withSecondBiz: false, withSecondTenant: false });
const row = (res) => res.body.results.find((x) => x.tenantId === T && x.bizId === B);
/** a provider that holds every hand-off until release(); `entered` resolves when the first one arrives */
function heldProvider() {
  let release, entered; const gate = new Promise((r) => { release = r; }); const arrived = new Promise((r) => { entered = r; });
  const behavior = () => async (mail, call) => { entered(); await gate; return { messageId: mail.messageId, accepted: [mail.to], rejected: [], response: "250 2.0.0 OK" }; };
  return { behavior, release: () => release(), arrived };
}
/** wrap the store: the FIRST transaction on a manual-side path (manual records or the admission) runs `between` first */
function barrierAtFirstManualTransaction(w, between, { guessFirst = false } = {}) {
  const ref = w.ref; let armed = true;
  w.ref = (p, q) => {
    const x = ref(p, q);
    if (!armed || !(String(p).startsWith("email_delivery_manual/") || String(p).startsWith(ADM + "/"))) return x;
    return { ...x, transaction: async (fn) => {
      armed = false;
      if (guessFirst) {   // the SDK protocol: decide on the cached guess, then commit against the server value (re-run on mismatch)
        const guess = null, first = fn(guess);
        await between();
        const server = w.read(p);
        if (JSON.stringify(server) === JSON.stringify(guess) && first !== undefined) return x.transaction(() => first);
        return x.transaction(fn);
      }
      await between();
      return x.transaction(fn);
    } };
  };
}

test("DP2-01 DP1 gap 1: a scheduled delivery completing inside the manual send's window — one hand-off, the manual send refused", { timeout: 30_000 }, async () => {
  for (const guessFirst of [false, true]) {
    const w = one(); const smtp = installSmtp([SMTP.accept()]);
    let cronRes = null;
    barrierAtFirstManualTransaction(w, async () => { cronRes = await runCron(route); }, { guessFirst });
    const m = await manual();
    assert.equal(cronRes.statusCode, 200, JSON.stringify(cronRes.body));
    assert.equal(smtp.calls.length, 1, `exactly one hand-off (guessFirst=${guessFirst}): ` + JSON.stringify(smtp.calls.map((c) => c.messageIdHeader)));
    assert.match(smtp.calls[0].messageIdHeader, /^<daily_snapshot\.1\./, "the scheduled message is the one handed over");
    assert.deepEqual(refusal(m), [409, "manual_repeat_not_permitted"], JSON.stringify(m.body));
    assert.deepEqual([receipt().state, admission().state, admission().route], ["accepted", "accepted", "scheduled"]);
    assert.equal(records(), null, "the refused manual send wrote no record");
  }
});

test("DP2-02 DP1 gap 2: a scheduled run after an earlier first-time manual send of the same date is delivered without a second hand-off", { timeout: 30_000 }, async () => {
  one(); const smtp = installSmtp([SMTP.accept()]);
  assert.equal((await manual(EARLY)).statusCode, 200);
  const c = await cron();
  assert.equal(smtp.calls.length, 1, "the manual message only: " + JSON.stringify(smtp.calls.map((x) => x.messageIdHeader)));
  assert.deepEqual([c.statusCode, c.body.status, row(c).outcome, row(c).code, row(c).settlement], [200, "completed", "skipped", "delivery_already_accepted", "delivered"]);
  assert.deepEqual([admission().state, admission().route], ["accepted", "manual"]);
  const r = receipt();
  assert.deepEqual([r.state, r.attempt, r.history.at(-1).state, r.history.at(-1).code], ["claimed", 1, "admission_refused", "delivery_already_accepted"],
    "the scheduled claim is expired at the same attempt; no scheduled acceptance is fabricated");
  assert.ok(r.leaseUntil <= AT, "the claim is expired");
  const again = await cron(LATER);
  assert.deepEqual([row(again).code, row(again).settlement, smtp.calls.length], ["delivery_already_accepted", "delivered", 1], "a re-run is still not re-sent");
});

test("DP2-03 a scheduled hand-off in progress refuses the manual send; after acceptance the manual send is a repeat", { timeout: 30_000 }, async () => {
  one(); const p = heldProvider(); const smtp = installSmtp([p.behavior()]);
  const running = cron();
  await p.arrived;
  const m = await manual();
  assert.deepEqual(refusal(m), [409, "delivery_in_progress"]);
  assert.equal(smtp.calls.length, 1);
  p.release(); assert.equal((await running).statusCode, 200);
  assert.deepEqual(refusal(await manual()), [409, "manual_repeat_not_permitted"]);
  assert.equal(smtp.calls.length, 1);
});

test("DP2-04 a manual hand-off in progress makes the scheduled row pending (no hand-off); after acceptance a re-run is delivered", { timeout: 30_000 }, async () => {
  one(); const p = heldProvider(); const smtp = installSmtp([p.behavior()]);
  const running = manual();
  await p.arrived;
  const c = await cron();
  assert.deepEqual([c.statusCode, c.body.status, row(c).code, row(c).settlement], [503, "incomplete", "delivery_in_progress", "pending"]);
  assert.equal(smtp.calls.length, 1);
  p.release(); assert.equal((await running).statusCode, 200);
  const again = await cron(LATER);
  assert.deepEqual([again.statusCode, row(again).code, row(again).settlement, smtp.calls.length], [200, "delivery_already_accepted", "delivered", 1]);
});

test("DP2-05 outcomes: unknown blocks both routes; a definitive non-acceptance re-admits; the scheduled in-run retry is preserved", { timeout: 30_000 }, async () => {
  // a manual unknown blocks the scheduled route (no hand-off), and a scheduled unknown blocks the manual route
  one(); let smtp = installSmtp([SMTP.closedAfterData()]);
  assert.equal((await manual()).statusCode, 504);
  smtp = installSmtp([SMTP.accept()]);
  let c = await cron();
  assert.deepEqual([c.statusCode, row(c).code, row(c).settlement, smtp.calls.length], [500, "delivery_outcome_unresolved", "unknown", 0]);
  assert.equal(admission().state, "unknown", "never reclassified");
  one(); smtp = installSmtp([SMTP.closedAfterData()]);
  assert.equal((await cron()).statusCode, 500);
  smtp = installSmtp([SMTP.accept()]);
  assert.deepEqual(refusal(await manual()), [409, "delivery_outcome_unresolved"]);
  assert.equal(smtp.calls.length, 0);
  // a definitive manual refusal is not a delivery: the scheduled route re-admits and sends; the failed holder stays in the history
  one(); smtp = installSmtp([SMTP.rejectRecipient(), SMTP.accept()]);
  assert.equal((await manual()).statusCode, 502);
  c = await cron();
  assert.deepEqual([c.statusCode, row(c).outcome, smtp.calls.length], [200, "accepted", 2]);
  assert.deepEqual([admission().state, admission().route, admission().history.map((h) => [h.route, h.state, h.code])], ["accepted", "scheduled", [["manual", "failed", "provider_rejected_550"]]]);
  // a definitive scheduled refusal: the manual send is an ordinary first-time send
  one(); smtp = installSmtp([SMTP.rejectRecipient(), SMTP.accept()]);
  assert.equal((await cron()).statusCode, 500);
  assert.equal((await manual()).statusCode, 200);
  assert.equal(smtp.calls.length, 2);
  // the scheduled in-run retry after a definitive transient refusal (existing budget), one admission per attempt
  one(); smtp = installSmtp([SMTP.transient(), SMTP.accept()]);
  c = await cron();
  assert.deepEqual([c.statusCode, row(c).attempt, smtp.calls.length], [200, 2, 2]);
  assert.deepEqual([admission().state, admission().attempt, admission().history.map((h) => [h.attempt, h.code])], ["accepted", 2, [[1, "provider_deferred_421"]]]);
});

test("DP2-06 process interruption: a holder that stopped is never released — in progress during its lease, unresolved after it", { timeout: 30_000 }, async () => {
  // (a) a manual send stops after taking the admission, before its record exists (the record transaction never returns)
  const w = one(); const smtp = installSmtp([SMTP.accept()]); const ref = w.ref;
  w.ref = (p, q) => (String(p).startsWith("email_delivery_manual/") ? { ...ref(p, q), transaction: () => new Promise(() => {}) } : ref(p, q));
  manual();   // abandoned: the process is gone
  await new Promise((r) => setTimeout(r, 50));
  w.ref = ref;
  assert.deepEqual([admission().state, admission().route, records()], ["in_flight", "manual", null]);
  let c = await cron();
  assert.deepEqual([row(c).code, row(c).settlement, smtp.calls.length], ["delivery_in_progress", "pending", 0]);
  c = await cron(LATER);
  assert.deepEqual([row(c).code, row(c).settlement, smtp.calls.length], ["delivery_outcome_unresolved", "unknown", 0]);
  assert.deepEqual(refusal(await manual(LATER)), [409, "delivery_outcome_unresolved"]);
  assert.equal(admission().state, "in_flight", "never released, settled or reclassified");
  // (b) a scheduled invocation stops after the hand-off (the provider never answers)
  one(); const p = heldProvider(); const s2 = installSmtp([p.behavior()]);
  cron();   // abandoned
  await p.arrived;
  assert.deepEqual(refusal(await manual()), [409, "delivery_in_progress"]);
  assert.deepEqual(refusal(await manual(LATER)), [409, "delivery_outcome_unresolved"]);
  const later = await cron(LATER);
  assert.equal(row(later).settlement, "unknown", "the receipt's lost-while-sending conversion still applies");
  assert.equal(s2.calls.length, 1);
});

test("DP2-07 concurrency: three scheduled invocations and three manual sends of one identity at once — exactly one hand-off", { timeout: 30_000 }, async () => {
  for (const guessFirst of [false, true]) {
    const w = one(); if (guessFirst) sdkTransactions(w, ADM);
    const smtp = installSmtp([SMTP.accept()]);
    const all = await at(AT, () => Promise.all([runCron(route), runManual(route), runCron(route), runManual(route), runCron(route), runManual(route)]));
    assert.equal(smtp.calls.length, 1, `guessFirst=${guessFirst}: ` + JSON.stringify(all.map((r) => [r.statusCode, r.body.code ?? r.body.status])));
    assert.equal(admission().state, "accepted");
    const manualOk = all.filter((r, i) => i % 2 === 1 && r.statusCode === 200).length;
    const scheduledSent = all.filter((r, i) => i % 2 === 0).map(row).filter((x) => x.outcome === "accepted").length;
    assert.equal(manualOk + scheduledSent, 1);
  }
});

test("DP2-08 preserved: first-time delivery on both routes, scheduled de-duplication, no fabricated receipt; E4 / hold before any admission", { timeout: 30_000 }, async () => {
  seedWorld(); let smtp = installSmtp([SMTP.accept()]);
  const c = await cron();
  assert.deepEqual([c.statusCode, c.body.successCount, smtp.calls.length], [200, 3, 3]);
  for (const [t, b] of [[T, B], [T, B2], [T2, "bizC"]]) assert.deepEqual([admission(t, b).state, admission(t, b).route], ["accepted", "scheduled"]);
  const dup = await cron();
  assert.deepEqual([dup.statusCode, dup.body.alreadyAcceptedCount, smtp.calls.length], [200, 3, 3]);
  one(); smtp = installSmtp([SMTP.accept()]);
  const m = await manual();
  assert.deepEqual([m.statusCode, m.body.delivery], [200, { outcome: "accepted", recipient: "server_configured" }]);
  assert.equal(receipt(), null, "a manual send writes no scheduled receipt");
  assert.deepEqual([admission().state, admission().route, Object.values(records())[0].state], ["accepted", "manual", "accepted"]);
  // E4: a refused business date is refused on both routes before any admission
  one(); db().seed(E.heldDatePath(DATE), { businessDate: DATE, committedRefusal: { decision: "committed_hold_refusal",
    generation: "00000000-0000-4000-8000-000000000001", intent: "00000000-0000-4000-8000-000000000002", holdVersion: 1 } });
  smtp = installSmtp([SMTP.accept()]);
  assert.deepEqual(refusal(await manual()), [409, "held_day"]);
  const h = await cron();
  assert.deepEqual([h.statusCode, h.body.code], [503, "held_day"]);
  assert.deepEqual([smtp.calls.length, admission()], [0, null]);
  // the held Daily: refused before the build / before any claim, no admission
  seedWorld({ hold: "absent" }); smtp = installSmtp([SMTP.accept()]);
  assert.equal((await manual()).statusCode, 503); assert.equal((await cron()).statusCode, 503);
  assert.deepEqual([smtp.calls.length, db().read("email_delivery_admission")], [0, null]);
});

test("DP2-09 missing / malformed shared evidence fails closed; only the exact identity blocks", { timeout: 30_000 }, async () => {
  const good = (state, extra = {}) => ({ v: E.ADMISSION_VERSION, kind: "daily_snapshot", tenantId: T, bizId: B, businessDate: DATE, state, route: "manual", ref: "a0000000-0000-4000-8000-000000000001", attempt: 1, ...extra });
  for (const [name, value] of [["another version", good("accepted", { v: "MARJIN_DELIVERY_ADMISSION/0" })], ["another tenant inside", good("accepted", { tenantId: T2 })],
    ["an unknown state", good("released")], ["in_flight without a lease", good("in_flight")], ["not a record", "accepted"], ["an unknown route", good("failed", { route: "replay" })]]) {
    one(); db().seed(`${ADM}/${T}/${B}/${DATE}`, value); const smtp = installSmtp([SMTP.accept()]);
    assert.deepEqual(refusal(await manual()), [422, "delivery_admission_unreadable"], name);
    const c = await cron();
    assert.deepEqual([row(c).code, row(c).settlement, smtp.calls.length], ["delivery_admission_unreadable", "failed", 0], name);
  }
  // a store that cannot run the admission transaction
  const w = one(); const ref = w.ref; const smtp = installSmtp([SMTP.accept()]);
  w.ref = (p, q) => (String(p).startsWith(ADM + "/") ? { ...ref(p, q), transaction: async () => { throw new Error("unavailable"); } } : ref(p, q));
  assert.deepEqual(refusal(await manual()), [503, "delivery_admission_unavailable"]);
  assert.deepEqual([row(await cron()).code, smtp.calls.length], ["delivery_admission_unavailable", 0]);
  // identity separation: an accepted admission of another date, business, or the same business id in another tenant blocks nothing
  for (const p of [`${ADM}/${T}/${B}/${OTHER_DATE}`, `${ADM}/${T}/${B2}/${DATE}`, `${ADM}/${T2}/${B}/${DATE}`]) {
    one(); const [, , , t, b, d] = p.split("/"); db().seed(p, good("accepted", { tenantId: t, bizId: b, businessDate: d })); const s = installSmtp([SMTP.accept()]);
    assert.equal((await manual()).statusCode, 200, p);
    assert.equal(s.calls.length, 1, p);
  }
});

test("DP2-10 decideAdmission: the pure decision table", { timeout: 30_000 }, () => {
  const ids = { kind: "daily_snapshot", tenantId: T, bizId: B, businessDate: DATE };
  const d = (cur, extra = {}) => E.decideAdmission(cur, { route: "manual", ref: "r1", nowMs: AT, ids, ...extra });
  // DP3 (T-DP3-TEST-EXPECTATIONS): the stored values carry every field their writer produces (admit: since / updatedAt;
  // settle: settledAt, and the code of a failure) — a partial record is unreadable since DP3 (DP2-R02)
  const rec = (state, extra = {}) => ({ v: E.ADMISSION_VERSION, ...ids, state, route: "scheduled", ref: "c1", attempt: 1, since: AT - 100, updatedAt: AT - 50,
    ...(state === "in_flight" ? {} : { settledAt: AT - 50 }), ...extra });
  assert.deepEqual(d(null).result, { admitted: true });
  assert.deepEqual([d(null).next.state, d(null).next.route, d(null).next.ref, d(null).next.leaseUntil], ["in_flight", "manual", "r1", AT + E.CLAIM_LEASE_MS]);
  assert.deepEqual(d(rec("accepted")).result, { admitted: false, code: "delivery_already_accepted" });
  assert.deepEqual(d(rec("unknown")).result, { admitted: false, code: "delivery_outcome_unresolved" });
  assert.deepEqual(d(rec("in_flight", { leaseUntil: AT + 1 })).result, { admitted: false, code: "delivery_in_progress" });
  assert.deepEqual(d(rec("in_flight", { leaseUntil: AT })).result, { admitted: false, code: "delivery_outcome_unresolved" });
  const again = d(rec("failed", { code: "provider_rejected_550", settledAt: AT - 5 }));
  assert.deepEqual([again.result, again.next.history], [{ admitted: true }, [{ route: "scheduled", ref: "c1", attempt: 1, state: "failed", code: "provider_rejected_550", at: AT - 5 }]]);
  for (const bad of [rec("accepted", { kind: "other" }), rec("accepted", { businessDate: OTHER_DATE }), rec("failed", { history: {} }), [], 7])
    assert.deepEqual(d(bad).result, { admitted: false, code: "delivery_admission_unreadable" }, JSON.stringify(bad));
  assert.deepEqual(d(null, { route: "replay" }).result, { admitted: false, code: "delivery_admission_unreadable" });
  assert.equal(E.admissionPath("daily_snapshot", T, B, DATE), `${ADM}/${T}/${B}/${DATE}`);
  for (const [t, b, x] of [[" " + T, B, DATE], [T, "a:b", DATE], [T, B, "2026-9-8"], ["a/b", B, DATE]]) assert.equal(E.admissionPath("daily_snapshot", t, b, x), t === " " + T ? `${ADM}/ ${T}/${B}/${DATE}` : null);
});

test("DP2-11 the drain evidence report sees the shared admissions: live / expired / unknown / unreadable, never quiescence", { timeout: 30_000 }, async () => {
  const Tool = await import(pathToFileURL(REPO + "/tools/daily-delivery/hold.mjs").href);
  const NOW = AT, held = { ...E.classifyHoldRecord(null) };
  const holdRaw = { schema: 1, state: "held", version: 1, log: { v000000001: { action: "init", state: "held", version: 1, prevVersion: 0, actor: "op", reason: "evidence check", at: NOW - 10 * 3_600_000 } } };
  const base = { holdRaw, receiptsRaw: null, manualRaw: null, nowMs: NOW, maxDurationMs: 300000, inventoryAttested: true, logsAttested: true, invocationReceiptAttested: true, providerAttested: true };
  // DP3 (T-DP3-TEST-EXPECTATIONS): complete writer-shaped admissions (a partial one is unreadable since DP3, DP2-R03)
  const adm = (state, route, extra = {}) => ({ v: E.ADMISSION_VERSION, kind: "daily_snapshot", tenantId: "t1", bizId: "b1", businessDate: DATE, state, route, ref: "r1", attempt: 1,
    since: NOW - 100, updatedAt: NOW - 50, ...(state === "in_flight" ? {} : { settledAt: NOW - 50 }), ...extra });
  const tree = (x) => ({ t1: { b1: { [DATE]: x } } });
  assert.equal(held.state, "held");
  assert.equal(Tool.drainEvidence(base).verdict, "EVIDENCE_COMPLETE_FOR_OWNER_REVIEW", "control: no admission");
  const cases = [
    ["live manual", adm("in_flight", "manual", { leaseUntil: NOW + 1 }), "C2_no_live_scheduled_claim", "live"],
    ["live scheduled", adm("in_flight", "scheduled", { leaseUntil: NOW + 1 }), "C2_no_live_scheduled_claim", "live"],
    ["expired manual", adm("in_flight", "manual", { leaseUntil: NOW - 1 }), "C3_no_manual_attempt_handing_off", "inFlightExpired"],
    ["unreadable", adm("in_flight", "manual"), "C2_no_live_scheduled_claim", "unreadable"],
  ];
  for (const [name, x, criterion, list] of cases) {
    const r = Tool.drainEvidence({ ...base, admissionRaw: tree(x) });
    assert.deepEqual([r.verdict, r.criteria[criterion], r.admissions[list].length], ["ABORT_D", "not_met", 1], name);
    assert.doesNotMatch(JSON.stringify(r), /QUIESCENT|DRAINED|nothing sent/i);
  }
  // an expired scheduled holder and an unknown outcome are P7 population, reported, not hidden (like an expired `sending` / `unknown` receipt)
  for (const [x, list] of [[adm("in_flight", "scheduled", { leaseUntil: NOW - 1 }), "inFlightExpired"], [adm("unknown", "manual", { code: "provider_connection_lost" }), "unknown"]]) {
    const r = Tool.drainEvidence({ ...base, admissionRaw: tree(x) });
    assert.deepEqual([r.admissions[list].map((y) => y.id), r.criteria.C2_no_live_scheduled_claim, r.criteria.C3_no_manual_attempt_handing_off], [[`t1/b1/${DATE}`], "met", "met"]);
  }
  // the CLI reads the admission tree (a store whose admission read fails aborts the report)
  const store = (fail) => ({ ref: (p) => ({ once: async () => { if (fail && p.startsWith("email_delivery_admission")) throw new Error("x"); return { val: () => (p === E.DELIVERY_HOLD_PATH ? holdRaw : p === `${ADM}` ? tree(adm("in_flight", "manual", { leaseUntil: NOW + 1 })) : null) }; } }) });
  const run = (fail) => Tool.runCommand(store(fail), "evidence", Tool.parseArgs(["evidence", "--max-duration-ms=300000", "--inventory-attested", "--logs-attested", "--invocation-receipt-attested", "--provider-attested"]), { project: "demo-marjin-rules", nowMs: NOW });
  const ok = await run(false), bad = await run(true);
  assert.deepEqual([ok.exitCode, ok.result.criteria.C2_no_live_scheduled_claim, ok.result.admissions.live.length], [5, "not_met", 1]);
  assert.deepEqual([bad.exitCode, bad.result.error], [5, "evidence_read_unavailable"]);
});

test("DP2-12 preserved behaviour (statuses and hand-off counts only; the same on DP1 and DP2)", { timeout: 30_000 }, async () => {
  seedWorld(); let smtp = installSmtp([SMTP.accept()]);
  assert.deepEqual([(await cron()).statusCode, smtp.calls.length], [200, 3], "first-time scheduled delivery");
  assert.deepEqual([(await cron()).body.alreadyAcceptedCount, smtp.calls.length], [3, 3], "scheduled / scheduled: no re-send");
  assert.deepEqual(refusal(await manual()), [409, "manual_repeat_not_permitted"], "scheduled → manual (DP1)");
  one(); smtp = installSmtp([SMTP.accept()]);
  const m = await manual();
  assert.deepEqual([m.statusCode, smtp.calls.length, receipt()], [200, 1, null], "first-time manual delivery, no scheduled receipt");
  assert.deepEqual(refusal(await manual()), [409, "manual_repeat_not_permitted"], "manual / manual (DP1)");
  one(); smtp = installSmtp([SMTP.rejectRecipient(), SMTP.accept()]);
  assert.equal((await manual()).statusCode, 502);
  assert.deepEqual([(await manual()).statusCode, smtp.calls.length], [200, 2], "a definitive non-acceptance is not a delivery");
  one(); db().seed(E.heldDatePath(DATE), { businessDate: DATE, committedRefusal: { decision: "committed_hold_refusal",
    generation: "00000000-0000-4000-8000-000000000001", intent: "00000000-0000-4000-8000-000000000002", holdVersion: 1 } });
  smtp = installSmtp([SMTP.accept()]);
  assert.deepEqual([refusal(await manual()), (await cron()).body.code, smtp.calls.length], [[409, "held_day"], "held_day", 0], "E4 on both routes");
});

test("DP2-13 evidence written before the admission existed decides while no admission exists; a holder's settlement never overwrites another state", { timeout: 30_000 }, async () => {
  const legacyManual = (state) => ({ v: E.MANUAL_ATTEMPT_VERSION, attemptId: "a0000000-0000-4000-8000-000000000009", kind: "daily_snapshot", tenantId: T, bizId: B,
    businessDate: DATE, state, messageIdHeader: "<manual.legacy@delivery.marjin.app>", startedAt: AT - 9000, updatedAt: AT - 9000, ...(state === "handing_off" ? {} : { settledAt: AT - 8000 }),
    ...(state === "failed" ? { code: "provider_rejected_550" } : {}) });   // DP3: a failed record names its refusal, as its writer does
  // a pre-DP2 manual acceptance (no admission): the scheduled run does not send it again, and leaves no admission trace
  for (const [state, code, settlement] of [["accepted", "delivery_already_accepted", "delivered"], ["handing_off", "delivery_outcome_unresolved", "unknown"], ["unknown", "delivery_outcome_unresolved", "unknown"]]) {
    one(); db().seed(`email_delivery_manual/${T}/${B}/a0000000-0000-4000-8000-000000000009`, legacyManual(state)); const smtp = installSmtp([SMTP.accept()]);
    const c = await cron();
    assert.deepEqual([row(c).code, row(c).settlement, smtp.calls.length, admission()], [code, settlement, 0, null], state);
  }
  // a pre-DP2 scheduled outcome (no admission): the manual send is refused before any admission is taken
  for (const [state, extra, code] of [["accepted", {}, "manual_repeat_not_permitted"], ["unknown", {}, "delivery_outcome_unresolved"], ["sending", { leaseUntil: AT + 60_000 }, "delivery_outcome_unresolved"]]) {
    one(); db().seed(`${RECEIPTS}/${T}/${B}/${DATE}`, { v: "MARJIN_EMAIL_RECEIPT/1", kind: "daily_snapshot", tenantId: T, bizId: B, businessDate: DATE, state,
      claimId: "c0000000-0000-4000-8000-000000000009", attempt: 1, recipientHash: "0".repeat(64), updatedAt: AT - 9000, ...extra });
    const smtp = installSmtp([SMTP.accept()]);
    assert.deepEqual([refusal(await manual()), smtp.calls.length, admission()], [[409, code], 0, null], state);
  }
  // a pre-DP2 manual failure is no delivery: the scheduled run sends (one admission, accepted)
  one(); db().seed(`email_delivery_manual/${T}/${B}/a0000000-0000-4000-8000-000000000009`, legacyManual("failed")); let smtp = installSmtp([SMTP.accept()]);
  assert.deepEqual([row(await cron()).outcome, smtp.calls.length, admission().state], ["accepted", 1, "accepted"]);
  // the holder settles only its own in_flight record: a state written by anyone else in the meantime is never overwritten
  one(); const p = heldProvider(); smtp = installSmtp([p.behavior()]);
  const running = manual();
  await p.arrived;
  const foreign = { ...admission(), state: "unknown", ref: "someone-else", code: "provider_connection_lost" }; delete foreign.leaseUntil;
  db().seed(`${ADM}/${T}/${B}/${DATE}`, foreign);
  p.release(); const m = await running;
  assert.equal(m.statusCode, 200);
  assert.deepEqual([admission().state, admission().ref], ["unknown", "someone-else"], "the foreign state stands");
});
