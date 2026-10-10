// Daily Email reliability R4 — behavioural regressions for the independent R3 review's blocking finding (E2/D4 continuation:
// a PRESENT but empty / null / unreadable field of a resolved provider result was read as if it were ABSENT, so
// { accepted: [to], response: "250 …", envelope: { to: [] } } became a final acceptance). LOCAL author candidate; pending
// independent Codex review. The REAL route api/daily-snapshot/run.ts, the REAL snapshot builder / presenter and the REAL
// lib/sendEmail.js + lib/emailDelivery.js run in the sandbox of test/support/daily-email-harness.mjs; only the database, the
// token verifier and the SMTP provider are replaced. Route cases assert provider calls, the durable receipt (state, code,
// attempt, history), the HTTP / run result of three invocations, and that no address / reply text reaches a response or log.
//   DR4-01  the reviewed shape — accepted beside a 250 reply with a PRESENT EMPTY envelope.to: unknown / inconsistent, held,
//           one provider call, never delivered / already_accepted
//   DR4-02  every other present-but-not-valid envelope: null, {}, { to: null }, a non-list to, a throwing envelope / to getter,
//           and the refusal beside an empty envelope: unknown, held, never accepted and never failed_final
//   DR4-03  refusal details that name no readable recipient / code ([null], [{}], code only, recipient only, a throwing record)
//           or are present but empty: unknown, never a definite refusal
//   DR4-04  a throwing getter on any top-level field (response, accepted, rejected, rejectedErrors, envelope) is unreadable
//           evidence — malformed — never "absent"
//   DR4-05  controls: acceptance with a matching envelope and with no envelope is delivered once; a fully consistent resolved
//           refusal (matching details and envelope), the adapter's RCPT 550 and DATA 550 are failed and final; a 4xx DATA
//           deferral is retried in the run; an error after the hand-off (timeout) stays unknown — the R2 / R3 behaviour
//   DR4-06  the pure table: the four evidence states (absent / unreadable / empty-or-conflicting / valid) of every field
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
const ok = (m, extra = {}) => ({ messageId: m.messageId, accepted: [m.to], rejected: [], response: "250 2.0.0 OK fake", ...extra });
const no = (m, extra = {}) => ({ messageId: m.messageId, accepted: [], rejected: [m.to], response: "550 5.1.1 fake-detail", ...extra });
const thrower = () => { throw new Error("fake-detail"); };
async function runs(times) { const out = []; for (let i = 0; i < times; i++) out.push(await cron(AT + i * 2 * LEASE)); return out; }
async function captured(fn) {
  const lines = [], orig = { log: console.log, warn: console.warn, error: console.error };
  for (const k of Object.keys(orig)) console[k] = (...a) => lines.push(a.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" "));
  try { return { value: await fn(), lines }; } finally { Object.assign(console, orig); }
}
function assertPrivate(rs, lines, label) {
  const text = JSON.stringify(rs.map((r) => r.body)) + "\n" + lines.join("\n");
  for (const secret of ["owner-a@example.test", OTHER, "2.0.0 OK", "5.1.1", "fake-detail"]) assert.ok(!text.includes(secret), label + ": no " + secret + " in a response or log");
}
async function heldCase(label, answer, code) {
  one(); const smtp = installSmtp([async (mail) => answer(mail), async (mail) => ok(mail)]);
  const { value: rs, lines } = await captured(() => runs(3));
  assert.deepEqual([rs[0].statusCode, rs[0].body.status, row(rs[0]).outcome, row(rs[0]).code, row(rs[0]).settlement], [500, "completed_with_failures", "unknown", code, "unknown"], label + ": first run");
  for (const r of rs.slice(1)) assert.deepEqual([r.statusCode, row(r).code, row(r).settlement, r.body.unknownCount, r.body.successCount], [500, "unknown_requires_reconciliation", "unknown", 1, 0], label + ": later run");
  assert.ok(rs.every((r) => !["delivered", "failed"].includes(row(r).settlement) && !["already_accepted", "failed_final"].includes(row(r).code)), label + ": never accepted, never a definite failure");
  assert.equal(smtp.calls.length, 1, label + ": exactly one provider call (no automatic resend)");
  assert.deepEqual(view(receipt()), { state: "unknown", code, attempt: 1, retryable: undefined }, label + ": durable receipt");
  assert.deepEqual(receipt().history.map((h) => [h.attempt, h.state]), [[1, "unknown"]], label + ": one attempt recorded");
  assertPrivate(rs, lines, label);
}

