// Daily Email reliability R2 — behavioural regressions for the independent R1 review's findings E1 and E2 (LOCAL author
// candidate; pending independent Codex review). The REAL route api/daily-snapshot/run.ts, the REAL snapshot builder /
// presenter and the REAL lib/sendEmail.js + lib/emailDelivery.js run in the sandbox of test/support/daily-email-harness.mjs;
// only the database, the token verifier and the SMTP provider are replaced. Every case asserts OBSERVABLE effects: provider
// calls (and, where the fake models it, messages the server took), the durable receipt (state, code, attempt, history) and
// the returned run status — never a state label alone. No network, no real e-mail; LOCAL behaviour only.
//   DR2-01  E1  a provider error after the hand-off that carries an internal-looking "before_transport" marker: unknown, one
//               call, never re-sent by a later invocation
//   DR2-02  E1  connection / DNS / timeout errors reported by the provider (whatever their text or syscall) after the hand-off:
//               unknown, no in-run retry, no later retry
//   DR2-03  E1  the server took the message, then the connection was lost before its answer reached us: unknown; the server
//               holds exactly one copy after three invocations
//   DR2-04  E2  an indeterminate resolved result (recipient listed nowhere; with / without a 250; another address only):
//               unknown, never failed, never re-sent
//   DR2-05      contradictory or unverifiable evidence: listed both ways, accepted with a 5xx, a reply-shaped error whose
//               reply text and code disagree or whose command is not a nodemailer reply command: unknown, never re-sent
//   DR2-06      controls that must keep working: acceptance (one call, accepted, then already_accepted); a definite SMTP
//               refusal (5xx, final); a resolved rejected listing (final); a 4xx deferral (retried in the run — the server
//               refused it); an authentication refusal (retried by the next invocation, bounded by the attempt budget)
//   DR2-07      a failure confirmed BEFORE the provider call (our claim refused the hand-off): failed, zero provider calls,
//               re-sent by the next invocation
//   DR2-08      repeated invocations after an unknown outcome: one provider call, attempt 1, HTTP 500 every time
//   DR2-09      timeout and late provider completion: the deadline makes it unknown; the late acceptance or refusal writes
//               nothing and triggers nothing
//   DR2-10      receipt-write failure after acceptance and after an unknown outcome: never re-sent; 500 → 503 → 500 unknown
//   DR2-11      concurrent invocations: one provider call; the concurrent run is pending (503) and then observes the outcome
//               (accepted or unknown); simultaneous claims never double-send
//   DR2-12      the manual POST (no receipt): the same evidence rules — unknown is 504, a definite refusal 502, acceptance 200
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSandbox, installSmtp, SMTP, seedWorld, freezeClock, runCron, runManual, RECEIPTS, T, B } from "../support/daily-email-harness.mjs";

const { route } = await buildSandbox();
const AT = Date.UTC(2026, 8, 8, 4, 5);
const DATE = "2026-09-08";
const LEASE = 10 * 60 * 1000;
const PATH = `${RECEIPTS}/${T}/${B}/${DATE}`;
const receipt = () => globalThis.__DB.read(PATH);
async function at(ms, fn) { const restore = freezeClock(ms); try { return await fn(); } finally { restore(); } }
const cron = (ms = AT) => at(ms, () => runCron(route));
const one = () => seedWorld({ withSecondBiz: false, withSecondTenant: false });
const err = (message, code, extra = {}) => Object.assign(new Error(message), code === undefined ? {} : { code }, extra);
/** a nodemailer SMTP negative reply exactly as lib/smtp-connection _formatError builds it */
const reply = (message, code, response, command) => err(message + ": " + response, code, { response, responseCode: Number(response.slice(0, 3)), command });
const accepted = (mail) => ({ messageId: mail.messageId, accepted: [mail.to], rejected: [], response: "250 2.0.0 OK fake" });
const row = (r) => r.body.results[0];
const view = (rec) => rec && { state: rec.state, code: rec.code ?? null, attempt: rec.attempt, retryable: rec.retryable };

