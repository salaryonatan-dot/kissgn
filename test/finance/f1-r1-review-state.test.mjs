// F1 R1 — fail-closed authorization review of cost versions (DEC-AUTH-1 window), MARJIN_COSTH/3.
//   RV-C*  codec: pending / flagged withhold the WHOLE history; cleared / acknowledged are authoritative;
//          strict review shape bound to its version; browser ≡ server ≡ committed
//   RV-P*  consumers: product timeline, server loader and C1 seam never fall back to current settings
//   RV-W*  the REAL writer (lib/finance/costHistoryWriter.js, real securityContext/helpers) over an in-memory
//          RTDB: audit / review failure is never lost, never authoritative; reconciliation, acknowledgement,
//          retries, lost acknowledgements, later versions and immutability
//   RV-G*  pins: the canary Rules pin equals the reviewed F1 Rules candidate; no alternate history layout
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { REPO, loadCommitted, loadCompiled } from "../support/fincore-load.mjs";
import { makeDb } from "../../tools/storage-v2/reader-sandbox.mjs";
import { loadWriter } from "../support/f1-writer-harness.mjs";
import { reviewEntry, DIGEST } from "../support/f1-history-fixtures.mjs";
import { loadSeam, srcOf, row, present } from "../support/c1-seam.mjs";
import { APPROVED_RULES_BLOB } from "../support/canary-fixtures.mjs";
import { F1_RULES_CANDIDATE_BLOB } from "../support/rules-authorized-delta.mjs";
import { compileServer } from "../support/server-reader-harness.mjs";

const COMMITTED = await loadCommitted(), COMPILED = await loadCompiled();
const codec = COMMITTED.costHistory.codec;
const W = await loadWriter(REPO);
const A = "00000000-0000-4000-8000-0000000000a1", Bv = "00000000-0000-4000-8000-0000000000b2";
const NOW = Date.parse("2026-10-02T09:00:00Z");
const ver = (id, over = {}) => ({ versionId: id, schema: "MARJIN_COSTV/1", effectiveFrom: "2026-10-02", recordedAt: NOW, recordedBy: "u_mgr", basis: "recorded", predecessorVersionId: "none", globalEmployeesCount: 0, fixedItemsCount: 1, fixedItems: [{ itemKey: "f1", monthlyAmount: "3100" }], rent: { mode: "none" }, royalty: { mode: "none" }, ...over });
const one = (state, over = {}) => { const v = ver(A); return { head: { revision: 1, headVersionId: A }, versions: { [A]: v }, review: { [A]: reviewEntry(v, state, over) } }; };
const dec = (value) => codec.decodeHistory({ exists: value !== null, value });

// ── codec ──────────────────────────────────────────────────────────────────────────────────────
test("RV-C01 pending and flagged reviews withhold the WHOLE history (unreadable, typed reason); cleared and acknowledged are authoritative", () => {
  assert.deepEqual([dec(one("pending")).state, dec(one("pending")).reason], ["unreadable", "authorization_review_pending"]);
  assert.deepEqual([dec(one("flagged")).state, dec(one("flagged")).reason], ["unreadable", "authorization_review_flagged"]);
  assert.equal(dec(one("cleared")).state, "present");
  assert.equal(dec(one("acknowledged")).state, "present");
  const s = codec.decodeHistoryStructure({ exists: true, value: one("pending") });
  assert.equal(s.state, "present"); assert.deepEqual(s.unresolved, { pending: [A], flagged: [] }, "the structural view (trusted writers only) reports it instead");
  assert.equal(COMMITTED.versions.costHistory, "MARJIN_COSTH/3");
});

test("RV-C02 a pending review on an EARLIER version withholds the history even when the head is cleared", () => {
  const v1 = ver(A), v2 = ver(Bv, { predecessorVersionId: A, recordedAt: NOW + 1 });
  const h = { head: { revision: 2, headVersionId: Bv }, versions: { [A]: v1, [Bv]: v2 }, review: { [A]: reviewEntry(v1, "pending"), [Bv]: reviewEntry(v2, "cleared") } };
  assert.equal(dec(h).reason, "authorization_review_pending"); assert.deepEqual(dec(h).detail, [A]);
});

