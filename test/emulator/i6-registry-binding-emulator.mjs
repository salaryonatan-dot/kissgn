// Marjin — Agent/Daily integration I6 (registry binding; independent I5 review I5-R-01..04): the ACTUAL api/admin.js handler and the
// ACTUAL lib/securityContext.js gate over the REAL local Admin SDK transport (firebase-admin → RTDB emulator, demo namespace). A
// grant is written only for an authoritatively registered exact business id (a plain / padded twin, an unregistered id or an
// absent registry is refused with nothing written and no Auth call); update-user performs every read before the Auth e-mail
// change (local injected read / write failures on the real transport's references); the shared gate refuses a business ":" before
// any reference and the registered variant serves only `registered`; tenant ":" stays valid — every `ref()` recorded.
//
// Deliberately NOT named *.test.mjs. Host run: bash test/support/p1-r7-emu-run.sh <checkout> <abs logs> i6-registry-binding=test/emulator/i6-registry-binding-emulator.mjs

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
const dir = mkdtempSync(join(tmpdir(), "i6-registry-emu-"));
cpSync(join(ROOT, "lib"), join(dir, "lib"), { recursive: true });
cpSync(join(ROOT, "fincore", "v1"), join(dir, "fincore", "v1"), { recursive: true });
mkdirSync(join(dir, "api"), { recursive: true });
cpSync(join(ROOT, "api", "admin.js"), join(dir, "api", "admin.js"));
symlinkSync(join(ROOT, "node_modules"), join(dir, "node_modules"), "dir");
writeFileSync(join(dir, "lib", "adminSdk.js"), `export function getAdminDb() { return globalThis.__DB(); }\nexport function getAdminAuth() { const c = (globalThis.__AUTH ||= []); const st = (globalThis.__AUTHSTATE ||= {}); return { getUser: async (u) => (c.push(["getUser", u]), { uid: u, email: st[u] || "x@example.test" }), createUser: async (o) => (c.push(["createUser", o.email]), { uid: "u_new" }), updateUser: async (u, o) => { c.push(["updateUser", u, o && o.email]); if (globalThis.__AUTHFAIL && globalThis.__AUTHFAIL(u, o)) throw Object.assign(new Error("injected Auth failure"), { code: "auth/internal-error" }); if (o && o.email) st[u] = o.email; return { uid: u }; }, deleteUser: async (u) => { c.push(["deleteUser", u]); } }; }\n`);
writeFileSync(join(dir, "lib", "verifyToken.js"), `export async function requireAuth() { if (!globalThis.__CLAIMS) throw new Error("no auth"); return globalThis.__CLAIMS; }\nexport async function verifyToken() { return globalThis.__CLAIMS; }\n`);
writeFileSync(join(dir, "lib", "sendEmail.js"), `export async function sendEmail() { (globalThis.__MAIL ||= []).push(1); return { messageId: "m" }; }\nexport async function sendAlertDigest() { return { messageId: "d" }; }\n`);
const handler = (await import(pathToFileURL(join(dir, "api", "admin.js")).href)).default;
const SC = await import(pathToFileURL(join(dir, "lib", "securityContext.js")).href);

