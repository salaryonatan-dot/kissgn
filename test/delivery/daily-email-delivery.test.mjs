// Daily e-mail delivery reliability — the REAL scheduled route `api/daily-snapshot/run.ts` end to end (real snapshot builder,
// real e-mail presenter, real lib/sendEmail.js + lib/emailDelivery.js, real authorization), with only the database, the
// token verifier and the SMTP provider replaced (test/support/daily-email-harness.mjs). No network, no real e-mail.
//   DE-01  success: one message per business to its own tenant's owner; accurate receipts (provider id, no address/body)
//   DE-02  duplicate sequential invocation: nothing is re-sent; HTTP 200 already_accepted
//   DE-03  concurrent invocations: each message is sent exactly once
//   DE-04  failure before sending: provider not configured / recipient read failure / no recipient / receipt store down —
//          nothing handed to the provider, visible failure, safe later retry where the message was never sent
//   DE-05  permanent provider refusal: failed, never retried automatically
//   DE-06  transient provider refusal: bounded retry (in-run and across runs), then final
//   DE-07  authentication failure: failed, not retried within the run
//   DE-08  timeout / ambiguous outcome: unknown, run continues, never re-sent automatically; a connection that never opened is
//          a definitive (retryable) failure
//   DE-09  provider accepted but the receipt write failed: reported; never re-sent (in progress, then unknown)
//   DE-10  an invocation that died after claiming but before the provider: the message is sent by the next run
//   DE-11  provider answered without accepting the recipient: failed, never a false success
//   DE-12  tenant / business isolation of recipients and receipts (same business id in two tenants)
//   DE-13  business-date boundary (Asia/Jerusalem): one message per business date; the scheduled 04:05 UTC run
//   DE-14  route authentication unchanged: no side effect without authorization
//   DE-15  manual owner send: classified outcome; the response names no recipient (R1); DP1 (owner decision P4, 2026-10-17): no
//          manual repeat of a Daily the schedule already delivered for the same tenant / business / business date
//   DE-16  no address, credential or provider response text in responses, logs or receipts
//   DE-17  partial failure: one business refused, the others delivered and recorded
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { buildSandbox, installSmtp, SMTP, seedWorld, freezeClock, runCron, runManual, captureConsole, mkRes, RECEIPTS, CRON_SECRET, T, B, B2, T2, B3, SUBSCRIPTIONS, enabledSubscriptionRecord } from "../support/daily-email-harness.mjs";

const { route } = await buildSandbox();
const AT = Date.UTC(2026, 8, 8, 4, 5);              // the scheduled 04:05 UTC run ⇒ 07:05 Israel, business date 2026-09-08
const DATE = "2026-09-08";
const receipt = (t, b, d = DATE) => globalThis.__DB.read(`${RECEIPTS}/${t}/${b}/${d}`);
const sha = (s) => createHash("sha256").update(s).digest("hex");
const ALL = [[T, B], [T, B2], [T2, B3]];
async function at(ms, fn) { const restore = freezeClock(ms); try { return await fn(); } finally { restore(); } }
const cron = () => at(AT, () => runCron(route));

test("DE-01 success: one message per business to its own tenant's owner; receipts record acceptance, the provider id and no personal data", async () => {
  seedWorld(); const smtp = installSmtp([SMTP.accept()]);
  const res = await cron();
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(res.body.status, "completed"); assert.equal(res.body.successCount, 3); assert.equal(res.body.totalSnapshots, 3);
  assert.deepEqual(smtp.calls.map((c) => c.to), ["owner-a@example.test", "owner-a@example.test", "owner-b@example.test"]);
  for (const [t, b] of ALL) {
    const r = receipt(t, b);
    assert.equal(r.state, "accepted"); assert.equal(r.attempt, 1); assert.equal(r.v, "MARJIN_EMAIL_RECEIPT/1");
    assert.deepEqual([r.kind, r.tenantId, r.bizId, r.businessDate], ["daily_snapshot", t, b, DATE]);
    assert.equal(r.recipientHash, sha(t === T ? "owner-a@example.test" : "owner-b@example.test"));
    assert.match(r.messageId, /^<daily_snapshot\.1\.[0-9a-f-]{36}@delivery\.marjin\.app>$/);
    assert.equal(r.messageId, smtp.calls.find((c) => c.messageIdHeader === r.messageId).messageIdHeader, "the receipt names the exact message handed over");
    assert.equal(r.providerIdEcho, "match", "R1: only a bounded echo class of the provider-reported id is stored");
    assert.equal(r.leaseUntil, undefined, "a terminal receipt holds no lease");
    assert.deepEqual(r.history.map((h) => h.state), ["accepted"]);
  }
  assert.equal(new Set(smtp.calls.map((c) => c.messageIdHeader)).size, 3);
  assert.ok(smtp.calls.every((c) => c.htmlLength > 1000), "the real presenter rendered every message");
});

