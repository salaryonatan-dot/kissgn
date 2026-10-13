// Marjin — Agent/Daily integration I5 (exact identity; independent I4 review I4-R-01..03): the ACTUAL api/admin.js handler over the
// REAL local Admin SDK transport (firebase-admin → RTDB emulator, demo namespace). A padded business id is granted EXACTLY (never
// the trimmed business), a business ":" is refused before any grant, a non-string tenant id in the super_owner handlers is refused
// before any reference, Auth change or e-mail (resend-invite), and a tenant ":" stays valid — every `ref()` recorded, the database
// compared before / after over the real transport.
//
// Deliberately NOT named *.test.mjs. Host run: bash test/support/p1-r7-emu-run.sh <checkout> <abs logs> i5-exact-identity=test/emulator/i5-exact-identity-emulator.mjs

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
const dir = mkdtempSync(join(tmpdir(), "i5-exact-emu-"));
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

const app = admin.initializeApp({ databaseURL: DB_URL, projectId: PROJECT }, "i5-exact-" + process.pid);
const db = app.database();
const REFS = [];
const recording = () => ({ ref: (p) => { REFS.push(p === undefined ? "(root)" : p); return db.ref(p); } });
const env = (v) => ({ _v: JSON.stringify(v) });
const T = "tenantI5";
const fixture = () => ({
  tenants: {
    [T]: { members: { u_own: true, u_super: true, u_sub: true }, roles: { u_own: "owner", u_super: "super_owner", u_sub: "viewer" }, biz_access: { bizA: { u_sub: true } },
      app: { business: env([{ id: "bizA", name: "Alpha" }, { id: "bizB", name: "Beta" }, { id: " bizB ", name: "Padded" }]), users: env([{ role: "owner", name: "Owner", email: "own@example.test", username: "own", firebaseUid: "u_own" }, { role: "viewer", name: "Sub", email: "sub@example.test", username: "sub", firebaseUid: "u_sub", allowedBizIds: ["bizA"] }]) },
      users: { u_sub: { username: "sub", name: "Sub", email: "sub@example.test", phone: "", role: "viewer", allowedBizIds: ["bizA"] } },
      meta: { inviteLink: "https://app.example.test/?login=1", createdAt: 1 } },
    "t:1": { members: { u_own: true }, roles: { u_own: "owner" }, app: { business: env([{ id: "bizA", name: "Colon tenant" }]) } },
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
const val = async (p) => (await db.ref(p).once("value")).val();

// I6 test-contract transition (T-I6-I5E01; user-access / M1 identity owners — independent I5 review I5-R-01): the fixture registers
// BOTH "bizB" and " bizB " — an ambiguous registry for either id under the M1 classifier — so I5's grant-success row was not
// authorization evidence. The exact grant is proven over a registry that registers " bizB " only; over the twin fixture the same
// request is refused (503 business_registry_ambiguous) with no Auth call and the database unchanged.
await run("I5E-01", "a padded business id is granted EXACTLY by create-user / update-user / roles over the real transport when it is registered — never the trimmed business; the twin registry refuses", async () => {
  for (const [action, body, uid] of [["create-user", { tenantId: T, email: "n@example.test", username: "nn", role: "viewer", allowedBizIds: [" bizB "] }, "u_new"],
    ["update-user", { tenantId: T, firebaseUid: "u_sub", allowedBizIds: [" bizB "] }, "u_sub"], ["roles", { tenantId: T, targetUid: "u_sub", role: "viewer", allowedBizIds: [" bizB "] }, "u_sub"]]) {
    await seed(); await db.ref(`tenants/${T}/app/business`).set(env([{ id: "bizA", name: "Alpha" }, { id: " bizB ", name: "Padded" }]));
    let r = await call(action, body); eq(r.code, 200, action + " " + JSON.stringify(r.body));
    eq([await val(`tenants/${T}/biz_access/ bizB /${uid}`), await val(`tenants/${T}/biz_access/bizB/${uid}`)], [true, null], action + ": exactly \" bizB \" granted");
    await seed(); const before = await readAll(); globalThis.__AUTH = [];
    r = await call(action, body); eq([r.code, r.body], [503, { error: "business_registry_ambiguous" }], action + " over the twin registry");
    eq(globalThis.__AUTH, [], action + ": no Auth call"); eq(await readAll(), before, action + ": database unchanged");
  }
  return "3 exact grants + 3 twin refusals";
});
await run("I5E-02", "business \":\" refused before any grant (allowedBizIds in create-user / update-user / roles; entry exceptions) — nothing written", async () => {
  for (const [action, body, method] of [["create-user", { tenantId: T, email: "n@example.test", username: "nn", role: "viewer", allowedBizIds: ["biz:B"] }],
    ["update-user", { tenantId: T, firebaseUid: "u_sub", email: "changed@example.test", allowedBizIds: ["biz:B"] }], ["roles", { tenantId: T, targetUid: "u_sub", role: "viewer", allowedBizIds: ["biz:B"] }],
    ["list-entry-exceptions", { tenantId: T, bizId: "biz:A", fromDate: "2026-10-01", toDate: "2026-10-02" }, "GET"]]) {
    await seed(); const before = await readAll(); REFS.length = 0; globalThis.__AUTH = [];
    const r = await call(action, body, "u_own", method);
    eq(r.code, 400, action); eq(globalThis.__AUTH, [], action + ": no Auth call"); eq(await readAll(), before, action + ": database unchanged");
    if (REFS.some((p) => String(p).includes("biz:"))) throw new Error(action + ": a reference carried the business id " + JSON.stringify(REFS));
  }
  return "4 refusals";
});
await run("I5E-03", "non-string tenant ids in edit-client / delete-client / resend-invite: 400, no reference, no Auth change, no invitation", async () => {
  for (const action of ["edit-client", "delete-client", "resend-invite"]) for (const tenantId of [[T], { a: 1 }, 7, "tenant.I5"]) {
    await seed(); const before = await readAll(); REFS.length = 0; globalThis.__AUTH = []; globalThis.__MAIL = [];
    const r = await call(action, { tenantId, bizName: "X" }, "u_super");
    eq([r.code, r.body], [400, { error: "invalid tenantId" }], `${action} ${JSON.stringify(tenantId)}`);
    eq([REFS, globalThis.__AUTH, globalThis.__MAIL], [[], [], []], action + ": no reference, Auth or e-mail"); eq(await readAll(), before, action + ": unchanged");
  }
  await seed(); const r = await call("resend-invite", { tenantId: T }, "u_super"); eq([r.code, globalThis.__MAIL.length], [200, 1], "a valid invitation still sends once");
  return "12 refusals + 1 invitation";
});
await run("I5E-04", "tenant \":\" stays valid over the real transport (create-user scoped to bizA in tenant t:1)", async () => {
  await seed(); const r = await call("create-user", { tenantId: "t:1", email: "c@example.test", username: "cc", role: "viewer", allowedBizIds: ["bizA"] });
  eq(r.code, 200, JSON.stringify(r.body)); eq(await val("tenants/t:1/biz_access/bizA/u_new"), true, "granted in t:1");
  return "t:1 accepted";
});

await app.delete();
for (const r of results) console.log(`${r.status} ${r.id} ${r.description}${r.notes ? " — " + String(r.notes).split("\n")[0] : ""}`);
console.log(failures ? `FAILED ${failures}` : "ALL CASES PASSED");
process.exit(failures ? 1 : 0);
