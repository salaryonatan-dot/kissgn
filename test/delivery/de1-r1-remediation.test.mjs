// Daily Email reliability R1 — behavioral regressions for the independent review's findings D1–D4 (and the executable,
// still-pending combined-flow requirement C1). The REAL route api/daily-snapshot/run.ts, the REAL snapshot builder / presenter
// and the REAL lib/sendEmail.js + lib/emailDelivery.js run in the sandbox of test/support/daily-email-harness.mjs; only the
// database, the token verifier and the SMTP provider are replaced. Receipt transactions follow the SDK's cold-cache protocol.
// No network, no real e-mail. These tests prove LOCAL behavior only — never inbox delivery or exactly-once delivery.
//   DR1-01  D1  an unresolved active claim (sending / claimed, lease running) is "incomplete" (503), never "completed"
//   DR1-02  D1  a concurrent invocation BEFORE the owner's finalization is incomplete; the owner's later final outcome is
//               then observed (already_accepted) — one provider call in total
//   DR1-03  D1  abandoned claims: a stale `claimed` is re-sent (the provider was never reached); a stale `sending` becomes
//               unknown and is never re-sent
//   DR1-04  D1  provider acceptance followed by a finalization failure: never completed (500 → 503 within the lease → 500
//               unknown after it), never re-sent; a lost acknowledgement of a stored acceptance is later observed
//   DR1-05  D1  late completion: a provider answer (acceptance OR refusal) arriving after the deadline changes nothing,
//               raises nothing, and is never followed by a re-send
//   DR1-06  D1  run outcome table: completed ONLY when every row is a durably recorded acceptance or a contract no-send
//   DR1-07  D2  the manual POST response and every POST error path carry no address and no address hash
//   DR1-08  D3  absent vs malformed recipient data; malformed elements; a selected malformed address is a visible failure and
//               never moves the send to another user; the existing selection policy is preserved
//   DR1-09  D4  untrusted error codes / messages on the recipient read and in the route's catch never reach the log
//   DR1-10  D4  untrusted provider Message-IDs, error fields, nested errors, throwing getters, wrong types and oversized values
//               never reach logs, responses or receipts; the classification stays bounded
//   DR1-11  D4  the bounded representations (unit); DR1-11b lib/sendEmail.js outside an attempt uses its own Message-ID
//   DR1-12      receipt contents: exactly the allow-listed fields; tenant / business isolation of the receipt and its hash
//   DR1-C1      combined-flow acceptance (todo removed by I1 once the real route passed it on the reconciled tree; G9) — a failed build keeps the run incomplete
import { test as nodeTest } from "node:test";
import { historicalTest } from "../support/m1-a1-inspection.mjs";
const legacyRecipientTest = historicalTest(new URL("../../", import.meta.url), "d963532287f5390df9baef5c7a18a109400233b8", "test/delivery/de1-r1-remediation.test.mjs");
const test = (title, ...args) => /^DR1-(07 |08 |08b |09 )/.test(title) ? legacyRecipientTest(title, ...args) : nodeTest(title, ...args);
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { buildSandbox, installSmtp, SMTP, seedWorld, freezeClock, runCron, runManual, captureConsole, RECEIPTS, T, B, B2, T2, B3, SUBSCRIPTIONS, enabledSubscriptionRecord } from "../support/daily-email-harness.mjs";
import * as D from "../../lib/emailDelivery.js";

const { route } = await buildSandbox();
const AT = Date.UTC(2026, 8, 8, 4, 5);
const DATE = "2026-09-08";
const LEASE = 10 * 60 * 1000;
const PATH = (t = T, b = B, d = DATE) => `${RECEIPTS}/${t}/${b}/${d}`;
const receipt = (t, b, d) => globalThis.__DB.read(PATH(t, b, d));
const sha = (s) => createHash("sha256").update(String(s).trim().toLowerCase()).digest("hex");
async function at(ms, fn) { const restore = freezeClock(ms); try { return await fn(); } finally { restore(); } }
const cron = (ms = AT) => at(ms, () => runCron(route));
const one = () => seedWorld({ withSecondBiz: false, withSecondTenant: false });
const ADDRESSES = ["owner-a@example.test", "owner-b@example.test", "viewer-a@example.test", "private@example.test", "sensitive@example.test"];
/** Does `text` carry an address, a full address hash or a 12-hex prefix of one (pseudonymous references count as leaks)? */
function leaks(text) {
  const s = String(text);
  if (/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/.test(s.replace(/@delivery\.marjin\.app/g, ""))) return true;
  return ADDRESSES.some((a) => s.includes(a) || s.includes(sha(a).slice(0, 12)));
}
/** The receipt without its recipientHash — a retained, pseudonymous SHA-256 (asserted separately), never an address. */
const scrub = (node) => JSON.parse(JSON.stringify(node ?? null, (k, v) => { if (k === "recipientHash") { assert.match(String(v), /^([0-9a-f]{64}|x)$/); return undefined; } return v; }));
const stored = (t, b, state, extra = {}) => ({ v: "MARJIN_EMAIL_RECEIPT/1", kind: "daily_snapshot", tenantId: t, bizId: b, businessDate: DATE, state, claimId: "other-invocation", attempt: 1, recipientHash: "x", updatedAt: AT - 60000, history: [], ...extra });

