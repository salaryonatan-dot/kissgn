// VERSION FENCE R1 (Codex F2) — api/admin.js `delete-client` (tenant-wide destructive Admin path)
// respects business maintenance holds. The REAL api/admin.js runs with only the Admin-SDK /
// auth / email seams replaced (as test/security/entry-exceptions-maintenance.test.mjs does).
// The same cases run against the real emulator transport in test/emulator/admin-maintenance-gate.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, cpSync, mkdirSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { makeDb, ROOT } from "../support/server-reader-harness.mjs";

const dir = mkdtempSync(join(tmpdir(), "vf-admin-del-"));
cpSync(join(ROOT, "lib"), join(dir, "lib"), { recursive: true });
mkdirSync(join(dir, "api"), { recursive: true });
cpSync(join(ROOT, "api", "admin.js"), join(dir, "api", "admin.js"));
try { symlinkSync(join(ROOT, "node_modules"), join(dir, "node_modules"), "dir"); } catch (_) {}
writeFileSync(join(dir, "lib", "adminSdk.js"), `export function getAdminDb() { return globalThis.__DB; }\nexport function getAdminAuth() { return { getUser: async () => ({}), deleteUser: async (uid) => { (globalThis.__DELETED_AUTH ||= []).push(uid); } }; }\n`);
writeFileSync(join(dir, "lib", "verifyToken.js"), `export async function requireAuth() { if (!globalThis.__CLAIMS) throw new Error("no auth"); return globalThis.__CLAIMS; }\nexport async function verifyToken() { return globalThis.__CLAIMS; }\n`);
writeFileSync(join(dir, "lib", "sendEmail.js"), `export async function sendEmail() { return { messageId: "m" }; }\nexport async function sendAlertDigest() { return { messageId: "d" }; }\n`);
const handler = (await import(pathToFileURL(join(dir, "api", "admin.js")).href)).default;

const SUPER = "u_super", T = "tenantX";
const POL = (over = {}) => ({ contractVersion: 1, phase: "legacy", policyRevision: 1, allowV2Initialization: false, minStorageProtocol: 1, ...over });
const QUIESCED = POL({ phase: "quiesced", policyRevision: 2, operation: { id: "op", kind: "cutover", owner: "operator", startedAt: 1 } });
const HOLD = POL({ phase: "recovery_hold", policyRevision: 3, minStorageProtocol: 2, operation: { id: "rec", kind: "recovery", owner: "operator", startedAt: 1 } });
const ACTIVE = POL({ phase: "v2_active", policyRevision: 2, minStorageProtocol: 2 });

function seed({ policies = {}, unreadableControl = false } = {}) {
  const raw = makeDb();
  raw.seed(`tenants/${T}/members`, { u_a: true, u_b: true, [SUPER]: true });
  raw.seed(`tenants/${T}/roles`, { u_a: "owner", u_b: "manager", [SUPER]: "super_owner" });
  raw.seed(`tenants/${T}/lookup`, { alice: { email: "a@x", firebaseUid: "u_a" } });
  raw.seed(`tenants/${T}/biz:bizA:entries`, { _v: JSON.stringify([{ id: "00000001-aaaa-4bbb-8ccc-dddddddddddd", date: "2026-08-01", sales: 1 }]) });
  raw.seed(`tenants/${T}/biz:bizB:entries`, { schemaVersion: 2, generation: 1, rows: { "00000002-aaaa-4bbb-8ccc-dddddddddddd": { id: "00000002-aaaa-4bbb-8ccc-dddddddddddd", _gen: 1, date: "2026-08-02", sales: 2 } } });
  raw.seed(`user_tenants/u_a`, T); raw.seed(`username_index/alice`, { tenantId: T, email: "a@x" });
  raw.seed(`tenants/other/roles/${SUPER}`, "super_owner");
  for (const [biz, rec] of Object.entries(policies)) raw.seed(`storage_v2_control/${T}/${biz}`, rec);
  const db = { ...raw, ref: (p = "") => { const r = raw.ref(p); if (unreadableControl && String(p).startsWith("storage_v2_control")) return { ...r, once: async () => { throw new Error("simulated read failure"); } }; return r; } };
  globalThis.__DB = db; globalThis.__CLAIMS = { uid: SUPER, email: "s@x" }; globalThis.__DELETED_AUTH = [];
  return db;
}
async function del(body = { tenantId: T }) {
  const r = { code: null, body: null, setHeader() {}, status(n) { this.code = n; return this; }, json(v) { this.body = v; return this; }, end() { return this; } };
  await handler({ method: "POST", query: { action: "delete-client" }, headers: { authorization: "Bearer t" }, body }, r);
  return { code: r.code, body: r.body };
}
const tenantIntact = (db) => JSON.stringify(db.read(`tenants/${T}`));

