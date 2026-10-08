// M1 integration R4 (LOCAL; pending independent Codex review) — review finding S2: the self-service first-owner bootstrap
// (POST /api/admin?action=bootstrap-self) and the adjacent client creation (create-client). Through the REAL api/admin.js
// handler (only token verification, Admin construction and e-mail are seams), over an in-memory RTDB with transaction
// semantics (test/support/p1-r3-api-harness.mjs). Every case checks the PERMISSION and PERSISTENCE effects (roles, members,
// owner guard, user mapping, the registry itself), never only the response.
//   BS-01  the review's exact conditions: a tenant with NO roles but a business registry ([null] or valid) is not claimable —
//          409 tenant_has_data, and no role / membership / owner guard / user mapping is written; the registry is unchanged
//   BS-02  a role-less tenant holding ANY data (entries, users, config, meta, a lookup) is not claimable either
//   BS-03  legitimate onboarding: an ABSENT tenant is claimed — super_owner role, membership, owner guard and mapping, exactly
//   BS-04  concurrent claims of one absent tenant: exactly one caller wins; the other gets 409 and NO role (no mixed owners)
//   BS-05  an unknown claim outcome (committed, acknowledgement lost): 500; the SAME user's retry resumes its own claim (the
//          mapping is written, nothing else is granted); another user's retry is refused
//   BS-06  the mapping write fails after the claim: 500; the same user's retry resumes
//   BS-07  controls: an initialized tenant (other role holders, or this owner with a mapping) is 409 and unchanged (no resume)
//   BS-08  create-client never writes over an existing tenant whose id the generator produces (adjacent S1 class): the id is
//          reserved atomically; the existing tenant is byte-identical afterwards
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, cpSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { apiHarness, memoryDb, ROOT, env } from "../support/p1-r3-api-harness.mjs";

const T = "tenantN";
// The generic in-memory RTDB lacks two Admin SDK shapes the handler uses: the ROOT ref().update (multi-location, applied
// atomically here: every key or none) and snapshot.hasChildren(). Added faithfully; `failRootUpdate(keys)` injects a failure.
function faithful(db) {
  const base = db.ref;
  const withChildren = (s) => { const v = s.val(); return { ...s, hasChildren: () => !!v && typeof v === "object" && Object.keys(v).length > 0 }; };
  db.ref = (p) => {
    if (p === undefined || p === "" || p === "/") return { update: async (o) => { if (db.beforeRootUpdate) await db.beforeRootUpdate(Object.keys(o)); if (db.failRootUpdate && db.failRootUpdate(Object.keys(o))) throw new Error("transport"); for (const [k, v] of Object.entries(o)) db.put(k, v); } };
    const r = base(p);
    return { ...r, get: async () => withChildren(await r.get()), once: async () => withChildren(await r.get()) };
  };
  return db;
}
const mdb = (world) => faithful(memoryDb(world));
const effects = (db, t, uid) => ({
  role: db.read(`tenants/${t}/roles/${uid}`), member: db.read(`tenants/${t}/members/${uid}`),
  guard: db.read(`tenants/${t}/access_meta/owner_guard`), mapping: db.read(`user_tenants/${uid}`),
});
const NONE = { role: null, member: null, guard: null, mapping: null };

test("BS-01 the review's conditions: no roles + an existing registry ([null] or valid) is never claimable", async () => {
  for (const [label, registry] of [["[null] registry", { _v: "[null]" }], ["valid registry", env([{ id: "bizC", name: "Valid" }])], ["raw-array registry", [{ id: "bizC" }]]]) {
    const db = mdb({ tenants: { [T]: { app: { business: registry } } } });
    const before = db.value();
    const api = await apiHarness(db);
    const r = await api.call("bootstrap-self", { tenantId: T }, "uidA");
    assert.deepEqual([r.code, r.body], [409, { error: "tenant_has_data" }], label);
    assert.deepEqual(effects(db, T, "uidA"), NONE, label + ": no role / membership / guard / mapping");
    assert.deepEqual(db.value(), before, label + ": nothing at all is written (the registry is unchanged)");
  }
});

test("BS-02 a role-less tenant holding any data is not claimable", async () => {
  for (const [label, tenant] of [
    ["entries only", { "biz:bizA:entries": env([]) }], ["users only", { app: { users: env([{ id: "u" }]) } }],
    ["config only", { "biz:bizA:config": env({}) }], ["meta only", { meta: { createdAt: 1 } }],
    ["members without roles", { members: { other: true } }], ["a lookup", { lookup: { someone: { email: "x@example.test" } } }],
  ]) {
    const db = mdb({ tenants: { [T]: tenant } });
    const before = db.value();
    const r = await (await apiHarness(db)).call("bootstrap-self", { tenantId: T }, "uidA");
    assert.equal(r.code, 409, label);
    assert.deepEqual(db.value(), before, label + ": unchanged");
  }
});

