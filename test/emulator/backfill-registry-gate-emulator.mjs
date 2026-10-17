// Marjin — PROPOSED operator-backfill registry gate (independent I6 review I6-R-03 / R6-6; T-BF-GATE, a lane SEPARATE from I7 — it
// changes scripts/backfill-biz-access.mjs, a stored-data script the S0 server-reader / VAT-invariant guards forbid changing without an
// owner-accepted transition). The ACTUAL scripts/backfill-biz-access.mjs apply flow (runBackfill) over the REAL local Admin SDK transport
// (firebase-admin → RTDB emulator, demo namespace): plans only registered targets; --apply refuses any refused target, a missing /
// foreign digest and a drift between approval and write; the approved plan writes exactly its grants; cleanup semantics unchanged.
//
// Deliberately NOT named *.test.mjs. Host run (on a copy with proposed/backfill-registry-gate.patch applied):
//   bash test/support/p1-r7-emu-run.sh <checkout> <abs logs> bf-gate=test/emulator/backfill-registry-gate-emulator.mjs
import admin from "firebase-admin";
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

const BF = await import(pathToFileURL(join(ROOT, "scripts", "backfill-biz-access.mjs")).href);

const app = admin.initializeApp({ databaseURL: DB_URL, projectId: PROJECT }, "bf-gate-" + process.pid);
const db = app.database();
const otherApp = admin.initializeApp({ databaseURL: DB_URL, projectId: PROJECT }, "bf-gate-other-" + process.pid);
const other = otherApp.database();
const env = (v) => ({ _v: JSON.stringify(v) });
const REGS = {
  registered: env([{ id: "bizA", name: "Alpha" }, { id: "bizB", name: "Beta" }]),
  twin: env([{ id: "bizA" }, { id: " bizA " }, { id: "bizB" }]),
  unregistered: env([{ id: "bizB" }]),
  bareArray: [{ id: "bizA" }, { id: "bizB" }],
};
const readAll = async () => JSON.stringify((await db.ref("/").once("value")).val());
const results = []; let failures = 0;
async function run(id, description, fn) {
  try { const n = await fn(); results.push({ id, status: "PASS", description, notes: n || "" }); }
  catch (e) { failures++; results.push({ id, status: "FAIL", description, notes: (e && e.stack) || String(e) }); }
}
const eq = (a, b, m) => { const x = JSON.stringify(a), y = JSON.stringify(b); if (x !== y) throw new Error(`${m}: expected ${y}, got ${x}`); };
const val = async (p) => (await db.ref(p).once("value")).val();
const silent = () => {};
const tenantsWith = (businessByTenant) => ({ tenants: Object.fromEntries(Object.entries(businessByTenant).map(([t, business]) => [t, {
  roles: { uMgr: "manager", uOwn: "owner" }, members: { uMgr: true, uOwn: true },
  app: { ...(business === null ? {} : { business }), users: env([{ firebaseUid: "uMgr", role: "manager", allowedBizIds: ["bizA"] }, { firebaseUid: "uOwn", role: "owner", allowedBizIds: null }]) },
}])) });
const ARGS = (extra = []) => BF.parseArgs(["--env=emu", `--project=${PROJECT}`, ...extra]);
await run("BFE-01", "backfill apply over the real transport: plans only registered targets; --apply refuses any refused target, a missing / foreign digest and a drift between approval and write; the approved plan writes exactly its grants", async () => {
  // a tenant whose registry cannot register bizA → refused; --apply refuses and writes nothing
  for (const [label, reg] of [["absent", null], ["bare array", REGS.bareArray], ["twin", REGS.twin], ["unregistered", REGS.unregistered]]) {
    await db.ref("/").set(tenantsWith({ tOk: REGS.registered, tBad: reg })); const before = await readAll();
    const plan = BF.planBackfill((await db.ref("tenants").once("value")).val());
    eq([Object.keys(plan.updates), plan.refused.map((x) => x.path)], [["tenants/tOk/biz_access/bizA/uMgr"], ["tenants/tBad/biz_access/bizA/uMgr"]], label + ": plan");
    const code = await BF.runBackfill(db, ARGS(["--apply", `--confirm-production=${PROJECT}`, `--expect-plan=${BF.planDigest(plan)}`]), PROJECT, silent);
    eq(code, 5, label + ": apply refused"); eq(await readAll(), before, label + ": nothing written");
  }
  // every target registered: dry-run prints the digest; the matching digest applies exactly the plan; a foreign digest is refused
  await db.ref("/").set(tenantsWith({ tOk: REGS.registered, tOk2: REGS.registered })); let before = await readAll();
  const plan = BF.planBackfill((await db.ref("tenants").once("value")).val()); const digest = BF.planDigest(plan);
  const logs = []; eq(await BF.runBackfill(db, ARGS(), PROJECT, (l) => logs.push(l)), 0, "dry-run"); eq(await readAll(), before, "dry-run writes nothing");
  if (!logs.some((l) => l.includes(digest))) throw new Error("dry-run must print the plan digest");
  eq(await BF.runBackfill(db, ARGS(["--apply", `--confirm-production=${PROJECT}`]), PROJECT, silent), 5, "no digest"); eq(await readAll(), before, "no digest: nothing written");
  eq(await BF.runBackfill(db, ARGS(["--apply", `--confirm-production=${PROJECT}`, "--expect-plan=" + "0".repeat(64)]), PROJECT, silent), 5, "foreign digest"); eq(await readAll(), before, "foreign digest: nothing written");
  // drift: the registry changes AFTER the approval (the dry-run digest) → the apply re-derives and refuses
  await db.ref("tenants/tOk2/app/business").set(REGS.twin); before = await readAll();
  eq(await BF.runBackfill(db, ARGS(["--apply", `--confirm-production=${PROJECT}`, `--expect-plan=${digest}`]), PROJECT, silent), 5, "drift"); eq(await readAll(), before, "drift: nothing written");
  await db.ref("tenants/tOk2/app/business").set(REGS.registered);
  eq(await BF.runBackfill(db, ARGS(["--apply", `--confirm-production=${PROJECT}`, `--expect-plan=${digest}`]), PROJECT, silent), 0, "approved plan applies");
  eq([await val("tenants/tOk/biz_access/bizA/uMgr"), await val("tenants/tOk2/biz_access/bizA/uMgr"), await val("tenants/tOk/biz_access/bizA/uOwn")], [true, true, null], "exactly the planned grants (owners skipped)");
  // cleanup semantics unchanged: an existing grant to a REFUSED business is not 'unexpected' (cleanup never removes it)
  await db.ref("/").set(tenantsWith({ tBad: REGS.twin })); await db.ref("tenants/tBad/biz_access/bizA/uMgr").set(true); await db.ref("tenants/tBad/biz_access/bizZ/uMgr").set(true);
  eq(await BF.runBackfill(db, ARGS(["--cleanup", `--confirm-production=${PROJECT}`]), PROJECT, silent), 0, "cleanup");
  eq([await val("tenants/tBad/biz_access/bizA/uMgr"), await val("tenants/tBad/biz_access/bizZ/uMgr")], [true, null], "cleanup removes only the non-derived grant");
  return "4 refusing tenants, digest / drift gates, exact apply, unchanged cleanup";
});

