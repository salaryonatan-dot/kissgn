// Marjin — Agent/Daily integration I4 (M1 D-CTRL application boundaries): the ACTUAL api/admin.js handler and helpers over the
// REAL local Admin SDK transport (firebase-admin → RTDB emulator, demo namespace). The Admin SDK bypasses Rules, so this proves
// the application-level refusal itself: a tenant / business identifier carrying U+0000–U+001F or U+007F is answered 400 with
// NO Admin reference constructed (every `ref()` the application asks for is recorded) and NOTHING read or written, while the
// same requests without the control character keep their ordinary outcome and persist over the real transport.
//
// Deliberately NOT named *.test.mjs. Host run: bash test/support/p1-r7-emu-run.sh <checkout> <abs logs> i4-boundary=test/emulator/i4-boundary-emulator.mjs

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
  if (process.env.UPSTASH_REDIS_REST_URL || process.env.UPSTASH_REDIS_REST_TOKEN) fail("Upstash variables must be absent (the in-memory limiter is used)");
}
assertSafe();

// the real handler + helpers with ONLY the Admin-construction / token / e-mail / Auth seams replaced; the DB is the real transport
const dir = mkdtempSync(join(tmpdir(), "i4-boundary-emu-"));
cpSync(join(ROOT, "lib"), join(dir, "lib"), { recursive: true });
cpSync(join(ROOT, "fincore", "v1"), join(dir, "fincore", "v1"), { recursive: true });
mkdirSync(join(dir, "api"), { recursive: true });
cpSync(join(ROOT, "api", "admin.js"), join(dir, "api", "admin.js"));
symlinkSync(join(ROOT, "node_modules"), join(dir, "node_modules"), "dir");
writeFileSync(join(dir, "lib", "adminSdk.js"), `export function getAdminDb() { return globalThis.__DB(); }\nexport function getAdminAuth() { const c = (globalThis.__AUTH ||= []); return { getUser: async (u) => (c.push(["getUser", u]), { uid: u, email: "x@example.test" }), createUser: async (o) => (c.push(["createUser", o.email]), { uid: "u_new" }), updateUser: async (u, o) => (c.push(["updateUser", u]), { uid: u }), deleteUser: async (u) => { c.push(["deleteUser", u]); } }; }\n`);
writeFileSync(join(dir, "lib", "verifyToken.js"), `export async function requireAuth() { if (!globalThis.__CLAIMS) throw new Error("no auth"); return globalThis.__CLAIMS; }\nexport async function verifyToken() { return globalThis.__CLAIMS; }\n`);
writeFileSync(join(dir, "lib", "sendEmail.js"), `export async function sendEmail() { (globalThis.__MAIL ||= []).push(1); return { messageId: "m" }; }\nexport async function sendAlertDigest() { return { messageId: "d" }; }\n`);
const handler = (await import(pathToFileURL(join(dir, "api", "admin.js")).href)).default;
const registry = await import(pathToFileURL(join(dir, "lib", "businessRegistry.js")).href);

const app = admin.initializeApp({ databaseURL: DB_URL, projectId: PROJECT }, "i4-boundary-" + process.pid);
const db = app.database();
const REFS = [];
const recording = () => ({ ref: (p) => { REFS.push(p === undefined ? "(root)" : p); return db.ref(p); } });
const env = (v) => ({ _v: JSON.stringify(v) });
const T = "tenantI4";
const fixture = () => ({
  tenants: {
    [T]: { members: { u_own: true, u_super: true, u_sub: true }, roles: { u_own: "owner", u_super: "super_owner", u_sub: "viewer" }, biz_access: { bizA: { u_sub: true } },
      app: { business: env([{ id: "bizA", name: "Alpha" }, { id: "bizB", name: "Beta" }]), users: env([{ role: "owner", name: "Owner", email: "own@example.test", username: "own", firebaseUid: "u_own" }, { role: "viewer", name: "Sub", email: "sub@example.test", username: "sub", firebaseUid: "u_sub", allowedBizIds: ["bizA"] }]) },
      users: { u_sub: { username: "sub", name: "Sub", email: "sub@example.test", phone: "", role: "viewer", allowedBizIds: ["bizA"] } },
      meta: { inviteLink: "https://app.example.test/?login=1", createdAt: 1 } },
  },
  user_tenants: { u_own: T, u_sub: T },
});
async function seed() { await db.ref("/").set(fixture()); globalThis.__DB = recording; globalThis.__AUTH = []; globalThis.__MAIL = []; REFS.length = 0; }
const readAll = async () => JSON.stringify((await db.ref("/").once("value")).val());
async function call(action, body, uid = "u_own", method = "POST") {
  globalThis.__CLAIMS = uid ? { uid, email: uid + "@example.test" } : null;
  const r = { code: null, body: null, setHeader() {}, status(n) { this.code = n; return this; }, json(v) { this.body = v; return this; }, end() { return this; } };
  await handler({ method, query: { action, ...(method === "GET" ? body : {}) }, headers: { authorization: "Bearer t", "x-forwarded-for": "198.51.100.9" }, body: method === "GET" ? {} : body }, r);
  return { code: r.code, body: r.body };
}

const results = []; let failures = 0;
async function run(id, description, fn) {
  try { const n = await fn(); results.push({ id, status: "PASS", description, notes: n || "" }); }
  catch (e) { failures++; results.push({ id, status: "FAIL", description, notes: (e && e.stack) || String(e) }); }
}
const eq = (a, b, m) => { const x = JSON.stringify(a), y = JSON.stringify(b); if (x !== y) throw new Error(`${m}: expected ${y}, got ${x}`); };
const CTRL = ["\u0000", "\u0001", "\t", "\n", "\r", "\u001f", "\u007f"];

