// Daily e-mail subscription (owner requirement 2026-10-22; author candidate, pending independent review). The REAL route
// (api/daily-snapshot/run.ts), REAL builder, REAL receipt / admission / hold modules and the REAL preference module
// (src/server/dailyEmailSubscription.ts, compiled with the route) run in the sandbox of test/support/daily-email-harness.mjs; only the database, the token
// verifier and the SMTP provider are replaced. No network, no real e-mail.
//   DS-01  classification: only a well-formed record with enabled === true permits a scheduled send; absent = default OFF
//   DS-02  read: a failed / timed-out read and an unaddressable identity never permit a send
//   DS-03  write: exact record, version, role, no-op repeat, malformed predecessor replaced, refused / unconfirmed writes
//   DS-04  backend authorization: only owner / super_owner of the tenant (requireBizContext) may read or change it
//   DS-05  owner read / change flow; default OFF; registry refusals; no address in any reply
//   DS-06  scheduled gate: absent / disabled = no_send, malformed / unreadable = failed, enabled still needs a configured recipient
//   DS-07  a change affects later scheduled runs only: accepted / unknown receipts are untouched, nothing is re-sent
//   DS-08  the manual Daily is separate: it does not read or write the preference and keeps its own checks
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSandbox, installSmtp, SMTP, seedWorld, freezeClock, runCron, runManual, mkRes, captureConsole, RECEIPTS, T, B, B2, T2, B3,
  SUBSCRIPTIONS, enabledSubscriptionRecord } from "../support/daily-email-harness.mjs";
const SANDBOX = await buildSandbox();
const { route } = SANDBOX;
const S = await SANDBOX.import("src/server/dailyEmailSubscription.js");
const AT = Date.UTC(2026, 8, 8, 4, 5), DATE = "2026-09-08", LEASE = 10 * 60 * 1000;
const at = async (ms, fn) => { const u = freezeClock(ms); try { return await fn(); } finally { u(); } };
const cron = (ms = AT) => at(ms, () => runCron(route));
const env = (v) => ({ _v: JSON.stringify(v) });
const SECRET = "private-injected@example.test";
const subPath = (t, b) => `${SUBSCRIPTIONS}/${t}/${b}`;
const sub = (t = T, b = B) => globalThis.__DB.read(subPath(t, b));
const rowOf = (r, t, b) => (r.body.results || []).find((x) => x.tenantId === t && x.bizId === b);
const receipt = (t, b) => globalThis.__DB.read(`${RECEIPTS}/${t}/${b}/${DATE}`);
const record = (enabled, over = {}) => ({ schema: 1, enabled, version: 1, updatedAt: 0, updatedByRole: "owner", ...over });
const failRead = (db, path, how = "throw") => { const r = db.ref; db.ref = (p, q) => { const x = r(p, q); return p === path ? { ...x, once: how === "hang" ? () => new Promise(() => {}) : async () => { throw new Error(SECRET); } } : x; }; };
async function post(body, { uid = "u_owner_a", email = "owner-a@example.test" } = {}) {
  process.env.SMTP_EMAIL = "sender@example.test"; process.env.SMTP_APP_PASSWORD = "fixture-app-password-not-real";
  globalThis.__DE = { requireAuth: async () => (uid ? { uid, email } : (() => { throw new Error("no auth"); })()) };
  const res = mkRes();
  await at(AT, () => route({ method: "POST", headers: { authorization: "Bearer user-token" }, query: {}, body }, res));
  return res;
}
const read = (o = {}) => post({ tenantId: T, bizId: B, action: "subscription" }, o);
const set = (enabled, o = {}, ids = {}) => post({ tenantId: T, bizId: B, ...ids, action: "subscription_set", enabled }, o);
const noAddress = (r, label) => assert.ok(!/@example\.test/.test(JSON.stringify(r.body)), label + ": no address in the reply");