test("BS-03 legitimate onboarding: an absent tenant is claimed with exactly the bootstrap effects", async () => {
  const db = mdb({ tenants: { other: { roles: { x: "owner" } } } });
  const r = await (await apiHarness(db)).call("bootstrap-self", { tenantId: T }, "uidA");
  assert.deepEqual([r.code, r.body], [200, { ok: true, tenantId: T, role: "super_owner" }]);
  const e = effects(db, T, "uidA");
  assert.deepEqual([e.role, e.member, e.mapping], ["super_owner", true, T]);
  assert.deepEqual(e.guard.ownerUids, { uidA: true });
  assert.deepEqual(Object.keys(db.read(`tenants/${T}`)).sort(), ["access_meta", "members", "roles"], "nothing else is created");
  assert.deepEqual(db.read(`tenants/${T}/roles`), { uidA: "super_owner" });
  assert.deepEqual(db.read("tenants/other"), { roles: { x: "owner" } }, "another tenant is untouched");
});

test("BS-04 concurrent claims: exactly one caller becomes the owner; the other is refused with no role", async () => {
  const db = mdb({ tenants: {} });
  const api = await apiHarness(db);
  // uidB's checks pass (the tenant is absent); before uidB's claim is WRITTEN — by a transaction or by any role write —
  // uidA's whole bootstrap commits (the race window between a check and a write)
  let raced = false;
  const race = async () => { raced = true; db.beforeTransaction = null; db.beforeRootUpdate = null; const a = await api.call("bootstrap-self", { tenantId: T }, "uidA"); assert.equal(a.code, 200); };
  db.beforeTransaction = async (p) => { if (!raced && p === `tenants/${T}`) await race(); };
  db.beforeRootUpdate = async (keys) => { if (!raced && keys.some((k) => k.startsWith(`tenants/${T}/roles/uidB`))) await race(); };
  const b = await api.call("bootstrap-self", { tenantId: T }, "uidB");
  assert.ok(raced, "the race window was exercised");
  assert.deepEqual([b.code, b.body], [409, { error: "tenant_has_data" }]);
  assert.deepEqual(db.read(`tenants/${T}/roles`), { uidA: "super_owner" }, "one owner, no mixed roles");
  assert.deepEqual(db.read(`tenants/${T}/members`), { uidA: true });
  assert.deepEqual(db.read(`tenants/${T}/access_meta/owner_guard/ownerUids`), { uidA: true });
  assert.equal(db.read("user_tenants/uidB"), null, "the loser gets no mapping");
});

test("BS-05 an unknown claim outcome: the same user's retry resumes; another user is refused", async () => {
  const db = mdb({ tenants: {} });
  const api = await apiHarness(db);
  db.afterTransaction = async (p) => { if (p === `tenants/${T}`) { db.afterTransaction = null; throw new Error("acknowledgement lost"); } };
  const first = await api.call("bootstrap-self", { tenantId: T }, "uidA");
  assert.equal(first.code, 500, "the outcome is not assumed");
  assert.deepEqual(db.read(`tenants/${T}/roles`), { uidA: "super_owner" }, "the claim did commit");
  assert.equal(db.read("user_tenants/uidA"), null, "… without its mapping");
  const other = await api.call("bootstrap-self", { tenantId: T }, "uidB");
  assert.deepEqual([other.code, other.body], [409, { error: "tenant_already_initialized" }]);
  const eb = effects(db, T, "uidB");
  assert.deepEqual([eb.role, eb.member, eb.mapping], [null, null, null], "uidB gains nothing");
  assert.deepEqual(eb.guard.ownerUids, { uidA: true }, "the owner guard names only the claimant");
  const retry = await api.call("bootstrap-self", { tenantId: T }, "uidA");
  assert.deepEqual([retry.code, retry.body], [200, { ok: true, tenantId: T, role: "super_owner", resumed: true }]);
  assert.equal(db.read("user_tenants/uidA"), T, "the mapping is recovered");
  assert.deepEqual(db.read(`tenants/${T}/roles`), { uidA: "super_owner" }, "nothing else is granted");
});

test("BS-06 the mapping write fails after the claim: 500, then the same user's retry resumes", async () => {
  const db = mdb({ tenants: {} });
  const api = await apiHarness(db);
  let fail = true;
  db.failRootUpdate = (keys) => { if (fail && keys.includes("user_tenants/uidA")) { fail = false; return true; } return false; };
  const first = await api.call("bootstrap-self", { tenantId: T }, "uidA");
  assert.equal(first.code, 500);
  assert.equal(db.read("user_tenants/uidA"), null);
  const retry = await api.call("bootstrap-self", { tenantId: T }, "uidA");
  assert.equal(retry.code, 200);
  assert.equal(retry.body.resumed, true);
  assert.equal(db.read("user_tenants/uidA"), T);
});

