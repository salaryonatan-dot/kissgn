// Core/F1 R4 guard layer — NEGATIVE CONTROLS over disposable copies of the REAL writer / core / page.
// Each control mutates exactly one anchored statement (the anchor must exist exactly once, so a silently
// changed anchor is itself a failure) and shows that the mutant violates the exact assertion a committed R4
// test makes (f1-r4-review-lifecycle, f1-r4-page-binding, f1-r4-canonical). The fourteen controls:
//   R4M-01 cleared → acknowledged (stored state)            R4M-08 tenant binding of the audits
//   R4M-02 accepted → acknowledged (decision)               R4M-09 business binding of the audits
//   R4M-03 business-registry enforcement                    R4M-10 version / entry binding of the audits
//   R4M-04 role refresh before the transaction              R4M-11 tenantless browser fail-closed (page seam)
//   R4M-05 post-commit authorization                        R4M-12 rejected activation withholding
//   R4M-06 payload digest coverage                          R4M-13 owner-only re-activation
//   R4M-07 operationId binding / type                       R4M-14 unknown-outcome readback comparison
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { makeDb } from "../../tools/storage-v2/reader-sandbox.mjs";
import { loadWriter } from "../support/f1-writer-harness.mjs";
import { loadCommitted, REPO } from "../support/fincore-load.mjs";
import { loadSeam } from "../support/c1-seam.mjs";
import { reviewEntry } from "../support/f1-history-fixtures.mjs";

const F = await loadCommitted();
const codec = F.costHistory.codec;
const WRITER = "lib/finance/costHistoryWriter.js", CORE = "fincore/v1/finance/costHistory.js";
const T = "tenantA", B = "bizA", GHOST = "bizGhost";
const NODE = `tenants/${T}/biz:${B}:cost_history`, REGISTRY = `tenants/${T}/app/business`;
const NOW = Date.parse("2026-10-02T09:00:00Z");
const A = "00000000-0000-4000-8000-0000000000a1", A2 = "00000000-0000-4000-8000-0000000000a2", OP = "00000000-0000-4000-8000-0000000000aa";
const req = { headers: {} }, scope = { tenantId: T, bizId: B };
const clone = (x) => JSON.parse(JSON.stringify(x));
const actor = (uid) => { globalThis.__CLAIMS = { uid, email: uid + "@x" }; };
const body = (versionId = A, expectedHead = null) => ({ versionId, expectedHead, effectiveFrom: "2026-10-02", basis: "recorded", globalEmployees: [], fixedItems: [{ itemKey: "f1", monthlyAmount: "3100" }], rent: { mode: "none" }, royalty: { mode: "none" } });
function world() {
  const db = makeDb();
  for (const [uid, role, biz] of [["manager", "manager", B], ["owner", "owner", null]]) { db.seed(`tenants/${T}/members/${uid}`, true); db.seed(`tenants/${T}/roles/${uid}`, role); if (biz) db.seed(`tenants/${T}/biz_access/${biz}/${uid}`, true); }
  db.seed(REGISTRY, { _v: JSON.stringify([{ id: B }]) });
  globalThis.__DB = db; actor("owner");
  return db;
}
let tick = NOW;
const writerOf = (W, db, hooks = {}) => W.createCostHistoryWriter({ db, clock: () => (tick += 1000), hooks });
/** A disposable copy with ONE mutation: the real writer module and the (possibly mutated) core it imports. */
async function mutant(mutations) {
  const W = await loadWriter(REPO, { mutations });
  const core = await loadWriter(REPO, { mutations, entry: CORE });
  return { W, core, codec: core.costHistoryCodec };
}
/** The manager's version commits; the manager's membership is removed right after the version transaction ⇒ flagged. */
async function flaggedByManager(W, db, versionId = A, expectedHead = null) {
  actor("manager");
  const orig = db.ref; let txns = 0;
  db.ref = (p, q) => { const r = orig(p, q); return p !== NODE ? r : { ...r, transaction: async (...a) => { const o = await r.transaction(...a); if (++txns === 1) db.seed(`tenants/${T}/members/manager`, false); return o; } }; };
  const wr = writerOf(W, db);
  const out = expectedHead ? await wr.recordCostEdit(req, { ...scope, body: body(versionId, expectedHead) }) : await wr.saveCostVersion(req, { ...scope, body: body(versionId) });
  db.ref = orig; db.seed(`tenants/${T}/members/manager`, true); actor("owner");
  assert.equal(out.review, "flagged", "precondition: flagged " + JSON.stringify(out));
  return clone(db.read(NODE));
}
const downgradeOwner = (db) => { db.seed(`tenants/${T}/roles/owner`, "manager"); db.seed(`tenants/${T}/biz_access/${B}/owner`, true); };