test("DS-01 classification: default OFF; only a well-formed enabled record permits a scheduled send", () => {
  assert.deepEqual(S.classifySubscription(null), { state: "disabled", enabled: false, explicit: false, code: "daily_email_not_enabled", version: null });
  assert.deepEqual(S.classifySubscription(undefined).state, "disabled");
  assert.deepEqual(S.classifySubscription(record(true, { version: 3 })), { state: "enabled", enabled: true, explicit: true, code: null, version: 3 });
  assert.deepEqual(S.classifySubscription(record(false, { version: 2 })), { state: "disabled", enabled: false, explicit: true, code: "daily_email_not_enabled", version: 2 });
  const bad = [true, 1, "true", [], {}, [record(true)], { ...record(true), enabled: "true" }, { ...record(true), enabled: 1 }, { ...record(true), schema: 2 },
    { ...record(true), schema: "1" }, { ...record(true), version: 0 }, { ...record(true), version: 1.5 }, { ...record(true), version: "1" },
    { ...record(true), updatedAt: -1 }, { ...record(true), updatedAt: "0" }, { ...record(true), updatedByRole: "manager" },
    { ...record(true), updatedByRole: "Owner" }, { ...record(true), extra: 1 }, { ...record(true), recipient: "x@example.test" },
    (() => { const r = record(true); delete r.updatedAt; return r; })(), (() => { const r = record(true); delete r.enabled; return r; })()];
  for (const raw of bad) {
    const c = S.classifySubscription(raw);
    assert.equal(c.enabled, false, JSON.stringify(raw)); assert.notEqual(c.state, "enabled", JSON.stringify(raw));
  }
  for (const raw of bad.filter((x) => x !== null && typeof x === "object")) assert.equal(S.classifySubscription(raw).code, "daily_email_subscription_unreadable", JSON.stringify(raw));
  assert.equal(S.subscriptionPath(T, B), `${SUBSCRIPTIONS}/${T}/${B}`);
  assert.equal(S.subscriptionPath("acme:il", "bizX"), `${SUBSCRIPTIONS}/acme:il/bizX`);
  for (const [t, b] of [["", B], [T, ""], [T, "a:b"], [T, "a/b"], ["t.x", B], [T, "b\u0001"], [T, null], [{}, B]]) assert.equal(S.subscriptionPath(t, b), null, JSON.stringify([t, b]));
});

test("DS-02 read: absent is default OFF; failed / timed-out reads and unaddressable identities never permit a send", async () => {
  let db = seedWorld({ subscriptions: "absent" });
  assert.deepEqual(await S.readDailySubscription(db, T, B), { state: "disabled", enabled: false, explicit: false, code: "daily_email_not_enabled", version: null });
  db.seed(subPath(T, B), record(true));
  assert.equal((await S.readDailySubscription(db, T, B)).state, "enabled");
  db = seedWorld(); failRead(db, subPath(T, B));
  assert.deepEqual(await S.readDailySubscription(db, T, B), { state: "unavailable", enabled: false, explicit: false, code: "daily_email_subscription_unavailable", version: null });
  db = seedWorld(); failRead(db, subPath(T, B), "hang");
  assert.equal((await S.readDailySubscription(db, T, B, { timeoutMs: 20 })).state, "unavailable");
  for (const [t, b] of [[T, "x:y"], ["", B], [T, "b\u007f"]]) assert.deepEqual((await S.readDailySubscription(db, t, b)).state, "invalid");
});

