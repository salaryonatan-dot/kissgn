// Daily Email delivery R6 — the independent R4 review's blocking finding E4-01: a resolved provider result of the wrong
// top-level TYPE (an array decorated with accepted / rejected / response / envelope) passed `typeof info === "object"` and was
// recorded as a final acceptance (receipt `accepted`, repeat `already_accepted`). R6 validates the STRUCTURE of the whole
// resolved result before any field is read as evidence. The REAL route api/daily-snapshot/run.ts, the REAL lib/sendEmail.js +
// lib/emailDelivery.js run in the sandbox of test/support/daily-email-harness.mjs; only the database, the token verifier and
// the SMTP provider are replaced. No network, no real e-mail. LOCAL behaviour only.
//
//   DR6-01  pure table: a decorated array, a class instance, an object with a foreign prototype, a function, a Proxy whose
//           prototype cannot be read, a revoked Proxy, an array envelope, an instance envelope and a list-shaped refusal detail
//           are malformed; the adapter's own shape (plain record, null-prototype record included) is unchanged
//   DR6-02  the real route: a decorated-array result → unknown / provider_result_malformed, run 500, receipt `unknown`, the next
//           invocation `unknown_requires_reconciliation`, ONE provider call (held, never re-sent); the same for an array
//           envelope and for an instance result (the review's regression, now a committed test)
//   DR6-03  controls unchanged: the adapter's resolved shape (with envelope) is delivered once and already_accepted after; a
//           consistent adapter refusal is failed/final; R4's present-but-empty envelope stays unknown; R5's owner decisions
//           (a `:` tenant delivered, a nameless business refused on the manual path) are untouched by R6
//   DR6-04  privacy: nothing of the malformed result (its elements, its response text) reaches the log, the row or the receipt
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSandbox, installSmtp, SMTP, seedWorld, freezeClock, runCron, runManual, captureConsole, RECEIPTS, T, B } from "../support/daily-email-harness.mjs";
import * as D from "../../lib/emailDelivery.js";

const { route } = await buildSandbox();
const AT = Date.UTC(2026, 8, 8, 4, 5), DATE = "2026-09-08", LEASE = 10 * 60 * 1000;
const at = async (ms, fn) => { const u = freezeClock(ms); try { return await fn(); } finally { u(); } };
const cron = (ms = AT) => at(ms, () => runCron(route));
const one = () => seedWorld({ withSecondBiz: false, withSecondTenant: false });
const receipt = () => globalThis.__DB.read(`${RECEIPTS}/${T}/${B}/${DATE}`);
const TO = "owner@example.test";
const SECRET = "private-marker@example.test";
const ok = { accepted: [TO], rejected: [], response: "250 2.0.0 OK", envelope: { from: "s@example.test", to: [TO] } };
const C = (info) => { const c = D.classifyTransportInfo(info, TO); return [c.outcome, c.code ?? null]; };
class Resolved { constructor(o) { Object.assign(this, o); } }

test("DR6-01 the structure of the whole resolved result is validated before any evidence is read", () => {
  const malformed = ["unknown", "provider_result_malformed"];
  // the review's blocker and its siblings: the right properties on the wrong kind of value
  assert.deepEqual(C(Object.assign([], ok)), malformed, "a decorated array");
  assert.deepEqual(C(Object.assign([TO], ok)), malformed, "a non-empty decorated array");
  assert.deepEqual(C(new Resolved(ok)), malformed, "a class instance");
  assert.deepEqual(C(Object.assign(Object.create({ accepted: [TO] }), { rejected: [], response: "250 OK" })), malformed, "evidence inherited through a foreign prototype");
  assert.deepEqual(C(Object.assign(() => {}, ok)), malformed, "a function");
  assert.deepEqual(C(new Proxy({ ...ok }, { getPrototypeOf() { throw new Error(SECRET); } })), malformed, "a Proxy whose prototype cannot be read");
  { const p = Proxy.revocable({ ...ok }, {}); p.revoke(); assert.deepEqual(C(p.proxy), malformed, "a revoked Proxy"); }
  assert.deepEqual(C([]), malformed); assert.deepEqual(C([ok]), malformed, "the result wrapped in a list");
  // nested structure
  assert.deepEqual(C({ ...ok, envelope: Object.assign([], { to: [TO] }) }), malformed, "an array envelope");
  assert.deepEqual(C({ ...ok, envelope: new Resolved({ to: [TO] }) }), malformed, "an instance envelope");
  assert.deepEqual(C({ accepted: [], rejected: [TO], response: "550 5.1.1 no", rejectedErrors: [[{ recipient: TO, responseCode: 550 }]] }), malformed, "a list-shaped refusal detail");
  assert.deepEqual(C({ accepted: [], rejected: [TO], response: "550 5.1.1 no", rejectedErrors: [Object.assign([], { recipient: TO, responseCode: 550 })] }), malformed, "a DECORATED list as a refusal detail (would otherwise be a final refusal)");
  // the adapter's own shape is unchanged (nodemailer 6.10.1 smtp-transport: a plain object literal; envelope a plain object)
  assert.deepEqual(C(ok), ["accepted", null]);
  assert.deepEqual(C(Object.assign(Object.create(null), ok)), ["accepted", null], "a null-prototype record is a record");
  assert.deepEqual(C({ accepted: [TO], rejected: [], response: "250 OK" }), ["accepted", null], "R4: an absent envelope proves nothing");
  assert.deepEqual(C({ ...ok, envelope: { to: [] } }), ["unknown", "provider_result_inconsistent"], "R4: a present empty envelope");
  assert.deepEqual(C({ accepted: [], rejected: [TO], response: "550 5.1.1 no", rejectedErrors: [Object.assign(new Error("x"), { recipient: TO, responseCode: 550 })] }), ["failed", "provider_rejected_recipient"], "a refusal detail may be an Error instance (the adapter's _formatError)");
  assert.deepEqual(C(null), malformed); assert.deepEqual(C("250 OK"), malformed); assert.deepEqual(C(undefined), malformed);
});

