// Deterministic tests for the server-managed biz_access authorization index and
// the Codex P0 hardening. Run: node test/security/biz-access.test.mjs
// NO network / Firebase / provider / production calls — pure functions + static
// source assertions only. Rules behavior is validated STATICALLY (no emulator);
// those cases are labelled [static-rules]. Handler wiring is validated by static
// source assertions (invoking the real handlers needs Admin SDK/Firebase, which
// is prohibited here) and labelled [static-src].
import assert from "node:assert";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  isImplicitAllRole, normalizeAllowedBizIds, bizAccessSetUpdates,
  bizAccessDiffUpdates, bizAccessClearUpdates, bizIdsForUid, parseAppUsers, flattenBizAccess,
} from "../../lib/bizAccess.js";
import {
  planTenantBackfill, planBackfill, parseArgs, writeAllowed,
  getActualProjectId, verifyProject, reconcile, cleanupUpdates,
} from "../../scripts/backfill-biz-access.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = join(__dirname, "..", "..");
const admin = readFileSync(join(REPO, "api", "admin.js"), "utf8");
const indexHtml = readFileSync(join(REPO, "index.html"), "utf8");
const rulesObj = JSON.parse(readFileSync(join(REPO, "database.rules.json"), "utf8"));
const ba = rulesObj.rules.tenants.$tenantId.biz_access;

let pass = 0, fail = 0;
const T = (name, fn) => { try { fn(); console.log("PASS " + name); pass++; }
  catch (e) { console.log("FAIL " + name + " — " + (e && e.message)); fail++; } };

// ── [static-rules] client write/read denial ──
T("R1 [static-rules] biz_access client write denied (.write:false)", () => assert.strictEqual(ba[".write"], false));
T("R2 [static-rules] biz_access client read denied (.read:false)", () => assert.strictEqual(ba[".read"], false));
T("R3 [static-rules] no role clauses (all client roles denied incl owner/super_owner)", () => assert.ok(!JSON.stringify(ba).match(/owner|manager|viewer/)));

// ── helper contracts ──
T("H1 set stages exact businesses", () => assert.deepStrictEqual(bizAccessSetUpdates("t1","u",normalizeAllowedBizIds(["a","b"])), {"tenants/t1/biz_access/a/u":true,"tenants/t1/biz_access/b/u":true}));
T("H2 diff adds/removes", () => assert.deepStrictEqual(bizAccessDiffUpdates("t1","u",["a","b"],["b","c"]), {"tenants/t1/biz_access/c/u":true,"tenants/t1/biz_access/a/u":null}));
T("H3 diff unchanged ⇒ {}", () => assert.deepStrictEqual(bizAccessDiffUpdates("t1","u",["a"],["a"]), {}));
T("H4 clear nulls all", () => assert.deepStrictEqual(bizAccessClearUpdates("t1","u",["a","b"]), {"tenants/t1/biz_access/a/u":null,"tenants/t1/biz_access/b/u":null}));
T("H5 bizIdsForUid lists true entries", () => assert.deepStrictEqual(bizIdsForUid({a:{u:true},b:{u:true,x:true},c:{x:true}},"u").sort(), ["a","b"]));
T("H6 tenantId===bizId valid", () => assert.deepStrictEqual(bizAccessSetUpdates("t1","u",["t1"]), {"tenants/t1/biz_access/t1/u":true}));
T("H7 malformed allowedBizIds rejected", () => { assert.throws(()=>normalizeAllowedBizIds("a")); assert.throws(()=>normalizeAllowedBizIds([1])); assert.throws(()=>normalizeAllowedBizIds(["a/b"])); assert.throws(()=>normalizeAllowedBizIds(["x".repeat(129)])); });
T("H8 duplicates normalized (no dup writes)", () => { const ids=normalizeAllowedBizIds(["a","a"," a ","b"]); assert.deepStrictEqual(ids,["a","b"]); assert.strictEqual(Object.keys(bizAccessSetUpdates("t","u",ids)).length,2); });