test("DR4-01 the reviewed shape: an accepted result with a present EMPTY envelope.to is unknown, held, never delivered", async () => {
  await heldCase("accepted + 250 + envelope.to [] (review shape)", (m) => ok(m, { envelope: { to: [] } }), "provider_result_inconsistent");
  await heldCase("accepted + 250 + envelope { from, to: [] }", (m) => ok(m, { envelope: { from: "x@example.test", to: [] } }), "provider_result_inconsistent");
});

test("DR4-02 every other present-but-not-valid envelope is unknown and held; a refusal beside an empty envelope is not final", async () => {
  const M = "provider_result_malformed", I = "provider_result_inconsistent";
  for (const [label, answer, code] of [
    ["envelope null", (m) => ok(m, { envelope: null }), M],
    ["envelope {} (no to)", (m) => ok(m, { envelope: {} }), M],
    ["envelope.to null", (m) => ok(m, { envelope: { to: null } }), M],
    ["envelope.to not a list", (m) => ok(m, { envelope: { to: "fake-detail" } }), M],
    ["envelope a string", (m) => ok(m, { envelope: "fake-detail" }), M],
    ["envelope getter throws", (m) => Object.defineProperty(ok(m), "envelope", { get: thrower, enumerable: true }), M],
    ["envelope.to getter throws", (m) => ok(m, { envelope: Object.defineProperty({}, "to", { get: thrower }) }), M],
    ["envelope.to repeats the recipient", (m) => ok(m, { envelope: { to: [m.to, m.to] } }), I],
    ["refusal + envelope.to []", (m) => no(m, { envelope: { to: [] } }), I],
    ["refusal + envelope null", (m) => no(m, { envelope: null }), M],
  ]) await heldCase(label, answer, code);
});

test("DR4-03 refusal details that name no readable recipient / code, or are present but empty, never establish a refusal", async () => {
  const M = "provider_result_malformed", I = "provider_result_inconsistent";
  for (const [label, answer, code] of [
    ["rejectedErrors [null] (review shape)", (m) => no(m, { rejectedErrors: [null] }), M],
    ["rejectedErrors [{}]", (m) => no(m, { rejectedErrors: [{}] }), M],
    ["rejectedErrors code only", (m) => no(m, { rejectedErrors: [{ responseCode: 550 }] }), M],
    ["rejectedErrors recipient only", (m) => no(m, { rejectedErrors: [{ recipient: m.to }] }), M],
    ["rejectedErrors record getter throws", (m) => no(m, { rejectedErrors: [Object.defineProperty({ responseCode: 550 }, "recipient", { get: thrower })] }), M],
    ["rejectedErrors present but empty", (m) => no(m, { rejectedErrors: [] }), I],
  ]) await heldCase(label, answer, code);
});

test("DR4-04 a throwing getter on any top-level field is unreadable evidence (malformed), never 'absent'", async () => {
  const M = "provider_result_malformed";
  for (const k of ["response", "accepted", "rejected", "rejectedErrors", "envelope"])
    await heldCase("throwing " + k + " beside an otherwise valid acceptance", (m) => Object.defineProperty(ok(m, { envelope: { to: [m.to] } }), k, { get: thrower, enumerable: true }), M);
  await heldCase("throwing response beside a refusal", (m) => Object.defineProperty(no(m), "response", { get: thrower, enumerable: true }), M);
});