/** Run the cron `times` times (each after the lease of the previous one) and return the responses. */
async function runs(times) { const out = []; for (let i = 0; i < times; i++) out.push(await cron(AT + i * 2 * LEASE)); return out; }
function assertUnknownHeld(rs, smtp, code, label) {
  assert.deepEqual([rs[0].statusCode, rs[0].body.status, row(rs[0]).outcome, row(rs[0]).code, row(rs[0]).settlement], [500, "completed_with_failures", "unknown", code, "unknown"], label + ": first run");
  for (const r of rs.slice(1)) assert.deepEqual([r.statusCode, row(r).code, row(r).settlement, r.body.unknownCount, r.body.successCount], [500, "unknown_requires_reconciliation", "unknown", 1, 0], label + ": later run");
  assert.equal(smtp.calls.length, 1, label + ": exactly one provider call");
  assert.deepEqual(view(receipt()), { state: "unknown", code, attempt: 1, retryable: undefined }, label + ": durable receipt");
  assert.deepEqual(receipt().history.map((h) => [h.attempt, h.state]), [[1, "unknown"]], label + ": one attempt recorded");
}

test("DR2-01 (E1) a provider error carrying an internal-looking 'before_transport' marker after the hand-off is unknown, never re-sent", async () => {
  for (const [label, mk, code] of [
    ["review shape", () => err("may have accepted", "ETIMEDOUT", { deliveryPhase: "before_transport", deliveryCode: "claim_lost" }), "provider_timeout_unknown_phase"],
    ["marker only", () => err("x", undefined, { deliveryPhase: "before_transport", deliveryCode: "not_handed_to_provider" }), "provider_error_unclassified"],
    ["marker + configuration code", () => err("x", "ECONFIG", { deliveryPhase: "before_transport" }), "provider_error_unclassified"],
  ]) {
    one(); const smtp = installSmtp([async () => { throw mk(); }, async (mail) => accepted(mail)]);
    assertUnknownHeld(await runs(3), smtp, code, label);
  }
});

test("DR2-02 (E1) connection, DNS and timeout errors reported after the hand-off are unknown: no in-run retry, no later retry", async () => {
  for (const [label, behavior, code] of [
    ["'Connection timeout' text", async () => { throw err("Connection timeout", "ETIMEDOUT", { command: "CONN" }); }, "provider_timeout_unknown_phase"],
    ["'Greeting never received' text", async () => { throw err("Greeting never received", "ETIMEDOUT", { command: "CONN" }); }, "provider_timeout_unknown_phase"],
    ["refused connection (connect syscall)", SMTP.connectRefused(), "provider_connection_lost"],
    ["DNS failure (getaddrinfo syscall)", async () => { throw err("getaddrinfo ENOTFOUND smtp.gmail.com", "EDNS", { syscall: "getaddrinfo" }); }, "provider_connection_lost"],
    ["socket inactivity timeout", SMTP.socketTimeout(), "provider_timeout_unknown_phase"],
  ]) {
    one(); const smtp = installSmtp([behavior, async (mail) => accepted(mail)]);
    assertUnknownHeld(await runs(3), smtp, code, label);
  }
});

test("DR2-03 (E1) the server took the message, then the connection was lost: unknown; the server holds one copy after three runs", async () => {
  one(); const server = []; let first = true;
  const smtp = installSmtp([async (mail) => { server.push(mail.messageIdHeader || mail.messageId); if (first) { first = false; throw err("Connection closed unexpectedly", "ECONNECTION", { command: "CONN" }); } return accepted(mail); }]);
  assertUnknownHeld(await runs(3), smtp, "provider_connection_lost", "accepted then connection lost");
  assert.equal(server.length, 1, "the server received exactly one copy");
  // the same after the 250 was read but before nodemailer resolved (a timeout racing the answer)
  one(); const server2 = []; let first2 = true;
  const smtp2 = installSmtp([async (mail) => { server2.push(1); if (first2) { first2 = false; throw err("Timeout", "ETIMEDOUT", { command: "CONN" }); } return accepted(mail); }]);
  assertUnknownHeld(await runs(2), smtp2, "provider_timeout_unknown_phase", "accepted then timeout");
  assert.equal(server2.length, 1);
});

