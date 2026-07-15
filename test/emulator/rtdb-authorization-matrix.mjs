// Marjin — Firebase RTDB Emulator authorization matrix.
//
// Runs the REAL Rules engine of the local Realtime Database Emulator against
// synthetic fixtures. Rule enforcement uses firebase-admin with a per-identity
// `databaseAuthVariableOverride` (the documented emulator mechanism): an app with
// override === undefined is admin (bypasses Rules — used ONLY to seed fixtures);
// override === null is unauthenticated; override === {uid, token:{email}} is that
// authenticated user, and the emulator enforces Rules as that principal.
//
// This is NOT a static JavaScript copy of the Rules — expected allow/deny values
// are the test oracle; actual results come from the emulator. The script exits
// nonzero on any mismatch, safety/startup error, fixture failure, or incomplete totals.
//
// Host run (Java 21+ required):
//   see test/emulator/README.md

import admin from "firebase-admin";
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

// ─── Safety constants ─────────────────────────────────────────────────────────
const PROJECT = "demo-marjin-rules";
const NAMESPACE = "demo-marjin-rules-default-rtdb";
const HOST = "127.0.0.1";
const PORT = "9000";
const EMU_HOSTPORT = `${HOST}:${PORT}`;
const DB_URL = `http://${EMU_HOSTPORT}?ns=${NAMESPACE}`;

function fail(msg) { console.error(`SAFETY ABORT: ${msg}`); process.exit(2); }

// Firebase identifiers permitted in the CLI-injected FIREBASE_CONFIG — all derived
// from the synthetic demo project. Anything else is Production-looking → rejected.
// (The emulator routes all traffic through FIREBASE_DATABASE_EMULATOR_HOST anyway.)
const DEMO_DB_URLS = new Set([
  "https://demo-marjin-rules.firebaseio.com",
  "https://demo-marjin-rules-default-rtdb.firebaseio.com",
]);
const DEMO_BUCKETS = new Set([
  "demo-marjin-rules.appspot.com",
  "demo-marjin-rules.firebasestorage.app",
]);
const DEMO_HOSTS = new Set([
  "demo-marjin-rules.firebaseio.com",
  "demo-marjin-rules-default-rtdb.firebaseio.com",
  "demo-marjin-rules.appspot.com",
  "demo-marjin-rules.firebasestorage.app",
]);
const isLocalUrl = (u) => /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?([/?].*)?$/.test(String(u));

// Pure validator for the FIREBASE_CONFIG blob the Firebase CLI injects.
// Returns { ok, reason }. Absent config is allowed; when present it must be JSON
// describing ONLY the synthetic demo project. Exported for focused tests.
export function validateFirebaseConfig(raw) {
  if (raw === undefined || raw === null || raw === "") return { ok: true, reason: "absent" };
  let cfg;
  try { cfg = JSON.parse(raw); } catch { return { ok: false, reason: "FIREBASE_CONFIG is not valid JSON" }; }
  if (typeof cfg !== "object" || cfg === null || Array.isArray(cfg))
    return { ok: false, reason: "FIREBASE_CONFIG is not a JSON object" };

  if (cfg.projectId !== PROJECT)
    return { ok: false, reason: `projectId must be ${PROJECT}, got ${JSON.stringify(cfg.projectId)}` };

  if (cfg.databaseURL !== undefined) {
    const u = String(cfg.databaseURL);
    if (!DEMO_DB_URLS.has(u) && !isLocalUrl(u))
      return { ok: false, reason: `databaseURL not an allowed demo/local form: ${u}` };
  }
  if (cfg.storageBucket !== undefined) {
    if (!DEMO_BUCKETS.has(String(cfg.storageBucket)))
      return { ok: false, reason: `storageBucket not the demo bucket: ${cfg.storageBucket}` };
  }

  // Defense in depth: NO field of the blob may carry a non-demo Firebase host.
  const hosts = JSON.stringify(cfg).match(/[A-Za-z0-9._-]+\.(?:firebaseio\.com|firebasedatabase\.app|appspot\.com|firebasestorage\.app)/g) || [];
  for (const host of hosts) {
    if (!DEMO_HOSTS.has(host)) return { ok: false, reason: `non-demo Firebase host in FIREBASE_CONFIG: ${host}` };
  }
  return { ok: true, reason: "demo-consistent" };
}

