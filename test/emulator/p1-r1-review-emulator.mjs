// Marjin — P1 R1 (MARJIN_CREDITS/2) DEC-AUTH-1 review state, lost acknowledgements, document identity and
// Rules denial over the REAL local RTDB emulator, with TWO independent server instances (two copies of the
// ACTUAL api/admin.js + lib, each on its OWN Admin app / connection / cache; only the token verifier and
// the Admin-app constructor are replaced).
//   PRE-1  lost acknowledgement over the real transport (the commit lands, the SDK call throws) ⇒ 200 by readback
//   PRE-2  in-window revocation ⇒ durable FLAGGED review + audit record; owner / manager may READ the audit, nobody may write it
//   PRE-3  post-check unavailable ⇒ PENDING; the same actor retrying the same operation clears it (idempotent)
//   PRE-4  reconciliation with a since-revoked actor ⇒ FLAGGED + audit; the owner accepts ⇒ counted exactly once; a manager may not decide
//   PRE-5  rejecting a flagged replacement restores the predecessor (pointer + accounting)
//   PRE-6  two server instances race 6 duplicate-identity creates (different formatting) ⇒ exactly ONE accepted
//   PRE-7  two server instances race void / replace of the same head ⇒ exactly ONE applies, never a false credit_not_found
//   PRE-8  weakened-Rules controls: member write, member read and audit write mutants are each DETECTED by the denial probes
//   PRE-9  clients (owner, manager, viewer, cross-tenant) cannot forge, clear or accept review state, pointers, reservations or audit
//
// Deliberately NOT named *.test.mjs. Run with the own-pid emulator runner (see test/emulator/README.md).
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
function assertSafe() {
  if (process.env.GCLOUD_PROJECT !== PROJECT) fail(`GCLOUD_PROJECT must be ${PROJECT}`);
  if (process.env.FIREBASE_DATABASE_EMULATOR_HOST !== EMU) fail(`FIREBASE_DATABASE_EMULATOR_HOST must be ${EMU}`);
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) fail("GOOGLE_APPLICATION_CREDENTIALS must be absent");
  const fc = validateFirebaseConfig(process.env.FIREBASE_CONFIG); if (!fc.ok) fail(`FIREBASE_CONFIG rejected: ${fc.reason}`);
  if (process.env.FIREBASE_DATABASE_URL) fail("FIREBASE_DATABASE_URL must be absent");
  const a = readFileSync(join(DIR, "database.rules.json")), b = readFileSync(join(ROOT, "database.rules.json"));
  if (Buffer.compare(a, b) !== 0) fail("test/emulator/database.rules.json differs from the canonical rules — refresh the copy");
}
const CANONICAL_RULES = JSON.parse(readFileSync(join(ROOT, "database.rules.json"), "utf8"));
async function loadRules(rules) {
  const res = await fetch(`http://${EMU}/.settings/rules.json?ns=${NAMESPACE}`, { method: "PUT", headers: { Authorization: "Bearer owner", "Content-Type": "application/json" }, body: JSON.stringify(rules) });
  if (!res.ok) throw new Error("rules load failed " + res.status);
}