async function refused(action, body, uid, expected, method = "POST") {
  await seed(); const before = await readAll(); REFS.length = 0; globalThis.__AUTH = [];
  const r = await call(action, body, uid, method);
  eq([r.code, r.body], [400, expected], `${action} ${JSON.stringify(body)}`);
  eq(REFS, [], `${action}: no Admin reference constructed`);
  eq(globalThis.__AUTH, [], `${action}: no Auth call`);
  eq(await readAll(), before, `${action}: database unchanged over the real transport`);
}

await run("I4E-01", "super_owner edit-client / delete-client / resend-invite: control tenant → 400 invalid tenantId, no reference, nothing read or written", async () => {
  for (const c of CTRL) for (const action of ["edit-client", "delete-client", "resend-invite"]) await refused(action, { tenantId: T + c, bizName: "X" }, "u_super", { error: "invalid tenantId" });
  return `${CTRL.length * 3} refusals`;
});
await run("I4E-02", "roles / create-user / update-user / delete-user / bootstrap-self / entry exceptions: control tenant or business → each handler's own 400, no reference", async () => {
  for (const c of CTRL) {
    await refused("roles", { tenantId: T + c, targetUid: "u_sub", role: "manager" }, "u_own", { error: "invalid tenantId" });
    await refused("roles", { tenantId: T, targetUid: "u_sub", role: "viewer", allowedBizIds: ["bizB" + c] }, "u_own", { error: "invalid bizId in allowedBizIds" });
    await refused("create-user", { tenantId: T + c, email: "n@example.test", username: "nn", role: "viewer" }, "u_own", { error: "invalid characters in id" });
    await refused("create-user", { tenantId: T, email: "n@example.test", username: "nn", role: "viewer", allowedBizIds: [c + "bizB"] }, "u_own", { error: "invalid bizId in allowedBizIds" });
    await refused("update-user", { tenantId: T, firebaseUid: "u_sub", email: "changed@example.test", allowedBizIds: ["bizB" + c] }, "u_own", { error: "invalid bizId in allowedBizIds" });
    await refused("delete-user", { tenantId: T + c, firebaseUid: "u_sub" }, "u_own", { error: "invalid tenantId or firebaseUid" });
    await refused("bootstrap-self", { tenantId: T + c }, "u_new", { error: "invalid tenantId" });
    await refused("list-entry-exceptions", { tenantId: T, bizId: "bizA" + c, fromDate: "2026-10-01", toDate: "2026-10-02" }, "u_own", { error: "invalid tenantId or bizId" }, "GET");
  }
  return `${CTRL.length * 8} refusals`;
});
await run("I4E-03", "readRegistryTarget over the real transport: control tenant → invalid_request with no reference; a valid tenant still classifies", async () => {
  await seed(); REFS.length = 0;
  eq(await registry.readRegistryTarget(recording(), T + "\u0001", "bizA"), { state: "invalid_request" }, "control tenant"); eq(REFS, [], "no reference");
  eq((await registry.readRegistryTarget(recording(), T, "bizA")).state, "registered", "valid tenant"); eq(REFS, [`tenants/${T}/app/business`], "one reference");
  return "invalid_request / registered";
});
await run("I4E-04", "non-control requests keep their outcome and persist over the real transport (edit-client, create-user scope, roles scope, update-user scope)", async () => {
  await seed(); let r = await call("edit-client", { tenantId: T, bizName: "Renamed" }, "u_super"); eq(r.code, 200, "edit-client");
  eq(JSON.parse((await db.ref(`tenants/${T}/app/business`).once("value")).val()._v)[0].name, "Renamed", "persisted");
  await seed(); r = await call("create-user", { tenantId: T, email: "n@example.test", username: "nn", role: "viewer", allowedBizIds: ["bizB"] }); eq(r.code, 200, "create-user");
  eq((await db.ref(`tenants/${T}/biz_access/bizB/u_new`).once("value")).val(), true, "scope persisted");
  await seed(); r = await call("roles", { tenantId: T, targetUid: "u_sub", role: "manager", allowedBizIds: ["bizB"] }); eq(r.code, 200, "roles " + JSON.stringify(r.body));
  eq([(await db.ref(`tenants/${T}/biz_access/bizB/u_sub`).once("value")).val(), (await db.ref(`tenants/${T}/biz_access/bizA/u_sub`).once("value")).val()], [true, null], "scope moved");
  // I5 test-contract transition (T-I5-TEST; was: the padded entry is trimmed and bizB granted — the inherited alias the independent
  // I4 review found, I4-R-01): the padded entry is its own identity and is granted exactly; bizB is not granted.
  await seed(); r = await call("update-user", { tenantId: T, firebaseUid: "u_sub", allowedBizIds: [" bizB "] }); eq(r.code, 200, "update-user (padded entry)");
  eq([(await db.ref(`tenants/${T}/biz_access/ bizB /u_sub`).once("value")).val(), (await db.ref(`tenants/${T}/biz_access/bizB/u_sub`).once("value")).val()], [true, null], "padded entry granted exactly, never trimmed into bizB");
  return "4 flows persisted";
});

await app.delete();
for (const r of results) console.log(`${r.status} ${r.id} ${r.description}${r.notes ? " — " + String(r.notes).split("\n")[0] : ""}`);
console.log(failures ? `FAILED ${failures}` : "ALL CASES PASSED");
process.exit(failures ? 1 : 0);