// ── Codex finding: NEW SCOPED CREATE-USER (validate-before-auth, persist app/users+users+biz_access) ──
T("C1 [static-src] create-user validates allowedBizIds BEFORE Auth creation", () => {
  const v = admin.indexOf("Validate allowedBizIds BEFORE creating the Auth user");
  const auth = admin.indexOf("Phase 2: Create Firebase Auth user");
  assert.ok(v > 0 && v < auth, "validation must precede Auth creation");
});
T("C2 [static-src] create-user persists app/users, users/{uid}(+allowedBizIds), biz_access in one flow", () => {
  assert.ok(admin.includes("updates[`tenants/${tenantId}/app/users`] = { _v: JSON.stringify(appUsersList) };"));
  assert.ok(admin.includes("allowedBizIds: createBiz,")); // users/{uid} record carries scope
  const appUsers = admin.indexOf("_v: JSON.stringify(appUsersList)");
  const bizSet = admin.indexOf("Object.assign(updates, bizAccessSetUpdates(tenantId, firebaseUid, createBiz))");
  const write = admin.indexOf("await db.ref().update(updates);", appUsers);
  assert.ok(appUsers > 0 && bizSet > appUsers && write > bizSet, "single atomic write after staging all three");
});
T("C3 [static-src] create-user client now sends allowedBizIds + is backend-authoritative (no client app/users write)", () => {
  assert.ok(indexHtml.includes("role: form.role,\n            allowedBizIds"));
  assert.ok(indexHtml.includes("Backend is the source of truth on create"));
  assert.ok(!indexHtml.includes("saveUsers([...users, newUser]);"));
});
T("C4 create manager/viewer stage exact scope; owner/super_owner implicit-all", () => {
  assert.deepStrictEqual(bizAccessSetUpdates("t","m",normalizeAllowedBizIds(["a","b"])), {"tenants/t/biz_access/a/m":true,"tenants/t/biz_access/b/m":true});
  assert.strictEqual(isImplicitAllRole("owner"), true);
  assert.strictEqual(isImplicitAllRole("super_owner"), true);
  assert.ok(admin.includes("if (!isImplicitAllRole(role)) {\n    Object.assign(updates, bizAccessSetUpdates(tenantId, firebaseUid, createBiz));"));
});

