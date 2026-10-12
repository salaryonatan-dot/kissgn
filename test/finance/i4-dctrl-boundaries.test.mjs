// Agent/Daily integration I4 — the M1 D-CTRL application boundaries (behavioural contract; LOCAL, pending independent Codex review
// and the M1 identity / admin-API / P0 / P1 owners' acceptance). Owner decision D-CTRL (2026-10-09): tenant / business identifiers
// carrying U+0000–U+001F or U+007F are REFUSED before any database reference is constructed — never trimmed, sanitized,
// replaced or aliased. I3 implemented it inside the two shared predicates; the independent I3 review (I3-R-01) reproduced the
// boundaries that still let such an identity reach the Admin SDK, or trimmed it into another identity. Every row below drives
// the REAL api/admin.js handler or the REAL helper against a reference-recording database whose every path goes through the real
// Admin SDK path constructor (test/support/i4-boundary-harness.mjs); "no reference" means the SDK was never even asked.
//   DB-01  super_owner edit-client / delete-client / resend-invite: control tenant → 400 {error:"invalid tenantId"} after
//          authentication and BEFORE the super_owner lookup: zero references, zero Auth / e-mail, state unchanged, no SDK text
//   DB-02  the local checks (delete-user, update-user, bootstrap-self, create-user via requireTenantAccess, entry exceptions,
//          business-data / analytics reads, supplier credits): every control code point in the tenant and business slots →
//          the handler's own existing 400, zero references
//   DB-03  roles: control tenant / raw allowedBizIds → 400 BEFORE the rate limiter and any database call (object and JSON-string
//          bodies); a non-control request still passes the limiter first and keeps its order (invalid JSON after the limiter)
//   DB-04  allowedBizIds at the API: "\nbizB", "bizB\n", "bizB\u0001" and every control code point are refused by create-user,
//          update-user and roles before any database or Auth call — never aliased to bizB, never stored
//   DB-05  persisted state and retries: a stored control entry is refused before any Auth or database write (never trimmed
//          into another business's biz_access key); repeated refusals are identical and leave the state, the limiter and the
//          audit untouched
//   DB-06  normalizeAllowedBizIds (helper boundary): a raw control entry throws BEFORE the trim; every non-control list keeps
//          its I3 result (padded entries are still trimmed: that pre-existing normalization is not changed here)
//   DB-07  requireTenantAccess (helper boundary): control tenant → 400 "invalid characters in id", zero references; every
//          non-control tenant keeps its I3 outcome and references
//   DB-08  readRegistryTarget (shared reader): control tenant key → invalid_request with zero references (I3: an SDK refusal
//          turned into `unavailable`); its callers map it to 400; every non-control (tenant, business) keeps its I3 result
//   DB-09  shared-predicate endpoints (alerts read, agent ask): control ids → 400 from requireBizContext before any repository
//   DB-10  the real Admin SDK refuses every code point of the class as a key (the class is not wider than needed: U+0080 is
//          accepted and accepted by the application)
//   DB-11  parity with I3 (git objects): for every non-control tenant, business and allowedBizIds corpus value and for every
//          actor (super_owner, owner, manager, viewer, foreign owner, unauthenticated) each handler's status, body, references,
//          Auth calls, e-mails, limiter calls and final state are IDENTICAL to the I3 handler's — authorization, tenant isolation,
//          registry semantics, the tenant ":" rule and the business ":" rule unchanged
import { test, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { syncBuiltinESMExports } from "node:module";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { adminHarness, observe, seed, CTRL, withCtrl, realSdk, closeSdk, recordingDb, clone } from "../support/i4-boundary-harness.mjs";
import { I4_PARENT } from "../support/i4-integration.mjs";
// I5 layering (T-I5-TEST; PROPOSED for the M1 integration and user-access owners — the CF-04 / I3G / I4G pattern applied to this
// behavioural contract): the PARITY rows (DB-06's non-control corpus and DB-11a/b) state a property of the I4 LAYER — "I4 changed
// nothing but the control class relative to I3". On an I5 tree, whose exact-identity correction deliberately changes the inherited
// padded / ":" / non-string behaviours (independent I4 review I4-R-01..03), those rows verify the I4 commit's OWN bytes (git objects)
// against I3, exactly as before; the I5 behaviour is held by test/finance/i5-exact-identity.test.mjs. Every refusal row (DB-01..10,
// the control half of DB-06) still runs on the checked-out tree. Nothing is skipped and no expectation is changed.
import { isI5Tree, I5_PARENT } from "../support/i5-integration.mjs";
import { ROOT } from "../support/i4-boundary-harness.mjs";

const FROM = "2026-10-01", TO = "2026-10-02";
const SDK_TEXT = /path argument|Paths must|invalid path|child failed/i;
const show = (s) => JSON.stringify(s);
let HEAD = null, PARENT = null;
const head = async () => (HEAD ??= await adminHarness());
const parent = async () => (PARENT ??= await adminHarness({ source: I4_PARENT }));
const LAYERED = isI5Tree(ROOT);
let LAYER = null;
const layer = async () => (LAYERED ? (LAYER ??= await adminHarness({ source: I5_PARENT })) : head());   // the I4 layer's bytes
after(async () => { await closeSdk(); });

/** A refusal: the expected status/body, and NOTHING else happened — no reference (built or SDK-refused), no Auth, no e-mail,
 *  no rate-limiter call, the database byte-for-byte the seed, and neither the SDK's text nor the identity in the answer. */
function assertRefused(h, res, body, label, { status = 400 } = {}) {
  const o = observe(h, res);
  assert.equal(o.status, status, label + ": status " + show(o.body));
  assert.deepEqual(o.body, body, label + ": body");
  assert.deepEqual(o.refs, [], label + ": no database reference constructed " + show(o.refs));
  assert.deepEqual(o.refused, [], label + ": the SDK was never asked " + show(o.refused));
  assert.deepEqual(o.auth, [], label + ": no Firebase Auth call");
  assert.equal(o.emails, 0, label + ": no e-mail");
  assert.equal(o.limiter, 0, label + ": no rate-limiter call");
  assert.deepEqual(o.state, seed(), label + ": persisted state unchanged");
  const text = JSON.stringify(o.body);
  assert.ok(!SDK_TEXT.test(text), label + ": no SDK path text in the answer");
  assert.ok(!/[\u0000-\u001f\u007f]/.test(JSON.parse(text).error ?? ""), label + ": the identity is not echoed");
}
const tenantVariants = () => CTRL.flatMap((c) => withCtrl("tenantA", c));
const bizVariants = () => CTRL.flatMap((c) => withCtrl("bizA", c));

test("DB-01 super_owner edit-client / delete-client / resend-invite: control tenant → 400 before the super_owner lookup or any reference", async () => {
  const h = await head();
  for (const action of ["edit-client", "delete-client", "resend-invite"]) {
    for (const tenantId of [...tenantVariants(), ["tenantA\u0001"], ["tenantA", "\n"]]) {
      h.reset();
      assertRefused(h, await h.call(action, { tenantId, bizName: "Renamed" }, "super"), { error: "invalid tenantId" }, `${action} ${show(tenantId)}`);
    }
    // a non-super caller gets the same refusal (nothing about any tenant is read to tell it apart) …
    h.reset(); assertRefused(h, await h.call(action, { tenantId: "tenantA\u0001" }, "own"), { error: "invalid tenantId" }, action + " by an owner");
    // … and authentication still comes first
    h.reset(); const r = await h.call(action, { tenantId: "tenantA\u0001" }, null);
    assert.equal(r.code, 401, action + ": unauthenticated is still 401"); assert.deepEqual(h.db.refs, []);
  }
  // the valid super_owner flows still succeed
  h.reset(); let r = await h.call("edit-client", { tenantId: "tenantA", bizName: "Renamed" }, "super");
  assert.equal(r.code, 200); assert.equal(JSON.parse(h.db.read("tenants/tenantA/app/business")._v)[0].name, "Renamed");
  h.reset(); r = await h.call("delete-client", { tenantId: "tenantB" }, "super");
  assert.equal(r.code, 200); assert.equal(h.db.read("tenants/tenantB"), null); assert.ok(h.db.read("tenants/tenantA"));
  h.reset(); r = await h.call("resend-invite", { tenantId: "tenantA" }, "super");
  assert.equal(r.code, 200); assert.equal(h.emails.length, 1);
});

test("DB-02 the local checks: every control code point in the tenant and business slots → the handler's own 400, zero references", async () => {
  const h = await head();
  const rows = [
    ["delete-user", (t) => ({ tenantId: t, firebaseUid: "sub1" }), "POST", { error: "invalid tenantId or firebaseUid" }],
    ["update-user", (t) => ({ tenantId: t, firebaseUid: "sub1", name: "X" }), "POST", { error: "invalid tenantId or firebaseUid" }],
    ["bootstrap-self", (t) => ({ tenantId: t }), "POST", { error: "invalid tenantId" }],
    ["create-user", (t) => ({ tenantId: t, email: "n@example.test", username: "nn", role: "viewer", allowedBizIds: ["bizA"] }), "POST", { error: "invalid characters in id" }],
    ["list-entry-exceptions", (t) => ({ tenantId: t, bizId: "bizA", fromDate: FROM, toDate: TO }), "GET", { error: "invalid tenantId or bizId" }],
    ["set-entry-exception", (t) => ({ tenantId: t, bizId: "bizA" }), "POST", { error: "invalid tenantId or bizId" }],
    ["clear-entry-exception", (t) => ({ tenantId: t, bizId: "bizA" }), "POST", { error: "invalid tenantId or bizId" }],
    ["get-analytics-daily", (t) => ({ tenantId: t, bizId: "bizA", fromDate: FROM, toDate: TO }), "GET", { error: "invalid tenantId or bizId" }],
    ["get-insights-daily", (t) => ({ tenantId: t, bizId: "bizA", fromDate: FROM, toDate: TO }), "GET", { error: "invalid tenantId or bizId" }],
    ["set-checklist-run", (t) => ({ tenantId: t, bizId: "bizA" }), "POST", { error: "invalid tenantId or bizId" }],
    ["list-supplier-credits", (t) => ({ tenantId: t, bizId: "bizA" }), "GET", { error: "invalid tenantId or bizId" }],
  ];
  for (const [action, body, method, expected] of rows)
    for (const t of tenantVariants()) { h.reset(); assertRefused(h, await h.call(action, body(t), "own", method), expected, `${action} tenant ${show(t)}`); }
  const bizRows = [
    ["list-entry-exceptions", (b) => ({ tenantId: "tenantA", bizId: b, fromDate: FROM, toDate: TO }), "GET"],
    ["set-entry-exception", (b) => ({ tenantId: "tenantA", bizId: b }), "POST"],
    ["get-analytics-daily", (b) => ({ tenantId: "tenantA", bizId: b, fromDate: FROM, toDate: TO }), "GET"],
    ["set-checklist-run", (b) => ({ tenantId: "tenantA", bizId: b }), "POST"],
    ["list-supplier-credits", (b) => ({ tenantId: "tenantA", bizId: b }), "GET"],
  ];
  for (const [action, body, method] of bizRows)
    for (const b of bizVariants()) { h.reset(); assertRefused(h, await h.call(action, body(b), "own", method), { error: "invalid tenantId or bizId" }, `${action} business ${show(b)}`); }
});

test("DB-03 roles: control identities are refused BEFORE the rate limiter and any database call; non-control ordering unchanged", async () => {
  const h = await head();
  for (const t of tenantVariants()) {
    for (const body of [{ tenantId: t, targetUid: "sub1", role: "manager" }, JSON.stringify({ tenantId: t, targetUid: "sub1", role: "manager" })]) {
      h.reset(); assertRefused(h, await h.call("roles", body, "own"), { error: "invalid tenantId" }, "roles tenant " + show(t) + (typeof body === "string" ? " (JSON string)" : ""));
    }
  }
  for (const b of bizVariants()) {
    h.reset(); assertRefused(h, await h.call("roles", { tenantId: "tenantA", targetUid: "sub1", role: "manager", allowedBizIds: ["bizB", b] }, "own"), { error: "invalid bizId in allowedBizIds" }, "roles allowedBizIds " + show(b));
  }
  // non-control: the limiter is consulted first (ip, uid), exactly as before
  h.reset(); let r = await h.call("roles", { tenantId: "tenantA", targetUid: "sub1", role: "manager", allowedBizIds: ["bizB"] }, "own");
  assert.equal(r.code, 200, show(r.body)); assert.equal(h.limiter.length, 2, "two limiter calls");
  assert.equal(h.db.read("tenants/tenantA/biz_access/bizB/sub1"), true); assert.equal(h.db.read("tenants/tenantA/biz_access/bizA/sub1"), null);
  h.reset(); r = await h.call("roles", "{not json", "own");
  assert.equal(r.code, 400); assert.deepEqual(r.body, { error: "invalid json" }); assert.equal(h.limiter.length, 2, "invalid JSON is still judged after the limiter");
  h.reset(); r = await h.call("roles", { tenantId: "tenant.A", targetUid: "sub1", role: "manager" }, "own");
  assert.deepEqual([r.code, r.body, h.limiter.length], [400, { error: "invalid characters" }, 2], "a non-control forbidden character keeps its order and message");
});

test("DB-04 allowedBizIds at the API: a raw control entry is refused before any database or Auth call — never aliased to another business", async () => {
  const h = await head();
  const lists = [["\nbizB"], ["bizB\n"], ["bizB\u0001"], ["bizA", "bizB\t"], ...CTRL.map((c) => ["bizB" + c])];
  for (const allowedBizIds of lists) {
    h.reset(); assertRefused(h, await h.call("create-user", { tenantId: "tenantA", email: "n@example.test", username: "nn", role: "viewer", allowedBizIds }, "own"), { error: "invalid bizId in allowedBizIds" }, "create-user " + show(allowedBizIds));
    h.reset(); assertRefused(h, await h.call("update-user", { tenantId: "tenantA", firebaseUid: "sub1", email: "changed@example.test", allowedBizIds }, "own"), { error: "invalid bizId in allowedBizIds" }, "update-user " + show(allowedBizIds));
    h.reset(); assertRefused(h, await h.call("roles", { tenantId: "tenantA", targetUid: "sub1", role: "viewer", allowedBizIds }, "own"), { error: "invalid bizId in allowedBizIds" }, "roles " + show(allowedBizIds));
  }
  // the identity the alias would have produced is never granted: the same lists without the control character succeed and
  // grant exactly bizB (so the refusal above is the control character's, not bizB's)
  h.reset(); let r = await h.call("create-user", { tenantId: "tenantA", email: "n@example.test", username: "nn", role: "viewer", allowedBizIds: ["bizB"] }, "own");
  assert.equal(r.code, 200, show(r.body)); assert.equal(h.db.read("tenants/tenantA/biz_access/bizB/newuid"), true);
  h.reset(); r = await h.call("update-user", { tenantId: "tenantA", firebaseUid: "sub1", allowedBizIds: ["bizB"] }, "own");
  assert.equal(r.code, 200, show(r.body)); assert.equal(h.db.read("tenants/tenantA/biz_access/bizB/sub1"), true); assert.equal(h.db.read("tenants/tenantA/biz_access/bizA/sub1"), null);
});

test("DB-05 persisted state and retries: a stored control entry is refused, never trimmed into another key; refusals repeat identically", async () => {
  const h = await head();
  for (const stored of ["bizB\n", "\nbizB", "bizB\u0001", "bizB\u007f"]) {
    const s = seed(); s.tenants.tenantA.users.sub1.allowedBizIds = ["bizA", stored]; s.tenants.tenantA.biz_access.bizB.sub1 = true;
    h.reset(s);
    const r = await h.call("update-user", { tenantId: "tenantA", firebaseUid: "sub1", allowedBizIds: ["bizA"] }, "own");
    assert.equal(r.code, 400, show(stored) + ": " + show(r.body)); assert.deepEqual(r.body, { error: "invalid bizId in allowedBizIds" });
    assert.deepEqual(h.db.value(), s, show(stored) + ": nothing written — bizB's access is not removed through the alias");
    assert.deepEqual(h.db.refused, [], "no reference carrying the stored entry"); assert.deepEqual(h.auth.calls, []);
    // with an e-mail change in the same request: refused BEFORE the Auth update (nothing to revert)
    h.reset(s);
    const r2 = await h.call("update-user", { tenantId: "tenantA", firebaseUid: "sub1", email: "changed@example.test", allowedBizIds: ["bizA"] }, "own");
    assert.deepEqual([r2.code, r2.body, h.auth.calls], [400, { error: "invalid bizId in allowedBizIds" }, []], show(stored) + ": no Auth e-mail change");
    assert.deepEqual(h.db.value(), s, show(stored) + ": nothing written");
  }
  // a stored control entry does not block a request that does not touch the scope (the stored list is never normalized then)
  { const s = seed(); s.tenants.tenantA.users.sub1.allowedBizIds = ["bizB\n"]; h.reset(s);
    const r = await h.call("update-user", { tenantId: "tenantA", firebaseUid: "sub1", name: "Renamed" }, "own");
    assert.equal(r.code, 200, show(r.body)); assert.equal(h.db.read("tenants/tenantA/users/sub1").name, "Renamed"); }
  for (const [action, body] of [["edit-client", { tenantId: "tenantA\u0001" }], ["roles", { tenantId: "tenantA", targetUid: "sub1", role: "viewer", allowedBizIds: ["bizB\n"] }], ["create-user", { tenantId: "tenantA", email: "n@example.test", username: "nn", role: "viewer", allowedBizIds: ["bizB\n"] }]]) {
    h.reset(); const first = observe(h, await h.call(action, body, action === "edit-client" ? "super" : "own"));
    for (let i = 0; i < 3; i += 1) { const again = observe(h, await h.call(action, body, action === "edit-client" ? "super" : "own")); assert.deepEqual(again, first, action + ": retry " + i + " identical"); }
    assert.deepEqual(h.db.value(), seed(), action + ": no audit, guard, claim or index entry after the retries");
  }
});

test("DB-06 normalizeAllowedBizIds: a raw control entry throws BEFORE the trim; every non-control list keeps its I3 result", async () => {
  const cur = (await (await head()).bizAccess()).normalizeAllowedBizIds;
  const lay = (await (await layer()).bizAccess()).normalizeAllowedBizIds;   // = cur unless an I5 tree is checked out (layering)
  const old = (await (await parent()).bizAccess()).normalizeAllowedBizIds;
  const run = (fn, x) => { try { return { ok: fn(x) }; } catch (e) { return { err: clone(e) }; } };
  for (const c of CTRL) for (const raw of withCtrl("bizB", c).concat([c, " " + c + " ", c + "bizB" + c]))
    assert.deepEqual(run(cur, ["bizA", raw]), { err: { status: 400, msg: "invalid bizId in allowedBizIds" } }, show(raw));
  for (const raw of ["\nbiz", "biz\n", "biz\u0001"]) assert.deepEqual(run(cur, [raw]), { err: { status: 400, msg: "invalid bizId in allowedBizIds" } }, "the review's cases " + show(raw));
  const corpus = [[], ["bizA"], [" bizA "], ["bizA", "bizA"], [""], ["   "], ["bizB", "bizA"], ["biz.A"], ["biz/A"], ["biz:A"], ["ביז א"], ["biz\u0080"], ["biz\u00a0"], ["biz\u2028"], ["\ufeffbiz"],
    ["x".repeat(128)], ["x".repeat(129)], [" " + "x".repeat(128) + " "], [5], [null], "bizA", null, undefined, {}, [["bizA"]]];
  for (const x of corpus) assert.deepEqual(run(lay, x), run(old, x), "non-control " + show(x) + " keeps its I3 result" + (LAYERED ? " (the I4 layer's bytes)" : ""));
});

test("DB-07 requireTenantAccess: control tenant → 400 before any reference; every non-control tenant keeps its I3 outcome", async () => {
  const H = await head(), P = await parent();
  const curF = (await H.helpers()).requireTenantAccess, oldF = (await P.helpers()).requireTenantAccess;
  const run = async (h, fn, uid, t, min) => { h.reset(); let out; try { out = { ok: await fn(uid, t, min) }; } catch (e) { out = { err: clone(e) }; } return { out, refs: [...h.db.refs], refused: h.db.refused.map((r) => r.path) }; };
  for (const t of [...tenantVariants(), ["tenantA\u0001"]]) {
    const r = await run(H, curF, "own", t, "viewer");
    assert.deepEqual(r.out, Array.isArray(t) ? { err: { status: 400, msg: "invalid tenantId" } } : { err: { status: 400, msg: "invalid characters in id" } }, show(t));
    assert.deepEqual([r.refs, r.refused], [[], []], show(t) + ": no reference");
  }
  for (const [uid, t, min] of [["own", "tenantA", "viewer"], ["own", "tenantA", "owner"], ["view", "tenantA", "manager"], ["own", "t:1", "owner"], ["foreign", "tenantA", "viewer"], ["own", "tenantB", "viewer"],
    ["own", "tenantA ", "viewer"], ["own", "סניף", "viewer"], ["own", "tenant\u0080A", "viewer"], ["own", "tenant.A", "viewer"], ["own", "", "viewer"], ["own", "x".repeat(129), "viewer"], ["own", 7, "viewer"], ["own.x", "tenantA", "viewer"], ["own", "tenantA", "super_owner"]])
    assert.deepEqual(await run(H, curF, uid, t, min), await run(P, oldF, uid, t, min), `non-control ${show([uid, t, min])} keeps its I3 outcome and references`);
});

test("DB-08 readRegistryTarget: control tenant key → invalid_request with zero references; callers answer 400; non-control results unchanged", async () => {
  const H = await head(), P = await parent();
  const cur = (await H.registry()).readRegistryTarget, old = (await P.registry()).readRegistryTarget;
  const run = async (h, fn, t, b) => { h.reset(); const out = await fn(h.db, t, b); return { out, refs: [...h.db.refs], refused: h.db.refused.map((r) => r.path) }; };
  for (const t of [...tenantVariants(), ["tenantA\u0001"]]) assert.deepEqual(await run(H, cur, t, "bizA"), { out: { state: "invalid_request" }, refs: [], refused: [] }, show(t));
  const I3red = await run(P, old, "tenantA\u0001", "bizA");   // the I3 behaviour this layer corrects (recorded, not asserted as a contract)
  assert.deepEqual(I3red.out, { state: "unavailable", reason: "read_failed" }, "I3 turned the SDK refusal into an availability failure");
  for (const t of ["tenantA", "t:1", "tenantB", "missing", "tenantA ", "סניף", "tenant\u0080A", "tenant.A", "", 7, null])
    for (const b of ["bizA", "bizB", "foreignBiz", "biz:A", " bizA", "bizA\u0001", ""])
      assert.deepEqual(await run(H, cur, t, b), await run(P, old, t, b), `non-control tenant ${show(t)} / business ${show(b)} keeps its I3 result`);
  // the callers: the P1 route maps invalid_request to 400 (and validates the tenant first); the Core gate refuses with 400 first
  H.reset(); assertRefused(H, await H.call("list-supplier-credits", { tenantId: "tenantA\u0001", bizId: "bizA" }, "own", "GET"), { error: "invalid tenantId or bizId" }, "P1 caller");
  const core = await import(pathToFileURL(join(H.dir, "lib/finance/costHistoryWriter.js")).href);
  H.reset(); let e = null; try { await core.requireBusinessInTenant(H.db, "tenantA\u0001", "bizA"); } catch (x) { e = x; }
  assert.deepEqual([e, H.db.refs], [{ status: 400, msg: "invalid id" }, []], "Core caller");
});

test("DB-09 shared-predicate endpoints (alerts read, agent ask): control ids → 400 from requireBizContext before any repository", async () => {
  const H = await head();
  const sc = await import(pathToFileURL(join(H.dir, "lib/securityContext.js")).href);
  const alerts = await import(pathToFileURL(join(H.dir, "lib/alertsCore.js")).href);
  const ask = await import(pathToFileURL(join(H.dir, "lib/agentAskCore.js")).href);
  const requireBizContext = (req, opts) => sc.requireBizContext(req, opts, { requireAuth: async () => ({ uid: "own" }) });
  const touched = [];
  const repos = new Proxy({}, { get: (_, k) => async () => { touched.push(k); return []; } });
  for (const [tenantId, bizId, msg] of [["tenantA\u0001", "bizA", "invalid tenantId"], ["tenantA", "bizA\u007f", "invalid bizId"], ["\ntenantA", "bizA", "invalid tenantId"]]) {
    H.reset();
    const a = await alerts.handleAlerts({ method: "GET", query: { tenantId, bizId }, headers: {} }, { requireCron: () => {}, requireBizContext, repos, logError: () => {} });
    assert.deepEqual([a.status, a.json], [400, { error: msg }], "alerts " + show([tenantId, bizId]));
    const q = await ask.handleAgentAsk({ method: "POST", body: { question: "מה המצב?", tenantId, bizId }, headers: {} }, { requireBizContext, routeQuestion: async () => { touched.push("route"); return {}; }, rateLimit: () => true, logError: () => {} });
    assert.deepEqual([q.status, q.json], [400, { error: msg }], "agent ask " + show([tenantId, bizId]));
    assert.deepEqual([H.db.refs, H.db.refused, touched], [[], [], []], "no reference, no repository");
  }
});

test("DB-10 the real Admin SDK refuses every code point of the class as a key; the application refuses first; U+0080 is not refused", async () => {
  const sdk = (await realSdk()).db;
  for (const c of CTRL) assert.throws(() => sdk.ref(`tenants/tenant${c}A`), undefined, "the SDK refuses U+" + c.charCodeAt(0).toString(16).padStart(4, "0"));
  assert.doesNotThrow(() => sdk.ref("tenants/tenant\u0080A/app/business"));
  const h = await head();
  h.reset(); const r = await h.call("edit-client", { tenantId: "tenant\u0080A", bizName: "x" }, "super");
  assert.equal(r.code, 404, "U+0080 is an ordinary (absent) tenant, not a refused identity"); assert.ok(h.db.refs.includes("tenants/tenant\u0080A/app/users"));
});

// ── DB-11: parity with I3 for every non-control value (deterministic clock, randomness and UUIDs in both runs) ──────────────────
const ISO = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?Z$/;
const scrub = (v) => (Array.isArray(v) ? v.map(scrub) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, scrub(x)])) : typeof v === "string" && ISO.test(v) ? "<iso>" : v);
async function frozen(fn) {
  const now = Date.now, rnd = Math.random, uuid = crypto.randomUUID;
  Date.now = () => 1760000000000; Math.random = () => 0.4242; crypto.randomUUID = () => "00000000-0000-4000-8000-000000000042"; syncBuiltinESMExports();
  try { return await fn(); } finally { Date.now = now; Math.random = rnd; crypto.randomUUID = uuid; syncBuiltinESMExports(); }
}
async function parity(action, body, actor, method = "POST") {
  const one = async (h) => { h.reset(); const res = await frozen(() => h.call(action, clone(body), actor, method)); return scrub(observe(h, res)); };
  const [a, b] = [await one(await layer()), await one(await parent())];
  assert.deepEqual(a, b, `${action} ${show(body)} as ${actor}: identical to I3`);
}
const TENANTS = ["tenantA", "t:1", "tenantB", "missing", "tenantA ", " tenantA", "סניף", "tenant\u0080A", "tenant\u00a0A", "tenant\u2028A", "", "tenant.A", "tenant/A", "x".repeat(128), "x".repeat(129), 12, null, ["tenantA"], { a: 1 }];
const BIZ = ["bizA", "bizB", "biz:A", " bizA", "bizA ", "ביז", "biz\u0080", "", "biz.A", "x".repeat(129), "foreignBiz"];
const ALLOWED = [["bizA"], [" bizA "], ["bizA", "bizA"], [""], ["bizB"], ["biz.A"], [5], "bizA", null, [], ["x".repeat(129)], ["biz:A"], ["ביז"], ["biz\u0080"]];

