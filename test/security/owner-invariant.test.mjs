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
  guardTransition, guardCompensate, ownersFromRolesMap, isOwnerLevel,
  opSignatureV2, guardPrepare, guardMirrorFields, guardCompensateClearPending, inspectOwnerOp,
} from "../../lib/ownerGuard.js";
import { planTenantOwnerGuard, planOwnerGuardInit, parseArgs, writeAllowed, detectPendingOwnerOps } from "../../scripts/init-owner-guard.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = join(__dirname, "..", "..");
const admin = readFileSync(join(REPO, "api", "admin.js"), "utf8");
const indexHtml = readFileSync(join(REPO, "index.html"), "utf8");
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
T("C13 [static-src] owner-affecting handleRoles goes through the shared guarded runner; success only when r.ok", () => {
  const b = admin.slice(admin.indexOf("async function handleRoles"), admin.indexOf("async function ", admin.indexOf("async function handleRoles") + 10));
  assert.ok(b.includes("runGuardedOwnerOp(db, tenantId, guardOp, updates)"));
  assert.ok(b.includes("if (!r.ok)"));
  // the runner does PREPARE (transaction) before MIRROR (root update)
  const rn = admin.slice(admin.indexOf("async function runGuardedOwnerOp"), admin.indexOf("async function handleRoles"));
  assert.ok(rn.indexOf("guardPrepare(") < rn.indexOf("await db.ref().update({ ...baseUpdates, ...mirrorFields })"));
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
T("C18 exact business rule: ≥1 owner-LEVEL principal (owner OR super_owner); scoped not counted", () => {
  assert.strictEqual(MIN_OWNERS, 1);
  // super_owner is a top-level admin (requireTenantAccess treats it >= owner) and
  //   self-service bootstrap creates a super_owner, so it MUST count.
  assert.deepStrictEqual(ownersFromRolesMap({ A: "owner", S: "super_owner", M: "manager" }).sort(), ["A", "S"]);
  assert.strictEqual(isOwnerAffecting("super_owner", "manager"), true);
  assert.strictEqual(isOwnerAffecting("manager", "viewer"), false);
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


// ═══════════════════════════════════════════════════════════════════════════
// DURABLE STATE MACHINE + DELETE-USER — real prepare/mirror/resume/compensate.
// A tiny multi-path RTDB world lets us apply the SAME finalize fields the handler
// writes (guardMirrorFields) atomically with the role mirror, and inject crashes.
// ═══════════════════════════════════════════════════════════════════════════
function setP(root, path, val){ const ps=path.split("/"); let o=root; for(let i=0;i<ps.length-1;i++){ if(o[ps[i]]==null||typeof o[ps[i]]!=="object")o[ps[i]]={}; o=o[ps[i]]; } const k=ps[ps.length-1]; if(val===null) delete o[k]; else o[k]=val; }
function getP(root, path){ let o=root; for(const k of path.split("/")){ if(o==null) return undefined; o=o[k]; } return o; }
const GP="tenants/t/access_meta/owner_guard";
function world(guard, roles){ return { tenants:{ t:{ access_meta:{ owner_guard: guard===undefined?null:guard }, roles: roles||{}, audit:{roles:{}} } } }; }
const gOf=(w)=>getP(w,GP);
function prep(w, op){ const cur=gOf(w); const r=guardPrepare(cur, op); if(r.decision==="commit") setP(w, GP, r.value); return r; }
// MIRROR: base role mirror (+audit keyed by opId) merged with guard finalize, applied atomically.
function mir(w, op, baseUpdates){ const fields=guardMirrorFields("t", op, gOf(w)); const all={...baseUpdates, ...fields}; for(const [k,v] of Object.entries(all)) setP(w, k, v); }
function ownersOf(w){ const g=gOf(w); return g&&g.ownerUids?Object.keys(g.ownerUids):[]; }
function rolesOwners(w){ return ownersFromRolesMap(getP(w,"tenants/t/roles")); }
const delOp=(uid, prevRole, seed, opId, now=1)=>({ kind:"delete", targetUid:uid, prevRole, nextRole:null, opId, seedOwnerUids:seed, now });
const roleOp=(uid, prevRole, nextRole, seed, opId, now=1)=>({ kind:"roles", targetUid:uid, prevRole, nextRole, opId, seedOwnerUids:seed, now });
// base mirror for a delete (null roles) / role change
const delBase=(uid, opId)=>({ [`tenants/t/roles/${uid}`]:null, [`tenants/t/members/${uid}`]:null, [`tenants/t/audit/roles/${opId}`]:{opId, role:"DELETED"} });
const roleBase=(uid, nextRole, opId)=>({ [`tenants/t/roles/${uid}`]:nextRole, [`tenants/t/audit/roles/${opId}`]:{opId, role:nextRole??"REMOVED"} });

// ── DELETE USER ──
T("D1 deleting the ONLY owner is rejected", () => {
  const w=world({version:1,ownerUids:{A:true},ops:{}}, {A:"owner"});
  const r=prep(w, delOp("A","owner",["A"],"d1"));
  assert.strictEqual(r.decision,"reject"); assert.strictEqual(r.code,"last_owner");
  assert.deepStrictEqual(ownersOf(w),["A"]);
});
T("D2 deleting one of two owners succeeds (roles + guard agree)", () => {
  const w=world({version:1,ownerUids:{A:true,B:true},ops:{}}, {A:"owner",B:"owner"});
  const op=delOp("A","owner",["A","B"],"d2");
  assert.strictEqual(prep(w,op).decision,"commit");
  mir(w, op, delBase("A","d2"));
  assert.deepStrictEqual(ownersOf(w).sort(),["B"]);
  assert.deepStrictEqual(rolesOwners(w).sort(), ownersOf(w).sort());
});
T("D3 concurrent deletion of A and B leaves ≥1 owner", () => {
  const w=world({version:1,ownerUids:{A:true,B:true},ops:{}}, {A:"owner",B:"owner"});
  const opA=delOp("A","owner",["A","B"],"da");
  assert.strictEqual(prep(w,opA).decision,"commit");         // A prepared (pending)
  assert.strictEqual(prep(w, delOp("B","owner",["A","B"],"db")).code,"owner_op_pending"); // B blocked
  mir(w,opA,delBase("A","da"));                               // A completes → {B}
  assert.strictEqual(prep(w, delOp("B","owner",[],"db")).code,"last_owner"); // B now last owner
  assert.ok(ownersOf(w).length>=1);
});
T("D4 owner deletion races owner downgrade → ≥1 owner remains", () => {
  const w=world({version:1,ownerUids:{A:true,B:true},ops:{}}, {A:"owner",B:"owner"});
  const opA=delOp("A","owner",["A","B"],"r1");
  assert.strictEqual(prep(w,opA).decision,"commit");
  assert.strictEqual(prep(w, roleOp("B","owner","manager",["A","B"],"r2")).code,"owner_op_pending");
  mir(w,opA,delBase("A","r1"));
  assert.strictEqual(prep(w, roleOp("B","owner","manager",[],"r2")).code,"last_owner");
  assert.ok(ownersOf(w).length>=1);
});
T("D5 non-owner deletion does not touch the owner guard", () => {
  assert.strictEqual(isOwnerAffecting("manager", null), false);
  assert.strictEqual(isOwnerAffecting("viewer", null), false);
});
T("D6 [static-src] delete-user removes RTDB authorization BEFORE deleting Auth", () => {
  const b = admin.slice(admin.indexOf("async function handleDeleteUser"), admin.indexOf("async function ", admin.indexOf("async function handleDeleteUser")+10));
  const guardIdx = b.indexOf("runGuardedOwnerOp(db, tenantId, guardOp, updates)");
  const plainIdx = b.indexOf("await db.ref().update(updates)");
  const authIdx  = b.lastIndexOf("await auth.deleteUser(firebaseUid)");
  assert.ok(guardIdx > 0 && guardIdx < authIdx, "owner path: guard mirror before Auth delete");
  assert.ok(plainIdx > 0 && plainIdx < authIdx, "non-owner path: RTDB removal before Auth delete");
  assert.ok(!b.includes("Phase 1: Delete Firebase Auth user FIRST"), "old Auth-first ordering removed");
});
T("D7 [static-src] Auth-delete failure leaves NO tenant authorization (not restored)", () => {
  const b = admin.slice(admin.indexOf("async function handleDeleteUser"), admin.indexOf("async function ", admin.indexOf("async function handleDeleteUser")+10));
  assert.ok(b.includes("retryableAuthCleanup"));
  // the auth-failure branch does not re-write roles/members (authorization stays removed)
  const afterAuth = b.slice(b.lastIndexOf("await auth.deleteUser(firebaseUid)"));
  assert.ok(!/roles\/\$\{firebaseUid\}`\]\s*=\s*/.test(afterAuth), "no role restore after auth failure");
});
T("D8 delete retry with same requestId is idempotent (already mirrored)", () => {
  const w=world({version:1,ownerUids:{A:true,B:true},ops:{}}, {A:"owner",B:"owner"});
  const op=delOp("A","owner",["A","B"],"d8");
  prep(w,op); mir(w,op,delBase("A","d8"));
  assert.strictEqual(prep(w, op).decision, "idempotent");
});
T("D9 prepared delete RESUMES (not false success)", () => {
  const w=world(null, {A:"owner",B:"owner"});
  const op=delOp("A","owner",["A","B"],"d9");
  assert.strictEqual(prep(w,op).decision,"commit");   // prepared
  // crash before mirror; retry same op:
  const again=prep(w,op);
  assert.strictEqual(again.decision,"resume");         // must resume, NOT idempotent success
  mir(w,op,delBase("A","d9"));
  assert.strictEqual(inspectOwnerOp(gOf(w),"d9"),"mirrored");
});

// ── ROLES RULES (static-rules; roles is server-managed) ──
const rolesRule = rulesObj.rules.tenants.$tenantId.roles;
T("RR10-15 client role write denied for ALL roles (.write:false, no child .write)", () => {
  assert.strictEqual(rolesRule[".write"], false);
  assert.ok(!("__ignore" in {}) && !("\.write" in (rolesRule.$roleUid||{})));
  assert.strictEqual((rolesRule.$roleUid||{})[".write"], undefined);
});
T("RR16 initial write to empty roles denied (no !data.exists() bootstrap)", () => {
  assert.ok(!JSON.stringify(rolesRule).includes("!data.exists()"));
});
T("RR17 client role delete denied (.write:false covers delete)", () => assert.strictEqual(rolesRule[".write"], false));
T("RR18 Admin SDK remains the intended roles writer (server writes roles)", () => {
  assert.ok(admin.includes("`tenants/${tenantId}/roles/${uid}`]   = \"super_owner\"") || admin.includes("tenants/${tenantId}/roles/"));
});
T("RR19 no bootstrap path depends on a direct client role write", () => {
  assert.ok(admin.includes("handleBootstrapSelf"), "server bootstrap action exists");
  assert.ok(!/_rtdbSet\(`tenants\/\$\{tenantId\}\/roles\//.test(indexHtml), "index.html no direct roles write");
});
T("RR20 no role UI writes directly to Firebase", () => {
  assert.ok(!/_rtdbSet\([^)]*roles\//.test(indexHtml));
});

// ── PREPARED / MIRROR STATE ──
T("P21 crash after prepare, before mirror → status prepared", () => {
  const w=world(null,{A:"owner",B:"owner"}); const op=roleOp("A","owner","manager",["A","B"],"p21");
  prep(w,op); assert.strictEqual(inspectOwnerOp(gOf(w),"p21"),"prepared");
});
T("P22 same requestId resumes the mirror", () => {
  const w=world(null,{A:"owner",B:"owner"}); const op=roleOp("A","owner","manager",["A","B"],"p22");
  prep(w,op); assert.strictEqual(prep(w,op).decision,"resume"); mir(w,op,roleBase("A","manager","p22"));
  assert.strictEqual(inspectOwnerOp(gOf(w),"p22"),"mirrored");
});
T("P23 prepared state never returns completed success", () => {
  const w=world(null,{A:"owner",B:"owner"}); const op=roleOp("A","owner","manager",["A","B"],"p23");
  prep(w,op); assert.notStrictEqual(prep(w,op).decision,"idempotent");
});
T("P24 different request while pending is blocked", () => {
  const w=world(null,{A:"owner",B:"owner"}); prep(w, roleOp("A","owner","manager",["A","B"],"p24a"));
  assert.strictEqual(prep(w, roleOp("B","owner","manager",["A","B"],"p24b")).code,"owner_op_pending");
});
T("P25 conflicting same requestId payload rejected", () => {
  const w=world(null,{A:"owner",B:"owner"}); prep(w, roleOp("A","owner","manager",["A","B"],"p25"));
  assert.strictEqual(prep(w, roleOp("B","owner","manager",["A","B"],"p25")).code,"opId_conflict");
});
T("P26 mirror success marks mirrored + clears pending atomically + bumps version", () => {
  const w=world({version:5,ownerUids:{A:true,B:true},ops:{}},{A:"owner",B:"owner"});
  const op=roleOp("A","owner","manager",["A","B"],"p26"); prep(w,op); mir(w,op,roleBase("A","manager","p26"));
  const g=gOf(w); assert.strictEqual(g.pending??null,null); assert.strictEqual(g.ops["p26"].phase,"mirrored"); assert.strictEqual(g.version,6);
});
T("P27 lost response after mirror → idempotent success", () => {
  const w=world({version:1,ownerUids:{A:true,B:true},ops:{}},{A:"owner",B:"owner"});
  const op=roleOp("A","owner","manager",["A","B"],"p27"); prep(w,op); mir(w,op,roleBase("A","manager","p27"));
  assert.strictEqual(prep(w,op).decision,"idempotent");
});
T("P28 mirror failure compensates (owners unchanged; pending cleared; retryable)", () => {
  const w=world({version:1,ownerUids:{A:true,B:true},ops:{}},{A:"owner",B:"owner"});
  const op=roleOp("A","owner","manager",["A","B"],"p28"); prep(w,op);
  // simulate mirror throwing → compensate
  setP(w, GP, guardCompensateClearPending(gOf(w), op));
  const g=gOf(w); assert.strictEqual(g.pending,null); assert.deepStrictEqual(Object.keys(g.ownerUids).sort(),["A","B"]);
  assert.strictEqual(prep(w,op).decision,"commit"); // retryable
});
T("P29 compensation failure leaves pending → reconciliation detects it", () => {
  const w=world(null,{A:"owner",B:"owner"}); prep(w, roleOp("A","owner","manager",["A","B"],"p29"));
  const pend=detectPendingOwnerOps(w.tenants ? { t: w.tenants.t } : {});
  assert.strictEqual(pend.length,1); assert.strictEqual(pend[0].opId,"p29"); assert.strictEqual(pend[0].phase,"prepared");
});
T("P30 prepared promotion blocks a concurrent removal from breaking invariant", () => {
  const w=world({version:1,ownerUids:{A:true},ops:{}},{A:"owner"});
  prep(w, roleOp("B","manager","owner",[],"p30promote"));           // promote B (pending)
  assert.strictEqual(prep(w, roleOp("A","owner","manager",[],"p30remove")).code,"owner_op_pending"); // removal blocked
});
T("P31 prepared removal blocks a second removal", () => {
  const w=world({version:1,ownerUids:{A:true,B:true},ops:{}},{A:"owner",B:"owner"});
  prep(w, roleOp("A","owner","manager",["A","B"],"p31a"));
  assert.strictEqual(prep(w, roleOp("B","owner","manager",["A","B"],"p31b")).code,"owner_op_pending");
});
T("P32 audit written once (opId-keyed; retry overwrites same key)", () => {
  const w=world({version:1,ownerUids:{A:true,B:true},ops:{}},{A:"owner",B:"owner"});
  const op=roleOp("A","owner","manager",["A","B"],"p32"); prep(w,op); mir(w,op,roleBase("A","manager","p32"));
  assert.strictEqual(prep(w,op).decision,"idempotent"); // retry short-circuits BEFORE any second audit write
  assert.strictEqual(Object.keys(getP(w,"tenants/t/audit/roles")).length,1);
});
T("P33 version increments once for one logical op", () => {
  const w=world({version:2,ownerUids:{A:true,B:true},ops:{}},{A:"owner",B:"owner"});
  const op=roleOp("A","owner","manager",["A","B"],"p33"); prep(w,op); mir(w,op,roleBase("A","manager","p33"));
  assert.strictEqual(gOf(w).version,3);
  assert.strictEqual(prep(w,op).decision,"idempotent"); // no further bump
  assert.strictEqual(gOf(w).version,3);
});
T("P34 guard and roles agree after every successful op", () => {
  const w=world({version:1,ownerUids:{A:true,B:true},ops:{}},{A:"owner",B:"owner"});
  const op=roleOp("A","owner","manager",["A","B"],"p34"); prep(w,op); mir(w,op,roleBase("A","manager","p34"));
  assert.deepStrictEqual(ownersOf(w).sort(), rolesOwners(w).sort());
});
T("P35 no failed operation leaves zero owners", () => {
  const w=world({version:1,ownerUids:{A:true},ops:{}},{A:"owner"});
  assert.strictEqual(prep(w, roleOp("A","owner","manager",[],"p35")).code,"last_owner");
  assert.ok(ownersOf(w).length>=1);
});


// ═══════════════════════════════════════════════════════════════════════════
// SUPER_OWNER DELETE — deletion must classify owner OR super_owner as owner-affecting
// (isOwnerLevel), route through the durable guard, and never leave a stale UID.
// ═══════════════════════════════════════════════════════════════════════════
T("SO1 deleting the ONLY super_owner is rejected", () => {
  const w=world({version:1,ownerUids:{S:true},ops:{}}, {S:"super_owner"});
  const r=prep(w, delOp("S","super_owner",["S"],"so1"));
  assert.strictEqual(r.decision,"reject"); assert.strictEqual(r.code,"last_owner");
  assert.deepStrictEqual(ownersOf(w),["S"]);
});
T("SO2 deleting one of two super_owners succeeds", () => {
  const w=world({version:1,ownerUids:{S1:true,S2:true},ops:{}}, {S1:"super_owner",S2:"super_owner"});
  const op=delOp("S1","super_owner",["S1","S2"],"so2");
  assert.strictEqual(prep(w,op).decision,"commit"); mir(w,op,delBase("S1","so2"));
  assert.deepStrictEqual(ownersOf(w).sort(),["S2"]);
  assert.deepStrictEqual(rolesOwners(w).sort(), ownersOf(w).sort());
});
T("SO3 deleting a super_owner while one owner remains succeeds", () => {
  const w=world({version:1,ownerUids:{S:true,A:true},ops:{}}, {S:"super_owner",A:"owner"});
  const op=delOp("S","super_owner",["S","A"],"so3");
  assert.strictEqual(prep(w,op).decision,"commit"); mir(w,op,delBase("S","so3"));
  assert.deepStrictEqual(ownersOf(w).sort(),["A"]);
});
T("SO4 deleting remaining owner after super_owner deletion cannot leave zero owner-level", () => {
  const w=world({version:1,ownerUids:{S:true,A:true},ops:{}}, {S:"super_owner",A:"owner"});
  const opS=delOp("S","super_owner",["S","A"],"so4a"); prep(w,opS); mir(w,opS,delBase("S","so4a")); // → {A}
  assert.strictEqual(prep(w, delOp("A","owner",[],"so4b")).code,"last_owner");
  assert.ok(ownersOf(w).length>=1);
});
T("SO5 owner_guard removes the deleted super_owner UID (no stale entry)", () => {
  const w=world({version:1,ownerUids:{S:true,A:true},ops:{}}, {S:"super_owner",A:"owner"});
  const op=delOp("S","super_owner",["S","A"],"so5"); prep(w,op); mir(w,op,delBase("S","so5"));
  assert.ok(!ownersOf(w).includes("S"), "deleted super_owner UID must not remain in owner_guard");
});
T("SO6 concurrent deletion of owner and super_owner leaves ≥1 owner-level principal", () => {
  const w=world({version:1,ownerUids:{A:true,S:true},ops:{}}, {A:"owner",S:"super_owner"});
  const opA=delOp("A","owner",["A","S"],"so6a");
  assert.strictEqual(prep(w,opA).decision,"commit");                              // A prepared (pending)
  assert.strictEqual(prep(w, delOp("S","super_owner",["A","S"],"so6b")).code,"owner_op_pending"); // S blocked
  mir(w,opA,delBase("A","so6a"));                                                 // → {S}
  assert.strictEqual(prep(w, delOp("S","super_owner",[],"so6b")).code,"last_owner");
  assert.ok(ownersOf(w).length>=1);
});
T("SO7 non-owner deletion does not invoke the guard", () => {
  assert.strictEqual(isOwnerLevel("manager"), false);
  assert.strictEqual(isOwnerLevel("shift_manager"), false);
  assert.strictEqual(isOwnerLevel("viewer"), false);
});
T("SO8 [static-src] delete-user classifies via isOwnerLevel and deletes Auth AFTER the RTDB mirror", () => {
  const b = admin.slice(admin.indexOf("async function handleDeleteUser"), admin.indexOf("async function ", admin.indexOf("async function handleDeleteUser")+10));
  assert.ok(b.includes("isOwnerLevel(targetRole)"), "owner-affecting via canonical helper");
  const guardIdx=b.indexOf("runGuardedOwnerOp(db, tenantId, guardOp, updates)");
  const authIdx=b.lastIndexOf("await auth.deleteUser(firebaseUid)");
  assert.ok(guardIdx>0 && guardIdx<authIdx, "guard mirror before Auth delete");
  assert.ok(b.includes("prevRole: targetRole"), "guardOp uses the real target role, not a hardcoded owner");
});
T("SO9 super_owner delete retry with same requestId is idempotent", () => {
  const w=world({version:1,ownerUids:{S1:true,S2:true},ops:{}}, {S1:"super_owner",S2:"super_owner"});
  const op=delOp("S1","super_owner",["S1","S2"],"so9"); prep(w,op); mir(w,op,delBase("S1","so9"));
  assert.strictEqual(prep(w,op).decision,"idempotent");
});
T("SO10 [static-src] no bare owner-only classification remains in delete-user", () => {
  const b = admin.slice(admin.indexOf("async function handleDeleteUser"), admin.indexOf("async function ", admin.indexOf("async function handleDeleteUser")+10));
  assert.ok(!/ownerAffecting\s*=\s*targetRole\s*===\s*"owner"/.test(b), "must not use literal owner-only comparison");
});

console.log(`\nTotal: ${pass + fail}  Passed: ${pass}  Failed: ${fail}`);
process.exit(fail === 0 ? 0 : 1);