test("DR2-04 (E2) an indeterminate resolved result is unknown — never a definite refusal and never re-sent", async () => {
  for (const [label, answer] of [
    ["empty lists with 250 (review shape)", (mail) => ({ messageId: mail.messageId, accepted: [], rejected: [], response: "250 OK" })],
    ["empty lists, no response", (mail) => ({ messageId: mail.messageId, accepted: [], rejected: [] })],
    ["another address accepted", (mail) => ({ messageId: mail.messageId, accepted: ["someone-else@example.test"], rejected: [], response: "250 OK" })],
    ["another address rejected", (mail) => ({ messageId: mail.messageId, accepted: [], rejected: ["someone-else@example.test"], response: "250 OK" })],
  ]) {
    one(); const smtp = installSmtp([async (mail) => answer(mail), async (mail) => accepted(mail)]);
    const rs = await runs(3);
    assertUnknownHeld(rs, smtp, "provider_result_indeterminate", label);
    assert.ok(rs.every((r) => row(r).code !== "failed_final" && row(r).settlement !== "failed"), label + ": never a definite failure");
  }
});

test("DR2-05 contradictory or unverifiable evidence is unknown and never re-sent", async () => {
  for (const [label, behavior, code] of [
    ["listed accepted AND rejected", async (mail) => ({ messageId: mail.messageId, accepted: [mail.to], rejected: [mail.to], response: "250 OK" }), "provider_result_inconsistent"],
    ["accepted with a 5xx reply", async (mail) => ({ messageId: mail.messageId, accepted: [mail.to], rejected: [], response: "554 5.0.0 rejected" }), "provider_result_inconsistent"],
    ["accepted list missing", async (mail) => ({ messageId: mail.messageId, rejected: [], response: "250 OK" }), "provider_result_malformed"],
    ["reply code without reply text", async () => { throw err("all recipients were rejected", "EENVELOPE", { responseCode: 550, command: "RCPT TO" }); }, "provider_refusal_unverifiable"],
    ["reply text disagrees with reply code", async () => { throw err("Message failed", "EMESSAGE", { responseCode: 550, response: "250 2.0.0 OK", command: "DATA" }); }, "provider_refusal_unverifiable"],
    ["reply under a non-reply command", async () => { throw err("Message failed", "EMESSAGE", { responseCode: 550, response: "550 no", command: "CONN" }); }, "provider_refusal_unverifiable"],
    ["adapter-local envelope error, no server reply", async () => { throw err("Invalid recipient", "EENVELOPE", { command: "API" }); }, "provider_refusal_unverifiable"],
  ]) {
    one(); const smtp = installSmtp([behavior, async (mail) => accepted(mail)]);
    assertUnknownHeld(await runs(2), smtp, code, label);
  }
});

test("DR2-06 controls: acceptance, definite refusals, a 4xx deferral and an authentication refusal keep their safe behaviour", async () => {
  // acceptance: one call, accepted, then observed — never re-sent
  one(); let smtp = installSmtp([SMTP.accept()]);
  let rs = await runs(3);
  assert.deepEqual(rs.map((r) => [r.statusCode, row(r).code, row(r).settlement]), [[200, null, "delivered"], [200, "already_accepted", "delivered"], [200, "already_accepted", "delivered"]]);
  assert.equal(smtp.calls.length, 1); assert.deepEqual(view(receipt()), { state: "accepted", code: null, attempt: 1, retryable: undefined });
  // a definite SMTP refusal (RCPT TO 550): failed, final — one call, later runs skip
  one(); smtp = installSmtp([SMTP.rejectRecipient(), SMTP.accept()]);
  rs = await runs(3);
  assert.deepEqual(rs.map((r) => [r.statusCode, row(r).code]), [[500, "provider_rejected_550"], [500, "failed_final"], [500, "failed_final"]]);
  assert.equal(smtp.calls.length, 1); assert.deepEqual(view(receipt()), { state: "failed", code: "provider_rejected_550", attempt: 1, retryable: false });
  // a resolved result that lists the recipient as rejected: failed, final
  one(); smtp = installSmtp([SMTP.acceptedNone(), SMTP.accept()]);
  rs = await runs(2);
  assert.deepEqual(rs.map((r) => [r.statusCode, row(r).code]), [[500, "provider_rejected_recipient"], [500, "failed_final"]]);
  assert.equal(smtp.calls.length, 1);
  // a 4xx deferral after DATA: the server refused it ⇒ retried within the run; accepted on attempt 2
  one(); smtp = installSmtp([SMTP.transient(), SMTP.accept()]);
  rs = await runs(2);
  assert.deepEqual(rs.map((r) => [r.statusCode, row(r).code]), [[200, null], [200, "already_accepted"]]);
  assert.equal(smtp.calls.length, 2);
  assert.deepEqual(receipt().history.map((h) => [h.attempt, h.state, h.code]), [[1, "failed", "provider_deferred_421"], [2, "accepted", null]]);
  // an authentication refusal: retryable by the NEXT invocation, never in the run; bounded by the attempt budget (3)
  one(); smtp = installSmtp([SMTP.authFailure()]);
  rs = await runs(4);
  assert.deepEqual(rs.map((r) => [r.statusCode, row(r).code, row(r).attempt ?? null]), [[500, "provider_auth_failed", 1], [500, "provider_auth_failed", 2], [500, "provider_auth_failed", 3], [500, "failed_final", null]]);
  assert.equal(smtp.calls.length, 3); assert.deepEqual(view(receipt()), { state: "failed", code: "provider_auth_failed", attempt: 3, retryable: false });
});

