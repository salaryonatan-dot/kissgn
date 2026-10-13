// Marjin — P0-DATA-01 VERSION FENCE R1 (Codex F2): the ACTUAL api/admin.js handler over the REAL
// local Admin SDK transport (firebase-admin → RTDB emulator). The Admin SDK bypasses Rules, so
// this proves the application-level maintenance gate itself: `delete-client` (tenant-wide
// destructive) and `set/clear-entry-exception` (entries-domain) refuse with a typed 423 and
// write NOTHING while any affected business is quiesced / recovery-held / malformed / unreadable,
// and behave exactly as before otherwise.
//
// Deliberately NOT named *.test.mjs. Host run: see test/emulator/README.md.

import admin from "firebase-admin";
import { readFileSync, mkdtempSync, writeFileSync, cpSync, mkdirSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { validateFirebaseConfig } from "./rtdb-authorization-matrix.mjs";

const PROJECT = "demo-marjin-rules", NAMESPACE = "demo-marjin-rules-default-rtdb";
const EMU = "127.0.0.1:9000", DB_URL = `http://${EMU}?ns=${NAMESPACE}`;
const DIR = dirname(fileURLToPath(import.meta.url)), ROOT = join(DIR, "..", "..");
const fail = (m) => { console.error(`SAFETY ABORT: ${m}`); process.exit(2); };
const DEMO = new Set(["https://demo-marjin-rules.firebaseio.com", "https://demo-marjin-rules-default-rtdb.firebaseio.com"]);
const isLocal = (u) => /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?([/?].*)?$/.test(String(u));
function assertSafe() {
  if (process.env.GCLOUD_PROJECT !== PROJECT) fail(`GCLOUD_PROJECT must be ${PROJECT}`);
  if (process.env.GOOGLE_CLOUD_PROJECT !== PROJECT) fail(`GOOGLE_CLOUD_PROJECT must be ${PROJECT}`);
  if (process.env.FIREBASE_DATABASE_EMULATOR_HOST !== EMU) fail(`FIREBASE_DATABASE_EMULATOR_HOST must be ${EMU}`);
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) fail("GOOGLE_APPLICATION_CREDENTIALS must be absent");
  const fc = validateFirebaseConfig(process.env.FIREBASE_CONFIG);
  if (!fc.ok) fail(`FIREBASE_CONFIG rejected: ${fc.reason}`);
  if (process.env.FIREBASE_DATABASE_URL) { const u = String(process.env.FIREBASE_DATABASE_URL); if (!DEMO.has(u) && !isLocal(u)) fail(`FIREBASE_DATABASE_URL is not demo/local: ${u}`); }
  const a = readFileSync(join(DIR, "database.rules.json")), b = readFileSync(join(ROOT, "database.rules.json"));
  if (Buffer.compare(a, b) !== 0) fail("test/emulator/database.rules.json differs from the canonical rules — refresh the copy");
}

// the real handler with ONLY the Admin-SDK / auth / email seams replaced; the DB seam is the real Admin transport
const dir = mkdtempSync(join(tmpdir(), "vf-admin-emu-"));
cpSync(join(ROOT, "lib"), join(dir, "lib"), { recursive: true });
cpSync(join(ROOT, "fincore", "v1"), join(dir, "fincore", "v1"), { recursive: true }); // P1 R1: lib/supplierCredits.js imports the shared core rules
mkdirSync(join(dir, "api"), { recursive: true });
cpSync(join(ROOT, "api", "admin.js"), join(dir, "api", "admin.js"));
try { symlinkSync(join(ROOT, "node_modules"), join(dir, "node_modules"), "dir"); } catch (_) {}
writeFileSync(join(dir, "lib", "adminSdk.js"), `export function getAdminDb() { return globalThis.__DB(); }\nexport function getAdminAuth() { return { getUser: async () => ({}), deleteUser: async (uid) => { (globalThis.__DELETED_AUTH ||= []).push(uid); } }; }\n`);
writeFileSync(join(dir, "lib", "verifyToken.js"), `export async function requireAuth() { if (!globalThis.__CLAIMS) throw new Error("no auth"); return globalThis.__CLAIMS; }\nexport async function verifyToken() { return globalThis.__CLAIMS; }\n`);
writeFileSync(join(dir, "lib", "sendEmail.js"), `export async function sendEmail() { return { messageId: "m" }; }\nexport async function sendAlertDigest() { return { messageId: "d" }; }\n`);
const handler = (await import(pathToFileURL(join(dir, "api", "admin.js")).href)).default;