test("DR1-01 (D1) an unresolved active claim is reported as incomplete (503), never as a clean completed run", async () => {
  for (const phase of ["sending", "claimed"]) {
    one(); const smtp = installSmtp([SMTP.accept()]);
    globalThis.__DB.seed(PATH(), stored(T, B, phase, { claimedAt: AT - 60000, leaseUntil: AT + 60000 }));
    const r = await cron();
    assert.equal(r.statusCode, 503, phase + ": " + JSON.stringify(r.body));
    assert.equal(r.body.status, "incomplete");
    assert.equal(r.body.inProgressCount, 1);
    assert.deepEqual([r.body.results[0].outcome, r.body.results[0].code, r.body.results[0].settlement, r.body.results[0].phase], ["skipped", "in_progress", "pending", phase]);
    assert.equal(smtp.calls.length, 0, "the other invocation's claim is never taken over early");
    assert.equal(receipt(T, B).state, phase, "the receipt is left as it is");
  }
  // one delivered business + one pending business: still incomplete, not completed
  seedWorld({ withSecondTenant: false }); let smtp = installSmtp([SMTP.accept()]);
  globalThis.__DB.seed(PATH(T, B2), stored(T, B2, "sending", { claimedAt: AT - 60000, leaseUntil: AT + 60000 }));
  let r = await cron();
  assert.deepEqual([r.statusCode, r.body.status], [503, "incomplete"]);
  assert.deepEqual(r.body.results.map((x) => x.settlement), ["delivered", "pending"]);
  assert.equal(smtp.calls.length, 1);
  // pending + a confirmed failure: the failure dominates (500 completed_with_failures)
  seedWorld({ withSecondTenant: false }); smtp = installSmtp([SMTP.rejectRecipient()]);
  globalThis.__DB.seed(PATH(T, B2), stored(T, B2, "sending", { claimedAt: AT - 60000, leaseUntil: AT + 60000 }));
  r = await cron();
  assert.deepEqual([r.statusCode, r.body.status], [500, "completed_with_failures"]);
  assert.deepEqual(r.body.results.map((x) => x.settlement), ["failed", "pending"]);
});

test("DR1-02 (D1) a concurrent invocation before the owner's finalization is incomplete; the later final outcome is then observed", async () => {
  one();
  let release; const held = new Promise((res) => { release = res; });
  const smtp = installSmtp([async (mail) => { await held; return { messageId: mail.messageId, accepted: [mail.to], rejected: [], response: "250 2.0.0 OK" }; }]);
  const restore = freezeClock(AT);
  try {
    const first = runCron(route);
    for (let i = 0; i < 400 && smtp.calls.length === 0; i++) await new Promise((r) => setTimeout(r, 5));
    assert.equal(smtp.calls.length, 1, "the first invocation has handed the message over");
    assert.equal(receipt(T, B).state, "sending");
    const second = await runCron(route);                                          // before the first one finalizes
    assert.deepEqual([second.statusCode, second.body.status, second.body.results[0].settlement, second.body.results[0].phase], [503, "incomplete", "pending", "sending"]);
    assert.equal(smtp.calls.length, 1, "no second hand-off");
    release();
    const done = await first;
    assert.deepEqual([done.statusCode, done.body.status, done.body.results[0].settlement], [200, "completed", "delivered"]);
    const third = await runCron(route);                                           // the final outcome is now observed
    assert.deepEqual([third.statusCode, third.body.status, third.body.results[0].code, third.body.results[0].settlement], [200, "completed", "already_accepted", "delivered"]);
    // several concurrent repeats after the acceptance: all observe it, none sends
    const many = await Promise.all([runCron(route), runCron(route), runCron(route)]);
    assert.ok(many.every((x) => x.statusCode === 200 && x.body.results[0].code === "already_accepted"));
  } finally { restore(); }
  assert.equal(smtp.calls.length, 1, "one provider call in total");
});

test("DR1-03 (D1) abandoned claims: a stale `claimed` is re-sent; a stale `sending` becomes unknown and is never re-sent", async () => {
  one(); let smtp = installSmtp([SMTP.accept()]);
  globalThis.__DB.seed(PATH(), stored(T, B, "claimed", { claimedAt: AT - 2 * LEASE, leaseUntil: AT - LEASE }));
  let r = await cron();
  assert.deepEqual([r.statusCode, r.body.status, r.body.results[0].settlement], [200, "completed", "delivered"]);
  assert.equal(smtp.calls.length, 1, "never handed over before ⇒ sent now");
  assert.deepEqual([receipt(T, B).state, receipt(T, B).attempt, receipt(T, B).history[0].state], ["accepted", 1, "abandoned_before_send"]);

  one(); smtp = installSmtp([SMTP.accept()]);
  globalThis.__DB.seed(PATH(), stored(T, B, "sending", { claimedAt: AT - 2 * LEASE, leaseUntil: AT - LEASE, sendingAt: AT - 2 * LEASE }));
  r = await cron();
  assert.deepEqual([r.statusCode, r.body.status, r.body.results[0].code, r.body.results[0].settlement], [500, "completed_with_failures", "unknown_requires_reconciliation", "unknown"]);
  assert.deepEqual([receipt(T, B).state, receipt(T, B).outcome.code], ["unknown", "invocation_lost_during_send"]);
  r = await cron(AT + 3 * LEASE);
  assert.deepEqual([r.statusCode, r.body.results[0].settlement], [500, "unknown"]);
  assert.equal(smtp.calls.length, 0, "possibly accepted ⇒ never re-sent automatically");
});