test("DE-02 a duplicate (re-triggered) scheduled invocation re-sends nothing", async () => {
  seedWorld(); const smtp = installSmtp([SMTP.accept()]);
  await cron();
  const second = await cron();
  assert.equal(smtp.calls.length, 3, "still exactly one message per business");
  assert.equal(second.statusCode, 200); assert.equal(second.body.successCount, 0); assert.equal(second.body.alreadyAcceptedCount, 3);
  assert.ok(second.body.results.every((x) => x.outcome === "skipped" && x.code === "already_accepted"));
});

test("DE-03 two concurrent scheduled invocations send each message exactly once", async () => {
  seedWorld(); const smtp = installSmtp([SMTP.accept()]);
  const [a, b] = await at(AT, () => Promise.all([runCron(route), runCron(route)]));
  assert.equal(smtp.calls.length, 3, JSON.stringify(smtp.calls.map((c) => c.to)));
  const sent = a.body.successCount + b.body.successCount;
  const deferred = a.body.inProgressCount + b.body.inProgressCount + a.body.alreadyAcceptedCount + b.body.alreadyAcceptedCount;
  assert.equal(sent, 3); assert.equal(deferred, 3);
  for (const [t, bz] of ALL) assert.equal(receipt(t, bz).state, "accepted");
});

test("DE-04 failures before sending: nothing reaches the provider, the failure is visible, and a later run sends what was never sent", async () => {
  // (a) the provider is not configured (a fresh module graph: an earlier test's cached transporter would hide it)
  seedWorld({ withSecondBiz: false, withSecondTenant: false }); let smtp = installSmtp([SMTP.accept()]);
  const fresh = await buildSandbox({ fresh: true });
  const r1 = await at(AT, async () => { const x = mkRes(); process.env.CRON_SECRET = CRON_SECRET; process.env.SMTP_EMAIL = "sender@example.test"; delete process.env.SMTP_APP_PASSWORD;
    await fresh.route({ method: "GET", headers: { authorization: "Bearer " + CRON_SECRET }, query: {} }, x); return x; });
  assert.equal(r1.statusCode, 500); assert.equal(r1.body.results[0].code, "provider_not_configured"); assert.equal(smtp.calls.length, 0);
  assert.deepEqual([receipt(T, B).state, receipt(T, B).retryable, receipt(T, B).attempt], ["failed", true, 1]);
  const r2 = await at(AT, () => runCron(fresh.route));   // configured again (runCron sets the variables)
  assert.equal(r2.statusCode, 200); assert.equal(smtp.calls.length, 1); assert.deepEqual([receipt(T, B).state, receipt(T, B).attempt], ["accepted", 2]);
  // (b) the server recipient configuration is unavailable: no claim, no send
  let db = seedWorld({ withSecondBiz: false, withSecondTenant: false }); smtp = installSmtp([SMTP.accept()]);
  delete process.env.MARJIN_DAILY_RECIPIENTS_JSON; // deployment configuration unavailable, not a user-list read
  let r = await cron();
  assert.equal(r.statusCode, 500); assert.deepEqual([r.body.results[0].outcome, r.body.results[0].code], ["failed", "recipient_unavailable"]);
  assert.equal(smtp.calls.length, 0); assert.equal(receipt(T, B), null);
  // (c) no explicitly configured recipient; user/placeholder records grant no eligibility
  seedWorld({ withSecondBiz: false, withSecondTenant: false, users: [{ id: 1, email: "x@temp.marjin.app", role: "owner" }] }); smtp = installSmtp([SMTP.accept()]);
  process.env.MARJIN_DAILY_RECIPIENTS_JSON = "[]";
  r = await cron();
  assert.equal(r.statusCode, 500); assert.equal(r.body.results[0].code, "no_recipient"); assert.equal(smtp.calls.length, 0);
  // (d) the receipt store is down: fail closed — no claim means no send (a duplicate could not be prevented)
  db = seedWorld({ withSecondBiz: false, withSecondTenant: false }); smtp = installSmtp([SMTP.accept()]);
  const ref2 = db.ref; db.ref = (p, q) => { const x = ref2(p, q); return p.startsWith(RECEIPTS) ? { ...x, transaction: async () => { throw new Error("receipt store unavailable"); } } : x; };
  r = await cron();
  assert.equal(r.statusCode, 500); assert.deepEqual([r.body.results[0].outcome, r.body.results[0].code, r.body.results[0].receipt], ["failed", "receipt_unavailable", "unavailable"]);
  assert.equal(smtp.calls.length, 0);
});

