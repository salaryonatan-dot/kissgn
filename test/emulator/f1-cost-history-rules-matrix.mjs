// Marjin — F1 cost-history Rules matrix on the REAL local RTDB emulator, with mutation controls.
//
// The canonical database.rules.json is loaded into the emulator and every principal is evaluated by the
// real Rules engine (firebase-admin + databaseAuthVariableOverride). Expected allow/deny values are the
// oracle below — never derived from the Rules text. Then each of six MUTANTS (built in memory from the
// candidate Rules, never written to the repository) is loaded and the same matrix must FAIL at least
// one case of the targeted kind:
//   M1 membership       — the current-member requirement is dropped from the cost_history read branch
//   M2 business access  — the biz_access requirement is dropped (any member of the tenant reads)
//   M3 read scope       — the whole read condition becomes true (any signed-in principal reads)
//   M4 client write     — the explicit `? false` write branch becomes a member grant
//   M5 ancestor         — a tenant-level member write grant is added above $dataKey
//   M6 legacy layout    — a second layout (biz:{b}:cost_versions) is granted read and write
//
// Deliberately NOT named *.test.mjs. Run with the own-pid emulator runner (see test/emulator/README.md).
import admin from "firebase-admin";
import { readFileSync } from "node:fs";
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
const CANONICAL = JSON.parse(readFileSync(join(ROOT, "database.rules.json"), "utf8"));
async function loadRules(rules) {
  const res = await fetch(`http://${EMU}/.settings/rules.json?ns=${NAMESPACE}`, { method: "PUT", headers: { Authorization: "Bearer owner", "Content-Type": "application/json" }, body: JSON.stringify(rules) });
  if (!res.ok) throw new Error("rules load failed: " + res.status + " " + (await res.text()));
}

// ── mutants (in memory only) ─────────────────────────────────────────────────────────────────────
const READ_HEAD = "$dataKey.matches(/^biz:[^:]+:cost_history$/) ? (";
const MEMBER = "root.child('tenants').child($tenantId).child('members').child(auth.uid).val() === true && ";
const BIZ = "root.child('tenants').child($tenantId).child('biz_access').child($dataKey.replace('biz:','').replace(':cost_history','')).child(auth.uid).val() === true";
const dk = (r) => r.rules.tenants["$tenantId"]["$dataKey"];
function costReadBranch(r) { const s = dk(r)[".read"]; const i = s.indexOf(READ_HEAD); if (i < 0) throw new Error("cost_history read branch missing"); const j = s.indexOf(") : ", i); return [i, j + 4]; }
function mutate(kind) {
  const r = JSON.parse(JSON.stringify(CANONICAL));
  const d = dk(r);
  const once = (s, from, to, label) => { if (s.split(from).length !== 2) throw new Error("mutant anchor not unique: " + label); return s.replace(from, to); };
  if (kind === "M1") { const [i, j] = costReadBranch(r); d[".read"] = d[".read"].slice(0, i) + once(d[".read"].slice(i, j), MEMBER, "", "member") + d[".read"].slice(j); }
  if (kind === "M2") { const [i, j] = costReadBranch(r); d[".read"] = d[".read"].slice(0, i) + once(d[".read"].slice(i, j), BIZ, "true", "biz") + d[".read"].slice(j); }
  if (kind === "M3") { const [i, j] = costReadBranch(r); d[".read"] = d[".read"].slice(0, i) + "$dataKey.matches(/^biz:[^:]+:cost_history$/) ? true : " + d[".read"].slice(j); }
  if (kind === "M4") d[".write"] = once(d[".write"], "$dataKey.matches(/^biz:[^:]+:cost_history$/) ? false : ", "$dataKey.matches(/^biz:[^:]+:cost_history$/) ? (root.child('tenants').child($tenantId).child('members').child(auth.uid).val() === true) : ", "write");
  if (kind === "M5") r.rules.tenants["$tenantId"][".write"] = "auth !== null && root.child('tenants').child($tenantId).child('members').child(auth.uid).val() === true";
  if (kind === "M6") {
    const legacy = "$dataKey.matches(/^biz:[^:]+:cost_versions$/) ? (root.child('tenants').child($tenantId).child('members').child(auth.uid).val() === true) : ";
    d[".read"] = once(d[".read"], "auth !== null && ( ", "auth !== null && ( " + legacy, "read head");
    d[".write"] = once(d[".write"], "auth !== null && ( ", "auth !== null && ( " + legacy, "write head");
  }
  return r;
}