// Full local-only safety gate. Called by main() — i.e. only on direct execution,
// never on import (so the pure validator can be unit-tested without side effects).
function assertSafeEnvironment() {
  if (process.env.GCLOUD_PROJECT !== PROJECT) fail(`GCLOUD_PROJECT must be ${PROJECT}`);
  if (process.env.GOOGLE_CLOUD_PROJECT !== PROJECT) fail(`GOOGLE_CLOUD_PROJECT must be ${PROJECT}`);
  if (process.env.FIREBASE_DATABASE_EMULATOR_HOST !== EMU_HOSTPORT)
    fail(`FIREBASE_DATABASE_EMULATOR_HOST must be exactly ${EMU_HOSTPORT}`);
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) fail("GOOGLE_APPLICATION_CREDENTIALS must be absent");

  // The CLI injects FIREBASE_CONFIG for the demo project — validate, don't blanket-reject.
  const fc = validateFirebaseConfig(process.env.FIREBASE_CONFIG);
  if (!fc.ok) fail(`FIREBASE_CONFIG rejected: ${fc.reason}`);

  // A stray FIREBASE_DATABASE_URL (host command unsets it) must be demo/local if present.
  if (process.env.FIREBASE_DATABASE_URL) {
    const u = String(process.env.FIREBASE_DATABASE_URL);
    if (!DEMO_DB_URLS.has(u) && !isLocalUrl(u)) fail(`FIREBASE_DATABASE_URL is not demo/local: ${u}`);
  }

  const [h, p] = EMU_HOSTPORT.split(":");
  if (!(h === "127.0.0.1" || h === "localhost")) fail(`host must be 127.0.0.1/localhost, got ${h}`);
  if (p !== PORT) fail(`port must be ${PORT}, got ${p}`);
  if (!PROJECT.startsWith("demo-")) fail("project id must start with demo-");
  if (!NAMESPACE.startsWith("demo-")) fail("namespace must start with demo-");
  if (!/^http:\/\/(127\.0\.0\.1|localhost):9000\?ns=demo-/.test(DB_URL)) fail(`refusing non-local db url: ${DB_URL}`);

  // Rules-fidelity: emulator loads test/emulator/database.rules.json (must live
  // under the config dir). Assert byte-identical to canonical repo-root Rules.
  const dir = dirname(fileURLToPath(import.meta.url));
  const emulatedRules = readFileSync(join(dir, "database.rules.json"));
  const canonicalRules = readFileSync(join(dir, "..", "..", "database.rules.json"));
  if (Buffer.compare(emulatedRules, canonicalRules) !== 0)
    fail("test/emulator/database.rules.json differs from canonical database.rules.json — refresh the copy before running");
}

// ─── Synthetic identities (uid + email) ──────────────────────────────────────
const IDS = {
  unauth:        null,
  nomember:      { uid: "u_nomember",      token: { email: "nomember@demo.example" } },
  viewer:        { uid: "u_viewer",        token: { email: "viewer@demo.example" } },
  viewer_nobiz:  { uid: "u_viewer_nobiz",  token: { email: "viewer2@demo.example" } },
  shift:         { uid: "u_shift",         token: { email: "shift@demo.example" } },
  manager:       { uid: "u_manager",       token: { email: "manager@demo.example" } },
  manager_nobiz: { uid: "u_manager_nobiz", token: { email: "mgr2@demo.example" } },
  owner:         { uid: "u_owner",         token: { email: "owner@demo.example" } },
  super:         { uid: "u_super",         token: { email: "super@demo.example" } },
  bizAB:         { uid: "u_bizAB",         token: { email: "bizab@demo.example" } },
  tenantB:       { uid: "u_tenantB",       token: { email: "tenantb@demo.example" } },
};