test("DR6-02 the real route: a wrong-typed resolved result is unknown, held and never re-sent", async () => {
  const shapes = [
    ["decorated array", (m) => Object.assign([], { accepted: [m.to], rejected: [], response: "250 2.0.0 OK " + SECRET, envelope: { to: [m.to] }, messageId: m.messageId })],
    ["array envelope", (m) => ({ accepted: [m.to], rejected: [], response: "250 2.0.0 OK", envelope: Object.assign([], { to: [m.to] }), messageId: m.messageId })],
    ["instance result", (m) => new Resolved({ accepted: [m.to], rejected: [], response: "250 2.0.0 OK", envelope: { to: [m.to] }, messageId: m.messageId })],
  ];
  for (const [label, answer] of shapes) {
    one(); const smtp = installSmtp([async (mail) => answer(mail), SMTP.accept()]);
    const { value: first, lines } = await captureConsole(() => cron());
    assert.equal(first.statusCode, 500, label + ": never completed");
    const row = first.body.results[0];
    assert.deepEqual([first.body.status, row.outcome, row.code, row.settlement, row.receipt], ["completed_with_failures", "unknown", "provider_result_malformed", "unknown", "recorded"], label);
    assert.deepEqual([receipt().state, receipt().code], ["unknown", "provider_result_malformed"], label + ": the receipt holds unknown");
    const repeat = await cron(AT + 2 * LEASE);
    assert.deepEqual([repeat.statusCode, repeat.body.results[0].code, repeat.body.results[0].settlement, smtp.calls.length], [500, "unknown_requires_reconciliation", "unknown", 1], label + ": held, one provider call");
    assert.ok(!lines.some((l) => l.includes(SECRET)), label + ": response text never logged");
  }
});

test("DR6-03 controls: the adapter's own shape, a consistent refusal, R4's empty envelope and R5's decisions are unchanged", async () => {
  // the adapter's resolved shape (with the envelope it always reports) is delivered once; a repeat is already_accepted
  one(); let smtp = installSmtp([async (m) => ({ accepted: [m.to], rejected: [], response: "250 2.0.0 OK", envelope: { from: "s@example.test", to: [m.to] }, messageId: m.messageId, envelopeTime: 3, messageTime: 5, messageSize: 1024 })]);
  let r = await cron();
  assert.deepEqual([r.statusCode, r.body.results[0].settlement, receipt().state], [200, "delivered", "accepted"]);
  r = await cron(AT + 2 * LEASE);
  assert.deepEqual([r.body.results[0].code, smtp.calls.length], ["already_accepted", 1]);
  // a consistent adapter refusal (the rejected promise) is failed / final: no retry
  one(); smtp = installSmtp([SMTP.rejectRecipient()]);
  r = await cron();
  assert.deepEqual([r.statusCode, r.body.results[0].outcome, r.body.results[0].settlement, smtp.calls.length], [500, "failed", "failed", 1]);
  // R4: a present but empty envelope stays unknown / inconsistent
  one(); smtp = installSmtp([async (m) => ({ accepted: [m.to], rejected: [], response: "250 2.0.0 OK", envelope: { to: [] }, messageId: m.messageId })]);
  r = await cron();
  assert.deepEqual([r.statusCode, r.body.results[0].code, receipt().state], [500, "provider_result_inconsistent", "unknown"]);
  // R5: a `:` tenant is delivered with its own receipt; a nameless business is refused on the manual path before any send
  const db = seedWorld({ withSecondBiz: false, withSecondTenant: false }); smtp = installSmtp([SMTP.accept()]);
  for (const [k, v] of [["entries", db.read(`tenants/${T}/biz:${B}:entries`)], ["config", { _v: JSON.stringify({ businessName: "Colon" }) }], ["fixed", { _v: "[]" }]]) db.seed(`tenants/acme:il/biz:bizX:${k}`, v);
  db.seed("tenants/acme:il/app/business", { _v: JSON.stringify([{ id: "bizX", name: "Colon" }]) }); db.seed("tenants/acme:il/app/users", db.read(`tenants/${T}/app/users`));
  r = await cron();
  assert.deepEqual([r.statusCode, r.body.results.length, db.read(`${RECEIPTS}/acme:il/bizX/${DATE}`).state], [200, 2, "accepted"]);
  one(); smtp = installSmtp([SMTP.accept()]); globalThis.__DB.seed(`tenants/${T}/app/business`, { _v: JSON.stringify([{ id: B }]) });
  r = await at(AT, () => runManual(route));
  assert.deepEqual([r.statusCode, r.body.code, smtp.calls.length], [422, "business_name_unavailable", 0]);
});

test("DR6-04 privacy: nothing of a malformed result reaches the log, the row or the receipt", async () => {
  one(); const smtp = installSmtp([async (m) => Object.assign([SECRET, { address: SECRET }], { accepted: [m.to], rejected: [SECRET], response: "250 " + SECRET, envelope: { to: [m.to] }, messageId: "<" + SECRET + ">" })]);
  const { value: r, lines } = await captureConsole(() => cron());
  const text = JSON.stringify(r.body) + JSON.stringify(receipt()) + lines.join("\n");
  assert.equal(text.includes(SECRET), false, "no element, address, response text or Message-ID of the malformed result is kept");
  assert.deepEqual([r.body.results[0].code, receipt().state, smtp.calls.length], ["provider_result_malformed", "unknown", 1]);
});
