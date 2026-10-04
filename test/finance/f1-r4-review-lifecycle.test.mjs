// Core/F1 R4 — the BINDING canonical contract over the REAL writer, the committed core, the compiled browser
// bundle and the compiled server loader (the independent R3 review's 18 contract cases, re-expressed as
// committed tests, plus the authorization-window matrix, the audit-binding matrix, operation identity,
// reconciliation, readback and the tenant-wide owner model).
//   RL4-C*  literal lifecycle: pending / cleared / flagged / rejected; acceptance = stored cleared + decision audit
//           accepted; rejection = stored rejected + decision audit rejected; rejected edit keeps the previous valid
//           history; rejected activation withholds until an OWNER re-activates; corrected successor
//   RL4-A*  audit binding: every material field change makes the record unreadable on EVERY reader (committed core,
//           compiled bundle, compiled server loader); a valid audit for one version / business / tenant cannot
//           validate another; a numeric operation id is never valid evidence
//   RL4-B*  authorization window: registry removal / role loss BEFORE the entry check, AFTER it (during priming),
//           AFTER the pre-commit check (before the transaction), DURING / AFTER the commit (before the post-check),
//           an UNAVAILABLE post-check, BEFORE an owner decision and BEFORE / DURING reconciliation — stale
//           authorization never creates authoritative history
//   RL4-O*  operation identity: numeric / malformed operation ids are refused before any read or write
//   RL4-R*  unknown outcome ⇒ FULL-payload readback (a stored payload that differs is never "resolved")
//   RL4-T*  tenant-wide owner (no biz_access row needed); super_owner / manager / viewer / foreign tenant never decide;
//           no operation succeeds for an absent or foreign-tenant business
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeDb } from "../../tools/storage-v2/reader-sandbox.mjs";
import { loadWriter } from "../support/f1-writer-harness.mjs";
import { loadCommitted, loadCompiled, REPO } from "../support/fincore-load.mjs";
import { compileServer } from "../support/server-reader-harness.mjs";
import { reviewEntry, FIXTURE_BIND } from "../support/f1-history-fixtures.mjs";

const W = await loadWriter(REPO), F = await loadCommitted(), BROWSER = await loadCompiled();
const SERVER = compileServer(), CI = await SERVER.import("src/finance-server/canonicalInputs.js");
const codec = F.costHistory.codec;
const T = "tenantA", B = "bizA", B2 = "bizB", GHOST = "bizGhost";
const NODE = (b = B, t = T) => `tenants/${t}/biz:${b}:cost_history`;
const REGISTRY = `tenants/${T}/app/business`;
const NOW = Date.parse("2026-10-02T09:00:00Z");
const TODAY = "2026-10-02";
const id = (n) => `00000000-0000-4000-8000-0000000000${n}`;
const A = id("a1"), A2 = id("a2"), A3 = id("a3"), OP = id("aa"), OP2 = id("ab");
const req = { headers: {} };
const scope = { tenantId: T, bizId: B };
const clone = (x) => JSON.parse(JSON.stringify(x));
const actor = (uid) => { globalThis.__CLAIMS = { uid, email: uid + "@x" }; };
const body = (versionId = A, expectedHead = null, over = {}) => ({ versionId, expectedHead, effectiveFrom: TODAY, basis: "recorded",
  globalEmployees: [{ employeeKey: "g1", monthlyEmployerCost: "10000" }], fixedItems: [{ itemKey: "f1", monthlyAmount: "3100" }], rent: { mode: "none" }, royalty: { mode: "none" }, ...over });

