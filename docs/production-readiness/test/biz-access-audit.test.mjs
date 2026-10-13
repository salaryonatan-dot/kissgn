// Deterministic synthetic tests for the pure biz_access model. No Firebase, no network.
import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyBizAccess, parseAppUsers, parseAppBusiness, normalizeAllowedBizIds } from "../lib/biz-access-model.mjs";
// PR-003 output-path validation: exercise the real CLI helper + subprocess.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { assertLocalOutPath } from "../biz-access-audit.mjs";

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
  // I5 test-contract transition (T-I5-AUDIT-MODEL; was ["a", "b"]): the model mirrors the server's exact business identity —
  // " b " is its own identity, never trimmed into "b"; exact duplicates still collapse; ":" is refused like the shared predicate.
  assert.deepEqual(normalizeAllowedBizIds(["a", "a", " b "]).ids, ["a", " b "]);
  assert.equal(normalizeAllowedBizIds(["b:1"]).ok, false);
});

// ─── I6 (T-I6-AUDIT-MODEL; production-readiness audit + user-access + M1 registry owners — independent I5 review I5-R-03) ───
// The audit's registry reading is the runtime's: exact identities (never trimmed), the approved business predicate, and the
// runtime classifier's verdict for every requested business (registered / not_registered / ambiguous / unreadable). Additive rows.
import { registryVerdict } from "../lib/biz-access-model.mjs";
import { classifyRegistryTarget } from "../../../lib/businessRegistry.js";
const scoped = (bizIds, grants, reg) => run({ appBusinessRaw: reg, members: { uV: true }, roles: { uV: "viewer" }, bizAccess: Object.fromEntries(grants.map((b) => [b, { uV: true }])),
  appUsersRaw: users([{ firebaseUid: "uV", role: "viewer", allowedBizIds: bizIds }]) });

test("I6-A1 registry ids are exact: a sole padded record is registered under its exact id, never as the trimmed id", () => {
  const reg = biz([{ id: " bizB ", name: "Padded" }]);
  assert.deepEqual([...parseAppBusiness(reg).businesses], [" bizB "]);
  for (const id of [" bizB ", "bizB"]) assert.equal(registryVerdict(parseAppBusiness(reg), id), classifyRegistryTarget(reg, id).state, id);
  const r = scoped([" bizB "], [" bizB "], reg);
  assert.deepEqual([r.categories.READY, r.categories.UNKNOWN_BUSINESS, r.categories.AMBIGUOUS_MAPPING], [1, 0, 0], "exact padded scope + grant → READY");
  const plain = scoped(["bizB"], [], reg);
  assert.equal(plain.categories.READY + plain.categories.NEEDS_BACKFILL, 0, "the plain id is not the padded business");
  assert.equal(plain.proposedGrants.length, 0, "no grant proposed for an id the runtime refuses");
});

test("I6-A2 plain / padded twin (both orders): ambiguous like the runtime classifier — never READY, never a proposed grant", () => {
  for (const reg of [biz([{ id: "bizB" }, { id: " bizB " }]), biz([{ id: " bizB " }, { id: "bizB" }])]) {
    const pb = parseAppBusiness(reg);
    assert.deepEqual([...pb.collisions].sort(), [" bizB ", "bizB"], "both twins listed as colliding");
    for (const id of [" bizB ", "bizB"]) { assert.equal(classifyRegistryTarget(reg, id).state, "ambiguous"); assert.equal(registryVerdict(pb, id), "ambiguous", id); }
    for (const id of [" bizB ", "bizB"]) {
      const r = scoped([id], [id], reg);
      assert.equal(r.categories.READY, 0, id); assert.equal(r.categories.NEEDS_BACKFILL, 0, id); assert.equal(r.proposedGrants.length, 0, id);
      assert.ok(r.findings.some((f) => f.category === "AMBIGUOUS_MAPPING" && /ambiguous/.test(f.note || "")), id + ": reported as ambiguous");
      const missing = scoped([id], [], reg); assert.equal(missing.proposedGrants.length, 0, id + ": no backfill over an ambiguous identity");
    }
  }
});

