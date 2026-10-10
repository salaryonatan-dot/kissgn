// Daily Email reliability R3 — behavioural regressions for the independent R2 review's blocking finding (E2 continuation:
// a contradictory RESOLVED provider result was recorded as a definite rejection). LOCAL author candidate; pending independent
// Codex review. The REAL route api/daily-snapshot/run.ts, the REAL snapshot builder / presenter and the REAL lib/sendEmail.js +
// lib/emailDelivery.js run in the sandbox of test/support/daily-email-harness.mjs; only the database, the token verifier and the
// SMTP provider are replaced. Every case asserts observable effects: provider calls, the durable receipt (state, code, attempt,
// history), the HTTP / run result of three invocations, and that no address reaches the response or the logs.
//   DR3-01  the reviewed contradiction — recipient rejected beside the 250 end-of-DATA reply (with and without another address
//           accepted): unknown / provider_result_inconsistent, one provider call, never re-sent, never failed_final
//   DR3-02  other contradictions the single-recipient SMTP contract excludes: another address accepted (alone or beside the
//           recipient), the recipient accepted beside a rejected address / non-empty rejectedErrors / a 354 reply, the recipient
//           rejected beside a 354 reply or beside another rejected address, an envelope naming another recipient, refusal details
//           naming another recipient or another reply code: unknown, held
//   DR3-03  missing fields: a rejection without any reply code is unknown / provider_result_incomplete (no list alone
//           establishes a refusal); a result without the accepted list is malformed
//   DR3-04  malformed fields: a non-string / code-less reply text, a non-list rejectedErrors, an unreadable envelope list, an
//           unreadable refusal-detail code: unknown / provider_result_malformed, held
//   DR3-05  controls: ordinary acceptance (with and without reply text) is delivered once; a definite SMTP refusal raised by the
//           adapter (RCPT TO 550) and a fully consistent resolved refusal (recipient only, 5xx, matching details) are failed and
//           final; a 4xx DATA deferral is retried within the run — all with exactly the provider calls they had in R2
//   DR3-06  privacy: no case puts the recipient, another address or the provider reply text in a response or a log line
//   DR3-07  the classifier table: every field combination above, judged together (pure)
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSandbox, installSmtp, SMTP, seedWorld, freezeClock, runCron, RECEIPTS, T, B } from "../support/daily-email-harness.mjs";
import { classifyTransportInfo } from "../../lib/emailDelivery.js";

const { route } = await buildSandbox();
const AT = Date.UTC(2026, 8, 8, 4, 5);
const DATE = "2026-09-08";
const LEASE = 10 * 60 * 1000;
const PATH = `${RECEIPTS}/${T}/${B}/${DATE}`;
const receipt = () => globalThis.__DB.read(PATH);
async function at(ms, fn) { const restore = freezeClock(ms); try { return await fn(); } finally { restore(); } }
const cron = (ms = AT) => at(ms, () => runCron(route));
const one = () => seedWorld({ withSecondBiz: false, withSecondTenant: false });
const row = (r) => r.body.results[0];
const view = (rec) => rec && { state: rec.state, code: rec.code ?? null, attempt: rec.attempt, retryable: rec.retryable };
const OTHER = "someone-else@example.test";
const accepted = (mail) => ({ messageId: mail.messageId, accepted: [mail.to], rejected: [], response: "250 2.0.0 OK fake" });
async function runs(times) { const out = []; for (let i = 0; i < times; i++) out.push(await cron(AT + i * 2 * LEASE)); return out; }
/** capture console output during fn (the route / sender / receipt logs) */
async function captured(fn) {
  const lines = [], orig = { log: console.log, warn: console.warn, error: console.error };
  for (const k of Object.keys(orig)) console[k] = (...a) => lines.push(a.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" "));
  try { return { value: await fn(), lines }; } finally { Object.assign(console, orig); }
}
function assertUnknownHeld(rs, smtp, code, label) {
  assert.deepEqual([rs[0].statusCode, rs[0].body.status, row(rs[0]).outcome, row(rs[0]).code, row(rs[0]).settlement], [500, "completed_with_failures", "unknown", code, "unknown"], label + ": first run");
  for (const r of rs.slice(1)) assert.deepEqual([r.statusCode, row(r).code, row(r).settlement, r.body.unknownCount, r.body.successCount], [500, "unknown_requires_reconciliation", "unknown", 1, 0], label + ": later run");
  assert.ok(rs.every((r) => row(r).code !== "failed_final" && row(r).settlement !== "failed"), label + ": never a definite failure");
  assert.equal(smtp.calls.length, 1, label + ": exactly one provider call");
  assert.deepEqual(view(receipt()), { state: "unknown", code, attempt: 1, retryable: undefined }, label + ": durable receipt");
  assert.deepEqual(receipt().history.map((h) => [h.attempt, h.state]), [[1, "unknown"]], label + ": one attempt recorded");
}
function assertPrivate(rs, lines, label) {
  const text = JSON.stringify(rs.map((r) => r.body)) + "\n" + lines.join("\n");
  for (const secret of ["owner-a@example.test", OTHER, "2.0.0 OK", "5.1.1", "fake-detail"]) assert.ok(!text.includes(secret), label + ": no " + secret + " in a response or log");
}
async function heldCase(label, answer, code) {
  one(); const smtp = installSmtp([async (mail) => answer(mail), async (mail) => accepted(mail)]);
  const { value: rs, lines } = await captured(() => runs(3));
  assertUnknownHeld(rs, smtp, code, label);
  assertPrivate(rs, lines, label);
}

