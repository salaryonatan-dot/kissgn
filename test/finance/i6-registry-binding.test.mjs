// Agent/Daily integration I6 — registry binding of grants and consumers, the shared business-slot predicate, and the update-user
// ordering (behavioural contract; LOCAL, pending independent Codex review and the M1 identity / user-access / admin-API / P0 / P1 /
// audit / consumer owners' acceptance). It answers the independent I5 review (I5-R-01..04) with the APPROVED M1 contract only:
// the business predicate lib/businessRegistry.js isRegistryBizId and the authoritative registry rule classifyRegistryTarget /
// readRegistryTarget (exact identity; a plain / padded twin, a duplicate or a coerced record is ambiguous). Every admin row drives
// the REAL api/admin.js handler against the reference-recording database of test/support/i4-boundary-harness.mjs (every path
// through the real Admin SDK path constructor; Auth / e-mail / Upstash recorded); every consumer row drives the REAL core or the
// REAL compiled route with the REAL lib/securityContext.js.
//   RB-01  grant writers (create-user / update-user / roles) × registry states: only `registered` exact ids are granted; ambiguous
//          (twin both orders, coerced, duplicate), not_registered (incl. another tenant's business), unreadable (absent, malformed)
//          and unavailable (read failure, timeout) are refused with the approved mapping — no Auth creation / e-mail change, no
//          write, no e-mail; other users' grants and other tenants untouched
//   RB-02  authorization order kept: unauthorized actors are refused before any registry read; repeated requests are identical
//   RB-03  update-user under injected failures with a simultaneous e-mail + scope change: every read / refusal happens before the
//          Auth e-mail change (Auth and RTDB stay aligned); the remaining non-atomic step (the final write) is compensated
//          best-effort and an identical retry re-converges; target-only revocation
//   RB-04  create-user: the registry and app/users reads precede the Auth user (no create + delete on a failed read)
//   RB-05  roles: registry refusal / failure before the owner guard or any write
//   RB-06  requireBizContext: business ":" (and every id the business predicate refuses) → 400 before tenant access or any handle;
//          authentication first; tenant ":" and exact padded ids proceed; the plain gate reads no registry
//   RB-07  requireRegisteredBizContext: ONE registry read after the full gate; only `registered` passes; a stale grant to an
//          unregistered or ambiguous business is refused; no registry read when the gate already refused
//   RB-08  the real Alerts (read + config write), Agent Ask and Proactive cores with the real registered gate: refused requests
//          never reach a repository / router
//   RB-09  the real compiled routes (api/alerts/run.ts, api/agent/ask.ts, api/proactive/run.ts, api/daily-snapshot/run.ts) and the
//          Core cost-history writer: registered → served; ambiguous / unregistered / business ":" → refused before any data seam;
//          Cost History keeps exactly one registry read per authorization (no duplicate, no discordant answer)
//   RB-10  parity with the I5 commit (git objects) outside the corrected classes: same status, body, Auth, e-mail, limiter and
//          final state; references differ only by the added registry read and by reads moved before the Auth mutation
import { test, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { syncBuiltinESMExports } from "node:module";
import { mkdtempSync, writeFileSync, cpSync, mkdirSync, existsSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { adminHarness, observe, seed, closeSdk, clone, env, ROOT } from "../support/i4-boundary-harness.mjs";
import { I6_PARENT } from "../support/i6-integration.mjs";
import * as SC from "../../lib/securityContext.js";
// On the parent (I5, parent-red runs) the registered variant does not exist and the consumer routes inject the plain gate — the
// fallback reproduces exactly that production wiring, so each row reports the parent's real behaviour.
const { requireBizContext } = SC;
const requireRegisteredBizContext = SC.requireRegisteredBizContext ?? Object.defineProperty((req, opts, deps) => SC.requireBizContext(req, opts, deps), "name", { value: "requireRegisteredBizContext(absent: plain gate)" });
import { classifyRegistryTarget } from "../../lib/businessRegistry.js";
import { handleAlerts } from "../../lib/alertsCore.js";
import { handleAgentAsk } from "../../lib/agentAskCore.js";
import { handleProactiveRead } from "../../lib/proactiveCore.js";
import { createCostHistoryWriter } from "../../lib/finance/costHistoryWriter.js";

const show = (s) => JSON.stringify(s);
let HEAD = null, I5 = null;
const head = async () => (HEAD ??= await adminHarness());
const i5 = async () => (I5 ??= await adminHarness({ source: I6_PARENT }));   // the I5 commit's bytes
after(async () => { await closeSdk(); });
const ba = (h, b, u, t = "tenantA") => h.db.read(`tenants/${t}/biz_access/${b}/${u}`);
const REG = "tenants/tenantA/app/business";

// ── registry fixtures (the runtime `{ _v }` node) and the approved mapping ──────────────────────────────────────────────────────
const R = {
  "sole-padded": env([{ id: "bizA", name: "A" }, { id: " bizB ", name: "Padded" }]),
  "sole-plain": env([{ id: "bizA", name: "A" }, { id: "bizB", name: "Plain" }]),
  "twin-plain-first": env([{ id: "bizA" }, { id: "bizB" }, { id: " bizB " }]),
  "twin-padded-first": env([{ id: "bizA" }, { id: " bizB " }, { id: "bizB" }]),
  "coerced-twin": env([{ id: "bizA" }, { id: "bizB" }, "bizB"]),
  duplicate: env([{ id: "bizA" }, { id: "bizB" }, { id: "bizB" }]),
  "unrelated-defect": env([{ id: "bizA" }, { id: "bizB" }, { id: null }, { name: "no id" }]),
  absent: null,
  malformed: { _v: "{bad" },
  "not-array": { _v: JSON.stringify({ id: "bizB" }) },
};
const MAP = {
  not_registered: [403, "business_not_in_tenant"], ambiguous: [503, "business_registry_ambiguous"],
  unreadable: [503, "business_registry_unreadable"], unavailable: [503, "business_registry_unavailable"],
};
const regSeed = (raw) => { const s = seed(); if (raw === null) delete s.tenants.tenantA.app.business; else s.tenants.tenantA.app.business = clone(raw); return s; };
/** Make reads of `path` fail (throw now, or reject after a delay = a timeout). Returns the restore function. */
function failRead(h, path, { delayMs = 0, message = "local injected read failure" } = {}) {
  const base = h.db.ref;
  h.db.ref = (p) => {
    const r = base(p);
    if (p === path) {
      const boom = async () => { if (delayMs) await new Promise((res) => setTimeout(res, delayMs)); throw Object.assign(new Error(message), { code: delayMs ? "ETIMEDOUT" : "EIO" }); };
      r.once = boom; r.get = boom;
    }
    return r;
  };
  return () => { h.db.ref = base; };
}
/** Fail the root multi-path update. */
function failWrite(h) {
  const base = h.db.ref;
  h.db.ref = (p) => { const r = base(p); if (p === undefined) r.update = async () => { throw new Error("local injected write failure"); }; return r; };
  return () => { h.db.ref = base; };
}
/** An Auth model over the recording seam: the effective e-mail of each uid, and injectable failures. */
function authModel(h, emails, failOn = () => null) {
  const orig = h.auth.updateUser;
  const state = { ...emails };
  h.auth.updateUser = async (uid, o) => {
    h.auth.calls.push(["updateUser", uid, clone(o)]);
    const f = failOn(uid, o);
    if (f === "reject") throw Object.assign(new Error("injected Auth failure"), { code: "auth/internal-error" });
    if (o && typeof o.email === "string") state[uid] = o.email;
    if (f === "applied-then-timeout") throw Object.assign(new Error("deadline exceeded"), { code: "ETIMEDOUT" });
    return { uid };
  };
  return { state, restore: () => { h.auth.updateUser = orig; } };
}
const storedEmails = (h, uid) => ({ users: h.db.read(`tenants/tenantA/users/${uid}`)?.email ?? null, appUsers: (JSON.parse(h.db.read("tenants/tenantA/app/users")?._v || "[]").find((u) => u.firebaseUid === uid) || {}).email ?? null });

// ── RB-01 ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const WRITERS = [
  ["create-user", (ids) => ({ tenantId: "tenantA", email: "n@example.test", username: "nn", role: "viewer", allowedBizIds: ids }), "newuid"],
  ["update-user", (ids) => ({ tenantId: "tenantA", firebaseUid: "sub1", email: "changed@example.test", allowedBizIds: ids }), "sub1"],
  ["roles", (ids) => ({ tenantId: "tenantA", targetUid: "sub1", role: "manager", allowedBizIds: ids }), "sub1"],
];
test("RB-01 grant writers grant ONLY authoritatively registered exact ids; every other registry state is refused with nothing written", async () => {
  const h = await head();
  let rows = 0;
  for (const [action, body, uid] of WRITERS) {
    for (const [name, raw] of Object.entries(R)) {
      for (const ids of [[" bizB "], ["bizB"], ["bizA", " bizB "], ["bizA"]]) {
        const before = regSeed(raw); h.reset(before);
        const o = observe(h, await h.call(action, body(ids), "own"));
        const states = ids.map((id) => classifyRegistryTarget(raw, id).state);
        const refused = states.find((s) => s !== "registered");
        const label = `${action} ${show(ids)} over ${name}`;
        if (!refused) {
          assert.equal(o.status, 200, label + ": " + show(o.body));
          for (const b of ["bizA", "bizB", " bizB "]) assert.equal(ba(h, b, uid) === true, ids.includes(b), label + ": grant " + show(b) + " ⇔ requested exactly");
          assert.equal(ba(h, "bizB", "sub2"), true, label + ": another user's grant untouched");
          assert.deepEqual(o.state.tenants.tenantB, before.tenants.tenantB, label + ": another tenant untouched");
          assert.ok(o.refs.filter((p) => p === REG).length >= 1, label + ": the registry was read");
        } else {
          assert.deepEqual([o.status, o.body], [MAP[refused][0], { error: MAP[refused][1] }], label);
          assert.deepEqual(o.state, before, label + ": nothing written");
          assert.deepEqual(o.auth, [], label + ": no Auth creation / e-mail change");
          assert.deepEqual([o.emails, h.db.updates.length, h.db.writes.length], [0, 0, 0], label + ": no e-mail, no write");
          assert.ok(o.refs.every((p) => !/biz_access\/[^/]+\/[^/]+$/.test(p)), label + ": no grant reference");
        }
        rows++;
      }
    }
    // registry read failure and timeout → unavailable, before any side effect
    for (const opts of [{}, { delayMs: 25 }]) {
      const before = regSeed(R["sole-plain"]); h.reset(before);
      const restore = failRead(h, REG, opts);
      try {
        const o = observe(h, await h.call(action, body(["bizB"]), "own"));
        assert.deepEqual([o.status, o.body], [503, { error: "business_registry_unavailable" }], `${action} registry ${opts.delayMs ? "timeout" : "read failure"}`);
        assert.deepEqual([o.state, o.auth, o.emails], [before, [], 0], action + ": nothing changed");
      } finally { restore(); }
      rows++;
    }
    // another tenant's business is not registered in this tenant (the read is tenant-scoped)
    h.reset(seed());
    const o = observe(h, await h.call(action, body(["foreignBiz"]), "own"));
    assert.deepEqual([o.status, o.body, o.auth], [403, { error: "business_not_in_tenant" }, []], action + ": foreignBiz");
    assert.ok(o.refs.every((p) => !p.startsWith("tenants/tenantB")), action + ": no cross-tenant reference");
  }
  assert.ok(rows > 100, "non-vacuous: " + rows);
});

// ── RB-02 ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
test("RB-02 authorization order is kept (no registry read for an unauthorized actor); repeated requests are identical", async () => {
  const h = await head();
  for (const [action, body] of WRITERS) for (const actor of ["mgr", "view", "foreign", null]) {
    h.reset(regSeed(R["twin-plain-first"]));
    const o = observe(h, await h.call(action, body([" bizB "]), actor));
    assert.ok([401, 403].includes(o.status), `${action} as ${actor}: ${o.status} ${show(o.body)}`);
    assert.ok(!o.refs.includes(REG), `${action} as ${actor}: refused before the registry read`);
    assert.deepEqual([o.auth, h.db.updates.length], [[], 0]);
  }
  for (const [action, body] of WRITERS) {
    for (const [raw, want] of [[R["sole-padded"], 200], [R["twin-padded-first"], 503]]) {
      h.reset(regSeed(raw));
      const a = observe(h, await h.call(action, body([" bizB "]), "own"));
      const b = observe(h, await h.call(action, action === "create-user" ? { ...body([" bizB "]), email: "m@example.test", username: "mm" } : body([" bizB "]), "own"));
      assert.equal(a.status, want, action); assert.equal(b.status, action === "create-user" && want === 200 ? 200 : want, action + " (repeat)");
      if (want === 200 && action !== "create-user") assert.deepEqual(b.state.tenants.tenantA.biz_access, a.state.tenants.tenantA.biz_access, action + ": the repeat changes no grant");
    }
  }
});

// ── RB-03 ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const UU = { tenantId: "tenantA", firebaseUid: "sub1", email: "changed@example.test", allowedBizIds: ["bizB"] };
const OLD = "sub1@example.test", NEW = "changed@example.test";
function aligned(h, model, label) {
  const s = storedEmails(h, "sub1");
  assert.equal(model.state.sub1, s.users, label + ": Auth e-mail = users/{uid}.email");
  assert.equal(s.users, s.appUsers, label + ": users/{uid} = app/users");
}
test("RB-03 update-user: every read and refusal precedes the Auth e-mail change; Auth and RTDB stay aligned on every failure but the documented final-write case, which a retry re-converges", async () => {
  const h = await head();
  const readFaults = [
    ["biz_access tree read failure", "tenants/tenantA/biz_access", {}, [500, "שגיאה בעדכון הרשאות עסק"]],
    ["biz_access tree read timeout", "tenants/tenantA/biz_access", { delayMs: 25 }, [500, "שגיאה בעדכון הרשאות עסק"]],
    ["registry read failure", REG, {}, [503, "business_registry_unavailable"]],
    ["registry read timeout", REG, { delayMs: 25 }, [503, "business_registry_unavailable"]],
    ["app/users merge read failure", "tenants/tenantA/app/users", {}, [500, "שגיאה בעיבוד רשימת המשתמשים — פנה לתמיכה"]],
  ];
  for (const [label, path, opts, [status, error]] of readFaults) {
    const before = seed(); h.reset(before);
    const model = authModel(h, { sub1: OLD });
    try {
      const restore = failRead(h, path, opts);
      let o; try { o = observe(h, await h.call("update-user", UU, "own")); } finally { restore(); }
      assert.deepEqual([o.status, o.body], [status, { error }], label);
      assert.deepEqual(o.auth, [], label + ": the Auth e-mail was never changed");
      assert.deepEqual(o.state, before, label + ": nothing written"); aligned(h, model, label);
      // retry once the read works: one Auth change, everything aligned, the grant moved for the target only
      const r = observe(h, await h.call("update-user", UU, "own"));
      assert.equal(r.status, 200, label + " retry: " + show(r.body));
      assert.deepEqual(r.auth, [["updateUser", "sub1", { email: NEW }]], label + " retry: exactly one Auth change");
      assert.equal(model.state.sub1, NEW); aligned(h, model, label + " retry");
      assert.deepEqual([ba(h, "bizA", "sub1"), ba(h, "bizB", "sub1"), ba(h, "bizB", "sub2"), ba(h, "bizA", "mgr")], [null, true, true, true], label + " retry: target-only revocation");
    } finally { model.restore(); }
  }
  // a refusal of the scope (registry) with an e-mail change: nothing changes anywhere
  for (const raw of [R["twin-plain-first"], R.absent, R.malformed]) {
    const before = regSeed(raw); h.reset(before); const model = authModel(h, { sub1: OLD });
    try {
      const o = observe(h, await h.call("update-user", { ...UU, allowedBizIds: [" bizB "] }, "own"));
      assert.equal(o.status, 503); assert.deepEqual([o.auth, o.state], [[], before]); aligned(h, model, "scope refused");
    } finally { model.restore(); }
  }
  // malformed biz_access tree entries are not grants: the update proceeds and stays aligned
  { const s = seed(); s.tenants.tenantA.biz_access.bizA = "yes"; h.reset(s); const model = authModel(h, { sub1: OLD });
    try { const o = observe(h, await h.call("update-user", UU, "own")); assert.equal(o.status, 200, show(o.body)); aligned(h, model, "malformed tree"); assert.equal(ba(h, "bizB", "sub1"), true); }
    finally { model.restore(); } }
  // the Auth call itself fails: nothing written, Auth unchanged
  { const before = seed(); h.reset(before); const model = authModel(h, { sub1: OLD }, (u, o) => (o.email === NEW ? "reject" : null));
    try { const o = observe(h, await h.call("update-user", UU, "own")); assert.deepEqual([o.status, o.body], [500, { error: "שגיאה בעדכון Firebase Auth" }]); assert.deepEqual(o.state, before); aligned(h, model, "Auth rejects"); }
    finally { model.restore(); } }
  // the final atomic write fails; the best-effort revert succeeds → aligned
  { const before = seed(); h.reset(before); const model = authModel(h, { sub1: OLD });
    try {
      const restore = failWrite(h); let o; try { o = observe(h, await h.call("update-user", UU, "own")); } finally { restore(); }
      assert.deepEqual([o.status, o.body], [500, { error: "שגיאה בשמירת המשתמש — פנה לתמיכה" }]);
      assert.deepEqual(o.auth, [["updateUser", "sub1", { email: NEW }], ["updateUser", "sub1", { email: OLD }]], "changed, then reverted");
      assert.deepEqual(o.state, before); aligned(h, model, "write fails, revert succeeds");
    } finally { model.restore(); } }
  // DOCUMENTED RESIDUAL (not atomic): the final write fails AND the revert fails → Auth new, RTDB old; an identical retry re-converges
  { const before = seed(); h.reset(before); const model = authModel(h, { sub1: OLD }, (u, o) => (o.email === OLD ? "reject" : null));
    try {
      const restore = failWrite(h); let o; try { o = observe(h, await h.call("update-user", UU, "own")); } finally { restore(); }
      assert.equal(o.status, 500); assert.deepEqual(o.state, before, "RTDB unchanged");
      assert.deepEqual([model.state.sub1, storedEmails(h, "sub1").users], [NEW, OLD], "the documented divergence: Auth new, RTDB old");
      const r = observe(h, await h.call("update-user", UU, "own"));
      assert.equal(r.status, 200, show(r.body)); aligned(h, model, "retry after a failed revert re-converges");
    } finally { model.restore(); } }
  // DOCUMENTED RESIDUAL: the Auth call applies but answers a timeout → 500, RTDB unchanged, Auth may be new; a retry re-converges
  { const before = seed(); h.reset(before); let n = 0; const model = authModel(h, { sub1: OLD }, (u, o) => (o.email === NEW && n++ === 0 ? "applied-then-timeout" : null));
    try {
      const o = observe(h, await h.call("update-user", UU, "own"));
      assert.equal(o.status, 500); assert.deepEqual(o.state, before);
      const r = observe(h, await h.call("update-user", UU, "own")); assert.equal(r.status, 200); aligned(h, model, "retry after an ambiguous Auth timeout");
    } finally { model.restore(); } }
  // self-heal: the role-path read stays non-fatal (now before Phase 4) and the update stays aligned
  { const s = seed(); delete s.tenants.tenantA.users.sub1; delete s.tenants.tenantA.roles.sub1; h.reset(s); const model = authModel(h, { sub1: OLD });
    try {
      const restore = failRead(h, "tenants/tenantA/roles/sub1"); let o; try { o = observe(h, await h.call("update-user", UU, "own")); } finally { restore(); }
      assert.equal(o.status, 200, show(o.body)); assert.equal(o.body.selfHealed, true); aligned(h, model, "self-heal with a failed role-path read");
    } finally { model.restore(); } }
});

// ── RB-04 / RB-05 ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
test("RB-04 create-user: the registry and app/users reads precede the Auth user; the final-write rollback is unchanged", async () => {
  const h = await head();
  for (const [path, status, error] of [["tenants/tenantA/app/users", 500, "רשימת המשתמשים פגומה — פנה לתמיכה"], [REG, 503, "business_registry_unavailable"]]) {
    const before = seed(); h.reset(before); const restore = failRead(h, path);
    try { const o = observe(h, await h.call("create-user", WRITERS[0][1](["bizA"]), "own")); assert.deepEqual([o.status, o.body, o.auth, o.state], [status, { error }, [], before], path); }
    finally { restore(); }
  }
  { const s = seed(); s.tenants.tenantA.app.users = { _v: "{bad" }; h.reset(s); const o = observe(h, await h.call("create-user", WRITERS[0][1](["bizA"]), "own")); assert.deepEqual([o.status, o.auth], [500, []], "malformed app/users: no Auth user"); }
  { const before = seed(); h.reset(before); const restore = failWrite(h);
    try { const o = observe(h, await h.call("create-user", WRITERS[0][1](["bizA"]), "own")); assert.equal(o.status, 500); assert.deepEqual(o.auth.map((c) => c[0]), ["createUser", "deleteUser"], "rollback as before"); assert.deepEqual(o.state, before); }
    finally { restore(); } }
});
test("RB-05 roles: a registry refusal or failure happens before the owner guard and before any write", async () => {
  const h = await head();
  for (const [raw, status] of [[R["sole-plain"], 403], [R["twin-plain-first"], 503], [R.absent, 503]]) {
    const before = regSeed(raw); h.reset(before);
    const o = observe(h, await h.call("roles", { tenantId: "tenantA", targetUid: "super", role: "manager", allowedBizIds: [raw === R["sole-plain"] ? "bizZ" : " bizB "] }, "own"));
    assert.equal(o.status, status, show(o.body)); assert.deepEqual([o.state, h.db.writes, h.db.updates], [before, [], []], "no guard transaction, no write");
    assert.ok(!o.refs.some((p) => String(p).includes("access_meta")), "the owner guard was not reached");
  }
  const before = regSeed(R["sole-plain"]); h.reset(before); const restore = failRead(h, REG);
  try { const o = observe(h, await h.call("roles", { tenantId: "tenantA", targetUid: "sub1", role: "viewer", allowedBizIds: ["bizB"] }, "own")); assert.deepEqual([o.status, o.state, h.db.updates], [503, before, []]); }
  finally { restore(); }
});

// ── RB-06 / RB-07 the shared gate ─────────────────────────────────────────────────────────────────────────────────────────────
const gateRun = async (fn, { tenantId, bizId, role = "owner", uid = "u1", authFails = false, db }) => {
  const calls = [];
  const deps = {
    requireAuth: async () => { calls.push(["auth"]); if (authFails) throw new Error("no token"); return { uid, email: null }; },
    requireTenantAccess: async (u, t) => { calls.push(["tenant", t]); return role; },
    getDb: async () => { calls.push(["db"]); return db; },
  };
  try { const ctx = await fn({ headers: {} }, { tenantId, bizId, mode: "read" }, deps); return { ok: true, ctx, calls }; }
  catch (e) { return { ok: false, e, calls }; }
};
test("RB-06 requireBizContext: the business slot is the approved business predicate; tenant slot unchanged; authentication first; no registry read", async () => {
  const h = await head();
  const refusedBiz = ["biz:A", ":", "bizA:", " biz:A ", "", "x".repeat(129), "biz.A", "biz/A", "biz#A", "biz$A", "biz[A]", "biz\u0001", "biz\u007f", "\nbiz", ["bizA"], 12, null, undefined, { toString: () => "bizA" }, true];
  for (const fn of [requireBizContext, requireRegisteredBizContext]) {
    for (const bizId of refusedBiz) for (const tenantId of ["tenantA", "t:1"]) for (const role of ["owner", "viewer"]) {
      h.reset(); const r = await gateRun(fn, { tenantId, bizId, role, db: h.db });
      assert.deepEqual([r.ok, r.e?.status, r.e?.msg], [false, 400, "invalid bizId"], `${fn.name} ${show(bizId)} in ${tenantId} as ${role}`);
      assert.deepEqual(r.calls, [["auth"]], "nothing after authentication: no tenant access, no handle");
      assert.deepEqual(h.db.refs, [], "no reference");
    }
    h.reset(); const unauth = await gateRun(fn, { tenantId: "t:1", bizId: "biz:A", authFails: true, db: h.db });
    assert.deepEqual([unauth.e.status, unauth.e.msg], [401, "unauthorized"], fn.name + ": authentication precedes id validation");
    for (const tenantId of ["t1:x", "x".repeat(129), "tenant\u0001"]) { h.reset(); const r = await gateRun(fn, { tenantId, bizId: "bizA", db: h.db }); if (tenantId === "t1:x") continue; assert.deepEqual([r.e.status, r.e.msg], [400, "invalid tenantId"]); }
  }
  // valid ids proceed with their exact bytes; the scoped grant is read at the exact key; the PLAIN gate reads no registry
  const s = seed(); s.tenants["t:1"].biz_access = { " bizA ": { u1: true }, bizA: { u1: true } }; s.tenants.tenantA.biz_access[" bizA "] = { u1: true };
  s.tenants.tenantA.biz_access["biz\u0080"] = { u1: true }; s.tenants.tenantA.biz_access["סניף א"] = { u1: true }; s.tenants["tenant\u00a0A"] = { biz_access: { "biz\u00a0A": { u1: true } } };
  for (const [tenantId, bizId] of [["t:1", "bizA"], ["t:1", " bizA "], ["tenantA", " bizA "], ["tenantA", "biz\u0080"], ["tenantA", "סניף א"], ["tenant\u00a0A", "biz\u00a0A"]]) for (const role of ["owner", "viewer"]) {
    h.reset(s); const r = await gateRun(requireBizContext, { tenantId, bizId, role, db: h.db });
    assert.equal(r.ok, true, show([tenantId, bizId, role, r.e])); assert.deepEqual([r.ctx.tenantId, r.ctx.bizId], [tenantId, bizId]);
    assert.deepEqual(h.db.refs, role === "owner" ? [] : [`tenants/${tenantId}/biz_access/${bizId}/u1`], "the exact grant key only; no registry read by the plain gate");
  }
});
test("RB-07 requireRegisteredBizContext: one registry read after the full gate; only `registered` passes; stale grants are refused", async () => {
  const h = await head();
  let rows = 0;
  for (const [name, raw] of Object.entries(R)) for (const bizId of [" bizB ", "bizB", "bizA"]) for (const role of ["owner", "viewer"]) {
    const s = regSeed(raw); s.tenants.tenantA.biz_access = { bizA: { u1: true }, bizB: { u1: true }, " bizB ": { u1: true } };   // the viewer holds every grant (stale ones included)
    h.reset(s);
    const r = await gateRun(requireRegisteredBizContext, { tenantId: "tenantA", bizId, role, db: h.db });
    const state = classifyRegistryTarget(raw, bizId).state;
    if (state === "registered") assert.deepEqual([r.ok, r.ctx?.bizId], [true, bizId], `${name} ${show(bizId)} ${role}`);
    else assert.deepEqual([r.ok, r.e.status, r.e.msg], [false, ...MAP[state]], `${name} ${show(bizId)} ${role}`);
    assert.deepEqual(h.db.refs.filter((p) => p === REG).length, 1, "exactly one registry read");
    assert.equal(h.db.refs.at(-1), REG, "the registry read is the last step (after tenant access and business access)");
    rows++;
  }
  // a read failure / timeout → unavailable
  for (const opts of [{}, { delayMs: 20 }]) { h.reset(); const restore = failRead(h, REG, opts); try { const r = await gateRun(requireRegisteredBizContext, { tenantId: "tenantA", bizId: "bizA", db: h.db }); assert.deepEqual([r.e.status, r.e.msg], [503, "business_registry_unavailable"]); } finally { restore(); } }
  // the gate refused first: no registry read
  h.reset(); const denied = await gateRun(requireRegisteredBizContext, { tenantId: "tenantA", bizId: "bizB", role: "viewer", uid: "nobody", db: h.db });
  assert.deepEqual([denied.e.status, denied.e.msg, h.db.refs], [403, "business_access_denied", ["tenants/tenantA/biz_access/bizB/nobody"]]);
  h.reset(); const badRole = await gateRun(requireRegisteredBizContext, { tenantId: "tenantA", bizId: "bizA", role: "staff", db: h.db });
  assert.deepEqual([badRole.e.status, h.db.refs], [403, []]);
  assert.ok(rows >= 60);
});

// ── RB-08 real cores ──────────────────────────────────────────────────────────────────────────────────────────────────────────
test("RB-08 the real Alerts / Agent Ask / Proactive cores with the real registered gate: refused requests reach no repository", async () => {
  const h = await head();
  const gate = (role, uid = "u1") => (req, opts) => requireRegisteredBizContext(req, opts, { requireAuth: async () => ({ uid, email: null }), requireTenantAccess: async () => role, getDb: async () => h.db });
  const cases = [
    // [label, registry, bizId, role, want status]
    ["registered", R["sole-plain"], "bizB", "manager", 200],
    ["registered padded", R["sole-padded"], " bizB ", "manager", 200],
    ["stale grant, business not registered", R["sole-plain"], "bizZ", "manager", 403],
    ["stale grant, plain id while only the padded business is registered", R["sole-padded"], "bizB", "manager", 503],
    ["twin (ambiguous)", R["twin-plain-first"], "bizB", "manager", 503],
    ["coerced twin (ambiguous)", R["coerced-twin"], "bizB", "owner", 503],
    ["owner, not registered", R["sole-plain"], "bizZ", "owner", 403],
    ["registry unreadable", R.malformed, "bizB", "owner", 503],
    ["business colon", R["sole-plain"], "biz:B", "owner", 400],
  ];
  for (const [label, raw, bizId, role, want] of cases) {
    const s = regSeed(raw); s.tenants.tenantA.biz_access = { bizB: { u1: true }, " bizB ": { u1: true }, bizZ: { u1: true } };
    const reached = [];
    h.reset(s);
    const ask = await handleAgentAsk({ method: "POST", headers: {}, query: {}, body: { question: "מה המחזור?", tenantId: "tenantA", bizId } },
      { requireBizContext: gate(role), routeQuestion: async () => { reached.push("agent"); return { text: "ok", confidence: { level: "high" }, intent: "x", usedSources: [] }; }, rateLimit: () => true });
    h.reset(s);
    const read = await handleAlerts({ method: "GET", headers: {}, query: { tenantId: "tenantA", bizId }, body: {} },
      { requireBizContext: gate(role), repos: { getActiveAlerts: async () => { reached.push("alerts-read"); return []; }, getThresholds: async () => ({}) } });
    h.reset(s);
    const write = await handleAlerts({ method: "POST", headers: {}, query: {}, body: { action: "config", tenantId: "tenantA", bizId, thresholds: { x: 1 } } },
      { requireBizContext: gate(role), repos: { saveThresholds: async () => { reached.push("alerts-save"); }, getThresholds: async () => ({ x: 1 }) } });
    h.reset(s);
    const pro = await handleProactiveRead({ method: "GET", headers: {}, query: { action: "insights", tenantId: "tenantA", bizId }, body: {} },
      { requireBizContext: gate(role), repos: { getInsights: async () => { reached.push("proactive"); return []; } } });
    const statuses = [ask.status, read.status, write.status, pro.status];
    if (want === 200) { assert.deepEqual(statuses, [200, 200, 200, 200], label); assert.deepEqual(reached.sort(), ["agent", "alerts-read", "alerts-save", "proactive"], label); }
    else { assert.deepEqual(statuses, [want, want, want, want], label + ": " + show([ask.json, read.json, write.json, pro.json])); assert.deepEqual(reached, [], label + ": no repository / router reached"); }
  }
});

// ── RB-09 the real compiled routes + Core cost history ────────────────────────────────────────────────────────────────────────
const TSC = join(ROOT, "node_modules", "typescript", "bin", "tsc");
function compileRoute(routeRel, stubs) {
  const dir = mkdtempSync(join(tmpdir(), "i6-route-"));
  cpSync(join(ROOT, "lib"), join(dir, "lib"), { recursive: true });
  symlinkSync(join(ROOT, "node_modules"), join(dir, "node_modules"), "dir");
  const all = {
    "lib/verifyToken.js": "export async function requireAuth(req){ return globalThis.__R.requireAuth(req); } export async function verifyToken(){ return null; }",
    "lib/helpers.js": "export async function requireTenantAccess(u,t,r){ return globalThis.__R.requireTenantAccess(u,t,r); } export async function isRateLimited(){ return false; }",
    "lib/adminSdk.js": "export function getAdminDb(){ return globalThis.__R.db; } export function getAdminAuth(){ return {}; }",
    ...stubs,
  };
  for (const [rel, content] of Object.entries(all)) { mkdirSync(dirname(join(dir, rel)), { recursive: true }); writeFileSync(join(dir, rel), content); }
  mkdirSync(dirname(join(dir, routeRel)), { recursive: true }); cpSync(join(ROOT, routeRel), join(dir, routeRel));
  spawnSync("node", [TSC, "--module", "esnext", "--target", "es2020", "--moduleResolution", "bundler", "--skipLibCheck", "--noEmitOnError", "false", join(dir, routeRel)], { encoding: "utf8" });
  const out = join(dir, routeRel.replace(/\.ts$/, ".js")); assert.ok(existsSync(out), "compiled " + routeRel);
  return out;
}
const reach = (n) => `globalThis.__R.reached.push(${JSON.stringify(n)})`;
const ROUTES = {
  alerts: compileRoute("api/alerts/run.ts", {
    "src/alerts/runner.js": `export async function runAlertsForBiz(){ ${reach("runAlertsForBiz")}; return {}; } export async function runAlertsForAll(){ ${reach("runAlertsForAll")}; return []; }`,
    "src/alerts/alertsRepo.js": `export async function getActiveAlerts(){ ${reach("getActiveAlerts")}; return []; } export async function dismissAlert(){ ${reach("dismissAlert")}; }`,
    "src/alerts/configRepo.js": `export async function getThresholds(){ ${reach("getThresholds")}; return {}; } export async function saveThresholds(){ ${reach("saveThresholds")}; }`,
  }),
  ask: compileRoute("api/agent/ask.ts", {
    "src/agent/orchestrator/routeQuestion.js": `export async function routeQuestion(){ ${reach("routeQuestion")}; return { text: "ok", confidence: { level: "high" }, intent: "x", usedSources: [] }; }`,
  }),
  proactive: compileRoute("api/proactive/run.ts", {
    "src/firebase/admin.js": "export function getDb(){ return globalThis.__R.db; }",
    "src/firebase/refs.js": `export function tenantRef(){ return { child(){ return { once: async () => ({ exists: () => true }) }; } }; }`,
    "src/agent/proactive/runProactiveJob.js": `export async function runProactiveJob(){ ${reach("runProactiveJob")}; return {}; } export async function runForBiz(){ ${reach("runForBiz")}; return {}; }`,
    "src/agent/proactive/getTopActiveInsights.js": `export async function getTopActiveInsights(){ ${reach("getTopActiveInsights")}; return []; }`,
    "src/agent/proactive/digestBuilder.js": `export async function buildWeeklySummary(){ ${reach("buildWeeklySummary")}; return {}; }`,
  }),
};
const loaded = {};
const route = async (k) => (loaded[k] ??= (await import(pathToFileURL(ROUTES[k]).href)).default);
const mkRes = () => { const x = { statusCode: 0, body: null, setHeader() {}, status(c) { x.statusCode = c; return x; }, json(b) { x.body = b; return x; }, end() { return x; } }; return x; };
test("RB-09 the real compiled routes and Core cost history: registered → served; ambiguous / unregistered / business \":\" → refused before any data seam", async () => {
  const h = await head();
  const reqs = (bizId) => ({
    alertsRead: ["alerts", { method: "GET", headers: { origin: "" }, query: { tenantId: "tenantA", bizId }, body: {} }, ["getActiveAlerts", "getThresholds"]],
    alertsWrite: ["alerts", { method: "POST", headers: { origin: "" }, query: {}, body: { action: "config", tenantId: "tenantA", bizId, thresholds: { x: 1 } } }, ["saveThresholds", "getThresholds"]],
    ask: ["ask", { method: "POST", headers: { origin: "" }, query: {}, body: { question: "מה המחזור?", tenantId: "tenantA", bizId } }, ["routeQuestion"]],
    proactiveRead: ["proactive", { method: "GET", headers: { origin: "" }, query: { action: "insights", tenantId: "tenantA", bizId }, body: {} }, ["getTopActiveInsights"]],
    proactiveScan: ["proactive", { method: "POST", headers: { origin: "" }, query: {}, body: { tenantId: "tenantA", bizId } }, ["runForBiz"]],
  });
  for (const [label, raw, bizId, role, want] of [
    ["registered", R["sole-plain"], "bizB", "owner", 200], ["registered padded", R["sole-padded"], " bizB ", "owner", 200],
    ["ambiguous twin", R["twin-padded-first"], " bizB ", "owner", 503], ["not registered", R["sole-plain"], "bizZ", "owner", 403],
    ["stale grant (manager)", R["sole-plain"], "bizZ", "manager", 403], ["business colon", R["sole-plain"], "biz:B", "owner", 400]]) {
    for (const [name, [k, req, seams]] of Object.entries(reqs(bizId))) {
      const s = regSeed(raw); s.tenants.tenantA.biz_access = { bizB: { u1: true }, bizZ: { u1: true } }; h.reset(s);
      globalThis.__R = { reached: [], db: h.db, requireAuth: async () => ({ uid: "u1", email: null }), requireTenantAccess: async () => role };
      const res = mkRes(); await (await route(k))(clone(req), res);
      const expect = name === "proactiveScan" && role === "manager" ? 403 : want;   // the manual scan also requires owner (unchanged)
      assert.equal(res.statusCode, expect, `${label} ${name}: ${show(res.body)}`);
      if (expect === 200) assert.ok(seams.every((x) => globalThis.__R.reached.includes(x)), `${label} ${name}: served`);
      else assert.deepEqual(globalThis.__R.reached, [], `${label} ${name}: no data seam reached`);
      if (want === 400) assert.deepEqual(h.db.refs, [], `${label} ${name}: no reference`);
    }
  }
  delete globalThis.__R;
  // Core cost history keeps the plain gate + its own registry predicate: exactly ONE registry read per authorization, its own answers
  const writer = createCostHistoryWriter({ db: h.db, authDeps: { requireAuth: async () => ({ uid: "own", email: null }), requireTenantAccess: async () => "owner" } });
  for (const [raw, bizId, status] of [[R["sole-plain"], "bizB", "absent"], [R["twin-plain-first"], "bizB", "authorization_unavailable"], [R["sole-plain"], "bizZ", "business_not_in_tenant"]]) {
    h.reset(regSeed(raw)); const r = await writer.readCostHistory({ headers: {} }, { tenantId: "tenantA", bizId });
    assert.equal(r.status, status, show([bizId, r])); assert.equal(h.db.refs.filter((p) => p === REG).length, 1, "one registry read (no duplicate)");
  }
  h.reset(); const colon = await writer.readCostHistory({ headers: {} }, { tenantId: "tenantA", bizId: "biz:B" });
  assert.deepEqual([colon.status, h.db.refs], ["request_scope_invalid", []], "Cost History: business \":\" refused by the shared gate, zero references (same status as before)");
});

// ── RB-10 parity with the I5 commit ───────────────────────────────────────────────────────────────────────────────────────────
const ISO = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?Z$/;
const scrub = (v) => (Array.isArray(v) ? v.map(scrub) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, scrub(x)])) : typeof v === "string" && ISO.test(v) ? "<iso>" : v);
async function frozen(fn) {
  const now = Date.now, rnd = Math.random, uuid = crypto.randomUUID;
  Date.now = () => 1760000000000; Math.random = () => 0.4242; crypto.randomUUID = () => "00000000-0000-4000-8000-000000000042"; syncBuiltinESMExports();
  try { return await fn(); } finally { Date.now = now; Math.random = rnd; crypto.randomUUID = uuid; syncBuiltinESMExports(); }
}
/** Everything identical except the references: I6 may add the ONE registry read of the requesting tenant per grant decision and
 *  read earlier (before the Auth mutation); as multisets the references must otherwise be identical. */