test("I6-A3 unknown, unreadable, colon and duplicate registries agree with the runtime and never produce READY or a grant", () => {
  const cases = [
    [biz([{ id: "bizA" }]), "bizB", "not_registered"],
    [{ _v: "{bad" }, "bizA", "unreadable"],
    [{ _v: JSON.stringify({ id: "bizA" }) }, "bizA", "unreadable"],
    [biz([{ id: "biz:B" }]), "biz:B", "invalid_request"],
    [biz([{ id: "bizA" }, { id: "bizA" }]), "bizA", "ambiguous"],
    [biz([{ id: "bizA" }, "bizA"]), "bizA", "ambiguous"],
    [biz([{ id: "bizA" }, { id: null }]), "bizA", "registered"],
  ];
  for (const [reg, id, state] of cases) {
    assert.equal(classifyRegistryTarget(reg, id).state, state, JSON.stringify([reg, id]));
    assert.equal(registryVerdict(parseAppBusiness(reg), id), state, "model ≡ runtime: " + JSON.stringify([reg, id]));
  }
  assert.equal(parseAppBusiness(biz([{ id: "biz:B" }])).businesses.size, 0, "a colon id is not a business");
  for (const [reg, id, state] of cases) {
    if (state === "registered" || state === "invalid_request") continue;
    const r = scoped([id], [id], reg);
    assert.equal(r.categories.READY, 0, JSON.stringify([reg, id])); assert.equal(r.proposedGrants.length, 0, JSON.stringify([reg, id]));
  }
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


// ============================================================================
// PR-003 (final): invalid --out validation must never disclose the raw/resolved
// filesystem path (home dir, username, canonical repo path). Uses synthetic paths.
// ============================================================================
const SYNTH_OUT = "/synthetic-marker-root-9x7/evil-out.json";

test("PR-003: assertLocalOutPath rejects an out-of-tree path with a generic, path-free error", () => {
  let threw = null;
  try { assertLocalOutPath(SYNTH_OUT); } catch (e) { threw = e; }
  assert.ok(threw, "invalid --out must be rejected");
  assert.equal(threw.code, "INVALID_OUTPUT_PATH");
  assert.match(threw.message, /allowed local output directory/);
  assert.doesNotMatch(threw.message, /synthetic-marker-root-9x7/); // raw supplied path absent
  assert.doesNotMatch(threw.message, /\//);                        // no path fragment at all
});

test("PR-003: assertLocalOutPath still accepts a valid path in the allowed output area", () => {
  const ok = assertLocalOutPath("/tmp/synthetic-dry-run.json");
  assert.equal(ok, "/tmp/synthetic-dry-run.json"); // validation not weakened
});

test("PR-003: CLI invalid --out reports failure with no supplied/resolved path leak, no output file, no network", () => {
  const repoRoot = fileURLToPath(new URL("../../../", import.meta.url)).replace(/\/$/, "");
  const r = spawnSync(process.execPath,
    ["docs/production-readiness/biz-access-audit.mjs", "--tenant", "synthetic-tenant", "--out", SYNTH_OUT],
    { cwd: repoRoot, encoding: "utf8", timeout: 20000,
      env: { ...process.env, GOOGLE_APPLICATION_CREDENTIALS: "/tmp/synthetic-sa-does-not-exist.json" } });
  const out = (r.stdout || "") + (r.stderr || "");
  assert.notEqual(r.status, 0, "invalid --out must exit non-zero");
  assert.match(out, /INVALID_OUTPUT_PATH/);              // stable safe marker present
  assert.doesNotMatch(out, /synthetic-marker-root-9x7/); // raw supplied path absent
  assert.doesNotMatch(out, /\/Users\//);               // no home-directory fragment
  assert.ok(!out.includes(repoRoot), "resolved repository path must be absent");
  assert.ok(!existsSync(SYNTH_OUT), "no output file may be created");
});

// ─── I7 (T-I7-AUDIT-PARITY; production-readiness audit + user-access + M1 registry owners — independent I6 review I6-R-01) ───
// The audit classifies the ORIGINAL raw app/business node exactly as the runtime does (lib/businessRegistry.js classifyRegistryTarget):
// the runtime reads only `{ _v: "<JSON array>" }`; a bare array, a bare JSON string or an absent node is `unreadable` there, so the
// audit may still LIST them for diagnostics but must never call a business registered, READY, or propose a grant from them.
import { decodeRegistryNode } from "../../../lib/businessRegistry.js";
const scopedOne = (id, reg, grants = []) => run({ appBusinessRaw: reg, members: { uV: true }, roles: { uV: "viewer" }, bizAccess: Object.fromEntries(grants.map((b) => [b, { uV: true }])),
  appUsersRaw: users([{ firebaseUid: "uV", role: "viewer", allowedBizIds: [id] }]) });

test("I7-A1 canonical envelope vs bare array / bare JSON string / absent node: runtime ≡ model; only the canonical node yields a proposed grant", () => {
  const records = [{ id: "bizA" }];
  const rows = [["canonical", biz(records), "registered", 1], ["bare array", records, "unreadable", 0], ["bare JSON string", JSON.stringify(records), "unreadable", 0], ["absent", null, "unreadable", 0], ["undefined", undefined, "unreadable", 0]];
  for (const [label, raw, state, grants] of rows) {
    assert.equal(classifyRegistryTarget(raw, "bizA").state, state, label + ": runtime");
    assert.equal(registryVerdict(parseAppBusiness(raw), "bizA"), state, label + ": model ≡ runtime");
    const r = scopedOne("bizA", raw);
    assert.equal(r.proposedGrants.length, grants, label + ": proposed grants");
    assert.equal(r.categories.NEEDS_BACKFILL, grants, label + ": NEEDS_BACKFILL");
    assert.equal(r.categories.READY, 0, label);
    const withGrant = scopedOne("bizA", raw, ["bizA"]);
    assert.equal(withGrant.categories.READY, grants, label + ": an existing grant is READY only over a runtime-readable registry");
    if (state === "unreadable") {
      assert.ok(r.findings.some((f) => f.subject === "app/business" && f.malformed === true && /not the runtime \{ _v \} node/.test(f.note)), label + ": reported");
      assert.equal(r.malformed, true, label + ": the tenant is malformed for the runtime");
      assert.ok(r.findings.some((f) => f.category === "UNKNOWN_BUSINESS" && /unreadable by the runtime/.test(f.note)), label + ": the business is unknown, not missing a grant");
      assert.ok(withGrant.findings.some((f) => f.category === "UNKNOWN_BUSINESS" && f.businessRef), label + ": an existing grant over an unreadable registry is flagged");
    }
  }
  // diagnostics are kept: the tolerated shapes are still parsed and listed
  assert.deepEqual([...parseAppBusiness(records).businesses], ["bizA"]);
  assert.equal(parseAppBusiness(records).runtimeReadable, false); assert.equal(parseAppBusiness(biz(records)).runtimeReadable, true);
});

test("I7-A2 exhaustive parity: for every registry shape × requested id the model's verdict IS the runtime's, and a grant is proposed exactly when the runtime would register the id", () => {
  const shapes = [
    biz([{ id: "bizA" }, { id: "bizB" }]), biz([]), biz([{ id: "bizA" }, { id: "bizA" }]), biz([{ id: "bizA" }, { id: " bizA " }]), biz([{ id: " bizA " }, { id: "bizA" }]),
    biz([{ id: "bizA" }, "bizA"]), biz([{ id: "bizA" }, 7]), biz([{ id: "7" }, 7]), biz([{ id: "bizA" }, null]), biz([{ id: "null" }, null]), biz([{ id: "null" }, { id: null }]),
    biz([{ id: "bizA" }, { name: "no id" }, { id: "bad.id" }, [1, 2]]), biz([{ id: " bizA " }]), biz([{ id: "ביז" }, { id: "biz\u0080" }]), biz([{ id: "biz:A" }]),
    { _v: "{bad" }, { _v: JSON.stringify({ id: "bizA" }) }, { _v: 5 }, { v: JSON.stringify([{ id: "bizA" }]) }, [{ id: "bizA" }], JSON.stringify([{ id: "bizA" }]), "not json",
    null, undefined, 0, true, [],
  ];
  const ids = ["bizA", " bizA ", "bizA ", "bizB", "7", "null", "ביז", "biz\u0080", "bizC", "biz:A", "", "bad.id"];
  let checked = 0, proposed = 0;
  for (const raw of shapes) {
    const parsed = parseAppBusiness(raw);
    assert.equal(parsed.runtimeReadable, decodeRegistryNode(raw).ok, "runtime readability: " + JSON.stringify(raw));
    for (const id of ids) {
      const runtime = classifyRegistryTarget(raw, id).state;
      assert.equal(registryVerdict(parsed, id), runtime, "model ≡ runtime: " + JSON.stringify([raw, id]));
      if (!isRegistryBizIdForTest(id)) continue;                       // the scope list refuses it before any registry question
      const r = scopedOne(id, raw);
      const want = runtime === "registered" ? 1 : 0;
      assert.equal(r.proposedGrants.length, want, "proposed grant ⇔ runtime registered: " + JSON.stringify([raw, id, runtime]));
      assert.equal(scopedOne(id, raw, [id]).categories.READY, want, "READY ⇔ runtime registered: " + JSON.stringify([raw, id, runtime]));
      checked++; proposed += want;
    }
  }
  assert.ok(checked > 200 && proposed > 5 && proposed < checked, "non-vacuous: " + checked + " checked, " + proposed + " proposed");
});
const isRegistryBizIdForTest = (id) => normalizeAllowedBizIds([id]).ok && normalizeAllowedBizIds([id]).ids.length === 1;

test("I7-A3 authorization parity: implicit-scope roles, non-members and invalid roles never receive a proposed grant, whatever the registry", () => {
  for (const raw of [biz([{ id: "bizA" }]), [{ id: "bizA" }], null]) {
    for (const [role, member] of [["owner", true], ["super_owner", true], ["manager", false], ["admin", true], [undefined, true]]) {
      const r = run({ appBusinessRaw: raw, members: member ? { u: true } : {}, roles: role === undefined ? {} : { u: role }, bizAccess: {},
        appUsersRaw: users([{ firebaseUid: "u", role: role ?? "viewer", allowedBizIds: ["bizA"] }]) });
      assert.equal(r.proposedGrants.length, 0, JSON.stringify([raw, role, member]));
    }
  }
});