test("DR1-04 (D1) provider acceptance followed by a finalization failure is never reported completed and never re-sent", async () => {
  const db = one(); const smtp = installSmtp([SMTP.accept()]);
  const ref = db.ref; let failFinal = true;
  db.ref = (p, q) => { const x = ref(p, q); return p.startsWith(RECEIPTS) ? { ...x, transaction: async (fn) => { if (failFinal && db.read(p)?.state === "sending") throw new Error("write lost"); return x.transaction(fn); } } : x; };
  const r1 = await cron();
  failFinal = false;
  assert.deepEqual([r1.statusCode, r1.body.status, r1.body.results[0].settlement, r1.body.unrecordedCount], [500, "completed_with_failures", "unrecorded", 1]);
  const r2 = await cron(AT + 60000);                                   // within the lease: the claim is unresolved
  assert.deepEqual([r2.statusCode, r2.body.status, r2.body.results[0].settlement, r2.body.results[0].phase], [503, "incomplete", "pending", "sending"]);
  const r3 = await cron(AT + LEASE + 60000);                           // after the lease: possibly accepted ⇒ unknown
  assert.deepEqual([r3.statusCode, r3.body.results[0].settlement], [500, "unknown"]);
  assert.equal(smtp.calls.length, 1, "never re-sent");

  // the acceptance WAS stored but its acknowledgement was lost: the first run cannot claim it; the next run observes it
  const db2 = one(); const smtp2 = installSmtp([SMTP.accept()]);
  const ref2 = db2.ref; let lose = true;
  db2.ref = (p, q) => { const x = ref2(p, q); return p.startsWith(RECEIPTS) ? { ...x, transaction: async (fn) => { const before = db2.read(p)?.state; const out = await x.transaction(fn); if (lose && before === "sending") { lose = false; throw new Error("ack lost"); } return out; } } : x; };
  const a = await cron();
  assert.deepEqual([a.statusCode, a.body.results[0].settlement, receipt(T, B).state], [500, "unrecorded", "accepted"]);
  const b = await cron();
  assert.deepEqual([b.statusCode, b.body.status, b.body.results[0].code], [200, "completed", "already_accepted"]);
  assert.equal(smtp2.calls.length, 1);
});

test("DR1-05 (D1) a late provider answer after the deadline changes nothing, raises nothing and is never followed by a re-send", async () => {
  const unhandled = []; const onU = (e) => unhandled.push(e);
  process.on("unhandledRejection", onU);
  process.env.EMAIL_SEND_DEADLINE_MS = "20";
  try {
    for (const [label, late] of [
      ["late acceptance", (mail) => new Promise((res) => setTimeout(() => res({ messageId: mail.messageId, accepted: [mail.to], rejected: [], response: "250 OK" }), 80))],
      ["late refusal", () => new Promise((_, rej) => setTimeout(() => rej(Object.assign(new Error("550 private@example.test"), { code: "EENVELOPE", responseCode: 550 })), 80))],
    ]) {
      one(); const smtp = installSmtp([late]);
      const { value: r, lines } = await captureConsole(() => cron());
      assert.deepEqual([r.statusCode, r.body.results[0].code, r.body.results[0].settlement], [500, "provider_no_answer_deadline", "unknown"], label);
      const atReturn = JSON.stringify(receipt(T, B));
      await new Promise((res) => setTimeout(res, 150));               // the provider settles now
      assert.equal(JSON.stringify(receipt(T, B)), atReturn, label + ": the receipt is not changed by the late answer");
      const again = await cron(AT + 2 * LEASE);
      assert.deepEqual([again.statusCode, again.body.results[0].code], [500, "unknown_requires_reconciliation"], label);
      assert.equal(smtp.calls.length, 1, label + ": never re-sent");
      assert.deepEqual(lines.filter(leaks), [], label + ": logs");
    }
    await new Promise((res) => setTimeout(res, 20));
    assert.deepEqual(unhandled, [], "a late settlement raises no unhandled rejection");
  } finally { delete process.env.EMAIL_SEND_DEADLINE_MS; process.off("unhandledRejection", onU); }
});

test("DR1-06 (D1) run outcome table: 'completed' only when every row is a recorded acceptance or a contract no-send", async () => {
  const lease = { claimedAt: AT - 60000, leaseUntil: AT + 60000 };
  const cases = [
    // [label, seeded receipt or null, provider, expected http, status, settlement]
    ["fresh, accepted and recorded", null, SMTP.accept(), 200, "completed", "delivered"],
    ["already accepted", stored(T, B, "accepted", { messageId: "<x@delivery.marjin.app>" }), SMTP.accept(), 200, "completed", "delivered"],
    ["in progress (sending)", stored(T, B, "sending", lease), SMTP.accept(), 503, "incomplete", "pending"],
    ["unknown held", stored(T, B, "unknown", { code: "provider_connection_lost" }), SMTP.accept(), 500, "completed_with_failures", "unknown"],
    ["failed final", stored(T, B, "failed", { retryable: false, code: "provider_rejected_550" }), SMTP.accept(), 500, "completed_with_failures", "failed"],
    ["unreadable receipt", { garbage: true }, SMTP.accept(), 500, "completed_with_failures", "failed"],
    ["provider unknown now", null, SMTP.closedAfterData(), 500, "completed_with_failures", "unknown"],
    ["provider refused now", null, SMTP.rejectRecipient(), 500, "completed_with_failures", "failed"],
  ];
  for (const [label, seed, behavior, http, status, settlement] of cases) {
    one(); installSmtp([behavior]);
    if (seed) globalThis.__DB.seed(PATH(), seed);
    const r = await cron();
    assert.deepEqual([r.statusCode, r.body.status, r.body.results[0].settlement], [http, status, settlement], label + ": " + JSON.stringify(r.body.results[0]));
  }
  // (The contract no-send `unknown_business_name` is filtered by the real builder before the route — snapshotBuilder.ts
  // logs and drops it — so the route's own no_send branch is defensive and is not reachable through the real builder.)
});

