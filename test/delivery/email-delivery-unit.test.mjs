// Daily e-mail delivery reliability — unit contracts of lib/emailDelivery.js and lib/sendEmail.js.
//   EU-01  provider-error classification against the nodemailer 6.x error shapes (definitive vs ambiguous)
//   EU-02  a resolved provider result counts only when the recipient is accepted
//   EU-03  receipt identity: only safely addressable kind / tenant / business / business-date paths
//   EU-04  the claim state machine on stored receipts (fresh, accepted, unknown, in-progress, stale claimed / sending,
//          failed retryable / final, unreadable)
//   EU-05  the attempt context: lib/sendEmail.js marks the attempt before the provider and aborts when the mark fails
//   EU-06  lib/sendEmail.js: bounded SMTP session options and a deadline that may only be lowered
//   EU-07  the alert digest (lib/sendEmail.js sendAlertDigest) carries readable Hebrew, not double-encoded text
//   EU-08  a finalization lands only on the receipt this attempt claimed (never over another invocation's receipt)
//   EU-09  one provider hand-off per attempt (a second sendEmail in one message is refused; the attempt is unknown)
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { makeDb } from "../../tools/storage-v2/reader-sandbox.mjs";
import { buildSandbox, installSmtp, SMTP, REPO, sdkTransactions } from "../support/daily-email-harness.mjs";
import * as D from "../../lib/emailDelivery.js";

const err = (message, code, extra = {}) => Object.assign(new Error(message), { code }, extra);

// R2 (review E1): classifyTransportError classifies an error raised AFTER sendMail was invoked. Only an SMTP negative reply in
// the exact nodemailer shape (code + command pair, integer responseCode equal to the leading code of the reply text) is a
// refusal; everything else — connection / DNS / timeout codes whatever their text, adapter-local errors without a server
// reply, a configuration code, a spoofed internal marker — may follow an acceptance and is UNKNOWN. (The R1 rows that made a
// "Connection timeout" text, a connect syscall or an EDNS code a retryable "provider_unreachable" were the unsafe retry E1.)
test("EU-01 provider errors: a definitive refusal is failed; anything that may follow the data hand-over is unknown", () => {
  const C = D.classifyTransportError;
  const reply = (message, code, response, command) => err(message + ": " + response, code, { response, responseCode: Number(response.slice(0, 3)), command });
  const rows = [
    [reply("Invalid login", "EAUTH", "535-5.7.8 Username and Password not accepted.", "AUTH PLAIN"), "failed", true, false, "provider_auth_failed"],
    [reply("Can't send mail - all recipients were rejected", "EENVELOPE", "550 5.1.1 no such user", "RCPT TO"), "failed", false, false, "provider_rejected_550"],
    [reply("Mail command failed", "EENVELOPE", "553 5.1.8 sender rejected", "MAIL FROM"), "failed", false, false, "provider_rejected_553"],
    [reply("Message failed", "EMESSAGE", "552 5.3.4 Message size exceeds fixed limit", "DATA"), "failed", false, false, "provider_rejected_552"],
    [reply("Message failed", "EMESSAGE", "421 4.7.0 Try again later", "DATA"), "failed", true, true, "provider_deferred_421"],
    [reply("Data command failed", "EENVELOPE", "451 4.3.0 Mail server temporarily rejected message", "DATA"), "failed", true, true, "provider_deferred_451"],
    [err("Missing SMTP", "ECONFIG"), "unknown", undefined, undefined, "provider_error_unclassified"],
    [err("Invalid recipient", "EENVELOPE", { command: "API" }), "unknown", undefined, undefined, "provider_refusal_unverifiable"],
    [err("all recipients were rejected", "EENVELOPE", { responseCode: 550, command: "RCPT TO" }), "unknown", undefined, undefined, "provider_refusal_unverifiable"],
    [err("Message failed", "EMESSAGE", { responseCode: 550, response: "250 OK", command: "DATA" }), "unknown", undefined, undefined, "provider_refusal_unverifiable"],
    [err("Message failed", "EMESSAGE", { responseCode: 550, response: "550 no", command: "RCPT TO" }), "unknown", undefined, undefined, "provider_refusal_unverifiable"],
    [err("Invalid login", "EAUTH", { responseCode: 535, response: "535 no", command: "DATA" }), "unknown", undefined, undefined, "provider_refusal_unverifiable"],
    [err("Connection timeout", "ETIMEDOUT", { command: "CONN" }), "unknown", undefined, undefined, "provider_timeout_unknown_phase"],
    [err("Greeting never received", "ETIMEDOUT", { command: "CONN" }), "unknown", undefined, undefined, "provider_timeout_unknown_phase"],
    [err("connect ECONNREFUSED", "ESOCKET", { command: "CONN", syscall: "connect" }), "unknown", undefined, undefined, "provider_connection_lost"],
    [err("getaddrinfo ENOTFOUND", "EDNS", { syscall: "getaddrinfo" }), "unknown", undefined, undefined, "provider_connection_lost"],
    [err("may have accepted", "ETIMEDOUT", { deliveryPhase: "before_transport", deliveryCode: "claim_lost" }), "unknown", undefined, undefined, "provider_timeout_unknown_phase"],
    [err("x", undefined, { deliveryPhase: "before_transport", deliveryCode: "not_handed_to_provider" }), "unknown", undefined, undefined, "provider_error_unclassified"],
    [err("Timeout", "ETIMEDOUT", { command: "CONN" }), "unknown", undefined, undefined, "provider_timeout_unknown_phase"],
    [err("Connection closed unexpectedly", "ECONNECTION", { command: "CONN" }), "unknown", undefined, undefined, "provider_connection_lost"],
    [err("read ECONNRESET", "ESOCKET", { command: "CONN", syscall: "read" }), "unknown", undefined, undefined, "provider_connection_lost"],
    [err("no provider answer", "EDEADLINE"), "unknown", undefined, undefined, "provider_no_answer_deadline"],
    [new Error("weird"), "unknown", undefined, undefined, "provider_error_unclassified"],
    [null, "unknown", undefined, undefined, "provider_error_unclassified"],
  ];
  for (const [e, outcome, retryable, inRunRetry, code] of rows) {
    const c = C(e);
    assert.equal(c.outcome, outcome, code); assert.equal(c.code, code); assert.equal(c.retryable, retryable, code); assert.equal(c.inRunRetry, inRunRetry, code);
  }
});

