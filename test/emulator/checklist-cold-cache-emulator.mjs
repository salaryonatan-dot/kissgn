// Marjin — checklist cold-cache successor (CC1 runtime; CC2 test contract): the ACTUAL api/admin.js checklist handlers and the ACTUAL
// lib/repositories/bizDataRepo.js setBizDocGuarded over the REAL local Admin SDK transport (firebase-admin → RTDB emulator, demo
// namespace). A "cold" request runs on a FRESH Admin SDK app instance (no listener, no cached value — a cold serverless instance);
// a "warm" request runs on an instance whose cache holds the target through a value listener.
//   CCE-01  cold cache, existing document, the CORRECT version token, every checklist family (template items / run / simple run):
//           served 200 and persisted exactly once (the I7 baseline answered 409 checklist_conflict and wrote nothing)
//   CCE-02  warm cache, same edit: 200 (unchanged behaviour)
//   CCE-03  missing record: create with the null-document token → 200; with any other token → 409, nothing created
//   CCE-04  a REAL conflict: the document changed after the client read it (stale token) → 409 checklist_conflict, the newer document
//           is kept byte-identical, on a cold AND on a warm instance
//   CCE-05  two writers holding the same token on two DISTINCT cold instances, in flight at once under varied scheduling: exactly one 200,
//           the other 409 checklist_conflict; the stored document is the winner's; each request's transaction ran on ITS OWN Admin
//           instance (proven from the per-request trace, not assumed); the loser's token is a genuine stale version — a retry with
//           the current token on another cold instance is served
//   CCE-05N negative controls of the CCE-05 contract itself (CC2, review finding CC1-R-01): the same pair with both writers forced onto
//           ONE instance, with one writer on a WARM instance, and a request with NO bound context — each is REJECTED by the harness's
//           own checks (the status codes alone would still read [200, 409] in the first case: that is why the CC1 assertion was vacuous)
//   CCE-06  authorization and registry precedence unchanged: unauthenticated 401; viewer 403; other tenant 403; unregistered business
//           403 business_not_in_tenant; ambiguous registry 503 — none touches the document path, nothing written
//   CCE-07  a warm instance that was offline while another writer changed the server: the stale token is refused, the current token
//           served. (The SDK re-synchronizes a listener on reconnect, so a deterministically STALE cache is modelled in the unit test
//           test/security/checklist-cold-cache.test.mjs, not here.)
// CC2 (test-only successor of CC1 026c2278; closes CC1-R-01): the Admin-construction seam no longer reads a mutable process-global
// selector. Every handler call runs inside an IMMUTABLE AsyncLocalStorage request context {instance, claims}; the replaced
// lib/adminSdk.js and lib/verifyToken.js read ONLY that context and THROW when none is bound, so a request can neither inherit another
// request's instance nor fall back to a default. Each instance records, per request, the app name used for every `ref(path)`.
// Deliberately NOT named *.test.mjs. Host run: bash test/support/p1-r7-emu-run.sh <checkout> <abs logs> cc1=test/emulator/checklist-cold-cache-emulator.mjs
import admin from "firebase-admin";
import { AsyncLocalStorage } from "node:async_hooks";
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
(function assertSafe() {
  if (process.env.GCLOUD_PROJECT !== PROJECT) fail(`GCLOUD_PROJECT must be ${PROJECT}`);
  if (process.env.GOOGLE_CLOUD_PROJECT !== PROJECT) fail(`GOOGLE_CLOUD_PROJECT must be ${PROJECT}`);
  if (process.env.FIREBASE_DATABASE_EMULATOR_HOST !== EMU) fail(`FIREBASE_DATABASE_EMULATOR_HOST must be ${EMU}`);
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) fail("GOOGLE_APPLICATION_CREDENTIALS must be absent");
  const fc = validateFirebaseConfig(process.env.FIREBASE_CONFIG);
  if (!fc.ok) fail(`FIREBASE_CONFIG rejected: ${fc.reason}`);
  if (process.env.FIREBASE_DATABASE_URL) { const u = String(process.env.FIREBASE_DATABASE_URL); if (!DEMO.has(u) && !isLocal(u)) fail(`FIREBASE_DATABASE_URL is not demo/local: ${u}`); }
  if (process.env.UPSTASH_REDIS_REST_URL || process.env.UPSTASH_REDIS_REST_TOKEN) fail("Upstash variables must be absent (the in-memory limiter is used)");
})();

