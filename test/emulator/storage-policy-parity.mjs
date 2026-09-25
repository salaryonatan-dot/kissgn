// Marjin — P0-DATA-01 VERSION FENCE R1: PARSER ↔ RULES PARITY on the REAL RTDB emulator.
//
// One fixture matrix (test/support/policy-fixtures.mjs) drives two enforcement points:
//   • lib/storagePolicy.js#parsePolicyRecord (asserted here as well), and
//   • the FENCE_GUARD `VALID` predicate in database.rules.json, probed with ordinary member auth.
// For every INVALID record (hand-written + generated type mutants): parser rejects it, Rules
// deny the OWNER and the MANAGER legacy write (set and CAS) on a legacy node AND a V2 row write
// on a V2 node, and the authoritative node is byte-identical afterwards. For every VALID record:
// parser accepts it and the server behaves per phase (legacy allows; quiesced/recovery_hold deny;
// v2_active denies legacy shapes and admits V2 rows).
//
// Deliberately NOT named *.test.mjs. Host run: see test/emulator/README.md.

import admin from "firebase-admin";
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { validateFirebaseConfig } from "./rtdb-authorization-matrix.mjs";
import { parsePolicyRecord } from "../../lib/storagePolicy.js";
import { VALID_POLICIES, INVALID_POLICIES, generatedMutants, rtdbNormalize } from "../support/policy-fixtures.mjs";

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

