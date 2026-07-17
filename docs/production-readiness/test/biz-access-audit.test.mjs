// Deterministic synthetic tests for the pure biz_access model. No Firebase, no network.
import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyBizAccess, parseAppUsers, parseAppBusiness, normalizeAllowedBizIds } from "../lib/biz-access-model.mjs";

const users = (arr) => ({ _v: JSON.stringify(arr) });      // canonical {_v:"<json array>"}
const biz = (arr) => ({ _v: JSON.stringify(arr) });
const BIZ_REG = biz([{ id: "bizA", name: "A" }, { id: "bizB", name: "B" }]);

function run(over) {
  return classifyBizAccess({ tenantId: "tenantA", salt: "t", appBusinessRaw: BIZ_REG, members: {}, roles: {}, bizAccess: {}, appUsersRaw: users([]), ...over });
}

test("1. complete valid mapping -> READY", () => {
  const r = run({
    members: { uMgr: true }, roles: { uMgr: "manager" },
    bizAccess: { bizA: { uMgr: true } },
    appUsersRaw: users([{ firebaseUid: "uMgr", role: "manager", allowedBizIds: ["bizA"] }]),
  });
  assert.equal(r.categories.READY, 1);
  assert.equal(r.categories.NEEDS_BACKFILL, 0);
  assert.equal(r.needsAttention, false);
});

test("2. scoped user missing grant -> NEEDS_BACKFILL + additive proposed grant", () => {
  const r = run({
    members: { uMgr: true }, roles: { uMgr: "manager" }, bizAccess: {},
    appUsersRaw: users([{ firebaseUid: "uMgr", role: "manager", allowedBizIds: ["bizA"] }]),
  });
  assert.equal(r.categories.NEEDS_BACKFILL, 1);
  assert.equal(r.proposedGrants.length, 1);
  assert.equal(r.proposedGrants[0].additiveOnly, true);
  assert.ok(r.proposedGrants[0].reason);
});

test("3. grant without membership -> ORPHANED_ACCESS", () => {
  const r = run({ members: {}, roles: {}, bizAccess: { bizA: { uGhost: true } }, appUsersRaw: users([]) });
  assert.equal(r.categories.ORPHANED_ACCESS, 1);
});

test("3b. role/user present but no members entry -> MISSING_MEMBERSHIP", () => {
  const r = run({ members: {}, roles: { uMgr: "manager" }, appUsersRaw: users([{ firebaseUid: "uMgr", role: "manager", allowedBizIds: ["bizA"] }]) });
  assert.equal(r.categories.MISSING_MEMBERSHIP, 1);
  assert.equal(r.categories.READY, 0);
});

test("4. invalid role -> INVALID_ROLE (never READY)", () => {
  const r = run({ members: { uX: true }, roles: { uX: "superuser" }, appUsersRaw: users([{ firebaseUid: "uX", role: "superuser" }]) });
  assert.equal(r.categories.INVALID_ROLE, 1);
  assert.equal(r.categories.READY, 0);
});

test("5. unknown business -> UNKNOWN_BUSINESS", () => {
  const r = run({ members: { uMgr: true }, roles: { uMgr: "manager" }, bizAccess: {}, appUsersRaw: users([{ firebaseUid: "uMgr", role: "manager", allowedBizIds: ["bizZ"] }]) });
  assert.equal(r.categories.UNKNOWN_BUSINESS, 1);
  assert.equal(r.categories.NEEDS_BACKFILL, 0);
});

test("6. malformed app/users _v -> AMBIGUOUS + malformed, never READY", () => {
  const r = run({ members: { uMgr: true }, roles: { uMgr: "manager" }, appUsersRaw: { _v: "{not json" } });
  assert.equal(r.malformed, true);
  assert.ok(r.categories.AMBIGUOUS_MAPPING >= 1);
  assert.equal(r.categories.READY, 0);
});

test("7. malformed app/business _v -> AMBIGUOUS + malformed", () => {
  const r = run({ appBusinessRaw: { _v: "not json" }, members: { uMgr: true }, roles: { uMgr: "manager" }, appUsersRaw: users([{ firebaseUid: "uMgr", role: "manager", allowedBizIds: ["bizA"] }]) });
  assert.equal(r.malformed, true);
  assert.ok(r.categories.AMBIGUOUS_MAPPING >= 1);
});

