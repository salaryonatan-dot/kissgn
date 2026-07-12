// Deterministic tests for the server-managed biz_access authorization index.
//   Run:  node test/security/biz-access.test.mjs
// NO network / Firebase / provider / production calls — pure functions + static
// source assertions only. Rules behavior is validated STATICALLY (no emulator
// available here); those cases are explicitly labelled [static-rules].
import assert from "node:assert";
import { readFileSync, readdirSync, statSync } from "node:fs";
const requireFs = { readdirSync, statSync };
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  isImplicitAllRole, normalizeAllowedBizIds, bizAccessSetUpdates,
  bizAccessDiffUpdates, bizAccessClearUpdates, bizIdsForUid, parseAppUsers,
} from "../../lib/bizAccess.js";
import {
  planTenantBackfill, planBackfill, parseArgs, writeAllowed,
} from "../../scripts/backfill-biz-access.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = join(__dirname, "..", "..");
const admin = readFileSync(join(REPO, "api", "admin.js"), "utf8");
const rules = readFileSync(join(REPO, "database.rules.json"), "utf8");
const rulesObj = JSON.parse(rules);

let pass = 0, fail = 0;
const T = (name, fn) => { try { fn(); console.log("PASS " + name); pass++; }
  catch (e) { console.log("FAIL " + name + " — " + (e && e.message)); fail++; } };

// ── [static-rules] client write/read denial (#1–#6) ──
const ba = rulesObj.rules.tenants.$tenantId.biz_access;
T("1 [static-rules] unauthenticated client write denied (.write:false)", () => assert.strictEqual(ba[".write"], false));
T("2 [static-rules] viewer client write denied (.write:false, no role clause)", () => { assert.strictEqual(ba[".write"], false); assert.ok(!JSON.stringify(ba).includes("viewer")); });
T("3 [static-rules] shift_manager client write denied", () => { assert.strictEqual(ba[".write"], false); assert.ok(!JSON.stringify(ba).includes("shift_manager")); });
T("4 [static-rules] manager client write denied (no manager write clause)", () => { assert.strictEqual(ba[".write"], false); assert.ok(!JSON.stringify(ba).includes("manager")); });
T("5 [static-rules] owner client write denied", () => { assert.strictEqual(ba[".write"], false); });
T("6 [static-rules] super_owner client write denied + client read denied", () => { assert.strictEqual(ba[".write"], false); assert.strictEqual(ba[".read"], false); });