// ── Codex finding: ATOMIC DOWNGRADE / no partial mutations ──
T("A1 [static-src] handleRoles: ONE atomic mirror update; no transaction on the roles NODE (only the owner guard)", () => {
  const rolesStart = admin.indexOf("async function handleRoles");
  const rolesEnd = admin.indexOf("async function ", rolesStart + 10);
  const body = admin.slice(rolesStart, rolesEnd);
  assert.ok(!/db\.ref\(`tenants\/\$\{tenantId\}\/roles`\)\.transaction\(/.test(body), "no transaction on the roles node");
  assert.strictEqual((body.match(/await db\.ref\(\)\.update\(updates\)/g) || []).length, 1, "exactly one atomic mirror update");
  assert.ok(body.includes("ownerGuardPath(tenantId)).transaction("), "owner invariant guarded by a transaction on the guard node");
});
T("A2 [static-src] handleRoles writes role+members+audit+biz_access+app/users together", () => {
  const rolesStart = admin.indexOf("async function handleRoles");
  const body = admin.slice(rolesStart, admin.indexOf("async function ", rolesStart + 10));
  assert.ok(body.includes("/roles/${targetUid}`]   = role"));
  assert.ok(body.includes("/members/${targetUid}`] = role === null ? null : true"));
  assert.ok(body.includes("/audit/roles/${auditKey}`]"));
  assert.ok(body.includes("/app/users`] = { _v: JSON.stringify(list) }"));
});
T("A3 last-owner invariant preserved (now via concurrency-safe owner guard)", () => {
  const rolesStart = admin.indexOf("async function handleRoles");
  const body = admin.slice(rolesStart, admin.indexOf("async function ", rolesStart + 10));
  assert.ok(body.includes("if (ownerAffecting) {"), "owner-affecting ops routed through the guard");
  assert.ok(body.includes("last_owner"), "last-owner rejection mapped");
});

// ── Codex finding: REPLACEMENT OF STALE SCOPE / no stale entries survive downgrade ──
T("S1 downgrade replaces entire scope — stale entries cleared, new added", () => {
  // existing stale (drifted) entries for a formerly-implicit user + new scope
  const existing = ["stale1", "stale2"];
  const next = ["a", "stale1"];
  const u = bizAccessDiffUpdates("t", "u", existing, next);
  assert.deepStrictEqual(u, {
    "tenants/t/biz_access/a/u": true,        // added
    "tenants/t/biz_access/stale2/u": null,   // stale removed
    // stale1 kept (still in scope) — no redundant write
  });
});
T("S2 [static-src] roles downgrade uses diff(existing→next) so no stale survives", () => {
  assert.ok(admin.includes("bizAccessDiffUpdates(tenantId, targetUid, existingBiz, nextBiz)); // clears stale, adds new"));
});
T("S3 [static-src] roles downgrade requires explicit non-empty scope (fail closed)", () => {
  assert.ok(admin.includes("יש להגדיר הרשאות עסק בעת הורדת תפקיד"));
  assert.ok(admin.includes("יש להגדיר לפחות עסק אחד בעת הורדת תפקיד"));
});

// ── Codex finding: DIVERGENCE PREVENTION (app/users ↔ roles/biz_access) ──
T("D1 [static-src] handleRoles syncs app/users role + allowedBizIds (no divergence)", () => {
  const rolesStart = admin.indexOf("async function handleRoles");
  const body = admin.slice(rolesStart, admin.indexOf("async function ", rolesStart + 10));
  assert.ok(body.includes("const merged = { ...list[idx], role };"));
  assert.ok(body.includes("if (resolvedScope !== undefined) merged.allowedBizIds = resolvedScope;"));
  assert.ok(body.includes("if (idx >= 0) list.splice(idx, 1);")); // role removal drops from app/users
});
T("D2 [static-src] create-user is single authoritative flow (server writes app/users)", () => {
  assert.ok(admin.includes("server-authoritative append"));
});

// ── Codex finding: TARGET UID / PATH VALIDATION ──
T("V1 [static-src] update-user validates tenantId+firebaseUid path chars", () => {
  const s = admin.indexOf("async function handleUpdateUser");
  const body = admin.slice(s, admin.indexOf("async function ", s + 10));
  assert.ok(body.includes("invalid tenantId or firebaseUid"));
  assert.ok(body.includes("RTDB_FORBIDDEN.test(tenantId) || RTDB_FORBIDDEN.test(firebaseUid)"));
});
T("V2 [static-src] delete-user validates tenantId+firebaseUid path chars", () => {
  const s = admin.indexOf("async function handleDeleteUser");
  const body = admin.slice(s, admin.indexOf("async function ", s + 10));
  assert.ok(body.includes("invalid tenantId or firebaseUid"));
  assert.ok(body.includes("RTDB_FORBIDDEN.test(tenantId) || RTDB_FORBIDDEN.test(firebaseUid)"));
});
T("V3 [static-src] create-user validates tenantId path chars before write", () => {
  assert.ok(admin.includes("invalid characters in tenantId"));
});
T("V4 [static-src] roles validates tenantId+targetUid path chars", () => {
  assert.ok(admin.includes('RTDB_FORBIDDEN.test(tenantId) || RTDB_FORBIDDEN.test(targetUid)'));
});

// ── Codex finding: BACKFILL — WRONG PROJECT verification ──
T("B1 verifyProject rejects mismatch (never trusts --env label)", () => {
  assert.strictEqual(verifyProject("proj-A", "proj-B").ok, false);
});
T("B2 verifyProject rejects unknown actual / missing expected", () => {
  assert.strictEqual(verifyProject(null, "proj-B").ok, false);
  assert.strictEqual(verifyProject("proj-A", null).ok, false);
});
T("B3 verifyProject accepts exact match", () => {
  assert.strictEqual(verifyProject("proj-A", "proj-A").ok, true);
});
T("B4 getActualProjectId reads app options / credential", () => {
  assert.strictEqual(getActualProjectId({ options: { projectId: "p1" } }), "p1");
  assert.strictEqual(getActualProjectId({ options: { credential: { projectId: "p2" } } }), "p2");
});

// ── Codex finding: BACKFILL — UNEXPECTED ENTRIES / reconcile + cleanup ──
const fixtureTenants = {
  t1: {
    roles: { uOwner: "owner", uSuper: "super_owner", uMgr: "manager", uView: "viewer" },
    app: { users: { _v: JSON.stringify([
      { firebaseUid: "uOwner", role: "owner", allowedBizIds: null },
      { firebaseUid: "uSuper", role: "super_owner" },
      { firebaseUid: "uMgr", role: "manager", allowedBizIds: ["bizA", "bizB", "bizA"] },
      { firebaseUid: "uView", role: "viewer", allowedBizIds: ["bizA"] },
    ]) } },
    // existing biz_access has a stale/unexpected entry (bizZ/uMgr) not in the plan:
    biz_access: { bizA: { uMgr: true, uView: true }, bizB: { uMgr: true }, bizZ: { uMgr: true } },
  },
};
T("U1 reconcile detects UNEXPECTED entries (in DB, not in plan)", () => {
  const { updates } = planBackfill(fixtureTenants);
  const { unexpected } = reconcile(updates, fixtureTenants);
  assert.deepStrictEqual(unexpected, ["tenants/t1/biz_access/bizZ/uMgr"]);
});
T("U2 reconcile detects MISSING entries (in plan, absent in DB)", () => {
  const barePlanTenants = { t1: { roles: fixtureTenants.t1.roles, app: fixtureTenants.t1.app } }; // no biz_access yet
  const { updates } = planBackfill(barePlanTenants);
  const { missing } = reconcile(updates, barePlanTenants);
  assert.strictEqual(missing.length, 3);
});
T("U3 cleanupUpdates nulls exactly the unexpected paths", () => {
  assert.deepStrictEqual(cleanupUpdates(["tenants/t1/biz_access/bizZ/uMgr"]), { "tenants/t1/biz_access/bizZ/uMgr": null });
});
T("U4 flattenBizAccess enumerates existing true paths", () => {
  const s = flattenBizAccess(fixtureTenants);
  assert.ok(s.has("tenants/t1/biz_access/bizZ/uMgr") && s.has("tenants/t1/biz_access/bizA/uView"));
});

// ── migration modes / guards ──
T("M1 dry-run (default) writes nothing", () => assert.strictEqual(writeAllowed(parseArgs(["--env=e","--project=p"]), "apply").allowed, false));
T("M2 skips owner/super_owner; maps scoped w/ dedup", () => {
  const { updates, summary } = planBackfill(fixtureTenants);
  assert.deepStrictEqual(updates, { "tenants/t1/biz_access/bizA/uMgr": true, "tenants/t1/biz_access/bizB/uMgr": true, "tenants/t1/biz_access/bizA/uView": true });
  assert.strictEqual(summary.scopedUsers, 2); assert.strictEqual(summary.skippedUsers, 2);
});
T("M3 idempotent", () => assert.deepStrictEqual(planBackfill(fixtureTenants).updates, planBackfill(fixtureTenants).updates));
T("M4 STOPS on malformed tenant blob", () => assert.throws(() => planBackfill({ t9: { roles: {}, app: { users: { _v: "{bad" } } } }, { stopOnMalformed: true }), (e) => e.malformed === true));
T("M5 apply requires --project + matching --confirm-production", () => {
  assert.strictEqual(writeAllowed(parseArgs(["--env=e","--project=p","--apply"]), "apply").allowed, false);
  assert.strictEqual(writeAllowed(parseArgs(["--env=e","--project=p","--apply","--confirm-production=wrong"]), "apply").allowed, false);
  assert.strictEqual(writeAllowed(parseArgs(["--env=e","--project=p","--apply","--confirm-production=p"]), "apply").allowed, true);
});
T("M6 cleanup is an explicit, separately-confirmed mode", () => {
  assert.strictEqual(writeAllowed(parseArgs(["--env=e","--project=p","--cleanup"]), "cleanup").allowed, false);
  assert.strictEqual(writeAllowed(parseArgs(["--env=e","--project=p","--cleanup","--confirm-production=p"]), "cleanup").allowed, true);
  assert.strictEqual(parseArgs(["--reconcile"]).reconcile, true);
});

// ── invariants ──
T("I1 no role named 'admin'", () => { assert.strictEqual(isImplicitAllRole("admin"), false); assert.ok(!/role\s*===\s*["']admin["']/.test(admin)); assert.ok(!JSON.stringify(ba).includes("admin")); });
T("I2 no new Vercel function (api function-file count = 12)", () => {
  const walk = (d) => readdirSync(d).flatMap((f) => { const fp = join(d, f); return statSync(fp).isDirectory() ? walk(fp) : [fp]; });
  const apiFns = walk(join(REPO, "api")).filter((f) => f.endsWith(".js") || f.endsWith(".ts"));
  assert.strictEqual(apiFns.length, 12, "api function count = " + apiFns.length);
});
T("I3 tests do no external/Firebase calls; migration imports firebase-admin only in main()", () => {
  const mig = readFileSync(join(REPO, "scripts", "backfill-biz-access.mjs"), "utf8");
  assert.ok(mig.includes('await import("firebase-admin")'));
  assert.ok(!/^import .*firebase-admin/m.test(mig));
});
T("I4 parseAppUsers matches server semantics", () => {
  assert.deepStrictEqual(parseAppUsers({ _v: JSON.stringify([{ a: 1 }]) }), [{ a: 1 }]);
  assert.deepStrictEqual(parseAppUsers(null), []);
  assert.throws(() => parseAppUsers({ _v: "nope" }), (e) => e.malformed === true);
});

console.log(`\nTotal: ${pass + fail}  Passed: ${pass}  Failed: ${fail}`);
process.exit(fail === 0 ? 0 : 1);