await run("BFE-02", "two independent Admin clients: registry changes after a transaction's first pass; retry reclassifies and refuses without a grant", async () => {
  const state = tenantsWith({ tOk: REGS.registered });
  state.tenants.tOk.app["biz:bizA:entries"] = { _v: "untouched" };
  await other.ref("/").set(state);
  const plan = BF.planBackfill(state.tenants), args = ARGS(["--apply", `--confirm-production=${PROJECT}`, `--expect-plan=${BF.planDigest(plan)}`]);
  let callbacks = 0, first;
  const firstPass = new Promise((r) => { first = r; });
  const wrapped = { ref: (path) => {
    const ref = db.ref(path);
    if (path !== "tenants") return ref;
    return { once: (...xs) => ref.once(...xs), on: (...xs) => ref.on(...xs), off: (...xs) => ref.off(...xs), transaction: async (fn, ...rest) => {
      db.goOffline();
      const pending = ref.transaction((value) => { callbacks++; const output = fn(value); first(); return output; }, ...rest);
      try { await firstPass; await other.ref("tenants/tOk/app/business").set(REGS.twin); }
      finally { db.goOnline(); }
      return pending;
    } };
  } };
  eq(await BF.runBackfill(wrapped, args, PROJECT, silent), 5, "changed registry refuses on retry");
  if (callbacks < 2) throw new Error("race did not prove a transaction retry against the other client's committed state");
  eq(await val("tenants/tOk/biz_access"), null, "zero grant written");
  eq(await val("tenants/tOk/app/biz:bizA:entries"), { _v: "untouched" }, "business document preserved");
  eq(await val("tenants/tOk/app/business"), REGS.twin, "other client's change preserved");
  return `${callbacks} transaction passes; no grant`;
});

await run("BFE-03", "actual entry path refuses unreadable snapshot and embedded invalid identities; exact whitespace and tenant-colon inputs retain identity", async () => {
  for (const bad of ["biz:A", "biz\u0000", "biz\u007f", 7, null]) {
    const state = tenantsWith({ "tenant:A": REGS.registered });
    state.tenants["tenant:A"].app.users = env([{ firebaseUid: "uMgr", role: "viewer", allowedBizIds: ["bizA", bad] }]);
    await other.ref("/").set(state); const before = await readAll();
    const plan = BF.planBackfill(state.tenants);
    eq(await BF.runBackfill(db, ARGS(["--apply", `--confirm-production=${PROJECT}`, `--expect-plan=${BF.planDigest(plan)}`]), PROJECT, silent), 5, "invalid identity refuses");
    eq(await readAll(), before, "invalid identity writes nothing");
  }
  const state = tenantsWith({ "tenant:A": env([{ id: " bizA " }]) });
  state.tenants["tenant:A"].app.users = env([{ firebaseUid: "u:1", role: "viewer", allowedBizIds: [" bizA "] }]);
  await other.ref("/").set(state); const before = await readAll();
  const plan = BF.planBackfill(state.tenants), args = ARGS(["--apply", `--confirm-production=${PROJECT}`, `--expect-plan=${BF.planDigest(plan)}`]);
  let failed = false;
  try { await BF.runBackfill({ ref: () => ({ once: async () => { throw new Error("snapshot unavailable"); } }) }, args, PROJECT, silent); }
  catch (e) { failed = /snapshot unavailable/.test(e.message); }
  eq(failed, true, "read failure remains an error"); eq(await readAll(), before, "read failure writes nothing");
  eq(await BF.runBackfill(db, args, PROJECT, silent), 0, "exact registered identity applies");
  eq(await val("tenants/tenant:A/biz_access/ bizA /u:1"), true, "exact whitespace id and colon tenant/uid preserved");
  eq(await val("tenants/tenant:A/biz_access/bizA"), null, "never aliased to trimmed business");
});

await otherApp.delete();
await app.delete();
for (const r of results) console.log(`${r.status} ${r.id} ${r.description}${r.notes ? " — " + String(r.notes).split("\n")[0] : ""}`);
console.log(failures ? `FAILED ${failures}` : "ALL CASES PASSED");
process.exit(failures ? 1 : 0);
