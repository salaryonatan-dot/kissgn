// Agent/Daily integration I5 — the exact-identity correction (behavioural contract; LOCAL, pending independent Codex review and the
// M1 identity / admin-API / P0 / P1 / user-access owners' acceptance). It answers the independent I4 review (I4-R-01..03) with the
// APPROVED identity contract only: tenant ids are judged by lib/securityContext.js isValidId (":" allowed), business ids by
// lib/businessRegistry.js isRegistryBizId (":" refused); an identifier is used exactly as sent or refused — never trimmed, coerced
// or aliased. Every row drives the REAL api/admin.js handler or the REAL helper against the reference-recording database of
// test/support/i4-boundary-harness.mjs (every path through the real Admin SDK path constructor; Auth / e-mail / Upstash recorded).
//   EX-01  a padded business id is its own identity: create-user / update-user / roles grant EXACTLY " bizB " (never bizB) when
//          both businesses exist; "bizB" grants exactly bizB; both → both; user records store the same exact list; retries identical
//   EX-02  stored scope: update-user revokes from the user's ACTUAL biz_access entries — a legacy trimmed grant (stored " bizB ",
//          granted bizB) is not left behind; roles already did so (unchanged)
//   EX-03  normalizeAllowedBizIds ≡ the approved business predicate, exactly: every non-empty entry kept byte for byte iff
//          isRegistryBizId accepts it, otherwise 400 (padded kept, ":" refused, forbidden / control / >128 refused); "" skipped;
//          exact duplicates collapse
//   EX-04  business ":" refused consistently: allowedBizIds in create-user / update-user / roles (no grant, no Auth change) and every
//          eeValidIds route (entry exceptions, business data, analytics / insights) before any reference; tenant ":" still valid
//   EX-05  non-string / invalid tenant ids in edit-client / delete-client / resend-invite (arrays, objects with toString, numbers,
//          booleans, forbidden characters, >128): 400 invalid tenantId before the super_owner lookup, any reference, Auth change or
//          e-mail; authentication first; absent / empty ids keep their existing answers; valid string ids (incl. ":") proceed
//   EX-06  parity with the I4 commit (git objects) for every input outside the corrected classes — same status, body, references,
//          Auth calls, e-mails, limiter calls and final state; authorization, tenant isolation, invitations unchanged
//   EX-07  the I4 control protection where I5 did not replace it: roles' pre-limiter refusal covers a NON-STRING tenant id whose
//          interpolation carries a control character (I4's array branch of carriesControlChar, previously proven through the
//          super_owner handlers that I5 now guards with isValidId)
import { test, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { syncBuiltinESMExports } from "node:module";
import { adminHarness, observe, seed, closeSdk, clone, env, ROOT } from "../support/i4-boundary-harness.mjs";
import { I5_PARENT } from "../support/i5-integration.mjs";
// I6 layering (T-I6-TEST-LAYER; M1 integration owner — the DB-06 / DB-11 pattern of T-I5-TEST): on a tree that carries the I6
// registry-binding successor, the EX-06 parity rows compare the I5 commit's OWN bytes (git objects) with the I4 commit's — exactly
// the I5 layer property, unchanged. I6's behaviour against I5 is held by test/finance/i6-registry-binding.test.mjs (RB-10).
import { isI6Tree, I6_PARENT } from "../support/i6-integration.mjs";
const LAYERED = isI6Tree(ROOT);
let I5OBJ = null;
const i5obj = async () => (I5OBJ ??= await adminHarness({ source: I6_PARENT }));   // the I5 commit's bytes

const FROM = "2026-10-01", TO = "2026-10-02";
const show = (s) => JSON.stringify(s);
let HEAD = null, PARENT = null;
const head = async () => (HEAD ??= await adminHarness());
const parent = async () => (PARENT ??= await adminHarness({ source: I5_PARENT }));   // the I4 commit's bytes
after(async () => { await closeSdk(); });
const SDK_TEXT = /path argument|Paths must|invalid path|child failed/i;
const ba = (h, b, u) => h.db.read(`tenants/tenantA/biz_access/${b}/${u}`);

/** both " bizB " and "bizB" registered (both are valid, distinct identities under isRegistryBizId) */
function bothSeed() {
  const s = seed();
  s.tenants.tenantA.app.business = env([{ id: "bizA", name: "Alpha" }, { id: "bizB", name: "Plain" }, { id: " bizB ", name: "Padded" }]);
  return s;
}
function assertRefused(h, res, body, label, { allowRefs = false } = {}) {
  const o = observe(h, res);
  assert.deepEqual([o.status, o.body], [400, body], label);
  if (!allowRefs) assert.deepEqual(o.refs, [], label + ": no database reference");
  assert.deepEqual(o.refused, [], label + ": the SDK was never asked to build a refused path");
  assert.deepEqual(o.auth, [], label + ": no Auth call");
  assert.equal(o.emails, 0, label + ": no e-mail");
  assert.ok(!SDK_TEXT.test(JSON.stringify(o.body)), label + ": no SDK text");
}

// I6 test-contract transition (T-I6-EX01; user-access / M1 identity owners — independent I5 review I5-R-01): the I5 rows granted
// " bizB " while the registry held BOTH "bizB" and " bizB " — a registry the approved M1 classifier calls AMBIGUOUS — so their
// success was not authorization evidence. The exact-identity / no-alias / raw-id / role / persisted-state / retry checks are kept,
// over registries that REGISTER the requested id; the twin registry is now a refusal with nothing written.
const regSeed = (ids) => { const s = seed(); s.tenants.tenantA.app.business = env(ids.map((id) => ({ id, name: id }))); return s; };
test("EX-01 a padded business id is its own identity: exactly the registered requested business is granted, never the trimmed one", async () => {
  const h = await head();
  const cases = [
    ["create-user", (ids) => ({ tenantId: "tenantA", email: "n@example.test", username: "nn", role: "viewer", allowedBizIds: ids }), "newuid"],
    ["update-user", (ids) => ({ tenantId: "tenantA", firebaseUid: "sub1", allowedBizIds: ids }), "sub1"],
    ["roles", (ids) => ({ tenantId: "tenantA", targetUid: "sub1", role: "viewer", allowedBizIds: ids }), "sub1"],
  ];
  for (const [action, body, uid] of cases) {
    // registered requested ids: exactly those are granted and stored, byte for byte
    for (const [registry, ids] of [[["bizA", " bizB "], [" bizB "]], [["bizA", "bizB"], ["bizB"]], [["bizA", " bizB "], [" bizB ", "bizA"]], [["bizA", "bizB "], ["bizB "]]]) {
      h.reset(regSeed(registry));
      const r = await h.call(action, body(ids), "own");
      assert.equal(r.code, 200, `${action} ${show(ids)} over ${show(registry)}: ${show(r.body)}`);
      for (const b of ["bizB", " bizB ", "bizB ", " bizB"]) assert.equal(ba(h, b, uid) === true, ids.includes(b), `${action} ${show(ids)}: grant ${show(b)} ⇔ requested exactly`);
      assert.deepEqual(h.db.refused, [], "every exact key is a valid RTDB key (the SDK accepts it)");
      if (action !== "roles") assert.deepEqual(h.db.read(`tenants/tenantA/users/${uid}`).allowedBizIds, ids, `${action}: the stored scope is the exact list`);
      const appUser = JSON.parse(h.db.read("tenants/tenantA/app/users")._v).find((u) => u.firebaseUid === uid);
      assert.deepEqual(appUser.allowedBizIds, ids, `${action}: app/users carries the exact list`);
    }
    // an id the registry cannot establish uniquely (plain / padded twin, in both directions): refused, NOTHING written, no alias
    for (const [registry, ids] of [[["bizA", "bizB"], [" bizB "]], [["bizA", " bizB "], ["bizB"]], [["bizA", "bizB", " bizB "], [" bizB "]], [["bizA", " bizB ", "bizB"], ["bizB"]], [["bizA", "bizB", " bizB "], [" bizB ", "bizB"]]]) {
      const before = regSeed(registry); h.reset(before);
      const o = observe(h, await h.call(action, body(ids), "own"));
      assert.deepEqual([o.status, o.body], [503, { error: "business_registry_ambiguous" }], `${action} ${show(ids)} over ${show(registry)}`);
      assert.deepEqual(o.state, before, `${action}: nothing written`); assert.deepEqual(o.auth, [], `${action}: no Auth call`); assert.equal(o.emails, 0);
    }
  }
  // retry of the same request: identical, no extra grant
  h.reset(regSeed(["bizA", " bizB "]));
  const first = observe(h, await h.call("roles", cases[2][1]([" bizB "]), "own"));
  const again = observe(h, await h.call("roles", cases[2][1]([" bizB "]), "own"));
  assert.equal(again.status, 200); assert.deepEqual(again.state.tenants.tenantA.biz_access, first.state.tenants.tenantA.biz_access, "retry: same grants");
});

test("EX-02 stored scope: update-user revokes from the ACTUAL biz_access entries — a legacy trimmed grant is not left behind", async () => {
  const h = await head();
  // legacy state written by the pre-I5 trim: the record says " bizB ", the grant is bizB
  const s = bothSeed(); s.tenants.tenantA.users.sub1.allowedBizIds = [" bizB "]; s.tenants.tenantA.biz_access.bizA.sub1 = null; delete s.tenants.tenantA.biz_access.bizA.sub1; s.tenants.tenantA.biz_access.bizB.sub1 = true;
  for (const [action, body] of [["update-user", { tenantId: "tenantA", firebaseUid: "sub1", allowedBizIds: ["bizA"] }], ["roles", { tenantId: "tenantA", targetUid: "sub1", role: "viewer", allowedBizIds: ["bizA"] }]]) {
    h.reset(s);
    const r = await h.call(action, body, "own");
    assert.equal(r.code, 200, `${action}: ${show(r.body)}`);
    assert.deepEqual([ba(h, "bizA", "sub1"), ba(h, "bizB", "sub1"), ba(h, " bizB ", "sub1")], [true, null, null], `${action}: exactly bizA remains; the trimmed legacy grant is revoked`);
  }
  // clean state (record == grants): the same diff as before
  h.reset(seed());
  const r = await h.call("update-user", { tenantId: "tenantA", firebaseUid: "sub1", allowedBizIds: ["bizB"] }, "own");
  assert.equal(r.code, 200); assert.deepEqual([ba(h, "bizA", "sub1"), ba(h, "bizB", "sub1")], [null, true]);
});

test("EX-03 normalizeAllowedBizIds ≡ the approved business predicate, exactly (kept byte for byte or refused; \"\" skipped; exact duplicates collapse)", async () => {
  const H = await head();
  const { normalizeAllowedBizIds } = await H.bizAccess();
  const { isRegistryBizId } = await H.registry();
  const run = (x) => { try { return { ok: normalizeAllowedBizIds(x) }; } catch (e) { return { err: clone(e) }; } };
  const corpus = ["bizA", " bizA", "bizA ", " bizA ", "   ", "\u00a0bizA", "biz A", "ביז א", "biz\u0080", "biz\u2028", "\ufeffbiz", "biz:A", ":", "biz.A", "biz/A", "biz#A", "biz$A", "biz[A]",
    "x".repeat(128), "x".repeat(129), " " + "x".repeat(127), "biz\n", "\tbiz", "biz\u0001", "biz\u007f", "t:1"];
  for (const v of corpus) {
    const want = isRegistryBizId(v) ? { ok: [v] } : { err: { status: 400, msg: "invalid bizId in allowedBizIds" } };
    assert.deepEqual(run([v]), want, show(v));
  }
  assert.deepEqual(run(["", "bizA", "", "bizA", " bizA", "bizA"]), { ok: ["bizA", " bizA"] }, "\"\" skipped; exact duplicates collapse; padded kept distinct");
  for (const bad of ["bizA", null, 5, {}]) assert.equal(run(bad).err.status, 400, "non-array refused: " + show(bad));
  for (const bad of [[5], [null], [["bizA"]]]) assert.deepEqual(run(bad), { err: { status: 400, msg: "allowedBizIds entries must be strings" } });
});

test("EX-04 business \":\" refused consistently before any grant, reference or Auth change; tenant \":\" stays valid", async () => {
  const h = await head();
  for (const ids of [["biz:B"], ["bizA", "biz:B"], [":"], ["bizB:"]]) {
    h.reset(); let r = await h.call("create-user", { tenantId: "tenantA", email: "n@example.test", username: "nn", role: "viewer", allowedBizIds: ids }, "own");
    assertRefused(h, r, { error: "invalid bizId in allowedBizIds" }, "create-user " + show(ids), { allowRefs: true });
    assert.deepEqual(h.db.value(), seed(), "create-user: nothing written"); assert.ok(h.db.refs.every((p) => !String(p).includes("biz_access")), "no biz_access reference");
    h.reset(); r = await h.call("update-user", { tenantId: "tenantA", firebaseUid: "sub1", email: "changed@example.test", allowedBizIds: ids }, "own");
    assertRefused(h, r, { error: "invalid bizId in allowedBizIds" }, "update-user " + show(ids));
    assert.deepEqual(h.db.value(), seed(), "update-user: nothing written, the e-mail not changed");
    h.reset(); r = await h.call("roles", { tenantId: "tenantA", targetUid: "sub1", role: "viewer", allowedBizIds: ids }, "own");
    assertRefused(h, r, { error: "invalid bizId in allowedBizIds" }, "roles " + show(ids), { allowRefs: true });
    assert.deepEqual(h.db.value(), seed(), "roles: nothing written"); assert.ok(h.db.refs.every((p) => !String(p).includes("biz:")), "no reference carrying the id");
  }
  const routes = [
    ["list-entry-exceptions", (b) => ({ tenantId: "tenantA", bizId: b, fromDate: FROM, toDate: TO }), "GET"],
    ["set-entry-exception", (b) => ({ tenantId: "tenantA", bizId: b }), "POST"],
    ["clear-entry-exception", (b) => ({ tenantId: "tenantA", bizId: b }), "POST"],
    ["get-analytics-daily", (b) => ({ tenantId: "tenantA", bizId: b, fromDate: FROM, toDate: TO }), "GET"],
    ["get-insights-daily", (b) => ({ tenantId: "tenantA", bizId: b, fromDate: FROM, toDate: TO }), "GET"],
    ["set-checklist-run", (b) => ({ tenantId: "tenantA", bizId: b }), "POST"],
    ["get-checklist-template-items", (b) => ({ tenantId: "tenantA", bizId: b, templateId: "t1" }), "GET"],
    ["list-supplier-credits", (b) => ({ tenantId: "tenantA", bizId: b }), "GET"],
  ];
  for (const [action, body, method] of routes) for (const b of ["biz:A", "bizA:", ":", ""]) {
    h.reset(); const r = await h.call(action, body(b), "own", method);
    assertRefused(h, r, { error: "invalid tenantId or bizId" }, `${action} ${show(b)}`);
    assert.deepEqual(h.db.value(), seed(), action + ": nothing written");
  }
  // the tenant ":" rule is untouched: a "t:1" tenant passes every local check and is authorized as before
  h.reset(); let r = await h.call("list-entry-exceptions", { tenantId: "t:1", bizId: "bizA", fromDate: FROM, toDate: TO }, "own", "GET");
  assert.ok(h.db.refs.includes("tenants/t:1/members/own"), "t:1 reaches tenant access"); assert.notEqual(r.code, 400);
  h.reset(); r = await h.call("create-user", { tenantId: "t:1", email: "n@example.test", username: "nn", role: "viewer", allowedBizIds: ["bizA"] }, "own");
  assert.equal(r.code, 200, show(r.body)); assert.equal(h.db.read("tenants/t:1/biz_access/bizA/newuid"), true);
  h.reset(); r = await h.call("edit-client", { tenantId: "t:1", bizName: "C" }, "super");
  assert.equal(r.code, 404, "t:1 is a valid tenant id for the super_owner handlers (it has no app/users)"); assert.ok(h.db.refs.includes("tenants/t:1/app/users"));
});

test("EX-05 non-string / invalid tenant ids in the super_owner handlers: 400 before the lookup, any reference, Auth change or e-mail", async () => {
  const h = await head();
  const invalid = [["tenantA"], ["t:1"], ["tenantA", "x"], { toString: () => "tenantA" }, { a: 1 }, 12, true, "tenant.A", "tenant/A", "tenant#A", "x".repeat(129), "tenantA\n", ["tenantA\u0001"]];
  for (const action of ["edit-client", "delete-client", "resend-invite"]) {
    for (const tenantId of invalid) {
      for (const actor of ["super", "own"]) {
        h.reset(); const r = await h.call(action, { tenantId, bizName: "X" }, actor);
        assertRefused(h, r, { error: "invalid tenantId" }, `${action} ${show(tenantId)} as ${actor}`);
        assert.deepEqual(h.db.value(), seed(), action + ": state unchanged");
      }
      h.reset(); const r = await h.call(action, { tenantId }, null);
      assert.equal(r.code, 401, action + ": authentication still first"); assert.deepEqual(h.db.refs, []);
    }
    // absent / empty ids keep their existing (post-lookup) answers; valid strings — including ":" and padded — proceed
    for (const tenantId of [undefined, "", null, 0]) {
      h.reset(); const r = await h.call(action, tenantId === undefined ? {} : { tenantId }, "super");
      assert.equal(r.code, 400, action + " missing " + show(tenantId)); assert.ok(h.db.refs.includes("tenants"), "after the super_owner lookup, as before");
    }
  }
  h.reset(); let r = await h.call("resend-invite", { tenantId: "tenantA" }, "super");
  assert.equal(r.code, 200); assert.equal(h.emails.length, 1); assert.equal(h.auth.calls.filter((c) => c[0] === "updateUser").length, 1, "the valid invitation still resets and sends once");
  h.reset(); r = await h.call("resend-invite", { tenantId: ["tenantA"] }, "super");
  assert.deepEqual([r.code, h.emails.length, h.auth.calls.length], [400, 0, 0], "the review's case: no password reset, no invitation");
  h.reset(); r = await h.call("edit-client", { tenantId: " tenantA", bizName: "N" }, "super");
  assert.equal(r.code, 404, "a padded tenant is a valid, distinct (absent) identity — never trimmed into tenantA"); assert.equal(JSON.parse(h.db.read("tenants/tenantA/app/business")._v)[0].name, "Alpha");
});

// ── EX-06 parity with the I4 commit outside the corrected classes (deterministic clock / randomness / UUIDs) ──────────────────────
const ISO = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?Z$/;
const scrub = (v) => (Array.isArray(v) ? v.map(scrub) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, scrub(x)])) : typeof v === "string" && ISO.test(v) ? "<iso>" : v);
async function frozen(fn) {
  const now = Date.now, rnd = Math.random, uuid = crypto.randomUUID;
  Date.now = () => 1760000000000; Math.random = () => 0.4242; crypto.randomUUID = () => "00000000-0000-4000-8000-000000000042"; syncBuiltinESMExports();
  try { return await fn(); } finally { Date.now = now; Math.random = rnd; crypto.randomUUID = uuid; syncBuiltinESMExports(); }
}
/** `extraRef`: the ONE additional read I5 is allowed to make (update-user reads the user's actual biz_access entries — EX-02); it is
 *  removed once from I5's reference list (it must be there) and everything else must be identical. */