// ── fixtures and principals ──────────────────────────────────────────────────────────────────────
const T = "tenantA", TB = "tenantB";
const HIST = (b) => `tenants/${T}/biz:${b}:cost_history`;
const STORED = { head: { revision: 1, headVersionId: "00000000-0000-4000-8000-000000000001" }, versions: { "00000000-0000-4000-8000-000000000001": { versionId: "00000000-0000-4000-8000-000000000001" } }, review: { "00000000-0000-4000-8000-000000000001": { state: "cleared" } } };
const fixtures = () => ({
  tenants: {
    [T]: {
      members: { u_owner: true, u_super: true, u_mgrA: true, u_mgrB: true, u_viewA: true, u_removed: false },
      roles: { u_owner: "owner", u_super: "super_owner", u_mgrA: "manager", u_mgrB: "manager", u_viewA: "viewer", u_removed: "manager" },
      biz_access: { bizA: { u_mgrA: true, u_viewA: true, u_removed: true }, bizB: { u_mgrB: true } },
      "biz:bizA:cost_history": STORED, "biz:bizB:cost_history": STORED,
      "biz:bizA:cost_versions": { x: 1 }, "biz:bizA:cost_head": { x: 1 },
      "biz:bizA:config": { _v: "{}" }, cost_history: { bizA: { x: 1 } },
    },
    [TB]: { members: { u_cross: true }, roles: { u_cross: "owner" } },
  },
});
const P = {
  owner: { uid: "u_owner" }, super: { uid: "u_super" }, mgrA: { uid: "u_mgrA" }, mgrB: { uid: "u_mgrB" },
  viewA: { uid: "u_viewA" }, removed: { uid: "u_removed" }, cross: { uid: "u_cross" }, unauth: null,
};
const apps = {};
const asP = (name) => { if (!apps[name]) apps[name] = admin.initializeApp({ databaseURL: DB_URL, databaseAuthVariableOverride: P[name] ? { ...P[name], token: { email: name + "@x" } } : null }, "p-" + name); return apps[name].database(); };
const seedDb = () => apps.seed.database();

// ── the matrix: [id, tag, principal, op, path, expected "allow"|"deny"] ─────────────────────────
const READERS_ALLOW = ["owner", "super", "mgrA", "viewA"], READERS_DENY = ["mgrB", "removed", "cross", "unauth"];
const ALL = Object.keys(P);
const CASES = [];
for (const p of READERS_ALLOW) for (const sub of ["", "/versions", "/review", "/head"]) CASES.push([`R+ ${p} ${sub || "/"}`, "read", p, "read", HIST("bizA") + sub, "allow"]);
for (const p of READERS_DENY) for (const sub of ["", "/versions", "/review"]) CASES.push([`R- ${p} ${sub || "/"}`, p === "removed" ? "membership" : p === "mgrB" ? "business_access" : "read_scope", p, "read", HIST("bizA") + sub, "deny"]);
CASES.push(["R- mgrA other business", "business_access", "mgrA", "read", HIST("bizB"), "deny"]);
CASES.push(["R- viewA other business", "business_access", "viewA", "read", HIST("bizB"), "deny"]);
for (const p of ALL) {
  CASES.push([`W- ${p} set node`, "client_write", p, "set", HIST("bizA"), "deny"]);
  CASES.push([`W- ${p} set head`, "client_write", p, "set", HIST("bizA") + "/head/revision", "deny"]);
  CASES.push([`W- ${p} forge review`, "client_write", p, "set", HIST("bizA") + "/review/00000000-0000-4000-8000-000000000001/state", "deny"]);
  CASES.push([`W- ${p} add version`, "client_write", p, "set", HIST("bizA") + "/versions/00000000-0000-4000-8000-000000000009", "deny"]);
  CASES.push([`W- ${p} remove node`, "client_write", p, "remove", HIST("bizA"), "deny"]);
  CASES.push([`A- ${p} tenant-level update`, "ancestor", p, "update", `tenants/${T}`, "deny"]);
  CASES.push([`A- ${p} root-level update`, "ancestor", p, "rootupdate", "/", "deny"]);
  for (const key of ["biz:bizA:cost_versions", "biz:bizA:cost_head"]) {
    CASES.push([`L- ${p} read ${key}`, "legacy_layout", p, "read", `tenants/${T}/${key}`, "deny"]);
    CASES.push([`L- ${p} write ${key}`, "legacy_layout", p, "set", `tenants/${T}/${key}/y`, "deny"]);
  }
  // NOTE: a NON-`biz:` tenant key such as tenants/{t}/cost_history is governed by the PRE-EXISTING generic
  // tenant-key branch (member read / staff write since the July Rules) and is outside F1. No reader or writer
  // uses it: the codec and every loader address only biz:{b}:cost_history (static guard in the F1 R1 tests).
}
// unchanged behaviour outside F1 (controls)
CASES.push(["C+ mgrA reads its config", "control", "mgrA", "read", `tenants/${T}/biz:bizA:config`, "allow"]);
CASES.push(["C- mgrB reads bizA config", "control", "mgrB", "read", `tenants/${T}/biz:bizA:config`, "deny"]);
CASES.push(["C- mgrA reads tenant root", "control", "mgrA", "read", `tenants/${T}`, "deny"]);