test("BS-07 controls: an initialized tenant is refused and unchanged; an established owner with a mapping is not 'resumed'", async () => {
  for (const [label, world, uid] of [
    ["another owner", { tenants: { [T]: { roles: { ownerB: "super_owner" }, app: { business: { _v: "[null]" } } } } }, "uidA"],
    ["the caller among other role holders", { tenants: { [T]: { roles: { uidA: "super_owner", m: "manager" }, members: { uidA: true, m: true } } } }, "uidA"],
    ["the caller as owner (not super_owner)", { tenants: { [T]: { roles: { uidA: "owner" }, members: { uidA: true } } } }, "uidA"],
    ["the sole super_owner, already mapped", { tenants: { [T]: { roles: { uidA: "super_owner" }, members: { uidA: true } } }, user_tenants: { uidA: "elsewhere" } }, "uidA"],
  ]) {
    const db = mdb(world);
    const before = db.value();
    const r = await (await apiHarness(db)).call("bootstrap-self", { tenantId: T }, uid);
    assert.deepEqual([r.code, r.body], [409, { error: "tenant_already_initialized" }], label);
    assert.deepEqual(db.value(), before, label + ": unchanged");
  }
});

// ── BS-08: create-client (super_owner only) — its own harness: Admin Auth createUser is a seam ───────────────────────────
async function createClientHarness(db) {
  const dir = mkdtempSync(join(tmpdir(), "m1r4-cc-"));
  for (const f of ["lib", "fincore"]) cpSync(join(ROOT, f), join(dir, f), { recursive: true });
  mkdirSync(join(dir, "api")); cpSync(join(ROOT, "api/admin.js"), join(dir, "api/admin.js"));
  symlinkSync(join(ROOT, "node_modules"), join(dir, "node_modules"), "dir");
  const key = "m1r4cc:" + dir; globalThis[key] = db; db.created = [];
  writeFileSync(join(dir, "lib/adminSdk.js"), `export function getAdminDb(){return globalThis[${JSON.stringify(key)}]} export function getAdminAuth(){const db=globalThis[${JSON.stringify(key)}];return {getUser:async()=>({}),createUser:async(u)=>{if(db.emailTaken)throw Object.assign(new Error("exists"),{code:"auth/email-already-exists"});db.created.push(u.email);return {uid:"newOwner"}}}}`);
  writeFileSync(join(dir, "lib/verifyToken.js"), 'export async function requireAuth(req){if(!req.__claims)throw Error("no auth");return req.__claims} export async function verifyToken(){return null}');
  writeFileSync(join(dir, "lib/sendEmail.js"), "export async function sendEmail(){} export async function sendAlertDigest(){}");
  const handler = (await import(pathToFileURL(join(dir, "api/admin.js")))).default;
  return async (body) => { const res = { code: 0, body: null, setHeader() {}, status(n) { this.code = n; return this; }, json(v) { this.body = v; return this; } };
    await handler({ method: "POST", query: { action: "create-client" }, body, headers: {}, __claims: { uid: "super", email: "s@example.test" } }, res); return res; };
}

test("BS-08 create-client never writes over an existing tenant with the generated id; a failed creation releases its reservation", async () => {
  const realNow = Date.now;
  const NOW = 1790000000000;
  Date.now = () => NOW;
  try {
    const existing = { roles: { victim: "owner" }, members: { victim: true }, app: { business: env([{ id: `biz_${NOW}`, name: "Existing" }]), users: env([{ id: "u_1", firebaseUid: "victim" }]) } };
    const db = mdb({ tenants: { home: { roles: { super: "super_owner" } }, [`biz_${NOW}`]: existing } });
    const call = await createClientHarness(db);
    const body = { bizName: "New Client", ownerName: "O", ownerEmail: "o@example.test", ownerUsername: "newowner" };
    const r = await call(body);
    assert.equal(r.code, 200, JSON.stringify(r.body));
    assert.equal(r.body.tenantId, `biz_${NOW}_1`, "the colliding id is skipped, never written over");
    assert.deepEqual(db.read(`tenants/biz_${NOW}`), existing, "the existing tenant is byte-identical");
    const created = db.read(`tenants/biz_${NOW}_1`);
    assert.deepEqual(JSON.parse(created.app.business._v), [{ id: `biz_${NOW}_1`, name: "New Client", createdAt: NOW }]);
    assert.equal(created.roles.newOwner, "owner");
    assert.equal(created.meta.provisioning, undefined, "the reservation marker is cleared by the final write");
    assert.equal(db.read("user_tenants/newOwner"), `biz_${NOW}_1`);
    // a creation that fails after the reservation (e-mail already registered) leaves nothing behind
    const db2 = mdb({ tenants: { home: { roles: { super: "super_owner" } } } }); db2.emailTaken = true;
    const call2 = await createClientHarness(db2);
    const r2 = await call2({ ...body, ownerUsername: "other" });
    assert.equal(r2.code, 409);
    assert.equal(db2.read(`tenants/biz_${NOW}`), null, "the reservation is released");
  } finally { Date.now = realNow; }
});