test("DR3-01 the reviewed contradiction: rejected beside the 250 end-of-DATA reply is unknown, held, never failed_final", async () => {
  await heldCase("rejected + 250 (review shape)", (mail) => ({ messageId: mail.messageId, accepted: [], rejected: [mail.to], response: "250 2.0.0 OK" }), "provider_result_inconsistent");
  await heldCase("another accepted + rejected + 250 (review shape)", (mail) => ({ messageId: mail.messageId, accepted: [OTHER], rejected: [mail.to], response: "250 2.0.0 OK" }), "provider_result_inconsistent");
  await heldCase("the shared harness shape SMTP.acceptedNone", async (mail) => SMTP.acceptedNone()(mail, { at: 1 }), "provider_result_inconsistent");
});

test("DR3-02 other combinations the single-recipient SMTP contract excludes are unknown and held", async () => {
  const I = "provider_result_inconsistent";
  for (const [label, answer] of [
    ["another address accepted alone", (m) => ({ messageId: m.messageId, accepted: [OTHER], rejected: [], response: "250 2.0.0 OK" })],
    ["the recipient AND another accepted", (m) => ({ messageId: m.messageId, accepted: [m.to, OTHER], rejected: [], response: "250 2.0.0 OK" })],
    ["accepted beside another rejected address", (m) => ({ messageId: m.messageId, accepted: [m.to], rejected: [OTHER], response: "250 2.0.0 OK" })],
    ["accepted beside refusal details", (m) => ({ messageId: m.messageId, accepted: [m.to], rejected: [], rejectedErrors: [{ responseCode: 550, recipient: OTHER }], response: "250 2.0.0 OK" })],
    ["accepted with a 354 reply", (m) => ({ messageId: m.messageId, accepted: [m.to], rejected: [], response: "354 go ahead" })],
    ["rejected with a 354 reply", (m) => ({ messageId: m.messageId, accepted: [], rejected: [m.to], response: "354 go ahead" })],
    ["rejected beside another rejected address", (m) => ({ messageId: m.messageId, accepted: [], rejected: [m.to, OTHER], response: "550 5.1.1 no" })],
    ["accepted, envelope names another recipient", (m) => ({ messageId: m.messageId, accepted: [m.to], rejected: [], response: "250 2.0.0 OK", envelope: { from: "x@example.test", to: [OTHER] } })],
    ["rejected, refusal details name another recipient", (m) => ({ messageId: m.messageId, accepted: [], rejected: [m.to], rejectedErrors: [{ responseCode: 550, recipient: OTHER }], response: "550 5.1.1 no" })],
    ["rejected, refusal details carry another reply code", (m) => ({ messageId: m.messageId, accepted: [], rejected: [m.to], rejectedErrors: [{ responseCode: 421, recipient: m.to }], response: "550 5.1.1 no" })],
  ]) await heldCase(label, answer, I);
});

test("DR3-03 missing fields: a rejection without a reply code is incomplete; no accepted list is malformed", async () => {
  await heldCase("rejected, no response", (m) => ({ messageId: m.messageId, accepted: [], rejected: [m.to] }), "provider_result_incomplete");
  await heldCase("rejected, no accepted list", (m) => ({ messageId: m.messageId, rejected: [m.to], response: "550 5.1.1 no" }), "provider_result_malformed");
});

test("DR3-04 malformed fields are unknown and held", async () => {
  const M = "provider_result_malformed";
  for (const [label, answer] of [
    ["numeric response", (m) => ({ messageId: m.messageId, accepted: [], rejected: [m.to], response: 550 })],
    ["code-less response text", (m) => ({ messageId: m.messageId, accepted: [m.to], rejected: [], response: "OK fake-detail" })],
    ["rejectedErrors not a list", (m) => ({ messageId: m.messageId, accepted: [], rejected: [m.to], rejectedErrors: "fake-detail", response: "550 5.1.1 no" })],
    ["envelope.to unreadable", (m) => ({ messageId: m.messageId, accepted: [m.to], rejected: [], response: "250 2.0.0 OK", envelope: { to: [{ get address() { throw new Error("fake-detail"); } }] } })],
    ["refusal detail with a non-reply code", (m) => ({ messageId: m.messageId, accepted: [], rejected: [m.to], rejectedErrors: [{ responseCode: "550", recipient: m.to }], response: "550 5.1.1 no" })],
  ]) await heldCase(label, answer, M);   // R4: an unreadable refusal-detail code is malformed (was inconsistent)
});

