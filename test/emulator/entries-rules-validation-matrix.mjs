// Marjin — P0-DATA-01 R10.1: server-side validation of `biz:{bizId}:entries`.
//
// Codex blocking finding 2: the dynamic `$dataKey` branch of database.rules.json had
// `.read` and `.write` but no `.validate`, so an authenticated, authorized manager
// could write non-JSON `_v`, id-less row JSON, or an object without `_v` straight into
// the authoritative entries node — bypassing every P0-DATA-01 invariant the client
// enforces and leaving the runtime fail-closed on malformed data it cannot repair.
//
// This matrix runs the REAL Rules engine of the local Realtime Database Emulator. The
// expected allow/deny values are the oracle; the actual results come from the emulator.
// Deliberately not named *.test.mjs so the emulator-free repository glob cannot run it.
//
// Host run: see test/emulator/README.md, "Run the entries Rules validation matrix".

import admin from "firebase-admin";
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { validateFirebaseConfig } from "./rtdb-authorization-matrix.mjs";

const PROJECT = "demo-marjin-rules";
const NAMESPACE = "demo-marjin-rules-default-rtdb";
const EMU_HOSTPORT = "127.0.0.1:9000";
const DB_URL = `http://${EMU_HOSTPORT}?ns=${NAMESPACE}`;
const DEMO_DB_URLS = new Set([
  "https://demo-marjin-rules.firebaseio.com",
  "https://demo-marjin-rules-default-rtdb.firebaseio.com",
]);
const isLocalUrl = (u) => /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?([/?].*)?$/.test(String(u));
const DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = join(DIR, "..", "..");

function fail(msg) { console.error(`SAFETY ABORT: ${msg}`); process.exit(2); }

function assertSafeEnvironment() {
  if (process.env.GCLOUD_PROJECT !== PROJECT) fail(`GCLOUD_PROJECT must be ${PROJECT}`);
  if (process.env.GOOGLE_CLOUD_PROJECT !== PROJECT) fail(`GOOGLE_CLOUD_PROJECT must be ${PROJECT}`);
  if (process.env.FIREBASE_DATABASE_EMULATOR_HOST !== EMU_HOSTPORT) fail(`FIREBASE_DATABASE_EMULATOR_HOST must be ${EMU_HOSTPORT}`);
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) fail("GOOGLE_APPLICATION_CREDENTIALS must be absent");
  const fc = validateFirebaseConfig(process.env.FIREBASE_CONFIG);
  if (!fc.ok) fail(`FIREBASE_CONFIG rejected: ${fc.reason}`);
  if (process.env.FIREBASE_DATABASE_URL) {
    const u = String(process.env.FIREBASE_DATABASE_URL);
    if (!DEMO_DB_URLS.has(u) && !isLocalUrl(u)) fail(`FIREBASE_DATABASE_URL is not demo/local: ${u}`);
  }
  if (!PROJECT.startsWith("demo-")) fail("project id must start with demo-");
  const emulated = readFileSync(join(DIR, "database.rules.json"));
  const canonical = readFileSync(join(ROOT, "database.rules.json"));
  if (Buffer.compare(emulated, canonical) !== 0)
    fail("test/emulator/database.rules.json differs from canonical database.rules.json — refresh the copy before running");
}

// The rules under test must actually be present; a matrix run against a rules file
// with no entries validation would report a meaningless pass.
function assertRulesUnderTestPresent() {
  const rules = JSON.parse(readFileSync(join(ROOT, "database.rules.json"), "utf8"));
  const dk = rules?.rules?.tenants?.["$tenantId"]?.["$dataKey"];
  if (!dk || typeof dk[".validate"] !== "string")
    fail("database.rules.json has no .validate on $dataKey — the finding under test is not fixed");
  if (!dk["_v"] || typeof dk["_v"][".validate"] !== "string")
    fail("database.rules.json has no .validate on $dataKey/_v — a direct child write would bypass the parent rule");
}

// ─── Identities and fixtures ─────────────────────────────────────────────────
const IDS = {
  owner:   { uid: "u_owner",   token: { email: "owner@demo.example" } },
  manager: { uid: "u_manager", token: { email: "manager@demo.example" } },
  viewer:  { uid: "u_viewer",  token: { email: "viewer@demo.example" } },
  unauth:  null,
};
const uid = (n) => `${String(n).padStart(8, "0")}-aaaa-4bbb-8ccc-dddddddddddd`;
// The production row shape, every supported field populated.
const full = (n, extra = {}) => ({
  id: uid(n), date: `2026-08-${String((n % 28) + 1).padStart(2, "0")}`,
  sales: 100 + n, deliveries: 7, food_cost: 33, payroll: 40, other_expense: 5, other_income: 3,
  supplier_payments: { sup1: 60, sup2: 12 }, hourly_payroll: { am: 90 },
  weather_impact: "גשם", security_event: false, includeVat: false, notes: "ok",
  is_exception: false, exception_reason: "", exception_note: "", ...extra,
});
// The CREATE shape the runtime actually produces: `{ ...next, date, id }` — id LAST.
const idLast = (n) => { const { id, ...rest } = full(n); return { ...rest, id }; };
const env = (rows) => ({ _v: JSON.stringify(rows) });

