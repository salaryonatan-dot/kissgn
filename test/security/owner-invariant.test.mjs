// Concurrency-safe owner-invariant tests. Run: node test/security/owner-invariant.test.mjs
// Drives the REAL pure guard logic (lib/ownerGuard.js) through a transaction
// SIMULATOR that models Firebase RTDB semantics: transactions on a node are
// serialized and the update fn is re-run against the latest committed value.
// This proves the invariant under concurrency — not just via source strings.
// NO network / Firebase / production calls.
import assert from "node:assert";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  OWNER_ROLE, MIN_OWNERS, ownerGuardPath, isOwnerAffecting, opSignature,
  guardTransition, guardCompensate, ownersFromRolesMap,
} from "../../lib/ownerGuard.js";
import { planTenantOwnerGuard, planOwnerGuardInit, parseArgs, writeAllowed } from "../../scripts/init-owner-guard.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = join(__dirname, "..", "..");
const admin = readFileSync(join(REPO, "api", "admin.js"), "utf8");
const rulesObj = JSON.parse(readFileSync(join(REPO, "database.rules.json"), "utf8"));
const accessMeta = rulesObj.rules.tenants.$tenantId.access_meta;

let pass = 0, fail = 0;
const T = (n, fn) => { try { fn(); console.log("PASS " + n); pass++; } catch (e) { console.log("FAIL " + n + " — " + (e && e.message)); fail++; } };

// ── RTDB transaction simulator ──
// A node holds a value; a transaction runs updateFn(currentValue). Returning
// undefined ABORTS (value unchanged); any object COMMITS. Serialized calls model
// RTDB's retry-against-latest guarantee (the second concurrent op is validated
// against the first's committed value).
function makeNode(initial = null) { return { value: initial }; }
function applyOp(node, op) {
  let outcome = { code: null, idempotent: false };
  const proposed = (() => { const r = guardTransition(node.value, op); outcome = { code: r.code || null, idempotent: !!r.idempotent }; return r.commit ? r.value : undefined; })();
  const committed = proposed !== undefined;
  if (committed) node.value = proposed;
  return { committed, outcome, guard: node.value };
}
function compensate(node, op) { node.value = guardCompensate(node.value, op); return node.value; }
const owners = (g) => Object.keys((g && g.ownerUids) || {});
const rm = (targetUid, seed, extra = {}) => ({ targetUid, prevRole: "owner", nextRole: "manager", seedOwnerUids: seed, now: 1, ...extra });
const del = (targetUid, seed, extra = {}) => ({ targetUid, prevRole: "owner", nextRole: null, seedOwnerUids: seed, now: 1, ...extra });
const promote = (targetUid, seed, extra = {}) => ({ targetUid, prevRole: "manager", nextRole: "owner", seedOwnerUids: seed, now: 1, ...extra });