test("DR2-07 a failure confirmed before the provider call (our claim refused the hand-off): zero calls, re-sent by the next run", async () => {
  const db = one(); const smtp = installSmtp([SMTP.accept()]);
  const ref = db.ref; let refuse = true;
  db.ref = (p, q) => { const x = ref(p, q); return p.startsWith(RECEIPTS) ? { ...x, transaction: async (fn) => { if (refuse && db.read(p)?.state === "claimed") { refuse = false; throw new Error("claim write lost"); } return x.transaction(fn); } } : x; };
  const r1 = await cron();
  assert.deepEqual([r1.statusCode, row(r1).outcome, row(r1).code], [500, "failed", "claim_lost"]);
  assert.equal(smtp.calls.length, 0, "the provider was never called");
  assert.deepEqual(view(receipt()), { state: "failed", code: "claim_lost", attempt: 1, retryable: true });
  const r2 = await cron(AT + 2 * LEASE);
  assert.deepEqual([r2.statusCode, row(r2).outcome, row(r2).attempt], [200, "accepted", 2]);
  assert.equal(smtp.calls.length, 1);
});

test("DR2-08 repeated invocations after an unknown outcome: one provider call, attempt 1, never a clean run", async () => {
  one(); const smtp = installSmtp([SMTP.closedAfterData(), SMTP.accept()]);
  const rs = await runs(5);
  assertUnknownHeld(rs, smtp, "provider_connection_lost", "five invocations");
  // concurrent repeats change nothing either
  const many = await Promise.all([cron(AT + 20 * LEASE), cron(AT + 20 * LEASE), cron(AT + 20 * LEASE)]);
  assert.ok(many.every((r) => r.statusCode === 500 && row(r).code === "unknown_requires_reconciliation"));
  assert.equal(smtp.calls.length, 1);
});

test("DR2-09 timeout and late provider completion: unknown at the deadline; the late acceptance or refusal writes nothing", async () => {
  process.env.EMAIL_SEND_DEADLINE_MS = "100";
  try {
    for (const [label, late] of [["late acceptance", (mail) => accepted(mail)], ["late refusal", () => { throw reply("Message failed", "EMESSAGE", "550 5.7.1 rejected", "DATA"); }]]) {
      one(); let settled = 0;
      const smtp = installSmtp([(mail) => new Promise((res, rej) => setTimeout(() => { settled++; try { res(late(mail)); } catch (e) { rej(e); } }, 300)), async (mail) => accepted(mail)]);
      const r1 = await cron();
      assert.deepEqual([r1.statusCode, row(r1).outcome, row(r1).code], [500, "unknown", "provider_no_answer_deadline"], label);
      const before = JSON.stringify(receipt());
      await new Promise((r) => setTimeout(r, 450));
      assert.equal(settled, 1, label + ": the provider did complete late");
      assert.equal(JSON.stringify(receipt()), before, label + ": the late completion changed nothing durable");
      const r2 = await cron(AT + 2 * LEASE);
      assert.deepEqual([r2.statusCode, row(r2).code], [500, "unknown_requires_reconciliation"], label);
      assert.equal(smtp.calls.length, 1, label + ": never re-sent");
      assert.deepEqual(view(receipt()), { state: "unknown", code: "provider_no_answer_deadline", attempt: 1, retryable: undefined }, label);
    }
  } finally { delete process.env.EMAIL_SEND_DEADLINE_MS; }
});

