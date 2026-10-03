// P1 R1 — DEC-AUTH-1 review state, lost acknowledgements and owner decisions over the REAL api/admin.js
// handlers (two independent module instances = two server instances) on an in-memory RTDB.
//   RV-L*  lost acknowledgement: commit-then-throw ⇒ full-payload readback ⇒ applied (never "not saved");
//          nothing stored ⇒ outcome_unknown + same-operation retry; a tampered payload is never "applied"
//   RV-R*  review: audit + review write failures stay PENDING; a same-actor replay finishes the post-commit
//          decision; reconciliation; owner-only accept / reject with exactly-once accounting; blocking;
//          a different operation / payload can never be resolved
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, cpSync, mkdirSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { makeDb, installDb, ROOT, T, B } from "../support/server-reader-harness.mjs";
import { loadCommitted } from "../support/fincore-load.mjs";
import * as SC from "../../lib/supplierCredits.js";

const CORE = (await loadCommitted()).finance.supplierCredits;
async function instance() {
  const dir = mkdtempSync(join(tmpdir(), "p1r1-srv-"));
  cpSync(join(ROOT, "lib"), join(dir, "lib"), { recursive: true });
  mkdirSync(join(dir, "api"), { recursive: true });
  cpSync(join(ROOT, "api", "admin.js"), join(dir, "api", "admin.js"));
  mkdirSync(join(dir, "fincore"), { recursive: true });
  cpSync(join(ROOT, "fincore", "v1"), join(dir, "fincore", "v1"), { recursive: true });
  try { symlinkSync(join(ROOT, "node_modules"), join(dir, "node_modules"), "dir"); } catch (_) {}
  writeFileSync(join(dir, "lib", "adminSdk.js"), `export function getAdminDb() { return globalThis.__DB; }\nexport function getAdminAuth() { return { getUser: async () => ({}) }; }\n`);
  writeFileSync(join(dir, "lib", "verifyToken.js"), `export async function requireAuth(req) { const c = (req && req.__claims) || globalThis.__CLAIMS; if (!c) throw new Error("no auth"); return c; }\nexport async function verifyIdToken() { return globalThis.__CLAIMS; }\n`);
  writeFileSync(join(dir, "lib", "sendEmail.js"), `export async function sendEmail() { return {}; }\nexport async function sendAlertDigest() { return {}; }\n`);
  return (await import(pathToFileURL(join(dir, "api", "admin.js")).href)).default;
}
const SERVER_A = await instance(), SERVER_B = await instance();
const NODE = `tenants/${T}/biz:${B}:supplier_credits`;
const cid = (n) => `c0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const oid = (n) => `0a000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
function seed() {
  const db = installDb(makeDb());
  for (const [u, r] of [["mgr", "manager"], ["own", "owner"], ["sup", "super_owner"], ["mgr2", "manager"]]) { db.seed(`tenants/${T}/members/${u}`, true); db.seed(`tenants/${T}/roles/${u}`, r); }
  db.seed(`tenants/${T}/biz_access/${B}/mgr`, true); db.seed(`tenants/${T}/biz_access/${B}/mgr2`, true);
  db.seed(`tenants/${T}/biz:${B}:suppliers`, { _v: JSON.stringify([{ id: "s1", name: "S1" }, { id: "s2", name: "S2" }]) });
  globalThis.__CLAIMS = { uid: "mgr", email: "m@x" };
  return db;
}
async function call(action, body, { as = "mgr", server = SERVER_A } = {}) {
  const r = { code: null, body: null, setHeader() {}, status(n) { this.code = n; return this; }, json(v) { this.body = v; return this; } };
  await server({ method: "POST", query: { action }, headers: {}, body, __claims: { uid: as, email: as + "@x" } }, r);
  return { code: r.code, body: r.body };
}
const CREATE = (n, over = {}) => ({ tenantId: T, bizId: B, creditId: cid(n), operationId: oid(n), supplierId: "s1", issueDate: "2026-08-10", amount: "100", documentNumber: "CR-" + n, ...over });
const stored = (db) => db.read(NODE);
const dec = (db) => CORE.decodeSupplierCredits(SC.safeNodeView(stored(db)), { tenantId: T, bizId: B });
/** Hook one path's ref: wrap(r) returns overrides. Returns an un-hook function. */
function hook(db, match, wrap) { const orig = db.ref; db.ref = (p) => { const r = orig(p); return match(p) ? { ...r, ...wrap(r) } : r; }; return () => { db.ref = orig; }; }
const revokeAfterCommit = (db, uid = "mgr") => { let done = false; return hook(db, (p) => p === NODE, (r) => ({ transaction: async (fn, ...a) => { const o = await r.transaction(fn, ...a); if (o.committed && !done) { done = true; db.seed(`tenants/${T}/members/${uid}`, false); } return o; } })); };
const accessUnavailableAfterCommit = (db, uid = "mgr") => { let committed = false; hook(db, (p) => p === NODE, (r) => ({ transaction: async (fn, ...a) => { const o = await r.transaction(fn, ...a); committed = committed || o.committed; return o; } })); return hook(db, (p) => committed && p === `tenants/${T}/biz_access/${B}/${uid}`, () => ({ get: async () => { throw new Error("transport"); }, once: async () => { throw new Error("transport"); } })); };