test("RV-C03 strict review shape: missing / extra / re-pointed / malformed entries and the /1 envelope are unreadable", () => {
  const cases = [
    ["MARJIN_COSTH/1 envelope (no review)", (h) => { delete h.review; }, "envelope_shape"],
    ["missing entry", (h) => { h.review = {}; }, "review_shape"],
    ["extra entry", (h) => { h.review[Bv] = h.review[A]; }, "review_shape"],
    ["review not an object", (h) => { h.review = "x"; }, "review_shape"],
    ["actor re-pointed", (h) => { h.review[A].actor = "someone_else"; }, "review_invalid"],
    ["commit instant re-pointed", (h) => { h.review[A].committedAt = NOW + 1; }, "review_invalid"],
    ["digest malformed", (h) => { h.review[A].intentDigest = "xyz"; }, "review_invalid"],
    ["unknown state", (h) => { h.review[A].state = "approved"; }, "review_invalid"],
    ["schema", (h) => { h.review[A].schema = "MARJIN_COSTR/0"; }, "review_invalid"],
    ["cleared without resolvedAt", (h) => { delete h.review[A].resolvedAt; }, "review_invalid"],
    ["cleared with a flag resolution", (h) => { h.review[A].resolution = "revoked_during_commit"; }, "review_invalid"],
    ["resolved before commit", (h) => { h.review[A].resolvedAt = NOW - 1; }, "review_invalid"],
    ["extra field", (h) => { h.review[A].note = "x"; }, "review_invalid"],
  ];
  for (const [label, mut, reason] of cases) {
    const h = JSON.parse(JSON.stringify(one("cleared"))); mut(h);
    assert.equal(dec(h).reason, reason, label);
  }
  const ack = JSON.parse(JSON.stringify(one("acknowledged"))); delete ack.review[A].acknowledgedBy;
  assert.equal(dec(ack).reason, "review_invalid", "acknowledged without acknowledgedBy");
  const pend = JSON.parse(JSON.stringify(one("pending"))); pend.review[A].resolvedAt = NOW;
  assert.equal(dec(pend).reason, "review_invalid", "pending with resolution fields");
});

test("RV-C04 browser (committed fincore) ≡ fresh server compile on every review state", () => {
  for (const v of [one("pending"), one("flagged"), one("cleared"), one("acknowledged"), null]) {
    assert.deepEqual(JSON.parse(JSON.stringify(COMPILED.costHistory.codec.decodeHistory({ exists: v !== null, value: v }))), JSON.parse(JSON.stringify(dec(v))));
  }
});