test("DE-05 a permanent provider refusal (5xx) is failed and never retried automatically", async () => {
  seedWorld({ withSecondBiz: false, withSecondTenant: false }); const smtp = installSmtp([SMTP.rejectRecipient()]);
  const r1 = await cron(), r2 = await cron();
  assert.equal(smtp.calls.length, 1, "one provider call in total");
  assert.equal(r1.statusCode, 500); assert.deepEqual([r1.body.results[0].outcome, r1.body.results[0].code], ["failed", "provider_rejected_550"]);
  assert.equal(r2.statusCode, 500); assert.deepEqual([r2.body.results[0].outcome, r2.body.results[0].code], ["skipped", "failed_final"]);
  assert.deepEqual([receipt(T, B).state, receipt(T, B).retryable], ["failed", false]);
});

test("DE-06 a transient refusal (4xx) is retried within the run and across runs, at most MAX_AUTOMATIC_ATTEMPTS times in total", async () => {
  seedWorld({ withSecondBiz: false, withSecondTenant: false }); let smtp = installSmtp([SMTP.transient(), SMTP.accept()]);
  let r = await cron();
  assert.equal(r.statusCode, 200); assert.equal(smtp.calls.length, 2);
  assert.deepEqual([receipt(T, B).state, receipt(T, B).attempt], ["accepted", 2]);
  assert.deepEqual(receipt(T, B).history.map((h) => [h.attempt, h.state, h.code]), [[1, "failed", "provider_deferred_421"], [2, "accepted", null]]);
  assert.notEqual(smtp.calls[0].messageIdHeader, smtp.calls[1].messageIdHeader, "each attempt is a distinct message id");
  // always deferred: 2 attempts in the first run, the 3rd and last in the next run, then final
  seedWorld({ withSecondBiz: false, withSecondTenant: false }); smtp = installSmtp([SMTP.transient()]);
  r = await cron(); assert.equal(smtp.calls.length, 2); assert.deepEqual([receipt(T, B).attempt, receipt(T, B).retryable], [2, true]);
  r = await cron(); assert.equal(smtp.calls.length, 3); assert.deepEqual([receipt(T, B).attempt, receipt(T, B).retryable], [3, false]);
  r = await cron(); assert.equal(smtp.calls.length, 3); assert.equal(r.body.results[0].code, "failed_final");
});

test("DE-07 an authentication failure is a definitive, configuration-retryable failure, not retried within the run", async () => {
  seedWorld(); const smtp = installSmtp([SMTP.authFailure()]);
  const r = await cron();
  assert.equal(r.statusCode, 500); assert.equal(smtp.calls.length, 3, "one call per business, no in-run retry");
  assert.ok(r.body.results.every((x) => x.outcome === "failed" && x.code === "provider_auth_failed"));
  for (const [t, b] of ALL) assert.deepEqual([receipt(t, b).state, receipt(t, b).retryable], ["failed", true]);
});