async function parity(action, body, actor, method = "POST", { st = seed(), registryRead = false } = {}) {
  const one = async (h) => { h.reset(clone(st)); const res = await frozen(() => h.call(action, clone(body), actor, method)); return scrub(observe(h, res)); };
  const [a, b] = [await one(await head()), await one(await i5())];
  const sorted = (x) => [...x].sort();
  const aRefs = [...a.refs];
  if (registryRead) { const t = body && typeof body === "object" ? body.tenantId : null; const k = aRefs.indexOf(`tenants/${t}/app/business`); if (k >= 0 && aRefs.filter((p) => p === `tenants/${t}/app/business`).length === b.refs.filter((p) => p === `tenants/${t}/app/business`).length + 1) aRefs.splice(k, 1); }
  assert.deepEqual(sorted(aRefs), sorted(b.refs), `${action} ${show(body)} as ${actor}: same references (as a multiset)`);
  delete a.refs; delete b.refs;
  assert.deepEqual(a, b, `${action} ${show(body)} as ${actor}: identical to I5`);
}
// the EX-06 corpora (test/finance/i5-exact-identity.test.mjs), now against the I5 commit: valid string tenants (incl. ":", padded, unicode,
// U+0080 / U+00A0) and absent / empty ones; for the handlers whose tenant validation no layer since I4 touched, every value
const SAME_TENANTS = ["tenantA", "t:1", "tenantB", "missing", "tenantA ", " tenantA", "סניף", "tenant\u0080A", "tenant\u00a0A", "", null, undefined];
const ALL_TENANTS = [...SAME_TENANTS, "tenant.A", "x".repeat(129), 12, ["tenantA"], { a: 1 }];
const SAME_BIZ = ["bizA", "bizB", " bizA", "bizA ", "ביז", "biz\u0080", "biz.A", "x".repeat(129), "foreignBiz"];
// scope lists whose every non-empty string is REGISTERED in tenantA (bizA, bizB) or refused by the predicate / type checks: same outcome
const SAME_ALLOWED = [["bizA"], ["bizA", "bizA"], [""], ["bizB"], ["bizA", "bizB"], [5], "bizA", null, [], ["biz.A"], ["x".repeat(129)]];
// valid ids NOT registered in tenantA — the corrected class (I5-R-01): I5 granted them, I6 refuses with nothing written
const UNREGISTERED_ALLOWED = [["ביז"], ["biz\u0080"], ["bizA", "foreignBiz"], ["bizC"]];
const FROM = "2026-10-01", TO = "2026-10-02";
test("RB-10 parity with I5 outside the corrected classes (the EX-06 corpora: every handler, tenant, business id, scope list and actor)", async () => {
  for (const t of SAME_TENANTS) {
    await parity("edit-client", { tenantId: t, bizName: "N", ownerName: "M" }, "super");
    await parity("delete-client", { tenantId: t }, "super");
    await parity("resend-invite", { tenantId: t }, "super");
  }
  for (const t of ALL_TENANTS) {
    await parity("delete-user", { tenantId: t, firebaseUid: "sub1", username: "sub1" }, "own");
    await parity("update-user", { tenantId: t, firebaseUid: "sub1", name: "Renamed" }, "own");
    await parity("bootstrap-self", { tenantId: t }, "newbie");
    await parity("roles", { tenantId: t, targetUid: "sub1", role: "manager", allowedBizIds: ["bizA"] }, "own", "POST", { registryRead: true });
    await parity("create-user", { tenantId: t, email: "n@example.test", username: "nn", role: "viewer", allowedBizIds: ["bizA"] }, "own", "POST", { registryRead: true });
    await parity("list-entry-exceptions", { tenantId: t, bizId: "bizA", fromDate: FROM, toDate: TO }, "own", "GET");
    await parity("get-analytics-daily", { tenantId: t, bizId: "bizA", fromDate: FROM, toDate: TO }, "own", "GET");
    await parity("list-supplier-credits", { tenantId: t, bizId: "bizA" }, "own", "GET");
  }
  for (const b of SAME_BIZ) {
    await parity("list-entry-exceptions", { tenantId: "tenantA", bizId: b, fromDate: FROM, toDate: TO }, "mgr", "GET");
    await parity("get-analytics-daily", { tenantId: "tenantA", bizId: b, fromDate: FROM, toDate: TO }, "view", "GET");
    await parity("list-supplier-credits", { tenantId: "tenantA", bizId: b }, "mgr", "GET");
    await parity("set-checklist-run", { tenantId: "tenantA", bizId: b }, "mgr");
  }
  for (const allowedBizIds of SAME_ALLOWED) {
    await parity("create-user", { tenantId: "tenantA", email: "n@example.test", username: "nn", role: "viewer", allowedBizIds }, "own", "POST", { registryRead: true });
    await parity("roles", { tenantId: "tenantA", targetUid: "sub1", role: "viewer", allowedBizIds }, "own", "POST", { registryRead: true });
    if (!(Array.isArray(allowedBizIds) && allowedBizIds.some((v) => typeof v === "string" && /[.]|^x{129}$/.test(v))))
      await parity("update-user", { tenantId: "tenantA", firebaseUid: "sub1", email: "x@example.test", allowedBizIds }, "own", "POST", { registryRead: true });
  }
  for (const actor of ["super", "own", "mgr", "view", "foreign", null]) {
    await parity("edit-client", { tenantId: "tenantA", bizName: "N" }, actor);
    await parity("delete-client", { tenantId: "tenantA" }, actor);
    await parity("resend-invite", { tenantId: "tenantA" }, actor);
    await parity("roles", { tenantId: "tenantA", targetUid: "sub1", role: "manager", allowedBizIds: ["bizB"] }, actor, "POST", { registryRead: true });
    await parity("create-user", { tenantId: "tenantA", email: "n@example.test", username: "nn", role: "viewer", allowedBizIds: ["bizA"] }, actor, "POST", { registryRead: true });
    await parity("update-user", { tenantId: "tenantA", firebaseUid: "sub1", email: "new@example.test" }, actor);
    await parity("delete-user", { tenantId: "tenantA", firebaseUid: "sub1" }, actor);
    await parity("list-entry-exceptions", { tenantId: "tenantA", bizId: "bizA", fromDate: FROM, toDate: TO }, actor, "GET");
    await parity("list-supplier-credits", { tenantId: "tenantA", bizId: "foreignBiz" }, actor, "GET");
  }
  await parity("roles", { tenantId: "tenantA", targetUid: "own", role: null }, "own");
  await parity("roles", { tenantId: "tenantA", targetUid: "super", role: "owner" }, "own");
  await parity("roles", "{not json", "own");
  // the corrected class, stated explicitly: a valid but UNREGISTERED id that I5 granted is refused by I6 with nothing written
  for (const allowedBizIds of UNREGISTERED_ALLOWED) for (const [action, body] of [
    ["create-user", { tenantId: "tenantA", email: "n@example.test", username: "nn", role: "viewer", allowedBizIds }],
    ["roles", { tenantId: "tenantA", targetUid: "sub1", role: "viewer", allowedBizIds }],
    ["update-user", { tenantId: "tenantA", firebaseUid: "sub1", email: "x@example.test", allowedBizIds }]]) {
    const h6 = await head(), h5 = await i5();
    h6.reset(seed()); const a = observe(h6, await h6.call(action, clone(body), "own"));
    h5.reset(seed()); const b = observe(h5, await h5.call(action, clone(body), "own"));
    assert.equal(b.status, 200, `I5 granted ${show(allowedBizIds)} (${action})`);
    assert.deepEqual([a.status, a.body, a.state, a.auth], [403, { error: "business_not_in_tenant" }, seed(), []], `I6 refuses ${show(allowedBizIds)} (${action})`);
  }
});