async function parity(action, body, actor, method = "POST", { extraRef = null } = {}) {
  const one = async (h) => { h.reset(); const res = await frozen(() => h.call(action, clone(body), actor, method)); return scrub(observe(h, res)); };
  const [a, b] = [await one(LAYERED ? await i5obj() : await head()), await one(await parent())];
  if (extraRef && a.refs.includes(extraRef) && a.refs.filter((r) => r === extraRef).length === b.refs.filter((r) => r === extraRef).length + 1) a.refs.splice(a.refs.lastIndexOf(extraRef), 1);
  assert.deepEqual(a, b, `${action} ${show(body)} as ${actor}: identical to I4`);
}
// valid string tenants (incl. ":" and padded) and absent / empty ones: unchanged everywhere
const SAME_TENANTS = ["tenantA", "t:1", "tenantB", "missing", "tenantA ", " tenantA", "סניף", "tenant\u0080A", "tenant\u00a0A", "", null, undefined];
// handlers whose tenant validation I5 does not touch: unchanged for EVERY value, including non-strings and forbidden characters
const ALL_TENANTS = [...SAME_TENANTS, "tenant.A", "x".repeat(129), 12, ["tenantA"], { a: 1 }];
const SAME_BIZ = ["bizA", "bizB", " bizA", "bizA ", "ביז", "biz\u0080", "biz.A", "x".repeat(129), "foreignBiz"];
const SAME_ALLOWED = [["bizA"], ["bizA", "bizA"], [""], ["bizB"], [5], "bizA", null, [], ["ביז"], ["biz\u0080"], ["biz.A"], ["x".repeat(129)]];