// ── RV-L lost acknowledgement ─────────────────────────────────────────────────────────────────
test("RV-L01 the credit commits and the SDK throws (lost acknowledgement): the server resolves it by full-payload readback ⇒ 200 applied, review cleared (red on 1057af89: 502 txn_failed 'not saved')", async () => {
  const db = seed();
  let first = true;
  hook(db, (p) => p === NODE, (r) => ({ transaction: async (fn, ...a) => { const o = await r.transaction(fn, ...a); if (first) { first = false; throw new Error("ack lost"); } return o; } }));
  const res = await call("create-supplier-credit", CREATE(1));
  assert.equal(res.code, 200, JSON.stringify(res.body)); assert.equal(res.body.applied, true); assert.equal(res.body.resolvedBy, "readback");
  assert.equal(res.body.review, "cleared"); assert.equal(stored(db).review[oid(1)].state, "cleared");
  assert.equal(Object.keys(stored(db).records).length, 1, "exactly one record");
});

test("RV-L02 the transaction throws and NOTHING was stored: 503 outcome_unknown with retryWithSameOperation (never 'not saved'); the SAME operation retried applies exactly once", async () => {
  const db = seed();
  const un = hook(db, (p) => p === NODE, () => ({ transaction: async () => { throw new Error("disconnected before commit"); } }));
  const res = await call("create-supplier-credit", CREATE(1));
  assert.equal(res.code, 503); assert.deepEqual([res.body.error, res.body.outcomeUnknown, res.body.retryWithSameOperation, res.body.detail], ["outcome_unknown", true, true, "operation_not_found_on_readback"]);
  un();
  const retry = await call("create-supplier-credit", CREATE(1));
  assert.equal(retry.code, 200); assert.equal(retry.body.applied, true);
  const again = await call("create-supplier-credit", CREATE(1));
  assert.equal(again.body.replayed, true); assert.equal(Object.keys(stored(db).records).length, 1);
});

test("RV-L03 record existence alone never proves success: a stored ledger entry whose stored payload differs ⇒ 409 stored_payload_mismatch, never 'applied'", async () => {
  const db = seed();
  assert.equal((await call("create-supplier-credit", CREATE(1))).code, 200);
  // the same operation is retried, its transaction throws, and the stored payload has been altered meanwhile
  const n = stored(db); n.records[cid(1)].amount = "999"; db.seed(NODE, n);
  hook(db, (p) => p === NODE, () => ({ transaction: async () => { throw new Error("ack lost"); } }));
  const res = await call("create-supplier-credit", CREATE(1));
  assert.equal(res.code, 409); assert.equal(res.body.error, "stored_payload_mismatch");
  // and another actor reusing the operation id is never told it succeeded
  const other = await call("create-supplier-credit", CREATE(1), { as: "mgr2" });
  assert.equal(other.code, 409); assert.equal(other.body.error, "idempotency_conflict");
});

test("RV-L04 lost acknowledgement of the REVIEW transition (throw after the clear committed) ⇒ readback ⇒ cleared", async () => {
  const db = seed();
  let n = 0;
  hook(db, (p) => p === NODE, (r) => ({ transaction: async (fn, ...a) => { n++; const o = await r.transaction(fn, ...a); if (n === 2) throw new Error("ack lost"); return o; } }));
  const res = await call("create-supplier-credit", CREATE(1));
  assert.equal(res.body.review, "cleared"); assert.equal(stored(db).review[oid(1)].state, "cleared");
});