test("DS-03 write: exact record, versions, no-op repeat, malformed predecessor replaced; refused and unconfirmed writes", async () => {
  const db = seedWorld({ subscriptions: "absent" });
  assert.deepEqual(await S.setDailySubscription(db, { tenantId: T, bizId: B, enabled: true, actorRole: "owner", nowMs: 1000 }), { ok: true, enabled: true, version: 1, changed: true });
  assert.deepEqual(sub(), { schema: 1, enabled: true, version: 1, updatedAt: 1000, updatedByRole: "owner" });
  assert.deepEqual(await S.setDailySubscription(db, { tenantId: T, bizId: B, enabled: true, actorRole: "super_owner", nowMs: 2000 }), { ok: true, enabled: true, version: 1, changed: false });
  assert.deepEqual(sub(), { schema: 1, enabled: true, version: 1, updatedAt: 1000, updatedByRole: "owner" }, "a repeat does not rewrite");
  assert.deepEqual(await S.setDailySubscription(db, { tenantId: T, bizId: B, enabled: false, actorRole: "super_owner", nowMs: 3000 }), { ok: true, enabled: false, version: 2, changed: true });
  assert.deepEqual(sub(), { schema: 1, enabled: false, version: 2, updatedAt: 3000, updatedByRole: "super_owner" });
  db.seed(subPath(T, B2), { enabled: "yes" });
  assert.deepEqual(await S.setDailySubscription(db, { tenantId: T, bizId: B2, enabled: true, actorRole: "owner", nowMs: 4000 }), { ok: true, enabled: true, version: 1, changed: true });
  const before = JSON.stringify(globalThis.__DB.read(SUBSCRIPTIONS));
  for (const bad of [{ enabled: "true" }, { enabled: 1 }, { enabled: null }, { enabled: undefined }, { actorRole: "manager" }, { actorRole: "viewer" }, { actorRole: undefined },
    { nowMs: -1 }, { nowMs: 1.5 }, { nowMs: "1" }, { bizId: "a:b" }, { tenantId: "" }, { bizId: "b\u0001" }])
    assert.deepEqual(await S.setDailySubscription(db, { tenantId: T, bizId: B, enabled: true, actorRole: "owner", nowMs: 5000, ...bad }), { ok: false, code: "invalid_subscription_request" }, JSON.stringify(bad));
  assert.equal(JSON.stringify(globalThis.__DB.read(SUBSCRIPTIONS)), before, "refused requests write nothing");
  const fake = (transaction) => ({ ref: () => ({ transaction }) });
  assert.deepEqual(await S.setDailySubscription(fake(async () => { throw new Error(SECRET); }), { tenantId: T, bizId: B, enabled: true, actorRole: "owner", nowMs: 1 }), { ok: false, code: "daily_email_subscription_unavailable" });
  assert.deepEqual(await S.setDailySubscription(fake(async () => ({ committed: false })), { tenantId: T, bizId: B, enabled: true, actorRole: "owner", nowMs: 1 }), { ok: false, code: "daily_email_subscription_unavailable" });
  assert.deepEqual(await S.setDailySubscription(fake(() => new Promise(() => {})), { tenantId: T, bizId: B, enabled: true, actorRole: "owner", nowMs: 1, timeoutMs: 20 }), { ok: false, code: "daily_email_subscription_unconfirmed" });
  assert.deepEqual(await S.setDailySubscription(fake(async (fn) => { fn(null); return { committed: true, snapshot: { val: () => ({ enabled: true }) } }; }), { tenantId: T, bizId: B, enabled: true, actorRole: "owner", nowMs: 1 }), { ok: false, code: "daily_email_subscription_unconfirmed" }, "an unreadable stored result is never reported as applied");
});

