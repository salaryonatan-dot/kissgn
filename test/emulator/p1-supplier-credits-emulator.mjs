// Marjin — P1 Supplier Credits (P1 R1, MARJIN_CREDITS/2) over the REAL local RTDB emulator.
//   SCE-A  Rules: the credit node `tenants/{t}/biz:{b}:supplier_credits` (and every child) is
//          client-DENIED for owner, manager (with business access), viewer, a cross-tenant owner
//          and the unauthenticated principal — read, set, update, child write. No Rules change:
//          the existing `$dataKey.beginsWith('biz:') ? false` branch is what denies it. A
//          positive control (the owner may read `biz:{b}:suppliers`) proves the principals work.
//   SCE-B  the ACTUAL api/admin.js handlers over the real Admin transport (only auth / email /
//          Admin-app seams replaced): parallel creates all land (append-safe, one revision each);
//          parallel voids of the SAME head → exactly one applies; a parallel duplicate
//          operation applies once; every review is cleared; the stored node decodes VALID.
//          P1 R1: the review / reservation / pointer children are client-denied as well.
//   SCE-C  the loader reads the node through the real transport and the month report is net.
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
const dir = mkdtempSync(join(tmpdir(), "p1-admin-emu-"));
cpSync(join(ROOT, "lib"), join(dir, "lib"), { recursive: true });
mkdirSync(join(dir, "api"), { recursive: true });
cpSync(join(ROOT, "api", "admin.js"), join(dir, "api", "admin.js"));
mkdirSync(join(dir, "fincore"), { recursive: true });
cpSync(join(ROOT, "fincore", "v1"), join(dir, "fincore", "v1"), { recursive: true });
try { symlinkSync(join(ROOT, "node_modules"), join(dir, "node_modules"), "dir"); } catch (_) {}
writeFileSync(join(dir, "lib", "adminSdk.js"), `export function getAdminDb() { return globalThis.__DB(); }\nexport function getAdminAuth() { return { getUser: async () => ({}) }; }\n`);
writeFileSync(join(dir, "lib", "verifyToken.js"), `export async function requireAuth() { if (!globalThis.__CLAIMS) throw new Error("no auth"); return globalThis.__CLAIMS; }\nexport async function verifyToken() { return globalThis.__CLAIMS; }\n`);
writeFileSync(join(dir, "lib", "sendEmail.js"), `export async function sendEmail() { return { messageId: "m" }; }\nexport async function sendAlertDigest() { return { messageId: "d" }; }\n`);
const handler = (await import(pathToFileURL(join(dir, "api", "admin.js")).href)).default;
const SC = await import(pathToFileURL(join(ROOT, "lib", "supplierCredits.js")).href);
const CORE = (await import(pathToFileURL(join(ROOT, "fincore", "v1", "browser", "marjinFinanceGlobal.js")).href)).default;
const FIX = await import(pathToFileURL(join(ROOT, "test", "support", "p1-credit-fixtures.mjs")).href);

const T = "tenantA", B = "bizA", NODE = `tenants/${T}/biz:${B}:supplier_credits`;
const cid = (n) => `c0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const oid = (n) => `0a000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const env = (v) => ({ _v: JSON.stringify(v) });
const fixtures = () => ({
  tenants: {
    [T]: {
      members: { u_owner: true, u_mgr: true, u_view: true }, roles: { u_owner: "owner", u_mgr: "manager", u_view: "viewer" },
      biz_access: { [B]: { u_mgr: true, u_view: true } },
      [`biz:${B}:suppliers`]: env([{ id: "s1", name: "Coca" }]),
      [`biz:${B}:entries`]: env(Array.from({ length: 31 }, (_, i) => ({ id: `e0000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`, date: `2026-08-${String(i + 1).padStart(2, "0")}`, sales: "1000", supplier_payments: { s1: i < 30 ? "300" : "0" }, payroll: "100" }))),
      [`biz:${B}:config`]: env({}),
      app: { business: env([{ id: B, name: "Biz" }]) },
    },
    tenantB: { members: { u_other: true }, roles: { u_other: "owner" } },
  },
  user_tenants: { u_owner: T, u_mgr: T, u_view: T, u_other: "tenantB" },
});
const apps = {};
const seedDb = () => apps.seed.database();
async function seed(extra) { await seedDb().ref("/").set(fixtures()); if (extra) await seedDb().ref(NODE).set(extra); globalThis.__DB = () => seedDb(); }
const asUser = (name, override) => { if (!apps[name]) apps[name] = admin.initializeApp({ databaseURL: DB_URL, databaseAuthVariableOverride: override }, name); return apps[name].database(); };
async function call(action, body, claims = { uid: "u_owner", email: "o@x" }, method = "POST", query = {}) {
  globalThis.__CLAIMS = claims;
  const r = { code: null, body: null, setHeader() {}, status(n) { this.code = n; return this; }, json(v) { this.body = v; return this; }, end() { return this; } };
  await handler({ method, query: { action, ...query }, headers: { authorization: "Bearer t" }, body }, r);
  return { code: r.code, body: r.body };
}
const CREATE = (n, over = {}) => ({ tenantId: T, bizId: B, creditId: cid(n), operationId: oid(n), supplierId: "s1", issueDate: "2026-08-15", amount: "10", documentNumber: "CR-" + n, ...over });