test("RV-L05 the browser seam classifies every ambiguous outcome as UNKNOWN (keep the same operation), and only confirmed refusals as 'not saved'", async () => {
  const { readFileSync } = await import("node:fs");
  const vm = (await import("node:vm")).default;
  const page = readFileSync(join(ROOT, "index.html"), "utf8");
  const i = page.indexOf("// ── P1 supplier credits browser seam");
  const win = {};
  vm.runInNewContext(page.slice(i, page.indexOf("</script>", i)), { window: win, Object, Promise, setTimeout, clearTimeout, AbortController });
  const { classify, TXT, errorText, refusalText } = win.MarjinP1;
  assert.equal(refusalText("weird"), TXT.refused); assert.doesNotMatch(TXT.refused, /אינו ידוע/);
  assert.deepEqual({ ...classify(false, 0, null) }, { kind: "unknown", code: "network" });
  assert.deepEqual({ ...classify(true, 503, { error: "outcome_unknown" }) }, { kind: "unknown", code: "outcome_unknown" });
  assert.deepEqual({ ...classify(true, 502, { error: "txn_failed" }) }, { kind: "unknown", code: "txn_failed" });
  assert.deepEqual({ ...classify(true, 500, null) }, { kind: "unknown", code: "http_500" });
  assert.deepEqual({ ...classify(true, 409, { error: "something_new" }) }, { kind: "refused", code: "something_new" }, "every 4xx is decided before / by the transaction");
  assert.deepEqual({ ...classify(true, 403, { error: "not a tenant member" }) }, { kind: "refused", code: "not a tenant member" });
  assert.deepEqual({ ...classify(true, 503, { error: "suppliers_unavailable" }) }, { kind: "refused", code: "suppliers_unavailable" }, "a known pre-transaction 5xx");
  assert.deepEqual({ ...classify(true, 503, { error: "some_new_5xx" }) }, { kind: "unknown", code: "some_new_5xx" });
  assert.deepEqual({ ...classify(true, 200, { ok: false }) }, { kind: "unknown", code: "http_200" });
  assert.deepEqual({ ...classify(true, 409, { error: "duplicate_document" }) }, { kind: "refused", code: "duplicate_document" });
  assert.equal(classify(true, 200, { ok: true }).kind, "ok");
  assert.match(TXT.unknown, /אינו ידוע/); assert.doesNotMatch(TXT.unknown, /לא נשמר/);
  assert.equal(errorText("network"), TXT.unknown, "a network failure is never shown as 'not saved'");
});

// ── RV-R review state ─────────────────────────────────────────────────────────────────────────
test("RV-R01 revocation in the window + audit write failure + review write failure ⇒ the review stays PENDING (visible, never counted); the response says so", async () => {
  const db = seed();
  revokeAfterCommit(db);
  let n = 0;
  hook(db, (p) => p === NODE, (r) => ({ transaction: async (fn, ...a) => { n++; if (n >= 2) throw new Error("review write failed"); return r.transaction(fn, ...a); }, get: r.get, once: r.once }));
  hook(db, (p) => p.startsWith(`tenants/${T}/audit/`), () => ({ transaction: async () => { throw new Error("audit down"); }, get: async () => { throw new Error("audit down"); } }));
  const res = await call("create-supplier-credit", CREATE(1));
  assert.equal(res.code, 200);
  assert.deepEqual([res.body.postCommitAccess, res.body.audit, res.body.review, res.body.rebuildRequired], ["revoked_during_commit", "flag_unconfirmed", "pending", false]);
  assert.ok(res.body.reviewResolution, "the failed transition is reported");
  assert.equal(stored(db).review[oid(1)].state, "pending"); assert.deepEqual(dec(db).credits, []);
  assert.deepEqual(dec(db).issues.map((i) => i.code), ["review_pending"]);
});