function fixtures() {
  return {
    tenants: {
      tenantA: {
        members: { u_owner: true, u_manager: true, u_viewer: true },
        roles: { u_owner: "owner", u_manager: "manager", u_viewer: "viewer" },
        biz_access: { bizA: { u_manager: true, u_viewer: true } },
        "biz:bizA:entries": env([full(1), full(2)]),
        "biz:bizB:entries": env([full(9)]),
        "biz:bizA:config": { _v: "{}" },
      },
    },
  };
}

const apps = {};
function initApps() {
  apps.__seed = admin.initializeApp({ databaseURL: DB_URL }, "seed");
  for (const [k, override] of Object.entries(IDS)) {
    apps[k] = admin.initializeApp({ databaseURL: DB_URL, databaseAuthVariableOverride: override }, `id_${k}`);
  }
}
const seedDb = () => apps.__seed.database();
async function reseed() { await seedDb().ref("/").set(fixtures()); }
const isDenied = (e) => /permission[_ ]denied/i.test(String((e && (e.message || "")) + " " + (e && (e.code || ""))));
const entriesPath = (biz, tenant = "tenantA") => `tenants/${tenant}/biz:${biz}:entries`;

// ─── Cases ───────────────────────────────────────────────────────────────────
// op: "set" writes the whole node; "setChild" writes only `_v`; "txn" runs a real
// transaction; "delete" removes the node.
const A = (id, area, identity, op, path, value, note) => ({ id, area, identity, op, path, value, expect: "allow", note });
const D = (id, area, identity, op, path, value, note) => ({ id, area, identity, op, path, value, expect: "deny", note });

const BIG = "x".repeat(1048600);

function cases() {
  const P = entriesPath("bizA");
  return [
    // ── ALLOW: everything the R10 runtime legitimately produces ──────────────
    A("R-A01", "valid-write", "manager", "set", P, env([full(1), full(2)]), "representative valid node"),
    A("R-A02", "valid-create", "manager", "set", P, env([full(1), idLast(3)]), "the real create shape — id is the LAST key"),
    A("R-A03", "valid-update", "manager", "set", P, env([{ ...full(1), sales: 555 }, full(2)]), "an ordinary field edit"),
    A("R-A04", "valid-delete-row", "manager", "set", P, env([full(2)]), "a row removed, the rest rewritten"),
    A("R-A05", "clear-all", "manager", "set", P, env([]), "the empty array clear-all writes"),
    A("R-A06", "duplicate-dates", "manager", "set", P, env([full(1), { ...full(2), date: full(1).date }]), "duplicate business dates with distinct ids stay writable"),
    A("R-A07", "large-history", "manager", "set", P, env(Array.from({ length: 160 }, (_, i) => (i % 2 ? full(i + 10) : idLast(i + 10)))), "160-date history, mixed key order"),
    A("R-A08", "minimal-row", "manager", "set", P, env([{ id: uid(4) }]), "a row carrying only its id"),
    A("R-A09", "braces-in-text", "manager", "set", P, env([full(5, { notes: "הערה {מיוחדת} עם } סוגר" })]), "free text containing braces is NOT rejected"),
    A("R-A10", "child-write", "manager", "setChild", P, JSON.stringify([full(6)]), "writing the _v child directly, with a valid array"),
    A("R-A11", "owner-role", "owner", "set", P, env([full(7)]), "the owner role is unaffected"),
    A("R-A12", "transaction", "manager", "txn", P, env([full(1), full(2), idLast(8)]), "a real RTDB transaction still commits"),
    A("R-A13", "unicode-fields", "manager", "set", P, env([full(5, { exception_reason: "אירוע חריג", notes: "שורה \"מצוטטת\"" })]), "escaped quotes and Hebrew are unaffected"),

    // ── DENY: exactly what Codex proved, plus the obvious neighbours ─────────
    D("R-D01", "codex-proof", "manager", "set", P, { _v: "not json" }, "non-JSON _v"),
    D("R-D02", "codex-proof", "manager", "set", P, env([{ date: "2026-08-01", sales: 1 }]), "id-less row JSON"),
    D("R-D03", "codex-proof", "manager", "set", P, { notV: "x" }, "object without _v"),
    D("R-D04", "structure", "manager", "set", P, env([full(1), { date: "2026-08-02", sales: 1 }, full(2)]), "an id-less row hidden among valid rows"),
    D("R-D05", "structure", "manager", "set", P, { _v: 12345 }, "_v that is not a string"),
    D("R-D06", "structure", "manager", "set", P, { _v: JSON.stringify([full(1)]).slice(0, -2) }, "truncated JSON"),
    D("R-D07", "structure", "manager", "set", P, env([{ id: uid(1).toUpperCase() }]), "non-canonical (uppercase) id"),
    D("R-D08", "structure", "manager", "set", P, env([{ id: "00000001-aaaa-5bbb-8ccc-dddddddddddd" }]), "wrong UUID version nibble"),
    D("R-D09", "structure", "manager", "set", P, env([{ id: "00000001-aaaa-4bbb-2ccc-dddddddddddd" }]), "wrong UUID variant nibble"),
    D("R-D10", "structure", "manager", "set", P, env([1, 2, 3]), "array of scalars"),
    D("R-D11", "structure", "manager", "set", P, env({ id: uid(1) }), "an object where an array is required"),
    D("R-D12", "bypass", "manager", "setChild", P, "not json", "the direct _v child write Codex would otherwise use to bypass the parent rule"),
    D("R-D13", "bypass", "manager", "setChild", P, JSON.stringify([{ date: "2026-08-01" }]), "id-less rows through the child path"),
    D("R-D14", "size", "manager", "set", P, { _v: BIG }, "beyond the documented size ceiling"),
    D("R-D15", "authorization", "manager", "set", entriesPath("bizB"), env([full(1)]), "cross-business write stays denied"),
    D("R-D16", "authorization", "viewer", "set", P, env([full(1)]), "viewer role stays denied"),
    D("R-D17", "authorization", "unauth", "set", P, env([full(1)]), "unauthenticated stays denied"),
  ];
}