test("DR1-07 (D2) the manual POST response and its error paths carry no address and no address hash", async () => {
  const checkBody = (label, res) => {
    const text = JSON.stringify(res.body);
    assert.equal(leaks(text), false, label + ": " + text);
    assert.equal("emailSentTo" in (res.body || {}), false, label);
    assert.ok(!/recipientHash|rcpt:/.test(text), label);
  };
  seedWorld(); installSmtp([SMTP.accept()]);
  let { value: m, lines } = await captureConsole(() => at(AT, () => runManual(route)));
  assert.deepEqual([m.statusCode, m.body.status, m.body.delivery], [200, "success", { outcome: "accepted", recipient: "owner" }]);
  assert.deepEqual(Object.keys(m.body).sort(), ["delivery", "snapshot", "status"]);
  checkBody("success", m); assert.deepEqual(lines.filter(leaks), []);
  // the existing fallback (owner without an address ⇒ first user with one) is reported as such — never by address
  seedWorld({ users: [{ id: 1, name: "Owner A", role: "owner", firebaseUid: "u_owner_a" }, { id: 2, name: "Viewer", email: "viewer-a@example.test", role: "viewer", firebaseUid: "u_viewer_a" }] }); installSmtp([SMTP.accept()]);
  m = await at(AT, () => runManual(route));
  assert.deepEqual([m.statusCode, m.body.delivery], [200, { outcome: "accepted", recipient: "first_user_with_email" }]); checkBody("fallback", m);
  // provider refusal / unknown / not configured
  for (const [behavior, http] of [[SMTP.rejectRecipient(), 502], [SMTP.closedAfterData(), 504], [async () => { throw Object.assign(new Error("private@example.test"), { code: "private@example.test", responseCode: "550 private@example.test" }); }, 504]]) {
    seedWorld(); installSmtp([behavior]);
    ({ value: m, lines } = await captureConsole(() => at(AT, () => runManual(route))));
    assert.equal(m.statusCode, http); checkBody("provider " + http, m); assert.deepEqual(lines.filter(leaks), [], "logs " + http);
  }
  // recipient problems
  const cases = [[null, 404], [{ bad: "shape" }, 422], [{ _v: JSON.stringify([{ role: "owner", email: "owner-a@example.test, private@example.test" }]) }, 422]];
  for (const [users, http] of cases) {
    const db = seedWorld(); installSmtp([SMTP.accept()]);
    db.seed(`tenants/${T}/app/users`, users);
    m = await at(AT, () => runManual(route));
    assert.equal(m.statusCode, http, JSON.stringify(m.body)); checkBody("recipient " + http, m);
  }
  const db = seedWorld(); installSmtp([SMTP.accept()]);
  const ref = db.ref; db.ref = (p, q) => { const x = ref(p, q); return p === `tenants/${T}/app/users` ? { ...x, once: async () => { throw Object.assign(new Error("private@example.test"), { code: "private@example.test" }); } } : x; };
  m = await at(AT, () => runManual(route));
  assert.equal(m.statusCode, 503); checkBody("recipient unavailable", m);
});