const app = admin.initializeApp({ databaseURL: DB_URL, projectId: PROJECT }, "i6-registry-" + process.pid);
const db = app.database();
const REFS = [];
const FAIL = new Map();   // path → "read" | "write": a local injected failure on the real transport's reference
const recording = () => ({ ref: (p) => {
  REFS.push(p === undefined ? "(root)" : p);
  const r = db.ref(p);
  const mode = FAIL.get(p === undefined ? "(root)" : p);
  if (!mode) return r;
  return new Proxy(r, { get(t, k) {
    if (mode === "read" && (k === "once" || k === "get")) return async () => { throw new Error("local injected read failure"); };
    if (mode === "write" && k === "update") return async () => { throw new Error("local injected write failure"); };
    const v = t[k]; return typeof v === "function" ? v.bind(t) : v;
  } });
} });
const env = (v) => ({ _v: JSON.stringify(v) });
const T = "tenantI6";
// roles is rate-limited (5 / min per IP and per uid, the real in-memory limiter): its calls rotate over equivalent owners and IPs
const ROT = Array.from({ length: 12 }, (_, i) => "u_ownr" + i);
const ROT_OWNERS = (v) => Object.fromEntries(ROT.map((u) => [u, v]));
let rot = 0;
const REGS = {
  soleplain: env([{ id: "bizA", name: "Alpha" }, { id: "bizB", name: "Beta" }]),
  solepadded: env([{ id: "bizA", name: "Alpha" }, { id: " bizB ", name: "Padded" }]),
  twin: env([{ id: "bizA", name: "Alpha" }, { id: " bizB ", name: "Padded" }, { id: "bizB", name: "Beta" }]),
};
const fixture = (business = REGS.soleplain) => ({
  tenants: {
    [T]: { members: { u_own: true, u_sub: true, u_other: true, ...ROT_OWNERS(true) }, roles: { u_own: "owner", u_sub: "viewer", u_other: "viewer", ...ROT_OWNERS("owner") }, biz_access: { bizA: { u_sub: true, u_other: true } },
      app: { ...(business === null ? {} : { business }), users: env([{ role: "owner", name: "Owner", email: "own@example.test", username: "own", firebaseUid: "u_own" }, { role: "viewer", name: "Sub", email: "sub@example.test", username: "sub", firebaseUid: "u_sub", allowedBizIds: ["bizA"] }, { role: "viewer", name: "Other", email: "other@example.test", username: "other", firebaseUid: "u_other", allowedBizIds: ["bizA"] }]) },
      users: { u_sub: { username: "sub", name: "Sub", email: "sub@example.test", phone: "", role: "viewer", allowedBizIds: ["bizA"] } },
      lookup: { sub: { email: "sub@example.test", firebaseUid: "u_sub" } } },
    "t:1": { members: { u_own: true }, roles: { u_own: "owner" }, app: { business: env([{ id: "bizA", name: "Colon tenant" }]) } },
  },
  user_tenants: { u_own: T, u_sub: T },
  username_index: { sub: { tenantId: T, email: "sub@example.test" } },
});
async function seed(business) { await db.ref("/").set(fixture(business)); globalThis.__DB = recording; globalThis.__AUTH = []; globalThis.__AUTHSTATE = { u_sub: "sub@example.test" }; globalThis.__AUTHFAIL = null; globalThis.__MAIL = []; REFS.length = 0; FAIL.clear(); }
const readAll = async () => JSON.stringify((await db.ref("/").once("value")).val());
async function call(action, body, uid = "u_own", method = "POST") {
  const n = rot++;
  if (action === "roles" && uid === "u_own") uid = ROT[n % ROT.length];
  globalThis.__CLAIMS = uid ? { uid, email: uid + "@example.test" } : null;
  const r = { code: null, body: null, setHeader() {}, status(n) { this.code = n; return this; }, json(v) { this.body = v; return this; }, end() { return this; } };
  await handler({ method, query: { action, ...(method === "GET" ? body : {}) }, headers: { authorization: "Bearer t", "x-forwarded-for": "198.51.100." + (10 + (n % 200)) }, body: method === "GET" ? {} : body }, r);
  return { code: r.code, body: r.body };
}

const results = []; let failures = 0;
async function run(id, description, fn) {
  try { const n = await fn(); results.push({ id, status: "PASS", description, notes: n || "" }); }
  catch (e) { failures++; results.push({ id, status: "FAIL", description, notes: (e && e.stack) || String(e) }); }
}
const eq = (a, b, m) => { const x = JSON.stringify(a), y = JSON.stringify(b); if (x !== y) throw new Error(`${m}: expected ${y}, got ${x}`); };
const val = async (p) => (await db.ref(p).once("value")).val();
const WRITERS = [["create-user", (ids) => ({ tenantId: T, email: "n@example.test", username: "nn", role: "viewer", allowedBizIds: ids }), "u_new"],
  ["update-user", (ids) => ({ tenantId: T, firebaseUid: "u_sub", email: "changed@example.test", allowedBizIds: ids }), "u_sub"],
  ["roles", (ids) => ({ tenantId: T, targetUid: "u_sub", role: "manager", allowedBizIds: ids }), "u_sub"]];