test("8. duplicate app/users record -> AMBIGUOUS (not READY)", () => {
  const r = run({
    members: { uMgr: true }, roles: { uMgr: "manager" }, bizAccess: { bizA: { uMgr: true } },
    appUsersRaw: users([{ firebaseUid: "uMgr", role: "manager", allowedBizIds: ["bizA"] }, { firebaseUid: "uMgr", role: "manager", allowedBizIds: ["bizB"] }]),
  });
  assert.ok(r.categories.AMBIGUOUS_MAPPING >= 1);
});

test("9. duplicate business id in registry -> AMBIGUOUS", () => {
  const r = run({ appBusinessRaw: biz([{ id: "bizA", name: "A" }, { id: "bizA", name: "A2" }]) });
  assert.ok(r.findings.some((f) => f.subject === "app/business" && /duplicate/.test(f.note)));
});

test("9b. business record with array-index-only (no id) is rejected", () => {
  const pb = parseAppBusiness(biz([{ name: "no id here" }, { id: "bizB", name: "B" }]));
  assert.equal(pb.businesses.has("bizB"), true);
  assert.equal(pb.missingIdCount, 1);
  assert.equal(pb.businesses.size, 1); // index 0 NOT treated as an id
});

test("10. allowedBizIds conflict (invalid entries) -> AMBIGUOUS, never READY", () => {
  const r = run({ members: { uMgr: true }, roles: { uMgr: "manager" }, appUsersRaw: users([{ firebaseUid: "uMgr", role: "manager", allowedBizIds: [123, "bizA"] }]) });
  assert.ok(r.categories.AMBIGUOUS_MAPPING >= 1);
  assert.equal(r.categories.READY, 0);
});

test("11. owner/super_owner -> READY implicit-all, NO proposed grants, allowedBizIds ignored", () => {
  const r = run({
    members: { uOwn: true, uSup: true }, roles: { uOwn: "owner", uSup: "super_owner" }, bizAccess: {},
    appUsersRaw: users([{ firebaseUid: "uOwn", role: "owner", allowedBizIds: ["bizA"] }, { firebaseUid: "uSup", role: "super_owner" }]),
  });
  assert.equal(r.categories.READY, 2);
  assert.equal(r.categories.NEEDS_BACKFILL, 0);
  assert.equal(r.proposedGrants.length, 0);
  assert.ok(r.findings.filter((f) => f.scope === "implicit-all").length === 2);
});

test("11b. owner WITH an explicit biz_access entry -> AMBIGUOUS (implicit role should have none)", () => {
  const r = run({ members: { uOwn: true }, roles: { uOwn: "owner" }, bizAccess: { bizA: { uOwn: true } }, appUsersRaw: users([{ firebaseUid: "uOwn", role: "owner" }]) });
  assert.ok(r.findings.some((f) => /implicit-all role should have none/.test(f.note || "")));
});

test("12. redaction: NO raw uid/email/bizId/tenantId in findings or grants", () => {
  const r = run({
    members: { uSecret: true }, roles: { uSecret: "manager" }, bizAccess: {},
    appUsersRaw: users([{ firebaseUid: "uSecret", email: "secret@corp.example", role: "manager", allowedBizIds: ["bizSecret"] }]),
    appBusinessRaw: biz([{ id: "bizSecret", name: "SecretCo" }]),
  });
  const blob = JSON.stringify({ findings: r.findings, proposedGrants: r.proposedGrants, tenantRef: r.tenantRef });
  for (const raw of ["uSecret", "secret@corp.example", "bizSecret", "SecretCo", "tenantA"]) {
    assert.ok(!blob.includes(raw), `raw identifier leaked: ${raw}`);
  }
  // references still present + deterministic (same input -> same ref)
  assert.match(blob, /uid_[0-9a-f]{12}/);
  assert.match(blob, /biz_[0-9a-f]{12}/);
});

test("parseAppUsers accepts array | {_v} | string; fails closed otherwise", () => {
  assert.deepEqual(parseAppUsers([{ uid: "x" }]).list, [{ uid: "x" }]);
  assert.equal(parseAppUsers({ _v: "[1,2]" }).ok, true);
  assert.equal(parseAppUsers("[3]").ok, true);
  assert.equal(parseAppUsers({ _v: "{bad" }).ok, false);
  assert.equal(parseAppUsers(42).ok, false);
});