test("DR3-05 controls keep their R2 behaviour: acceptance, definite refusals and a deferral", async () => {
  // acceptance with and without reply text: one call, delivered, then already_accepted
  for (const ans of [SMTP.accept(), async (m) => ({ messageId: m.messageId, accepted: [m.to], rejected: [] }), async (m) => ({ messageId: m.messageId, accepted: [m.to], rejected: [], response: "250 2.0.0 OK", envelope: { from: "x@example.test", to: [m.to] } })]) {
    one(); const smtp = installSmtp([ans]);
    const rs = await runs(3);
    assert.deepEqual(rs.map((r) => [r.statusCode, row(r).code, row(r).settlement]), [[200, null, "delivered"], [200, "already_accepted", "delivered"], [200, "already_accepted", "delivered"]]);
    assert.equal(smtp.calls.length, 1);
    assert.deepEqual(view(receipt()), { state: "accepted", code: null, attempt: 1, retryable: undefined });
  }
  // the adapter's definite refusal (RCPT TO 550, a rejected promise): failed, final, one call
  one(); let smtp = installSmtp([SMTP.rejectRecipient(), SMTP.accept()]);
  let rs = await runs(3);
  assert.deepEqual(rs.map((r) => [r.statusCode, row(r).code]), [[500, "provider_rejected_550"], [500, "failed_final"], [500, "failed_final"]]);
  assert.equal(smtp.calls.length, 1); assert.deepEqual(view(receipt()), { state: "failed", code: "provider_rejected_550", attempt: 1, retryable: false });
  // a fully consistent resolved refusal (recipient only, 5xx, matching details): failed, final, one call
  for (const ans of [
    async (m) => ({ messageId: m.messageId, accepted: [], rejected: [m.to], response: "550 5.1.1 no" }),
    async (m) => ({ messageId: m.messageId, accepted: [], rejected: [m.to], rejectedErrors: [{ responseCode: 550, recipient: m.to }], response: "550 5.1.1 no", envelope: { to: [m.to] } }),
  ]) {
    one(); smtp = installSmtp([ans, SMTP.accept()]);
    rs = await runs(2);
    assert.deepEqual(rs.map((r) => [r.statusCode, row(r).code]), [[500, "provider_rejected_recipient"], [500, "failed_final"]]);
    assert.equal(smtp.calls.length, 1); assert.deepEqual(view(receipt()), { state: "failed", code: "provider_rejected_recipient", attempt: 1, retryable: false });
  }
  // a 4xx deferral after DATA (a rejected promise): retried within the run, accepted on attempt 2
  one(); smtp = installSmtp([SMTP.transient(), SMTP.accept()]);
  rs = await runs(2);
  assert.deepEqual(rs.map((r) => [r.statusCode, row(r).code]), [[200, null], [200, "already_accepted"]]);
  assert.equal(smtp.calls.length, 2);
  assert.deepEqual(receipt().history.map((h) => [h.attempt, h.state, h.code]), [[1, "failed", "provider_deferred_421"], [2, "accepted", null]]);
});