// ── CC2: the ONE immutable request context. The replaced seams below reach it through a frozen, non-writable global binding; there is
// no setter, no default instance and no fallback — a call outside `bound()` throws inside the seam.
const REQUEST = new AsyncLocalStorage();
Object.defineProperty(globalThis, "__CC2_REQUEST", { value: REQUEST, writable: false, configurable: false, enumerable: false });

// the real handler + helpers + repositories with ONLY the Admin-construction / token / e-mail seams replaced; the DB is the real transport
const dir = mkdtempSync(join(tmpdir(), "cc2-emu-"));
cpSync(join(ROOT, "lib"), join(dir, "lib"), { recursive: true });
cpSync(join(ROOT, "fincore", "v1"), join(dir, "fincore", "v1"), { recursive: true });
mkdirSync(join(dir, "api"), { recursive: true });
cpSync(join(ROOT, "api", "admin.js"), join(dir, "api", "admin.js"));
symlinkSync(join(ROOT, "node_modules"), join(dir, "node_modules"), "dir");
writeFileSync(join(dir, "lib", "adminSdk.js"), [
  `const ctx = () => { const s = globalThis.__CC2_REQUEST.getStore(); if (!s || !s.instance) throw new Error("CC2_UNBOUND_REQUEST: getAdminDb() outside a bound request context"); return s; };`,
  `export function getAdminDb() { const s = ctx(); const inst = s.instance; return { ref: (p) => { inst.trace.push({ request: s.id, app: inst.app, path: p === undefined ? "(root)" : p }); return inst.db.ref(p); } }; }`,
  `export function getAdminAuth() { ctx(); return { getUser: async (u) => ({ uid: u, email: "x@example.test" }) }; }`,
  ""].join("\n"));
writeFileSync(join(dir, "lib", "verifyToken.js"), [
  `const ctx = () => { const s = globalThis.__CC2_REQUEST.getStore(); if (!s) throw new Error("CC2_UNBOUND_REQUEST: verifyToken outside a bound request context"); return s; };`,
  `export async function requireAuth() { const s = ctx(); if (!s.claims) throw new Error("no auth"); return s.claims; }`,
  `export async function verifyToken() { return ctx().claims; }`,
  ""].join("\n"));
writeFileSync(join(dir, "lib", "sendEmail.js"), `export async function sendEmail() { return { messageId: "m" }; }\nexport async function sendAlertDigest() { return { messageId: "d" }; }\n`);
const handler = (await import(pathToFileURL(join(dir, "api", "admin.js")).href)).default;
const { checklistVersionToken } = await import(pathToFileURL(join(ROOT, "lib", "checklistVersion.js")).href);
const seam = await import(pathToFileURL(join(dir, "lib", "adminSdk.js")).href);

// a seeding / inspection instance (never used by the handler) and a factory of handler instances
let appSeq = 0;
const newApp = () => admin.initializeApp({ databaseURL: DB_URL, projectId: PROJECT }, `cc2-${process.pid}-${appSeq++}`);
const seeder = newApp(); const sdb = seeder.database();
const apps = [seeder];
/** A FRESH Admin SDK app: no listener, no cached value. `trace` records every ref() made through it, tagged with the request that made it. */
function coldInstance() { const a = newApp(); apps.push(a); return { app: a.name, db: a.database(), trace: [], listeners: 0 }; }
/** Warm `inst` on `path` through a value listener (the cache holds the target). Returns the detach function. */
async function warm(inst, path) { const cb = inst.db.ref(path).on("value", () => {}); inst.listeners += 1; await new Promise((x) => setTimeout(x, 200)); return () => { inst.db.ref(path).off("value", cb); }; }
let reqSeq = 0;
/** Run `fn` inside an immutable request context bound to `inst` (and `claims`). The context is frozen; nothing can rebind it later. */
const bound = (inst, claims, fn) => REQUEST.run(Object.freeze({ id: `r${reqSeq++}`, instance: inst, claims }), fn);