test("R4M-01 cleared → acknowledged: a writer that stores `acknowledged` on acceptance cannot produce the stored `cleared` + accepted record (RL4-C01), and the strict reader refuses the stored state", async () => {
  const { W } = await mutant([[WRITER, 'export const DECISION_STATES = Object.freeze({ accepted: "cleared", rejected: "rejected" });', 'export const DECISION_STATES = Object.freeze({ accepted: "acknowledged", rejected: "rejected" });']]);
  const db = world(); const before = await flaggedByManager(W, db);
  const r = await writerOf(W, db).acceptFlaggedVersion(req, { ...scope, versionId: A, intentDigest: before.review[A].intentDigest, operationId: OP });
  assert.notDeepEqual(r, { status: "resolved", state: "cleared", decision: "accepted" }, "the mutant cannot satisfy RL4-C01");
  assert.notEqual(db.read(NODE).review[A].state, "cleared");
  // a core that admits the fifth state is caught by RL4-C04 (an `acknowledged` entry must be unreadable)
  const { codec: mutantCodec } = await mutant([[CORE, 'export const COST_REVIEW_STATES = Object.freeze(["pending", "cleared", "flagged", "rejected"]);', 'export const COST_REVIEW_STATES = Object.freeze(["pending", "cleared", "flagged", "rejected", "acknowledged"]);']]);
  const node = clone(before); node.review[A] = { ...reviewEntry(node.versions[A], "accepted"), state: "acknowledged" };
  assert.equal(codec.decodeHistoryStructure({ exists: true, value: node }, scope).detail.error, "review_state_invalid", "the committed core refuses it");
  assert.notEqual(mutantCodec.decodeHistoryStructure({ exists: true, value: node }, scope).detail?.error, "review_state_invalid", "the mutant core no longer refuses the state by name — RL4-C04 fails on it");
});

test("R4M-02 accepted → acknowledged: a decision audit that says `acknowledged` is refused by the writer's own contract and by the reader (RL4-C01 / RL4-A01)", async () => {
  const { W } = await mutant([[WRITER, 'const acceptFlaggedVersion = (req, args) => ownerDecision(req, args, "accepted");', 'const acceptFlaggedVersion = (req, args) => ownerDecision(req, args, "acknowledged");']]);
  const db = world(); const before = await flaggedByManager(W, db);
  const r = await writerOf(W, db).acceptFlaggedVersion(req, { ...scope, versionId: A, intentDigest: before.review[A].intentDigest, operationId: OP });
  assert.equal(r.status, "request_shape", "an unknown decision never reaches the transaction"); assert.deepEqual(db.read(NODE), before);
  const node = clone(before); node.review[A] = reviewEntry(node.versions[A], "accepted"); node.review[A].decision = "acknowledged"; node.review[A].decisionAudit.decision = "acknowledged";
  assert.equal(codec.decodeHistory({ exists: true, value: node }, scope).state, "unreadable", "RL4-A01: a stored `acknowledged` decision is unreadable");
});