// ─── Deterministic fixtures (seeded via admin bypass, NOT via Rules) ──────────
const BIG = "x".repeat(20000);
function fixtures() {
  return {
    tenants: {
      tenantA: {
        members: { u_viewer: true, u_viewer_nobiz: true, u_shift: true, u_manager: true, u_manager_nobiz: true, u_owner: true, u_super: true, u_bizAB: true },
        roles: { u_viewer: "viewer", u_viewer_nobiz: "viewer", u_shift: "shift_manager", u_manager: "manager", u_manager_nobiz: "manager", u_owner: "owner", u_super: "super_owner", u_bizAB: "manager" },
        biz_access: { bizA: { u_viewer: true, u_shift: true, u_manager: true, u_bizAB: true }, bizB: { u_bizAB: true } },
        access_meta: { seeded: true },
        entry_exceptions: { bizA: { "2026-07-14": { reason: "seed" } } },
        analytics: { daily: { main: { "2026-07-14": { revenue_total: 1, tickets: 1, meta: { ok: true } } } } },
        proactive_insights: { bizA: { i1: { lastDetectedAt: 1, fingerprint: "f" } } },
        entries: { _v: "[]" },
        "biz:bizA:entries": { _v: "[]" },
        "biz:bizA:config": { _v: "{}" },
        "biz:bizA:suppliers": { _v: "[]" },
        "biz:bizA:fixed": { _v: "[]" },
        "biz:bizA:lastyear": { _v: "[]" },
        "biz:bizA:credits": { _v: "[]" },
        "biz:bizA:pettycash": { _v: "[]" },
        "biz:bizA:customer_compensations": { _v: "{}" },
        "biz:bizA:checklist_templates": { _v: "{}" },
        "biz:bizA:checklist_template": { _v: "{}" },
        "biz:bizA:tasks": { _v: "[]" },
        "biz:bizA:logs": { _v: "[]" },
        "biz:bizA:active-log": { _v: "{}" },
        "biz:bizB:entries": { _v: "[]" },
        "biz:bizB:tasks": { _v: "[]" },
        "biz:bizA:checklist_template_items:tpl1": { x: 1 },
        "biz:bizA:checklist_runs:2026-07-14": { x: 1 },
        "biz:bizA:checklist_simple_runs:2026-07-14:tpl1": { x: 1 },
        "biz:bizA:analytics:daily:2026-07-14": { revenue: { total: 1 } },
        "biz:bizA:insights:daily:2026-07-14": { x: 1 },
        "biz:bizB:analytics:daily:2026-07-14": { revenue: { total: 1 } },
        "biz:bizA:pin": { _v: "1234" },
      },
      tenantB: {
        members: { u_tenantB: true },
        roles: { u_tenantB: "owner" },
        "biz:bizA:entries": { _v: "[]" },
      },
    },
    username_index: { alice: { tenantId: "tenantA", email: "alice@demo.example" } },
    user_tenants: { u_viewer: "tenantA" },
    user_active_biz: { u_viewer: "bizA", u_shift: "bizA" },
    "app-users": { seeded: true },
  };
}

// ─── App wiring ──────────────────────────────────────────────────────────────
const apps = {};
function initApps() {
  apps.__seed = admin.initializeApp({ databaseURL: DB_URL }, "seed"); // admin bypass
  for (const [key, override] of Object.entries(IDS)) {
    apps[key] = admin.initializeApp(
      { databaseURL: DB_URL, databaseAuthVariableOverride: override }, // null=unauth, obj=that user
      `id_${key}`
    );
  }
}
const seedDb = () => apps.__seed.database();
async function reseed() { await seedDb().ref("/").set(fixtures()); }

function isDenied(e) {
  const m = (e && (e.message || "")) + " " + (e && (e.code || ""));
  return /permission[_ ]denied/i.test(m);
}

// ─── Case constructors (tenant/business inferred from the path) ───────────────
function meta(path) {
  const t = (path.match(/^tenants\/([^/]+)/) || [])[1] || "-";
  const b = (path.match(/biz:([^:]+):/) || [])[1] || "-";
  return { tenant: t, business: b };
}
const R = (id, area, identity, path, expect)              => ({ id, area, identity, op: "read",   path, expect, ...meta(path) });
const W = (id, area, identity, path, value, expect, op)   => ({ id, area, identity, op: op || "update", path, value, expect, ...meta(path) });
const C = (id, area, identity, path, value, expect)       => W(id, area, identity, path, value, expect, "create");
const D = (id, area, identity, path, expect)              => ({ id, area, identity, op: "delete", path, expect, ...meta(path) });
const P = (id, area, identity, patchRoot, value, expect)  => ({ id, area, identity, op: "patch", patchRoot, value, expect, ...meta(patchRoot) });