const env = (v) => ({ _v: JSON.stringify(v) });
const T = "tenantCC", FROM = "2026-10-01";
const DOC0 = { items: [{ id: "a", label: "Open", done: false }] };
const DOC1 = { items: [{ id: "a", label: "Open", done: true }] };
const DOC2 = { items: [{ id: "a", label: "Open", done: true }, { id: "b", label: "Close", done: false }] };
const FAMILIES = [
  ["set-checklist-template-items", "manager", (b) => ({ tenantId: T, bizId: b, templateId: "t1" }), `checklist_template_items:t1`],
  ["set-checklist-run", "shift_manager", (b) => ({ tenantId: T, bizId: b, businessDate: FROM }), `checklist_runs:${FROM}`],
  ["set-checklist-simple-run", "shift_manager", (b) => ({ tenantId: T, bizId: b, businessDate: FROM, templateId: "t1" }), `checklist_simple_runs:${FROM}:t1`],
];
const docPath = (suffix, b = "bizA") => `tenants/${T}/biz:${b}:${suffix}`;
async function seed({ registry = env([{ id: "bizA", name: "A" }]), docs = {} } = {}) {
  await sdb.ref("/").set({
    tenants: { [T]: {
      members: { u_own: true, u_mgr: true, u_view: true }, roles: { u_own: "owner", u_mgr: "manager", u_view: "viewer" },
      biz_access: { bizA: { u_mgr: true, u_view: true } },
      app: { ...(registry === null ? {} : { business: registry }) },
      ...Object.fromEntries(Object.entries(docs).map(([k, v]) => [k.replace(`tenants/${T}/`, ""), v])),
    } },
    user_tenants: { u_own: T },
  });
}
const raw = async (p) => (await sdb.ref(p).once("value")).val();
let rot = 0;
const claimsFor = (uid) => (uid ? { uid, email: uid + "@example.test" } : null);
/** One handler call. `inst` is the Admin instance this request is bound to for its whole life; nothing else can select a database for it. */
async function call(inst, action, body, uid) {
  const n = rot++;
  const r = { code: null, body: null, setHeader() {}, status(c) { this.code = c; return this; }, json(v) { this.body = v; return this; }, end() { return this; } };
  const req = { method: "POST", query: { action }, headers: { authorization: "Bearer t", "x-forwarded-for": "198.51.100." + (10 + (n % 200)) }, body };
  if (inst === null) { await handler(req, r); return { code: r.code, body: r.body }; }          // CCE-05N only: NO bound context
  await bound(inst, claimsFor(uid), () => handler(req, r));
  return { code: r.code, body: r.body };
}
const results = []; let failures = 0;
async function run(id, description, fn) {
  try { const n = await fn(); results.push({ id, status: "PASS", description, notes: n || "" }); }
  catch (e) { failures++; results.push({ id, status: "FAIL", description, notes: (e && e.stack) || String(e) }); }
}
const eq = (a, b, m) => { const x = JSON.stringify(a), y = JSON.stringify(b); if (x !== y) throw new Error(`${m}: expected ${y}, got ${x}`); };
const actorFor = (minRole) => (minRole === "manager" ? "u_mgr" : "u_mgr");   // a granted manager satisfies both minimum roles
const sleep = (ms) => new Promise((x) => setTimeout(x, ms));
/** The app names `inst` used for `path` while serving request ids in `reqIds` (from the per-request trace). */
const appsUsedFor = (inst, path, reqIds) => [...new Set(inst.trace.filter((t) => t.path === path && reqIds.has(t.request)).map((t) => t.app))];