await run("I6E-01", "grant writers over the real transport: a registered exact id is granted; twin / unregistered / absent registry refused with nothing written and no Auth call", async () => {
  let n = 0;
  for (const [action, body, uid] of WRITERS) {
    await seed(REGS.solepadded); let r = await call(action, body([" bizB "])); eq(r.code, 200, action + " registered padded " + JSON.stringify(r.body));
    eq([await val(`tenants/${T}/biz_access/ bizB /${uid}`), await val(`tenants/${T}/biz_access/bizB/${uid}`), await val(`tenants/${T}/biz_access/bizA/u_other`)], [true, null, true], action + ": exact grant; another user untouched");
    for (const [reg, ids, code, error] of [[REGS.twin, [" bizB "], 503, "business_registry_ambiguous"], [REGS.twin, ["bizB"], 503, "business_registry_ambiguous"], [REGS.soleplain, [" bizB "], 503, "business_registry_ambiguous"],
      [REGS.soleplain, ["bizZ"], 403, "business_not_in_tenant"], [null, ["bizA"], 503, "business_registry_unreadable"]]) {
      await seed(reg); const before = await readAll();
      r = await call(action, body(ids)); eq([r.code, r.body], [code, { error }], `${action} ${JSON.stringify(ids)}`);
      eq(globalThis.__AUTH, [], action + ": no Auth call"); eq(await readAll(), before, action + ": database unchanged"); n++;
    }
  }
  return n + " refusals + 3 exact grants";
});
await run("I6E-02", "update-user over the real transport: an injected biz_access / registry / app/users read failure happens BEFORE the Auth e-mail change; the retry aligns Auth and RTDB", async () => {
  for (const [path, code] of [[`tenants/${T}/biz_access`, 500], [`tenants/${T}/app/business`, 503], [`tenants/${T}/app/users`, 500]]) {
    await seed(); const before = await readAll(); FAIL.set(path, "read");
    let r = await call("update-user", WRITERS[1][1](["bizB"])); eq(r.code, code, path + " " + JSON.stringify(r.body));
    eq([globalThis.__AUTH, globalThis.__AUTHSTATE.u_sub, await readAll()], [[], "sub@example.test", before], path + ": no Auth change, database unchanged");
    FAIL.clear(); r = await call("update-user", WRITERS[1][1](["bizB"])); eq(r.code, 200, path + " retry");
    eq([globalThis.__AUTHSTATE.u_sub, await val(`tenants/${T}/users/u_sub/email`), JSON.parse((await val(`tenants/${T}/app/users`))._v).find((u) => u.firebaseUid === "u_sub").email], ["changed@example.test", "changed@example.test", "changed@example.test"], path + ": Auth = users = app/users after the retry");
    eq([await val(`tenants/${T}/biz_access/bizB/u_sub`), await val(`tenants/${T}/biz_access/bizA/u_sub`), await val(`tenants/${T}/biz_access/bizA/u_other`)], [true, null, true], path + ": target-only revocation");
  }
  // the final atomic write fails: revert succeeds → aligned; revert fails → the documented divergence, re-converged by a retry
  await seed(); FAIL.set("(root)", "write"); let r = await call("update-user", WRITERS[1][1](["bizB"])); eq(r.code, 500, "write failure");
  eq([globalThis.__AUTHSTATE.u_sub, await val(`tenants/${T}/users/u_sub/email`)], ["sub@example.test", "sub@example.test"], "reverted: aligned");
  await seed(); FAIL.set("(root)", "write"); globalThis.__AUTHFAIL = (u, o) => o && o.email === "sub@example.test";
  r = await call("update-user", WRITERS[1][1](["bizB"])); eq(r.code, 500, "write + revert failure");
  eq([globalThis.__AUTHSTATE.u_sub, await val(`tenants/${T}/users/u_sub/email`)], ["changed@example.test", "sub@example.test"], "documented residual: Auth new, RTDB old");
  FAIL.clear(); globalThis.__AUTHFAIL = null; r = await call("update-user", WRITERS[1][1](["bizB"])); eq(r.code, 200, "retry");
  eq([globalThis.__AUTHSTATE.u_sub, await val(`tenants/${T}/users/u_sub/email`)], ["changed@example.test", "changed@example.test"], "re-converged");
  return "3 read faults + 2 write faults";
});
await run("I6E-03", "the shared gate over the real transport: business \":\" refused before any reference; requireRegisteredBizContext reads the registry once and serves only `registered`", async () => {
  const deps = (role, uid = "u_sub") => ({ requireAuth: async () => ({ uid, email: null }), requireTenantAccess: async () => role, getDb: async () => recording() });
  const go = async (fn, tenantId, bizId, role) => { REFS.length = 0; try { const c = await fn({ headers: {} }, { tenantId, bizId, mode: "read" }, deps(role)); return { ok: true, bizId: c.bizId, refs: [...REFS] }; } catch (e) { return { ok: false, status: e.status, msg: e.msg, refs: [...REFS] }; } };
  await seed(REGS.solepadded); await db.ref(`tenants/${T}/biz_access/ bizB /u_sub`).set(true); await db.ref(`tenants/${T}/biz_access/bizZ/u_sub`).set(true);
  for (const fn of [SC.requireBizContext, SC.requireRegisteredBizContext]) for (const b of ["biz:A", ":", "bizA:"]) eq(await go(fn, T, b, "owner"), { ok: false, status: 400, msg: "invalid bizId", refs: [] }, "colon " + b);
  eq((await go(SC.requireRegisteredBizContext, T, " bizB ", "viewer")).ok, true, "registered padded");
  eq(await go(SC.requireRegisteredBizContext, T, "bizB", "owner"), { ok: false, status: 503, msg: "business_registry_ambiguous", refs: [`tenants/${T}/app/business`] }, "plain id beside the padded record");
  eq(await go(SC.requireRegisteredBizContext, T, "bizZ", "viewer"), { ok: false, status: 403, msg: "business_not_in_tenant", refs: [`tenants/${T}/biz_access/bizZ/u_sub`, `tenants/${T}/app/business`] }, "stale grant");
  eq((await go(SC.requireBizContext, "t:1", "bizA", "owner")).ok, true, "tenant colon valid");
  return "gate rows";
});
await run("I6E-04", "tenant \":\" stays valid and a registered padded grant persists exactly over the real transport", async () => {
  await seed(); let r = await call("create-user", { tenantId: "t:1", email: "c@example.test", username: "cc", role: "viewer", allowedBizIds: ["bizA"] });
  eq(r.code, 200, JSON.stringify(r.body)); eq(await val("tenants/t:1/biz_access/bizA/u_new"), true, "granted in t:1");
  await seed(REGS.solepadded); r = await call("roles", { tenantId: T, targetUid: "u_sub", role: "viewer", allowedBizIds: [" bizB ", "bizA"] }); eq(r.code, 200);
  eq(Object.keys((await val(`tenants/${T}/biz_access`)) || {}).sort(), [" bizB ", "bizA"].sort(), "exactly the two registered ids");
  return "t:1 accepted; exact padded grant persisted";
});

await app.delete();
for (const r of results) console.log(`${r.status} ${r.id} ${r.description}${r.notes ? " — " + String(r.notes).split("\n")[0] : ""}`);
console.log(failures ? `FAILED ${failures}` : "ALL CASES PASSED");
process.exit(failures ? 1 : 0);