test("EU-02 a resolved provider result is accepted only for an accepted, not rejected, recipient", () => {
  const I = D.classifyTransportInfo;
  assert.equal(I({ accepted: ["Owner@Example.test"], rejected: [], response: "250 2.0.0 OK" }, "owner@example.test").outcome, "accepted");
  assert.equal(I({ accepted: [{ address: "owner@example.test" }], rejected: [] }, "owner@example.test").outcome, "accepted");
  assert.equal(I({ accepted: ["owner@example.test"], rejected: [], response: "250 ok" }, "owner@example.test").responseCode, 250);
  // R3 (review E2 continuation): a refusal needs every field to agree — the recipient alone in `rejected`, nothing accepted, a
  // present 4xx/5xx reply code. A listed rejection without a code is incomplete; beside another accepted address, inconsistent.
  assert.deepEqual([I({ accepted: [], rejected: ["owner@example.test"], response: "550 5.1.1 no" }, "owner@example.test").outcome, I({ accepted: [], rejected: ["owner@example.test"], response: "550 5.1.1 no" }, "owner@example.test").code], ["failed", "provider_rejected_recipient"]);
  for (const [info, code] of [[{ accepted: [], rejected: ["owner@example.test"] }, "provider_result_incomplete"], [{ accepted: ["other@example.test"], rejected: ["owner@example.test"] }, "provider_result_inconsistent"]])
    assert.deepEqual([I(info, "owner@example.test").outcome, I(info, "owner@example.test").code], ["unknown", code], JSON.stringify(info));
  // R2 (review E2): a well-formed result that lists the recipient NOWHERE establishes neither acceptance nor refusal
  for (const info of [{ accepted: [], rejected: [], response: "250 OK" }, { accepted: [], rejected: [] }, { accepted: [], rejected: ["other@example.test"], response: "250 OK" }])
    assert.deepEqual([I(info, "owner@example.test").outcome, I(info, "owner@example.test").code], ["unknown", "provider_result_indeterminate"], JSON.stringify(info));
  // R3: another ACCEPTED address contradicts the single-recipient envelope (was: indeterminate) — still unknown, never accepted
  assert.deepEqual([I({ accepted: ["other@example.test"], rejected: [] }, "owner@example.test").outcome, I({ accepted: ["other@example.test"], rejected: [] }, "owner@example.test").code], ["unknown", "provider_result_inconsistent"]);
  // R1 (D4): a result that cannot be interpreted, or contradicts itself, does not establish a refusal — the message was handed
  // over, so it is UNKNOWN (held, never re-sent), not "failed"
  for (const [info, code] of [[{}, "provider_result_malformed"], [null, "provider_result_malformed"], [{ accepted: "owner@example.test" }, "provider_result_malformed"],
    [{ accepted: ["owner@example.test"], rejected: ["owner@example.test"] }, "provider_result_inconsistent"], [{ accepted: ["owner@example.test"], rejected: [], response: "550 no" }, "provider_result_inconsistent"]])
    assert.deepEqual([I(info, "owner@example.test").outcome, I(info, "owner@example.test").code], ["unknown", code], JSON.stringify(info));
});