// ── the CCE-05 pair: two writers with the same token, in flight at once, each bound to its own instance for its whole life.
// Returns the outcome AND the binding evidence; `assertPairContract` judges it (CCE-05 expects it to hold, CCE-05N expects it to throw).
async function concurrentPair([action, minRole, body, suffix], instA, instB, [delayA, delayB]) {
  const path = docPath(suffix), t0 = checklistVersionToken(DOC0);
  const before = reqSeq;
  const go = (inst, doc, delay) => bound(inst, claimsFor(actorFor(minRole)), async () => {
    await sleep(delay);                                                         // varied scheduling: the bound context survives the await
    const n = rot++;
    const r = { code: null, body: null, setHeader() {}, status(c) { this.code = c; return this; }, json(v) { this.body = v; return this; }, end() { return this; } };
    await handler({ method: "POST", query: { action }, headers: { authorization: "Bearer t", "x-forwarded-for": "198.51.100." + (10 + (n % 200)) }, body: { ...body("bizA"), doc, expectedVersionToken: t0 } }, r);
    return { code: r.code, body: r.body, request: REQUEST.getStore().id };
  });
  const [a, b] = await Promise.all([go(instA, DOC1, delayA), go(instB, DOC2, delayB)]);
  eq(reqSeq - before, 2, "two request contexts were created");
  return {
    action, path, a, b, stored: await raw(path),
    usedA: appsUsedFor(instA, path, new Set([a.request])), usedB: appsUsedFor(instB, path, new Set([b.request])),
    // did either instance serve the OTHER request's document access? (a shared or swapped instance shows up here)
    crossA: appsUsedFor(instA, path, new Set([b.request])), crossB: appsUsedFor(instB, path, new Set([a.request])),
    appA: instA.app, appB: instB.app, listenersA: instA.listeners, listenersB: instB.listeners,
  };
}
/** The CCE-05 contract. Throws a typed error naming the violated clause. */
function assertPairContract(o) {
  const codes = [o.a.code, o.b.code].sort();
  if (JSON.stringify(codes) !== JSON.stringify([200, 409])) throw new Error(`OUTCOME: ${o.action}: expected exactly one 200 and one 409, got ${JSON.stringify([o.a.code, o.b.code])}`);
  const loser = o.a.code === 409 ? o.a : o.b, winnerDoc = o.a.code === 200 ? DOC1 : DOC2;
  eq(loser.body, { ok: false, error: "checklist_conflict" }, `OUTCOME: ${o.action}: the loser's answer`);
  eq(o.stored, env(winnerDoc), `OUTCOME: ${o.action}: the served writer's document is stored`);
  if (o.appA === o.appB) throw new Error(`DISTINCT_INSTANCES: ${o.action}: both writers were bound to the same Admin instance ${o.appA}`);
  if (o.listenersA !== 0 || o.listenersB !== 0) throw new Error(`COLD_INSTANCES: ${o.action}: an instance had a listener (${o.listenersA}, ${o.listenersB})`);
  if (JSON.stringify(o.usedA) !== JSON.stringify([o.appA])) throw new Error(`OWN_INSTANCE: ${o.action}: writer A's document access ran on ${JSON.stringify(o.usedA)}, not on its own ${o.appA}`);
  if (JSON.stringify(o.usedB) !== JSON.stringify([o.appB])) throw new Error(`OWN_INSTANCE: ${o.action}: writer B's document access ran on ${JSON.stringify(o.usedB)}, not on its own ${o.appB}`);
  if (o.crossA.length || o.crossB.length) throw new Error(`OWN_INSTANCE: ${o.action}: an instance served the other writer's document access (${JSON.stringify([o.crossA, o.crossB])})`);
  return { loser, winnerDoc };
}
const ROUNDS = [[0, 0], [0, 5], [5, 0], [0, 10], [10, 0], [2, 0], [0, 2], [0, 0]];