test("DS-04 backend authorization: only the tenant's owner / super_owner may read or change it; nothing is written otherwise", async () => {
  const db = seedWorld({ subscriptions: "absent" });
  db.seed(`tenants/${T}/members/u_manager_a`, true); db.seed(`tenants/${T}/roles/u_manager_a`, "manager"); db.seed(`tenants/${T}/biz_access/${B}/u_manager_a`, true);
  db.seed(`tenants/${T}/members/u_super_a`, true); db.seed(`tenants/${T}/roles/u_super_a`, "super_owner");
  const refusals = [
    [{ uid: null }, 401], [{ uid: "u_viewer_a", email: "viewer-a@example.test" }, 403], [{ uid: "u_manager_a", email: "m@example.test" }, 403],
    [{ uid: "u_owner_b", email: "owner-b@example.test" }, 403], [{ uid: "u_unknown", email: "u@example.test" }, 403],
  ];
  for (const [who, status] of refusals) {
    for (const r of [await read(who), await set(true, who)]) { assert.equal(r.statusCode, status, JSON.stringify([who, r.body])); noAddress(r, who.uid); }
    assert.equal(sub(), null, "nothing written for " + who.uid);
  }
  assert.equal((await set(true, { uid: "u_owner_b", email: "owner-b@example.test" }, { tenantId: T2, bizId: B })).statusCode >= 400, true, "another tenant's business id in the caller's tenant");
  assert.equal(sub(T2, B), null);
  const s1 = await set(true, { uid: "u_super_a", email: "s@example.test" });
  assert.deepEqual([s1.statusCode, s1.body.enabled, s1.body.version], [200, true, 1]); assert.equal(sub().updatedByRole, "super_owner");
  const s2 = await set(false);
  assert.deepEqual([s2.statusCode, s2.body.enabled, s2.body.version], [200, false, 2]); assert.equal(sub().updatedByRole, "owner");
  assert.deepEqual((await post({ tenantId: T, bizId: B, action: "subscriptions" })).statusCode, 400, "an unknown action is refused");
  for (const enabled of ["true", 1, 0, null, undefined, "on", [true], { v: true }]) {
    const r = await set(enabled); assert.deepEqual([r.statusCode, r.body.error], [400, "invalid_enabled"], JSON.stringify(enabled));
  }
  assert.deepEqual(sub(), { schema: 1, enabled: false, version: 2, updatedAt: AT, updatedByRole: "owner" }, "invalid values write nothing");
});

test("DS-05 owner read / change flow: default OFF, registry refusals, no address, no recipient or configuration change", async () => {
  const db = seedWorld({ subscriptions: "absent" });
  const recipients = process.env.MARJIN_DAILY_RECIPIENTS_JSON;
  let r = await read();
  assert.deepEqual([r.statusCode, r.body], [200, { status: "ok", tenantId: T, bizId: B, enabled: false, state: "disabled", explicit: false, version: null }]);
  r = await set(true); assert.deepEqual([r.statusCode, r.body], [200, { status: "ok", tenantId: T, bizId: B, enabled: true, state: "enabled", explicit: true, version: 1, changed: true }]);
  r = await read(); assert.deepEqual([r.body.enabled, r.body.state, r.body.explicit, r.body.version], [true, "enabled", true, 1]);
  r = await set(false); r = await read(); assert.deepEqual([r.body.enabled, r.body.state, r.body.version], [false, "disabled", 2]);
  db.seed(subPath(T, B), { enabled: true });
  r = await read(); assert.deepEqual([r.statusCode, r.body.enabled, r.body.state], [200, false, "unreadable"], "a malformed record reads as not enabled");
  failRead(db, subPath(T, B)); const { value: u, lines } = await captureConsole(() => read());
  assert.deepEqual([u.statusCode, u.body.status, u.body.code], [503, "unavailable", "daily_email_subscription_unavailable"]);
  assert.ok(!(JSON.stringify(u.body) + lines.join("\n")).includes(SECRET), "injected text never reaches the reply or the log");
  // registry: unavailable → 503; not registered → refused; a nameless business may still change its preference
  let w = seedWorld({ subscriptions: "absent" }); failRead(w, `tenants/${T}/app/business`);
  for (const x of [await read(), await set(true)]) assert.deepEqual([x.statusCode, x.body.status], [503, "unavailable"]);
  assert.equal(sub(), null);
  w = seedWorld({ subscriptions: "absent" }); w.seed(`tenants/${T}/app/business`, env([{ id: B2, name: "אחר" }]));
  for (const x of [await read(), await set(true)]) assert.deepEqual([x.statusCode, x.body.code], [404, "business_not_registered"]);
  assert.equal(sub(), null);
  w = seedWorld({ subscriptions: "absent" }); w.seed(`tenants/${T}/app/business`, env([{ id: B }, { id: B2, name: "ב" }]));
  r = await set(true); assert.deepEqual([r.statusCode, r.body.enabled], [200, true]);
  for (const x of [r, await read()]) noAddress(x, "reply");
  assert.equal(process.env.MARJIN_DAILY_RECIPIENTS_JSON, recipients, "the server recipient configuration is untouched");
  assert.equal(globalThis.__DB.read(RECEIPTS), null, "no receipt"); assert.equal(globalThis.__DB.read("email_delivery_manual"), null, "no manual record");
  assert.equal(globalThis.__DB.read("email_delivery_admission"), null, "no admission");
});