test("DR1-08 (D3) absent vs malformed recipient data; a malformed selected address never moves the send to another user", async () => {
  const owner = { id: 1, name: "Owner A", email: "owner-a@example.test", role: "owner" };
  const viewer = { id: 2, name: "Viewer", email: "viewer-a@example.test", role: "viewer" };
  const env = (v) => ({ _v: JSON.stringify(v) });
  const cases = [
    // legitimate absence / emptiness: nothing to send to
    ["absent node", null, "no_recipient"],
    ["runtime envelope, empty list", env([]), "no_recipient"],
    ["JSON string, empty list", "[]", "no_recipient"],
    ["only placeholder addresses", env([{ role: "owner", email: "x@temp.marjin.app" }]), "no_recipient"],
    ["users without any address", env([{ role: "owner" }, { role: "viewer", email: null }]), "no_recipient"],
    // present but not a supported representation: visible failure, never "empty"
    ["object without _v", { bad: "shape" }, "recipient_data_invalid"],
    ["_v not a string", { _v: 5 }, "recipient_data_invalid"],
    ["_v not JSON", { _v: "[" }, "recipient_data_invalid"],
    ["_v a JSON object", { _v: "{}" }, "recipient_data_invalid"],
    ["string not JSON", "not json", "recipient_data_invalid"],
    ["string of a JSON object", JSON.stringify({ a: owner }), "recipient_data_invalid"],
    ["empty string", "", "recipient_data_invalid"],
    ["number", 42, "recipient_data_invalid"],
    ["boolean", true, "recipient_data_invalid"],
    // malformed elements
    ["a string element", env(["owner-a@example.test", owner]), "recipient_data_invalid"],
    ["a number element", env([7, owner]), "recipient_data_invalid"],
    ["an array element", env([[owner]]), "recipient_data_invalid"],
    ["email of the wrong type", env([{ role: "owner", email: 5 }, viewer]), "recipient_data_invalid"],
    ["email as an object", env([{ role: "owner", email: { address: "owner-a@example.test" } }, viewer]), "recipient_data_invalid"],
    ["role of the wrong type", env([{ role: ["owner"], email: "owner-a@example.test" }, viewer]), "recipient_data_invalid"],
    ["a malformed element after the owner", env([owner, "junk"]), "recipient_data_invalid"],
    // the SELECTED address is malformed: failure, and NOT a fallback to the viewer
    ["owner address list", env([{ role: "owner", email: "owner-a@example.test, private@example.test" }, viewer]), "recipient_invalid"],
    ["owner display-name form", env([{ role: "owner", email: "Owner <owner-a@example.test>" }, viewer]), "recipient_invalid"],
    ["owner not an address", env([{ role: "owner", email: "not-an-address" }, viewer]), "recipient_invalid"],
    ["owner with whitespace", env([{ role: "owner", email: " owner-a@example.test" }, viewer]), "recipient_invalid"],
    ["owner with a line break", env([{ role: "owner", email: "owner-a@example.test\nBcc: private@example.test" }, viewer]), "recipient_invalid"],
    ["owner oversized", env([{ role: "owner", email: "a".repeat(300) + "@example.test" }, viewer]), "recipient_invalid"],
    ["fallback user malformed", env([{ role: "owner" }, { role: "viewer", email: "bad address@example.test" }, viewer]), "recipient_invalid"],
    // the owner is selected first whatever the list order: a valid user listed BEFORE a malformed owner is never used instead
    ["malformed owner after a valid user", env([viewer, { role: "owner", email: "not-an-address" }]), "recipient_invalid"],
    ["malformed super_owner after a valid user", env([viewer, { role: "super_owner", email: "owner-a@example.test;private@example.test" }]), "recipient_invalid"],
  ];
  for (const [label, users, code] of cases) {
    const db = one(); const smtp = installSmtp([SMTP.accept()]);
    db.seed(`tenants/${T}/app/users`, users);
    const { value: r, lines } = await captureConsole(() => cron());
    assert.deepEqual([r.statusCode, r.body.results[0].outcome, r.body.results[0].code, r.body.results[0].settlement], [500, "failed", code, "failed"], label);
    assert.equal(smtp.calls.length, 0, label + ": nothing sent, to anyone");
    assert.equal(receipt(T, B), null, label + ": no claim");
    assert.deepEqual(lines.filter(leaks), [], label + ": logs");
  }
  // supported, well-formed shapes keep the existing selection (owner first; else the first user with a real address)
  const ok = [
    ["runtime envelope", env([viewer, owner]), "owner-a@example.test", "owner"],
    ["raw array", [viewer, owner], "owner-a@example.test", "owner"],
    ["JSON string", JSON.stringify([owner]), "owner-a@example.test", "owner"],
    ["a null hole", env([null, owner]), "owner-a@example.test", "owner"],
    ["super_owner", env([viewer, { role: "super_owner", email: "owner-a@example.test" }]), "owner-a@example.test", "owner"],
    ["owner placeholder ⇒ existing fallback", env([{ role: "owner", email: "o@temp.marjin.app" }, viewer]), "viewer-a@example.test", "first_user_with_email"],
    ["owner without address ⇒ existing fallback", env([{ role: "owner" }, viewer]), "viewer-a@example.test", "first_user_with_email"],
  ];
  for (const [label, users, to, selection] of ok) {
    const db = one(); const smtp = installSmtp([SMTP.accept()]);
    db.seed(`tenants/${T}/app/users`, users);
    const r = await cron();
    assert.deepEqual([r.statusCode, r.body.results[0].settlement, r.body.results[0].recipientSelection], [200, "delivered", selection], label);
    assert.deepEqual(smtp.calls.map((c) => c.to), [to], label);
  }
});

test("DR1-08b (D3) the route's list decoding agrees with the canonical server parser (lib/bizAccess.js parseAppUsers)", async () => {
  const { parseAppUsers } = await import("../../lib/bizAccess.js");
  const corpus = [null, [], [{ role: "owner", email: "owner-a@example.test" }], "[]", "[null]", "x", "", "{}", { _v: "[]" }, { _v: "[{}]" }, { _v: "{}" }, { _v: "[" }, { _v: 5 }, { bad: 1 }, 42, true, false, 0];
  for (const raw of corpus) {
    let canonical; try { canonical = Array.isArray(parseAppUsers(raw)) ? "list" : "?"; } catch { canonical = "malformed"; }
    const db = one(); installSmtp([SMTP.accept()]);
    db.seed(`tenants/${T}/app/users`, raw);
    const r = await cron();
    const code = r.body.results[0].code;
    const route = code === "recipient_data_invalid" ? "malformed" : "list";
    assert.equal(route, canonical, JSON.stringify(raw) + " → " + code);
  }
});