await run("CCE-01", "cold cache, existing document, the correct token: every checklist family is served and persisted (baseline: 409, nothing written)", async () => {
  const out = [];
  for (const [action, minRole, body, suffix] of FAMILIES) {
    await seed({ docs: { [docPath(suffix)]: env(DOC0) } });
    const inst = coldInstance();
    const r = await call(inst, action, { ...body("bizA"), doc: DOC1, expectedVersionToken: checklistVersionToken(DOC0) }, actorFor(minRole));
    out.push(`${action}:${r.code}`);
    eq([r.code, r.body && r.body.versionToken], [200, checklistVersionToken(DOC1)], action + " status / returned token");
    eq(await raw(docPath(suffix)), env(DOC1), action + " persisted");
    eq(inst.trace.filter((t) => t.path === docPath(suffix)).length > 0, true, action + " the document node was reached on the bound instance");
  }
  return out.join(" ");
});

await run("CCE-02", "warm cache (value listener on the target), same edit: served (unchanged)", async () => {
  for (const [action, minRole, body, suffix] of FAMILIES) {
    await seed({ docs: { [docPath(suffix)]: env(DOC0) } });
    const inst = coldInstance(); const off = await warm(inst, docPath(suffix));
    const r = await call(inst, action, { ...body("bizA"), doc: DOC1, expectedVersionToken: checklistVersionToken(DOC0) }, actorFor(minRole));
    off();
    eq(r.code, 200, action); eq(await raw(docPath(suffix)), env(DOC1), action + " persisted");
  }
});

await run("CCE-03", "missing record: the null-document token creates it; any other token is refused with nothing created", async () => {
  for (const [action, minRole, body, suffix] of FAMILIES) {
    await seed();
    let r = await call(coldInstance(), action, { ...body("bizA"), doc: DOC0, expectedVersionToken: checklistVersionToken(DOC1) }, actorFor(minRole));
    eq([r.code, r.body], [409, { ok: false, error: "checklist_conflict" }], action + " wrong token on a missing record"); eq(await raw(docPath(suffix)), null, action + " nothing created");
    r = await call(coldInstance(), action, { ...body("bizA"), doc: DOC0, expectedVersionToken: checklistVersionToken(null) }, actorFor(minRole));
    eq(r.code, 200, action + " create"); eq(await raw(docPath(suffix)), env(DOC0), action + " created");
  }
});

await run("CCE-04", "a real conflict (the document changed after the client read it): 409, the newer document kept, on a cold and on a warm instance", async () => {
  for (const [action, minRole, body, suffix] of FAMILIES) {
    for (const isWarm of [false, true]) {
      await seed({ docs: { [docPath(suffix)]: env(DOC2) } });                         // the server already holds a newer version
      const inst = coldInstance(); const off = isWarm ? await warm(inst, docPath(suffix)) : null;
      const before = await raw(docPath(suffix));
      const r = await call(inst, action, { ...body("bizA"), doc: DOC1, expectedVersionToken: checklistVersionToken(DOC0) }, actorFor(minRole));   // client read DOC0
      if (off) off();
      eq([r.code, r.body], [409, { ok: false, error: "checklist_conflict" }], `${action} ${isWarm ? "warm" : "cold"}`);
      eq(await raw(docPath(suffix)), before, `${action} ${isWarm ? "warm" : "cold"}: newer document kept`);
    }
  }
});