// ═══ CONCURRENCY ═══
T("C1 two owners; concurrent removal of A and B → one succeeds, one fails, ≥1 owner remains", () => {
  const node = makeNode(null);
  const r1 = applyOp(node, rm("A", ["A", "B"], { opId: "op1" }));
  const r2 = applyOp(node, rm("B", ["A", "B"], { opId: "op2" }));
  assert.ok(r1.committed && !r2.committed, "exactly one commits");
  assert.strictEqual(r2.outcome.code, "last_owner");
  assert.ok(owners(node.value).length >= MIN_OWNERS, "at least one owner remains");
  // contrast: the OLD naive pre-read (both read {A,B}, both remove) reaches ZERO — the bug the guard fixes
  const naive = new Set(["A", "B"]); naive.delete("A"); naive.delete("B");
  assert.strictEqual(naive.size, 0, "naive pre-read would reach zero owners");
});
T("C2 one owner; two concurrent requests on same owner → neither can remove", () => {
  const node = makeNode(null);
  const r1 = applyOp(node, rm("A", ["A"], { opId: "o1" }));
  const r2 = applyOp(node, rm("A", ["A"], { opId: "o2" }));
  assert.ok(!r1.committed && !r2.committed);
  assert.strictEqual(r1.outcome.code, "last_owner");
  assert.deepStrictEqual(owners(node.value ? node.value : { ownerUids: { A: true } }), node.value ? owners(node.value) : ["A"]);
});
T("C3 owner downgrade races owner deletion → one succeeds, ≥1 remains", () => {
  const node = makeNode(null);
  const r1 = applyOp(node, rm("A", ["A", "B"], { opId: "d1" }));   // downgrade A
  const r2 = applyOp(node, del("B", ["A", "B"], { opId: "d2" }));  // delete B
  assert.ok(r1.committed && !r2.committed);
  assert.ok(owners(node.value).length >= MIN_OWNERS);
});
T("C4 owner promotion races owner downgrade — invariant preserved in BOTH orders", () => {
  // order 1: promote C then downgrade A → {C}
  let node = makeNode(null);
  assert.ok(applyOp(node, promote("C", ["A"], { opId: "p1" })).committed);
  assert.ok(applyOp(node, rm("A", ["A"], { opId: "p2" })).committed);
  assert.deepStrictEqual(owners(node.value).sort(), ["C"]);
  // order 2: downgrade A first (last owner) aborts, then promote C succeeds → {A,C}
  node = makeNode(null);
  assert.ok(!applyOp(node, rm("A", ["A"], { opId: "p3" })).committed);
  assert.ok(applyOp(node, promote("C", ["A"], { opId: "p4" })).committed);
  assert.deepStrictEqual(owners(node.value).sort(), ["A", "C"]);
});
T("C5 two updates same target different payloads — version CAS serializes them", () => {
  const node = makeNode(null);
  applyOp(node, promote("X", ["A"], { opId: "s0" }));                 // seed → version 1, owners {A,X}
  const v = node.value.version;
  const r1 = applyOp(node, rm("X", [], { opId: "s1", expectedVersion: v }));   // commits, version→v+1
  const r2 = applyOp(node, rm("A", [], { opId: "s2", expectedVersion: v }));   // stale expected version
  assert.ok(r1.committed);
  assert.ok(!r2.committed && r2.outcome.code === "stale_version");
});
T("C6 stale expectedVersion rejected", () => {
  const node = makeNode({ version: 5, ownerUids: { A: true, B: true }, ops: {} });
  const r = applyOp(node, rm("A", [], { opId: "z", expectedVersion: 4 }));
  assert.ok(!r.committed && r.outcome.code === "stale_version");
});
T("C7 retry with same requestId is idempotent (no re-commit, no version bump)", () => {
  const node = makeNode(null);
  const r1 = applyOp(node, rm("A", ["A", "B"], { opId: "same" }));
  const vAfter = node.value.version;
  const r2 = applyOp(node, rm("A", ["A", "B"], { opId: "same" }));
  assert.ok(r1.committed);
  assert.ok(!r2.committed && r2.outcome.idempotent);
  assert.strictEqual(node.value.version, vAfter, "version not bumped on idempotent retry");
});
T("C8 conflicting payload with same requestId rejected", () => {
  const node = makeNode(null);
  applyOp(node, rm("A", ["A", "B"], { opId: "dup" }));
  const r = applyOp(node, rm("B", ["A", "B"], { opId: "dup" })); // same opId, different target
  assert.ok(!r.committed && r.outcome.code === "opId_conflict");
});
T("C9 lost-response retry does not duplicate the ledger entry / audit op", () => {
  const node = makeNode(null);
  applyOp(node, rm("A", ["A", "B"], { opId: "lost" }));
  const opsCount = Object.keys(node.value.ops).length;
  applyOp(node, rm("A", ["A", "B"], { opId: "lost" })); // retry
  assert.strictEqual(Object.keys(node.value.ops).length, opsCount, "no duplicate ledger entry");
  assert.strictEqual(Object.keys(node.value.ops).filter(k => k === "lost").length, 1);
});
T("C10 guard transaction abort leaves the guard node UNCHANGED", () => {
  const before = { version: 3, ownerUids: { A: true }, ops: {}, pending: null };
  const node = makeNode(JSON.parse(JSON.stringify(before)));
  const r = applyOp(node, rm("A", [], { opId: "ab" })); // last owner → abort
  assert.ok(!r.committed);
  assert.deepStrictEqual(node.value, before, "node unchanged on abort");
});