// R2 (review E1): a refused connection / connect timeout reported by the provider no longer counts as "never sent" — the
// provider call had already been made, and its error code or text is not trustworthy evidence of the phase. It is UNKNOWN:
// one provider call, never retried in the run or by a later invocation (case d).
test("DE-08 timeouts and lost answers are UNKNOWN (never re-sent automatically); so is a connection error the provider reports", async () => {
  process.env.EMAIL_SEND_DEADLINE_MS = "200";
  try {
    // (a) a stalled provider no longer stalls the run: the next business is still delivered
    seedWorld(); let smtp = installSmtp([SMTP.hang(), SMTP.accept()]);
    const t0 = performance.now(); let r = await cron(); const ms = performance.now() - t0;
    assert.ok(ms < 5000, "the run settles (" + Math.round(ms) + " ms)");
    assert.deepEqual(r.body.results.map((x) => x.outcome), ["unknown", "accepted", "accepted"]);
    assert.equal(r.body.results[0].code, "provider_no_answer_deadline"); assert.equal(r.statusCode, 500);
    r = await cron();
    assert.equal(smtp.calls.length, 3, "the possibly-delivered message is not re-sent");
    assert.equal(r.body.results[0].code, "unknown_requires_reconciliation"); assert.equal(r.body.unknownCount, 1);
    // (b) inactivity timeout / (c) connection lost after the data: unknown
    for (const [behavior, code] of [[SMTP.socketTimeout(), "provider_timeout_unknown_phase"], [SMTP.closedAfterData(), "provider_connection_lost"]]) {
      seedWorld({ withSecondBiz: false, withSecondTenant: false }); smtp = installSmtp([behavior, SMTP.accept()]);
      r = await cron(); await cron();
      assert.equal(smtp.calls.length, 1, code); assert.deepEqual([receipt(T, B).state, receipt(T, B).code], ["unknown", code]);
    }
    // (d) refused connection / connect timeout reported by the provider: unknown, never re-sent (R2, E1)
    for (const [behavior, code] of [[SMTP.connectRefused(), "provider_connection_lost"], [SMTP.connectTimeout(), "provider_timeout_unknown_phase"]]) {
      seedWorld({ withSecondBiz: false, withSecondTenant: false }); smtp = installSmtp([behavior, SMTP.accept()]);
      r = await cron(); assert.equal(r.statusCode, 500);
      r = await cron(); assert.equal(r.body.results[0].code, "unknown_requires_reconciliation");
      assert.equal(smtp.calls.length, 1, code); assert.deepEqual([receipt(T, B).state, receipt(T, B).code, receipt(T, B).attempt], ["unknown", code, 1]);
    }
  } finally { delete process.env.EMAIL_SEND_DEADLINE_MS; }
});

test("DE-09 the provider accepted but the receipt could not be finalized: reported, and the message is never re-sent", async () => {
  const db = seedWorld({ withSecondBiz: false, withSecondTenant: false }); const smtp = installSmtp([SMTP.accept()]);
  const ref = db.ref; let failFinal = true;
  db.ref = (p, q) => { const x = ref(p, q); return p.startsWith(RECEIPTS) ? { ...x, transaction: async (fn) => { if (failFinal && db.read(p)?.state === "sending") throw new Error("write lost"); return x.transaction(fn); } } : x; };
  const r1 = await cron();
  failFinal = false;
  assert.equal(r1.statusCode, 500, "an unrecorded acceptance is not a clean run");
  assert.deepEqual([r1.body.results[0].outcome, r1.body.results[0].receipt], ["accepted", "write_failed"]);
  assert.equal(receipt(T, B).state, "sending");
  const r2 = await cron();                                                     // within the lease: another run is presumed active
  assert.equal(r2.body.results[0].code, "in_progress");
  const r3 = await at(AT + 11 * 60 * 1000, () => runCron(route));              // after the lease: possibly delivered ⇒ unknown
  assert.equal(r3.body.results[0].code, "unknown_requires_reconciliation");
  assert.deepEqual([receipt(T, B).state, receipt(T, B).outcome.code], ["unknown", "invocation_lost_during_send"]);
  assert.equal(smtp.calls.length, 1, "never re-sent");
});

test("DE-10 an invocation that died after claiming but before the provider: the next run (after the lease) sends it", async () => {
  seedWorld({ withSecondBiz: false, withSecondTenant: false }); const smtp = installSmtp([SMTP.accept()]);
  globalThis.__DB.seed(`${RECEIPTS}/${T}/${B}/${DATE}`, { v: "MARJIN_EMAIL_RECEIPT/1", kind: "daily_snapshot", tenantId: T, bizId: B, businessDate: DATE, state: "claimed", claimId: "dead", attempt: 1, claimedAt: AT - 20 * 60000, leaseUntil: AT - 10 * 60000, recipientHash: "x", updatedAt: AT - 20 * 60000, history: [] });
  const r = await cron();
  assert.equal(r.statusCode, 200); assert.equal(smtp.calls.length, 1);
  assert.deepEqual([receipt(T, B).state, receipt(T, B).attempt], ["accepted", 1]);
  assert.equal(receipt(T, B).history[0].state, "abandoned_before_send");
});