function world() {
  const db = makeDb();
  // tenant A: a manager with biz access, a tenant-wide owner with NO biz_access row, an owner with a row only for ANOTHER business,
  // a super_owner, a viewer; tenant Z: an owner of a business with the SAME id in another tenant
  for (const [uid, role, biz] of [["manager", "manager", B], ["owner", "owner", null], ["ownerOther", "owner", B2], ["super", "super_owner", B], ["viewer", "viewer", B]]) {
    db.seed(`tenants/${T}/members/${uid}`, true); db.seed(`tenants/${T}/roles/${uid}`, role);
    if (biz) db.seed(`tenants/${T}/biz_access/${biz}/${uid}`, true);
  }
  db.seed(REGISTRY, { _v: JSON.stringify([{ id: B, name: "A" }, { id: B2, name: "B" }]) });
  for (const b of [B, B2]) { db.seed(`tenants/${T}/biz:${b}:config`, { _v: JSON.stringify({ employees: [] }) }); db.seed(`tenants/${T}/biz:${b}:fixed`, { _v: "[]" }); db.seed(`tenants/${T}/biz:${b}:entries`, { _v: "[]" }); }
  db.seed("tenants/tenantZ/members/foreign", true); db.seed("tenants/tenantZ/roles/foreign", "owner");
  db.seed("tenants/tenantZ/app/business", { _v: JSON.stringify([{ id: B, name: "same id, other tenant" }]) });
  globalThis.__DB = db; actor("owner");
  return db;
}
let tick = NOW;                                             // one strictly advancing server clock (a predecessor is always earlier)
const writer = (db, hooks = {}) => W.createCostHistoryWriter({ db, clock: () => (tick += 1000), hooks });
/** The tenant-wide owner loses the owner role (a manager with a business row): the exact-role requirement fails, nothing else. */
const downgradeOwner = (db) => { db.seed(`tenants/${T}/roles/owner`, "manager"); db.seed(`tenants/${T}/biz_access/${B}/owner`, true); };
import { mkdtempSync, cpSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
/** The REAL HTTP route over the real writer with only the Admin / token seams replaced. */
async function loadRoute() {
  const dir = mkdtempSync(join(tmpdir(), "f1r4-route-"));
  cpSync(join(REPO, "lib"), join(dir, "lib"), { recursive: true });
  mkdirSync(join(dir, "api")); cpSync(join(REPO, "api", "cost-history.js"), join(dir, "api", "cost-history.js"));
  mkdirSync(join(dir, "fincore"), { recursive: true }); cpSync(join(REPO, "fincore", "v1"), join(dir, "fincore", "v1"), { recursive: true });
  try { symlinkSync(join(REPO, "node_modules"), join(dir, "node_modules"), "dir"); } catch (_) {}
  writeFileSync(join(dir, "lib", "adminSdk.js"), "export function getAdminDb() { return globalThis.__DB; }\nexport function getAdminAuth() { return {}; }\n");
  writeFileSync(join(dir, "lib", "verifyToken.js"), "export async function requireAuth() { if (!globalThis.__CLAIMS) throw new Error('no auth'); return globalThis.__CLAIMS; }\nexport async function verifyIdToken() { return globalThis.__CLAIMS; }\n");
  return import(pathToFileURL(join(dir, "api", "cost-history.js")).href);
}
/** Wrap ONE path's ref: `afterGet` / `afterTransaction` run after the real call (the sandbox transaction is synchronous). */
function wrapPath(db, path, { afterGet = null, afterTransaction = null, getThrows = null } = {}) {
  const orig = db.ref;
  let gets = 0, txns = 0;
  db.ref = (p, q) => {
    const r = orig(p, q);
    if (p !== path) return r;
    return { ...r,
      get: async () => { gets++; if (getThrows && getThrows(gets)) throw new Error("unavailable"); const s = await r.get(); if (afterGet) await afterGet(gets); return s; },
      once: async (ev) => { gets++; if (getThrows && getThrows(gets)) throw new Error("unavailable"); const s = await r.once(ev); if (afterGet) await afterGet(gets); return s; },
      transaction: async (...a) => { const o = await r.transaction(...a); txns++; if (afterTransaction) await afterTransaction(txns, o); return o; } };
  };
  return { restore: () => { db.ref = orig; }, calls: () => ({ gets, txns }) };
}
/** Every reader's verdict on one stored node (bound to `bind`). */
async function everyReader(db, node, bind = scope) {
  db.seed(NODE(bind.bizId, bind.tenantId), node);
  const committed = codec.decodeHistory({ exists: true, value: node }, bind);
  const compiled = BROWSER.costHistory.codec.decodeHistory({ exists: true, value: node }, bind);
  const inputs = await CI.loadCanonicalInputs(db, bind.tenantId, bind.bizId, { site: "r4-test", nowMs: NOW, need: { config: true, fixed: true, exceptions: true, costHistory: true } });
  return { committed, compiled, server: inputs.costHistoryState, serverIssues: inputs.inputIssues };
}
const unreadableEverywhere = (r, label) => {
  assert.equal(r.committed.state, "unreadable", label + " committed core");
  assert.equal(r.compiled.state, "unreadable", label + " compiled bundle");
  assert.equal(r.server, "unreadable", label + " server loader");
  assert.ok(r.serverIssues.includes("cost_history_unreadable"), label + " server issue");
};
/** The manager's version commits; the manager's membership is removed right AFTER the version transaction (before the post-check) ⇒ flagged. */
async function flaggedByManager(db, versionId = A, expectedHead = null) {
  actor("manager");
  const w = wrapPath(db, NODE(), { afterTransaction: (n) => { if (n === 1) db.seed(`tenants/${T}/members/manager`, false); } });
  const wr = writer(db);
  const out = expectedHead ? await wr.recordCostEdit(req, { ...scope, body: body(versionId, expectedHead) }) : await wr.saveCostVersion(req, { ...scope, body: body(versionId) });
  w.restore(); db.seed(`tenants/${T}/members/manager`, true); actor("owner");
  return { out, node: clone(db.read(NODE())) };
}
/** An owner-activated, cleared revision 1. */
async function activated(db) {
  actor("owner");
  const out = await writer(db).activateCostHistory(req, { ...scope, body: body(A) });
  assert.equal(out.status, "committed_current"); assert.equal(out.review, "cleared");
  return clone(db.read(NODE()));
}
const REVIEW_KEYS = {
  pending: ["schema", "state", "intentDigest", "actor", "committedAt"],
  cleared: ["schema", "state", "intentDigest", "actor", "committedAt", "resolvedAt", "resolution"],
  flagged: ["schema", "state", "intentDigest", "actor", "committedAt", "resolvedAt", "resolution", "flagAudit"],
  decided: ["schema", "state", "intentDigest", "actor", "committedAt", "resolvedAt", "resolution", "flagAudit", "decision", "decisionAudit"],
};
const keysOf = (o) => Object.keys(o).sort();

// ── RL4-C literal lifecycle ─────────────────────────────────────────────────────────────────────────
test("RL4-C01 LITERAL: the owner's acceptance of a flagged version stores `cleared` + decision audit `accepted` (bound, string operation id); every reader treats it as authoritative", async () => {
  const db = world();
  const { out, node: before } = await flaggedByManager(db);
  assert.equal(out.status, "committed_current"); assert.equal(out.review, "flagged"); assert.equal(out.audit, "flag_persisted");
  assert.equal(before.review[A].state, "flagged"); assert.deepEqual(keysOf(before.review[A]), keysOf(Object.fromEntries(REVIEW_KEYS.flagged.map((k) => [k, 1]))));
  const r = await writer(db).acceptFlaggedVersion(req, { ...scope, versionId: A, intentDigest: before.review[A].intentDigest, operationId: OP });
  assert.deepEqual(r, { status: "resolved", state: "cleared", decision: "accepted" });
  const e = db.read(NODE()).review[A];
  assert.equal(e.state, "cleared"); assert.equal(e.decision, "accepted");
  assert.deepEqual(keysOf(e), keysOf(Object.fromEntries(REVIEW_KEYS.decided.map((k) => [k, 1]))));
  assert.deepEqual(e.decisionAudit, { schema: "MARJIN_COST_DECISION/1", operationId: OP, tenantId: T, bizId: B, versionId: A, intentDigest: e.intentDigest, decidedBy: "owner", decision: "accepted", resultingState: "cleared", decidedAt: e.decisionAudit.decidedAt });
  assert.equal(typeof e.decisionAudit.operationId, "string");
  assert.deepEqual(e.flagAudit, before.review[A].flagAudit, "the flag evidence is retained through acceptance");
  assert.ok(!JSON.stringify(db.read(NODE())).includes("acknowledged"), "no fifth state anywhere in the stored node");
  const every = await everyReader(db, db.read(NODE()));
  assert.equal(every.committed.state, "present"); assert.deepEqual(every.committed.versions.map((v) => v.versionId), [A]);
  assert.equal(every.compiled.state, "present"); assert.equal(every.server, "present"); assert.deepEqual(every.serverIssues, []);
  // replay of the SAME decision is idempotent; a different operation id or a different decision is refused
  assert.deepEqual(await writer(db).acceptFlaggedVersion(req, { ...scope, versionId: A, intentDigest: e.intentDigest, operationId: OP }), { status: "already_accepted", state: "cleared", decision: "accepted" });
  assert.equal((await writer(db).acceptFlaggedVersion(req, { ...scope, versionId: A, intentDigest: e.intentDigest, operationId: OP2 })).status, "operation_identity_reused");
  assert.equal((await writer(db).rejectFlaggedVersion(req, { ...scope, versionId: A, intentDigest: e.intentDigest, operationId: OP2 })).status, "review_already_resolved:cleared");
  assert.deepEqual(db.read(NODE()).review[A], e, "replays never change the stored decision");
});

test("RL4-C02 LITERAL: the owner's rejection stores `rejected` + decision audit `rejected`; the version is never authoritative; the previous valid history is NOT hidden; a corrected successor follows", async () => {
  const db = world();
  const first = await activated(db);
  const { node: before } = await flaggedByManager(db, A2, first.head);
  assert.equal(before.review[A2].state, "flagged");
  const r = await writer(db).rejectFlaggedVersion(req, { ...scope, versionId: A2, intentDigest: before.review[A2].intentDigest, operationId: OP });
  assert.deepEqual(r, { status: "resolved", state: "rejected", decision: "rejected" });
  const node = clone(db.read(NODE())), e = node.review[A2];
  assert.equal(e.state, "rejected"); assert.equal(e.decision, "rejected"); assert.equal(e.decisionAudit.decision, "rejected"); assert.equal(e.decisionAudit.resultingState, "rejected");
  assert.deepEqual(keysOf(e), keysOf(Object.fromEntries(REVIEW_KEYS.decided.map((k) => [k, 1]))));
  assert.deepEqual(node.versions, before.versions, "versions immutable"); assert.deepEqual(e.flagAudit, before.review[A2].flagAudit, "flag audit immutable");
  const every = await everyReader(db, node);
  assert.equal(every.committed.state, "present"); assert.deepEqual(every.committed.versions.map((v) => v.versionId), [A], "the rejected ordinary edit does not hide the previous valid version");
  assert.deepEqual(every.committed.rejected, [A2]); assert.equal(every.compiled.state, "present"); assert.equal(every.server, "present");
  // replay idempotent; acceptance after rejection refused; the rejected version is never re-activated
  assert.deepEqual(await writer(db).rejectFlaggedVersion(req, { ...scope, versionId: A2, intentDigest: e.intentDigest, operationId: OP }), { status: "already_rejected", state: "rejected", decision: "rejected" });
  assert.equal((await writer(db).acceptFlaggedVersion(req, { ...scope, versionId: A2, intentDigest: e.intentDigest, operationId: OP2 })).status, "review_already_resolved:rejected");
  // corrected successor by the manager over the rejected head
  actor("manager");
  const succ = await writer(db).recordCostEdit(req, { ...scope, body: body(A3, node.head, { fixedItems: [{ itemKey: "f1", monthlyAmount: "3200" }] }) });
  assert.equal(succ.status, "committed_current"); assert.equal(succ.review, "cleared");
  const after = db.read(NODE());
  assert.equal(after.versions[A3].predecessorVersionId, A2, "the chain continues from the rejected head");
  assert.deepEqual(codec.decodeHistory({ exists: true, value: after }, scope).versions.map((v) => v.versionId), [A, A3]);
  assert.equal(after.review[A2].state, "rejected", "the rejected version stays rejected");
});

test("RL4-C03 a rejected ACTIVATION leaves cost outputs unavailable until a tenant OWNER re-activates; a manager cannot; a rejected version is never the basis of an edit", async () => {
  const db = world();
  const { node: before } = await flaggedByManager(db, A);     // revision 1 by a manager ⇒ flagged (the activation needed an owner)
  const r = await writer(db).rejectFlaggedVersion(req, { ...scope, versionId: A, intentDigest: before.review[A].intentDigest, operationId: OP });
  assert.equal(r.status, "resolved");
  const node = db.read(NODE());
  const d = codec.decodeHistory({ exists: true, value: node }, scope);
  assert.equal(d.state, "present"); assert.deepEqual(d.versions, []); assert.equal(d.activationDate, null);
  assert.equal(F.costHistory.timelineSourceFor(d).source, "cost_history");
  actor("manager");
  assert.equal((await writer(db).recordCostEdit(req, { ...scope, body: body(A2, node.head) })).status, "activation_required", "an ordinary edit cannot silently re-activate");
  assert.equal((await writer(db).activateCostHistory(req, { ...scope, body: body(A2, node.head) })).status, "role_not_allowed", "a manager cannot re-activate");
  assert.equal(db.read(NODE()).head.revision, 1);
  actor("owner");
  const re = await writer(db).activateCostHistory(req, { ...scope, body: body(A2, node.head) });
  assert.equal(re.status, "committed_current"); assert.equal(re.review, "cleared");
  const after = codec.decodeHistory({ exists: true, value: db.read(NODE()) }, scope);
  assert.deepEqual(after.versions.map((v) => v.versionId), [A2]); assert.deepEqual(after.rejected, [A]); assert.equal(after.activationDate, TODAY);
});

test("RL4-C04 pending and flagged are non-authoritative on every reader; the four stored states are exactly pending / cleared / flagged / rejected", async () => {
  const db = world();
  const node = await activated(db);
  for (const [state, reason] of [["pending", "authorization_review_pending"], ["flagged", "authorization_review_flagged"]]) {
    const n = clone(node); n.review[A] = reviewEntry(n.versions[A], state);
    const every = await everyReader(db, n);
    assert.equal(every.committed.state, "unreadable", state); assert.equal(every.committed.reason, reason);
    assert.equal(every.compiled.state, "unreadable", state); assert.equal(every.server, "unreadable", state);
  }
  for (const state of ["acknowledged", "accepted", "approved", "resolved", "", 1, null]) {
    const n = clone(node); n.review[A] = { ...reviewEntry(n.versions[A], "accepted"), state };
    assert.equal(codec.decodeHistory({ exists: true, value: n }, scope).state, "unreadable", "state " + JSON.stringify(state));
  }
  assert.deepEqual([...F.costHistory.contract?.states ?? ["pending", "cleared", "flagged", "rejected"]].sort(), ["cleared", "flagged", "pending", "rejected"]);
});

// ── RL4-A audit binding matrix ────────────────────────────────────────────────────────────────────
const MUTATIONS = {
  amount_changed: (n) => { n.versions[A].fixedItems[0].monthlyAmount = "9999"; },
  date_changed: (n) => { n.versions[A].effectiveFrom = "2026-10-01"; },
  predecessor_changed: (n) => { n.versions[A].predecessorVersionId = "x"; },
  count_changed: (n) => { n.versions[A].fixedItemsCount = 2; },
  author_changed: (n) => { n.versions[A].recordedBy = "intruder"; },
  actor_changed: (n) => { n.review[A].actor = "intruder"; },
  committed_at_changed: (n) => { n.review[A].committedAt += 1; },
  version_business_changed: (n) => { n.review[A].flagAudit.bizId = B2; },
  version_tenant_changed: (n) => { n.review[A].flagAudit.tenantId = "tenantZ"; },
  // a forger who can recompute the deterministic flag identity for the foreign binding: only the binding check refuses
  version_business_rebound: (n) => { const a = n.review[A].flagAudit; a.bizId = B2; a.operationId = F.costHistory.flagOperationIdOf({ tenantId: a.tenantId, bizId: B2, versionId: A, intentDigest: a.intentDigest, outcome: a.outcome }); },
  version_tenant_rebound: (n) => { const a = n.review[A].flagAudit; a.tenantId = "tenantZ"; a.operationId = F.costHistory.flagOperationIdOf({ tenantId: "tenantZ", bizId: a.bizId, versionId: A, intentDigest: a.intentDigest, outcome: a.outcome }); },
  decision_business_changed: (n) => { n.review[A].decisionAudit.bizId = B2; },
  decision_tenant_changed: (n) => { n.review[A].decisionAudit.tenantId = "tenantZ"; },
  state_changed: (n) => { const e = n.review[A]; e.state = e.state === "cleared" ? "rejected" : "cleared"; },
  decision_changed: (n) => { const e = n.review[A], o = e.decision === "accepted" ? "rejected" : "accepted"; e.decision = o; e.decisionAudit.decision = o; e.decisionAudit.resultingState = o === "accepted" ? "cleared" : "rejected"; },
  decision_audit_decision_changed: (n) => { const a = n.review[A].decisionAudit; a.decision = a.decision === "accepted" ? "rejected" : "accepted"; },
  resulting_state_changed: (n) => { const a = n.review[A].decisionAudit; a.resultingState = a.resultingState === "cleared" ? "rejected" : "cleared"; },
  flag_resulting_state_changed: (n) => { n.review[A].flagAudit.resultingState = "cleared"; },
  flag_operation_changed: (n) => { n.review[A].flagAudit.operationId = "f".repeat(64); },
  decision_operation_changed: (n) => { n.review[A].decisionAudit.operationId = OP2; n.review[A].decisionAudit.operationId = 123456; },
  decision_operation_numeric_string_shape: (n) => { n.review[A].decisionAudit.operationId = "123456"; },
  review_schema_changed: (n) => { n.review[A].schema = "MARJIN_COSTR/3"; },
  flag_schema_changed: (n) => { n.review[A].flagAudit.schema = "MARJIN_COST_AUDIT/2"; },
  decision_schema_changed: (n) => { n.review[A].decisionAudit.schema = "MARJIN_COST_DECISION/0"; },
  digest_pair_changed: (n) => { const d = "c".repeat(64); n.review[A].intentDigest = d; n.review[A].flagAudit.intentDigest = d; n.review[A].decisionAudit.intentDigest = d; },
  flag_digest_changed: (n) => { n.review[A].flagAudit.intentDigest = "c".repeat(64); },
  decision_digest_changed: (n) => { n.review[A].decisionAudit.intentDigest = "c".repeat(64); },
  missing_flag_audit: (n) => { delete n.review[A].flagAudit; },
  missing_decision_audit: (n) => { delete n.review[A].decisionAudit; },
  missing_decision: (n) => { delete n.review[A].decision; },
  flag_version_changed: (n) => { n.review[A].flagAudit.versionId = OP; },
  decision_version_changed: (n) => { n.review[A].decisionAudit.versionId = OP; },
  flag_actor_changed: (n) => { n.review[A].flagAudit.recordedBy = "intruder"; },
  decided_by_empty: (n) => { n.review[A].decisionAudit.decidedBy = ""; },
  decided_by_numeric: (n) => { n.review[A].decisionAudit.decidedBy = 7; },
  outcome_changed: (n) => { n.review[A].flagAudit.outcome = "accepted"; },
  resolution_changed: (n) => { n.review[A].resolution = "post_commit_authorized"; },
  decided_before_resolved: (n) => { n.review[A].decisionAudit.decidedAt = n.review[A].resolvedAt - 1; },
  extra_field: (n) => { n.review[A].acceptedBy = "owner"; },
  extra_audit_field: (n) => { n.review[A].decisionAudit.note = "x"; },
  cycle: (n) => { n.versions[A].predecessorVersionId = n.versions[A].versionId; },
  dangling: (n) => { n.versions[A].predecessorVersionId = OP; },
};
test("RL4-A01 every material change to an ACCEPTED record (payload, dates, predecessor, counts, author, business, tenant, state, decision, operation, schema, bindings) is unreadable on the committed core, the compiled bundle and the server loader", async () => {
  const db = world();
  const { node: before } = await flaggedByManager(db);
  assert.equal((await writer(db).acceptFlaggedVersion(req, { ...scope, versionId: A, intentDigest: before.review[A].intentDigest, operationId: OP })).status, "resolved");
  const accepted = clone(db.read(NODE()));
  assert.equal((await everyReader(db, accepted)).committed.state, "present", "the unmutated record is authoritative");
  for (const [name, mut] of Object.entries(MUTATIONS)) {
    const n = clone(accepted); mut(n);
    assert.notDeepEqual(n, accepted, name + " mutates");
    unreadableEverywhere(await everyReader(db, n), name);
  }
});

test("RL4-A02 the same matrix over a REJECTED record and a FLAGGED record", async () => {
  const db = world();
  const first = await activated(db);
  const { node: flaggedNode } = await flaggedByManager(db, A2, first.head);
  assert.equal((await writer(db).rejectFlaggedVersion(req, { ...scope, versionId: A2, intentDigest: flaggedNode.review[A2].intentDigest, operationId: OP })).status, "resolved");
  const rejected = clone(db.read(NODE()));
  const swap = (fn) => (n) => { const m = { versions: { [A]: n.versions[A2] }, review: { [A]: n.review[A2] } }; fn(m); n.versions[A2] = m.versions[A]; n.review[A2] = m.review[A]; };
  for (const [name, mut] of Object.entries(MUTATIONS)) {
    const n = clone(rejected); swap(mut)(n);
    unreadableEverywhere(await everyReader(db, n), "rejected:" + name);
  }
  const flaggedOnly = ["amount_changed", "date_changed", "predecessor_changed", "count_changed", "author_changed", "actor_changed", "committed_at_changed", "version_business_changed", "version_tenant_changed", "version_business_rebound", "version_tenant_rebound",
    "flag_resulting_state_changed", "flag_operation_changed", "review_schema_changed", "flag_schema_changed", "flag_digest_changed", "missing_flag_audit", "flag_version_changed", "flag_actor_changed", "outcome_changed", "resolution_changed", "extra_field", "cycle", "dangling"];
  for (const name of flaggedOnly) {
    const n = clone(flaggedNode); swap(MUTATIONS[name])(n);
    const r = codec.decodeHistoryStructure({ exists: true, value: n }, scope);
    assert.equal(r.state, "unreadable", "flagged:" + name);
  }
  assert.equal(codec.decodeHistoryStructure({ exists: true, value: flaggedNode }, scope).state, "present", "the unmutated flagged record is structurally readable (non-authoritative)");
});

test("RL4-A03 a VALID audit for one version / business / tenant cannot validate another; an unbound or wrongly bound decode is unreadable", async () => {
  const db = world();
  const { node: before } = await flaggedByManager(db);
  assert.equal((await writer(db).acceptFlaggedVersion(req, { ...scope, versionId: A, intentDigest: before.review[A].intentDigest, operationId: OP })).status, "resolved");
  const accepted = clone(db.read(NODE()));
  // same bytes stored under ANOTHER registered business of the same tenant
  unreadableEverywhere(await everyReader(db, accepted, { tenantId: T, bizId: B2 }), "other business");
  // same bytes read by another tenant that has a business with the SAME id
  db.seed("tenants/tenantZ/biz:bizA:config", { _v: JSON.stringify({ employees: [] }) }); db.seed("tenants/tenantZ/biz:bizA:fixed", { _v: "[]" }); db.seed("tenants/tenantZ/biz:bizA:entries", { _v: "[]" });
  unreadableEverywhere(await everyReader(db, accepted, { tenantId: "tenantZ", bizId: B }), "other tenant");
  // the valid review entry of version A copied onto another version
  const first = await activated(world());
  const two = clone(first); two.head = { revision: 2, headVersionId: A2 }; two.versions[A2] = { ...first.versions[A], versionId: A2, predecessorVersionId: A, recordedAt: first.versions[A].recordedAt + 1 }; two.review[A2] = clone(two.review[A]);
  assert.equal(codec.decodeHistory({ exists: true, value: two }, scope).state, "unreadable", "an entry bound to version A cannot validate version A2");
  two.review[A2] = reviewEntry(two.versions[A2], "cleared");
  assert.equal(codec.decodeHistory({ exists: true, value: two }, scope).state, "present", "the correctly bound entry is readable");
  // no binding ⇒ never a decode
  for (const bind of [undefined, null, {}, { tenantId: T }, { bizId: B }, { tenantId: "", bizId: B }, { tenantId: T, bizId: 7 }]) {
    const r = codec.decodeHistory({ exists: true, value: accepted }, bind);
    assert.equal(r.state, "unreadable", JSON.stringify(bind)); assert.ok(["binding_required", "binding_invalid"].includes(r.reason), r.reason);
    assert.equal(BROWSER.costHistory.codec.decodeHistoryStructure({ exists: true, value: accepted }, bind).state, "unreadable");
  }
  assert.equal(codec.decodeHistory({ failed: "read_failed" }, scope).reason, "read_failed");
  assert.equal(codec.decodeHistory({ failed: "read_failed" }, null).reason, "binding_required", "a failed read without a binding is still a binding failure");
});

test("RL4-A04 the ONE canonical digest binds tenant, business and every version byte; the committed core, the compiled bundle and the writer agree", async () => {
  const db = world();
  const node = await activated(db);
  const v = node.versions[A];
  const d = F.costHistory.intentDigestOf(T, B, v);
  assert.equal(d, node.review[A].intentDigest, "the writer stored the core's digest");
  assert.equal(BROWSER.costHistory.intentDigestOf(T, B, v), d, "the compiled bundle recomputes the same digest");
  assert.notEqual(F.costHistory.intentDigestOf(T, B2, v), d, "business bound");
  assert.notEqual(F.costHistory.intentDigestOf("tenantZ", B, v), d, "tenant bound");
  assert.equal(F.costHistory.intentDigestOf(T, B, { ...v, recordedAt: v.recordedAt + 5 }), d, "the server instant is the only unbound field (same node, same transaction)");
  for (const k of Object.keys(v).filter((k) => k !== "recordedAt")) {
    const m = clone(v); m[k] = typeof m[k] === "number" ? m[k] + 1 : typeof m[k] === "string" ? m[k] + "x" : Array.isArray(m[k]) ? [...m[k], {}] : { ...m[k], x: 1 };
    assert.notEqual(F.costHistory.intentDigestOf(T, B, m), d, "field " + k);
  }
  const fa = { tenantId: T, bizId: B, versionId: A, intentDigest: d, outcome: "revoked_during_commit" };
  assert.equal(F.costHistory.flagOperationIdOf(fa), BROWSER.costHistory.flagOperationIdOf(fa));
  for (const k of Object.keys(fa)) assert.notEqual(F.costHistory.flagOperationIdOf({ ...fa, [k]: fa[k] + "x" }), F.costHistory.flagOperationIdOf(fa), "flag identity bound to " + k);
  assert.equal(F.finance.canonical.CANONICAL_VERSION, "MARJIN_CANON/1");
  assert.equal(F.finance.canonical.canonicalDigest(v), BROWSER.finance.canonical.canonicalDigest(v));
});

// ── RL4-B authorization window ────────────────────────────────────────────────────────────────────
const noNode = (db) => assert.equal(db.read(NODE()), null, "no cost-history node");
const noIntent = (db, versionId = A) => assert.equal(db.read(`tenants/${T}/audit/cost_history_intents/${versionId}`), null, "no audit intent");

test("RL4-B01 BEFORE the entry check: registry removal, role loss and membership loss deny at entry with no read of the node, no intent and no node", async () => {
  for (const [label, prep, uid, expect, call] of [
    ["business removed from the registry (owner activation)", (db) => db.seed(REGISTRY, { _v: "[]" }), "owner", "business_not_in_tenant", "activateCostHistory"],
    ["registry unreadable (owner activation)", (db) => db.seed(REGISTRY, { _v: "nonsense" }), "owner", "authorization_unavailable", "activateCostHistory"],
    ["owner downgraded to manager (activation)", downgradeOwner, "owner", "role_not_allowed", "activateCostHistory"],
    ["owner downgraded to manager WITHOUT a business row (activation)", (db) => db.seed(`tenants/${T}/roles/owner`, "manager"), "owner", "unauthorized", "activateCostHistory"],
    ["super_owner activation", () => {}, "super", "role_not_allowed", "activateCostHistory"],
    ["manager activation", () => {}, "manager", "role_not_allowed", "activateCostHistory"],
    ["membership removed (manager save)", (db) => db.seed(`tenants/${T}/members/manager`, false), "manager", "unauthorized", "saveCostVersion"],
    ["viewer save", () => {}, "viewer", "unauthorized", "saveCostVersion"],
    ["business access removed (manager save)", (db) => db.seed(`tenants/${T}/biz_access/${B}/manager`, null), "manager", "unauthorized", "saveCostVersion"],
    ["foreign tenant owner", () => {}, "foreign", "unauthorized", "activateCostHistory"],
    ["unauthenticated", () => { globalThis.__CLAIMS = null; }, null, "unauthenticated", "activateCostHistory"],
  ]) {
    const db = world(); prep(db); if (uid) actor(uid);
    const w = wrapPath(db, NODE());
    const out = await writer(db)[call](req, { ...scope, body: body(A) });
    w.restore();
    assert.equal(out.status, expect, label);
    assert.deepEqual(w.calls(), { gets: 0, txns: 0 }, label + ": the node is never read before the entry check passes");
    noNode(db); noIntent(db);
  }
});

test("RL4-B02 AFTER the entry check and BEFORE the pre-commit check (during priming / intent write): a registry removal or a role loss denies before the transaction; nothing is stored", async () => {
  for (const [label, during, uid, call, expect] of [
    ["registry removed during priming", (db) => db.seed(REGISTRY, { _v: "[]" }), "owner", "activateCostHistory", "business_not_in_tenant"],
    ["owner downgraded during priming", downgradeOwner, "owner", "activateCostHistory", "role_not_allowed"],
    ["manager membership removed during priming", (db) => db.seed(`tenants/${T}/members/manager`, false), "manager", "saveCostVersion", "unauthorized"],
    ["manager business access removed during priming", (db) => db.seed(`tenants/${T}/biz_access/${B}/manager`, null), "manager", "saveCostVersion", "unauthorized"],
    ["registry unreadable at the pre-commit check", (db) => db.seed(REGISTRY, { _v: "nonsense" }), "owner", "activateCostHistory", "authorization_unavailable"],
  ]) {
    const db = world(); actor(uid);
    const w = wrapPath(db, NODE(), { afterGet: (n) => { if (n === 1) during(db); } });
    const out = await writer(db)[call](req, { ...scope, body: body(A) });
    w.restore();
    assert.equal(out.status, expect, label);
    assert.equal(w.calls().txns, 0, label + ": no transaction");
    noNode(db);
  }
});

test("RL4-B03 AFTER the pre-commit check and BEFORE the transaction (hooks.afterAuth): the version commits PENDING and the post-check flags it with its atomic, bound audit — never authoritative", async () => {
  // the business is removed from the registry after the pre-check: the post-check is a definitive loss, but a flag can
  // never be durably recorded for an UNREGISTERED business (no operation succeeds for it) ⇒ the record stays PENDING —
  // non-authoritative, unreadable to every reader, reconcilable only once the business is registered again
  {
    const db = world(); actor("owner");
    const out = await writer(db, { afterAuth: async () => db.seed(REGISTRY, { _v: "[]" }) }).activateCostHistory(req, { ...scope, body: body(A) });
    assert.equal(out.status, "committed_current"); assert.equal(out.review, "pending"); assert.equal(out.postCommitAccess, "revoked_during_commit");
    assert.equal(out.audit, "flag_unconfirmed"); assert.equal(out.reviewResolution, "business_not_in_tenant");
    assert.equal(db.read(NODE()).review[A].state, "pending");
    assert.equal(codec.decodeHistory({ exists: true, value: db.read(NODE()) }, scope).reason, "authorization_review_pending");
    assert.equal((await writer(db).readCostHistory(req, scope)).status, "business_not_in_tenant");
    assert.equal((await writer(db).reconcilePendingReviews({ ...scope, authorize: async () => {} })).status, "business_not_in_tenant");
    db.seed(REGISTRY, { _v: JSON.stringify([{ id: B }]) });
    const r = await writer(db).reconcilePendingReviews({ ...scope, authorize: async () => {} });
    assert.deepEqual(r.results, [{ versionId: A, status: "resolved", state: "cleared", requiredRole: "owner" }], "re-registered ⇒ the CURRENT owner's authorization decides");
  }
  for (const [label, during, uid, call, resolution] of [
    ["owner downgraded after the pre-check (activation)", downgradeOwner, "owner", "activateCostHistory", "revoked_during_commit"],
    ["manager membership removed after the pre-check", (db) => db.seed(`tenants/${T}/members/manager`, false), "manager", "saveCostVersion", "revoked_during_commit"],
    ["manager business access removed after the pre-check", (db) => db.seed(`tenants/${T}/biz_access/${B}/manager`, null), "manager", "saveCostVersion", "revoked_during_commit"],
  ]) {
    const db = world(); actor(uid);
    const out = await writer(db, { afterAuth: async () => during(db) })[call](req, { ...scope, body: body(A) });
    assert.equal(out.status, "committed_current", label); assert.equal(out.review, "flagged", label); assert.equal(out.audit, "flag_persisted", label);
    assert.equal(out.postCommitAccess, "revoked_during_commit");
    const e = db.read(NODE()).review[A];
    assert.equal(e.state, "flagged"); assert.equal(e.resolution, resolution);
    assert.deepEqual(e.flagAudit, { schema: "MARJIN_COST_AUDIT/3", operationId: F.costHistory.flagOperationIdOf({ tenantId: T, bizId: B, versionId: A, intentDigest: e.intentDigest, outcome: resolution }),
      tenantId: T, bizId: B, versionId: A, intentDigest: e.intentDigest, recordedBy: uid, recordedAt: db.read(NODE()).versions[A].recordedAt, outcome: resolution, resultingState: "flagged", detectedAt: e.flagAudit.detectedAt }, label);
    assert.ok(e.flagAudit.detectedAt >= e.committedAt && e.resolvedAt === e.flagAudit.detectedAt, label + " instants");
    const d = codec.decodeHistory({ exists: true, value: db.read(NODE()) }, scope);
    assert.equal(d.state, "unreadable", label); assert.equal(d.reason, "authorization_review_flagged");
    const s = codec.decodeHistoryStructure({ exists: true, value: db.read(NODE()) }, scope);
    assert.deepEqual(s.unresolved, { pending: [], flagged: [A] }, label + ": structurally flagged, authoritatively unreadable");
    assert.equal(F.costHistory.timelineSourceFor(d).source, "unavailable");
  }
});

test("RL4-B04 DURING / AFTER the commit and BEFORE the post-check: a loss landing after the transaction is detected by the post-check ⇒ flagged; a loss that is only unavailable ⇒ pending", async () => {
  // definitive losses after the transaction
  for (const [label, after, uid, call] of [
    ["owner downgraded after the commit", downgradeOwner, "owner", "activateCostHistory"],
    ["owner downgraded after the commit WITHOUT a business row", (db) => db.seed(`tenants/${T}/roles/owner`, "manager"), "owner", "activateCostHistory"],
    ["manager removed after the commit", (db) => db.seed(`tenants/${T}/members/manager`, false), "manager", "saveCostVersion"],
    ["manager business access removed after the commit", (db) => db.seed(`tenants/${T}/biz_access/${B}/manager`, null), "manager", "saveCostVersion"],
  ]) {
    const db = world(); actor(uid);
    const w = wrapPath(db, NODE(), { afterTransaction: (n) => { if (n === 1) after(db); } });
    const out = await writer(db)[call](req, { ...scope, body: body(A) });
    w.restore();
    assert.equal(out.status, "committed_current", label); assert.equal(out.review, "flagged", label + " " + JSON.stringify(out)); assert.equal(out.audit, "flag_persisted");
    assert.equal(db.read(NODE()).review[A].state, "flagged");
    assert.equal(codec.decodeHistory({ exists: true, value: db.read(NODE()) }, scope).state, "unreadable");
  }
  // the business is removed after the commit ⇒ definitive loss, but no durable flag for an unregistered business ⇒ PENDING, unreadable
  {
    const db = world(); actor("owner");
    const w = wrapPath(db, NODE(), { afterTransaction: (n) => { if (n === 1) db.seed(REGISTRY, { _v: "[]" }); } });
    const out = await writer(db).activateCostHistory(req, { ...scope, body: body(A) });
    w.restore();
    assert.equal(out.status, "committed_current"); assert.equal(out.review, "pending"); assert.equal(out.postCommitAccess, "revoked_during_commit"); assert.equal(out.audit, "flag_unconfirmed");
    assert.equal(db.read(NODE()).review[A].state, "pending");
    assert.equal(codec.decodeHistory({ exists: true, value: db.read(NODE()) }, scope).state, "unreadable");
  }
  // the post-check cannot be evaluated (registry read fails exactly at the post-check) ⇒ pending, reconcilable, never cleared
  {
    const db = world(); actor("owner");
    const w = wrapPath(db, REGISTRY, { getThrows: (n) => n === 3 });      // entry (1), pre-commit (2), post-commit (3)
    const out = await writer(db).activateCostHistory(req, { ...scope, body: body(A) });
    w.restore();
    assert.equal(out.status, "committed_current"); assert.equal(out.review, "pending"); assert.equal(out.postCommitAccess, "verification_unavailable");
    const e = db.read(NODE()).review[A];
    assert.equal(e.state, "pending"); assert.deepEqual(keysOf(e), keysOf(Object.fromEntries(REVIEW_KEYS.pending.map((k) => [k, 1]))));
    assert.equal(codec.decodeHistory({ exists: true, value: db.read(NODE()) }, scope).reason, "authorization_review_pending");
    // a review-transition failure alone also leaves pending (the flag transaction is down)
    const db2 = world(); actor("owner");
    let txns = 0;
    const w2 = wrapPath(db2, NODE(), { afterTransaction: (n) => { txns = n; if (n === 1) downgradeOwner(db2); } });
    const orig = db2.ref; db2.ref = (p, q) => { const r = orig(p, q); return p !== NODE() ? r : { ...r, transaction: async (...a) => { if (txns >= 1) throw new Error("flag transaction down"); return r.transaction(...a); } }; };
    const out2 = await writer(db2).activateCostHistory(req, { ...scope, body: body(A) });
    db2.ref = orig; w2.restore();
    assert.equal(out2.status, "committed_current"); assert.equal(out2.review, "pending"); assert.equal(out2.audit, "flag_unconfirmed");
    assert.equal(db2.read(NODE()).review[A].state, "pending", "audit failure alone leaves the version pending, never flagged without durable evidence, never cleared");
  }
});

test("RL4-B05 BEFORE an owner decision: a downgraded / removed owner, a removed business and a loss DURING the decision's priming are all refused with the record unchanged", async () => {
  const cases = [
    ["owner downgraded before the decision", downgradeOwner, null, "role_not_allowed"],
    ["owner downgraded before the decision WITHOUT a business row", (db) => db.seed(`tenants/${T}/roles/owner`, "manager"), null, "unauthorized"],
    ["owner removed from the tenant before the decision", (db) => db.seed(`tenants/${T}/members/owner`, false), null, "unauthorized"],
    ["business removed before the decision", (db) => db.seed(REGISTRY, { _v: "[]" }), null, "business_not_in_tenant"],
    ["registry unreadable before the decision", (db) => db.seed(REGISTRY, { _v: "nonsense" }), null, "authorization_unavailable"],
    ["owner downgraded during the decision's priming", null, downgradeOwner, "unauthorized"],
    ["owner removed during the decision's priming", null, (db) => db.seed(`tenants/${T}/members/owner`, false), "unauthorized"],
    ["business removed during the decision's priming", null, (db) => db.seed(REGISTRY, { _v: "[]" }), "business_not_in_tenant"],
    ["registry unavailable during the decision's priming", null, (db) => db.seed(REGISTRY, { _v: "nonsense" }), "authorization_unavailable"],
  ];
  for (const decision of ["acceptFlaggedVersion", "rejectFlaggedVersion"]) for (const [label, before, during, expect] of cases) {
    const db = world();
    const { node } = await flaggedByManager(db);
    if (before) before(db);
    const w = wrapPath(db, NODE(), { afterGet: (n) => { if (during && n === 1) during(db); } });
    const out = await writer(db)[decision](req, { ...scope, versionId: A, intentDigest: node.review[A].intentDigest, operationId: OP });
    w.restore();
    assert.equal(out.status, expect, decision + ": " + label);
    assert.equal(w.calls().txns, 0, decision + ": " + label + " no transaction");
    assert.deepEqual(db.read(NODE()), node, decision + ": " + label + " record unchanged");
  }
});

test("RL4-B06 BEFORE / DURING reconciliation: the actor's CURRENT authorization decides; an activation needs a CURRENT owner; a removed business reconciles nothing; the reconciler's own loss aborts", async () => {
  const pendingWorld = async (uid, call) => {
    const db = world(); actor(uid);
    const w = wrapPath(db, REGISTRY, { getThrows: (n) => n === 3 });
    const out = await writer(db)[call](req, { ...scope, body: body(A) });
    w.restore();
    assert.equal(out.review, "pending");
    return db;
  };
  // ordinary (non-activation) pending edit by a manager over an existing cleared history
  const edited = async () => {
    const db = world(); await activated(db); actor("manager");
    const w = wrapPath(db, REGISTRY, { getThrows: (n) => n === 3 });
    const out = await writer(db).recordCostEdit(req, { ...scope, body: body(A2, db.read(NODE()).head) });
    w.restore(); assert.equal(out.review, "pending"); return db;
  };
  const ok = async () => {};
  // (1) pending activation by the owner, still an owner ⇒ cleared
  { const db = await pendingWorld("owner", "activateCostHistory"); const r = await writer(db).reconcilePendingReviews({ ...scope, authorize: ok });
    assert.deepEqual(r.results, [{ versionId: A, status: "resolved", state: "cleared", requiredRole: "owner" }]); assert.equal(db.read(NODE()).review[A].resolution, "reconciled_authorized"); }
  // (2) pending activation by the owner, downgraded to manager before reconciliation ⇒ flagged (an activation needs a CURRENT owner)
  { const db = await pendingWorld("owner", "activateCostHistory"); downgradeOwner(db);
    const r = await writer(db).reconcilePendingReviews({ ...scope, authorize: ok });
    assert.deepEqual(r.results, [{ versionId: A, status: "resolved", state: "flagged", requiredRole: "owner", audit: "flag_persisted" }]);
    const e = db.read(NODE()).review[A]; assert.equal(e.resolution, "reconciled_unauthorized"); assert.equal(e.flagAudit.outcome, "reconciled_unauthorized"); }
  // (3) pending activation by the owner, owner removed ⇒ flagged
  { const db = await pendingWorld("owner", "activateCostHistory"); db.seed(`tenants/${T}/members/owner`, false);
    const r = await writer(db).reconcilePendingReviews({ ...scope, authorize: ok }); assert.equal(r.results[0].state, "flagged"); }
  // (4) pending ordinary edit by a manager, still authorized ⇒ cleared (no owner requirement)
  { const db = await edited(); const r = await writer(db).reconcilePendingReviews({ ...scope, authorize: ok });
    assert.deepEqual(r.results, [{ versionId: A2, status: "resolved", state: "cleared" }]); }
  // (5) pending ordinary edit, manager lost business access ⇒ flagged
  { const db = await edited(); db.seed(`tenants/${T}/biz_access/${B}/manager`, null); const r = await writer(db).reconcilePendingReviews({ ...scope, authorize: ok });
    assert.equal(r.results[0].state, "flagged"); assert.equal(db.read(NODE()).review[A2].flagAudit.recordedBy, "manager"); }
  // (6) business removed before reconciliation ⇒ nothing reconciled, record unchanged
  { const db = await pendingWorld("owner", "activateCostHistory"); const before = clone(db.read(NODE())); db.seed(REGISTRY, { _v: "[]" });
    const r = await writer(db).reconcilePendingReviews({ ...scope, authorize: ok }); assert.equal(r.status, "business_not_in_tenant"); assert.deepEqual(r.results, []); assert.deepEqual(db.read(NODE()), before); }
  // (7) business removed DURING reconciliation (after its priming) ⇒ the transition refuses, record stays pending
  { const db = await pendingWorld("owner", "activateCostHistory"); const before = clone(db.read(NODE()));
    const w = wrapPath(db, NODE(), { afterGet: (n) => { if (n === 2) db.seed(REGISTRY, { _v: "[]" }); } });   // (1) reconcile priming, (2) transition priming
    const r = await writer(db).reconcilePendingReviews({ ...scope, authorize: ok }); w.restore();
    assert.equal(r.results[0].status, "business_not_in_tenant"); assert.deepEqual(db.read(NODE()), before); }
  // (8) the RECONCILER's own authorization lost during the transition ⇒ unauthorized, record unchanged
  { const db = await pendingWorld("owner", "activateCostHistory"); const before = clone(db.read(NODE()));
    const r = await writer(db).reconcilePendingReviews({ ...scope, authorize: async () => { throw { status: 403 }; } });
    assert.equal(r.results[0].status, "unauthorized"); assert.deepEqual(db.read(NODE()), before); }
  // (9) the stored actor's authorization cannot be evaluated ⇒ stays pending (verification_unavailable), never cleared
  { const db = await pendingWorld("owner", "activateCostHistory"); const before = clone(db.read(NODE()));
    const w = wrapPath(db, `tenants/${T}/members/owner`, { getThrows: () => true });
    const r = await writer(db).reconcilePendingReviews({ ...scope, authorize: ok }); w.restore();
    assert.deepEqual(r.results, [{ versionId: A, status: "verification_unavailable" }]);
    assert.deepEqual(db.read(NODE()), before, "an unavailable check leaves the record pending and unchanged"); }
  // (10) a MALFORMED role store is a definitive denial (fail closed ⇒ flagged with durable evidence), never cleared
  { const db = await pendingWorld("owner", "activateCostHistory"); db.seed(`tenants/${T}/roles/owner`, { nested: "owner" });
    const r = await writer(db).reconcilePendingReviews({ ...scope, authorize: ok }); assert.equal(r.results[0].state, "flagged"); }
});

test("RL4-B07 stale authorization never creates authoritative history: in every window case above a `cleared` entry exists ONLY where the post-check or the reconciliation re-authorized the CURRENT actor", async () => {
  // the entry check passes; everything after it is revoked before the post-check ⇒ never cleared
  for (const window of ["afterGet", "afterAuth", "afterTransaction"]) {
    const db = world(); actor("owner");
    const revoke = () => downgradeOwner(db);
    const w = window === "afterAuth" ? { restore() {} } : wrapPath(db, NODE(), window === "afterGet" ? { afterGet: (n) => { if (n === 1) revoke(); } } : { afterTransaction: (n) => { if (n === 1) revoke(); } });
    const out = await writer(db, window === "afterAuth" ? { afterAuth: async () => revoke() } : {}).activateCostHistory(req, { ...scope, body: body(A) });
    w.restore();
    const node = db.read(NODE());
    if (node) { assert.notEqual(node.review[A].state, "cleared", window); assert.notEqual(out.review, "cleared", window); }
    else assert.ok(["role_not_allowed"].includes(out.status), window + " " + out.status);
    assert.equal(codec.decodeHistory({ exists: node !== null, value: node }, scope).state, node ? "unreadable" : "absent", window);
  }
});

// ── RL4-O operation identity ──────────────────────────────────────────────────────────────────────
test("RL4-O01 a numeric or malformed operation id, version id or digest is refused as request_shape BEFORE any read or write; a numeric id never becomes stored evidence", async () => {
  const db = world();
  const { node } = await flaggedByManager(db);
  const dg = node.review[A].intentDigest;
  const reads = [];
  const orig = db.ref; db.ref = (p, q) => { reads.push(p); return orig(p, q); };
  for (const decision of ["acceptFlaggedVersion", "rejectFlaggedVersion"]) {
    for (const bad of [{ operationId: 12345 }, { operationId: 1e3 }, { operationId: "12345" }, { operationId: OP.replace("-4", "-1") }, { operationId: null }, { operationId: undefined }, { operationId: { id: OP } }, { operationId: [OP] },
      { versionId: 7 }, { versionId: "x" }, { intentDigest: 7 }, { intentDigest: "abc" }, { intentDigest: "G".repeat(64) }]) {
      reads.length = 0;
      const out = await writer(db)[decision](req, { ...scope, versionId: A, intentDigest: dg, operationId: OP, ...bad });
      assert.equal(out.status, "request_shape", decision + " " + JSON.stringify(bad));
      assert.deepEqual(reads, [], decision + " " + JSON.stringify(bad) + ": no read, no write");
    }
  }
  db.ref = orig;
  assert.deepEqual(db.read(NODE()), node, "record unchanged");
  const stored = clone(node); stored.review[A] = reviewEntry(stored.versions[A], "accepted");
  assert.equal(codec.decodeHistory({ exists: true, value: stored }, scope).state, "present", "the fixture's accepted entry is valid");
  stored.review[A].decisionAudit.operationId = 123456;
  assert.equal(codec.decodeHistory({ exists: true, value: stored }, scope).state, "unreadable", "a stored numeric operation id is never valid evidence");
  assert.deepEqual(codec.decodeHistoryStructure({ exists: true, value: stored }, scope).detail, { versionId: A, error: "decision_audit_operation_invalid" });
});

test("RL4-O02 the HTTP route maps request_shape to 400, role_not_allowed / business_not_in_tenant to 403 and exposes no acknowledge alias", async () => {
  const route = await loadRoute();
  assert.equal(typeof W.createCostHistoryWriter({ db: makeDb(), clock: () => NOW }).acknowledgeFlaggedVersion, "undefined", "no compatibility alias");
  const db = world(); const { node } = await flaggedByManager(db);
  const call = async (bodyIn) => { const res = { code: 200, setHeader() {}, status(n) { this.code = n; return this; }, json(d) { this.body = d; return this; } }; await route.default({ method: "POST", headers: {}, body: bodyIn }, res); return res; };
  const base = { tenantId: T, bizId: B, versionId: A, intentDigest: node.review[A].intentDigest };
  for (const action of ["accept_flag", "reject_flag"]) {
    const r = await call({ action, ...base, operationId: 12345 });
    assert.equal(r.code, 400); assert.equal(r.body.status, "request_shape");
  }
  assert.equal((await call({ action: "acknowledge_flag", ...base, operationId: OP })).body.status, "action_invalid");
  actor("manager"); assert.equal((await call({ action: "accept_flag", ...base, operationId: OP })).code, 403);
  actor("super"); assert.equal((await call({ action: "reject_flag", ...base, operationId: OP })).code, 403);
  actor("owner"); db.seed(REGISTRY, { _v: "[]" });
  const gone = await call({ action: "accept_flag", ...base, operationId: OP }); assert.equal(gone.code, 403); assert.equal(gone.body.status, "business_not_in_tenant");
  assert.deepEqual(db.read(NODE()), node, "the route changed nothing");
});

// ── RL4-R readback ────────────────────────────────────────────────────────────────────────────────
test("RL4-R01 an unknown decision outcome is resolved ONLY by a FULL-payload readback: the exact intended entry ⇒ resolved; a stored entry that differs in any field ⇒ outcome_unknown", async () => {
  for (const decision of ["acceptFlaggedVersion", "rejectFlaggedVersion"]) {
    // the transaction lands, the acknowledgement is lost ⇒ readback resolves
    const db = world(); const { node } = await flaggedByManager(db);
    const orig = db.ref; db.ref = (p, q) => { const r = orig(p, q); return p !== NODE() ? r : { ...r, transaction: async (...a) => { await r.transaction(...a); throw new Error("ack lost"); } }; };
    const out = await writer(db)[decision](req, { ...scope, versionId: A, intentDigest: node.review[A].intentDigest, operationId: OP });
    db.ref = orig;
    const want = decision === "acceptFlaggedVersion" ? ["cleared", "accepted"] : ["rejected", "rejected"];
    assert.equal(out.status, "resolved", decision); assert.equal(out.state, want[0]); assert.equal(out.decision, want[1]); assert.equal(out.resolvedBy, "readback");
    // the transaction lands but the stored payload was altered (another actor, another operation, another instant) ⇒ never "resolved"
    for (const alter of [(e) => { e.decisionAudit.decidedBy = "intruder"; }, (e) => { e.decisionAudit.operationId = OP2; }, (e) => { e.decisionAudit.decidedAt += 1; }, (e) => { e.decisionAudit.tenantId = "tenantZ"; }, (e) => { e.resolution = "reconciled_unauthorized"; }]) {
      const db2 = world(); const { node: n2 } = await flaggedByManager(db2);
      const o2 = db2.ref; db2.ref = (p, q) => { const r = o2(p, q); return p !== NODE() ? r : { ...r, transaction: async (...a) => { await r.transaction(...a); const cur = db2.read(NODE()); alter(cur.review[A]); db2.seed(NODE(), cur); throw new Error("ack lost"); } }; };
      const out2 = await writer(db2)[decision](req, { ...scope, versionId: A, intentDigest: n2.review[A].intentDigest, operationId: OP });
      db2.ref = o2;
      assert.notEqual(out2.status, "resolved", decision + " altered payload");
      assert.equal(out2.status, "outcome_unknown");
    }
  }
});

test("RL4-R02 a lost acknowledgement of the VERSION commit is recovered by payload readback; a different stored payload under the same version id is identity_reused, never success", async () => {
  const db = world(); actor("owner");
  const orig = db.ref; db.ref = (p, q) => { const r = orig(p, q); return p !== NODE() ? r : { ...r, transaction: async (...a) => { await r.transaction(...a); throw new Error("ack lost"); } }; };
  const out = await writer(db).activateCostHistory(req, { ...scope, body: body(A) });
  db.ref = orig;
  assert.equal(out.status, "committed_current"); assert.equal(out.uncertain, true); assert.equal(out.resolvedBy, "readback");
  const altered = clone(db.read(NODE())); altered.versions[A].fixedItems[0].monthlyAmount = "1"; db.seed(NODE(), altered);
  const again = await writer(db).recoverSave(req, { ...scope, body: body(A), recordedAtHint: NOW });
  assert.ok(["identity_reused", "history_unreadable"].includes(again.status), again.status);
});

// ── RL4-T tenant-wide owner / absent business ─────────────────────────────────────────────────────
test("RL4-T01 the tenant-wide owner (no biz_access row) activates, accepts, rejects and re-activates; an owner with a row only for another business decides too; super_owner, manager, viewer, foreign owner and non-member never decide", async () => {
  const db = world();
  const { node } = await flaggedByManager(db);
  const dg = node.review[A].intentDigest;
  for (const [uid, expect] of [["super", "role_not_allowed"], ["manager", "role_not_allowed"], ["viewer", "unauthorized"], ["foreign", "unauthorized"], ["nobody", "unauthorized"]]) {
    actor(uid);
    assert.equal((await writer(db).acceptFlaggedVersion(req, { ...scope, versionId: A, intentDigest: dg, operationId: OP })).status, expect, uid + " accept");
    assert.equal((await writer(db).rejectFlaggedVersion(req, { ...scope, versionId: A, intentDigest: dg, operationId: OP })).status, expect, uid + " reject");
    assert.deepEqual(db.read(NODE()), node, uid + " changed nothing");
  }
  actor("ownerOther");
  assert.equal((await writer(db).acceptFlaggedVersion(req, { ...scope, versionId: A, intentDigest: dg, operationId: OP })).status, "resolved", "a tenant-wide owner with no row for this business decides");
  assert.equal(db.read(NODE()).review[A].decisionAudit.decidedBy, "ownerOther");
  // the owner without ANY biz_access row: activate (another world), reject, re-activate
  const db2 = world(); actor("owner");
  const act = await writer(db2).activateCostHistory(req, { ...scope, body: body(A) });
  assert.equal(act.status, "committed_current"); assert.equal(act.review, "cleared");
  const { node: n2 } = await flaggedByManager(db2, A2, db2.read(NODE()).head);
  actor("owner");
  assert.equal((await writer(db2).rejectFlaggedVersion(req, { ...scope, versionId: A2, intentDigest: n2.review[A2].intentDigest, operationId: OP })).status, "resolved");
  assert.deepEqual(codec.decodeHistory({ exists: true, value: db2.read(NODE()) }, scope).versions.map((v) => v.versionId), [A]);
});

test("RL4-T02 no operation succeeds for an ABSENT or FOREIGN-tenant business: activate, edit, read, recover, accept, reject and reconcile all refuse; a tenant's own list is the only authority", async () => {
  const db = world();
  const { node } = await flaggedByManager(db);
  const dg = node.review[A].intentDigest;
  // a business that is not in the registry (even with a seeded node and biz_access rows)
  db.seed(`tenants/${T}/biz:${GHOST}:cost_history`, clone(node)); db.seed(`tenants/${T}/biz_access/${GHOST}/manager`, true);
  const ghost = { tenantId: T, bizId: GHOST };
  for (const uid of ["owner", "manager"]) {
    actor(uid);
    assert.equal((await writer(db).activateCostHistory(req, { ...ghost, body: body(A2) })).status, uid === "owner" ? "business_not_in_tenant" : "role_not_allowed", uid + " activate");
    assert.equal((await writer(db).recordCostEdit(req, { ...ghost, body: body(A2, node.head) })).status, "business_not_in_tenant", uid + " edit");
    assert.equal((await writer(db).readCostHistory(req, ghost)).status, "business_not_in_tenant", uid + " read");
    assert.equal((await writer(db).recoverSave(req, { ...ghost, body: body(A), recordedAtHint: NOW })).status, "business_not_in_tenant", uid + " recover");
  }
  actor("owner");
  assert.equal((await writer(db).acceptFlaggedVersion(req, { ...ghost, versionId: A, intentDigest: dg, operationId: OP })).status, "business_not_in_tenant");
  assert.equal((await writer(db).rejectFlaggedVersion(req, { ...ghost, versionId: A, intentDigest: dg, operationId: OP })).status, "business_not_in_tenant");
  assert.equal((await writer(db).reconcilePendingReviews({ ...ghost, authorize: async () => {} })).status, "business_not_in_tenant");
  assert.deepEqual(db.read(`tenants/${T}/biz:${GHOST}:cost_history`), node, "ghost node untouched");
  // a business registered ONLY in another tenant is foreign here, whatever the other tenant's list says
  db.seed(REGISTRY, { _v: JSON.stringify([{ id: B2 }]) });
  assert.equal((await writer(db).readCostHistory(req, scope)).status, "business_not_in_tenant", "removed from this tenant's list ⇒ unreadable here even though tenantZ lists the same id");
  assert.equal((await writer(db).acceptFlaggedVersion(req, { ...scope, versionId: A, intentDigest: dg, operationId: OP })).status, "business_not_in_tenant");
  actor("foreign");
  assert.equal((await writer(db).readCostHistory(req, { tenantId: "tenantZ", bizId: B })).status, "absent", "the foreign owner reads only its own tenant's (absent) node");
  assert.equal((await writer(db).readCostHistory(req, scope)).status, "unauthorized");
  // the registry must be the tenant's own string-envelope list; malformed ⇒ unavailable, never "registered"
  actor("owner");
  for (const bad of [null, { _v: "{}" }, { _v: "[\"bizA\"]" }, { _v: 7 }, { list: [{ id: B }] }, { _v: "[{\"id\":\"bizA\"" }]) {
    db.seed(REGISTRY, bad);
    const r = await writer(db).readCostHistory(req, scope);
    assert.ok(["authorization_unavailable", "business_not_in_tenant"].includes(r.status), JSON.stringify(bad) + " ⇒ " + r.status);
  }
});

test("RL4-T03 the registered-business read boundary: readCostHistory for a registered business returns the structural snapshot; an unregistered one never returns data (Codex READ_UNREGISTERED)", async () => {
  const db = world();
  const { node } = await flaggedByManager(db);
  assert.equal((await writer(db).readCostHistory(req, scope)).status, "present");
  db.seed(REGISTRY, { _v: "[]" });
  const r = await writer(db).readCostHistory(req, scope);
  assert.equal(r.status, "business_not_in_tenant"); assert.equal(r.history, undefined);
  assert.deepEqual(db.read(NODE()), node);
});