test("R4M-03 business-registry enforcement: without the registry check an unregistered (ghost) business is operated on — RL4-T02 / RL4-B01 fail on the mutant", async () => {
  // M1 R1: the Core registry decision is the shared predicate (lib/businessRegistry.js); the control removes the same enforcement
  const { W } = await mutant([[WRITER, '  if (t.state === "not_registered") throw { status: 403, msg: "business_not_in_tenant" };', '  if (t.state === "not_registered") return true;']]);
  const db = world(); db.seed(`tenants/${T}/biz_access/${GHOST}/manager`, true);
  const out = await writerOf(W, db).activateCostHistory(req, { tenantId: T, bizId: GHOST, body: body(A) });
  assert.equal(out.status, "committed_current", "the mutant activates a ghost business");
  assert.notEqual(db.read(`tenants/${T}/biz:${GHOST}:cost_history`), null);
  const db2 = world(); db2.seed(REGISTRY, { _v: "[]" });
  assert.notEqual((await writerOf(W, db2).activateCostHistory(req, { ...scope, body: body(A) })).status, "business_not_in_tenant", "RL4-B01 fails on the mutant");
});

test("R4M-04 role refresh: without the fresh pre-commit authorization a registry removal / role loss during priming still commits — RL4-B02 fails on the mutant", async () => {
  const { W } = await mutant([[WRITER, '    const fresh = await authorizeOperation(req, { tenantId, bizId, requiredRole, expectUid: ctx.uid });\n    if (!fresh.ok) return { status: fresh.status, http: fresh.http };', '    const fresh = { ok: true };\n    if (!fresh.ok) return { status: fresh.status, http: fresh.http };']]);
  for (const [label, during] of [["registry removed during priming", (db) => db.seed(REGISTRY, { _v: "[]" })], ["owner downgraded during priming", downgradeOwner]]) {
    const db = world(); const orig = db.ref; let gets = 0;
    db.ref = (p, q) => { const r = orig(p, q); return p !== NODE ? r : { ...r, get: async () => { const s = await r.get(); if (++gets === 1) during(db); return s; } }; };
    const out = await writerOf(W, db).activateCostHistory(req, { ...scope, body: body(A) });
    db.ref = orig;
    assert.equal(out.status, "committed_current", label + ": the mutant commits (RL4-B02 expects a denial before the transaction)");
    assert.notEqual(db.read(NODE), null);
  }
});

test("R4M-05 post-commit authorization: without the post-check an in-window loss CLEARS the version — RL4-B03 / RL4-B04 fail on the mutant", async () => {
  const { W } = await mutant([[WRITER, '      const post = await authorizeOperation(req, { tenantId, bizId, requiredRole, expectUid: r.uid });', '      const post = { ok: true };']]);
  const db = world();
  const out = await writerOf(W, db, { afterAuth: async () => downgradeOwner(db) }).activateCostHistory(req, { ...scope, body: body(A) });
  assert.equal(out.review, "cleared", "the mutant clears a version whose owner was downgraded before the transaction");
  assert.equal(codec.decodeHistory({ exists: true, value: db.read(NODE) }, scope).state, "present", "…and it is authoritative: exactly what RL4-B03 forbids");
});

test("R4M-06 payload digest coverage: an intent that omits the fixed items leaves an amount change undetected — RL4-A01 (amount_changed) and RL4-A04 fail on the mutant", async () => {
  const { W, codec: mutantCodec, core } = await mutant([[CORE, '        if (k !== "recordedAt")\n            version[k] = wire[k];', '        if (k !== "recordedAt" && k !== "fixedItems")\n            version[k] = wire[k];']]);
  const db = world();
  assert.equal((await writerOf(W, db).activateCostHistory(req, { ...scope, body: body(A) })).review, "cleared");
  const node = clone(db.read(NODE)); node.versions[A].fixedItems[0].monthlyAmount = "9999";
  assert.equal(mutantCodec.decodeHistory({ exists: true, value: node }, scope).state, "present", "the mutant reader accepts a changed amount");
  assert.equal(core.intentDigestOf(T, B, node.versions[A]), core.intentDigestOf(T, B, db.read(NODE).versions[A]), "the mutant digest ignores the amount");
  assert.equal(codec.decodeHistory({ exists: true, value: node }, scope).state, "unreadable", "the committed core refuses it");
});