const SUPER = "u_super", T = "tenantX";
const POL = (over = {}) => ({ contractVersion: 1, phase: "legacy", policyRevision: 1, allowV2Initialization: false, minStorageProtocol: 1, ...over });
const QUIESCED = POL({ phase: "quiesced", policyRevision: 2, operation: { id: "op", kind: "cutover", owner: "operator", startedAt: 1 } });
const HOLD = POL({ phase: "recovery_hold", policyRevision: 3, minStorageProtocol: 2, operation: { id: "rec", kind: "recovery", owner: "operator", startedAt: 1 } });
const ACTIVE = POL({ phase: "v2_active", policyRevision: 2, minStorageProtocol: 2 });
const apps = {};
const seedDb = () => apps.seed.database();
const fixtures = (policies) => ({
  tenants: { [T]: {
    members: { u_a: true, u_b: true, [SUPER]: true }, roles: { u_a: "owner", u_b: "manager", [SUPER]: "super_owner" }, biz_access: { bizA: { u_b: true }, bizB: { u_b: true } },
    lookup: { alice: { email: "a@x", firebaseUid: "u_a" } },
    // I7 test-contract transition (T-I7-TEST-ADMINLOCAL; P0 / admin-API + M1 identity owners — independent I6 review I6-R-02): the
    // entry-exception writes (AM-H) now require the exact business to be authoritatively registered, so the tenant carries the runtime
    // registry node registering bizA and bizB. Every admission / refusal / byte-identity assertion is unchanged.
    app: { business: { _v: JSON.stringify([{ id: "bizA", name: "A" }, { id: "bizB", name: "B" }]) } },
    "biz:bizA:entries": { _v: JSON.stringify([{ id: "00000001-aaaa-4bbb-8ccc-dddddddddddd", date: "2026-08-01", sales: 1 }]) },
    "biz:bizB:entries": { schemaVersion: 2, generation: 1, rows: { "00000002-aaaa-4bbb-8ccc-dddddddddddd": { id: "00000002-aaaa-4bbb-8ccc-dddddddddddd", _gen: 1, date: "2026-08-02", sales: 2 } } },
  }, other: { roles: { [SUPER]: "super_owner" } } },
  user_tenants: { u_a: T }, username_index: { alice: { tenantId: T, email: "a@x" } },
  ...(Object.keys(policies).length ? { storage_v2_control: { [T]: policies } } : {}),
});
async function seed(policies = {}) { await seedDb().ref("/").set(fixtures(policies)); globalThis.__CLAIMS = { uid: SUPER, email: "s@x" }; globalThis.__DELETED_AUTH = []; globalThis.__DB = () => seedDb(); }
const readAll = async () => JSON.stringify((await seedDb().ref("/").once("value")).val());
async function call(action, body) {
  const r = { code: null, body: null, setHeader() {}, status(n) { this.code = n; return this; }, json(v) { this.body = v; return this; }, end() { return this; } };
  await handler({ method: "POST", query: { action }, headers: { authorization: "Bearer t" }, body }, r);
  return { code: r.code, body: r.body };
}
const del = (body = { tenantId: T }) => call("delete-client", body);