const results = []; let failures = 0;
async function run(id, description, fn) {
  try { const n = await fn(); results.push({ id, status: "PASS", description, notes: n || "" }); }
  catch (e) { failures++; results.push({ id, status: "FAIL", description, notes: (e && e.stack) || String(e) }); }
}
const expect = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => { if (a !== b) throw new Error(`${m}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };
const denied = async (p) => { try { await p; return false; } catch (e) { return /permission/i.test(String(e && (e.code || e.message))); } };
const allowed = async (p) => { try { await p; return true; } catch (_) { return false; } };

async function main() {
  assertSafe();
  apps.seed = admin.initializeApp({ databaseURL: DB_URL }, "seed");
  const PRINCIPALS = [
    ["owner", { uid: "u_owner", token: { email: "o@x" } }], ["manager", { uid: "u_mgr", token: { email: "m@x" } }],
    ["viewer", { uid: "u_view", token: { email: "v@x" } }], ["cross-tenant owner", { uid: "u_other", token: { email: "x@x" } }], ["unauthenticated", null],
  ];
  const STORED = FIX.creditNode([FIX.spec(1, "s1", "2026-08-15", "300")], { tenantId: T, bizId: B });

  await run("SCE-A1", "Rules: every client principal is DENIED read of the credit node and of each child (records, operations, schemaVersion)", async () => {
    await seed(STORED);
    let n = 0;
    for (const [name, o] of PRINCIPALS) {
      const db = asUser("r-" + name, o);
      for (const p of [NODE, NODE + "/records", NODE + `/records/${cid(1)}`, NODE + "/operations", NODE + "/schemaVersion", NODE + "/review", NODE + "/documents", NODE + "/heads", NODE + "/voids"]) { expect(await denied(db.ref(p).once("value")), `${name} read ${p} must be denied`); n++; }
    }
    return n + " reads denied";
  });
  await run("SCE-A2", "Rules: every client principal is DENIED set / update / child write / remove of the credit node — the stored node is byte-identical afterwards", async () => {
    await seed(STORED); const before = JSON.stringify((await seedDb().ref(NODE).once("value")).val());
    let n = 0;
    for (const [name, o] of PRINCIPALS) {
      const db = asUser("w-" + name, o);
      const ops = [
        () => db.ref(NODE).set({ schemaVersion: 1, revision: 9, records: {} }),
        () => db.ref(NODE).update({ revision: 9 }),
        () => db.ref(NODE + `/records/${cid(2)}`).set({ creditId: cid(2), supplierId: "s1", issueDate: "2026-08-16", amount: "-300", status: "active", revision: 1 }),
        () => db.ref(NODE + `/records/${cid(1)}/amount`).set("3"),
        () => db.ref(NODE + "/schemaVersion").set(2),
        () => db.ref(NODE).remove(),
        () => db.ref(`tenants/${T}`).update({ [`biz:${B}:supplier_credits/revision`]: 5 }),
        () => db.ref(NODE + `/review/${oid(1)}/state`).set("cleared"),
        () => db.ref(NODE + `/review/${oid(1)}`).set({ state: "acknowledged" }),
        () => db.ref(NODE + "/heads").remove(),
        () => db.ref(NODE + "/documents/s_s1/d_cr1").remove(),
        () => db.ref(`tenants/${T}/audit/supplier_credit_flags/${oid(1)}`).set({ outcome: "forged" }),
      ];
      for (const op of ops) { expect(await denied(op()), `${name} write must be denied`); n++; }
    }
    eq(JSON.stringify((await seedDb().ref(NODE).once("value")).val()), before, "node unchanged");
    return n + " writes denied";
  });
  await run("SCE-A3", "positive control: the same principals ARE evaluated (owner and the manager with business access may read biz:{b}:suppliers; the cross-tenant owner may not)", async () => {
    await seed();
    expect(await allowed(asUser("r-owner", PRINCIPALS[0][1]).ref(`tenants/${T}/biz:${B}:suppliers`).once("value")), "owner reads suppliers");
    expect(await allowed(asUser("r-manager", PRINCIPALS[1][1]).ref(`tenants/${T}/biz:${B}:suppliers`).once("value")), "manager reads suppliers");
    expect(await denied(asUser("r-cross-tenant owner", PRINCIPALS[3][1]).ref(`tenants/${T}/biz:${B}:suppliers`).once("value")), "cross-tenant denied");
    return "principals effective";
  });
  await run("SCE-A4", "legacy credit data remains readable but every new client write, including a parent update, is denied", async () => {
    await seed();
    const legacy = `tenants/${T}/biz:${B}:credits`;
    const old = { _v: JSON.stringify([{ id: "legacy-1", amount: "10" }]) };
    await seedDb().ref(legacy).set(old);
    for (const [name, o] of PRINCIPALS) {
      const db = asUser("legacy-" + name, o);
      if (name === "owner" || name === "manager") eq(JSON.stringify((await db.ref(legacy).once("value")).val()), JSON.stringify(old), name + " read compatibility");
      for (const op of [() => db.ref(legacy).set({ _v: "[]" }), () => db.ref(`${legacy}/_v`).set("[]"),
        () => db.ref(`tenants/${T}`).update({ [`biz:${B}:credits/_v`]: "[]" }), () => db.ref(legacy).remove()])
        expect(await denied(op()), name + " legacy mutation denied");
    }
    eq(JSON.stringify((await seedDb().ref(legacy).once("value")).val()), JSON.stringify(old), "legacy bytes preserved");
    return "legacy read retained, writes denied";
  });

  await run("SCE-B1", "parallel creates (12) all land over the real transaction: 12 records, 12 ledger entries, 12 CLEARED reviews; the node decodes VALID", async () => {
    await seed();
    const rs = await Promise.all(Array.from({ length: 12 }, (_, i) => call("create-supplier-credit", CREATE(i + 1, { amount: String(i + 1) }))));
    for (const r of rs) eq(r.code, 200, JSON.stringify(r.body));
    const nd = (await seedDb().ref(NODE).once("value")).val();
    eq(nd.revision, 24, "one revision per create + one per post-commit clearance"); eq(Object.keys(nd.records).length, 12, "records"); eq(Object.keys(nd.operations).length, 12, "ops");
    expect(Object.values(nd.review).every((r) => r.state === "cleared"), "every review cleared");
    const st = CORE.finance.supplierCredits.decodeSupplierCredits(SC.safeNodeView(nd), { tenantId: T, bizId: B });
    eq(st.state, "present", "decoded"); eq(st.issues.length, 0, "no invalid record"); eq(st.credits.length, 12, "all counted");
    return "12/12 applied";
  });
  await run("SCE-B2", "parallel voids / replaces of the SAME head: exactly ONE applies, every other is a typed 409 with no change (never a false credit_not_found)", async () => {
    await seed();
    eq((await call("create-supplier-credit", CREATE(1))).code, 200, "seed credit");
    const racers = [
      ...Array.from({ length: 4 }, (_, i) => call("void-supplier-credit", { tenantId: T, bizId: B, creditId: cid(1), operationId: oid(100 + i), expectedSeq: 1 })),
      ...Array.from({ length: 4 }, (_, i) => call("replace-supplier-credit", { ...CREATE(200 + i, { documentNumber: "CR-1" }), creditId: cid(1), newCreditId: cid(200 + i), operationId: oid(200 + i), expectedSeq: 1 })),
    ];
    const rs = await Promise.all(racers);
    const ok = rs.filter((r) => r.code === 200), lost = rs.filter((r) => r.code === 409);
    eq(ok.length, 1, "exactly one winner " + JSON.stringify(rs.map((r) => [r.code, r.body && r.body.error]))); eq(lost.length, 7, "seven typed conflicts " + JSON.stringify(rs.map((r) => [r.code, r.body && r.body.error])));
    for (const r of lost) expect(["revision_conflict", "credit_not_active", "review_unresolved", "credit_not_current"].includes(r.body.error), r.body.error);
    const nd = (await seedDb().ref(NODE).once("value")).val();
    eq(Object.keys(nd.operations).length, 2, "the create + exactly one applied mutation"); eq(Object.keys(nd.voids).length, 1, "one void / replace event");
    const st = CORE.finance.supplierCredits.decodeSupplierCredits(SC.safeNodeView(nd), { tenantId: T, bizId: B });
    eq(st.issues.length, 0, "valid"); eq(st.credits.length, ok[0].body.result.newCreditId ? 1 : 0, "at most the one replacement counts");
    return "1 applied, 7 refused";
  });
  await run("SCE-B3", "a duplicated operation (same operationId + body, in parallel) applies ONCE; the other replays; a reused operationId with another body is idempotency_conflict", async () => {
    await seed();
    const [a, b] = await Promise.all([call("create-supplier-credit", CREATE(1)), call("create-supplier-credit", CREATE(1))]);
    eq(a.code, 200, "a"); eq(b.code, 200, "b");
    eq([a.body.applied, b.body.applied].filter(Boolean).length, 1, "applied once"); eq([a.body.replayed, b.body.replayed].filter(Boolean).length, 1, "replayed once");
    const nd3 = (await seedDb().ref(NODE).once("value")).val();
    eq(Object.keys(nd3.operations).length, 1, "one operation"); eq(Object.keys(nd3.records).length, 1, "one record"); eq(nd3.review[oid(1)].state, "cleared", "cleared once");
    const c = await call("create-supplier-credit", CREATE(1, { amount: "11" })); eq(c.code, 409, "conflict"); eq(c.body.error, "idempotency_conflict", "code");
    return "exactly-once";
  });
  await run("SCE-B4", "authorization over the real transport: viewer / cross-tenant / unauthenticated writes refused and nothing stored; the viewer may list; the list never returns the operation ledger", async () => {
    await seed();
    eq((await call("create-supplier-credit", CREATE(1), { uid: "u_view", email: "v@x" })).code, 403, "viewer");
    eq((await call("create-supplier-credit", CREATE(1), { uid: "u_other", email: "x@x" })).code, 403, "cross-tenant");
    eq((await call("create-supplier-credit", CREATE(1), null)).code, 401, "unauthenticated");
    expect(!(await seedDb().ref(NODE).once("value")).exists(), "nothing stored");
    eq((await call("create-supplier-credit", CREATE(2), { uid: "u_mgr", email: "m@x" })).code, 200, "manager with business access");
    const l = await call("list-supplier-credits", undefined, { uid: "u_view", email: "v@x" }, "GET", { tenantId: T, bizId: B });
    eq(l.code, 200, "viewer lists"); eq(l.body.node.operations, undefined, "no ledger"); expect(l.body.node.records[cid(2)], "record listed");
    return "denials + viewer list";
  });
  await run("SCE-C1", "the canonical server loader reads the stored node through the real transport; the August report is NET (9,000 − credits)", async () => {
    await seed();
    eq((await call("create-supplier-credit", CREATE(1, { amount: "300" }))).code, 200, "credit");
    const { compileServer } = await import(pathToFileURL(join(ROOT, "test", "support", "server-reader-harness.mjs")).href);
    const srv = compileServer();
    const CI = await srv.import("src/finance-server/canonicalInputs.js"), CM = await srv.import("src/finance-server/canonicalMetrics.js");
    const si = await CI.loadCanonicalInputs(seedDb(), T, B, { site: "emu", nowMs: Date.UTC(2026, 8, 29, 9), need: { config: true, fixed: true, exceptions: true } });
    eq(si.supplierCreditsState, "present", "state");
    const rep = CM.canonicalMonthReport(si, { kind: "closed_month", month: "2026-08" }).report;
    eq(rep.actual.purchases.value, "8700", "net"); eq(rep.actual.purchases.gross.value, "9000", "gross");
    return "net 8700";
  });

  const w = (s, n) => String(s).padEnd(n).slice(0, n);
  console.log(`\n${w("case", 7)} ${w("status", 6)} notes`); console.log("-".repeat(110));
  for (const r of results) console.log(`${w(r.id, 7)} ${w(r.status, 6)} ${r.status === "PASS" ? r.notes : r.notes.split("\n")[0]}`);
  console.log("\n=== TOTALS ===");
  console.log(`total=${results.length} passed=${results.length - failures} failed=${failures}`);
  if (results.length !== 9) { process.exitCode = 3; return; }
  if (failures) { console.error("\n=== FAILURES ==="); for (const r of results.filter((x) => x.status === "FAIL")) console.error(`${r.id} ${r.description}\n    ${r.notes}`); process.exitCode = 1; return; }
  console.log("\nALL CASES PASSED — supplier credits are server-mediated, client-denied and exactly-once over the real emulator");
}

const direct = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (direct) {
  main().then(async () => { await Promise.all(admin.apps.filter(Boolean).map((a) => a.delete().catch(() => {}))); })
        .catch(async (e) => { console.error("HARNESS ERROR:", (e && e.stack) || e); process.exitCode = 4; await Promise.all(admin.apps.filter(Boolean).map((a) => a.delete().catch(() => {}))); });
}