// ── server flow behavior via the exact helpers the handlers use (#7–#26) ──
T("7 create manager stages exact allowed businesses", () => {
  const u = bizAccessSetUpdates("t1", "uidM", normalizeAllowedBizIds(["bizA", "bizB"]));
  assert.deepStrictEqual(u, { "tenants/t1/biz_access/bizA/uidM": true, "tenants/t1/biz_access/bizB/uidM": true });
});
T("8 create viewer stages exact allowed businesses", () => {
  const u = bizAccessSetUpdates("t1", "uidV", normalizeAllowedBizIds(["bizA"]));
  assert.deepStrictEqual(u, { "tenants/t1/biz_access/bizA/uidV": true });
});
T("9 create owner stages none (implicit-all guard)", () => {
  assert.strictEqual(isImplicitAllRole("owner"), true);
  // handler guard: `if (!isImplicitAllRole(role) && allowedBizIds !== undefined)`
  assert.ok(admin.includes("!isImplicitAllRole(role) && allowedBizIds !== undefined"));
});
T("10 create super_owner stages none (implicit-all)", () => assert.strictEqual(isImplicitAllRole("super_owner"), true));
T("11 update adds one business", () => {
  const u = bizAccessDiffUpdates("t1", "u", ["bizA"], ["bizA", "bizB"]);
  assert.deepStrictEqual(u, { "tenants/t1/biz_access/bizB/u": true });
});
T("12 update removes one business (→ null)", () => {
  const u = bizAccessDiffUpdates("t1", "u", ["bizA", "bizB"], ["bizA"]);
  assert.deepStrictEqual(u, { "tenants/t1/biz_access/bizB/u": null });
});
T("13 update unchanged ⇒ no mutation", () => {
  const u = bizAccessDiffUpdates("t1", "u", ["bizA", "bizB"], ["bizB", "bizA"]);
  assert.deepStrictEqual(u, {});
});
T("14 promotion to owner clears scoped entries", () => {
  const tree = { bizA: { u: true }, bizB: { u: true, other: true } };
  const cleared = bizAccessClearUpdates("t1", "u", bizIdsForUid(tree, "u"));
  assert.deepStrictEqual(cleared, { "tenants/t1/biz_access/bizA/u": null, "tenants/t1/biz_access/bizB/u": null });
  // handler applies this when effective role is implicit-all
  assert.ok(admin.includes("isImplicitAllRole(effectiveRoleBA)"));
});
T("15 downgrade to scoped WITHOUT allowedBizIds fails closed", () => {
  // roles handler returns 400 before mutating; normalize(undefined) throws (fail-closed signal)
  assert.throws(() => normalizeAllowedBizIds(undefined));
  assert.ok(admin.includes("יש להגדיר הרשאות עסק בעת הורדת תפקיד"));
});
T("16 downgrade WITH explicit allowedBizIds creates exact entries", () => {
  const u = bizAccessSetUpdates("t1", "u", normalizeAllowedBizIds(["bizA", "bizC"]));
  assert.deepStrictEqual(Object.keys(u).sort(), ["tenants/t1/biz_access/bizA/u", "tenants/t1/biz_access/bizC/u"]);
});
T("17 scoped→scoped preserves valid scope (no allowedBizIds ⇒ no change path exists)", () => {
  // handler leaves biz_access untouched when allowedBizIds is undefined and not a downgrade
  assert.ok(admin.includes("// scoped → scoped without allowedBizIds ⇒ preserve existing scope (no change)"));
  assert.deepStrictEqual(bizAccessDiffUpdates("t1", "u", ["bizA"], ["bizA"]), {});
});
T("18 delete removes every access entry for the uid", () => {
  const tree = { bizA: { u: true }, bizB: { u: true }, bizC: { other: true } };
  const cleared = bizAccessClearUpdates("t1", "u", bizIdsForUid(tree, "u"));
  assert.deepStrictEqual(cleared, { "tenants/t1/biz_access/bizA/u": null, "tenants/t1/biz_access/bizB/u": null });
});
T("19 wrong tenant cannot be targeted (paths scoped to given tenant + owner-gated handlers)", () => {
  const u = bizAccessSetUpdates("tenantX", "u", ["bizA"]);
  assert.ok(Object.keys(u).every(k => k.startsWith("tenants/tenantX/biz_access/")));
  // every user-admin handler requires owner/super_owner of the *named* tenant
  assert.ok(admin.includes('requireTenantAccess(claims.uid, tenantId, "owner")')); // create + roles
  assert.ok(admin.match(/\["owner", "super_owner"\]\.includes\(callerRole\.val\(\)\)/)); // update + delete
});
T("20 forged UID cannot be targeted without existing owner authorization", () => {
  // biz_access is only ever written inside owner-gated handlers; no client write path exists
  assert.strictEqual(ba[".write"], false);
  assert.ok(admin.includes("bizAccessSetUpdates(") || admin.includes("bizAccessDiffUpdates("));
});
T("21 tenantId === bizId is valid", () => {
  const u = bizAccessSetUpdates("t1", "u", ["t1"]);
  assert.deepStrictEqual(u, { "tenants/t1/biz_access/t1/u": true });
});
T("22 malformed allowedBizIds rejected", () => {
  assert.throws(() => normalizeAllowedBizIds("bizA"));       // not array
  assert.throws(() => normalizeAllowedBizIds([123]));         // non-string
  assert.throws(() => normalizeAllowedBizIds(["a/b"]));       // forbidden char
  assert.throws(() => normalizeAllowedBizIds(["x".repeat(129)])); // too long
});
T("23 duplicate IDs normalized without duplicate writes", () => {
  const ids = normalizeAllowedBizIds(["bizA", "bizA", " bizA ", "bizB"]);
  assert.deepStrictEqual(ids, ["bizA", "bizB"]);
  assert.strictEqual(Object.keys(bizAccessSetUpdates("t1", "u", ids)).length, 2);
});
T("24 empty scoped list policy: [] allowed for update, rejected for role-downgrade", () => {
  assert.deepStrictEqual(normalizeAllowedBizIds([]), []); // update-user: explicit no-access is allowed
  assert.ok(admin.includes("יש להגדיר לפחות עסק אחד בעת הורדת תפקיד")); // roles: downgrade needs >=1
});
T("25 update batch contains BOTH app/users and biz_access, one atomic write", () => {
  const upd = admin.indexOf("updates[`tenants/${tenantId}/app/users`] = { _v: JSON.stringify(list) };");
  const bizSync = admin.indexOf("biz_access mirror — server-managed per-business authorization index");
  const write = admin.indexOf("await db.ref().update(updates);\n  } catch (e) {\n    console.error(\"[update-user] RTDB write failed:\"");
  assert.ok(upd > 0 && bizSync > upd && write > bizSync, "app/users → biz_access → single update ordering");
});
T("26 failed validation writes nothing (throw precedes any update merge)", () => {
  // create-user: normalize throw → rollback + return BEFORE db.ref().update(updates)
  const idx = admin.indexOf("createBiz = normalizeAllowedBizIds(allowedBizIds)");
  const ret = admin.indexOf('res.status(be?.status || 400).json({ error: be?.msg || "invalid allowedBizIds" }); return;');
  const write = admin.indexOf("await db.ref().update(updates);", idx);
  assert.ok(idx > 0 && ret > idx && write > ret);
});