async function runCase(c) {
  const db = apps[c.identity].database();
  const ref = db.ref(c.path);
  if (c.op === "set") { await ref.set(c.value); return; }
  if (c.op === "setChild") { await ref.child("_v").set(c.value); return; }
  if (c.op === "delete") { await ref.remove(); return; }
  if (c.op === "txn") {
    const res = await ref.transaction(() => c.value, undefined, false);
    if (!res.committed) throw new Error("permission_denied (transaction not committed)");
    return;
  }
  throw new Error(`unknown op ${c.op}`);
}

async function main() {
  assertSafeEnvironment();
  assertRulesUnderTestPresent();
  initApps();

  const all = cases();
  const results = [];
  for (const c of all) {
    await reseed();
    let actual = "allow", err = "";
    try { await runCase(c); }
    catch (e) { actual = isDenied(e) ? "deny" : "error"; err = (e && e.message) || String(e); }
    results.push({ ...c, actual, err, pass: actual === c.expect });
  }

  const w = (s, n) => String(s).padEnd(n).slice(0, n);
  console.log("");
  console.log(`${w("case", 8)} ${w("area", 15)} ${w("identity", 9)} ${w("op", 9)} ${w("expect", 7)} ${w("actual", 7)} note`);
  console.log("-".repeat(125));
  for (const r of results) console.log(`${w(r.id, 8)} ${w(r.area, 15)} ${w(r.identity, 9)} ${w(r.op, 9)} ${w(r.expect, 7)} ${w(r.actual, 7)} ${r.note}`);

  const allowed = results.filter((r) => r.expect === "allow");
  const denied = results.filter((r) => r.expect === "deny");
  const failures = results.filter((r) => !r.pass);
  console.log("");
  console.log("=== TOTALS ===");
  console.log(`total=${results.length} expected_allow=${allowed.length} expected_deny=${denied.length} passed=${results.length - failures.length} failed=${failures.length}`);
  console.log(`unexpected_allow=${failures.filter((r) => r.expect === "deny" && r.actual === "allow").length} unexpected_deny=${failures.filter((r) => r.expect === "allow" && r.actual === "deny").length} errored=${results.filter((r) => r.actual === "error").length}`);

  const EXPECTED_CASES = 30;
  if (results.length !== EXPECTED_CASES) {
    console.error(`\nINCOMPLETE MATRIX: expected ${EXPECTED_CASES} cases, ran ${results.length}`);
    process.exitCode = 3; return;
  }
  if (failures.length) {
    console.error("\n=== FAILURES ===");
    for (const r of failures) console.error(`${r.id} [${r.area}] ${r.note}\n    expected ${r.expect}, got ${r.actual}${r.err ? " — " + r.err : ""}`);
    process.exitCode = 1; return;
  }
  console.log("\nALL CASES PASSED");
}

const __direct = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (__direct) {
  main()
    .then(async () => { await Promise.all(admin.apps.filter(Boolean).map((a) => a.delete().catch(() => {}))); })
    .catch(async (err) => {
      console.error("HARNESS ERROR:", (err && err.stack) || err);
      process.exitCode = 4;
      await Promise.all(admin.apps.filter(Boolean).map((a) => a.delete().catch(() => {})));
    });
}