const results = []; let failures = 0;
async function run(id, description, fn) {
  try { const n = await fn(); results.push({ id, status: "PASS", description, notes: n || "" }); }
  catch (e) { failures++; results.push({ id, status: "FAIL", description, notes: (e && e.stack) || String(e) }); }
}
const expect = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => { if (a !== b) throw new Error(`${m}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };

async function main() {
  assertSafe();
  apps.seed = admin.initializeApp({ databaseURL: DB_URL }, "seed");

  await run("AM-A", "tenant with a QUIESCED business → 423, database byte-identical, no auth user deleted", async () => {
    await seed({ bizA: QUIESCED }); const before = await readAll();
    const r = await del(); eq(r.code, 423, "status"); eq(r.body.reason, "maintenance", "reason"); eq(r.body.phase, "quiesced", "phase"); eq(r.body.bizId, "bizA", "biz");
    eq(await readAll(), before, "database unchanged"); eq(globalThis.__DELETED_AUTH.length, 0, "auth untouched");
    return "423 quiesced; db identical";
  });
  await run("AM-B", "tenant with a RECOVERY_HOLD business → 423, database byte-identical", async () => {
    await seed({ bizB: HOLD }); const before = await readAll();
    const r = await del(); eq(r.code, 423, "status"); eq(r.body.phase, "recovery_hold", "phase"); eq(r.body.bizId, "bizB", "biz");
    eq(await readAll(), before, "database unchanged");
    return "423 recovery_hold";
  });
  await run("AM-C", "malformed policy records (phase-only, fractional revision, unsafe revision, scalar, newer contract) → 423, database byte-identical", async () => {
    const bads = [{ policyRevision: 7 }, POL({ policyRevision: 1.5 }), POL({ policyRevision: 9007199254740992 }), "legacy", POL({ contractVersion: 2 })];
    for (const bad of bads) {
      await seed({ bizA: bad }); const before = await readAll();
      const r = await del(); eq(r.code, 423, JSON.stringify(bad)); expect(["policy_malformed", "unsupported_contract"].includes(r.body.reason), r.body.reason);
      eq(await readAll(), before, "database unchanged for " + JSON.stringify(bad));
    }
    return bads.length + " malformed shapes refused";
  });
  await run("AM-D", "unreadable policy records (transport error) → 423 policy_unavailable, database byte-identical", async () => {
    await seed({ bizA: POL() }); const before = await readAll();
    const real = seedDb();
    globalThis.__DB = () => ({ ref: (p) => { const r = real.ref(p); if (String(p).startsWith("storage_v2_control")) return { ...r, once: async () => { throw new Error("simulated transport failure"); } }; return r; } });
    const r = await del(); eq(r.code, 423, "status"); eq(r.body.reason, "policy_unavailable", "reason");
    globalThis.__DB = () => seedDb();
    eq(await readAll(), before, "database unchanged");
    return "423 policy_unavailable";
  });
  await run("AM-E", "eligible states (no records / legacy / v2_active): the pre-existing deletion happens — tenant, user_tenants, username_index and the tenant's policy records gone in ONE atomic update; caller's auth user kept", async () => {
    for (const policies of [{}, { bizA: POL() }, { bizA: POL(), bizB: ACTIVE }]) {
      await seed(policies);
      const r = await del(); eq(r.code, 200, JSON.stringify(policies)); eq(r.body.ok, true, "ok");
      const root = (await seedDb().ref("/").once("value")).val();
      eq(root.tenants[T], undefined, "tenant removed"); eq(root.user_tenants, undefined, "user_tenants removed"); eq(root.username_index, undefined, "username_index removed");
      eq(root.storage_v2_control, undefined, "no orphan policy state"); eq(root.tenants.other.roles[SUPER], "super_owner", "other tenant untouched");
      eq(globalThis.__DELETED_AUTH.sort().join(","), "u_a,u_b", "auth users deleted except the caller");
    }
    return "3 eligible states deleted as before";
  });
  await run("AM-F", "multi-business tenant, one normal + one quiesced → WHOLE operation refused; both businesses byte-identical", async () => {
    await seed({ bizA: POL(), bizB: QUIESCED }); const before = await readAll();
    const r = await del(); eq(r.code, 423, "status"); eq(r.body.bizId, "bizB", "the held business is named");
    eq(await readAll(), before, "database unchanged");
    return "refused as a whole";
  });
  await run("AM-G", "authorization unchanged and evaluated BEFORE the policy check: no auth 401, non-super_owner 403, unknown tenant 404, missing tenantId 400 — never a maintenance answer", async () => {
    await seed({ bizA: QUIESCED }); const before = await readAll();
    globalThis.__CLAIMS = null; let r = await del(); eq(r.code, 401, "no auth");
    globalThis.__CLAIMS = { uid: "u_a", email: "a@x" }; r = await del(); eq(r.code, 403, "owner is not super_owner");
    globalThis.__CLAIMS = { uid: SUPER, email: "s@x" }; r = await del({ tenantId: "nope" }); eq(r.code, 404, "unknown tenant"); r = await del({}); eq(r.code, 400, "missing tenantId");
    eq(await readAll(), before, "database unchanged");
    return "401/403/404/400 unchanged";
  });
  await run("AM-H", "entry-exception guard still correct over the real transport: legacy/absent/v2_active admit (set → 200 with a ledger write); quiesced / recovery_hold / malformed → 423 and no ledger", async () => {
    const SET = { tenantId: T, bizId: "bizA", businessDate: "2026-08-10", reasonCode: "holiday", reasonText: "חג", expectedRevision: 0, operationId: "11111111-1111-4111-8111-000000000001" };
    for (const policies of [{}, { bizA: POL() }, { bizA: ACTIVE }]) {
      await seed(policies); globalThis.__CLAIMS = { uid: "u_a", email: "a@x" };
      const r = await call("set-entry-exception", SET); eq(r.code, 200, "admitted " + JSON.stringify(policies));
      expect((await seedDb().ref(`tenants/${T}/entry_exceptions/bizA`).once("value")).exists(), "ledger written");
    }
    for (const policies of [{ bizA: QUIESCED }, { bizA: HOLD }, { bizA: { policyRevision: 7 } }, { bizA: POL({ minStorageProtocol: 2.5 }) }]) {
      await seed(policies); globalThis.__CLAIMS = { uid: "u_a", email: "a@x" };
      const r = await call("set-entry-exception", SET); eq(r.code, 423, "refused " + JSON.stringify(policies));
      expect(!(await seedDb().ref(`tenants/${T}/entry_exceptions/bizA`).once("value")).exists(), "no ledger for " + JSON.stringify(policies));
    }
    return "3 admitted, 4 refused";
  });

  const w = (s, n) => String(s).padEnd(n).slice(0, n);
  console.log(`\n${w("case", 6)} ${w("status", 6)} notes`); console.log("-".repeat(110));
  for (const r of results) console.log(`${w(r.id, 6)} ${w(r.status, 6)} ${r.status === "PASS" ? r.notes : r.notes.split("\n")[0]}`);
  console.log("\n=== TOTALS ===");
  console.log(`total=${results.length} passed=${results.length - failures} failed=${failures}`);
  if (results.length !== 8) { process.exitCode = 3; return; }
  if (failures) { console.error("\n=== FAILURES ==="); for (const r of results.filter((x) => x.status === "FAIL")) console.error(`${r.id} ${r.description}\n    ${r.notes}`); process.exitCode = 1; return; }
  console.log("\nALL CASES PASSED — Admin maintenance gate holds over the real Admin transport");
}

const direct = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (direct) {
  main().then(async () => { await Promise.all(admin.apps.filter(Boolean).map((a) => a.delete().catch(() => {}))); })
        .catch(async (e) => { console.error("HARNESS ERROR:", (e && e.stack) || e); process.exitCode = 4; await Promise.all(admin.apps.filter(Boolean).map((a) => a.delete().catch(() => {}))); });
}