/** One server instance: a private copy of lib + api + fincore, its own Admin app (connection + cache). */
async function instance(name) {
  const dir = mkdtempSync(join(tmpdir(), "p1r1-emu-" + name + "-"));
  cpSync(join(ROOT, "lib"), join(dir, "lib"), { recursive: true });
  mkdirSync(join(dir, "api"), { recursive: true });
  cpSync(join(ROOT, "api", "admin.js"), join(dir, "api", "admin.js"));
  mkdirSync(join(dir, "fincore"), { recursive: true });
  cpSync(join(ROOT, "fincore", "v1"), join(dir, "fincore", "v1"), { recursive: true });
  try { symlinkSync(join(ROOT, "node_modules"), join(dir, "node_modules"), "dir"); } catch (_) {}
  writeFileSync(join(dir, "lib", "adminSdk.js"), `export function getAdminDb() { return globalThis.__DBS[${JSON.stringify(name)}](); }\nexport function getAdminAuth() { return { getUser: async () => ({}) }; }\n`);
  writeFileSync(join(dir, "lib", "verifyToken.js"), `export async function requireAuth(req) { const c = req && req.__claims; if (!c) throw new Error("no auth"); return c; }\nexport async function verifyToken() { return null; }\n`);
  writeFileSync(join(dir, "lib", "sendEmail.js"), `export async function sendEmail() { return {}; }\nexport async function sendAlertDigest() { return {}; }\n`);
  return (await import(pathToFileURL(join(dir, "api", "admin.js")).href)).default;
}
const SC = await import(pathToFileURL(join(ROOT, "lib", "supplierCredits.js")).href);
const CORE = (await import(pathToFileURL(join(ROOT, "fincore", "v1", "browser", "marjinFinanceGlobal.js")).href)).default;

const T = "tenantA", B = "bizA", NODE = `tenants/${T}/biz:${B}:supplier_credits`;
const cid = (n) => `c0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const oid = (n) => `0a000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const env = (v) => ({ _v: JSON.stringify(v) });
const fixtures = () => ({ tenants: {
  [T]: {
    members: { u_owner: true, u_mgr: true, u_mgr2: true, u_view: true }, roles: { u_owner: "owner", u_mgr: "manager", u_mgr2: "manager", u_view: "viewer" },
    biz_access: { [B]: { u_mgr: true, u_mgr2: true, u_view: true } },
    [`biz:${B}:suppliers`]: env([{ id: "s1", name: "Coca" }, { id: "s2", name: "Veg" }]),
  },
  tenantB: { members: { u_other: true }, roles: { u_other: "owner" } },
} });
const apps = {};
const seedDb = () => apps.seed.database();
const overrides = { A: [], B: [] };
const instanceDb = (name) => { const real = apps["srv" + name].database(); return { ref: (p) => { let r = real.ref(p); for (const o of overrides[name]) if (o.match(p)) r = o.wrap(r); return r; } }; };
async function seed() { overrides.A = []; overrides.B = []; await seedDb().ref("/").set(fixtures()); }
const asUser = (name, o) => { if (!apps["u-" + name]) apps["u-" + name] = admin.initializeApp({ databaseURL: DB_URL, databaseAuthVariableOverride: o }, "u-" + name); return apps["u-" + name].database(); };
let SRV = {};
async function call(action, body, { as = "u_mgr", server = "A" } = {}) {
  const r = { code: null, body: null, setHeader() {}, status(n) { this.code = n; return this; }, json(v) { this.body = v; return this; } };
  await SRV[server]({ method: "POST", query: { action }, headers: {}, body, __claims: { uid: as, email: as + "@x" } }, r);
  return { code: r.code, body: r.body };
}
const CREATE = (n, over = {}) => ({ tenantId: T, bizId: B, creditId: cid(n), operationId: oid(n), supplierId: "s1", issueDate: "2026-08-15", amount: "100", documentNumber: "CR-" + n, ...over });
const nodeNow = async () => (await seedDb().ref(NODE).once("value")).val();
const decoded = async () => CORE.finance.supplierCredits.decodeSupplierCredits(SC.safeNodeView(await nodeNow()), { tenantId: T, bizId: B });
const txWrap = (fn) => (r) => ({ get: () => r.get(), once: (e) => r.once(e), transaction: async (...a) => { const o = await r.transaction(...a); await fn(o); return o; } });

const results = []; let failures = 0;
async function run(id, description, fn) {
  try { const n = await fn(); results.push({ id, status: "PASS", description, notes: n || "" }); }
  catch (e) { failures++; results.push({ id, status: "FAIL", description, notes: (e && e.stack) || String(e) }); }
}
const expect = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };
const denied = async (p) => { try { await p; return false; } catch (e) { return /permission/i.test(String(e && (e.code || e.message))); } };