// R3 (independent R2 review, E2 continuation): SMTP.acceptedNone() lists the recipient as rejected beside the 250 end-of-DATA
// reply — a combination the single-recipient SMTP adapter cannot produce (test/delivery/de1-r3-provider-contract.test.mjs).
// It establishes no refusal: unknown, held, never counted as success (was: failed / provider_rejected_recipient).
test("DE-11 the provider answered without accepting the recipient: never counted as success; a contradictory answer is unknown", async () => {
  seedWorld({ withSecondBiz: false, withSecondTenant: false }); installSmtp([SMTP.acceptedNone()]);
  const r = await cron();
  assert.equal(r.statusCode, 500); assert.equal(r.body.successCount, 0);
  assert.deepEqual([r.body.results[0].outcome, r.body.results[0].code], ["unknown", "provider_result_inconsistent"]);
  assert.equal(receipt(T, B).state, "unknown");
});

test("DE-12 tenant / business isolation: the same business id in two tenants has two receipts and two recipients", async () => {
  const db = seedWorld({ withSecondBiz: false });
  // tenant B also owns a business with id bizA
  const env = (v) => ({ _v: JSON.stringify(v) });
  db.seed(`tenants/${T2}/app/business`, env([{ id: B3, name: "מסעדה ג" }, { id: B, name: "מסעדה ד" }]));
  process.env.MARJIN_DAILY_RECIPIENTS_JSON = JSON.stringify([...JSON.parse(process.env.MARJIN_DAILY_RECIPIENTS_JSON),[T2,B,"owner-b@example.test"]]);
  db.seed(`${SUBSCRIPTIONS}/${T2}/${B}`, enabledSubscriptionRecord());
  db.seed(`tenants/${T2}/biz:${B}:entries`, db.read(`tenants/${T}/biz:${B}:entries`)); db.seed(`tenants/${T2}/biz:${B}:config`, env({})); db.seed(`tenants/${T2}/biz:${B}:fixed`, env([]));
  const smtp = installSmtp([SMTP.accept()]);
  await cron();
  const pairs = smtp.calls.map((c) => c.to).sort();
  assert.deepEqual(pairs, ["owner-a@example.test", "owner-b@example.test", "owner-b@example.test"]);
  assert.equal(receipt(T, B).recipientHash, sha("owner-a@example.test")); assert.equal(receipt(T2, B).recipientHash, sha("owner-b@example.test"));
  assert.notEqual(receipt(T, B).messageId, receipt(T2, B).messageId);
});

test("DE-13 business-date boundary (Asia/Jerusalem): one message per business date; the 04:05 UTC schedule is 07:05 / 06:05 Israel", async () => {
  seedWorld({ withSecondBiz: false, withSecondTenant: false }); const smtp = installSmtp([SMTP.accept()]);
  const before = Date.UTC(2026, 8, 8, 20, 59), after = Date.UTC(2026, 8, 8, 21, 1), later = Date.UTC(2026, 8, 8, 22, 30); // IDT = UTC+3
  const a = await at(before, () => runCron(route)), b = await at(after, () => runCron(route)), c = await at(later, () => runCron(route));
  assert.deepEqual([a.body.results[0].businessDate, b.body.results[0].businessDate, c.body.results[0].businessDate], ["2026-09-08", "2026-09-09", "2026-09-09"]);
  assert.equal(smtp.calls.length, 2); assert.equal(c.body.results[0].code, "already_accepted");
  // winter (IST = UTC+2): the scheduled run date is the Israel date of 04:05 UTC
  const w = await at(Date.UTC(2026, 11, 15, 4, 5), () => runCron(route));
  assert.equal(w.body.results[0].businessDate, "2026-12-15");
});

test("DE-14 authorization is unchanged: no claim, no receipt, no provider call without it", async () => {
  seedWorld(); const smtp = installSmtp([SMTP.accept()]);
  process.env.CRON_SECRET = "fixture-cron-secret-daily-email";
  for (const headers of [{}, { authorization: "Bearer wrong" }, { "x-vercel-cron": "1" }]) {
    const x = mkRes(); await at(AT, () => route({ method: "GET", headers, query: {} }, x));
    assert.equal(x.statusCode, 401);
  }
  const viewer = await at(AT, () => runManual(route, { uid: "u_viewer_a", email: "viewer-a@example.test" }));
  assert.equal(viewer.statusCode, 403);
  const foreign = await at(AT, () => runManual(route, { uid: "u_owner_b", email: "owner-b@example.test" }));
  assert.ok([401, 403].includes(foreign.statusCode), String(foreign.statusCode));
  globalThis.__DE = { requireAuth: async () => { throw new Error("no auth"); } };
  const cronPost = mkRes(); await at(AT, () => route({ method: "POST", headers: { authorization: "Bearer " + CRON_SECRET }, query: {}, body: { tenantId: T, bizId: B } }, cronPost));
  assert.equal(cronPost.statusCode, 401, "the cron secret is not a user identity");
  assert.equal(smtp.calls.length, 0); assert.equal(globalThis.__DB.read("email_delivery"), null);
});