test("DR3-07 the classifier judges the fields together (pure table)", () => {
  const to = "owner@example.test", C = (info) => { const c = classifyTransportInfo(info, to); return [c.outcome, c.code ?? null]; };
  const rows = [
    // [info, outcome, code]
    [{ accepted: [to], rejected: [], response: "250 2.0.0 OK" }, "accepted", null],
    [{ accepted: [" Owner@Example.Test "], rejected: [] }, "accepted", null],
    [{ accepted: [to], rejected: [], response: "250 OK", envelope: { to: [to] }, rejectedErrors: [] }, "accepted", null],
    [{ accepted: [], rejected: [to], response: "550 5.1.1 no" }, "failed", "provider_rejected_recipient"],
    [{ accepted: [], rejected: [to], response: "450 4.2.0 busy", rejectedErrors: [{ responseCode: 450, recipient: to }] }, "failed", "provider_rejected_recipient"],
    [{ accepted: [], rejected: [to], response: "250 2.0.0 OK" }, "unknown", "provider_result_inconsistent"],
    [{ accepted: [OTHER], rejected: [to], response: "250 2.0.0 OK" }, "unknown", "provider_result_inconsistent"],
    [{ accepted: [OTHER], rejected: [to], response: "550 5.1.1 no" }, "unknown", "provider_result_inconsistent"],
    [{ accepted: [OTHER], rejected: [to] }, "unknown", "provider_result_inconsistent"],
    [{ accepted: [OTHER], rejected: [] }, "unknown", "provider_result_inconsistent"],
    [{ accepted: [to, OTHER], rejected: [] }, "unknown", "provider_result_inconsistent"],
    [{ accepted: [to], rejected: [to], response: "250 OK" }, "unknown", "provider_result_inconsistent"],
    [{ accepted: [to], rejected: [OTHER], response: "250 OK" }, "unknown", "provider_result_inconsistent"],
    [{ accepted: [to], rejected: [], response: "550 no" }, "unknown", "provider_result_inconsistent"],
    [{ accepted: [to], rejected: [], response: "354 go" }, "unknown", "provider_result_inconsistent"],
    [{ accepted: [to], rejected: [], rejectedErrors: [{}], response: "250 OK" }, "unknown", "provider_result_malformed"],   // R4: an unreadable detail record (was inconsistent)
    [{ accepted: [to], rejected: [], response: "250 OK", envelope: { to: [OTHER] } }, "unknown", "provider_result_inconsistent"],
    [{ accepted: [to], rejected: [], response: "250 OK", envelope: { to: [to, OTHER] } }, "unknown", "provider_result_inconsistent"],
    [{ accepted: [], rejected: [to, OTHER], response: "550 no" }, "unknown", "provider_result_inconsistent"],
    [{ accepted: [], rejected: [to], response: "354 go" }, "unknown", "provider_result_inconsistent"],
    [{ accepted: [], rejected: [to], response: "550 no", rejectedErrors: [{ responseCode: 421 }] }, "unknown", "provider_result_malformed"],   // R4: names no recipient (was inconsistent)
    [{ accepted: [], rejected: [to], response: "550 no", rejectedErrors: [{ responseCode: 550, recipient: OTHER }] }, "unknown", "provider_result_inconsistent"],
    [{ accepted: [], rejected: [to], response: "550 no", rejectedErrors: [{ responseCode: 550, recipient: 7 }] }, "unknown", "provider_result_malformed"],   // R4: unreadable recipient (was inconsistent)
    [{ accepted: [], rejected: [to], response: "550 no", rejectedErrors: [{ responseCode: "550" }] }, "unknown", "provider_result_malformed"],   // R4: unreadable code, no recipient (was inconsistent)
    [{ accepted: [], rejected: [to] }, "unknown", "provider_result_incomplete"],
    [{ accepted: [], rejected: [], response: "250 OK" }, "unknown", "provider_result_indeterminate"],
    [{ accepted: [], rejected: [OTHER], response: "250 OK" }, "unknown", "provider_result_indeterminate"],
    [{ accepted: [], rejected: [] }, "unknown", "provider_result_indeterminate"],
    [{ rejected: [to], response: "550 no" }, "unknown", "provider_result_malformed"],
    [{ accepted: [], rejected: [to], response: 550 }, "unknown", "provider_result_malformed"],
    [{ accepted: [to], rejected: [], response: "OK" }, "unknown", "provider_result_malformed"],
    [{ accepted: [to], rejected: [], response: "" }, "unknown", "provider_result_malformed"],
    [{ accepted: [], rejected: [to], rejectedErrors: "x", response: "550 no" }, "unknown", "provider_result_malformed"],
    [{ accepted: [], rejected: [to], rejectedErrors: Array(51).fill({}), response: "550 no" }, "unknown", "provider_result_malformed"],
    [{ accepted: [to], rejected: [], response: "250 OK", envelope: { to: "x" } }, "unknown", "provider_result_malformed"],
    [{ accepted: [to], rejected: "x" }, "unknown", "provider_result_malformed"],
    [null, "unknown", "provider_result_malformed"],
  ];
  for (const [info, outcome, code] of rows) assert.deepEqual(C(info), [outcome, code], JSON.stringify(info));
  // hostile objects prove nothing
  const revoked = Proxy.revocable({}, {}); revoked.revoke();
  assert.deepEqual(C(revoked.proxy), ["unknown", "provider_result_malformed"]);
  // R4 (review E2/D4 continuation): an unreadable reply text is UNREADABLE evidence, never "absent" (R3 accepted the first and
  // called the second incomplete)
  assert.deepEqual(C({ accepted: [to], rejected: [], get response() { throw new Error("x"); } }), ["unknown", "provider_result_malformed"]);
  assert.deepEqual(C({ accepted: [], rejected: [to], get response() { throw new Error("x"); } }), ["unknown", "provider_result_malformed"]);
});