test("DR1-09 (D4) untrusted error data on the recipient read and in the route's catch never reaches the log", async () => {
  const hostile = () => { const e = new Error("read failed for private@example.test"); e.code = "private@example.test"; e.name = "private@example.test"; e.cause = new Error("sensitive@example.test"); return e; };
  let db = one(); installSmtp([SMTP.accept()]);
  let ref = db.ref; db.ref = (p, q) => { const x = ref(p, q); return p === `tenants/${T}/app/users` ? { ...x, once: async () => { throw hostile(); } } : x; };
  let c = await captureConsole(() => cron());
  assert.deepEqual([c.value.statusCode, c.value.body.results[0].code], [500, "recipient_unavailable"]);
  assert.deepEqual(c.lines.filter(leaks), []); assert.ok(c.lines.some((l) => l.includes("recipient read failed") && l.includes("(recipient_unavailable)")));
  // DE1 R5 (owner decision G10): a registry read that throws is the bounded 503 `registry_unavailable` of the pre-send gate
  // (it was the route's generic 500); a builder failure after the gate is the bounded 503 `snapshot_build_failed`. In both,
  // nothing of the thrown value reaches the log or the body.
  for (const thrown of [hostile(), "private@example.test", { name: { toString: () => "private@example.test" }, message: "sensitive@example.test" },
    new Proxy({}, { get() { throw new Error("private@example.test"); } })]) {
    db = seedWorld(); installSmtp([SMTP.accept()]);
    ref = db.ref; db.ref = (p, q) => { const x = ref(p, q); return p === `tenants/${T}/app/business` ? { ...x, once: async () => { throw thrown; } } : x; };
    c = await captureConsole(() => at(AT, () => runManual(route)));
    assert.deepEqual([c.value.statusCode, c.value.body], [503, { error: "Business registry temporarily unavailable; email not sent", code: "registry_unavailable", tenantId: T, bizId: B }]);
    assert.deepEqual(c.lines.filter(leaks), [], c.lines.join("\n"));
    assert.ok(c.lines.some((l) => l.includes("manual send refused") && l.includes('"code":"registry_unavailable"')), c.lines.join("\n"));
    // the gate passes (registry readable); the builder's own read throws the same hostile values
    db = seedWorld(); installSmtp([SMTP.accept()]);
    ref = db.ref; db.ref = (p, q) => { const x = ref(p, q); return p === `tenants/${T}/biz:${B}:entries` ? { ...x, once: async () => { throw thrown; } } : x; };
    c = await captureConsole(() => at(AT, () => runManual(route)));
    assert.deepEqual([c.value.statusCode, c.value.body], [503, { error: "Snapshot could not be built; email not sent", code: "snapshot_build_failed", tenantId: T, bizId: B }]);
    assert.deepEqual(c.lines.filter(leaks), [], c.lines.join("\n"));
    assert.ok(c.lines.some((l) => /\[daily-snapshot\] manual build failed \((Error|OTHER)\)$/.test(l)), c.lines.join("\n"));
  }
});

test("DR1-10 (D4) untrusted provider Message-IDs and error fields never reach logs, responses or receipts", async () => {
  const big = "x".repeat(1 << 20) + "private@example.test";
  const resolves = [
    ["address as Message-ID", (mail) => ({ messageId: "<private@example.test>", accepted: [mail.to], rejected: [], response: "250 OK" }), "different"],
    ["Message-ID object", (mail) => ({ messageId: { toString: () => "private@example.test" }, accepted: [mail.to], rejected: [], response: "250 OK" }), "invalid"],
    ["oversized Message-ID", (mail) => ({ messageId: big, accepted: [mail.to], rejected: [], response: "250 OK" }), "invalid"],
    ["no Message-ID", (mail) => ({ accepted: [mail.to], rejected: [], response: "250 OK" }), "absent"],
    ["echoed Message-ID", (mail) => ({ messageId: mail.messageId, accepted: [mail.to], rejected: [], response: "250 private@example.test" }), "match"],
  ];
  for (const [label, answer, echo] of resolves) {
    one(); const smtp = installSmtp([async (mail) => answer(mail)]);
    const { value: r, lines } = await captureConsole(() => cron());
    assert.deepEqual([r.statusCode, r.body.results[0].settlement], [200, "delivered"], label);
    const rec = receipt(T, B);
    assert.equal(rec.messageId, smtp.calls[0].messageIdHeader, label + ": the receipt names OUR Message-ID");
    assert.match(rec.messageId, /^<daily_snapshot\.1\.[0-9a-f-]{36}@delivery\.marjin\.app>$/);
    assert.equal(rec.providerIdEcho, echo, label);
    assert.equal(leaks(JSON.stringify(scrub(rec))), false, label + ": receipt"); assert.equal(leaks(JSON.stringify(r.body)), false, label + ": response");
    assert.deepEqual(lines.filter(leaks), [], label + ": logs");
    assert.ok(lines.every((l) => l.length < 400), label + ": bounded log lines");
  }
  // hostile errors: wrong types, oversized values, nested shapes, throwing getters, non-Error throws
  const throwingGetter = () => { const e = new Error("x"); Object.defineProperty(e, "code", { get() { throw new Error("private@example.test"); } }); return e; };
  const throws = [
    ["address as code", () => Object.assign(new Error("private@example.test"), { code: "private@example.test", command: "RCPT TO private@example.test", responseCode: "550 private@example.test" }), "unknown", "provider_error_unclassified"],
    ["oversized code", () => Object.assign(new Error(big), { code: big }), "unknown", "provider_error_unclassified"],
    // R2 (review E1): a refusal needs the complete nodemailer negative-reply shape; a partial / wrongly typed one is unknown
    ["code object", () => Object.assign(new Error("m"), { code: { toString: () => "EENVELOPE" }, responseCode: 550 }), "unknown", "provider_error_unclassified"],
    ["absurd responseCode", () => Object.assign(new Error("m"), { code: "EENVELOPE", responseCode: 1e12 }), "unknown", "provider_refusal_unverifiable"],
    ["string responseCode", () => Object.assign(new Error("m"), { code: "EMESSAGE", responseCode: "550" }), "unknown", "provider_refusal_unverifiable"],
    ["nested cause / errors", () => Object.assign(new AggregateError([new Error("private@example.test")], "sensitive@example.test"), { cause: { code: "private@example.test" } }), "unknown", "provider_error_unclassified"],
    ["throwing getter", throwingGetter, "unknown", "provider_error_unclassified"],
    ["a thrown string", () => "private@example.test", "unknown", "provider_error_unclassified"],
    ["a thrown null", () => null, "unknown", "provider_error_unclassified"],
    ["syscall forged", () => Object.assign(new Error("m"), { code: "ESOCKET", syscall: "connect private@example.test" }), "unknown", "provider_connection_lost"],
  ];
  for (const [label, mk, outcome, code] of throws) {
    one(); installSmtp([async () => { throw mk(); }]);
    const { value: r, lines } = await captureConsole(() => cron());
    assert.deepEqual([r.body.results[0].outcome, r.body.results[0].code], [outcome, code], label);
    assert.equal(r.statusCode, 500, label);
    assert.equal(leaks(JSON.stringify(scrub(receipt(T, B)))), false, label + ": receipt");
    assert.equal(leaks(JSON.stringify(r.body)), false, label + ": response");
    assert.deepEqual(lines.filter(leaks), [], label + ": logs");
    assert.ok(lines.every((l) => l.length < 400), label + ": bounded log lines");
  }
  // hostile resolved results: an oversized list, a throwing element, a contradiction — unknown, never a false success
  const results = [
    ["oversized accepted list", (mail) => ({ messageId: mail.messageId, accepted: [...Array(5000).fill("private@example.test"), mail.to], rejected: [] }), "provider_result_malformed"],
    ["throwing accepted element", (mail) => ({ messageId: mail.messageId, accepted: [{ get address() { throw new Error("private@example.test"); } }], rejected: [] }), "provider_result_malformed"],
    ["non-string rejected entry", (mail) => ({ messageId: mail.messageId, accepted: [], rejected: [42] }), "provider_result_malformed"],
    ["accepted not a list", (mail) => ({ messageId: mail.messageId, accepted: mail.to }), "provider_result_malformed"],
    ["accepted with a 5xx reply", (mail) => ({ messageId: mail.messageId, accepted: [mail.to], rejected: [], response: "554 private@example.test" }), "provider_result_inconsistent"],
  ];
  for (const [label, answer, code] of results) {
    one(); const smtp = installSmtp([async (mail) => answer(mail)]);
    const { value: r, lines } = await captureConsole(() => cron());
    assert.equal(r.body.results[0].code, code, label); assert.equal(r.statusCode, 500, label); assert.notEqual(r.body.results[0].settlement, "delivered", label);
    assert.equal(leaks(JSON.stringify(scrub(receipt(T, B)))), false, label); assert.deepEqual(lines.filter(leaks), [], label);
    await cron(AT + 2 * LEASE); assert.equal(smtp.calls.length, 1, label + ": never re-sent");
  }
});