test("EX-06a parity with I4: every tenant id outside the corrected classes, every handler", async () => {
  for (const t of SAME_TENANTS) {
    await parity("edit-client", { tenantId: t, bizName: "N", ownerName: "M" }, "super");
    await parity("delete-client", { tenantId: t }, "super");
    await parity("resend-invite", { tenantId: t }, "super");
  }
  for (const t of ALL_TENANTS) {
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

test("EX-06b parity with I4: business ids and scope lists outside the corrected classes; authorization and isolation by actor", async () => {
  for (const b of SAME_BIZ) {
    await parity("list-entry-exceptions", { tenantId: "tenantA", bizId: b, fromDate: FROM, toDate: TO }, "mgr", "GET");
    await parity("get-analytics-daily", { tenantId: "tenantA", bizId: b, fromDate: FROM, toDate: TO }, "view", "GET");
    await parity("list-supplier-credits", { tenantId: "tenantA", bizId: b }, "mgr", "GET");
    await parity("set-checklist-run", { tenantId: "tenantA", bizId: b }, "mgr");
  }
  for (const allowedBizIds of SAME_ALLOWED) {
    await parity("create-user", { tenantId: "tenantA", email: "n@example.test", username: "nn", role: "viewer", allowedBizIds }, "own");
    await parity("roles", { tenantId: "tenantA", targetUid: "sub1", role: "viewer", allowedBizIds }, "own");
    if (!(Array.isArray(allowedBizIds) && allowedBizIds.some((v) => typeof v === "string" && /[.]|^x{129}$/.test(v))))   // update-user now refuses those BEFORE Phase 4 (EX-04 class)
      await parity("update-user", { tenantId: "tenantA", firebaseUid: "sub1", allowedBizIds }, "own", "POST", { extraRef: "tenants/tenantA/biz_access" });
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
  await parity("roles", { tenantId: "tenantA", targetUid: "own", role: null }, "own");
  await parity("roles", "{not json", "own");
});

test("EX-07 roles: a non-string tenant id carrying a control character is still refused BEFORE the rate limiter (I4 protection kept)", async () => {
  const h = await head();
  for (const tenantId of [["tenantA\u0001"], ["tenantA", "\n"], ["\u007ftenantA"]]) {
    for (const body of [{ tenantId, targetUid: "sub1", role: "manager" }, JSON.stringify({ tenantId, targetUid: "sub1", role: "manager" })]) {
      h.reset(); const r = await h.call("roles", body, "own"); const o = observe(h, r);
      assert.deepEqual([o.status, o.body, o.limiter, o.refs, o.refused, o.auth], [400, { error: "invalid tenantId" }, 0, [], [], []], "roles " + show(tenantId) + (typeof body === "string" ? " (JSON string)" : ""));
    }
  }
  // a non-string WITHOUT a control character keeps its I4 order (limiter first, then the local type check) — EX-06 parity class
  h.reset(); const r = await h.call("roles", { tenantId: ["tenantA"], targetUid: "sub1", role: "manager" }, "own");
  assert.deepEqual([r.code, r.body, h.limiter.length, h.db.refs], [400, { error: "invalid tenantId" }, 2, []]);
});