test("DS-06 scheduled gate: default OFF / disabled = no_send; malformed / unreadable = failed; enabled still needs a configured recipient", async () => {
  // nothing enabled: a clean run with only no_send rows, zero provider calls, no receipt, claim, admission or notice
  let db = seedWorld({ subscriptions: "absent" }); let smtp = installSmtp([SMTP.accept()]);
  let r = await cron();
  assert.deepEqual([r.statusCode, r.body.status, r.body.skippedCount, r.body.results.length, smtp.calls.length], [200, "completed", 3, 3, 0], JSON.stringify(r.body));
  for (const x of r.body.results) assert.deepEqual([x.outcome, x.code, x.settlement, x.receipt], ["skipped", "daily_email_not_enabled", "no_send", "not_written"]);
  for (const root of [RECEIPTS, "email_delivery_manual", "email_delivery_admission"]) assert.equal(globalThis.__DB.read(root), null, root);
  // build / identity failures keep their accounting whatever the preference (G4: a nameless business is a FAILED row)
  db = seedWorld({ subscriptions: "absent" }); smtp = installSmtp([SMTP.accept()]);
  db.seed(`tenants/${T}/app/business`, env([{ id: B }, { id: B2, name: "מסעדה ב" }]));
  r = await cron();
  assert.deepEqual([rowOf(r, T, B).outcome, rowOf(r, T, B).code, rowOf(r, T, B2).settlement, smtp.calls.length], ["failed", "business_name_unavailable", "no_send", 0]);
  // mixed: B disabled, B2 malformed, B3 enabled
  db = seedWorld(); smtp = installSmtp([SMTP.accept()]);
  db.seed(subPath(T, B), record(false, { version: 4 })); db.seed(subPath(T, B2), { schema: 1, enabled: true });
  r = await cron();
  assert.deepEqual([rowOf(r, T, B).settlement, rowOf(r, T, B).code], ["no_send", "daily_email_not_enabled"]);
  assert.deepEqual([rowOf(r, T, B2).outcome, rowOf(r, T, B2).code, rowOf(r, T, B2).settlement], ["failed", "daily_email_subscription_unreadable", "failed"]);
  assert.equal(rowOf(r, T2, B3).settlement, "delivered");
  assert.deepEqual([r.statusCode, r.body.status, smtp.calls.map((c) => c.to)], [500, "completed_with_failures", ["owner-b@example.test"]]);
  assert.deepEqual([receipt(T, B), receipt(T, B2)], [null, null]);
  // unreadable preference: failed, fail closed, nothing leaks
  db = seedWorld({ withSecondBiz: false, withSecondTenant: false }); smtp = installSmtp([SMTP.accept()]); failRead(db, subPath(T, B));
  const { value: u, lines } = await captureConsole(() => cron());
  assert.deepEqual([u.statusCode, rowOf(u, T, B).code, rowOf(u, T, B).settlement, smtp.calls.length], [500, "daily_email_subscription_unavailable", "failed", 0]);
  assert.ok(!(JSON.stringify(u.body) + lines.join("\n")).includes(SECRET));
  // enabled grants no recipient eligibility: the server configuration still decides
  db = seedWorld({ withSecondBiz: false, withSecondTenant: false }); smtp = installSmtp([SMTP.accept()]);
  process.env.MARJIN_DAILY_RECIPIENTS_JSON = JSON.stringify([[T2, B3, "owner-b@example.test"]]);
  r = await cron();
  assert.deepEqual([r.statusCode, rowOf(r, T, B).code, rowOf(r, T, B).settlement, smtp.calls.length, receipt(T, B)], [500, "no_recipient", "failed", 0, null]);
  // enabled + configured: delivered exactly as before
  db = seedWorld({ withSecondBiz: false, withSecondTenant: false }); smtp = installSmtp([SMTP.accept()]);
  r = await cron();
  assert.deepEqual([r.statusCode, rowOf(r, T, B).settlement, smtp.calls.length, receipt(T, B).state], [200, "delivered", 1, "accepted"]);
});