test("DR1-11 (D4) bounded representations of untrusted provider data", () => {
  const hostile = new Proxy({}, { get() { throw new Error("private@example.test"); } });
  assert.equal(D.safeRead(hostile, "code"), undefined); assert.equal(D.safeRead("str", "length"), undefined); assert.equal(D.safeRead(null, "x"), undefined);
  for (const [v, want] of [[undefined, "none"], [null, "none"], ["", "none"], ["EAUTH", "EAUTH"], ["eauth", "OTHER"], ["private@example.test", "OTHER"], [{}, "OTHER"], [550, "OTHER"], ["EAUTH ".repeat(1000), "OTHER"]])
    assert.equal(D.providerCode({ code: v }), want, JSON.stringify(v));
  assert.equal(D.providerCode(hostile), "none");
  for (const [v, want] of [["RCPT TO", "RCPT TO"], ["RCPT TO <private@example.test>", "OTHER"], [undefined, "none"], [5, "OTHER"]]) assert.equal(D.providerCommand({ command: v }), want);
  for (const [v, want] of [[250, 250], [550, 550], [199, null], [600, null], [250.5, null], ["250", null], [1e12, null], [NaN, null], [null, null]]) assert.equal(D.providerResponseCode(v), want, String(v));
  const ours = "<daily_snapshot.1.x@delivery.marjin.app>";
  for (const [v, want] of [[ours, "match"], ["<other@x>", "different"], [undefined, "absent"], ["", "absent"], [5, "invalid"], [{}, "invalid"], ["<" + "a".repeat(2000) + ">", "invalid"]]) assert.equal(D.providerIdEcho(v, ours), want);
  for (const [v, want] of [["provider_rejected_550", "provider_rejected_550"], [null, null], ["private@example.test", "invalid_code"], ["A", "invalid_code"], ["x".repeat(65), "invalid_code"], [5, "invalid_code"]]) assert.equal(D.boundedCode(v), want);
  // classification never throws and never returns provider text
  for (const e of [hostile, "private@example.test", 5, null, undefined, Object.assign(new Error("Connection timeout private@example.test"), { code: "ETIMEDOUT" })]) {
    const c = D.classifyTransportError(e);
    assert.ok(["failed", "unknown"].includes(c.outcome)); assert.match(c.code, /^[a-z][a-z0-9_]*$/);
  }
  assert.equal(D.classifyTransportInfo(hostile, "owner-a@example.test").outcome, "unknown");
  const { proxy: revoked, revoke } = Proxy.revocable([], {}); revoke();
  const throwingLength = new Proxy(["owner-a@example.test"], { get(t, k) { if (k === "length") throw new Error("private@example.test"); return t[k]; } });
  for (const accepted of [revoked, throwingLength]) {
    let c; assert.doesNotThrow(() => { c = D.classifyTransportInfo({ accepted, rejected: [] }, "owner-a@example.test"); });
    assert.deepEqual([c.outcome, c.code], ["unknown", "provider_result_malformed"]);
  }
  assert.equal(D.classifyTransportError(revoked).outcome, "unknown");
});

