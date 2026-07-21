// Behavioral tests for lib/securityContext.js (PR #2A). Executes the real
// requireBizContext / requireCron with INJECTED fakes — no firebase, no network.
// Run: node --test test/security/security-context.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  requireBizContext, requireCron, requireBizAccess, isValidId, READ_ROLES, WRITE_ROLES,
} from "../../lib/securityContext.js";

// ── fakes ──────────────────────────────────────────────────────────────────
function fakeDb(bizAccessTree = {}) {
  // bizAccessTree: { [`${tenantId}/${bizId}/${uid}`]: true }
  const calls = [];
  const db = {
    calls,
    ref(path) {
      calls.push(path);
      return {
        async get() {
          const m = path.match(/^tenants\/([^/]+)\/biz_access\/([^/]+)\/([^/]+)$/);
          const key = m ? `${m[1]}/${m[2]}/${m[3]}` : null;
          const val = key != null ? bizAccessTree[key] ?? null : null;
          return { val: () => val };
        },
      };
    },
  };
  return db;
}
function deps({ auth, role, db, spy }) {
  const s = spy || {};
  return {
    requireAuth: async () => { s.authCalled = (s.authCalled || 0) + 1; if (auth instanceof Error) throw auth; return auth; },
    requireTenantAccess: async () => { s.tenantCalled = (s.tenantCalled || 0) + 1; if (role instanceof Error) throw role; return role; },
    getDb: async () => { s.dbCalled = (s.dbCalled || 0) + 1; return db; },
  };
}
const REQ = { headers: {} };
const OPTS = { tenantId: "t1", bizId: "b1", mode: "read" };

// ── requireBizContext matrix ─────────────────────────────────────────────────

test("no token → 401; tenant/db never consulted", async () => {
  const spy = {};
  await assert.rejects(
    () => requireBizContext(REQ, OPTS, deps({ auth: new Error("missing token"), spy })),
    (e) => e.status === 401,
  );
  assert.equal(spy.tenantCalled, undefined, "requireTenantAccess not called");
  assert.equal(spy.dbCalled, undefined, "getDb not called");
});

test("invalid token → 401 (auth throws)", async () => {
  await assert.rejects(
    () => requireBizContext(REQ, OPTS, deps({ auth: new Error("bad sig") })),
    (e) => e.status === 401,
  );
});

test("outside tenant → 403; db never consulted", async () => {
  const spy = {};
  await assert.rejects(
    () => requireBizContext(REQ, OPTS, deps({ auth: { uid: "u1" }, role: { status: 403, msg: "not a tenant member" }, spy })),
    (e) => e.status === 403,
  );
  assert.equal(spy.dbCalled, undefined, "getDb not called after tenant denial");
});

test("unknown role → 403 role_not_allowed (explicit allow-list, not hierarchy)", async () => {
  const spy = {};
  await assert.rejects(
    () => requireBizContext(REQ, OPTS, deps({ auth: { uid: "u1" }, role: "wizard", db: fakeDb(), spy })),
    (e) => e.status === 403 && e.msg === "role_not_allowed",
  );
  assert.equal(spy.dbCalled, undefined, "biz_access not consulted for disallowed role");
});

test("missing biz_access → 403 business_access_denied", async () => {
  await assert.rejects(
    () => requireBizContext(REQ, OPTS, deps({ auth: { uid: "u1" }, role: "viewer", db: fakeDb({}) })),
    (e) => e.status === 403 && e.msg === "business_access_denied",
  );
});

test("scoped user WITH biz_access → resolves context", async () => {
  const ctx = await requireBizContext(REQ, { tenantId: "t1", bizId: "b1", mode: "read" },
    deps({ auth: { uid: "u1", email: "x@y.z" }, role: "manager", db: fakeDb({ "t1/b1/u1": true }) }));
  assert.equal(ctx.uid, "u1");
  assert.equal(ctx.role, "manager");
  assert.equal(ctx.tenantId, "t1");
  assert.equal(ctx.bizId, "b1");
});

test("owner ⇒ implicit all-business (biz_access node never read)", async () => {
  const db = fakeDb({}); // no grants at all
  const ctx = await requireBizContext(REQ, { tenantId: "t1", bizId: "b9", mode: "read" },
    deps({ auth: { uid: "o1" }, role: "owner", db }));
  assert.equal(ctx.role, "owner");
  assert.deepEqual(db.calls, [], "no biz_access ref read for owner");
});

test("super_owner ⇒ implicit all-business", async () => {
  const db = fakeDb({});
  const ctx = await requireBizContext(REQ, { tenantId: "t1", bizId: "b9", mode: "write" },
    deps({ auth: { uid: "s1" }, role: "super_owner", db }));
  assert.equal(ctx.role, "super_owner");
  assert.deepEqual(db.calls, []);
});