test("DE-15 the manual owner send: classified outcome, no false success; no manual repeat of a scheduled delivery (DP1 / P4)", async () => {
  seedWorld(); let smtp = installSmtp([SMTP.accept()]);
  await cron();
  // DP1 (owner decision P4, 2026-10-17; T-DP1-TEST-EXPECTATIONS): the schedule delivered this exact (tenant, business, business
  // date) Daily, so both explicit owner requests are refused before the provider; the receipt is untouched (read, never changed)
  const r1 = await at(AT, () => runManual(route)), r2 = await at(AT, () => runManual(route));
  assert.deepEqual([r1.statusCode, r1.body.code, r2.statusCode, r2.body.code], [409, "manual_repeat_not_permitted", 409, "manual_repeat_not_permitted"]);
  assert.equal(smtp.calls.length, 3, "3 scheduled; the manual repeats reach no provider");
  assert.equal(receipt(T, B).attempt, 1, "the schedule receipt is untouched by manual sends");
  // a first-time manual send (no delivery of this identity): the classified outcome and R1's response shape
  seedWorld(); smtp = installSmtp([SMTP.accept()]);
  const m1 = await at(AT, () => runManual(route));
  assert.equal(m1.statusCode, 200); assert.equal(m1.body.status, "success");
  // R1 (D2): the response names only the selection policy — no address, no hash
  assert.deepEqual(m1.body.delivery, { outcome: "accepted", recipient: "server_configured" }); assert.equal("emailSentTo" in m1.body, false);
  assert.ok(!/@|rcpt:|[0-9a-f]{12}/.test(JSON.stringify(m1.body.delivery)), JSON.stringify(m1.body));
  assert.match(smtp.calls[0].messageIdHeader, /^<manual\.[0-9a-f-]{36}@delivery\.marjin\.app>$/);
  assert.equal(receipt(T, B), null, "a manual send writes no schedule receipt");
  seedWorld(); smtp = installSmtp([SMTP.rejectRecipient()]);
  const f = await at(AT, () => runManual(route));
  assert.deepEqual([f.statusCode, f.body.error, f.body.code], [502, "email_not_sent", "provider_rejected_550"]);
  seedWorld(); smtp = installSmtp([SMTP.closedAfterData()]);
  const u = await at(AT, () => runManual(route));
  assert.deepEqual([u.statusCode, u.body.error, u.body.code], [504, "email_outcome_unknown", "provider_connection_lost"]);
});

test("DE-16 no address, credential or provider response text in responses, logs or receipts", async () => {
  const leaks = (s) => /@example\.test|fixture-app-password|5\.1\.1|Username and Password|Try again later/.test(s);
  for (const behavior of [SMTP.accept(), SMTP.rejectRecipient(), SMTP.authFailure(), SMTP.transient(), SMTP.closedAfterData()]) {
    seedWorld(); installSmtp([behavior]);
    const { value, lines } = await captureConsole(() => cron());
    assert.ok(!leaks(JSON.stringify(value.body)), "response: " + JSON.stringify(value.body));
    assert.deepEqual(lines.filter(leaks), [], "logs");
    assert.ok(!leaks(JSON.stringify(globalThis.__DB.read("email_delivery"))), "receipts");
    assert.ok(!/<html|<div/i.test(JSON.stringify(globalThis.__DB.read("email_delivery"))), "no message body in receipts");
  }
});

test("DE-17 partial failure: one business refused, the others delivered and recorded; the run is reported as not clean", async () => {
  seedWorld(); const smtp = installSmtp([SMTP.accept(), SMTP.rejectRecipient(), SMTP.accept()]);
  const r = await cron();
  assert.equal(r.statusCode, 500); assert.equal(r.body.status, "completed_with_failures");
  assert.deepEqual(r.body.results.map((x) => x.outcome), ["accepted", "failed", "accepted"]);
  assert.deepEqual([r.body.successCount, r.body.failureCount], [2, 1]);
  assert.deepEqual(ALL.map(([t, b]) => receipt(t, b).state), ["accepted", "failed", "accepted"]);
  assert.equal(smtp.calls.length, 3);
});