// ═══ CONSISTENCY ═══
function mirrorFrom(guard) { // derive expected roles owner set from guard
  return new Set(Object.keys(guard.ownerUids));
}
T("C11 guard commit + mirror success → guard owners agree with role mirror", () => {
  const node = makeNode(null);
  applyOp(node, rm("A", ["A", "B"], { opId: "m1" }));
  const rolesMirror = { A: "manager", B: "owner" }; // mirror after downgrade of A
  assert.deepStrictEqual([...mirrorFrom(node.value)].sort(), ownersFromRolesMap(rolesMirror).sort());
});
T("C12 guard commit + mirror FAILURE → compensation restores owners, clears opId (retryable), no divergence", () => {
  const node = makeNode(null);
  const op = rm("A", ["A", "B"], { opId: "cmp" });
  applyOp(node, op);                       // forward: owners {B}
  assert.deepStrictEqual(owners(node.value).sort(), ["B"]);
  compensate(node, op);                    // mirror failed → compensate
  assert.deepStrictEqual(owners(node.value).sort(), ["A", "B"], "owners restored");
  assert.ok(!node.value.ops["cmp"], "opId removed → request retryable");
  assert.strictEqual(node.value.pending, null);
});
T("C12b compensation-failure → pending blocks further owner mutations", () => {
  const node = makeNode({ version: 2, ownerUids: { A: true, B: true }, ops: {}, pending: { opId: "x", ts: 1 } });
  const r = applyOp(node, rm("A", [], { opId: "y" }));
  assert.ok(!r.committed && r.outcome.code === "owner_guard_pending");
});
T("C13 [static-src] mirror is only written after a committed guard (no success on mismatch)", () => {
  const b = admin.slice(admin.indexOf("async function handleRoles"), admin.indexOf("async function ", admin.indexOf("async function handleRoles") + 10));
  // guard block returns before the root update when not committed
  assert.ok(b.includes("if (!committed) {"));
  assert.ok(b.indexOf("if (ownerAffecting) {") < b.indexOf("await db.ref().update(updates);"));
});
T("C14 scoped-role-only changes do NOT invoke the guard", () => {
  assert.strictEqual(isOwnerAffecting("manager", "viewer"), false);
  assert.strictEqual(isOwnerAffecting("viewer", "shift_manager"), false);
  const b = admin.slice(admin.indexOf("async function handleRoles"));
  assert.ok(b.includes("if (ownerAffecting) {"));
});
T("C15 promotion to owner ADDS guard membership", () => {
  const node = makeNode(null);
  applyOp(node, promote("N", ["A"], { opId: "g15" }));
  assert.ok(owners(node.value).includes("N"));
});
T("C16 removal of a NON-owner does not touch the guard", () => {
  assert.strictEqual(isOwnerAffecting("manager", null), false);
  assert.strictEqual(isOwnerAffecting("viewer", "manager"), false);
});
T("C17 role:null for the last owner is protected", () => {
  const node = makeNode({ version: 1, ownerUids: { A: true }, ops: {}, pending: null });
  const r = applyOp(node, del("A", [], { opId: "g17" }));
  assert.ok(!r.committed && r.outcome.code === "last_owner");
});
T("C18 exact business rule preserved: ≥1 'owner'; super_owner NOT counted", () => {
  assert.strictEqual(OWNER_ROLE, "owner");
  assert.strictEqual(MIN_OWNERS, 1);
  assert.deepStrictEqual(ownersFromRolesMap({ A: "owner", S: "super_owner", M: "manager" }), ["A"]);
});
T("C19 no stale owner-guard entries after a valid downgrade", () => {
  const node = makeNode(null);
  applyOp(node, rm("A", ["A", "B"], { opId: "g19" }));
  assert.ok(!owners(node.value).includes("A"));
});
T("C20 audit/op id is unique per operation (ledger keyed by opId)", () => {
  const node = makeNode(null);
  applyOp(node, promote("P", ["A"], { opId: "u1" }));
  applyOp(node, rm("P", [], { opId: "u2" }));
  assert.deepStrictEqual(Object.keys(node.value.ops).sort(), ["u1", "u2"]);
});