test("DS-07 a change affects later scheduled runs only: existing receipts are untouched and nothing is re-sent", async () => {
  const db = seedWorld({ withSecondBiz: false, withSecondTenant: false }); const smtp = installSmtp([SMTP.accept(), SMTP.accept()]);
  let r = await cron();
  assert.deepEqual([rowOf(r, T, B).settlement, smtp.calls.length], ["delivered", 1]);
  const accepted = JSON.stringify(receipt(T, B));
  r = await set(false); assert.equal(r.statusCode, 200);
  r = await cron(AT + 2 * LEASE);
  assert.deepEqual([rowOf(r, T, B).settlement, rowOf(r, T, B).code, smtp.calls.length], ["no_send", "daily_email_not_enabled", 1]);
  assert.equal(JSON.stringify(receipt(T, B)), accepted, "the accepted receipt is unchanged");
  r = await set(true); r = await cron(AT + 4 * LEASE);
  assert.deepEqual([rowOf(r, T, B).code, smtp.calls.length], ["already_accepted", 1], "re-enabling never re-sends an accepted Daily");
  // an unknown attempt stays unknown and untouched while disabled
  const db2 = seedWorld({ withSecondBiz: false, withSecondTenant: false }); installSmtp([SMTP.accept()]);
  const unknown = { ...JSON.parse(accepted), state: "unknown" };
  db2.seed(`${RECEIPTS}/${T}/${B}/${DATE}`, unknown);
  db2.seed(subPath(T, B), record(false));
  r = await cron(AT + 2 * LEASE);
  assert.deepEqual([rowOf(r, T, B).settlement, JSON.stringify(receipt(T, B))], ["no_send", JSON.stringify(unknown)]);
});

test("DS-08 the manual Daily is separate: it neither reads nor writes the preference and keeps its own checks", async () => {
  const db = seedWorld({ withSecondBiz: false, withSecondTenant: false, subscriptions: "absent" }); const smtp = installSmtp([SMTP.accept()]);
  const reads = []; const ref = db.ref; db.ref = (p, q) => { if (String(p).startsWith(SUBSCRIPTIONS)) reads.push(p); return ref(p, q); };
  let r = await at(AT, () => runManual(route));
  assert.deepEqual([r.statusCode, r.body.status, smtp.calls.length], [200, "success", 1], JSON.stringify(r.body));
  assert.deepEqual([reads, sub()], [[], null], "the manual path never consults or writes the subscription");
  r = await at(AT, () => runManual(route));
  assert.deepEqual([r.statusCode, r.body.code, smtp.calls.length], [409, "manual_repeat_not_permitted", 1], "its own repeat policy still applies");
  r = await at(AT, () => runManual(route, { uid: "u_viewer_a", email: "viewer-a@example.test" }));
  assert.equal(r.statusCode, 403, "its own authorization still applies");
  db.seed(subPath(T, B), enabledSubscriptionRecord());
  assert.equal(sub().enabled, true);
});
