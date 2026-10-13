// Marjin — Agent/Daily integration I7 (independent I6 review I6-R-02 / I6-R-04): the ACTUAL api/admin.js handler over the REAL local
// Admin SDK transport (firebase-admin → RTDB emulator, demo namespace). Admin-local business data (entry exceptions, checklist template /
// run / simple run, analytics / insights daily — real ordered range queries) is served only for an authoritatively registered exact
// business and refused with nothing read or written otherwise; update-user leaves every outcome it can establish aligned and records
// the rest — every `ref()` recorded. (The operator backfill, I6-R-03, is NOT part of I7: see the package's BACKFILL_GATE.md and its
// proposed lane, proposed/backfill-registry-gate.patch, with its own emulator script.)
//
// Deliberately NOT named *.test.mjs. Host run: bash test/support/p1-r7-emu-run.sh <checkout> <abs logs> i7-integration=test/emulator/i7-integration-emulator.mjs

import admin from "firebase-admin";
import { mkdtempSync, writeFileSync, cpSync, mkdirSync, symlinkSync } from "node:fs";
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
const dir = mkdtempSync(join(tmpdir(), "i7-integration-emu-"));
cpSync(join(ROOT, "lib"), join(dir, "lib"), { recursive: true });
cpSync(join(ROOT, "fincore", "v1"), join(dir, "fincore", "v1"), { recursive: true });
mkdirSync(join(dir, "api"), { recursive: true });
cpSync(join(ROOT, "api", "admin.js"), join(dir, "api", "admin.js"));
symlinkSync(join(ROOT, "node_modules"), join(dir, "node_modules"), "dir");
// a STATEFUL Auth: updateUser moves the stored e-mail unless __AUTHMODE says otherwise; getUser returns it or fails
writeFileSync(join(dir, "lib", "adminSdk.js"), `export function getAdminDb() { return globalThis.__DB(); }
export function getAdminAuth() {
  const c = (globalThis.__AUTH ||= []); const st = (globalThis.__AUTHSTATE ||= {}); const m = () => globalThis.__AUTHMODE || {};
  const err = (msg, code = "auth/internal-error") => Object.assign(new Error(msg), { code });
  return {
    getUser: async (u) => { c.push(["getUser", u]); if (m().getUser === "fail") throw err("injected getUser failure"); return { uid: u, email: st[u] || "x@example.test" }; },
    createUser: async (o) => (c.push(["createUser", o.email]), { uid: "u_new" }),
    updateUser: async (u, o) => {
      c.push(["updateUser", u, o && o.email]);
      const toOld = o && o.email === m().old;
      if (!toOld && m().newMode === "reject") throw err("injected rejection");
      if (toOld && m().revertMode === "reject") throw err("injected revert rejection");
      if (o && o.email) st[u] = o.email;
      if (!toOld && m().newMode === "applied-then-error") throw err("deadline exceeded", "ETIMEDOUT");
      if (toOld && m().revertMode === "applied-then-error") throw err("revert deadline exceeded", "ETIMEDOUT");
      return { uid: u };
    },
    deleteUser: async (u) => { c.push(["deleteUser", u]); },
  };
}\n`);
writeFileSync(join(dir, "lib", "verifyToken.js"), `export async function requireAuth() { if (!globalThis.__CLAIMS) throw new Error("no auth"); return globalThis.__CLAIMS; }\nexport async function verifyToken() { return globalThis.__CLAIMS; }\n`);
writeFileSync(join(dir, "lib", "sendEmail.js"), `export async function sendEmail() { (globalThis.__MAIL ||= []).push(1); return { messageId: "m" }; }\nexport async function sendAlertDigest() { return { messageId: "d" }; }\n`);
const handler = (await import(pathToFileURL(join(dir, "api", "admin.js")).href)).default;
const { checklistVersionToken } = await import(pathToFileURL(join(ROOT, "lib", "checklistVersion.js")).href);