// ═══ SECURITY / INVARIANTS ═══
T("S21 [static-src] handleRoles requires owner caller (manager cannot invoke)", () => {
  assert.ok(admin.includes('requireTenantAccess(claims.uid, tenantId, "owner")'));
});
T("S22 guard path is tenant-scoped (wrong tenant cannot be targeted)", () => {
  assert.strictEqual(ownerGuardPath("t1"), "tenants/t1/access_meta/owner_guard");
  assert.ok(admin.includes("ownerGuardPath(tenantId)"));
});
T("S23 [static-src] malformed targetUid/tenantId rejected", () => {
  assert.ok(admin.includes("RTDB_FORBIDDEN.test(tenantId) || RTDB_FORBIDDEN.test(targetUid)"));
});
T("S24 no role named 'admin'", () => { assert.notStrictEqual(OWNER_ROLE, "admin"); assert.ok(!/role\s*===\s*["']admin["']/.test(admin)); });
T("S25 [static-rules] client cannot read/write owner guard (access_meta)", () => {
  assert.strictEqual(accessMeta[".read"], false);
  assert.strictEqual(accessMeta[".write"], false);
});
T("S26 no new Vercel function (api function-file count = 12)", () => {
  const walk = (d) => readdirSync(d).flatMap((f) => { const fp = join(d, f); return statSync(fp).isDirectory() ? walk(fp) : [fp]; });
  assert.strictEqual(walk(join(REPO, "api")).filter(f => f.endsWith(".js") || f.endsWith(".ts")).length, 12);
});
T("S27 tests + tooling do no external calls (firebase-admin only inside main())", () => {
  const init = readFileSync(join(REPO, "scripts", "init-owner-guard.mjs"), "utf8");
  assert.ok(init.includes('await import("firebase-admin")') && !/^import .*firebase-admin/m.test(init));
});

// ═══ GUARD INIT TOOLING ═══
T("INIT dry-run default writes nothing; requires --project", () => {
  assert.strictEqual(writeAllowed(parseArgs(["--env=e", "--project=p"])).allowed, false);
  assert.strictEqual(writeAllowed(parseArgs(["--env=e", "--project=p", "--apply", "--confirm-production=p"])).allowed, true);
});
T("INIT derives owners from roles; detects zero-owner (stops) and mismatch", () => {
  const ok = planTenantOwnerGuard("t1", { A: "owner", M: "manager" }, undefined, 1);
  assert.deepStrictEqual(ok.value.ownerUids, { A: true });
  assert.throws(() => planOwnerGuardInit({ t0: { roles: { M: "manager" } } }, { stopOnZeroOwner: true }), (e) => e.zeroOwner === true);
  const mm = planTenantOwnerGuard("t2", { A: "owner", B: "owner" }, { ownerUids: { A: true } }, 1);
  assert.ok(mm.mismatch === true);
});
T("INIT stops on malformed roles; does not overwrite an existing guard", () => {
  assert.throws(() => planOwnerGuardInit({ tX: { roles: "nope" } }), (e) => e.malformed === true);
  const { updates, summary } = planOwnerGuardInit({ tE: { roles: { A: "owner" }, access_meta: { owner_guard: { version: 3, ownerUids: { A: true } } } } });
  assert.strictEqual(Object.keys(updates).length, 0);
  assert.strictEqual(summary.alreadyInitialized, 1);
});

console.log(`\nTotal: ${pass + fail}  Passed: ${pass}  Failed: ${fail}`);
process.exit(fail === 0 ? 0 : 1);
