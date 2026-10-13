// VERSION FENCE — api/admin.js set/clear-entry-exception ADMISSION under the business
// storage policy (VF-15 server side). The Admin SDK bypasses Rules, so the handler reads
// storage_v2_control/{t}/{b} after authorization and refuses with a typed 423 when the
// business is quiesced / recovery-held, or the record is malformed / unreadable —
// before any ledger mutation. Absent / legacy / v2_active admit exactly as before.
// The REAL api/admin.js is executed with only the Admin-SDK / auth / email seams replaced.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, cpSync, mkdirSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { makeDb, installDb, ROOT, T, B } from "../support/server-reader-harness.mjs";

const dir = mkdtempSync(join(tmpdir(), "vf-admin-"));
cpSync(join(ROOT, "lib"), join(dir, "lib"), { recursive: true });
cpSync(join(ROOT, "fincore", "v1"), join(dir, "fincore", "v1"), { recursive: true }); // P1 R1: lib/supplierCredits.js imports the shared core rules
mkdirSync(join(dir, "api"), { recursive: true });
cpSync(join(ROOT, "api", "admin.js"), join(dir, "api", "admin.js"));
try { symlinkSync(join(ROOT, "node_modules"), join(dir, "node_modules"), "dir"); } catch (_) {}
writeFileSync(join(dir, "lib", "adminSdk.js"), `export function getAdminDb() { return globalThis.__DB; }\nexport function getAdminAuth() { return { getUser: async () => ({}) }; }\n`);
writeFileSync(join(dir, "lib", "verifyToken.js"), `export async function requireAuth() { if (!globalThis.__CLAIMS) throw new Error("no auth"); return globalThis.__CLAIMS; }\nexport async function verifyIdToken() { return globalThis.__CLAIMS; }\n`);
writeFileSync(join(dir, "lib", "sendEmail.js"), `export async function sendEmail() { return { messageId: "m" }; }\nexport async function sendAlertDigest() { return { messageId: "d" }; }\n`);
const handler = (await import(pathToFileURL(join(dir, "api", "admin.js")).href)).default;

const UID = "u_owner";
function seed(policy) {
  const db = installDb(makeDb());
  db.seed(`tenants/${T}/members/${UID}`, true);
  db.seed(`tenants/${T}/roles/${UID}`, "owner");
  db.seed(`tenants/${T}/biz_access/${B}/${UID}`, true);
  // I7 test-contract transition (T-I7-TEST-ADMINLOCAL; P0/admin-API + M1 identity owners — independent I6 review I6-R-02): the
  // entry-exception writes now require the exact business to be authoritatively registered, so the fixture carries the runtime
  // registry node registering B. Every admission / refusal assertion below is unchanged.
  db.seed(`tenants/${T}/app/business`, { _v: JSON.stringify([{ id: B, name: "B" }]) });
  if (policy !== null && policy !== undefined) db.seed(`storage_v2_control/${T}/${B}`, policy);
  globalThis.__CLAIMS = { uid: UID, email: "o@example.invalid" };
  return db;
}
async function call(action, body) {
  const r = { code: null, body: null, setHeader() {}, status(n) { this.code = n; return this; }, json(v) { this.body = v; return this; }, end() { return this; } };
  await handler({ method: "POST", query: { action }, headers: { authorization: "Bearer t" }, body }, r);
  return { code: r.code, body: r.body };
}
const SET = { tenantId: T, bizId: B, businessDate: "2026-08-10", reasonCode: "holiday", reasonText: "חג", expectedRevision: 0, operationId: "11111111-1111-4111-8111-000000000001" };
const CLEAR = { tenantId: T, bizId: B, businessDate: "2026-08-10", expectedRevision: 1, operationId: "11111111-1111-4111-8111-000000000002" };
const POL = (over = {}) => ({ contractVersion: 1, phase: "legacy", policyRevision: 1, allowV2Initialization: false, minStorageProtocol: 1, ...over });
const ledger = (db) => db.read(`tenants/${T}/entry_exceptions/${B}`);

test("admitted: absent record, explicit legacy, v2_active → set then clear succeed exactly as before", async () => {
  for (const policy of [null, POL(), POL({ phase: "v2_active", minStorageProtocol: 2 })]) {
    const db = seed(policy);
    const s = await call("set-entry-exception", SET);
    assert.equal(s.code, 200, JSON.stringify([policy, s.body])); assert.equal(s.body.ok, true);
    assert.ok(ledger(db) && ledger(db)["2026-08-10"], "ledger written");
    const c = await call("clear-entry-exception", { ...CLEAR, expectedRevision: s.body.revision });
    assert.equal(c.code, 200, JSON.stringify(c.body));
  }
});

test("refused (423, no ledger side effect): quiesced, recovery_hold, malformed record, phase-less record, unreadable record", async () => {
  const cases = [
    [POL({ phase: "quiesced", operation: { id: "op", kind: "cutover", owner: "alice", startedAt: 1 } }), "maintenance", "quiesced"],
    [POL({ phase: "recovery_hold" }), "maintenance", "recovery_hold"],
    [{ policyRevision: 7 }, "policy_malformed", undefined],
    [{ phase: "legacy" }, "policy_malformed", undefined],
    [POL({ phase: "v2_active", allowV2Initialization: "true" }), "policy_malformed", undefined],
    [7, "policy_malformed", undefined],
    [POL({ contractVersion: 2, phase: "v2_active" }), "unsupported_contract", undefined],
  ];
  for (const [policy, reason, phase] of cases) {
    const db = seed(policy);
    for (const [action, body] of [["set-entry-exception", SET], ["clear-entry-exception", CLEAR]]) {
      const r = await call(action, body);
      assert.equal(r.code, 423, JSON.stringify([policy, action, r.body]));
      assert.equal(r.body.error, "maintenance"); assert.equal(r.body.reason, reason); if (phase) assert.equal(r.body.phase, phase);
      assert.equal(ledger(db), null, "ledger untouched");
    }
  }
  // unreadable policy → fail closed
  const db = seed(null);
  const orig = db.ref; db.ref = (p) => (p.startsWith("storage_v2_control/") ? { once: async () => { throw new Error("network"); }, get: async () => { throw new Error("network"); } } : orig(p));
  const r = await call("set-entry-exception", SET); assert.equal(r.code, 423); assert.equal(r.body.reason, "policy_unavailable"); assert.equal(ledger(db), null);
});

test("ordering: the policy check runs AFTER authorization — an outsider is still 403, never a policy answer", async () => {
  const db = seed(POL({ phase: "quiesced", operation: { id: "op", kind: "cutover", owner: "a", startedAt: 1 } }));
  globalThis.__CLAIMS = { uid: "u_outsider", email: "x@example.invalid" };
  const r = await call("set-entry-exception", SET);
  assert.equal(r.code, 403); assert.equal(ledger(db), null);
});