test("DR2-10 receipt-write failure after acceptance or after an unknown outcome: never re-sent; 500 → 503 → 500", async () => {
  for (const [label, behavior, firstOutcome] of [["after acceptance", SMTP.accept(), "accepted"], ["after an unknown outcome", SMTP.closedAfterData(), "unknown"]]) {
    const db = one(); const smtp = installSmtp([behavior, SMTP.accept()]);
    const ref = db.ref; let failFinal = true;
    db.ref = (p, q) => { const x = ref(p, q); return p.startsWith(RECEIPTS) ? { ...x, transaction: async (fn) => { if (failFinal && db.read(p)?.state === "sending") throw new Error("write lost"); return x.transaction(fn); } } : x; };
    const r1 = await cron();
    failFinal = false;
    assert.deepEqual([r1.statusCode, row(r1).outcome, row(r1).receipt], [500, firstOutcome, "write_failed"], label);
    assert.equal(receipt().state, "sending", label + ": the claim stays unresolved");
    const r2 = await cron(AT + 60000);
    assert.deepEqual([r2.statusCode, row(r2).settlement, row(r2).phase], [503, "pending", "sending"], label + ": within the lease");
    const r3 = await cron(AT + LEASE + 60000);
    assert.deepEqual([r3.statusCode, row(r3).settlement, receipt().state, receipt().outcome.code], [500, "unknown", "unknown", "invocation_lost_during_send"], label + ": after the lease");
    assert.equal(smtp.calls.length, 1, label + ": never re-sent");
  }
});

test("DR2-11 concurrent invocations: one provider call; the concurrent run is pending, then observes accepted or unknown", async () => {
  for (const [label, settle, code, status] of [["accepted", (mail) => accepted(mail), "already_accepted", 200], ["unknown", () => { throw err("Timeout", "ETIMEDOUT", { command: "CONN" }); }, "unknown_requires_reconciliation", 500]]) {
    one();
    let release; const held = new Promise((r) => { release = r; });
    const smtp = installSmtp([async (mail) => { await held; return settle(mail); }]);
    const restore = freezeClock(AT);
    try {
      const first = runCron(route);
      for (let i = 0; i < 400 && smtp.calls.length === 0; i++) await new Promise((r) => setTimeout(r, 5));
      const second = await runCron(route);
      assert.deepEqual([second.statusCode, row(second).settlement, row(second).phase], [503, "pending", "sending"], label);
      release();
      await first;
      const third = await runCron(route);
      assert.deepEqual([third.statusCode, row(third).code], [status, code], label);
    } finally { restore(); }
    assert.equal(smtp.calls.length, 1, label + ": one provider call");
  }
  // simultaneous starts: the claim transaction lets exactly one invocation hand the message over
  one(); const smtp = installSmtp([async (mail) => { await new Promise((r) => setTimeout(r, 30)); return accepted(mail); }]);
  const rs = await at(AT, () => Promise.all([runCron(route), runCron(route), runCron(route)]));
  assert.equal(smtp.calls.length, 1, "exactly one hand-off");
  assert.equal(rs.filter((r) => row(r).outcome === "accepted").length, 1);
  assert.ok(rs.every((r) => [200, 503].includes(r.statusCode)), JSON.stringify(rs.map((r) => r.statusCode)));
});

test("DR2-12 the manual POST applies the same evidence rules: unknown 504, definite refusal 502, acceptance 200", async () => {
  for (const [label, behavior, status, code] of [
    ["spoofed internal marker", async () => { throw err("x", "ETIMEDOUT", { deliveryPhase: "before_transport", deliveryCode: "claim_lost" }); }, 504, "provider_timeout_unknown_phase"],
    ["connection timeout text", SMTP.connectTimeout(), 504, "provider_timeout_unknown_phase"],
    ["indeterminate result", async (mail) => ({ messageId: mail.messageId, accepted: [], rejected: [], response: "250 OK" }), 504, "provider_result_indeterminate"],
    ["definite refusal", SMTP.rejectRecipient(), 502, "provider_rejected_550"],
    ["acceptance", SMTP.accept(), 200, undefined],
  ]) {
    one(); const smtp = installSmtp([behavior]);
    const r = await at(AT, () => runManual(route));
    assert.equal(r.statusCode, status, label);
    assert.equal(r.body.code, code, label);
    assert.equal(smtp.calls.length, 1, label + ": one call");
    assert.equal(receipt(), null, label + ": the manual send writes no receipt");
  }
});