test("allowedBizIds does NOT grant access (only biz_access node is authoritative)", async () => {
  // user carries allowedBizIds elsewhere, but the biz_access grant node is empty.
  await assert.rejects(
    () => requireBizContext(REQ, { tenantId: "t1", bizId: "b1", mode: "read" },
      deps({ auth: { uid: "u1", allowedBizIds: ["b1"] }, role: "viewer", db: fakeDb({}) })),
    (e) => e.status === 403 && e.msg === "business_access_denied",
  );
});

test("write mode denies viewer and shift_manager (explicit WRITE_ROLES)", async () => {
  for (const role of ["viewer", "shift_manager"]) {
    await assert.rejects(
      () => requireBizContext(REQ, { tenantId: "t1", bizId: "b1", mode: "write" },
        deps({ auth: { uid: "u1" }, role, db: fakeDb({ "t1/b1/u1": true }) })),
      (e) => e.status === 403 && e.msg === "role_not_allowed",
      `${role} must be denied write`,
    );
  }
});

test("write mode allows manager/owner/super_owner", async () => {
  for (const role of ["manager", "owner", "super_owner"]) {
    const ctx = await requireBizContext(REQ, { tenantId: "t1", bizId: "b1", mode: "write" },
      deps({ auth: { uid: "u1" }, role, db: fakeDb({ "t1/b1/u1": true }) }));
    assert.equal(ctx.role, role);
  }
});

test("invalid ids and invalid mode fail closed (400)", async () => {
  await assert.rejects(() => requireBizContext(REQ, { tenantId: "a/b", bizId: "b1", mode: "read" },
    deps({ auth: { uid: "u1" }, role: "viewer", db: fakeDb() })), (e) => e.status === 400);
  await assert.rejects(() => requireBizContext(REQ, { tenantId: "t1", bizId: "b1", mode: "delete" },
    deps({ auth: { uid: "u1" }, role: "viewer", db: fakeDb() })), (e) => e.status === 400);
});

// ── requireCron matrix ───────────────────────────────────────────────────────

test("cron: x-vercel-cron alone → 401 (not accepted as authorization)", () => {
  assert.throws(() => requireCron({ headers: { "x-vercel-cron": "1" } }, { cronSecret: "s3cret" }),
    (e) => e.status === 401);
});

test("cron: missing/empty secret → 401 even with a bearer", () => {
  assert.throws(() => requireCron({ headers: { authorization: "Bearer s3cret" } }, { cronSecret: "" }),
    (e) => e.status === 401);
  assert.throws(() => requireCron({ headers: { authorization: "Bearer s3cret" } }, { cronSecret: undefined }),
    (e) => e.status === 401);
});

test("cron: wrong secret → 401", () => {
  assert.throws(() => requireCron({ headers: { authorization: "Bearer nope" } }, { cronSecret: "s3cret" }),
    (e) => e.status === 401);
});

test("cron: correct Bearer secret → true", () => {
  assert.equal(requireCron({ headers: { authorization: "Bearer s3cret" } }, { cronSecret: "s3cret" }), true);
});

test("cron: a Firebase user JWT cannot invoke cron → 401", () => {
  const firebaseJwt = "eyJhbGciOiJSUzI1Ni" + "." + "eyJzdWIiOiJ1c2VyIn0" + ".sig";
  assert.throws(() => requireCron({ headers: { authorization: `Bearer ${firebaseJwt}` } }, { cronSecret: "s3cret" }),
    (e) => e.status === 401);
});

// ── primitives ───────────────────────────────────────────────────────────────

test("role sets are exactly the policy sets", () => {
  assert.deepEqual([...READ_ROLES].sort(), ["manager", "owner", "shift_manager", "super_owner", "viewer"]);
  assert.deepEqual([...WRITE_ROLES].sort(), ["manager", "owner", "super_owner"]);
});

test("exported role policy is IMMUTABLE (frozen arrays, not mutable Sets)", () => {
  assert.ok(Array.isArray(READ_ROLES) && Array.isArray(WRITE_ROLES), "exported as arrays, not Sets");
  assert.ok(Object.isFrozen(READ_ROLES) && Object.isFrozen(WRITE_ROLES), "frozen");
  assert.throws(() => { READ_ROLES.push("intruder"); }, "cannot add");
  assert.throws(() => { WRITE_ROLES.length = 0; }, "cannot clear");
  assert.throws(() => { READ_ROLES[0] = "x"; }, "cannot reassign");
  assert.equal(READ_ROLES.length, 5);
  assert.equal(WRITE_ROLES.length, 3);
});

test("isValidId rejects path metachars / overlong / empty", () => {
  assert.equal(isValidId("t1"), true);
  for (const bad of ["", "a/b", "a.b", "a#b", "a$b", "a[b", "a]b", "x".repeat(129), 5, null, undefined]) {
    assert.equal(isValidId(bad), false, `${String(bad)} invalid`);
  }
});

test("requireBizAccess: 503 on lookup error (fail-closed)", async () => {
  const db = { ref: () => ({ get: async () => { throw new Error("db down"); } }) };
  await assert.rejects(() => requireBizAccess(db, "t1", "b1", "u1", "viewer"), (e) => e.status === 503);
});