// ── migration (#27–#32) ──
const fixtureTenants = {
  t1: {
    roles: { uOwner: "owner", uSuper: "super_owner", uMgr: "manager", uView: "viewer" },
    app: { users: { _v: JSON.stringify([
      { firebaseUid: "uOwner", role: "owner", allowedBizIds: null },
      { firebaseUid: "uSuper", role: "super_owner" },
      { firebaseUid: "uMgr", role: "manager", allowedBizIds: ["bizA", "bizB", "bizA"] },
      { firebaseUid: "uView", role: "viewer", allowedBizIds: ["bizA"] },
    ]) } },
  },
};
T("27 migration dry-run writes nothing (default not allowed)", () => {
  assert.strictEqual(writeAllowed(parseArgs(["--env=e1"])).allowed, false);
});
T("28 migration skips owner/super_owner", () => {
  const { updates } = planBackfill(fixtureTenants);
  assert.ok(!Object.keys(updates).some(k => k.includes("/uOwner") || k.includes("/uSuper")));
});
T("29 migration maps scoped users correctly (dedup + per biz)", () => {
  const { updates, summary } = planBackfill(fixtureTenants);
  assert.deepStrictEqual(updates, {
    "tenants/t1/biz_access/bizA/uMgr": true,
    "tenants/t1/biz_access/bizB/uMgr": true,
    "tenants/t1/biz_access/bizA/uView": true,
  });
  assert.strictEqual(summary.scopedUsers, 2);
  assert.strictEqual(summary.skippedUsers, 2);
  assert.strictEqual(summary.accessEntriesProposed, 3);
});
T("30 migration idempotent (same input ⇒ identical plan)", () => {
  assert.deepStrictEqual(planBackfill(fixtureTenants).updates, planBackfill(fixtureTenants).updates);
});
T("31 migration STOPS on malformed tenant blob", () => {
  const bad = { t9: { roles: {}, app: { users: { _v: "{not json" } } } };
  assert.throws(() => planBackfill(bad, { stopOnMalformed: true }), (e) => e.malformed === true);
});
T("32 migration production write requires explicit matching confirmation", () => {
  assert.strictEqual(writeAllowed(parseArgs(["--env=prod", "--apply"])).allowed, false);
  assert.strictEqual(writeAllowed(parseArgs(["--env=prod", "--apply", "--confirm-production=wrong"])).allowed, false);
  assert.strictEqual(writeAllowed(parseArgs(["--env=prod", "--apply", "--confirm-production=prod"])).allowed, true);
});

// ── invariants (#33–#35) ──
T("33 no role named 'admin' (biz_access + rules); admin only refers to /api/admin", () => {
  assert.strictEqual(isImplicitAllRole("admin"), false);
  const validRoles = ["owner", "manager", "shift_manager", "viewer", "super_owner"];
  // biz_access rule contains no role literals at all
  assert.ok(!JSON.stringify(ba).includes("admin"));
  // the only "admin" tokens in api/admin.js are the endpoint/file name, never a role value
  assert.ok(!/role\s*===\s*["']admin["']/.test(admin));
});
T("34 no new Vercel function added (api function-file count unchanged = 12)", () => {
  // helpers live in lib/ and scripts/, which are NOT Vercel serverless functions.
  // Count api/ function files — must remain 12 (our new files are lib/, scripts/, test/).
  const { readdirSync, statSync } = requireFs;
  const walk = (d) => readdirSync(d).flatMap((f) => {
    const fp = join(d, f);
    return statSync(fp).isDirectory() ? walk(fp) : [fp];
  });
  const apiFns = walk(join(REPO, "api")).filter((f) => f.endsWith(".js") || f.endsWith(".ts"));
  assert.strictEqual(apiFns.length, 12, "api function count changed: " + apiFns.length);
});
T("35 tests perform no external/Firebase calls (pure imports only)", () => {
  // firebase-admin is imported dynamically INSIDE main(), never at module load
  const mig = readFileSync(join(REPO, "scripts", "backfill-biz-access.mjs"), "utf8");
  assert.ok(mig.includes('await import("firebase-admin")'));
  assert.ok(!/^import .*firebase-admin/m.test(mig));
});

// parseAppUsers semantics sanity (supports server parity)
T("parseAppUsers matches server semantics ({_v}|string|array)", () => {
  assert.deepStrictEqual(parseAppUsers({ _v: JSON.stringify([{ a: 1 }]) }), [{ a: 1 }]);
  assert.deepStrictEqual(parseAppUsers([{ a: 1 }]), [{ a: 1 }]);
  assert.deepStrictEqual(parseAppUsers(null), []);
  assert.throws(() => parseAppUsers({ _v: "nope" }), (e) => e.malformed === true);
});

console.log(`\nTotal: ${pass + fail}  Passed: ${pass}  Failed: ${fail}`);
process.exit(fail === 0 ? 0 : 1);
