// M1 integration R4 (LOCAL; pending independent Codex review) — the S1 / S2 / A2 corrections on the REAL local RTDB emulator
// with the checkout's REAL database.rules.json: the real api/admin.js handler over the real Admin SDK (real transactions, real
// concurrency), and Rules enforced per principal through `databaseAuthVariableOverride` (the documented emulator mechanism).
//   R4E1  legitimate onboarding: an absent tenant is claimed; the new owner can then write its registry under the Rules
//   R4E2  the review's condition: a role-less tenant with a registry ([null] / valid) is refused; nothing is written; the refused
//         caller can neither read nor write the tenant afterwards (no retained privilege)
//   R4E3  five TRULY concurrent claims of one absent tenant: exactly one owner, no mixed roles, losers get no mapping
//   R4E4  a lost acknowledgement of a committed claim: 500; the same user's retry resumes; another user is refused
//   R4E5  the page's add-only registry transaction (window.MarjinC1.registrySetupWrite, as completeSetup runs it) as the owner
//         under the Rules: an id collision is refused and the stored registry is unchanged; two concurrent additions with the
//         same expected list: one commits, the other is refused — never a replacement
//   R4E6  create-client against an existing tenant whose id the generator produces: the id is skipped, the existing tenant is
//         byte-identical
//   R4E7  the nightly run record (analytics_runs) is Admin-only: no client principal can read or write it
// Local only: refuses to run unless pointed at the demo namespace on 127.0.0.1:9000. No e-mail, no Auth service, no network.
import admin from "firebase-admin";
import assert from "node:assert/strict";
import { mkdtempSync, cpSync, writeFileSync, mkdirSync, symlinkSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { loadSeam } from "../support/c1-seam.mjs";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const PROJECT = "demo-marjin-rules", NS = "demo-marjin-rules-default-rtdb", HOST = "127.0.0.1:9000", DB_URL = `http://${HOST}?ns=${NS}`;
const abort = (m) => { console.error("SAFETY ABORT: " + m); process.exit(2); };
if (process.env.FIREBASE_DATABASE_EMULATOR_HOST !== HOST) abort("FIREBASE_DATABASE_EMULATOR_HOST must be " + HOST);
if (process.env.GCLOUD_PROJECT !== PROJECT || process.env.GOOGLE_CLOUD_PROJECT !== PROJECT) abort("project must be " + PROJECT);
if (process.env.GOOGLE_APPLICATION_CREDENTIALS || process.env.FIREBASE_DATABASE_URL) abort("credentials / database URL must be absent");
const rules = JSON.parse(readFileSync(join(ROOT, "database.rules.json"), "utf8"));
await fetch(`http://${HOST}/.settings/rules.json?ns=${NS}`, { method: "PUT", headers: { Authorization: "Bearer owner", "Content-Type": "application/json" }, body: JSON.stringify(rules) });

// the real handler; seams: Admin construction (the emulator app), token verification (claims on the request), Auth createUser, e-mail
const dir = mkdtempSync(join(tmpdir(), "m1r4-emu-"));
cpSync(join(ROOT, "lib"), join(dir, "lib"), { recursive: true }); mkdirSync(join(dir, "api")); cpSync(join(ROOT, "api/admin.js"), join(dir, "api/admin.js"));
mkdirSync(join(dir, "fincore")); cpSync(join(ROOT, "fincore/v1"), join(dir, "fincore/v1"), { recursive: true }); symlinkSync(join(ROOT, "node_modules"), join(dir, "node_modules"), "dir");
writeFileSync(join(dir, "lib/adminSdk.js"), `export function getAdminDb(){ return globalThis.__M1R4_DB(); }\nexport function getAdminAuth(){ return { getUser: async () => ({}), createUser: async () => ({ uid: "newOwner" }) }; }\n`);
writeFileSync(join(dir, "lib/verifyToken.js"), `export async function requireAuth(req){ if (!req.__claims) throw new Error("no auth"); return req.__claims; }\nexport async function verifyToken(){ return null; }\n`);
writeFileSync(join(dir, "lib/sendEmail.js"), `export async function sendEmail(){ return {}; }\nexport async function sendAlertDigest(){ return {}; }\n`);
const app = admin.initializeApp({ databaseURL: DB_URL }, "m1r4-admin"); const real = app.database();
let hook = null;
globalThis.__M1R4_DB = () => ({ ref: (p) => { const r = real.ref(p); if (!hook || !hook.match(p)) return r; return new Proxy(r, { get(t, k) { if (k !== "transaction") { const v = t[k]; return typeof v === "function" ? v.bind(t) : v; } return (...a) => hook.run(t, a); } }); } });
const handler = (await import(pathToFileURL(join(dir, "api/admin.js")).href)).default;
const call = async (action, body, uid) => { const r = { code: null, body: null, setHeader() {}, status(n) { this.code = n; return this; }, json(v) { this.body = v; return this; } }; await handler({ method: "POST", query: { action }, headers: {}, body, __claims: uid ? { uid, email: uid + "@example.test" } : null }, r); return r; };
const as = (uid) => admin.initializeApp({ databaseURL: DB_URL, databaseAuthVariableOverride: { uid, token: { email: uid + "@example.test" } } }, "m1r4-" + uid + "-" + Math.random().toString(36).slice(2)).database();
const read = async (p) => (await real.ref(p).get()).val();
const denied = async (fn) => { try { await fn(); return false; } catch (e) { return /permission/i.test(String(e && (e.code || e.message))); } };
const env = (v) => ({ _v: JSON.stringify(v) });
const C1 = loadSeam(readFileSync(join(ROOT, "index.html"), "utf8"));

const results = [];
async function check(id, fn) {
  try { await real.ref("/").set(null); hook = null; await fn(); results.push({ id, ok: true }); console.log("ok   " + id); }
  catch (e) { results.push({ id, ok: false }); console.log("FAIL " + id + " — " + (e && e.message)); }
}

await check("R4E1 legitimate onboarding: an absent tenant is claimed and its owner can write the registry under the Rules", async () => {
  const r = await call("bootstrap-self", { tenantId: "tNew" }, "uOwner");
  assert.deepEqual([r.code, r.body], [200, { ok: true, tenantId: "tNew", role: "super_owner" }]);
  assert.deepEqual(await read("tenants/tNew/roles"), { uOwner: "super_owner" });
  assert.equal(await read("user_tenants/uOwner"), "tNew");
  await as("uOwner").ref("tenants/tNew/app/business").set(env([{ id: "biz_1", name: "First" }]));
  assert.deepEqual(await read("tenants/tNew/app/business"), env([{ id: "biz_1", name: "First" }]));
  assert.ok(await denied(() => as("uStranger").ref("tenants/tNew/app/business").set(env([]))), "a stranger cannot write it");
});

await check("R4E2 a role-less tenant with a registry is refused; the refused caller retains no privilege", async () => {
  for (const reg of [{ _v: "[null]" }, env([{ id: "bizC", name: "Valid" }])]) {
    await real.ref("/").set({ tenants: { tOld: { app: { business: reg }, "biz:bizC:entries": env([]) } } });
    const before = await read("/");
    const r = await call("bootstrap-self", { tenantId: "tOld" }, "uAttacker");
    assert.deepEqual([r.code, r.body], [409, { error: "tenant_has_data" }], JSON.stringify(reg));
    assert.deepEqual(await read("/"), before, "nothing is written");
    const db = as("uAttacker");
    assert.ok(await denied(() => db.ref("tenants/tOld/app/business").get()), "no read of the registry");
    assert.ok(await denied(() => db.ref("tenants/tOld/app/business").set(env([{ id: "x" }]))), "no write of the registry");
    assert.ok(await denied(() => db.ref("tenants/tOld/roles/uAttacker").set("super_owner")), "no direct role write");
  }
});

await check("R4E3 five truly concurrent claims: exactly one owner, no mixed roles", async () => {
  const uids = ["c1", "c2", "c3", "c4", "c5"];
  const rs = await Promise.all(uids.map((u) => call("bootstrap-self", { tenantId: "tRace" }, u)));
  const winners = uids.filter((_, k) => rs[k].code === 200);
  assert.equal(winners.length, 1, JSON.stringify(rs.map((r) => [r.code, r.body])));
  for (const [k, u] of uids.entries()) if (u !== winners[0]) assert.equal(rs[k].code, 409, u);
  assert.deepEqual(await read("tenants/tRace/roles"), { [winners[0]]: "super_owner" });
  assert.deepEqual(await read("tenants/tRace/members"), { [winners[0]]: true });
  assert.deepEqual((await read("tenants/tRace/access_meta/owner_guard")).ownerUids, { [winners[0]]: true });
  for (const u of uids) assert.equal(await read("user_tenants/" + u), u === winners[0] ? "tRace" : null, u);
});

await check("R4E4 a lost acknowledgement: 500, the same user's retry resumes, another user is refused", async () => {
  hook = { match: (p) => p === "tenants/tLost", run: async (t, a) => { const o = await t.transaction(...a); hook = null; if (o.committed) throw new Error("ack lost after commit"); return o; } };
  const r = await call("bootstrap-self", { tenantId: "tLost" }, "uA");
  assert.equal(r.code, 500);
  assert.deepEqual(await read("tenants/tLost/roles"), { uA: "super_owner" }, "committed");
  assert.equal((await call("bootstrap-self", { tenantId: "tLost" }, "uB")).code, 409);
  const again = await call("bootstrap-self", { tenantId: "tLost" }, "uA");
  assert.deepEqual([again.code, again.body.resumed], [200, true]);
  assert.equal(await read("user_tenants/uA"), "tLost");
  assert.equal(await read("user_tenants/uB"), null);
});

await check("R4E5 the page's add-only registry transaction under the Rules: collision refused, concurrent additions never replace", async () => {
  await real.ref("/").set({ tenants: { tA: { roles: { o1: "owner", o2: "owner" }, members: { o1: true, o2: true }, app: { business: env([{ id: "biz_42", name: "original" }]) } } } });
  const txn = async (db, expected, record) => {
    let last = null;
    const res = await db.ref("tenants/tA/app/business").transaction((cur) => { last = C1.registrySetupWrite(cur, expected, record); return last.ok ? last.value : (cur === null ? null : undefined); }, undefined, false);
    return { committed: res.committed, verdict: JSON.parse(JSON.stringify(last)) };
  };
  const expected = [{ id: "biz_42", name: "original" }];
  const col = await txn(as("o1"), expected, { id: "biz_42", name: "new" });
  assert.equal(col.committed, false); assert.equal(col.verdict.reason, "registry_id_collision");
  assert.deepEqual(await read("tenants/tA/app/business"), env(expected), "unchanged");
  const [a, b] = await Promise.all([txn(as("o1"), expected, { id: "biz_50", name: "A" }), txn(as("o2"), expected, { id: "biz_51", name: "B" })]);
  assert.equal([a, b].filter((x) => x.committed).length, 1, JSON.stringify([a, b]));
  const loser = a.committed ? b : a;
  assert.equal(loser.verdict.reason, "registry_changed");
  const list = JSON.parse((await read("tenants/tA/app/business"))._v);
  assert.deepEqual(list.slice(0, 1), expected, "the original record is kept");
  assert.equal(list.length, 2, "exactly one addition");
});

await check("R4E6 create-client skips an existing tenant's id; the existing tenant is byte-identical", async () => {
  const realNow = Date.now, NOW = 1790000000000; Date.now = () => NOW;
  try {
    const existing = { roles: { victim: "owner" }, members: { victim: true }, app: { business: env([{ id: `biz_${NOW}`, name: "Existing" }]) } };
    await real.ref("/").set({ tenants: { home: { roles: { su: "super_owner" } }, [`biz_${NOW}`]: existing } });
    const r = await call("create-client", { bizName: "New", ownerName: "O", ownerEmail: "o@example.test", ownerUsername: "newowner" }, "su");
    assert.equal(r.code, 200, JSON.stringify(r.body));
    assert.equal(r.body.tenantId, `biz_${NOW}_1`);
    assert.deepEqual(await read(`tenants/biz_${NOW}`), existing);
    assert.equal((await read(`tenants/biz_${NOW}_1/roles`)).newOwner, "owner");
    assert.equal(await read(`tenants/biz_${NOW}_1/meta/provisioning`), null);
  } finally { Date.now = realNow; }
});

await check("R4E7 the nightly run record is Admin-only", async () => {
  await real.ref("analytics_runs/daily/2026-10-07").set({ date: "2026-10-07", invocations: 1, current: { invocation: 1, state: "partial" } });
  await real.ref("/tenants/tA").set({ roles: { o1: "owner" }, members: { o1: true } });
  for (const uid of ["o1", "stranger"]) {
    const db = as(uid);
    assert.ok(await denied(() => db.ref("analytics_runs/daily/2026-10-07").get()), uid + " cannot read it");
    assert.ok(await denied(() => db.ref("analytics_runs/daily/2026-10-07/current/state").set("completed")), uid + " cannot write it");
  }
  assert.equal(await read("analytics_runs/daily/2026-10-07/current/state"), "partial");
});

const failed = results.filter((r) => !r.ok);
console.log(`M1R4_EMULATOR total=${results.length} pass=${results.length - failed.length} fail=${failed.length}`);
process.exit(failed.length || results.length !== 7 ? 1 : 0);