await run("CCE-05", "two writers with the same token on two DISTINCT cold instances, in flight at once under varied scheduling: exactly one served, the other refused as a genuine stale version; each ran on its own instance; the loser's retry with the current token is served", async () => {
  const tally = { pairs: 0, aWon: 0, bWon: 0 };
  for (const fam of FAMILIES) {
    const [action, minRole, body, suffix] = fam;
    // sequential: two cold instances one after the other
    await seed({ docs: { [docPath(suffix)]: env(DOC0) } });
    const t0 = checklistVersionToken(DOC0);
    const a = await call(coldInstance(), action, { ...body("bizA"), doc: DOC1, expectedVersionToken: t0 }, actorFor(minRole));
    const b = await call(coldInstance(), action, { ...body("bizA"), doc: DOC2, expectedVersionToken: t0 }, actorFor(minRole));
    eq([a.code, b.code], [200, 409], action + " sequential: first served, second refused");
    eq(await raw(docPath(suffix)), env(DOC1), action + " sequential: the first writer's document stands");
    // in flight at once, on two distinct cold instances, under varied scheduling
    for (const delays of ROUNDS) {
      await seed({ docs: { [docPath(suffix)]: env(DOC0) } });
      const o = await concurrentPair(fam, coldInstance(), coldInstance(), delays);
      const { loser, winnerDoc } = assertPairContract(o);
      tally.pairs += 1; if (o.a.code === 200) tally.aWon += 1; else tally.bWon += 1;
      // the loser's 409 was a GENUINE stale version: with the current token (the winner's document) it is served on another cold instance
      const loserDoc = loser === o.a ? DOC1 : DOC2;
      const retry = await call(coldInstance(), action, { ...body("bizA"), doc: loserDoc, expectedVersionToken: checklistVersionToken(winnerDoc) }, actorFor(minRole));
      eq([retry.code, retry.body && retry.body.versionToken], [200, checklistVersionToken(loserDoc)], `${action} ${JSON.stringify(delays)}: the loser's retry with the current token is served`);
      eq(await raw(docPath(suffix)), env(loserDoc), `${action} ${JSON.stringify(delays)}: the retry persisted`);
    }
  }
  return `${tally.pairs} concurrent pairs (${ROUNDS.length} schedules × ${FAMILIES.length} families): A won ${tally.aWon}, B won ${tally.bWon}; every pair on two distinct cold instances`;
});

await run("CCE-05N", "negative controls of the CCE-05 contract: a forced shared instance, a warm instance and an unbound request are each REJECTED by the harness's own checks", async () => {
  const fam = FAMILIES[0], [action, minRole, body, suffix] = fam, out = [];
  const expectReject = async (label, clause, o) => {
    let err = null; try { assertPairContract(o); } catch (e) { err = e; }
    if (!err) throw new Error(`${label}: the harness ACCEPTED a pair that violates the contract (codes ${JSON.stringify([o.a.code, o.b.code])})`);
    if (!String(err.message).startsWith(clause + ":")) throw new Error(`${label}: rejected for ${err.message.split(":")[0]}, expected ${clause}`);
    out.push(`${label}→${clause} (codes ${JSON.stringify([o.a.code, o.b.code].sort())})`);
    return o;
  };
  // (1) both writers forced onto ONE cold instance: the status codes alone still read [200, 409] — the CC1 assertion accepted this
  await seed({ docs: { [docPath(suffix)]: env(DOC0) } });
  const only = coldInstance();
  const shared = await expectReject("forced shared instance", "DISTINCT_INSTANCES", await concurrentPair(fam, only, only, [0, 0]));
  eq([shared.a.code, shared.b.code].sort(), [200, 409], "forced shared instance: the codes alone are indistinguishable from the honest pair (why CC1-R-01 was vacuous)");
  // (2) one writer on a WARM instance (listener on the target): rejected as not cold
  await seed({ docs: { [docPath(suffix)]: env(DOC0) } });
  const w = coldInstance(); const off = await warm(w, docPath(suffix));
  await expectReject("warm instance", "COLD_INSTANCES", await concurrentPair(fam, w, coldInstance(), [0, 0]));
  off();
  // (3) a request with NO bound context: the seam throws, the handler cannot reach any database, nothing is written
  await seed({ docs: { [docPath(suffix)]: env(DOC0) } });
  let thrown = null; try { seam.getAdminDb(); } catch (e) { thrown = e; }
  eq(thrown && /^CC2_UNBOUND_REQUEST/.test(thrown.message), true, "getAdminDb() outside a bound request throws (no default instance, no fallback)");
  const traced = apps.length;
  const r = await call(null, action, { ...body("bizA"), doc: DOC1, expectedVersionToken: checklistVersionToken(DOC0) }, actorFor(minRole));
  eq(r.code === 200 || r.code === 409, false, "unbound request: neither served nor judged a conflict (code " + r.code + ")");
  eq(await raw(docPath(suffix)), env(DOC0), "unbound request: nothing written");
  eq(apps.length, traced, "unbound request: no instance was created or selected for it");
  out.push(`unbound→${r.code}`);
  // (4) the binding is immutable: the global cannot be replaced or re-pointed
  let rebound = false; try { globalThis.__CC2_REQUEST = new AsyncLocalStorage(); rebound = globalThis.__CC2_REQUEST !== REQUEST; } catch { rebound = false; }
  eq(rebound, false, "the request-context binding cannot be replaced");
  return out.join("; ");
});