const hx = (n, l) => (n >>> 0).toString(16).padStart(l, "0").slice(-l);
const hash = (s) => { let h = 2166136261; for (let i = 0; i < String(s).length; i++) { h ^= String(s).charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
const uuid = (seed) => { const a = hash("a" + seed), b = hash("b" + seed); return `${hx(a,8)}-${hx(b,4)}-4${hx(a,3)}-8${hx(b,3)}-${hx(a,6)}${hx(b,6)}`; };
const ID1 = uuid("p1"), ID2 = uuid("p2");
const row = (id, date, sales) => ({ id, date, sales, deliveries: 0, other_income: 0 });
const LEGACY = () => ({ _v: JSON.stringify([row(ID1, "2026-08-01", 101)]) });
const V2NODE = () => ({ schemaVersion: 2, generation: 1, rows: { [ID1]: { ...row(ID1, "2026-08-01", 101), _gen: 1 } }, _v: JSON.stringify([row(ID1, "2026-08-01", 101)]) });
const PATH = "tenants/tenantA/biz:bizA:entries", CTRL = "storage_v2_control/tenantA/bizA";
const apps = {};
const seedDb = () => apps.seed.database();
const base = () => ({ tenants: { tenantA: { members: { u_owner: true, u_manager: true }, roles: { u_owner: "owner", u_manager: "manager" }, biz_access: { bizA: { u_manager: true } } } } });
async function seed(node, record) {
  const f = base(); f.tenants.tenantA["biz:bizA:entries"] = node;
  const norm = rtdbNormalize(record);
  if (norm !== undefined) f.storage_v2_control = { tenantA: { bizA: norm } };
  await seedDb().ref("/").set(f);
}
const snapshot = async () => JSON.stringify((await seedDb().ref(PATH).once("value")).val());
const denied = (e) => /permission[_ ]denied/i.test(String((e && (e.message || "")) + (e && e.code || "")));
async function attempt(fn) { try { const r = await fn(); if (r && typeof r === "object" && r.committed === false) return "aborted"; return "allow"; } catch (e) { return denied(e) ? "deny" : "error:" + (e && e.message); } }
const legacyShapes = (who) => ({
  [`${who} set {_v}`]: () => apps[who].database().ref(PATH).set({ _v: JSON.stringify([row(ID2, "2026-08-02", 5)]) }),
  [`${who} CAS → {_v}`]: () => apps[who].database().ref(PATH).transaction(() => ({ _v: JSON.stringify([row(ID2, "2026-08-02", 6)]) }), undefined, false).then((r) => { if (!r.committed) throw Object.assign(new Error("permission_denied"), { code: "PERMISSION_DENIED" }); return r; }),
});
const v2Shape = (who) => ({ [`${who} V2 row set`]: () => apps[who].database().ref(PATH + "/rows/" + ID2).set({ ...row(ID2, "2026-08-02", 7), _gen: 1 }) });

const results = []; let failures = 0;
function record(id, name, pass, notes) { results.push({ id, name, status: pass ? "PASS" : "FAIL", notes }); if (!pass) failures++; }

async function main() {
  assertSafe();
  apps.seed = admin.initializeApp({ databaseURL: DB_URL }, "seed");
  apps.owner = admin.initializeApp({ databaseURL: DB_URL, databaseAuthVariableOverride: { uid: "u_owner", token: { email: "o@demo.example" } } }, "owner");
  apps.manager = admin.initializeApp({ databaseURL: DB_URL, databaseAuthVariableOverride: { uid: "u_manager", token: { email: "m@demo.example" } } }, "manager");

  // ── INVALID: parser rejects, Rules deny every shape for every role, node byte-identical ──
  const invalid = [...INVALID_POLICIES, ...generatedMutants()];
  let i = 0;
  for (const f of invalid) {
    i++; const id = `PI-${String(i).padStart(3, "0")}`;
    const notes = [];
    let pass = true;
    const parsed = parsePolicyRecord(f.record);
    if (parsed.status !== f.parser) { pass = false; notes.push(`parser ${parsed.status} ≠ ${f.parser}`); }
    // legacy node: owner + manager × set + CAS
    await seed(LEGACY(), f.record);
    const stored = (await seedDb().ref(CTRL).once("value")).val();
    if (stored === null) { pass = false; notes.push("record vanished on the server (fixture is not RTDB-deliverable)"); }
    else if (parsePolicyRecord(stored).status === "valid") { pass = false; notes.push("server-stored form parses VALID"); }
    let before = await snapshot();
    for (const who of ["owner", "manager"]) for (const [name, fn] of Object.entries(legacyShapes(who))) {
      const r = await attempt(fn); if (r !== "deny") { pass = false; notes.push(`${name}: ${r}`); }
      const after = await snapshot(); if (after !== before) { pass = false; notes.push(`${name}: node changed`); before = after; }
    }
    // V2 node: owner row write
    await seed(V2NODE(), f.record);
    before = await snapshot();
    for (const [name, fn] of Object.entries(v2Shape("owner"))) {
      const r = await attempt(fn); if (r !== "deny") { pass = false; notes.push(`${name}: ${r}`); }
      if ((await snapshot()) !== before) { pass = false; notes.push(`${name}: node changed`); }
    }
    record(id, f.name, pass, pass ? `parser=${parsed.status}; deny ×5; node intact` : notes.join("; "));
  }

  // ── VALID: parser accepts, server behaves per phase ──
  let v = 0;
  for (const f of VALID_POLICIES) {
    v++; const id = `PV-${String(v).padStart(2, "0")}`;
    const notes = []; let pass = true;
    const parsed = parsePolicyRecord(f.record);
    if (parsed.status !== "valid") { pass = false; notes.push("parser " + parsed.status); }
    await seed(LEGACY(), f.record);
    const want = f.expect === "allow" ? "allow" : "deny";
    for (const who of ["owner", "manager"]) {
      const r = await attempt(legacyShapes(who)[`${who} set {_v}`]);
      if (r !== want) { pass = false; notes.push(`${who} legacy set: ${r} (want ${want})`); }
      await seed(LEGACY(), f.record);
    }
    if (f.record.phase === "v2_active") {
      await seed(V2NODE(), f.record);
      for (const who of ["owner", "manager"]) { const r = await attempt(v2Shape(who)[`${who} V2 row set`]); if (r !== "allow") { pass = false; notes.push(`${who} V2 row: ${r}`); } await seed(V2NODE(), f.record); }
      const r = await attempt(legacyShapes("owner")["owner set {_v}"]); if (r !== "deny") { pass = false; notes.push("legacy overwrite of V2 under v2_active: " + r); }
    }
    if (f.record.phase === "quiesced" || f.record.phase === "recovery_hold") {
      await seed(V2NODE(), f.record);
      const r = await attempt(v2Shape("owner")["owner V2 row set"]); if (r !== "deny") { pass = false; notes.push("V2 row under " + f.record.phase + ": " + r); }
    }
    record(id, f.name, pass, pass ? `parser=valid; legacy write ${want}${f.record.phase === "v2_active" ? "; V2 rows allow; legacy overwrite deny" : ""}` : notes.join("; "));
  }

  const w = (s, n) => String(s).padEnd(n).slice(0, n);
  console.log(`\n${w("case", 8)} ${w("status", 6)} ${w("fixture", 70)} notes`); console.log("-".repeat(150));
  for (const r of results) console.log(`${w(r.id, 8)} ${w(r.status, 6)} ${w(r.name, 70)} ${r.notes}`);
  console.log("\n=== TOTALS ===");
  console.log(`invalid_fixtures=${invalid.length} valid_fixtures=${VALID_POLICIES.length} total=${results.length} passed=${results.length - failures} failed=${failures}`);
  if (results.length !== invalid.length + VALID_POLICIES.length) { console.error("INCOMPLETE MATRIX"); process.exitCode = 3; return; }
  if (failures) { process.exitCode = 1; return; }
  console.log("\nALL CASES PASSED — parser and Rules agree on the control-record validity contract");
}

const direct = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (direct) {
  main().then(async () => { await Promise.all(admin.apps.filter(Boolean).map((a) => a.delete().catch(() => {}))); })
        .catch(async (e) => { console.error("HARNESS ERROR:", (e && e.stack) || e); process.exitCode = 4; await Promise.all(admin.apps.filter(Boolean).map((a) => a.delete().catch(() => {}))); });
}