test("RV-R02 post-check unavailable ⇒ pending; the SAME actor retrying the SAME operation finishes the decision (cleared) — idempotent, nothing written twice", async () => {
  const db = seed();
  const un = accessUnavailableAfterCommit(db);
  const r1 = await call("create-supplier-credit", CREATE(1));
  assert.equal(r1.body.review, "pending");
  un();
  const r2 = await call("create-supplier-credit", CREATE(1));
  assert.deepEqual([r2.code, r2.body.replayed, r2.body.review, r2.body.rebuildRequired], [200, true, "cleared", false]);
  assert.deepEqual(r2.body.affectedDates, ["2026-08-10"], "the now-authoritative date is reported for the rebuild");
  const rev = stored(db).revision;
  const r3 = await call("create-supplier-credit", CREATE(1));
  assert.equal(r3.body.review, "cleared"); assert.equal(stored(db).revision, rev, "no further write");
});

test("RV-R03 reconciliation (any writer may trigger it; the ORIGINAL actor's current authorization decides): authorized ⇒ cleared; revoked ⇒ flagged + audit; unavailable ⇒ pending; idempotent; never touches decided entries", async () => {
  const db = seed();
  let un = accessUnavailableAfterCommit(db);
  await call("create-supplier-credit", CREATE(1)); un();
  un = accessUnavailableAfterCommit(db, "mgr2");
  await call("create-supplier-credit", CREATE(2), { as: "mgr2" }); un();
  assert.deepEqual(dec(db).unresolved.pending, [oid(1), oid(2)]);
  db.seed(`tenants/${T}/biz_access/${B}/mgr2`, null);                                      // mgr2 lost business access since
  const rec = await call("reconcile-supplier-credit-reviews", { tenantId: T, bizId: B, operationId: oid(90) }, { as: "own" });
  assert.equal(rec.code, 200);
  assert.deepEqual(rec.body.results.map((x) => [x.operationId, x.status, x.state, x.audit || null]), [[oid(1), "resolved", "cleared", null], [oid(2), "resolved", "flagged", "flag_persisted"]]);
  assert.equal(stored(db).review[oid(2)].flagAudit.outcome, "reconciled_unauthorized");
  const again = await call("reconcile-supplier-credit-reviews", { tenantId: T, bizId: B, operationId: oid(91) }, { as: "own" });
  assert.deepEqual(again.body.results, [], "nothing pending any more; the flagged entry is untouched");
  assert.deepEqual(dec(db).credits.map((c) => c.creditId), [cid(1)]);
  // unavailable authorization store ⇒ stays pending
  un = accessUnavailableAfterCommit(db);
  await call("create-supplier-credit", CREATE(3)); un();
  hook(db, (p) => p === `tenants/${T}/members/mgr`, () => ({ get: async () => { throw new Error("transport"); } }));
  const r3 = await call("reconcile-supplier-credit-reviews", { tenantId: T, bizId: B, operationId: oid(92) }, { as: "own" });
  assert.deepEqual(r3.body.results.map((x) => [x.operationId, x.status]), [[oid(3), "verification_unavailable"]]);
  assert.equal(stored(db).review[oid(3)].state, "pending");
});

test("RV-R04 ONLY the current owner may decide a flagged operation (manager and super_owner 403; digest-bound); accept counts it EXACTLY ONCE; a second decision is refused", async () => {
  const db = seed();
  revokeAfterCommit(db, "mgr2");
  const r = await call("create-supplier-credit", CREATE(1), { as: "mgr2" });
  assert.equal(r.body.review, "flagged");
  const digest = stored(db).review[oid(1)].intentDigest;
  const body = (over = {}) => ({ tenantId: T, bizId: B, operationId: oid(80), targetOperationId: oid(1), intentDigest: digest, decision: "accept", ...over });
  assert.equal((await call("decide-supplier-credit-review", body(), { as: "mgr" })).code, 403);
  assert.equal((await call("decide-supplier-credit-review", body(), { as: "sup" })).code, 403);
  assert.equal((await call("decide-supplier-credit-review", body({ intentDigest: "f".repeat(64) }), { as: "own" })).body.error, "review_identity_mismatch");
  assert.deepEqual(dec(db).credits, [], "not counted before the decision");
  const ok = await call("decide-supplier-credit-review", body(), { as: "own" });
  assert.deepEqual([ok.code, ok.body.applied, ok.body.rebuildRequired], [200, true, true]); assert.deepEqual(ok.body.affectedDates, ["2026-08-10"]);
  assert.deepEqual(dec(db).credits.map((c) => [c.creditId, c.amount]), [[cid(1), "100"]], "counted once");
  const replay = await call("decide-supplier-credit-review", body(), { as: "own" });
  assert.deepEqual([replay.code, replay.body.replayed], [200, true]);
  const second = await call("decide-supplier-credit-review", body({ operationId: oid(81) }), { as: "own" });
  assert.equal(second.body.error, "review_not_flagged");
  assert.equal(dec(db).credits.length, 1, "still exactly once");
});