test("A. tenant with a QUIESCED business → 423 maintenance, nothing deleted (tenant, user_tenants, username_index, auth users all intact)", async () => {
  const db = seed({ policies: { bizA: QUIESCED } });
  const before = tenantIntact(db);
  const r = await del();
  assert.equal(r.code, 423); assert.deepEqual(r.body, { error: "maintenance", reason: "maintenance", phase: "quiesced", bizId: "bizA" });
  assert.equal(tenantIntact(db), before); assert.equal(db.read("user_tenants/u_a"), T); assert.ok(db.read("username_index/alice"));
  assert.equal(db.writes.length, 0, "no write at all"); assert.deepEqual(globalThis.__DELETED_AUTH, []);
});

test("B. tenant with a RECOVERY_HOLD business → 423, nothing deleted", async () => {
  const db = seed({ policies: { bizB: HOLD } });
  const r = await del();
  assert.equal(r.code, 423); assert.equal(r.body.reason, "maintenance"); assert.equal(r.body.phase, "recovery_hold"); assert.equal(r.body.bizId, "bizB");
  assert.ok(db.read(`tenants/${T}/biz:bizB:entries`)); assert.equal(db.writes.length, 0);
});

test("C. malformed policy record (phase missing / fractional revision / scalar) → 423, nothing deleted", async () => {
  for (const bad of [{ policyRevision: 7 }, POL({ policyRevision: 1.5 }), "legacy", POL({ contractVersion: 2 })]) {
    const db = seed({ policies: { bizA: bad } });
    const r = await del();
    assert.equal(r.code, 423, JSON.stringify(bad)); assert.ok(["policy_malformed", "unsupported_contract"].includes(r.body.reason), r.body.reason);
    assert.ok(db.read(`tenants/${T}/biz:bizA:entries`)); assert.equal(db.writes.length, 0);
  }
});

test("D. unreadable policy records → 423 policy_unavailable, nothing deleted", async () => {
  const db = seed({ policies: { bizA: POL() }, unreadableControl: true });
  const r = await del();
  assert.equal(r.code, 423); assert.equal(r.body.reason, "policy_unavailable");
  assert.ok(db.read(`tenants/${T}`)); assert.equal(db.writes.length, 0);
});

test("E. eligible states (no records / legacy / v2_active) → the pre-existing deletion behaviour: tenant, user_tenants, username_index removed, auth users deleted (caller kept), AND the tenant's policy records removed in the same atomic update", async () => {
  for (const policies of [{}, { bizA: POL() }, { bizA: POL(), bizB: ACTIVE }]) {
    const db = seed({ policies });
    const r = await del();
    assert.equal(r.code, 200, JSON.stringify(policies)); assert.equal(r.body.ok, true); assert.equal(r.body.tenantId, T);
    assert.equal(db.read(`tenants/${T}`), null); assert.equal(db.read("user_tenants/u_a"), null); assert.equal(db.read("username_index/alice"), null);
    assert.equal(db.read(`storage_v2_control/${T}`), null, "no orphan policy state");
    assert.equal(db.writes.length, 1, "exactly one atomic multi-path update"); assert.equal(db.writes[0].op, "update");
    assert.deepEqual(globalThis.__DELETED_AUTH.sort(), ["u_a", "u_b"], "caller's own auth user kept");
  }
});

test("F. multi-business tenant: one normal + one quiesced → the WHOLE operation refused, both businesses intact", async () => {
  const db = seed({ policies: { bizA: POL(), bizB: QUIESCED } });
  const before = tenantIntact(db);
  const r = await del();
  assert.equal(r.code, 423); assert.equal(r.body.bizId, "bizB");
  assert.equal(tenantIntact(db), before); assert.ok(db.read(`tenants/${T}/biz:bizA:entries`)); assert.ok(db.read(`tenants/${T}/biz:bizB:entries`));
  assert.equal(db.writes.length, 0);
});

test("G. authorization failures are unchanged and come BEFORE the policy check: no auth → 401; non-super_owner → 403; unknown tenant → 404; never a maintenance answer", async () => {
  let db = seed({ policies: { bizA: QUIESCED } }); globalThis.__CLAIMS = null;
  let r = await del(); assert.equal(r.code, 401); assert.equal(db.writes.length, 0);
  db = seed({ policies: { bizA: QUIESCED } }); globalThis.__CLAIMS = { uid: "u_a", email: "a@x" };
  r = await del(); assert.equal(r.code, 403); assert.equal(db.writes.length, 0);
  db = seed({ policies: { bizA: QUIESCED } });
  r = await del({ tenantId: "nope" }); assert.equal(r.code, 404);
  r = await del({}); assert.equal(r.code, 400);
});