const app = admin.initializeApp({ databaseURL: DB_URL, projectId: PROJECT }, "i7-integration-" + process.pid);
const db = app.database();
const REFS = [];
const FAIL = new Map();   // path → "read" | "write"
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
const T = "tenantI7", FROM = "2026-10-01", TO = "2026-10-02";
const DOC = { fixtureSecret: "business-data" };
const REGS = {
  registered: env([{ id: "bizA", name: "Alpha" }, { id: "bizB", name: "Beta" }]),
  twin: env([{ id: "bizA" }, { id: " bizA " }, { id: "bizB" }]),
  unregistered: env([{ id: "bizB" }]),
  bareArray: [{ id: "bizA" }, { id: "bizB" }],
};
const fixture = (business = REGS.registered) => ({
  tenants: {
    [T]: {
      members: { u_own: true, u_mgr: true, u_view: true, u_sub: true }, roles: { u_own: "owner", u_mgr: "manager", u_view: "viewer", u_sub: "viewer" },
      biz_access: { bizA: { u_mgr: true, u_view: true, u_sub: true } },
      app: { ...(business === null ? {} : { business }), users: env([{ role: "owner", name: "Owner", email: "own@example.test", username: "own", firebaseUid: "u_own" },
        { role: "viewer", name: "Sub", email: "sub@example.test", username: "sub", firebaseUid: "u_sub", allowedBizIds: ["bizA"] },
        { role: "manager", name: "Mgr", email: "mgr@example.test", username: "mgr", firebaseUid: "u_mgr", allowedBizIds: ["bizA"] }]) },
      users: { u_sub: { username: "sub", name: "Sub", email: "sub@example.test", phone: "", role: "viewer", allowedBizIds: ["bizA"] } },
      lookup: { sub: { email: "sub@example.test", firebaseUid: "u_sub" } },
      "biz:bizA:checklist_template_items:t1": env(DOC), [`biz:bizA:checklist_runs:${FROM}`]: env(DOC), [`biz:bizA:checklist_simple_runs:${FROM}:t1`]: env(DOC),
      [`biz:bizA:analytics:daily:${FROM}`]: env({ revenue: { total: 1 } }), [`biz:bizA:insights:daily:${FROM}`]: env({ items: [] }),
    },
  },
  user_tenants: { u_own: T, u_sub: T },
  username_index: { sub: { tenantId: T, email: "sub@example.test" } },
});
async function seed(business) { await db.ref("/").set(fixture(business)); globalThis.__DB = recording; globalThis.__AUTH = []; globalThis.__AUTHSTATE = { u_sub: "sub@example.test" }; globalThis.__AUTHMODE = null; globalThis.__MAIL = []; REFS.length = 0; FAIL.clear(); }
const readAll = async () => JSON.stringify((await db.ref("/").once("value")).val());
let rot = 0;
async function call(action, body, uid = "u_own", method = "POST") {
  const n = rot++;
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
const TOKEN = checklistVersionToken(DOC);
const OP = (n) => `11111111-1111-4111-8111-${String(n).padStart(12, "0")}`;
const ACTIONS = [
  ["list-entry-exceptions", "GET", (b) => ({ tenantId: T, bizId: b, fromDate: FROM, toDate: TO }), "u_view"],
  ["set-entry-exception", "POST", (b) => ({ tenantId: T, bizId: b, businessDate: FROM, reasonCode: "holiday", reasonText: "x", expectedRevision: 0, operationId: OP(1) }), "u_mgr"],
  ["get-checklist-template-items", "GET", (b) => ({ tenantId: T, bizId: b, templateId: "t1" }), "u_view"],
  ["set-checklist-template-items", "POST", (b) => ({ tenantId: T, bizId: b, templateId: "t1", doc: { fixtureSecret: "overwritten" }, expectedVersionToken: TOKEN }), "u_mgr"],
  ["get-checklist-run", "GET", (b) => ({ tenantId: T, bizId: b, businessDate: FROM }), "u_view"],
  ["set-checklist-run", "POST", (b) => ({ tenantId: T, bizId: b, businessDate: FROM, doc: { fixtureSecret: "overwritten" }, expectedVersionToken: TOKEN }), "u_mgr"],
  ["get-checklist-simple-run", "GET", (b) => ({ tenantId: T, bizId: b, businessDate: FROM, templateId: "t1" }), "u_view"],
  ["set-checklist-simple-run", "POST", (b) => ({ tenantId: T, bizId: b, businessDate: FROM, templateId: "t1", doc: { fixtureSecret: "overwritten" }, expectedVersionToken: TOKEN }), "u_mgr"],
  ["get-analytics-daily", "GET", (b) => ({ tenantId: T, bizId: b, fromDate: FROM, toDate: TO }), "u_view"],
  ["get-insights-daily", "GET", (b) => ({ tenantId: T, bizId: b, fromDate: FROM, toDate: TO }), "u_view"],
];
const isData = (r) => /biz:bizA:|entry_exceptions|storage_v2_control/.test(r) || r === `tenants/${T}`;

await run("I7E-01", "Admin-local business data over the real transport: served for a registered exact business (real ordered range queries); absent / bare-array / twin / unregistered registry refused with no business-data reference and nothing written", async () => {
  let served = 0, refused = 0;
  for (const [action, method, body, actor] of ACTIONS) {
    await seed(REGS.registered);
    // the guarded checklist write is an RTDB transaction that aborts on the SDK's cold-cache first pass (pre-existing, outside I7:
    // I7E-O1 below); a value listener on the target warms the cache so the registered path's real write can be observed
    const target = /^set-checklist/.test(action) ? `tenants/${T}/biz:bizA:${action === "set-checklist-template-items" ? "checklist_template_items:t1" : action === "set-checklist-run" ? "checklist_runs:" + FROM : "checklist_simple_runs:" + FROM + ":t1"}` : null;
    const warm = target ? db.ref(target).on("value", () => {}) : null;
    if (target) await new Promise((x) => setTimeout(x, 200));
    let r = await call(action, body("bizA"), actor, method); eq(r.code, 200, `${action} registered ${JSON.stringify(r.body)}`);
    if (target) db.ref(target).off("value", warm);
    if (/^get-checklist/.test(action)) eq(r.body.document, DOC, action);
    if (/-daily$/.test(action)) eq(Object.keys(r.body.docs), [FROM], action);
    if (target) eq((await val(target))._v, JSON.stringify({ fixtureSecret: "overwritten" }), action + " persisted");
    eq(REFS.filter((p) => p === `tenants/${T}/app/business`).length, 1, action + ": one registry read"); served++;
    for (const [label, reg, code, error] of [["absent", null, 503, "business_registry_unreadable"], ["bare array", REGS.bareArray, 503, "business_registry_unreadable"],
      ["twin", REGS.twin, 503, "business_registry_ambiguous"], ["unregistered (stale grant)", REGS.unregistered, 403, "business_not_in_tenant"]]) {
      await seed(reg); const before = await readAll();
      r = await call(action, body("bizA"), actor, method); eq([r.code, r.body], [code, { error }], `${action} ${label}`);
      eq(REFS.filter(isData), [], `${action} ${label}: no business-data reference`); eq(await readAll(), before, `${action} ${label}: nothing written`); refused++;
    }
  }
  return `${served} served, ${refused} refused`;
});

const UU = { tenantId: T, firebaseUid: "u_sub", email: "changed@example.test", allowedBizIds: ["bizA"] };
const emails = async () => [globalThis.__AUTHSTATE.u_sub, await val(`tenants/${T}/users/u_sub/email`), JSON.parse((await val(`tenants/${T}/app/users`))._v).find((u) => u.firebaseUid === "u_sub").email];
await run("I7E-02", "update-user over the real transport: Auth applied-then-error is undone; a revert that answered an error but applied is recognised; a refused revert is recorded as unconfirmed (true state: Auth new, records old)", async () => {
  const OLDE = "sub@example.test", NEWE = "changed@example.test";
  const lines = []; const prev = console.error; console.error = (...a) => lines.push(a.map(String).join(" "));
  try {
    await seed(); globalThis.__AUTHMODE = { old: OLDE, newMode: "applied-then-error" }; let before = await readAll();
    let r = await call("update-user", UU); eq(r.code, 500, "applied-then-error"); eq(await emails(), [OLDE, OLDE, OLDE], "applied-then-error: aligned (undone)"); eq(await readAll(), before, "records unchanged");
    await seed(); FAIL.set("(root)", "write"); globalThis.__AUTHMODE = { old: OLDE, revertMode: "applied-then-error" }; before = await readAll();
    r = await call("update-user", UU); eq(r.code, 500, "write failure"); eq(await emails(), [OLDE, OLDE, OLDE], "write failure + revert applied-then-error: aligned");
    eq(lines.filter((l) => /UNCONFIRMED/.test(l)).length, 0, "nothing unconfirmed so far");
    await seed(); FAIL.set("(root)", "write"); globalThis.__AUTHMODE = { old: OLDE, revertMode: "reject" };
    r = await call("update-user", UU); eq(r.code, 500, "write + refused revert");
    eq(await emails(), [NEWE, OLDE, OLDE], "residual recorded, not hidden: Auth new, records old");
    eq(lines.filter((l) => /UNCONFIRMED/.test(l) && /tenant tenantI7 uid u_sub/.test(l)).length, 1, "one UNCONFIRMED line naming tenant and uid");
  } finally { console.error = prev; }
  return "2 aligned outcomes + 1 recorded residual";
});

// OBSERVATION (pre-existing, outside I7; checklist owner) — reported, never gating, so a later correction does not turn this gate red:
// on a cold SDK cache the guarded checklist write answers 409 checklist_conflict for an EXISTING document with its correct version
// token, because the RTDB transaction's first pass sees null and aborts (lib/repositories/bizDataRepo.js setBizDocGuarded).
const observations = [];
{
  await seed(REGS.registered); const before = await readAll();
  const r = await call("set-checklist-template-items", ACTIONS[3][2]("bizA"), "u_mgr", "POST");
  const reproduced = r.code === 409 && r.body && r.body.error === "checklist_conflict" && (await readAll()) === before;
  observations.push(`OBSERVATION I7E-O1 cold-cache guarded checklist write: ${reproduced ? "REPRODUCED (409 checklist_conflict, nothing written)" : "not reproduced (" + r.code + ")"}`);
}

await app.delete();
for (const r of results) console.log(`${r.status} ${r.id} ${r.description}${r.notes ? " — " + String(r.notes).split("\n")[0] : ""}`);
for (const o of observations) console.log(o);
console.log(failures ? `FAILED ${failures}` : "ALL CASES PASSED");
process.exit(failures ? 1 : 0);