test("RV-R05 rejecting a flagged REPLACEMENT restores the predecessor (pointer + accounting); the chain can continue from it", async () => {
  const db = seed();
  assert.equal((await call("create-supplier-credit", CREATE(1))).body.review, "cleared");
  revokeAfterCommit(db, "mgr2");
  const rp = await call("replace-supplier-credit", { ...CREATE(2, { documentNumber: "CR-1", amount: "70" }), creditId: cid(1), newCreditId: cid(2), expectedSeq: 1 }, { as: "mgr2" });
  assert.equal(rp.body.review, "flagged");
  assert.deepEqual(dec(db).credits.map((c) => c.creditId), [cid(1)], "the predecessor still counts while flagged");
  assert.equal((await call("void-supplier-credit", { tenantId: T, bizId: B, creditId: cid(2), operationId: oid(30), expectedSeq: 2 })).body.error, "review_unresolved", "blocked while unresolved");
  const d = stored(db).review[oid(2)].intentDigest;
  const rej = await call("decide-supplier-credit-review", { tenantId: T, bizId: B, operationId: oid(81), targetOperationId: oid(2), intentDigest: d, decision: "reject" }, { as: "own" });
  assert.equal(rej.code, 200);
  const st = dec(db);
  assert.deepEqual(st.credits.map((c) => [c.creditId, c.amount]), [[cid(1), "100"]]);
  assert.deepEqual(st.logical[0].head, { creditId: cid(1), seq: 2 });
  const next = await call("void-supplier-credit", { tenantId: T, bizId: B, creditId: cid(1), operationId: oid(31), expectedSeq: 2 });
  assert.equal(next.code, 200); assert.deepEqual(dec(db).credits, []);
});

test("RV-R06 an unresolved operation blocks ONLY its own logical credit; other credits remain editable", async () => {
  const db = seed();
  const un = accessUnavailableAfterCommit(db);
  await call("create-supplier-credit", CREATE(1)); un();
  assert.equal((await call("create-supplier-credit", CREATE(2))).body.review, "cleared");
  assert.equal((await call("void-supplier-credit", { tenantId: T, bizId: B, creditId: cid(1), operationId: oid(40), expectedSeq: 1 })).body.error, "review_unresolved");
  assert.equal((await call("void-supplier-credit", { tenantId: T, bizId: B, creditId: cid(2), operationId: oid(41), expectedSeq: 1 })).code, 200);
});

test("RV-R07 later operations can never clear a different operation or payload: a transition / decision carrying another operation's digest is refused", () => {
  const T0 = { tenantId: T, bizId: B };
  const mk = (n, node) => { const c = { ...T0, action: "create", creditId: cid(n), operationId: oid(n), input: SC.validateCreditInput({ supplierId: "s1", issueDate: "2026-08-10", amount: "1", documentNumber: "CR-" + n }), actorUid: "mgr", actorRole: "manager", now: 1000 + n }; c.requestHash = SC.requestHash(c); return SC.applyCreditOperation(node, c).node; };
  const n2 = mk(2, mk(1, null));
  const d1 = n2.review[oid(1)].intentDigest;
  assert.equal(SC.applyReviewTransition(n2, { ...T0, operationId: oid(2), intentDigest: d1, to: "cleared", resolution: "post_commit_authorized", now: 5000 }).o, "review_identity_mismatch");
});

test("RV-R08 two independent server instances writing in parallel: exactly one accepted document per identity, typed refusals, no orphan reservation", async () => {
  const db = seed();
  const rs = await Promise.all([
    call("create-supplier-credit", CREATE(1, { documentNumber: "INV 77" }), { server: SERVER_A }),
    call("create-supplier-credit", CREATE(2, { documentNumber: "inv 77" }), { server: SERVER_B }),
    call("create-supplier-credit", CREATE(3, { documentNumber: "INV 77" }), { server: SERVER_A, as: "mgr2" }),
  ]);
  assert.deepEqual(rs.map((r) => r.code).sort(), [200, 409, 409]);
  assert.ok(rs.filter((r) => r.code === 409).every((r) => r.body.error === "duplicate_document"));
  const n = stored(db);
  assert.equal(Object.keys(n.records).length, 1); assert.deepEqual(Object.keys(n.documents.s_s1), ["d_inv~20~77"]);
  assert.deepEqual(dec(db).issues, []);
});