async function attempt(db, op, path) {
  try {
    if (op === "read") await db.ref(path).once("value");
    else if (op === "set") await db.ref(path).set({ forged: true });
    else if (op === "remove") await db.ref(path).remove();
    else if (op === "update") await db.ref(path).update({ "biz:bizA:cost_history/head/revision": 99, "biz:bizA:cost_history/review/00000000-0000-4000-8000-000000000001/state": "cleared" });
    else if (op === "rootupdate") await db.ref("/").update({ [`tenants/${T}/biz:bizA:cost_history/head/revision`]: 98 });
    return "allow";
  } catch (e) { if (/permission/i.test(String(e && (e.code || e.message)))) return "deny"; throw e; }
}
async function runMatrix() {
  await seedDb().ref("/").set(fixtures());
  const before = JSON.stringify((await seedDb().ref("/").once("value")).val());
  const out = [];
  for (const [id, tag, p, op, path, expected] of CASES) {
    const got = await attempt(asP(p), op, path);
    out.push({ id, tag, expected, got, ok: got === expected });
    if (op !== "read" && got === "allow") await seedDb().ref("/").set(fixtures());   // a (mutant) write landed: restore
  }
  const after = JSON.stringify((await seedDb().ref("/").once("value")).val());
  return { out, unchanged: before === after };
}

async function main() {
  assertSafe();
  apps.seed = admin.initializeApp({ databaseURL: DB_URL }, "seed");
  const results = [];
  await loadRules(CANONICAL);
  const base = await runMatrix();
  const baseFails = base.out.filter((r) => !r.ok);
  results.push({ id: "F1R-BASE", status: baseFails.length === 0 && base.unchanged ? "PASS" : "FAIL", notes: `${base.out.length} cases; allow=${base.out.filter((r) => r.expected === "allow").length} deny=${base.out.filter((r) => r.expected === "deny").length}; failures=${baseFails.map((r) => r.id).join(", ") || "none"}; data unchanged=${base.unchanged}` });
  const TARGET = { M1: "membership", M2: "business_access", M3: "read_scope", M4: "client_write", M5: "ancestor", M6: "legacy_layout" };
  for (const [m, tag] of Object.entries(TARGET)) {
    await loadRules(mutate(m));
    const r = await runMatrix();
    const caught = r.out.filter((x) => !x.ok && x.tag === tag);
    results.push({ id: "F1R-" + m, status: caught.length >= 1 ? "PASS" : "FAIL", notes: `mutant (${tag}) caught by ${caught.length} targeted case(s): ${caught.slice(0, 3).map((x) => x.id).join(" | ")}` });
  }
  await loadRules(CANONICAL);
  const w = (s, n) => String(s).padEnd(n).slice(0, n);
  console.log(`\n${w("case", 10)} ${w("status", 6)} notes`); console.log("-".repeat(120));
  for (const r of results) console.log(`${w(r.id, 10)} ${w(r.status, 6)} ${r.notes}`);
  const failures = results.filter((r) => r.status !== "PASS").length;
  console.log("\n=== TOTALS ===");
  console.log(`total=${results.length} passed=${results.length - failures} failed=${failures} matrixCases=${CASES.length}`);
  if (results.length !== 7) { process.exitCode = 3; return; }
  if (failures) { process.exitCode = 1; return; }
  console.log("\nALL CASES PASSED — cost_history Rules exact; every mutation is caught by a targeted case");
}
const direct = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (direct) {
  main().then(async () => { await Promise.all(admin.apps.filter(Boolean).map((a) => a.delete().catch(() => {}))); })
    .catch(async (e) => { console.error("HARNESS ERROR:", (e && e.stack) || e); process.exitCode = 4; await Promise.all(admin.apps.filter(Boolean).map((a) => a.delete().catch(() => {}))); });
}