// ── consumers ──────────────────────────────────────────────────────────────────────────────────
test("RV-P01 a pending / flagged history never falls back to current settings: product timeline unavailable, cost outputs withheld; revenue stays visible", () => {
  const rows = Array.from({ length: 10 }, (_, i) => ({ id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`, date: `2026-10-${String(i + 1).padStart(2, "0")}`, sales: "1000", payroll: "100" }));
  for (const st of ["pending", "flagged"]) {
    const inp = { rows, config: { state: "present", value: {} }, fixed: { state: "present", value: [{ id: "f", amount: "999" }] }, costHistory: dec(one(st)), asOfBusinessDate: "2026-10-20", exceptionsByDate: {}, exceptionStates: {}, exceptionLedgerState: "absent" };
    const t = COMMITTED.product.productTimeline(inp);
    assert.equal(t.timelineSource, "unavailable", st);
    const r = COMMITTED.product.productMonthReport(inp, { kind: "open_month", month: "2026-10" });
    assert.equal(r.actual.fixedAccrual.total, null, st + ": the current-settings fixed list (999) is never used");
    assert.equal(r.actual.operatingProfit.value, null); assert.equal(r.actual.grossProfitBeforeFixed.value, null);
    assert.ok(r.actual.revenue.value !== null);
  }
});

test("RV-P02 the C1 seam shows an explicit review-unavailable state (no amounts) for pending and flagged histories", () => {
  const F = COMMITTED, C = loadSeam();
  const rows = [row("2026-10-01", { sales: "100" }, "00000000-0000-4000-8000-000000000001")];
  for (const st of ["pending", "flagged"]) {
    const v = C.monthReport(F, { ...srcOf({ rows, asOf: "2026-10-05", config: present({}) }), costHistory: dec(one(st)) }, "2026-10");
    assert.deepEqual([v.status, v.reason], ["unavailable", "cost_history_authorization_review_" + st]);
  }
  const ok = C.monthReport(F, { ...srcOf({ rows, asOf: "2026-10-05", config: present({}) }), costHistory: dec(one("cleared")) }, "2026-10");
  assert.equal(ok.status, "ready");
});

test("RV-P03 the canonical server loader reports a pending history as cost_history_unreadable and withholds cost outputs", async () => {
  const srv = compileServer();
  const CI = await srv.import("src/finance-server/canonicalInputs.js");
  const db = makeDb();
  db.seed("tenants/tA/biz:bA:entries", { _v: JSON.stringify([{ id: "00000000-0000-4000-8000-000000000001", date: "2026-10-01", sales: "100" }]) });
  db.seed("tenants/tA/biz:bA:config", { _v: "{}" });
  db.seed("tenants/tA/biz:bA:cost_history", one("pending"));
  const i = await CI.loadCanonicalInputs(db, "tA", "bA", { site: "t", nowMs: Date.parse("2026-10-05T09:00:00Z"), need: { config: true, fixed: true, exceptions: true } });
  assert.equal(i.costHistoryState, "unreadable"); assert.equal(i.costHistory.reason, "authorization_review_pending");
  assert.ok(i.inputIssues.includes("cost_history_unreadable"));
});

// ── the real writer ─────────────────────────────────────────────────────────────────────────────
const T = "tenantA", B = "bizA", NODE = `tenants/${T}/biz:${B}:cost_history`;
function world({ role = "manager", uid = "u_mgr" } = {}) {
  const db = makeDb();
  for (const [u, r] of [[uid, role], ["u_owner", "owner"], ["u_mgr2", "manager"]]) { db.seed(`tenants/${T}/members/${u}`, true); db.seed(`tenants/${T}/roles/${u}`, r); }
  db.seed(`tenants/${T}/biz_access/${B}/${uid}`, true); db.seed(`tenants/${T}/biz_access/${B}/u_mgr2`, true);
  globalThis.__DB = db; globalThis.__CLAIMS = { uid, email: uid + "@x" };
  return db;
}
const body = (id = A, expectedHead = null, over = {}) => ({ versionId: id, expectedHead, effectiveFrom: "2026-10-02", basis: "recorded", globalEmployees: [], fixedItems: [{ itemKey: "f1", monthlyAmount: "3100" }], rent: { mode: "none" }, royalty: { mode: "none" }, ...over });
const writerFor = (db, clock = () => NOW) => W.createCostHistoryWriter({ db, clock });
const stored = (db) => db.read(NODE);
const reviewOf = (db, id = A) => (stored(db) && stored(db).review[id]) || null;
/** Wrap one path's ref; `wrap(r)` returns overrides. */
function hook(db, match, wrap) { const orig = db.ref; db.ref = (p) => { const r = orig(p); return match(p) ? { ...r, ...wrap(r) } : r; }; return () => { db.ref = orig; }; }
/** Revoke membership right after the cost-history version commits (the DEC-AUTH-1 window). */
function revokeAfterCommit(db, uid = "u_mgr") {
  let done = false;
  return hook(db, (p) => p === NODE, (r) => ({ transaction: async (fn, ...a) => { const out = await r.transaction(fn, ...a); if (out.committed && !done) { done = true; db.seed(`tenants/${T}/members/${uid}`, false); } return out; } }));
}

test("RV-W01 ordinary save: the version commits with a PENDING review in the same transaction, the post-commit check clears it, readers see an authoritative history", async () => {
  const db = world(); const w = writerFor(db);
  const seen = [];
  hook(db, (p) => p === NODE, (r) => ({ transaction: async (fn, ...a) => { const out = await r.transaction(fn, ...a); seen.push(JSON.parse(JSON.stringify(db.read(NODE)))); return out; } }));
  const res = await w.saveCostVersion({ headers: {} }, { tenantId: T, bizId: B, body: body() });
  assert.equal(res.status, "committed_current"); assert.equal(res.postCommitAccess, "current"); assert.equal(res.review, "cleared");
  assert.equal(seen[0].review[A].state, "pending", "the commit itself wrote the pending review");
  assert.equal(dec(seen[0]).reason, "authorization_review_pending", "between commit and clearance the version is NOT authoritative");
  assert.equal(reviewOf(db).state, "cleared"); assert.equal(reviewOf(db).resolution, "post_commit_authorized");
  assert.equal(dec(stored(db)).state, "present");
  assert.ok(db.read(`tenants/${T}/audit/cost_history_intents/${A}`), "pre-commit audit intent");
});

test("RV-W02 in-window revocation: durable FLAGGED state in the node + audit record; the version is never authoritative", async () => {
  const db = world(); const w = writerFor(db); revokeAfterCommit(db);
  const res = await w.saveCostVersion({ headers: {} }, { tenantId: T, bizId: B, body: body() });
  assert.deepEqual([res.status, res.postCommitAccess, res.review, res.audit], ["committed_current", "revoked_during_commit", "flagged", "flag_persisted"]);
  assert.equal(reviewOf(db).state, "flagged"); assert.equal(reviewOf(db).resolution, "revoked_during_commit");
  assert.equal(dec(stored(db)).reason, "authorization_review_flagged");
  assert.ok(reviewOf(db).flagAudit, "flag audit is atomic with review inside cost_history");
});

test("RV-W03 audit AND review writes fail after an in-window revocation: the failure is not lost — the review stays PENDING (visible, non-authoritative)", async () => {
  const db = world(); const w = writerFor(db); revokeAfterCommit(db);
  let commits = 0;
  hook(db, (p) => p === NODE, (r) => ({ transaction: async (fn, ...a) => { commits++; if (commits >= 2) throw new Error("review write failed"); return r.transaction(fn, ...a); }, get: r.get }));
  hook(db, (p) => p.startsWith(`tenants/${T}/audit/cost_history_flags/`), () => ({ transaction: async () => { throw new Error("audit down"); }, get: async () => { throw new Error("audit down"); } }));
  const res = await w.saveCostVersion({ headers: {} }, { tenantId: T, bizId: B, body: body() });
  assert.deepEqual([res.postCommitAccess, res.audit, res.review], ["revoked_during_commit", "flag_unconfirmed", "pending"]);
  assert.equal(reviewOf(db).state, "pending");
  assert.equal(dec(stored(db)).state, "unreadable", "never ordinary approved history");
  assert.equal(dec(stored(db)).reason, "authorization_review_pending");
});

test("RV-W04 post-commit verification UNAVAILABLE ⇒ pending (not authoritative); trusted reconciliation clears it when the actor is still authorized; then the next save works (no lockout)", async () => {
  const db = world(); const w = writerFor(db);
  let committed = false;
  hook(db, (p) => p === NODE, (r) => ({ transaction: async (fn, ...a) => { const out = await r.transaction(fn, ...a); committed = committed || out.committed; return out; } }));
  const restore = hook(db, (p) => committed && p === `tenants/${T}/biz_access/${B}/u_mgr`, () => ({ get: async () => { throw new Error("transport"); } }));
  const res = await w.saveCostVersion({ headers: {} }, { tenantId: T, bizId: B, body: body() });
  assert.deepEqual([res.status, res.postCommitAccess, res.review], ["committed_current", "verification_unavailable", "pending"]);
  assert.equal(dec(stored(db)).reason, "authorization_review_pending");
  restore();
  // a later version is REFUSED while the earlier review is unresolved (it cannot bury it)
  const blocked = await writerFor(db, () => NOW + 500).saveCostVersion({ headers: {} }, { tenantId: T, bizId: B, body: body(Bv, { revision: 1, headVersionId: A }) });
  assert.equal(blocked.status, "review_unresolved"); assert.equal(stored(db).versions[Bv], undefined);
  const rec = await w.reconcilePendingReviews({ tenantId: T, bizId: B });
  assert.deepEqual(rec.results.map((x) => [x.versionId, x.status, x.state]), [[A, "resolved", "cleared"]]);
  assert.equal(reviewOf(db).resolution, "reconciled_authorized"); assert.equal(dec(stored(db)).state, "present");
  const again = await w.reconcilePendingReviews({ tenantId: T, bizId: B });
  assert.deepEqual(again.results, [], "idempotent: nothing pending any more");
  const next = await writerFor(db, () => NOW + 1000).saveCostVersion({ headers: {} }, { tenantId: T, bizId: B, body: body(Bv, { revision: 1, headVersionId: A }) });
  assert.equal(next.status, "committed_current"); assert.equal(next.review, "cleared");
  assert.equal(dec(stored(db)).state, "present"); assert.equal(dec(stored(db)).versions.length, 2);
});

test("RV-W05 reconciliation with a revoked actor ⇒ FLAGGED (+ audit); a manager cannot acknowledge; an owner acknowledges ⇒ authoritative again; retries are idempotent", async () => {
  const db = world(); const w = writerFor(db);
  let committed = false;
  hook(db, (p) => p === NODE, (r) => ({ transaction: async (fn, ...a) => { const out = await r.transaction(fn, ...a); committed = committed || out.committed; return out; } }));
  const restore = hook(db, (p) => committed && p === `tenants/${T}/biz_access/${B}/u_mgr`, () => ({ get: async () => { throw new Error("transport"); } }));
  await w.saveCostVersion({ headers: {} }, { tenantId: T, bizId: B, body: body() });
  restore();
  db.seed(`tenants/${T}/roles/u_mgr`, "viewer");                                   // actor lost the write role
  const rec = await w.reconcilePendingReviews({ tenantId: T, bizId: B });
  assert.deepEqual(rec.results.map((x) => [x.status, x.state, x.audit]), [["resolved", "flagged", "flag_persisted"]]);
  assert.equal(reviewOf(db).resolution, "reconciled_unauthorized"); assert.equal(dec(stored(db)).reason, "authorization_review_flagged");
  const digest = reviewOf(db).intentDigest;
  globalThis.__CLAIMS = { uid: "u_mgr2", email: "m2@x" };
  assert.equal((await w.acknowledgeFlaggedVersion({ headers: {} }, { tenantId: T, bizId: B, versionId: A, intentDigest: digest, operationId: A })).status, "role_not_allowed");
  globalThis.__CLAIMS = { uid: "u_owner", email: "o@x" };
  assert.equal((await w.acknowledgeFlaggedVersion({ headers: {} }, { tenantId: T, bizId: B, versionId: A, intentDigest: DIGEST("b"), operationId: A })).status, "review_identity_mismatch", "a different payload digest can never resolve it");
  const ack = await w.acknowledgeFlaggedVersion({ headers: {} }, { tenantId: T, bizId: B, versionId: A, intentDigest: digest, operationId: A });
  assert.equal(ack.status, "resolved");
  assert.equal(reviewOf(db).state, "acknowledged"); assert.equal(reviewOf(db).acknowledgedBy, "u_owner"); assert.equal(reviewOf(db).resolution, "reconciled_unauthorized", "the flag evidence is kept");
  assert.equal(dec(stored(db)).state, "present");
  assert.equal((await w.acknowledgeFlaggedVersion({ headers: {} }, { tenantId: T, bizId: B, versionId: A, intentDigest: digest, operationId: A })).status, "already_acknowledged");
});

test("RV-W06 lost acknowledgement of the REVIEW transition is resolved by full-payload readback (the write landed ⇒ resolved, not unknown)", async () => {
  const db = world(); const w = writerFor(db);
  let n = 0;
  hook(db, (p) => p === NODE, (r) => ({ transaction: async (fn, ...a) => { n++; const out = await r.transaction(fn, ...a); if (n === 2) throw new Error("disconnected after commit"); return out; }, get: r.get }));
  const res = await w.saveCostVersion({ headers: {} }, { tenantId: T, bizId: B, body: body() });
  assert.equal(res.review, "cleared"); assert.equal(reviewOf(db).state, "cleared");
});

test("RV-W07 lost acknowledgement of the VERSION commit: readback finds the version (and its pending review) and the post-commit resolution still runs", async () => {
  const db = world(); const w = writerFor(db);
  let n = 0;
  hook(db, (p) => p === NODE, (r) => ({ transaction: async (fn, ...a) => { n++; const out = await r.transaction(fn, ...a); if (n === 1) throw new Error("ack lost"); return out; }, get: r.get }));
  const res = await w.saveCostVersion({ headers: {} }, { tenantId: T, bizId: B, body: body() });
  assert.equal(res.uncertain, true); assert.equal(res.resolvedBy, "readback"); assert.equal(res.status, "committed_current");
  assert.equal(res.review, "cleared", "the readback carried the pending review into the normal resolution");
  assert.equal(dec(stored(db)).state, "present");
});

test("RV-W08 versions and head are immutable through every review transition; a resolution changes ONLY its own entry", async () => {
  const db = world(); const w = writerFor(db); revokeAfterCommit(db);
  await w.saveCostVersion({ headers: {} }, { tenantId: T, bizId: B, body: body() });
  const before = JSON.parse(JSON.stringify(stored(db)));
  globalThis.__CLAIMS = { uid: "u_owner", email: "o@x" };
  await w.acknowledgeFlaggedVersion({ headers: {} }, { tenantId: T, bizId: B, versionId: A, intentDigest: before.review[A].intentDigest, operationId: A });
  const after = stored(db);
  assert.deepEqual(after.versions, before.versions); assert.deepEqual(after.head, before.head);
  assert.deepEqual(Object.keys(after.review), [A]);
  assert.equal(JSON.stringify({ ...after.review[A], state: "flagged", acknowledgedAt: undefined, acknowledgedBy: undefined, acceptOperationId: undefined }), JSON.stringify({ ...before.review[A], acknowledgedAt: undefined, acknowledgedBy: undefined }));
});

test("RV-W09 an acknowledgement / clearance can never target a CLEARED or a different version, and a flagged review cannot be cleared", async () => {
  const db = world(); const w = writerFor(db);
  await w.saveCostVersion({ headers: {} }, { tenantId: T, bizId: B, body: body() });           // cleared
  globalThis.__CLAIMS = { uid: "u_owner", email: "o@x" };
  const d = reviewOf(db).intentDigest;
  assert.equal((await w.acknowledgeFlaggedVersion({ headers: {} }, { tenantId: T, bizId: B, versionId: A, intentDigest: d, operationId: A })).status, "review_already_resolved:cleared");
  assert.equal((await w.acknowledgeFlaggedVersion({ headers: {} }, { tenantId: T, bizId: B, versionId: Bv, intentDigest: d, operationId: A })).status, "not_found");
  const db2 = world(); const w2 = writerFor(db2); revokeAfterCommit(db2);
  await w2.saveCostVersion({ headers: {} }, { tenantId: T, bizId: B, body: body() });          // flagged
  db2.seed(`tenants/${T}/members/u_mgr`, true);
  assert.deepEqual((await w2.reconcilePendingReviews({ tenantId: T, bizId: B })).results, [], "reconciliation never touches a flagged entry");
  assert.equal(reviewOf(db2).state, "flagged");
});

// ── pins / layout ────────────────────────────────────────────────────────────────────────────────
test("RV-G01 the Storage V2 canary's approved Rules pin is the reviewed F1 Rules candidate (one identity, pending Codex review)", () => {
  assert.equal(APPROVED_RULES_BLOB, F1_RULES_CANDIDATE_BLOB);
  const src = readFileSync(join(REPO, "test/support/canary-fixtures.mjs"), "utf8");
  assert.match(src, /1e5dea2f9b1eac037c766b325b927c20285c0eec/, "the previous identity is recorded");
  assert.match(src, /pending independent Codex review/);
});

test("RV-G02 no runtime source addresses an alternate cost-history layout (cost_versions / cost_head / a non-biz cost_history key)", () => {
  for (const f of ["src/finance/costHistory.ts", "src/finance-server/canonicalInputs.ts", "src/policy/productFinance.ts", "lib/finance/costHistoryWriter.js", "index.html"]) {
    const s = readFileSync(join(REPO, f), "utf8");
    assert.doesNotMatch(s, /cost_versions|cost_head/, f);
    for (const m of s.matchAll(/[`'"]([^`'"\n]*cost_history[^`'"\n]*)[`'"]/g)) {
      if (!/[\/:]/.test(m[1]) || /^\^biz|cost_history\$|^MARJIN_/.test(m[1])) continue;   // only PATH-like literals are layouts
      if (/^tenants\/\$\{[a-zA-Z]+\}\/audit\/cost_history_(intents|flags)\//.test(m[1])) continue;   // audit evidence (not a history layout)
      assert.match(m[1], /(biz:\$\{[a-zA-Z]+\}|\$\{base\}):cost_history$/, f + ": " + m[1]);
    }
  }
});