test("R4M-07 operationId binding / type: a reader that accepts a non-string operation id, or a writer that accepts a numeric one, is caught (RL4-O01 / RL4-O02)", async () => {
  const { codec: mutantCodec } = await mutant([[CORE, '        if (typeof a.operationId !== "string" || !UUID4.test(a.operationId))\n            return "decision_audit_operation_invalid";', '        if (false)\n            return "decision_audit_operation_invalid";']]);
  const db = world(); assert.equal((await writerOf((await mutant([])).W, db).activateCostHistory(req, { ...scope, body: body(A) })).review, "cleared");
  const node = clone(db.read(NODE)); node.review[A] = reviewEntry(node.versions[A], "accepted"); node.review[A].decisionAudit.operationId = 123456;
  assert.equal(mutantCodec.decodeHistory({ exists: true, value: node }, scope).state, "present", "the mutant reader trusts a numeric operation id");
  assert.equal(codec.decodeHistory({ exists: true, value: node }, scope).state, "unreadable");
  const { W } = await mutant([[WRITER, 'const isOperationId = (x) => typeof x === "string" && UUID4.test(x);', 'const isOperationId = (x) => x !== undefined && x !== null;']]);
  const db2 = world(); const before = await flaggedByManager(W, db2);
  const r = await writerOf(W, db2).acceptFlaggedVersion(req, { ...scope, versionId: A, intentDigest: before.review[A].intentDigest, operationId: 12345 });
  assert.notEqual(r.status, "request_shape", "the mutant writer no longer refuses a numeric operation id before reading");
});

test("R4M-08 tenant binding: an audit naming another tenant is accepted by the mutant reader — RL4-A01 (wrong tenant) / RL4-A03 fail", async () => {
  const { codec: mutantCodec } = await mutant([[CORE, '        if (a.tenantId !== bind.tenantId || a.bizId !== bind.bizId)\n            return "flag_audit_binding_mismatch";', '        if (a.bizId !== bind.bizId)\n            return "flag_audit_binding_mismatch";']]);
  const node = flaggedNode(); node.review[A].flagAudit.tenantId = "tenantZ";
  node.review[A].flagAudit.operationId = F.costHistory.flagOperationIdOf({ tenantId: "tenantZ", bizId: B, versionId: A, intentDigest: node.review[A].intentDigest, outcome: node.review[A].resolution });
  assert.equal(mutantCodec.decodeHistoryStructure({ exists: true, value: node }, scope).state, "present", "the mutant accepts a foreign-tenant flag audit (identity recomputed for that tenant)");
  assert.equal(codec.decodeHistoryStructure({ exists: true, value: node }, scope).detail.error, "flag_audit_binding_mismatch");
});

test("R4M-09 business binding: an audit naming another business is accepted by the mutant reader — RL4-A01 (wrong business) / RL4-A03 fail", async () => {
  const { codec: mutantCodec } = await mutant([[CORE, '        if (a.tenantId !== bind.tenantId || a.bizId !== bind.bizId)\n            return "decision_audit_binding_mismatch";', '        if (a.tenantId !== bind.tenantId)\n            return "decision_audit_binding_mismatch";']]);
  const node = flaggedNode(); node.review[A] = reviewEntry(node.versions[A], "accepted"); node.review[A].decisionAudit.bizId = "bizB";
  assert.equal(mutantCodec.decodeHistory({ exists: true, value: node }, scope).state, "present", "the mutant accepts a decision audit of another business");
  assert.equal(codec.decodeHistoryStructure({ exists: true, value: node }, scope).detail.error, "decision_audit_binding_mismatch");
});