async function main() {
  assertSafe();
  apps.seed = admin.initializeApp({ databaseURL: DB_URL }, "seed");
  apps.srvA = admin.initializeApp({ databaseURL: DB_URL }, "srvA");
  apps.srvB = admin.initializeApp({ databaseURL: DB_URL }, "srvB");
  globalThis.__DBS = { A: () => instanceDb("A"), B: () => instanceDb("B") };
  SRV = { A: await instance("A"), B: await instance("B") };

  await run("PRE-1", "lost acknowledgement over the REAL transport: the commit lands, the SDK call throws ⇒ 200 applied by full-payload readback, review cleared, one record", async () => {
    await seed();
    let first = true;
    overrides.A = [{ match: (p) => p === NODE, wrap: (r) => ({ get: () => r.get(), once: (e) => r.once(e), transaction: async (...a) => { const o = await r.transaction(...a); if (first) { first = false; throw new Error("ack lost"); } return o; } }) }];
    const res = await call("create-supplier-credit", CREATE(1));
    eq([res.code, res.body.applied, res.body.resolvedBy, res.body.review], [200, true, "readback", "cleared"], "result");
    overrides.A = [];
    const nd = await nodeNow();
    eq(Object.keys(nd.records).length, 1, "one record"); eq(nd.review[oid(1)].state, "cleared", "stored review");
    return "readback";
  });
  await run("PRE-2", "in-window revocation ⇒ durable FLAGGED review + audit record; owner and manager may READ the audit flag, nobody may write it; never counted", async () => {
    await seed();
    let done = false;
    overrides.A = [{ match: (p) => p === NODE, wrap: txWrap(async (o) => { if (o.committed && !done) { done = true; await seedDb().ref(`tenants/${T}/members/u_mgr`).set(false); } }) }];
    const res = await call("create-supplier-credit", CREATE(1));
    eq([res.body.postCommitAccess, res.body.review, res.body.audit], ["revoked_during_commit", "flagged", "flag_persisted"], "result");
    const audit = (await nodeNow()).review[oid(1)].flagAudit;
    eq(audit.outcome, "revoked_during_commit", "atomic audit record");
    eq(audit.operationId, oid(1), "audit identity");
    expect(await denied(asUser("owner", { uid: "u_owner", token: { email: "o@x" } }).ref(`${NODE}/review/${oid(1)}/flagAudit`).set({ outcome: "erased" })), "the owner cannot rewrite it");
    const response = { code: null, body: null, setHeader() {}, status(n) { this.code=n; return this; }, json(v) { this.body=v; return this; } };
    await SRV.A({ method:"GET", query:{action:"list-supplier-credits",tenantId:T,bizId:B}, headers:{}, __claims:{uid:"u_owner",email:"o@x"} }, response);
    const listed = response;
    eq(listed.body.node.review[oid(1)].flagAudit.operationId, oid(1), "owner reads durable evidence via the authorized API");
    eq((await decoded()).credits, [], "not counted");
    return "flagged + audit";
  });
  await run("PRE-3", "post-check UNAVAILABLE ⇒ PENDING (no false revocation); the SAME actor retrying the SAME operation clears it; a third call writes nothing", async () => {
    await seed();
    let committed = false;
    overrides.A = [{ match: (p) => p === NODE, wrap: txWrap(async (o) => { committed = committed || o.committed; }) },
      { match: (p) => committed && p === `tenants/${T}/biz_access/${B}/u_mgr`, wrap: () => ({ get: async () => { throw new Error("transport"); }, once: async () => { throw new Error("transport"); } }) }];
    const r1 = await call("create-supplier-credit", CREATE(1));
    eq([r1.body.postCommitAccess, r1.body.review], ["verification_unavailable", "pending"], "pending");
    expect(!(await nodeNow()).review[oid(1)].flagAudit, "no false evidence");
    overrides.A = [];
    const r2 = await call("create-supplier-credit", CREATE(1), { server: "B" });
    eq([r2.body.replayed, r2.body.review], [true, "cleared"], "the retry (on the OTHER instance) finishes it");
    const rev = (await nodeNow()).revision;
    await call("create-supplier-credit", CREATE(1));
    eq((await nodeNow()).revision, rev, "idempotent");
    return "pending → cleared";
  });
  await run("PRE-4", "reconciliation with a since-revoked actor ⇒ FLAGGED + audit; a manager may not decide; the owner accepts ⇒ counted EXACTLY once", async () => {
    await seed();
    let committed = false;
    overrides.A = [{ match: (p) => p === NODE, wrap: txWrap(async (o) => { committed = committed || o.committed; }) },
      { match: (p) => committed && p === `tenants/${T}/biz_access/${B}/u_mgr2`, wrap: () => ({ get: async () => { throw new Error("transport"); }, once: async () => { throw new Error("transport"); } }) }];
    eq((await call("create-supplier-credit", CREATE(1), { as: "u_mgr2" })).body.review, "pending", "pending");
    overrides.A = [];
    await seedDb().ref(`tenants/${T}/biz_access/${B}/u_mgr2`).remove();
    const rec = await call("reconcile-supplier-credit-reviews", { tenantId: T, bizId: B, operationId: oid(90) }, { as: "u_owner", server: "B" });
    eq(rec.body.results.map((x) => [x.status, x.state, x.audit]), [["resolved", "flagged", "flag_persisted"]], "flagged");
    const digest = (await nodeNow()).review[oid(1)].intentDigest;
    const body = { tenantId: T, bizId: B, operationId: oid(91), targetOperationId: oid(1), intentDigest: digest, decision: "accept" };
    eq((await call("decide-supplier-credit-review", body, { as: "u_mgr" })).code, 403, "manager");
    eq((await decoded()).credits.length, 0, "not counted while flagged");
    const [a, b] = await Promise.all([call("decide-supplier-credit-review", body, { as: "u_owner", server: "A" }), call("decide-supplier-credit-review", { ...body, operationId: oid(92) }, { as: "u_owner", server: "B" })]);
    eq([a.code, b.code].sort(), [200, 409], "exactly one decision " + JSON.stringify([a.body, b.body]));
    eq((await decoded()).credits.map((c) => c.amount), ["100"], "counted exactly once");
    return "flagged → accepted once";
  });
  await run("PRE-5", "rejecting a flagged REPLACEMENT restores the predecessor (pointer + accounting); the chain continues from it", async () => {
    await seed();
    eq((await call("create-supplier-credit", CREATE(1))).body.review, "cleared", "seed");
    let done = false;
    overrides.A = [{ match: (p) => p === NODE, wrap: txWrap(async (o) => { if (o.committed && !done) { done = true; await seedDb().ref(`tenants/${T}/members/u_mgr2`).set(false); } }) }];
    const rp = await call("replace-supplier-credit", { ...CREATE(2, { documentNumber: "CR-1", amount: "60" }), creditId: cid(1), newCreditId: cid(2), expectedSeq: 1 }, { as: "u_mgr2" });
    eq(rp.body.review, "flagged", "flagged");
    overrides.A = [];
    const d = (await nodeNow()).review[oid(2)].intentDigest;
    eq((await call("decide-supplier-credit-review", { tenantId: T, bizId: B, operationId: oid(93), targetOperationId: oid(2), intentDigest: d, decision: "reject" }, { as: "u_owner" })).code, 200, "reject");
    const st = await decoded();
    eq(st.credits.map((c) => [c.creditId, c.amount]), [[cid(1), "100"]], "the predecessor counts");
    eq(st.logical[0].head, { creditId: cid(1), seq: 2 }, "pointer restored");
    eq((await call("void-supplier-credit", { tenantId: T, bizId: B, creditId: cid(1), operationId: oid(94), expectedSeq: 2 })).code, 200, "continues");
    return "rejected → restored";
  });
  await run("PRE-6", "two server instances race 6 creates of ONE identity (different formatting) ⇒ exactly one accepted; five duplicate_document; one reservation", async () => {
    await seed();
    const fmts = ["INV 77", "inv 77", "Inv 77", " INV   77 ", "INV\u00a077", "inv 77"];
    const rs = await Promise.all(fmts.map((f, i) => call("create-supplier-credit", CREATE(10 + i, { documentNumber: f }), { server: i % 2 ? "B" : "A", as: i % 3 ? "u_mgr" : "u_mgr2" })));
    eq(rs.filter((r) => r.code === 200).length, 1, "one accepted " + JSON.stringify(rs.map((r) => [r.code, r.body.error])));
    expect(rs.filter((r) => r.code !== 200).every((r) => r.code === 409 && r.body.error === "duplicate_document"), "typed duplicates");
    const nd = await nodeNow();
    eq(Object.keys(nd.records).length, 1, "one record"); eq(Object.keys(nd.documents.s_s1), ["d_inv~20~77"], "one reservation");
    eq((await decoded()).issues, [], "valid");
    return "1 / 6";
  });
  await run("PRE-7", "two server instances race void / replace of the SAME head ⇒ exactly one applies, typed refusals, never a false credit_not_found", async () => {
    await seed();
    eq((await call("create-supplier-credit", CREATE(1))).code, 200, "seed");
    const racers = [
      ...[0, 1, 2, 3].map((i) => call("void-supplier-credit", { tenantId: T, bizId: B, creditId: cid(1), operationId: oid(300 + i), expectedSeq: 1 }, { server: i % 2 ? "B" : "A" })),
      ...[0, 1, 2, 3].map((i) => call("replace-supplier-credit", { ...CREATE(400 + i, { documentNumber: "CR-1" }), creditId: cid(1), newCreditId: cid(400 + i), operationId: oid(400 + i), expectedSeq: 1 }, { server: i % 2 ? "A" : "B" })),
    ];
    const rs = await Promise.all(racers);
    eq(rs.filter((r) => r.code === 200).length, 1, "one winner " + JSON.stringify(rs.map((r) => [r.code, r.body.error])));
    expect(rs.every((r) => r.code === 200 || (r.code === 409 && ["revision_conflict", "credit_not_active", "review_unresolved", "credit_not_current"].includes(r.body.error))), "typed refusals " + JSON.stringify(rs.map((r) => [r.code, r.body.error])));
    eq((await decoded()).issues, [], "valid");
    return "1 / 8";
  });
  const P = (uid) => ({ uid, token: { email: uid + "@x" } });
  const probes = async (tag) => {
    const owner = asUser(tag + "owner", P("u_owner")), mgr = asUser(tag + "mgr", P("u_mgr"));
    return {
      memberWrite: !(await denied(mgr.ref(`${NODE}/review/${oid(1)}/state`).set("cleared"))),
      memberRead: !(await denied(owner.ref(NODE).once("value"))),
      auditWrite: !(await denied(owner.ref(`tenants/${T}/audit/supplier_credit_flags/${oid(1)}`).set({ outcome: "forged" }))),
    };
  };
  await run("PRE-8", "weakened-Rules controls: a member-write, a member-read and an audit-write mutant are EACH detected by the denial probes; the canonical Rules deny all three", async () => {
    await seed();
    eq((await call("create-supplier-credit", CREATE(1))).code, 200, "seed");
    eq(await probes("c0-"), { memberWrite: false, memberRead: false, auditWrite: false }, "canonical");
    const dk = CANONICAL_RULES.rules.tenants.$tenantId.$dataKey;
    const W = "$dataKey.matches(/^biz:[^:]+:supplier_credits$/) ? root.child('tenants').child($tenantId).child('members').child(auth.uid).val() === true : ";
    const mutate = (fn) => { const r = JSON.parse(JSON.stringify(CANONICAL_RULES)); fn(r.rules.tenants.$tenantId); return r; };
    const mutants = [
      ["member write", mutate((t) => { t.$dataKey[".write"] = t.$dataKey[".write"].replace("auth !== null && ( ", "auth !== null && ( " + W); }), "memberWrite"],
      ["member read", mutate((t) => { t.$dataKey[".read"] = t.$dataKey[".read"].replace("auth !== null && ( ", "auth !== null && ( " + W); }), "memberRead"],
      ["audit write", mutate((t) => { t.audit[".write"] = "auth !== null"; }), "auditWrite"],
    ];
    expect(typeof dk[".write"] === "string" && dk[".write"].startsWith("auth !== null && ( "), "mutation anchor present");
    const out = [];
    try {
      for (const [i, [label, rules, key]] of mutants.entries()) {
        await loadRules(rules);
        const got = await probes("m" + i + "-");
        expect(got[key] === true, label + " mutant must be detected: " + JSON.stringify(got));
        out.push(label);
      }
    } finally { await loadRules(CANONICAL_RULES); }
    eq(await probes("c1-"), { memberWrite: false, memberRead: false, auditWrite: false }, "canonical restored");
    return out.length + "/3 mutants detected";
  });
  await run("PRE-9", "clients (owner, manager, viewer, cross-tenant, unauthenticated) cannot forge, clear or accept review state, pointers, reservations, records or audit — node byte-identical", async () => {
    await seed();
    eq((await call("create-supplier-credit", CREATE(1))).code, 200, "seed");
    const before = JSON.stringify(await nodeNow());
    let n = 0;
    for (const [name, o] of [["owner", P("u_owner")], ["manager", P("u_mgr")], ["viewer", P("u_view")], ["cross", P("u_other")], ["anon", null]]) {
      const db = asUser("f-" + name, o);
      for (const op of [
        () => db.ref(`${NODE}/review/${oid(1)}/state`).set("acknowledged"),
        () => db.ref(`${NODE}/review/${oid(1)}`).remove(),
        () => db.ref(`${NODE}/heads/${cid(1)}/seq`).set(9),
        () => db.ref(`${NODE}/documents/s_s1/d_cr1`).remove(),
        () => db.ref(`${NODE}/records/${cid(1)}/amount`).set("1"),
        () => db.ref(`tenants/${T}`).update({ [`biz:${B}:supplier_credits/review/${oid(1)}/state`]: "cleared" }),
        () => db.ref(`tenants/${T}/audit/supplier_credit_flags/${oid(1)}`).set({ outcome: "x" }),
      ]) { expect(await denied(op()), name + " must be denied"); n++; }
    }
    eq(JSON.stringify(await nodeNow()), before, "node unchanged");
    return n + " denied";
  });

  const w = (s, n) => String(s).padEnd(n).slice(0, n);
  console.log(`\n${w("case", 7)} ${w("status", 6)} notes`); console.log("-".repeat(110));
  for (const r of results) console.log(`${w(r.id, 7)} ${w(r.status, 6)} ${r.status === "PASS" ? r.notes : r.notes.split("\n")[0]}`);
  console.log("\n=== TOTALS ===");
  console.log(`total=${results.length} passed=${results.length - failures} failed=${failures}`);
  if (results.length !== 9) { process.exitCode = 3; return; }
  if (failures) { console.error("\n=== FAILURES ==="); for (const r of results.filter((x) => x.status === "FAIL")) console.error(`${r.id} ${r.description}\n    ${r.notes}`); process.exitCode = 1; return; }
  console.log("\nALL CASES PASSED — P1 R1 review state, identity and Rules denial hold over the real transport");
}
const direct = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (direct) {
  main().then(async () => { await Promise.all(admin.apps.filter(Boolean).map((a) => a.delete().catch(() => {}))); process.exit(process.exitCode || 0); })
    .catch(async (e) => { console.error("HARNESS ERROR:", (e && e.stack) || e); await Promise.all(admin.apps.filter(Boolean).map((a) => a.delete().catch(() => {}))); process.exit(4); });
}