test("DR4-05 controls keep their R2 / R3 behaviour", async () => {
  // acceptance: matching envelope, no envelope, envelope with from — delivered once, then already_accepted, no resend
  for (const ans of [async (m) => ok(m, { envelope: { from: "x@example.test", to: [m.to] } }), async (m) => ok(m), SMTP.accept(), async (m) => ok(m, { rejectedErrors: [] })]) {
    one(); const smtp = installSmtp([ans, SMTP.accept()]);
    const { value: rs, lines } = await captured(() => runs(3));
    assert.deepEqual(rs.map((r) => [r.statusCode, row(r).code, row(r).settlement]), [[200, null, "delivered"], [200, "already_accepted", "delivered"], [200, "already_accepted", "delivered"]]);
    assert.equal(smtp.calls.length, 1);
    assert.equal(receipt().state, "accepted");
    assertPrivate(rs, lines, "acceptance control");
  }
  // definite refusals: a fully consistent resolved refusal (with and without matching details / envelope), the adapter's
  // RCPT 550 rejected promise — failed and final, never re-sent
  for (const ans of [async (m) => no(m), async (m) => no(m, { rejectedErrors: [{ responseCode: 550, recipient: m.to }], envelope: { to: [m.to] } }), SMTP.rejectRecipient()]) {
    one(); const smtp = installSmtp([ans, SMTP.accept()]);
    const rs = await runs(2);
    assert.equal(rs[1].body.results[0].code, "failed_final");
    assert.equal(smtp.calls.length, 1);
    assert.equal(receipt().state, "failed");
    assert.equal(receipt().retryable, false);
  }
  // trustworthy non-acceptance: a 4xx deferral after DATA (a rejected promise) is retried within the run
  one(); let smtp = installSmtp([SMTP.transient(), SMTP.accept()]);
  let rs = await runs(2);
  assert.deepEqual(rs.map((r) => [r.statusCode, row(r).code]), [[200, null], [200, "already_accepted"]]);
  assert.deepEqual(receipt().history.map((h) => [h.attempt, h.state, h.code]), [[1, "failed", "provider_deferred_421"], [2, "accepted", null]]);
  // an error after the hand-off without an SMTP reply stays unknown and is never re-sent (E1)
  one(); smtp = installSmtp([SMTP.socketTimeout(), SMTP.accept()]);
  rs = await runs(3);
  assert.deepEqual(rs.map((r) => row(r).settlement), ["unknown", "unknown", "unknown"]);
  assert.equal(smtp.calls.length, 1);
  assert.equal(receipt().state, "unknown");
});

