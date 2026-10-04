// Marjin — F1 R1 cost-history writer + authorization review over the REAL local RTDB emulator.
//
// The ACTUAL lib/finance/costHistoryWriter.js (with the real lib/securityContext.js + lib/helpers.js) runs
// over the real Admin transport; only the token verifier and the Admin-app constructor are replaced. Readers
// are real CLIENT principals evaluated by the real Rules, decoding with the committed fincore codec.
//   FWE-1 ordinary save ⇒ cleared; a client reads an authoritative history
//   FWE-2 in-window revocation ⇒ durable flagged state; client decode withholds it
//   FWE-3 revocation + audit AND review write failures ⇒ pending stays (never authoritative)
//   FWE-4 post-commit check unavailable ⇒ pending; a later version refused; reconciliation clears; next save works
//   FWE-5 parallel saves from the same head ⇒ exactly one version; its review resolves
//   FWE-6 parallel reconciliations ⇒ one transition, all others idempotent
//   FWE-7 lost acknowledgement of the review transition ⇒ resolved by full-payload readback
//   FWE-8 a client cannot forge, clear or overwrite review state (Rules), even its own business owner
//   FWE-9  (R4) business removed from the registry between the entry check and the commit ⇒ denied, nothing stored
//   FWE-10 (R4) the activating owner is downgraded to manager during the commit ⇒ FLAGGED (+ audit), never cleared
//   FWE-11 (R4) owner acceptance ⇒ stored cleared + decision audit accepted (authoritative); a numeric operation id is refused
//   FWE-12 (R4) an unregistered business cannot be read, edited, decided or reconciled through the real transport
//
// Deliberately NOT named *.test.mjs. Run with the own-pid emulator runner (see test/emulator/README.md).
import admin from "firebase-admin";
import { readFileSync, mkdtempSync, writeFileSync, cpSync, mkdirSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
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

const dir = mkdtempSync(join(tmpdir(), "f1w-emu-"));
cpSync(join(ROOT, "lib"), join(dir, "lib"), { recursive: true });
mkdirSync(join(dir, "fincore"), { recursive: true });
cpSync(join(ROOT, "fincore", "v1"), join(dir, "fincore", "v1"), { recursive: true });
try { symlinkSync(join(ROOT, "node_modules"), join(dir, "node_modules"), "dir"); } catch (_) {}
writeFileSync(join(dir, "lib", "adminSdk.js"), `export function getAdminDb() { return globalThis.__DB(); }\nexport function getAdminAuth() { return {}; }\n`);
writeFileSync(join(dir, "lib", "verifyToken.js"), `export async function requireAuth() { if (!globalThis.__CLAIMS) throw new Error("no auth"); return globalThis.__CLAIMS; }\nexport async function verifyToken() { return globalThis.__CLAIMS; }\n`);
const W = await import(pathToFileURL(join(dir, "lib", "finance", "costHistoryWriter.js")).href);
const { costHistoryCodec } = await import(pathToFileURL(join(ROOT, "fincore", "v1", "finance", "costHistory.js")).href);

const T = "tenantA", B = "bizA", NODE = `tenants/${T}/biz:${B}:cost_history`;
const A = "00000000-0000-4000-8000-0000000000a1", Bv = "00000000-0000-4000-8000-0000000000b2", Cv = "00000000-0000-4000-8000-0000000000c3";
const fixtures = () => ({ tenants: { [T]: {
  members: { u_mgr: true, u_owner: true, u_mgr2: true }, roles: { u_mgr: "manager", u_owner: "owner", u_mgr2: "manager" },
  biz_access: { [B]: { u_mgr: true, u_mgr2: true } },
  app: { business: { _v: JSON.stringify([{ id: B, name: "A" }]) } },   // R3: the business registry (business must belong to the tenant)
} } });
const apps = {};
const realDb = () => apps.seed.database();
/** The Admin DB handed to the writer, with optional per-path overrides (fault injection only). */
let overrides = [];
function adminDb() { return { ref: (p) => { const r = realDb().ref(p); for (const o of overrides) if (o.match(p)) return o.wrap(r); return r; } }; }
globalThis.__DB = adminDb;
async function seed() { overrides = []; await realDb().ref("/").set(fixtures()); globalThis.__CLAIMS = { uid: "u_mgr", email: "m@x" }; }
const client = (uid) => { if (!apps[uid]) apps[uid] = admin.initializeApp({ databaseURL: DB_URL, databaseAuthVariableOverride: { uid, token: { email: uid + "@x" } } }, "c-" + uid); return apps[uid].database(); };
const BIND = { tenantId: T, bizId: B };   // R4: every authoritative decode is bound
const clientDecode = async (uid) => { const s = await client(uid).ref(NODE).once("value"); return costHistoryCodec.decodeHistory({ exists: s.exists(), value: s.val() }, BIND); };
const nodeNow = async () => (await realDb().ref(NODE).once("value")).val();
let clockMs = Date.parse("2026-10-02T09:00:00Z");
const writer = () => W.createCostHistoryWriter({ db: adminDb(), clock: () => (clockMs += 10) });
const body = (id, expectedHead = null) => ({ versionId: id, expectedHead, effectiveFrom: "2026-10-02", basis: "recorded", globalEmployees: [], fixedItems: [{ itemKey: "f1", monthlyAmount: "3100" }], rent: { mode: "none" }, royalty: { mode: "none" } });
const save = (w, id, head = null) => w.saveCostVersion({ headers: {} }, { tenantId: T, bizId: B, body: body(id, head) });
const activate = (w, id, head = null) => w.activateCostHistory({ headers: {} }, { tenantId: T, bizId: B, body: body(id, head) });
const asUser = (uid) => { globalThis.__CLAIMS = { uid, email: uid + "@x" }; };
const afterCommit = (fn) => ({ match: (p) => p === NODE, wrap: (r) => ({ get: () => r.get(), transaction: async (...a) => { const out = await r.transaction(...a); await fn(out); return out; } }) });

const results = []; let failures = 0;
async function run(id, description, fn) {
  try { const n = await fn(); results.push({ id, status: "PASS", description, notes: n || "" }); }
  catch (e) { failures++; results.push({ id, status: "FAIL", description, notes: (e && e.stack) || String(e) }); }
}
const expect = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };

async function main() {
  assertSafe();
  apps.seed = admin.initializeApp({ databaseURL: DB_URL }, "seed");

  await run("FWE-1", "ordinary save: version + PENDING review commit together, the post-commit check clears it; a client (manager with access) reads an authoritative history", async () => {
    await seed();
    const r = await save(writer(), A);
    eq([r.status, r.postCommitAccess, r.review], ["committed_current", "current", "cleared"], "result");
    eq((await nodeNow()).review[A].state, "cleared", "stored review");
    eq((await clientDecode("u_mgr2")).state, "present", "client decode");
    return "cleared; client present";
  });
  await run("FWE-2", "in-window revocation ⇒ FLAGGED review and matching audit in one node; client decode withholds the history", async () => {
    await seed();
    let done = false;
    overrides = [afterCommit(async (out) => { if (out.committed && !done) { done = true; await realDb().ref(`tenants/${T}/members/u_mgr`).set(false); } })];
    const r = await save(writer(), A);
    eq([r.postCommitAccess, r.review, r.audit], ["revoked_during_commit", "flagged", "flag_persisted"], "result");
    const stored=await nodeNow();
    eq(stored.review[A].state, "flagged", "stored");
    eq([stored.review[A].flagAudit.versionId,stored.review[A].flagAudit.intentDigest,stored.review[A].flagAudit.recordedAt],
      [A,stored.review[A].intentDigest,stored.versions[A].recordedAt],"same-snapshot flag audit binding");
    expect(!(await realDb().ref(`tenants/${T}/audit/cost_history_flags/${A}`).once("value")).exists(), "no detached flag audit node");
    const malformed=JSON.parse(JSON.stringify(stored));delete malformed.review[A].flagAudit;
    eq(costHistoryCodec.decodeHistory({exists:true,value:malformed},BIND).state,"unreadable","flagged without audit is malformed");
    eq((await clientDecode("u_mgr2")).reason, "authorization_review_flagged", "client decode");
    return "flagged, durable";
  });
  await run("FWE-3", "revocation + atomic flag/audit transaction failure ⇒ the review stays PENDING in the node; never authoritative for any reader", async () => {
    await seed();
    let commits = 0;
    overrides = [
      { match: (p) => p === NODE, wrap: (r) => ({ get: () => r.get(), transaction: async (...a) => { commits++; if (commits >= 2) throw new Error("review write failed"); const out = await r.transaction(...a); await realDb().ref(`tenants/${T}/members/u_mgr`).set(false); return out; } }) },
    ];
    const r = await save(writer(), A);
    eq([r.postCommitAccess, r.audit, r.review], ["revoked_during_commit", "flag_unconfirmed", "pending"], "result");
    overrides = [];
    eq((await nodeNow()).review[A].state, "pending", "stored");
    eq((await clientDecode("u_mgr2")).reason, "authorization_review_pending", "client decode");
    return "pending retained";
  });
  await run("FWE-4", "post-commit verification unavailable ⇒ pending; a later version is refused; reconciliation clears it (owner activation, owner still authorized); the next save works (no lockout)", async () => {
    await seed(); asUser("u_owner");
    let committed = false;
    overrides = [afterCommit(async (out) => { committed = committed || out.committed; }), { match: (p) => committed && p === `tenants/${T}/roles/u_owner`, wrap: (r) => ({ get: async () => { throw new Error("transport"); }, transaction: (...a) => r.transaction(...a) }) }];
    const r = await save(writer(), A);
    eq([r.postCommitAccess, r.review], ["verification_unavailable", "pending"], "result");
    overrides = [];
    eq((await save(writer(), Bv, { revision: 1, headVersionId: A })).status, "review_unresolved", "later version refused");
    expect(!(await nodeNow()).versions[Bv], "no later version stored");
    const rec = await writer().reconcilePendingReviews({ tenantId: T, bizId: B });
    eq(rec.results.map((x) => [x.state, x.requiredRole]), [["cleared", "owner"]], "reconciled (the activation's owner requirement is derived from the chain)");
    eq((await clientDecode("u_mgr2")).state, "present", "authoritative after recovery");
    asUser("u_mgr");
    const n = await save(writer(), Bv, { revision: 1, headVersionId: A });
    eq([n.status, n.review], ["committed_current", "cleared"], "next save");
    return "pending → reconciled → next save ok";
  });
  await run("FWE-5", "parallel saves from the same (absent) head ⇒ exactly ONE version commits; its review resolves; the other is a typed conflict", async () => {
    await seed();
    const rs = await Promise.all([save(writer(), A), save(writer(), Bv), save(writer(), Cv)]);
    const ok = rs.filter((x) => x.status === "committed_current");
    eq(ok.length, 1, "one winner " + JSON.stringify(rs.map((x) => x.status)));
    const nd = await nodeNow();
    eq(Object.keys(nd.versions).length, 1, "one version"); eq(nd.review[Object.keys(nd.versions)[0]].state, "cleared", "resolved");
    expect(rs.filter((x) => x.status !== "committed_current").every((x) => ["head_conflict", "review_unresolved"].includes(x.status)), "typed losers " + JSON.stringify(rs.map((x) => x.status)));
    return rs.map((x) => x.status).join(",");
  });
  await run("FWE-6", "parallel reconciliations of one pending review ⇒ exactly one transition; every other call is idempotent; the entry is cleared once", async () => {
    await seed(); asUser("u_owner");
    let committed = false;
    overrides = [afterCommit(async (out) => { committed = committed || out.committed; }), { match: (p) => committed && p === `tenants/${T}/roles/u_owner`, wrap: (r) => ({ get: async () => { throw new Error("transport"); }, transaction: (...a) => r.transaction(...a) }) }];
    await save(writer(), A);
    overrides = [];
    const rs = await Promise.all([1, 2, 3, 4].map(() => writer().reconcilePendingReviews({ tenantId: T, bizId: B })));
    const flat = rs.flatMap((x) => x.results.map((y) => y.status));
    eq(flat.filter((s) => s === "resolved").length, 1, "one transition " + JSON.stringify(flat));
    expect(flat.every((s) => s === "resolved" || s === "already_cleared"), "others idempotent " + JSON.stringify(flat));
    eq((await nodeNow()).review[A].state, "cleared", "cleared");
    return JSON.stringify(flat);
  });
  await run("FWE-7", "lost acknowledgement of the review transition (throw after commit) ⇒ full-payload readback resolves it", async () => {
    await seed();
    let n = 0;
    overrides = [{ match: (p) => p === NODE, wrap: (r) => ({ get: () => r.get(), transaction: async (...a) => { n++; const out = await r.transaction(...a); if (n === 2) throw new Error("disconnected after commit"); return out; } }) }];
    const r = await save(writer(), A);
    eq(r.review, "cleared", "resolved via readback");
    overrides = [];
    eq((await nodeNow()).review[A].state, "cleared", "stored");
    return "readback";
  });
  await run("FWE-8", "clients (owner and manager with access) cannot forge, clear or overwrite review state, versions or head", async () => {
    await seed();
    let committed = false;
    overrides = [afterCommit(async (out) => { committed = committed || out.committed; }), { match: (p) => committed && p === `tenants/${T}/biz_access/${B}/u_mgr`, wrap: (r) => ({ get: async () => { throw new Error("transport"); }, transaction: (...a) => r.transaction(...a) }) }];
    await save(writer(), A);
    overrides = [];
    const before = JSON.stringify(await nodeNow());
    let denied = 0;
    for (const uid of ["u_owner", "u_mgr", "u_mgr2"]) {
      for (const op of [
        () => client(uid).ref(`${NODE}/review/${A}/state`).set("cleared"),
        () => client(uid).ref(`${NODE}/review/${A}`).set({ state: "cleared", decision: "accepted" }),
        () => client(uid).ref(`${NODE}/review`).remove(),
        () => client(uid).ref(`${NODE}/head/revision`).set(7),
        () => client(uid).ref(NODE).update({ [`review/${A}/state`]: "cleared" }),
      ]) { try { await op(); } catch (e) { if (/permission/i.test(String(e.code || e.message))) denied++; else throw e; } }
    }
    eq(denied, 15, "every client write denied");
    eq(JSON.stringify(await nodeNow()), before, "node unchanged");
    eq((await clientDecode("u_mgr2")).reason, "authorization_review_pending", "still pending");
    return "15/15 denied";
  });

  await run("FWE-9", "R4: the business is removed from the registry after the entry check, before the final pre-commit check ⇒ denied, nothing stored", async () => {
    await seed(); asUser("u_owner");
    let removed = false;
    overrides = [{ match: (p) => p === NODE, wrap: (r) => ({ get: async () => { const snap = await r.get(); if (!removed) { removed = true; await realDb().ref(`tenants/${T}/app/business`).set({ _v: "[]" }); } return snap; }, transaction: (...a) => r.transaction(...a) }) }];
    const r = await activate(writer(), A);
    overrides = [];
    eq(r.status, "business_not_in_tenant", "denied by the fresh pre-commit registry read");
    eq(await nodeNow(), null, "nothing stored");
    return "denied, no node";
  });
  await run("FWE-10", "R4: the activating owner is downgraded to manager right after the version commits ⇒ FLAGGED with its atomic audit, never cleared; the manager cannot accept; an owner can", async () => {
    await seed(); asUser("u_owner");
    let done = false;
    overrides = [afterCommit(async (out) => { if (out.committed && !done) { done = true; await realDb().ref(`tenants/${T}/roles/u_owner`).set("manager"); await realDb().ref(`tenants/${T}/biz_access/${B}/u_owner`).set(true); } })];
    const r = await activate(writer(), A);
    overrides = [];
    eq([r.status, r.postCommitAccess, r.review, r.audit], ["committed_current", "revoked_during_commit", "flagged", "flag_persisted"], "owner-only activation lost its role in the window");
    const stored = await nodeNow();
    eq([stored.review[A].state, stored.review[A].flagAudit.resultingState, stored.review[A].flagAudit.outcome], ["flagged", "flagged", "revoked_during_commit"], "stored");
    eq((await clientDecode("u_mgr2")).reason, "authorization_review_flagged", "client decode withholds");
    const digest = stored.review[A].intentDigest;
    eq((await writer().acceptFlaggedVersion({ headers: {} }, { tenantId: T, bizId: B, versionId: A, intentDigest: digest, operationId: Cv })).status, "role_not_allowed", "the downgraded actor cannot accept");
    await realDb().ref(`tenants/${T}/roles/u_owner`).set("owner");
    const acc = await writer().acceptFlaggedVersion({ headers: {} }, { tenantId: T, bizId: B, versionId: A, intentDigest: digest, operationId: Cv });
    eq([acc.status, acc.state, acc.decision], ["resolved", "cleared", "accepted"], "owner acceptance");
    return "flagged → accepted by owner";
  });
  await run("FWE-11", "R4: owner acceptance stores cleared + decision audit accepted (authoritative for every reader); a numeric operation id is refused before any read; replay is idempotent", async () => {
    await seed();
    let done = false;
    overrides = [afterCommit(async (out) => { if (out.committed && !done) { done = true; await realDb().ref(`tenants/${T}/members/u_mgr`).set(false); } })];
    const r = await save(writer(), A);
    overrides = [];
    eq(r.review, "flagged", "flagged first");
    const digest = (await nodeNow()).review[A].intentDigest;
    asUser("u_owner");
    eq((await writer().acceptFlaggedVersion({ headers: {} }, { tenantId: T, bizId: B, versionId: A, intentDigest: digest, operationId: 12345678 })).status, "request_shape", "numeric operation id refused");
    const acc = await writer().acceptFlaggedVersion({ headers: {} }, { tenantId: T, bizId: B, versionId: A, intentDigest: digest, operationId: Bv });
    eq([acc.status, acc.state, acc.decision], ["resolved", "cleared", "accepted"], "accepted");
    const e = (await nodeNow()).review[A];
    eq([e.state, e.decision, e.decisionAudit.decision, e.decisionAudit.resultingState, e.decisionAudit.operationId, e.decisionAudit.decidedBy, e.decisionAudit.tenantId, e.decisionAudit.bizId, e.decisionAudit.versionId], ["cleared", "accepted", "accepted", "cleared", Bv, "u_owner", T, B, A], "stored decision evidence");
    eq(Object.keys(e).sort(), ["actor", "committedAt", "decision", "decisionAudit", "flagAudit", "intentDigest", "resolution", "resolvedAt", "schema", "state"], "exact entry shape");
    eq((await clientDecode("u_mgr2")).state, "present", "client decode: authoritative");
    eq((await writer().acceptFlaggedVersion({ headers: {} }, { tenantId: T, bizId: B, versionId: A, intentDigest: digest, operationId: Bv })).status, "already_accepted", "replay");
    eq((await writer().rejectFlaggedVersion({ headers: {} }, { tenantId: T, bizId: B, versionId: A, intentDigest: digest, operationId: Cv })).status, "review_already_resolved:cleared", "terminal");
    return "cleared + accepted";
  });
  await run("FWE-12", "R4: an unregistered business (ghost) — read, activation, decision and reconciliation are refused through the real transport; nothing is written", async () => {
    await seed(); asUser("u_owner");
    const ghost = "ghostBiz";
    await realDb().ref(`tenants/${T}/biz_access/${ghost}/u_mgr`).set(true);
    const w = writer();
    eq((await w.readCostHistory({ headers: {} }, { tenantId: T, bizId: ghost })).status, "business_not_in_tenant", "read");
    eq((await w.activateCostHistory({ headers: {} }, { tenantId: T, bizId: ghost, body: body(A) })).status, "business_not_in_tenant", "activation");
    eq((await w.acceptFlaggedVersion({ headers: {} }, { tenantId: T, bizId: ghost, versionId: A, intentDigest: "a".repeat(64), operationId: Bv })).status, "business_not_in_tenant", "decision");
    eq((await w.reconcilePendingReviews({ tenantId: T, bizId: ghost })).status, "business_not_in_tenant", "reconcile");
    eq((await realDb().ref(`tenants/${T}/biz:${ghost}:cost_history`).once("value")).val(), null, "nothing written");
    return "refused everywhere";
  });

  const w = (s, n) => String(s).padEnd(n).slice(0, n);
  console.log(`\n${w("case", 7)} ${w("status", 6)} notes`); console.log("-".repeat(110));
  for (const r of results) console.log(`${w(r.id, 7)} ${w(r.status, 6)} ${r.status === "PASS" ? r.notes : r.notes.split("\n")[0]}`);
  console.log("\n=== TOTALS ===");
  console.log(`total=${results.length} passed=${results.length - failures} failed=${failures}`);
  if (results.length !== 12) { process.exitCode = 3; return; }
  if (failures) { console.error("\n=== FAILURES ==="); for (const r of results.filter((x) => x.status === "FAIL")) console.error(`${r.id} ${r.description}\n    ${r.notes}`); process.exitCode = 1; return; }
  console.log("\nALL CASES PASSED — F1 review state is fail-closed over the real transport");
}
const direct = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (direct) {
  main().then(async () => { await Promise.all(admin.apps.filter(Boolean).map((a) => a.delete().catch(() => {}))); process.exit(process.exitCode || 0); })
    .catch(async (e) => { console.error("HARNESS ERROR:", (e && e.stack) || e); process.exitCode = 4; await Promise.all(admin.apps.filter(Boolean).map((a) => a.delete().catch(() => {}))); process.exit(4); });
}