test("R4M-10 version / entry binding: an audit naming another version is accepted by the mutant reader — RL4-A01 (wrong version) / RL4-A03 fail", async () => {
  const { codec: mutantCodec } = await mutant([[CORE, '        if (a.versionId !== key || a.intentDigest !== e.intentDigest || a.recordedBy !== v.recordedBy || a.recordedAt !== v.recordedAt)', '        if (a.intentDigest !== e.intentDigest || a.recordedBy !== v.recordedBy || a.recordedAt !== v.recordedAt)']]);
  const node = flaggedNode(); node.review[A].flagAudit.versionId = A2;
  assert.equal(mutantCodec.decodeHistoryStructure({ exists: true, value: node }, scope).state, "present", "the mutant accepts a flag audit naming another version");
  assert.equal(codec.decodeHistoryStructure({ exists: true, value: node }, scope).detail.error, "flag_audit_invalid");
  // the review's own digest binding (an entry re-pointed at another version)
  const { codec: mutantCodec2 } = await mutant([[CORE, '        if (!isObj(rawVersion) || e.intentDigest !== intentDigestOf(bind.tenantId, bind.bizId, rawVersion))\n            return { error: "review_digest_mismatch" };', '        if (!isObj(rawVersion))\n            return { error: "review_digest_mismatch" };']]);
  const two = clearedNode(); two.head = { revision: 2, headVersionId: A2 }; two.versions[A2] = { ...two.versions[A], versionId: A2, predecessorVersionId: A, recordedAt: two.versions[A].recordedAt + 1 };
  two.review[A2] = { ...clone(two.review[A]), committedAt: two.versions[A2].recordedAt, resolvedAt: two.versions[A2].recordedAt };   // re-pointed entry; only the digest still binds it to A
  assert.equal(mutantCodec2.decodeHistory({ exists: true, value: two }, scope).state, "present", "the mutant lets version A's review validate version A2");
  assert.equal(codec.decodeHistoryStructure({ exists: true, value: two }, scope).detail.error, "review_digest_mismatch");
});

test("R4M-11 tenantless browser fail-closed: a page seam that binds without a verified tenant decodes for an unbound selection — PB-02 fails on the mutant", () => {
  const html = readFileSync(join(REPO, "index.html"), "utf8");
  const anchor = '      if (!bound) return { ok: false, reason: "context_unbound" };';
  assert.equal(html.split(anchor).length - 1, 1, "anchor unique");
  const mutantSeam = loadSeam(html.replace(anchor, '      if (false) return { ok: false, reason: "context_unbound" };'));
  const sel = { tenantId: null, bizId: B, gen: 1 }, raw = { tenantId: null, bizId: B, gen: 1 };
  assert.deepEqual(clone(loadSeam(html).historyBinding(raw, sel, B, [{ id: B }])), { ok: false, reason: "context_unbound" }, "the committed seam is unbound");
  const m = clone(mutantSeam.historyBinding(raw, sel, B, [{ id: B }]));
  assert.notDeepEqual(m, { ok: false, reason: "context_unbound" }, "the mutant no longer reports context_unbound (PB-02 fails on it)");
  // a seam that skips the registry check
  const anchor2 = '      if (!registered) return { ok: false, reason: "business_unregistered" };';
  assert.equal(html.split(anchor2).length - 1, 1);
  const m2 = clone(loadSeam(html.replace(anchor2, '      if (false) return { ok: false, reason: "business_unregistered" };')).historyBinding({ tenantId: T, bizId: B, gen: 1 }, { tenantId: T, bizId: B, gen: 1 }, B, []));
  assert.equal(m2.ok, true, "the mutant binds an unregistered business (PB-04 fails on it)");
});

test("R4M-12 rejected activation withholding: a core that counts rejected versions as effective shows figures for a rejected activation — RL4-C03 / PB-05 fail on the mutant", async () => {
  const { codec: mutantCodec } = await mutant([[CORE, '        const effectiveVersions = chain.filter((v) => review[v.versionId].state !== "rejected");', '        const effectiveVersions = chain;']]);
  const node = clearedNode(); node.review[A] = reviewEntry(node.versions[A], "rejected");
  assert.deepEqual(codec.decodeHistory({ exists: true, value: node }, scope).versions, [], "committed: no effective version");
  assert.equal(mutantCodec.decodeHistory({ exists: true, value: node }, scope).versions.length, 1, "the mutant treats the rejected activation as effective");
});