test("EU-03 receipt paths: only safely addressable identities and a YYYY-MM-DD business date", () => {
  assert.equal(D.receiptPath("daily_snapshot", "tenantA", "bizA", "2026-09-08"), "email_delivery/daily_snapshot/tenantA/bizA/2026-09-08");
  for (const args of [["daily_snapshot", "t/a", "b", "2026-09-08"], ["daily_snapshot", "t", "b.c", "2026-09-08"], ["daily_snapshot", "t", "b:c", "2026-09-08"], ["daily_snapshot", "t", "b", "2026-9-8"],
    ["daily_snapshot", "", "b", "2026-09-08"], ["daily_snapshot", "t", "b", null], ["Daily", "t", "b", "2026-09-08"], ["daily_snapshot", "t", "x".repeat(129), "2026-09-08"]])
    assert.equal(D.receiptPath(...args), null, JSON.stringify(args));
  assert.equal(D.recipientHash(" Owner@Example.test "), D.recipientHash("owner@example.test"));
  assert.match(D.recipientRef("owner@example.test"), /^rcpt:[0-9a-f]{12}$/);
});

// the state machine through deliverWithReceipt with a stub send that records whether the provider was reached
const PATH = "email_delivery/daily_snapshot/tenantA/bizA/2026-09-08";
// the in-memory RTDB with the Admin SDK's transaction protocol (cold cache first; see sdkTransactions)
const sdkDb = () => sdkTransactions(makeDb(), "email_delivery");
const base = { kind: "daily_snapshot", tenantId: "tenantA", bizId: "bizA", businessDate: "2026-09-08", recipient: "owner@example.test", clock: () => 1_000_000, sleep: async () => {} };
const accepting = (calls) => async () => { const a = D.currentDeliveryAttempt(); await a.beforeTransport(); calls.push(a.messageId); a.info = { messageId: a.messageId, accepted: ["owner@example.test"], rejected: [] }; };
const stored = (state, extra = {}) => ({ v: D.RECEIPT_VERSION, kind: "daily_snapshot", tenantId: "tenantA", bizId: "bizA", businessDate: "2026-09-08", state, claimId: "c0", attempt: 1, claimedAt: 0, recipientHash: "h", updatedAt: 0, history: [], ...extra });