test("DR1-11b (D4) lib/sendEmail.js outside a delivery attempt (the alert digest path) sets and returns ITS OWN Message-ID", async () => {
  const sb = await buildSandbox();
  const { sendEmail } = await sb.import("lib/sendEmail.js");
  process.env.SMTP_EMAIL = "sender@example.test"; process.env.SMTP_APP_PASSWORD = "fixture-app-password-not-real";
  const smtp = installSmtp([async () => ({ messageId: "<private@example.test>", accepted: ["owner-a@example.test"], rejected: [], response: "250 OK" })]);
  const { value, lines } = await captureConsole(() => sendEmail("owner-a@example.test", "s", "<p>x</p>"));
  assert.match(value.messageId, /^<mail\.[0-9a-f-]{36}@delivery\.marjin\.app>$/);
  assert.equal(smtp.calls[0].messageIdHeader, value.messageId, "the header set on the message is the id returned");
  assert.deepEqual(lines.filter(leaks), []); assert.ok(lines.some((l) => l.includes(value.messageId) && l.includes("echo=different")));
  installSmtp([async () => { throw Object.assign(new Error("private@example.test"), { code: "private@example.test", command: "RCPT TO private@example.test", responseCode: 550 }); }]);
  const failed = await captureConsole(() => sendEmail("owner-a@example.test", "s", "<p>x</p>").catch((e) => e));
  assert.deepEqual(failed.lines.filter(leaks), []);
  assert.ok(failed.lines.some((l) => /code=OTHER smtp=550 command=OTHER id=<mail\./.test(l)), failed.lines.join("\n"));
});

test("DR1-12 receipts hold exactly the allow-listed fields; tenant / business isolation of the receipt and its recipient hash", async () => {
  const db = seedWorld();
  const env = (v) => ({ _v: JSON.stringify(v) });
  db.seed(`tenants/${T2}/app/business`, env([{ id: B3, name: "מסעדה ג" }, { id: B, name: "מסעדה ד" }]));
  process.env.MARJIN_DAILY_RECIPIENTS_JSON = JSON.stringify([...JSON.parse(process.env.MARJIN_DAILY_RECIPIENTS_JSON),[T2,B,"owner-b@example.test"]]);
  db.seed(`${SUBSCRIPTIONS}/${T2}/${B}`, enabledSubscriptionRecord());
  db.seed(`tenants/${T2}/biz:${B}:entries`, db.read(`tenants/${T}/biz:${B}:entries`)); db.seed(`tenants/${T2}/biz:${B}:config`, env({ businessName: "מסעדה ד" })); db.seed(`tenants/${T2}/biz:${B}:fixed`, env([]));
  const smtp = installSmtp([async (mail) => ({ messageId: "<private@example.test>", accepted: [mail.to], rejected: [], response: "250 OK", envelope: { to: [mail.to] }, extra: "sensitive@example.test" })]);
  const r = await cron();
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  const ALLOWED = ["v", "kind", "tenantId", "bizId", "businessDate", "state", "claimId", "attempt", "claimedAt", "recipientHash", "updatedAt", "history", "sendingAt", "messageIdHeader", "messageId", "providerIdEcho", "responseCode", "finishedAt"].sort();
  const all = globalThis.__DB.read("email_delivery/daily_snapshot");
  for (const [t, b, owner] of [[T, B, "owner-a@example.test"], [T, B2, "owner-a@example.test"], [T2, B3, "owner-b@example.test"], [T2, B, "owner-b@example.test"]]) {
    const rec = all[t][b][DATE];
    assert.deepEqual(Object.keys(rec).sort(), ALLOWED, `${t}/${b}`);
    assert.deepEqual([rec.tenantId, rec.bizId, rec.recipientHash], [t, b, sha(owner)], `${t}/${b}: own identity and own recipient`);
    assert.equal(rec.messageId, rec.messageIdHeader);
    for (const h of rec.history) assert.deepEqual(Object.keys(h).sort(), ["at", "attempt", "code", "state"]);
  }
  assert.equal(leaks(JSON.stringify(scrub(all))), false);
  assert.equal(new Set(smtp.calls.map((c) => c.messageIdHeader)).size, 4, "four distinct messages");
  assert.notEqual(all[T][B][DATE].messageId, all[T2][B][DATE].messageId);
});

// INTEGRATION I1 (G9): the `todo` is removed because the real route now passes this combined scenario on the reconciled tree
// (route → buildSnapshotRun → failed row); its assertions are unchanged. The removal itself awaits the independent review.
test("DR1-C1 (combined flow) a business whose summary fails to build keeps the run from being reported clean", async () => {
  const db = seedWorld({ withSecondTenant: false }); installSmtp([SMTP.accept()]);
  const ref = db.ref; db.ref = (p, q) => { const x = ref(p, q); return p === `tenants/${T}/biz:${B2}:entries` ? { ...x, once: async () => { throw new Error("isolated build failure"); } } : x; };
  const r = await cron();
  assert.notEqual(r.statusCode, 200, "a failed build is not a clean run");
  assert.ok(r.body.results.some((x) => x.bizId === B2 && x.settlement === "failed"), "the failed business is accounted for");
});