const TA = "tenants/tenantA";
const V = { _v: "[9]" };

const CASES = [
  // 1) Authentication and tenant isolation
  R("A1-01","auth/tenant","unauth",       `${TA}/biz:bizA:entries`,"deny"),
  W("A1-02","auth/tenant","unauth",       `${TA}/biz:bizA:entries`,V,"deny"),
  R("A1-03","auth/tenant","nomember",     `${TA}/biz:bizA:entries`,"deny"),
  W("A1-04","auth/tenant","nomember",     `${TA}/biz:bizA:entries`,V,"deny"),
  R("A1-05","auth/tenant","viewer",       `tenants/tenantB/biz:bizA:entries`,"deny"),
  W("A1-06","auth/tenant","owner",        `tenants/tenantB/biz:bizA:entries`,V,"deny"),
  R("A1-07","auth/tenant","tenantB",      `${TA}/biz:bizA:entries`,"deny"),
  W("A1-08","auth/tenant","tenantB",      `${TA}/biz:bizA:entries`,V,"deny"),
  R("A1-09","auth/tenant","owner",        `${TA}`,"deny"),

  // 2) biz_access isolation
  R("A2-10","biz_access","viewer",        `${TA}/biz:bizA:entries`,"allow"),
  R("A2-11","biz_access","viewer",        `${TA}/biz:bizB:entries`,"deny"),
  R("A2-12","biz_access","viewer_nobiz",  `${TA}/biz:bizA:entries`,"deny"),
  W("A2-13","biz_access","manager_nobiz", `${TA}/biz:bizA:entries`,V,"deny"),
  W("A2-14","biz_access","manager",       `${TA}/biz:bizB:entries`,V,"deny"),
  R("A2-15","biz_access","bizAB",         `${TA}/biz:bizA:entries`,"allow"),
  R("A2-16","biz_access","bizAB",         `${TA}/biz:bizB:entries`,"allow"),
  W("A2-17","biz_access","bizAB",         `${TA}/biz:bizB:entries`,V,"allow"),
  W("A2-18","biz_access","owner",         `${TA}/biz_access/bizA/u_viewer`,true,"deny"),
  W("A2-19","biz_access","manager",       `${TA}/biz_access/bizA/u_manager`,true,"deny"),
  R("A2-20","biz_access","owner",         `${TA}/biz_access`,"deny"),

  // 3) Role tiers
  R("A3-21","roles","shift",              `${TA}/biz:bizA:entries`,"allow"),
  W("A3-22","roles","shift",              `${TA}/biz:bizA:entries`,V,"deny"),
  W("A3-23","roles","shift",              `${TA}/biz:bizA:tasks`,V,"allow"),
  W("A3-24","roles","viewer",             `${TA}/biz:bizA:tasks`,V,"deny"),
  W("A3-25","roles","manager",            `${TA}/biz:bizA:config`,V,"allow"),
  W("A3-26","roles","viewer",             `${TA}/biz:bizA:config`,V,"deny"),
  W("A3-27","roles","owner",              `${TA}/biz:bizA:entries`,V,"allow"),
  W("A3-28","roles","super",              `${TA}/biz:bizA:entries`,V,"allow"),
  W("A3-29","roles","viewer",             `${TA}/roles/u_viewer`,"owner","deny"),
  W("A3-30","roles","owner",              `${TA}/roles/u_owner`,"super_owner","deny"),
  W("A3-31","roles","viewer",             `${TA}/biz_access/bizA/u_viewer`,true,"deny"),

  // 4) Manager-tier keys (biz-scoped) + legacy named nodes
  W("A4-32","mgr-keys","manager",         `${TA}/biz:bizA:suppliers`,V,"allow"),
  W("A4-33","mgr-keys","shift",           `${TA}/biz:bizA:suppliers`,V,"deny"),
  W("A4-34","mgr-keys","manager",         `${TA}/biz:bizA:fixed`,V,"allow"),
  W("A4-35","mgr-keys","owner",           `${TA}/biz:bizA:lastyear`,V,"allow"),
  W("A4-36","mgr-keys","manager",         `${TA}/biz:bizA:credits`,V,"allow"),
  W("A4-37","mgr-keys","manager",         `${TA}/biz:bizA:pettycash`,V,"allow"),
  W("A4-38","mgr-keys","manager",         `${TA}/biz:bizA:customer_compensations`,V,"allow"),
  W("A4-39","mgr-keys","manager",         `${TA}/biz:bizA:checklist_templates`,V,"allow"),
  W("A4-40","mgr-keys","viewer",          `${TA}/biz:bizA:checklist_templates`,V,"deny"),
  R("A4-41","mgr-keys","viewer",          `${TA}/biz:bizA:config`,"allow"),
  R("A4-42","mgr-keys","viewer_nobiz",    `${TA}/biz:bizA:suppliers`,"deny"),
  R("A4-43","mgr-keys","viewer",          `${TA}/entries`,"allow"),        // legacy named node: member read
  R("A4-44","mgr-keys","nomember",        `${TA}/entries`,"deny"),

  // 5) Shift-tier keys
  W("A5-45","shift-keys","shift",         `${TA}/biz:bizA:logs`,V,"allow"),
  W("A5-46","shift-keys","shift",         `${TA}/biz:bizA:active-log`,V,"allow"),
  R("A5-47","shift-keys","viewer",        `${TA}/biz:bizA:tasks`,"allow"),
  W("A5-48","shift-keys","manager",       `${TA}/biz:bizA:tasks`,V,"allow"),
  W("A5-49","shift-keys","owner",         `${TA}/biz:bizA:tasks`,V,"allow"),
  W("A5-50","shift-keys","shift",         `${TA}/biz:bizB:tasks`,V,"deny"),
  W("A5-51","shift-keys","viewer",        `${TA}/biz:bizA:logs`,V,"deny"),

  // 6) Checklist server mediation
  W("A6-52","checklist","manager",        `${TA}/biz:bizA:checklist_template`,V,"allow"),
  W("A6-53","checklist","shift",          `${TA}/biz:bizA:checklist_template`,V,"deny"),
  W("A6-54","checklist","viewer",         `${TA}/biz:bizA:checklist_template`,V,"deny"),
  R("A6-55","checklist","viewer",         `${TA}/biz:bizA:checklist_template`,"allow"),
  R("A6-56","checklist","owner",          `${TA}/biz:bizA:checklist_template_items:tpl1`,"deny"),
  W("A6-57","checklist","manager",        `${TA}/biz:bizA:checklist_template_items:tpl1`,V,"deny"),
  R("A6-58","checklist","owner",          `${TA}/biz:bizA:checklist_runs:2026-07-14`,"deny"),
  W("A6-59","checklist","manager",        `${TA}/biz:bizA:checklist_runs:2026-07-14`,V,"deny"),
  R("A6-60","checklist","owner",          `${TA}/biz:bizA:checklist_simple_runs:2026-07-14:tpl1`,"deny"),
  W("A6-61","checklist","shift",          `${TA}/biz:bizA:checklist_simple_runs:2026-07-14:tpl1`,V,"deny"),
  R("A6-62","checklist","viewer",         `${TA}/biz:bizA:checklist_templates`,"allow"),

  // 7) Analytics and insights
  R("A7-63","analytics","owner",          `${TA}/analytics`,"deny"),
  W("A7-64","analytics","owner",          `${TA}/analytics`,{daily:{}},"deny"),
  R("A7-65","analytics","owner",          `${TA}/analytics/daily/main/2026-07-14`,"deny"),
  R("A7-66","analytics","owner",          `${TA}/biz:bizA:analytics:daily:2026-07-14`,"deny"),
  W("A7-67","analytics","manager",        `${TA}/biz:bizA:analytics:daily:2026-07-14`,{revenue:{total:9}},"deny"),
  R("A7-68","analytics","owner",          `${TA}/biz:bizA:insights:daily:2026-07-14`,"deny"),
  W("A7-69","analytics","manager",        `${TA}/biz:bizA:insights:daily:2026-07-14`,{x:9},"deny"),
  R("A7-70","analytics","owner",          `${TA}/biz:bizB:analytics:daily:2026-07-14`,"deny"),

  // 8) PIN and unknown/malformed keys
  R("A8-71","pin/unknown","owner",        `${TA}/biz:bizA:pin`,"deny"),
  W("A8-72","pin/unknown","manager",      `${TA}/biz:bizA:pin`,{_v:"9"},"deny"),
  R("A8-73","pin/unknown","owner",        `${TA}/biz:bizA:unknownsuffix`,"deny"),
  W("A8-74","pin/unknown","owner",        `${TA}/biz:bizA:unknownsuffix`,{x:1},"deny"),
  W("A8-75","pin/unknown","manager",      `${TA}/biz:bizA:analytics:daily:2026-13-99`,{x:1},"deny"),

  // 9) entry_exceptions (server-mediated; node locked)
  R("A9-76","entry_exceptions","owner",   `${TA}/entry_exceptions/bizA/2026-07-14`,"deny"),
  C("A9-77","entry_exceptions","manager", `${TA}/entry_exceptions/bizA/2026-07-15`,{reason:"x"},"deny"),
  W("A9-78","entry_exceptions","owner",   `${TA}/entry_exceptions/bizA/2026-07-14`,{reason:"y"},"deny"),
  D("A9-79","entry_exceptions","owner",   `${TA}/entry_exceptions/bizA/2026-07-14`,"deny"),

  // 10) Security metadata
  R("A10-80","metadata","owner",          `${TA}/roles`,"allow"),
  R("A10-81","metadata","viewer",         `${TA}/roles`,"deny"),
  R("A10-82","metadata","owner",          `${TA}/members`,"allow"),
  R("A10-83","metadata","viewer",         `${TA}/members`,"deny"),
  C("A10-84","metadata","owner",          `${TA}/members/u_new`,true,"allow"),
  C("A10-85","metadata","viewer",         `${TA}/members/u_new2`,true,"deny"),
  R("A10-86","metadata","owner",          `${TA}/access_meta`,"deny"),
  W("A10-87","metadata","owner",          `${TA}/access_meta/x`,1,"deny"),
  W("A10-88","metadata","owner",          `${TA}/biz_access/bizB/u_viewer`,true,"deny"),

  // 11) Delete semantics
  D("A11-89","delete","manager",          `${TA}/biz:bizA:entries`,"allow"),
  D("A11-90","delete","viewer",           `${TA}/biz:bizA:entries`,"deny"),
  D("A11-91","delete","shift",            `${TA}/biz:bizA:tasks`,"allow"),
  D("A11-92","delete","manager",          `${TA}/biz:bizA:checklist_runs:2026-07-14`,"deny"),
  D("A11-93","delete","owner",            `${TA}/roles/u_viewer`,"deny"),
  D("A11-94","delete","manager",          `${TA}/entry_exceptions/bizA/2026-07-14`,"deny"),

  // 12) Validation / malformed / multi-location
  W("A12-95","validation","manager",      `${TA}/entries`,{_v:"[1]"},"allow"),                 // legacy entries: member write, valid _v
  W("A12-96","validation","manager",      `${TA}/entries`,{foo:"x"},"deny"),                   // missing _v
  W("A12-97","validation","manager",      `${TA}/entries`,{_v:{nested:1}},"deny"),             // _v not string
  W("A12-98","validation","manager",      `${TA}/entries`,{_v:BIG},"deny"),                    // oversize _v
  P("A12-99","validation","manager",      TA,{"biz:bizA:entries":{_v:"[2]"}},"allow"),         // single allowed location
  P("A12-100","validation","manager",     TA,{"biz:bizA:entries":{_v:"[3]"},"roles/u_viewer":"owner"},"deny"), // forbidden roles location

  // Top-level self-scoped + denied nodes + member-readable
  R("A1-101","auth/tenant","viewer",      `user_tenants/u_viewer`,"allow"),
  R("A1-102","auth/tenant","owner",       `user_tenants/u_viewer`,"deny"),
  W("A1-103","auth/tenant","shift",       `user_active_biz/u_shift`,"bizA","allow"),
  W("A1-104","auth/tenant","manager",     `user_active_biz/u_viewer`,"bizB","deny"),
  R("A1-105","auth/tenant","viewer",      `username_index/alice`,"allow"),
  R("A1-106","auth/tenant","unauth",      `username_index/alice`,"deny"),
  R("A1-107","auth/tenant","owner",       `app-users`,"deny"),
  R("A4-108","mgr-keys","viewer",         `${TA}/proactive_insights/bizA`,"allow"),
];