test("EU-04 the claim state machine on stored receipts", async () => {
  const cases = [
    [null, "accepted", 1, 1],
    [stored("accepted"), "skipped:already_accepted", 0, null],
    [stored("unknown"), "skipped:unknown_requires_reconciliation", 0, null],
    [stored("claimed", { leaseUntil: 2_000_000 }), "skipped:in_progress", 0, null],
    [stored("sending", { leaseUntil: 2_000_000 }), "skipped:in_progress", 0, null],
    [stored("claimed", { leaseUntil: 500_000 }), "accepted", 1, 1],
    [stored("sending", { leaseUntil: 500_000 }), "skipped:unknown_requires_reconciliation", 0, null],
    [stored("failed", { retryable: true, attempt: 1 }), "accepted", 1, 2],
    [stored("failed", { retryable: true, attempt: 3 }), "skipped:failed_final", 0, null],
    [stored("failed", { retryable: false, attempt: 1 }), "skipped:failed_final", 0, null],
    [{ some: "thing" }, "skipped:receipt_unreadable", 0, null],
    [stored("weird"), "skipped:receipt_unreadable", 0, null],
  ];
  for (const [seed, want, sends, attempt] of cases) {
    const db = sdkDb(); if (seed) db.seed(PATH, seed);
    const calls = [];
    const r = await D.deliverWithReceipt({ ...base, db, send: accepting(calls) });
    assert.equal(r.outcome === "skipped" ? "skipped:" + r.code : r.outcome, want, JSON.stringify(seed));
    assert.equal(calls.length, sends, want);
    if (attempt !== null) assert.equal(db.read(PATH).attempt, attempt);
  }
  // the stale "sending" receipt is converted, durably, to unknown
  const db = sdkDb(); db.seed(PATH, stored("sending", { leaseUntil: 500_000 }));
  await D.deliverWithReceipt({ ...base, db, send: accepting([]) });
  assert.deepEqual([db.read(PATH).state, db.read(PATH).outcome.code], ["unknown", "invocation_lost_during_send"]);
});

test("EU-05 the provider is reached only after the attempt is durably marked; a lost claim aborts before the provider", async () => {
  // the mark is written before the hand-over
  let db = sdkDb(); let seenState = null;
  await D.deliverWithReceipt({ ...base, db, send: async () => { const a = D.currentDeliveryAttempt(); await a.beforeTransport(); seenState = db.read(PATH).state; a.info = { accepted: ["owner@example.test"], rejected: [], messageId: "m" }; } });
  assert.equal(seenState, "sending");
  // another invocation took the receipt over between claim and hand-over: abort, never hand over
  db = sdkDb(); let reached = false;
  const r = await D.deliverWithReceipt({ ...base, db, send: async () => { db.seed(PATH + "/claimId", "someone-else"); const a = D.currentDeliveryAttempt(); await a.beforeTransport(); reached = true; } });
  assert.equal(reached, false); assert.deepEqual([r.outcome, r.code], ["failed", "claim_lost"]);
  // a render failure before sendEmail is a retryable failure, nothing handed over
  db = sdkDb();
  const r2 = await D.deliverWithReceipt({ ...base, db, send: async () => { throw new Error("render failed"); } });
  assert.deepEqual([r2.outcome, r2.code, db.read(PATH).state, db.read(PATH).retryable], ["failed", "failed_before_send", "failed", true]);
  // no send function result at all (sendEmail never called) is unknown, never success
  db = sdkDb();
  const r3 = await D.deliverWithReceipt({ ...base, db, send: async () => { await D.currentDeliveryAttempt().beforeTransport(); } });
  assert.deepEqual([r3.outcome, r3.code], ["unknown", "provider_result_missing"]);
  // an invalid scope never touches the store
  db = sdkDb();
  const r4 = await D.deliverWithReceipt({ ...base, tenantId: "a/b", db, send: accepting([]) });
  assert.deepEqual([r4.outcome, r4.code, db.read("email_delivery")], ["failed", "invalid_delivery_scope", null]);
});

test("EU-06 lib/sendEmail.js: bounded SMTP session; the deadline may only be lowered", async () => {
  const { import: imp } = await buildSandbox();
  const S = await imp("lib/sendEmail.js");
  assert.deepEqual({ ...S.SMTP_TIMEOUTS }, { connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 30000, dnsTimeout: 10000 });
  assert.equal(S.SEND_DEADLINE_MS, 60000);
  process.env.SMTP_EMAIL = "sender@example.test"; process.env.SMTP_APP_PASSWORD = "fixture-app-password-not-real";
  installSmtp([SMTP.accept()]);
  await S.sendEmail("x@example.test", "s", "<p>h</p>");
  const opts = globalThis.__SMTP_TRANSPORTS.at(-1);
  for (const [k, v] of Object.entries(S.SMTP_TIMEOUTS)) assert.equal(opts[k], v, k);
  // a valid, lower value bounds a stalled provider
  process.env.EMAIL_SEND_DEADLINE_MS = "150"; installSmtp([SMTP.hang()]);
  assert.equal(await S.sendEmail("x@example.test", "s", "h").then(() => "resolved", (e) => e.code), "EDEADLINE");
  // invalid or larger values are ignored (the 60 s default stays): a provider answering after 400 ms is not cut off
  const slow = () => (mail) => new Promise((r) => setTimeout(() => r({ messageId: "m", accepted: [mail.to], rejected: [] }), 400));
  for (const value of ["999999", "abc", "0", "-5", "1.5"]) {
    process.env.EMAIL_SEND_DEADLINE_MS = value; installSmtp([slow()]);
    assert.equal(await S.sendEmail("x@example.test", "s", "h").then(() => "resolved", (e) => e.code), "resolved", value);
  }
  delete process.env.EMAIL_SEND_DEADLINE_MS;
});