test('P1R2-S01 similarity warning is visible as a typed refusal; explicit reason is stored atomically and replay is idempotent', async () => {
  const db=seed();
  assert.equal((await call('create-supplier-credit',CREATE(1,{documentNumber:'CR001'}))).code,200);
  const warning=await call('create-supplier-credit',CREATE(2,{documentNumber:'CR-001'}));
  assert.deepEqual([warning.code,warning.body.error,warning.body.detail],[409,'similar_document',{confirmedAgainst:[cid(1)]}]);
  assert.equal(Object.keys(stored(db).records).length,1);
  const confirm={confirmed:true,confirmedAgainst:[cid(1)],reason:'Checked distinct credit document'};
  const body=CREATE(2,{documentNumber:'CR-001',similarityConfirmation:confirm});
  const accepted=await call('create-supplier-credit',body);
  assert.equal(accepted.code,200,JSON.stringify(accepted.body));
  assert.equal(stored(db).records[cid(2)].similarityConfirmation.reason,confirm.reason);
  assert.equal(stored(db).records[cid(2)].similarityConfirmation.by,'mgr');
  assert.equal((await call('create-supplier-credit',body)).body.replayed,true);
  assert.equal((await call('create-supplier-credit',{...body,similarityConfirmation:{...confirm,reason:'Changed reason'}})).body.error,'idempotency_conflict');
  assert.equal(Object.keys(stored(db).records).length,2);
});

test('P1R2-S02 same-tenant owner without explicit biz access decides flagged; super_owner and removed owner cannot', async () => {
  const db=seed();
  revokeAfterCommit(db,'mgr');
  assert.equal((await call('create-supplier-credit',CREATE(1))).body.review,'flagged');
  const digest=stored(db).review[oid(1)].intentDigest;
  const body={tenantId:T,bizId:B,operationId:oid(80),targetOperationId:oid(1),intentDigest:digest,decision:'accept'};
  assert.equal((await call('decide-supplier-credit-review',body,{as:'sup'})).code,403);
  db.seed(`tenants/${T}/members/own`,false);
  assert.equal((await call('decide-supplier-credit-review',body,{as:'own'})).code,403);
  assert.equal(stored(db).review[oid(1)].state,'flagged');
  db.seed(`tenants/${T}/members/own`,true);
  assert.equal(db.read(`tenants/${T}/biz_access/${B}/own`),null);
  const accepted=await call('decide-supplier-credit-review',body,{as:'own'});
  assert.equal(accepted.code,200,JSON.stringify(accepted.body));
  assert.equal(stored(db).review[oid(1)].state,'acknowledged');
  assert.equal(stored(db).review[oid(1)].decisionAudit.operationId,oid(80));
});

test('P1R2-S03 failed atomic flag transaction leaves pending with no audit, and later recovery flags once', async () => {
  const db=seed();
  let first=true, transitions=0;
  hook(db,p=>p===NODE,r=>({transaction:async(fn,...args)=>{
    if(first){first=false;const out=await r.transaction(fn,...args);db.seed(`tenants/${T}/members/mgr`,false);return out;}
    if(transitions++===0) throw new Error('flag transaction rejected');
    return r.transaction(fn,...args);
  }}));
  const result=await call('create-supplier-credit',CREATE(1));
  assert.equal(result.code,200,JSON.stringify(result.body));
  assert.deepEqual([result.body.review,result.body.audit],['pending','flag_unconfirmed']);
  assert.equal(stored(db).review[oid(1)].state,'pending');
  assert.equal(stored(db).review[oid(1)].flagAudit,undefined);
  const rec=await call('reconcile-supplier-credit-reviews',{tenantId:T,bizId:B,operationId:oid(91)},{as:'own'});
  assert.equal(rec.code,200,JSON.stringify(rec.body));
  assert.equal(stored(db).review[oid(1)].state,'flagged');
  assert.equal(stored(db).review[oid(1)].flagAudit.operationId,oid(1));
});