test("R4M-13 owner-only re-activation: without the exact-role requirement a manager (re-)activates, and reconciliation clears a downgraded owner's pending activation — RL4-C03 / RL4-B06 fail on the mutant", async () => {
  const { W } = await mutant([[WRITER, '    return saveCostVersion(req, { tenantId, bizId, body, requiredRole: "owner", command: "activate" });', '    return saveCostVersion(req, { tenantId, bizId, body, requiredRole: null, command: "activate" });']]);
  const db = world(); actor("manager");
  assert.equal((await writerOf(W, db).activateCostHistory(req, { ...scope, body: body(A) })).status, "committed_current", "the mutant lets a manager activate (RL4-C03 expects role_not_allowed)");
  const { W: W2 } = await mutant([[WRITER, '      const requiredRole = isActivationVersion(h, versionId) ? "owner" : null;', '      const requiredRole = null;']]);
  const db2 = world(); actor("owner");
  const orig = db2.ref; let gets = 0;
  db2.ref = (p, q) => { const r = orig(p, q); return p !== REGISTRY ? r : { ...r, get: async () => { if (++gets === 3) throw new Error("unavailable"); return r.get(); } }; };
  const out = await writerOf(W2, db2).activateCostHistory(req, { ...scope, body: body(A) });
  db2.ref = orig; assert.equal(out.review, "pending");
  downgradeOwner(db2);
  const r = await writerOf(W2, db2).reconcilePendingReviews({ ...scope, authorize: async () => {} });
  assert.equal(r.results[0].state, "cleared", "the mutant clears a pending ACTIVATION for an actor who is no longer an owner (RL4-B06 expects flagged)");
});

test("R4M-14 unknown-outcome readback comparison: a readback that compares only the state resolves an altered stored decision — RL4-R01 fails on the mutant", async () => {
  const { W } = await mutant([[WRITER, '    if (entry.state === to && intended && stable(entry) === stable(intended)) return { status: "resolved", state: to,', '    if (entry.state === to && intended) return { status: "resolved", state: to,']]);
  const db = world(); const before = await flaggedByManager(W, db);
  const orig = db.ref;
  db.ref = (p, q) => { const r = orig(p, q); return p !== NODE ? r : { ...r, transaction: async (...a) => { await r.transaction(...a); const cur = db.read(NODE); cur.review[A].decisionAudit.decidedBy = "intruder"; db.seed(NODE, cur); throw new Error("ack lost"); } }; };
  const out = await writerOf(W, db).acceptFlaggedVersion(req, { ...scope, versionId: A, intentDigest: before.review[A].intentDigest, operationId: OP });
  db.ref = orig;
  assert.equal(out.status, "resolved", "the mutant reports a foreign-actor decision as resolved (RL4-R01 expects outcome_unknown)");
});

// ── fixtures for the reader controls ──────────────────────────────────────────────────────────────
function clearedNode() {
  const v = { versionId: A, schema: "MARJIN_COSTV/1", effectiveFrom: "2026-10-02", recordedAt: NOW, recordedBy: "owner", basis: "recorded", globalEmployeesCount: 0, fixedItemsCount: 1, rent: { mode: "none" }, royalty: { mode: "none" }, predecessorVersionId: "none", fixedItems: [{ itemKey: "f1", monthlyAmount: "3100" }] };
  const node = { head: { revision: 1, headVersionId: A }, versions: { [A]: v }, review: { [A]: reviewEntry(v, "cleared") } };
  assert.equal(codec.decodeHistory({ exists: true, value: node }, scope).state, "present", "fixture valid");
  return node;
}
function flaggedNode() { const node = clearedNode(); node.review[A] = reviewEntry(node.versions[A], "flagged"); assert.equal(codec.decodeHistoryStructure({ exists: true, value: node }, scope).state, "present"); return node; }