test("DB-11a parity: every non-control tenant id through every handler, every actor", async () => {
  for (const t of TENANTS) {
    await parity("edit-client", { tenantId: t, bizName: "N", ownerName: "M" }, "super");
    await parity("delete-client", { tenantId: t }, "super");
    await parity("resend-invite", { tenantId: t }, "super");
    await parity("delete-user", { tenantId: t, firebaseUid: "sub1", username: "sub1" }, "own");
    await parity("update-user", { tenantId: t, firebaseUid: "sub1", name: "Renamed" }, "own");
    await parity("bootstrap-self", { tenantId: t }, "newbie");
    await parity("roles", { tenantId: t, targetUid: "sub1", role: "manager", allowedBizIds: ["bizA"] }, "own");
    await parity("create-user", { tenantId: t, email: "n@example.test", username: "nn", role: "viewer", allowedBizIds: ["bizA"] }, "own");
    await parity("list-entry-exceptions", { tenantId: t, bizId: "bizA", fromDate: FROM, toDate: TO }, "own", "GET");
    await parity("get-analytics-daily", { tenantId: t, bizId: "bizA", fromDate: FROM, toDate: TO }, "own", "GET");
    await parity("list-supplier-credits", { tenantId: t, bizId: "bizA" }, "own", "GET");
  }
});