await run("CCE-06", "authorization and registry precedence unchanged; nothing touches the document", async () => {
  const [action, , body, suffix] = FAMILIES[0];
  const cases = [
    ["unauthenticated", {}, null, 401], ["viewer", {}, "u_view", 403], ["other tenant", { tenantId: "tenantOther" }, "u_mgr", 403],
    ["unregistered business", { registry: env([{ id: "bizB" }]) }, "u_mgr", 403], ["ambiguous registry", { registry: env([{ id: "bizA" }, { id: " bizA " }]) }, "u_mgr", 503],
  ];
  for (const [label, o, uid, code] of cases) {
    await seed({ registry: o.registry ?? env([{ id: "bizA", name: "A" }]), docs: { [docPath(suffix)]: env(DOC0) } });
    const inst = coldInstance();
    const r = await call(inst, action, { ...body("bizA"), ...(o.tenantId ? { tenantId: o.tenantId } : {}), doc: DOC1, expectedVersionToken: checklistVersionToken(DOC0) }, uid);
    eq(r.code, code, label);
    eq(inst.trace.map((t) => t.path).filter((p) => p.includes(":checklist_")), [], label + ": the document path is never referenced");
    eq(await raw(docPath(suffix)), env(DOC0), label + ": nothing written");
  }
});

await run("CCE-07", "a warm instance offline while another writer changed the server: the stale token is refused, then the current token is served", async () => {
  const [action, , body, suffix] = FAMILIES[0];
  await seed({ docs: { [docPath(suffix)]: env(DOC0) } });
  const inst = coldInstance();
  const off = await warm(inst, docPath(suffix));
  inst.db.goOffline();                                              // the instance stops receiving updates: its cache stays at DOC0
  await sdb.ref(docPath(suffix)).set(env(DOC2));                    // another writer moves the server to DOC2
  inst.db.goOnline();                                               // reconnect: the transaction's first run may still see DOC0
  let r = await call(inst, action, { ...body("bizA"), doc: DOC1, expectedVersionToken: checklistVersionToken(DOC0) }, "u_mgr");
  eq(r.code, 409, "stale token refused"); eq(await raw(docPath(suffix)), env(DOC2), "the newer document kept");
  r = await call(inst, action, { ...body("bizA"), doc: DOC1, expectedVersionToken: checklistVersionToken(DOC2) }, "u_mgr");
  eq(r.code, 200, "current token served"); eq(await raw(docPath(suffix)), env(DOC1), "persisted");
  off();
});

for (const a of apps) await a.delete();
for (const r of results) console.log(`${r.status} ${r.id} ${r.description}${r.notes ? " — " + String(r.notes).split("\n")[0] : ""}`);
console.log(failures ? `FAILED ${failures}` : "ALL CASES PASSED");
process.exit(failures ? 1 : 0);