test("DR4-06 the four evidence states of every field (pure table)", () => {
  const to = "owner@example.test", C = (info) => { const c = classifyTransportInfo(info, to); return [c.outcome, c.code ?? null]; };
  const A = { accepted: [to], rejected: [], response: "250 OK" }, R = { accepted: [], rejected: [to], response: "550 no" };
  const get = (o, k) => Object.defineProperty({ ...o }, k, { get: thrower, enumerable: true });
  const rows = [
    // valid
    [A, "accepted", null],
    [{ ...A, envelope: { to: [to] } }, "accepted", null],
    [{ ...A, envelope: { to: [{ address: " Owner@Example.Test " }] } }, "accepted", null],
    [{ ...A, rejectedErrors: [] }, "accepted", null],
    [{ accepted: [to] }, "accepted", null],                                       // absent rejected / response / envelope
    [R, "failed", "provider_rejected_recipient"],
    [{ ...R, rejectedErrors: [{ responseCode: 550, recipient: to }], envelope: { to: [to] } }, "failed", "provider_rejected_recipient"],
    // empty or conflicting (present, readable)
    [{ ...A, envelope: { to: [] } }, "unknown", "provider_result_inconsistent"],
    [{ ...A, envelope: { to: [OTHER] } }, "unknown", "provider_result_inconsistent"],
    [{ ...A, envelope: { to: [to, to] } }, "unknown", "provider_result_inconsistent"],
    [{ ...R, envelope: { to: [] } }, "unknown", "provider_result_inconsistent"],
    [{ ...R, rejectedErrors: [] }, "unknown", "provider_result_inconsistent"],
    [{ ...R, rejectedErrors: [{ responseCode: 550, recipient: OTHER }] }, "unknown", "provider_result_inconsistent"],
    [{ ...R, rejectedErrors: [{ responseCode: 421, recipient: to }] }, "unknown", "provider_result_inconsistent"],
    [{ ...A, accepted: [to, to] }, "unknown", "provider_result_inconsistent"],
    [{ ...R, rejected: [to, to] }, "unknown", "provider_result_inconsistent"],
    [{ ...A, rejectedErrors: [{ responseCode: 550, recipient: OTHER }] }, "unknown", "provider_result_inconsistent"],
    [{ accepted: [], rejected: [to], response: "250 2.0.0 OK" }, "unknown", "provider_result_inconsistent"],   // R3's fix, kept
    // unreadable (present but not interpretable)
    [{ ...A, envelope: null }, "unknown", "provider_result_malformed"],
    [{ ...A, envelope: {} }, "unknown", "provider_result_malformed"],
    [{ ...A, envelope: { to: null } }, "unknown", "provider_result_malformed"],
    [{ ...A, envelope: { to: [""] } }, "unknown", "provider_result_malformed"],
    [{ ...A, envelope: 7 }, "unknown", "provider_result_malformed"],
    [{ ...R, rejectedErrors: [null] }, "unknown", "provider_result_malformed"],
    [{ ...R, rejectedErrors: [{}] }, "unknown", "provider_result_malformed"],
    [{ ...R, rejectedErrors: [{ responseCode: 550 }] }, "unknown", "provider_result_malformed"],
    [{ ...R, rejectedErrors: [{ recipient: to }] }, "unknown", "provider_result_malformed"],
    [{ ...R, rejectedErrors: [{ responseCode: "550", recipient: to }] }, "unknown", "provider_result_malformed"],
    [{ ...A, accepted: [""] }, "unknown", "provider_result_malformed"],
    [{ ...A, rejected: null }, "unknown", "provider_result_malformed"],
    [{ ...A, response: null }, "unknown", "provider_result_malformed"],
    [get(A, "response"), "unknown", "provider_result_malformed"],
    [get(A, "accepted"), "unknown", "provider_result_malformed"],
    [get(A, "rejected"), "unknown", "provider_result_malformed"],
    [get(A, "rejectedErrors"), "unknown", "provider_result_malformed"],
    [get(A, "envelope"), "unknown", "provider_result_malformed"],
    [{ ...A, envelope: Object.defineProperty({}, "to", { get: thrower }) }, "unknown", "provider_result_malformed"],
    // incomplete / indeterminate (unchanged)
    [{ accepted: [], rejected: [to] }, "unknown", "provider_result_incomplete"],
    [{ accepted: [], rejected: [], response: "250 OK" }, "unknown", "provider_result_indeterminate"],
  ];
  const label = (i) => { try { return JSON.stringify(i); } catch { return "hostile object"; } };
  for (const [info, outcome, code] of rows) assert.deepEqual(C(info), [outcome, code], label(info));
  // a status code or a generic success field alone never establishes acceptance
  for (const info of [{ response: "250 OK" }, { accepted: [], response: "250 OK", ok: true }, { success: true, accepted: [] }, { response: "250 OK", envelope: { to: [to] } }])
    assert.equal(C(info)[0], "unknown", JSON.stringify(info));
  // the classification never depends on the address being echoed in the code (no recipient data leaves the classifier)
  assert.equal(JSON.stringify(classifyTransportInfo({ ...A, envelope: { to: [] } }, to)).includes("example.test"), false);
});