test("normalizeAllowedBizIds fail-closed", () => {
  assert.equal(normalizeAllowedBizIds("nope").ok, false);
  assert.equal(normalizeAllowedBizIds([1]).ok, false);
  assert.deepEqual(normalizeAllowedBizIds(["a", "a", " b "]).ids, ["a", "b"]);
});

// ─── PR-005: deterministic ordering + biz-access safeguards ───────────────────
import { byCodePoint } from "../lib/biz-access-model.mjs";

test("PR-005: identical snapshot, different member/role insertion order -> byte-equal output", () => {
  const build = (order) => {
    const members = {}, roles = {}; const ba = { bizA: {}, bizB: {} };
    for (const [u, r, b] of order) { members[u] = true; roles[u] = r; if (b) ba[b][u] = true; }
    return classifyBizAccess({
      tenantId: "tenantA", salt: "t",
      appBusinessRaw: biz([{ id: "bizA", name: "A" }, { id: "bizB", name: "B" }]),
      members, roles, bizAccess: ba,
      appUsersRaw: users([
        { firebaseUid: "uM1", role: "manager", allowedBizIds: ["bizA"] },
        { firebaseUid: "uM2", role: "manager", allowedBizIds: ["bizB"] },
        { firebaseUid: "uV", role: "viewer", allowedBizIds: ["bizA"] },
      ]),
    });
  };
  const fwd = [["uM1", "manager", null], ["uM2", "manager", null], ["uV", "viewer", "bizA"]];
  const rev = [["uV", "viewer", "bizA"], ["uM2", "manager", null], ["uM1", "manager", null]];
  const a = build(fwd), b = build(rev);
  assert.deepEqual(a.findings, b.findings);
  assert.deepEqual(a.proposedGrants, b.proposedGrants);
  assert.equal(JSON.stringify(a), JSON.stringify(b)); // byte-equal
});

test("PR-005: findings + proposedGrants are code-point sorted", () => {
  const r = classifyBizAccess({
    tenantId: "tenantA", salt: "t", appBusinessRaw: biz([{ id: "bizA", name: "A" }, { id: "bizB", name: "B" }]),
    members: { uZ: true, uA: true, uM: true }, roles: { uZ: "manager", uA: "manager", uM: "manager" }, bizAccess: {},
    appUsersRaw: users([{ firebaseUid: "uZ", role: "manager", allowedBizIds: ["bizA"] }, { firebaseUid: "uA", role: "manager", allowedBizIds: ["bizB"] }, { firebaseUid: "uM", role: "manager", allowedBizIds: ["bizA"] }]),
  });
  const fkeys = r.findings.map((f) => [f.category, f.businessRef || "", f.userRef || ""].join(" "));
  assert.deepEqual(fkeys, [...fkeys].sort(byCodePoint));
  const gkeys = r.proposedGrants.map((g) => [g.businessRef || "", g.userRef || ""].join(" "));
  assert.deepEqual(gkeys, [...gkeys].sort(byCodePoint));
});

test("safeguard: invalid/null role is never an automatic grant candidate", () => {
  const r = run({ members: { uX: true }, roles: { uX: null }, appUsersRaw: users([{ firebaseUid: "uX", role: null, allowedBizIds: ["bizA"] }]) });
  assert.equal(r.categories.INVALID_ROLE, 1);
  assert.equal(r.proposedGrants.length, 0);
});

test("safeguard: missing app/users record is never an automatic grant candidate", () => {
  const r = run({ members: { uM: true }, roles: { uM: "manager" }, appUsersRaw: users([]) });
  assert.equal(r.categories.AMBIGUOUS_MAPPING >= 1, true);
  assert.equal(r.proposedGrants.length, 0);
});

test("safeguard: proposed grants are additive-only recommendations (no removals)", () => {
  const r = run({ members: { uM: true }, roles: { uM: "manager" }, bizAccess: {}, appUsersRaw: users([{ firebaseUid: "uM", role: "manager", allowedBizIds: ["bizA"] }]) });
  assert.equal(r.proposedGrants.length, 1);
  for (const g of r.proposedGrants) { assert.equal(g.grant, true); assert.equal(g.additiveOnly, true); }
  assert.equal(JSON.stringify(r.proposedGrants).includes('"grant":false'), false);
});