test("EU-07 the alert digest is readable Hebrew (the double-encoded text is repaired byte-exactly; wording unchanged)", async () => {
  const src = readFileSync(join(REPO, "lib", "sendEmail.js"), "utf8");
  assert.ok(!/[ÃÂ×ðâ][\u0080-ÿ]/.test(src), "no double-encoded UTF-8 sequence remains");
  const { import: imp } = await buildSandbox();
  const S = await imp("lib/sendEmail.js");
  process.env.SMTP_EMAIL = "sender@example.test"; process.env.SMTP_APP_PASSWORD = "fixture-app-password-not-real";
  const smtp = installSmtp([SMTP.accept()]);
  await S.sendAlertDigest("owner@example.test", "מסעדה א", [{ severity: "critical", title: "עלות עובדים", message: "גבוהה" }, { severity: "warning", title: "מכירות", message: "נמוכות" }]);
  assert.equal(smtp.calls[0].subject, "🔴 1 התראות קריטיות — מסעדה א");
  const smtp2 = installSmtp([SMTP.accept()]);
  await S.sendAlertDigest("owner@example.test", "מסעדה א", [{ severity: "info", title: "t", message: "m" }]);
  assert.equal(smtp2.calls[0].subject, "📊 דוח בוקר — מסעדה א — 1 תובנות");
});

test("EU-08 a finalization only lands on the receipt this attempt claimed; a receipt another invocation took over is left as it is", async () => {
  // while this attempt was with the provider, another invocation (after the lease) converted the receipt, or a newer claim
  // replaced it: our late outcome must not overwrite it, and is reported as not recorded
  for (const other of [stored("unknown", { claimId: "other", outcome: { code: "invocation_lost_during_send" } }), stored("sending", { claimId: "other", attempt: 2, leaseUntil: 9_000_000 })]) {
    const db = sdkDb();
    const r = await D.deliverWithReceipt({ ...base, db, send: async () => {
      const a = D.currentDeliveryAttempt(); await a.beforeTransport();
      db.seed(PATH, other);
      a.info = { accepted: ["owner@example.test"], rejected: [], messageId: a.messageId };
    } });
    assert.deepEqual([r.outcome, r.receipt], ["accepted", "write_failed"], other.state);
    assert.deepEqual(db.read(PATH), other, "the other invocation's receipt is untouched");
  }
});

test("EU-09 one provider hand-off per attempt: a second sendEmail in the same message is refused and the attempt is unknown, never re-sent", async () => {
  const db = sdkDb(); const calls = [];
  const twice = async () => {
    const a = D.currentDeliveryAttempt();
    await a.beforeTransport(); calls.push("first"); a.info = { accepted: ["owner@example.test"], rejected: [], messageId: a.messageId };
    await a.beforeTransport(); calls.push("second");
  };
  const r = await D.deliverWithReceipt({ ...base, db, send: twice });
  assert.deepEqual(calls, ["first"], "the second hand-off never reaches the provider");
  assert.deepEqual([r.outcome, r.code, db.read(PATH).state], ["unknown", "multiple_provider_handoffs", "unknown"]);
  const again = await D.deliverWithReceipt({ ...base, db, send: twice });
  assert.deepEqual([again.outcome, again.code, calls.length], ["skipped", "unknown_requires_reconciliation", 1]);
  assert.deepEqual([D.classifyTransportError(Object.assign(new Error("x"), { code: "EMULTISEND" })).outcome], ["unknown"]);
});