// ─── Runner ──────────────────────────────────────────────────────────────────
async function runOne(c) {
  const app = apps[c.identity];
  const db = app.database();
  let actual;
  try {
    if (c.op === "read")        await db.ref(c.path).get();
    else if (c.op === "delete") await db.ref(c.path).set(null);
    else if (c.op === "patch")  await db.ref(c.patchRoot).update(c.value);
    else                        await db.ref(c.path).set(c.value); // create/update
    actual = "allow";
  } catch (e) {
    if (isDenied(e)) actual = "deny";
    else { return { ...c, actual: "error", pass: false, error: (e && e.message) || String(e) }; }
  }
  return { ...c, actual, pass: actual === c.expect };
}

async function main() {
  assertSafeEnvironment();
  initApps();
  // Fixture sanity: seeding must succeed (admin bypass).
  try { await reseed(); } catch (e) { console.error("FIXTURE SEED FAILED:", e && e.message); process.exit(2); }

  const results = [];
  for (const c of CASES) {
    await reseed(); // isolate every case from prior mutations
    results.push(await runOne(c));
  }

  // Report
  const pad = (s, n) => String(s).padEnd(n).slice(0, n);
  console.log("ID        | area            | identity      | op     | expect | actual | PASS | path");
  console.log("-".repeat(120));
  for (const r of results) {
    console.log([pad(r.id,9),pad(r.area,15),pad(r.identity,13),pad(r.op,6),pad(r.expect,6),pad(r.actual,6),pad(r.pass?"PASS":"FAIL",4),(r.path||r.patchRoot)].join(" | "));
  }

  const total = results.length;
  const allows = results.filter(r => r.expect === "allow").length;
  const denies = results.filter(r => r.expect === "deny").length;
  const failed = results.filter(r => !r.pass);
  const unexpectedAllow = failed.filter(r => r.expect === "deny" && r.actual === "allow");
  const unexpectedDeny  = failed.filter(r => r.expect === "allow" && r.actual === "deny");
  const errored = results.filter(r => r.actual === "error");

  console.log("\n=== TOTALS ===");
  console.log(`total=${total} expected_allow=${allows} expected_deny=${denies} passed=${total - failed.length} failed=${failed.length}`);
  console.log(`unexpected_allow=${unexpectedAllow.length} unexpected_deny=${unexpectedDeny.length} errored=${errored.length}`);

  if (failed.length) {
    console.log("\n=== FAILURES ===");
    for (const r of failed) {
      const sev = (r.expect === "deny" && r.actual === "allow") ? "P0/P1 (unexpected allow)"
                : (r.actual === "error") ? "P2/P3 (harness/error)"
                : "P2 (unexpected deny)";
      console.log(`${r.id} [${r.area}] identity=${r.identity} op=${r.op} path=${r.path||r.patchRoot} expected=${r.expect} actual=${r.actual} severity=${sev}${r.error ? " error=" + r.error : ""}`);
    }
  }

  // Matrix quality gate (Phase 6 minimums)
  const incomplete = total < 70 || allows < 20 || denies < 50;
  if (incomplete) console.error(`\nMATRIX INCOMPLETE: total=${total}(>=70) allow=${allows}(>=20) deny=${denies}(>=50)`);

  await Promise.all(Object.values(apps).map(a => a.delete().catch(() => {})));

  if (failed.length || incomplete) process.exit(1);
  console.log("\nALL CASES PASSED");
  process.exit(0);
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  main().catch((e) => { console.error("FATAL:", e && (e.stack || e)); process.exit(2); });
}