test("DB-11b parity: every non-control business id and allowedBizIds list; authorization and isolation by actor", async () => {
  for (const b of BIZ) {
    await parity("list-entry-exceptions", { tenantId: "tenantA", bizId: b, fromDate: FROM, toDate: TO }, "mgr", "GET");
    await parity("get-analytics-daily", { tenantId: "tenantA", bizId: b, fromDate: FROM, toDate: TO }, "view", "GET");
    await parity("list-supplier-credits", { tenantId: "tenantA", bizId: b }, "mgr", "GET");
    await parity("set-checklist-run", { tenantId: "tenantA", bizId: b }, "mgr");
  }
  for (const allowedBizIds of ALLOWED) {
    await parity("create-user", { tenantId: "tenantA", email: "n@example.test", username: "nn", role: "viewer", allowedBizIds }, "own");
    await parity("update-user", { tenantId: "tenantA", firebaseUid: "sub1", allowedBizIds }, "own");
    await parity("roles", { tenantId: "tenantA", targetUid: "sub1", role: "viewer", allowedBizIds }, "own");
  }
  for (const actor of ["super", "own", "mgr", "view", "foreign", null]) {
    await parity("edit-client", { tenantId: "tenantA", bizName: "N" }, actor);
    await parity("delete-client", { tenantId: "tenantA" }, actor);
    await parity("resend-invite", { tenantId: "tenantA" }, actor);
    await parity("roles", { tenantId: "tenantA", targetUid: "sub1", role: "manager", allowedBizIds: ["bizB"] }, actor);
    await parity("create-user", { tenantId: "tenantA", email: "n@example.test", username: "nn", role: "viewer", allowedBizIds: ["bizA"] }, actor);
    await parity("update-user", { tenantId: "tenantA", firebaseUid: "sub1", email: "new@example.test" }, actor);
    await parity("delete-user", { tenantId: "tenantA", firebaseUid: "sub1" }, actor);
    await parity("list-entry-exceptions", { tenantId: "tenantA", bizId: "bizA", fromDate: FROM, toDate: TO }, actor, "GET");
    await parity("list-supplier-credits", { tenantId: "tenantA", bizId: "foreignBiz" }, actor, "GET");
  }
  await parity("roles", { tenantId: "tenantA", targetUid: "own", role: null }, "own");   // owner guard: last owner
  await parity("roles", "{not json", "own");
});
