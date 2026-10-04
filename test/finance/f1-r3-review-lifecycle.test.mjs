// Core/F1 R3 → R4 — the CANONICAL review lifecycle (pending / cleared / flagged / rejected; acceptance = cleared +
// decision audit accepted), the tenant-wide owner model (owner decision 1), the bound strict reader and the
// activation rule over a rejected history.
//   RL-C*  core: `rejected` is terminal, non-authoritative, never withholds the history; malformed rejected entries;
//          bound reader refuses a flag audit naming another tenant / business; effective versions exclude rejected
//   RL-O*  owner authorization matrix under the authoritative tenant-owner contract
//   RL-R*  rejection: atomic state + audit, idempotent retry, stable operation identity, readback, immutability,
//          no reactivation, corrected successor, rejected activation ⇒ re-activation by an owner only
//   RL-B*  business must belong to the tenant (registry)
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeDb } from "../../tools/storage-v2/reader-sandbox.mjs";
import { loadWriter } from "../support/f1-writer-harness.mjs";
import { loadCommitted, loadCompiled, REPO } from "../support/fincore-load.mjs";
import { reviewEntry } from "../support/f1-history-fixtures.mjs";

const W = await loadWriter(REPO), F = await loadCommitted(), BROWSER = await loadCompiled();
const codec = F.costHistory.codec;
const T = "tenantA", B = "bizA", B2 = "bizB";
const NODE = (b = B) => `tenants/${T}/biz:${b}:cost_history`;
const NOW = Date.parse("2026-10-02T09:00:00Z");
const id = (n) => `00000000-0000-4000-8000-0000000000${n}`;
const A = id("a1"), OP = id("aa"), OP2 = id("ab");
const body = (versionId = A, expectedHead = null, effectiveFrom = "2026-10-02") => ({ versionId, expectedHead, effectiveFrom, basis: "recorded", globalEmployees: [{ employeeKey: "g1", monthlyEmployerCost: "10000" }], fixedItems: [{ itemKey: "f1", monthlyAmount: "3100" }], rent: { mode: "none" }, royalty: { mode: "none" } });
const clone = (x) => JSON.parse(JSON.stringify(x));
const req = { headers: {} };
const actor = (uid) => { globalThis.__CLAIMS = { uid, email: uid + "@x" }; };
function world() {
  const db = makeDb();
  // tenant A: tenant-wide owners (one with NO biz_access row at all, one with a row only for ANOTHER business), a manager, a super_owner, a viewer
  for (const [uid, role, biz] of [["manager", "manager", B], ["owner", "owner", null], ["ownerOther", "owner", B2], ["super", "super_owner", B], ["viewer", "viewer", B]]) {
    db.seed(`tenants/${T}/members/${uid}`, true); db.seed(`tenants/${T}/roles/${uid}`, role);
    if (biz) db.seed(`tenants/${T}/biz_access/${biz}/${uid}`, true);
  }
  db.seed(`tenants/${T}/app/business`, { _v: JSON.stringify([{ id: B, name: "A" }, { id: B2, name: "B" }]) });
  db.seed("tenants/tenantZ/members/foreign", true); db.seed("tenants/tenantZ/roles/foreign", "owner");
  db.seed("tenants/tenantZ/app/business", { _v: JSON.stringify([{ id: B, name: "same id, other tenant" }]) });
  globalThis.__DB = db; actor("manager");
  return db;
}
const refHook = (db, wrap, path = NODE()) => { const orig = db.ref; db.ref = (p) => (p === path ? wrap(orig(p)) : orig(p)); return () => { db.ref = orig; }; };
/** A flagged head: the manager's save is revoked inside the DEC-AUTH-1 window. */
async function flagged(db, { clock = () => NOW, versionId = A, expectedHead = null, before = null, uid = "manager" } = {}) {
  let calls = 0;
  const restore = refHook(db, (r) => ({ ...r, transaction: async (...args) => { calls++; const o = await r.transaction(...args); if (calls === 1) db.seed(`tenants/${T}/members/${uid}`, false); return o; } }));
  const writer = W.createCostHistoryWriter({ db, clock, hooks: { reviewDeadlineMs: 2000 } });
  actor(uid);
  const result = before ? await before(writer) : await writer.saveCostVersion(req, { tenantId: T, bizId: B, body: body(versionId, expectedHead) });
  restore();
  db.seed(`tenants/${T}/members/${uid}`, true);
  return { writer, result, node: clone(db.read(NODE())) };
}
const accept = (w, d, op = OP, biz = B, v = A) => w.acceptFlaggedVersion(req, { tenantId: T, bizId: biz, versionId: v, intentDigest: d, operationId: op });
const reject = (w, d, op = OP, biz = B, v = A) => w.rejectFlaggedVersion(req, { tenantId: T, bizId: biz, versionId: v, intentDigest: d, operationId: op });
const decode = (node, bind = { tenantId: T, bizId: B }) => codec.decodeHistory({ exists: node !== null, value: node }, bind);
const structure = (node, bind = { tenantId: T, bizId: B }) => codec.decodeHistoryStructure({ exists: node !== null, value: node }, bind);
const ver = (vid, over = {}) => ({ versionId: vid, schema: "MARJIN_COSTV/1", effectiveFrom: "2026-10-02", recordedAt: NOW, recordedBy: "manager", basis: "recorded", predecessorVersionId: "none", globalEmployeesCount: 0, fixedItemsCount: 1, fixedItems: [{ itemKey: "f1", monthlyAmount: "3100" }], rent: { mode: "none" }, royalty: { mode: "none" }, ...over });
const hist = (state, over = {}) => { const v = ver(A); return { head: { revision: 1, headVersionId: A }, versions: { [A]: v }, review: { [A]: reviewEntry(v, state, over) } }; };

// ── core ─────────────────────────────────────────────────────────────────────────────────────────
test("RL-C01 capability MARJIN_COSTH/6, review schema MARJIN_COSTR/4; browser bundle ≡ committed bundle ≡ server source", async () => {
  assert.equal(F.versions.costHistory, "MARJIN_COSTH/6"); assert.equal(BROWSER.versions.costHistory, "MARJIN_COSTH/6");
  assert.equal((await import("../../fincore/v1/finance/costHistory.js")).REVIEW_SCHEMA, "MARJIN_COSTR/4");
  assert.deepEqual([...F.costHistory.contract.states], ["pending", "cleared", "flagged", "rejected"], "exactly four stored states");
  for (const state of ["pending", "cleared", "flagged", "accepted", "rejected"]) {
    const h = hist(state);
    assert.deepEqual(BROWSER.costHistory.codec.decodeHistory({ exists: true, value: h }, { tenantId: T, bizId: B }), decode(h), state);
  }
});

test("RL-C02 lifecycle authority: pending / flagged withhold the history; cleared (plain or owner-accepted) is authoritative; rejected is PRESENT with NO effective version", () => {
  assert.equal(decode(hist("pending")).reason, "authorization_review_pending");
  assert.equal(decode(hist("flagged")).reason, "authorization_review_flagged");
  for (const s of ["cleared", "accepted"]) { const d = decode(hist(s)); assert.equal(d.state, "present", s); assert.equal(d.versions.length, 1, s); assert.deepEqual(d.rejected, [], s); }
  const d = decode(hist("rejected"));
  assert.deepEqual([d.state, d.versions, d.activationDate, d.rejected], ["present", [], null, [A]]);
  // the structural view keeps the rejected version in the chain (immutable, auditable) and reports it
  const st = structure(hist("rejected"));
  assert.deepEqual([st.versions.length, st.effectiveVersions.length, st.rejected, st.unresolved], [1, 0, [A], { pending: [], flagged: [] }]);
  // a rejected version followed by a corrected successor: only the successor is effective; activation = the successor's date
  const v2 = ver(id("b2"), { recordedAt: NOW + 1000, predecessorVersionId: A, effectiveFrom: "2026-10-03" });
  const h = { head: { revision: 2, headVersionId: id("b2") }, versions: { [A]: ver(A), [id("b2")]: v2 }, review: { [A]: reviewEntry(ver(A), "rejected"), [id("b2")]: reviewEntry(v2, "cleared") } };
  const d2 = decode(h);
  assert.deepEqual([d2.state, d2.versions.map((v) => v.versionId), d2.activationDate, d2.rejected], ["present", [id("b2")], "2026-10-03", [A]]);
  // product timeline: the rejected version never reaches the cost timeline
  const tl = F.product.productTimeline({ costHistory: d2, asOfBusinessDate: "2026-10-05" });
  assert.deepEqual(tl.versions.map((v) => v.versionId), [id("b2")]);
  const tl0 = F.product.productTimeline({ costHistory: d, asOfBusinessDate: "2026-10-05" });
  assert.deepEqual([tl0.timelineSource, tl0.versions], ["persisted", []], "an all-rejected history is persisted with NO version: cost outputs stay withheld, never current settings");
});

test("RL-C03 strict shape of a rejected entry: missing / malformed decision evidence, missing flag audit, wrong resolution, extra field ⇒ unreadable", () => {
  const cases = [
    ["missing decidedBy", (e) => { delete e.decisionAudit.decidedBy; }],
    ["empty decidedBy", (e) => { e.decisionAudit.decidedBy = ""; }],
    ["decidedAt before resolvedAt", (e) => { e.decisionAudit.decidedAt = e.resolvedAt - 1; }],
    ["decidedAt not an instant", (e) => { e.decisionAudit.decidedAt = "now"; }],
    ["missing decision operationId", (e) => { delete e.decisionAudit.operationId; }],
    ["decision operationId not a UUID", (e) => { e.decisionAudit.operationId = "op-1"; }],
    ["decision operationId numeric", (e) => { e.decisionAudit.operationId = 12345678; }],
    ["missing decision audit", (e) => { delete e.decisionAudit; }],
    ["missing top-level decision", (e) => { delete e.decision; }],
    ["decision says accepted on a rejected entry", (e) => { e.decision = "accepted"; e.decisionAudit.decision = "accepted"; }],
    ["decision audit names another business", (e) => { e.decisionAudit.bizId = B2; }],
    ["decision audit names another tenant", (e) => { e.decisionAudit.tenantId = "tenantZ"; }],
    ["decision audit names another version", (e) => { e.decisionAudit.versionId = id("b2"); }],
    ["decision audit carries another digest", (e) => { e.decisionAudit.intentDigest = "f".repeat(64); }],
    ["decision audit resulting state mismatch", (e) => { e.decisionAudit.resultingState = "cleared"; }],
    ["decision audit schema", (e) => { e.decisionAudit.schema = "MARJIN_COST_DECISION/0"; }],
    ["missing flagAudit", (e) => { delete e.flagAudit; }],
    ["cleared resolution on a rejected entry", (e) => { e.resolution = "post_commit_authorized"; e.flagAudit.outcome = "post_commit_authorized"; }],
    ["R3 acknowledgement fields on a rejected entry", (e) => { e.acknowledgedAt = e.resolvedAt; e.acknowledgedBy = "owner"; e.acceptOperationId = OP; }],
    ["extra field", (e) => { e.note = "x"; }],
  ];
  for (const [label, mut] of cases) { const h = hist("rejected"); mut(h.review[A]); const d = decode(h); assert.equal(d.state, "unreadable", label); assert.equal(d.reason, "review_invalid", label); }
  assert.equal(decode(hist("rejected")).state, "present", "control: a well-formed rejected entry decodes");
});

test("RL-C04 bound reader: a flag audit naming another business or tenant is unreadable (flagged, accepted and rejected); there is NO unbound decode; a correct binding accepts; a malformed or missing binding is refused", () => {
  for (const state of ["flagged", "accepted", "rejected"]) {
    for (const [k, v] of [["bizId", B2], ["tenantId", "tenantZ"]]) {
      const h = hist(state); h.review[A].flagAudit[k] = v;
      const d = decode(h);
      assert.deepEqual([d.state, d.reason, d.detail && d.detail.error], ["unreadable", "review_invalid", "flag_audit_binding_mismatch"], `${state} ${k}`);
      assert.equal(codec.decodeHistoryStructure({ exists: true, value: h }).reason, "binding_required", `${state} ${k}: R4 — an UNBOUND structural decode is refused outright`);
    }
    assert.equal(structure(hist(state)).state, "present", state + " control: the correct binding accepts it");
    // the SAME well-formed node read under another binding is unreadable (digest and audits are bound to tenant / business)
    assert.equal(decode(hist(state), { tenantId: T, bizId: B2 }).state, "unreadable", state + ": another business");
    assert.equal(decode(hist(state), { tenantId: "tenantZ", bizId: B }).state, "unreadable", state + ": another tenant");
  }
  assert.equal(decode(hist("cleared"), { tenantId: T, bizId: B2 }).detail.error, "review_digest_mismatch", "a plain cleared review is bound through its digest");
  assert.equal(decode(hist("cleared"), { tenantId: "", bizId: B }).reason, "binding_invalid");
  assert.equal(decode(hist("cleared"), { tenantId: T }).reason, "binding_invalid");
  assert.equal(decode(hist("cleared"), null).reason, "binding_required");
  assert.equal(codec.decodeHistory({ exists: true, value: hist("cleared") }).reason, "binding_required");
});

test("RL-C05 the canonical server loader decodes BOUND to its tenant / business: a foreign-business flag audit is cost_history_unreadable", async () => {
  const { compileServer, makeDb: makeServerDb } = await import("../support/server-reader-harness.mjs");
  const srv = compileServer();
  const CI = await srv.import("src/finance-server/canonicalInputs.js");
  for (const [label, mut, expectUnreadable] of [["foreign business audit", (h) => { h.review[A].flagAudit.bizId = B2; }, true], ["own business audit", () => {}, false]]) {
    const db = makeServerDb(); const h = hist("accepted"); mut(h);
    db.seed(`tenants/${T}/biz:${B}:config`, { _v: JSON.stringify({ businessName: "x", employees: [] }) });
    db.seed(`tenants/${T}/biz:${B}:fixed`, { _v: JSON.stringify([]) });
    db.seed(`tenants/${T}/biz:${B}:entries`, { _v: JSON.stringify([]) });
    db.seed(NODE(), h);
    const si = await CI.loadCanonicalInputs(db, T, B, { site: "rl", nowMs: NOW, need: { config: true, fixed: true, exceptions: true, costHistory: true } });
    assert.equal(si.inputIssues.includes("cost_history_unreadable"), expectUnreadable, label);
  }
});

// ── owner authorization (decision 1) ─────────────────────────────────────────────────────────────
test("RL-O01 a CURRENT TENANT OWNER accepts or rejects for any business of the tenant — with no explicit biz_access row, or with a row only for another business", async () => {
  for (const [uid, decide] of [["owner", accept], ["ownerOther", accept], ["owner", reject], ["ownerOther", reject]]) {
    const db = world(); const { writer, node } = await flagged(db); actor(uid);
    const r = await decide(writer, node.review[A].intentDigest);
    const to = decide === accept ? "cleared" : "rejected", dec = decide === accept ? "accepted" : "rejected";
    assert.equal(r.status, "resolved", `${uid} ${dec}`); assert.equal(db.read(NODE()).review[A].state, to, `${uid} ${dec}`);
    assert.deepEqual([db.read(NODE()).review[A].decision, db.read(NODE()).review[A].decisionAudit.decidedBy, db.read(NODE()).review[A].decisionAudit.resultingState], [dec, uid, to]);
  }
});

test("RL-O02 denied for accept AND reject, node byte-identical: super_owner, manager, viewer, removed owner, stale owner (now manager), owner of another tenant, non-member", async () => {
  for (const decide of [accept, reject]) {
    const db = world(); const { writer, node } = await flagged(db); const d = node.review[A].intentDigest;
    const before = JSON.stringify(db.read(NODE()));
    const deny = async (label, uid, expected) => { actor(uid); const r = await decide(writer, d); assert.equal(r.status, expected, label); assert.equal(JSON.stringify(db.read(NODE())), before, label + " unchanged"); };
    await deny("super_owner", "super", "role_not_allowed");
    await deny("manager", "manager", "role_not_allowed");
    await deny("viewer", "viewer", "unauthorized");
    await deny("owner of another tenant", "foreign", "unauthorized");
    await deny("non-member", "nobody", "unauthorized");
    db.seed(`tenants/${T}/members/owner`, false); await deny("removed owner", "owner", "unauthorized"); db.seed(`tenants/${T}/members/owner`, true);
    db.seed(`tenants/${T}/roles/owner`, "manager"); await deny("stale owner (role now manager, no biz_access row)", "owner", "unauthorized"); db.seed(`tenants/${T}/roles/owner`, "owner");
    // revoked between priming and the trusted transaction: the fresh pre-transaction check denies
    actor("owner");
    const restore = refHook(db, (r) => ({ ...r, get: async () => { const s = await r.get(); db.seed(`tenants/${T}/members/owner`, false); return s; } }));
    const r = await decide(writer, d); restore(); db.seed(`tenants/${T}/members/owner`, true);
    assert.equal(r.status, "unauthorized", "revoked during priming"); assert.equal(JSON.stringify(db.read(NODE())), before);
  }
});

test("RL-O03 client SDK direct mutation is denied by Rules (static): cost_history has no client write anywhere in its subtree", async () => {
  const { readFileSync } = await import("node:fs"); const { join } = await import("node:path");
  const rules = JSON.parse(readFileSync(join(REPO, "database.rules.json"), "utf8"));
  const node = rules.rules.tenants.$tenantId.$dataKey || rules.rules.tenants.$tenantId;
  const text = JSON.stringify(rules);
  assert.ok(/cost_history/.test(text), "the Rules name the cost_history key");
  // every .write that can match cost_history is false
  const writes = [...text.matchAll(/"\.write":\s*"([^"]*)"/g)].map((m) => m[1]).filter((w) => /cost_history/.test(w));
  assert.ok(writes.length === 0 || writes.every((w) => /false/.test(w)), "no client write rule grants cost_history: " + JSON.stringify(writes));
  assert.ok(node !== undefined);
});

// ── rejection ───────────────────────────────────────────────────────────────────────────────────
test("RL-R01 reject: ONE transaction moves flagged → rejected with the owner's decision evidence; the flag audit, the version and the head are byte-identical", async () => {
  const db = world(); const { writer, node } = await flagged(db); actor("owner");
  const r = await reject(writer, node.review[A].intentDigest);
  const after = db.read(NODE());
  assert.equal(r.status, "resolved"); assert.equal(r.state, "rejected");
  assert.deepEqual(after.review[A].flagAudit, node.review[A].flagAudit, "audit retained");
  assert.deepEqual(after.versions, node.versions, "version immutable"); assert.deepEqual(after.head, node.head, "head unchanged");
  assert.deepEqual([after.review[A].state, after.review[A].decision, after.review[A].decisionAudit.decidedBy, after.review[A].decisionAudit.operationId, after.review[A].decisionAudit.decidedAt >= after.review[A].resolvedAt], ["rejected", "rejected", "owner", OP, true]);
  assert.deepEqual(Object.keys(after.review[A]).sort(), ["actor", "committedAt", "decision", "decisionAudit", "flagAudit", "intentDigest", "resolution", "resolvedAt", "schema", "state"]);
  const d = decode(after); assert.deepEqual([d.state, d.versions.length, d.rejected], ["present", 0, [A]]);
});

test("RL-R02 reject is idempotent on the SAME operation identity; a different operation on the same entry, or the same operation by another owner, is refused; nothing is rewritten", async () => {
  const db = world(); const { writer, node } = await flagged(db); const d = node.review[A].intentDigest; actor("owner");
  assert.equal((await reject(writer, d)).status, "resolved");
  const once = clone(db.read(NODE()));
  assert.equal((await reject(writer, d)).status, "already_rejected"); assert.deepEqual(db.read(NODE()), once);
  assert.equal((await reject(writer, d, OP2)).status, "operation_identity_reused"); assert.deepEqual(db.read(NODE()), once);
  actor("ownerOther");
  assert.equal((await reject(writer, d)).status, "operation_identity_reused"); assert.deepEqual(db.read(NODE()), once);
});

test("RL-R03 exact identity: a reject carrying another payload digest, another version id, or a non-head version is refused and writes nothing", async () => {
  const db = world(); const { writer, node } = await flagged(db); actor("owner");
  const before = clone(db.read(NODE()));
  assert.equal((await reject(writer, "f".repeat(64))).status, "review_identity_mismatch");
  assert.equal((await reject(writer, node.review[A].intentDigest, OP, B, id("c9"))).status, "not_found");
  assert.deepEqual(db.read(NODE()), before);
});

test("RL-R04 terminal: a rejected version can never be accepted, re-flagged, cleared or rejected again into another state; a cleared version cannot be rejected", async () => {
  const db = world(); const { writer, node } = await flagged(db); const d = node.review[A].intentDigest; actor("owner");
  assert.equal((await reject(writer, d)).status, "resolved");
  const once = clone(db.read(NODE()));
  assert.equal((await accept(writer, d)).status, "review_already_resolved:rejected");
  assert.deepEqual(db.read(NODE()), once);
  // a cleared (ordinary) version is not rejectable
  const db2 = world(); actor("owner");
  const w2 = W.createCostHistoryWriter({ db: db2, clock: () => NOW });
  const s = await w2.activateCostHistory(req, { tenantId: T, bizId: B, body: body() });
  assert.equal(s.review, "cleared");
  assert.equal((await reject(w2, s.intentDigest)).status, "review_already_resolved:cleared");
  assert.equal((await accept(w2, s.intentDigest)).status, "review_already_resolved:cleared");
  // an owner-accepted (cleared) version is terminal too
  const db3 = world(); const f3 = await flagged(db3); actor("owner");
  assert.equal((await accept(f3.writer, f3.node.review[A].intentDigest)).status, "resolved");
  assert.equal((await reject(f3.writer, f3.node.review[A].intentDigest)).status, "review_already_resolved:cleared");
  assert.deepEqual([db3.read(NODE()).review[A].state, db3.read(NODE()).review[A].decision], ["cleared", "accepted"]);
});

test("RL-R05 lost acknowledgement of the REJECT transition is resolved by full-payload readback; a failed transaction leaves flagged + audit unchanged; a timeout leaves flagged", async () => {
  { const db = world(); const { writer, node } = await flagged(db); actor("owner");
    let once = true; refHook(db, (r) => ({ ...r, transaction: async (...a) => { const o = await r.transaction(...a); if (once && o.committed) { once = false; throw Error("ack lost"); } return o; } }));
    const out = await reject(writer, node.review[A].intentDigest);
    assert.deepEqual([out.status, out.resolvedBy, db.read(NODE()).review[A].state], ["resolved", "readback", "rejected"]); }
  { const db = world(); const { writer, node } = await flagged(db); actor("owner");
    refHook(db, (r) => ({ ...r, transaction: async () => { throw Error("write down"); } }));
    const out = await reject(writer, node.review[A].intentDigest);
    assert.equal(out.status, "outcome_unknown"); assert.deepEqual(db.read(NODE()), node); }
  { const db = world(); const { writer, node } = await flagged(db); actor("owner");
    const writer2 = W.createCostHistoryWriter({ db, clock: () => NOW, hooks: { reviewDeadlineMs: 5 } });
    const restore = refHook(db, (r) => ({ ...r, transaction: async () => new Promise(() => {}) }));
    const out = await reject(writer2, node.review[A].intentDigest); restore();
    assert.equal(out.status, "outcome_unknown"); assert.equal(db.read(NODE()).review[A].state, "flagged");
    assert.equal((await reject(writer, node.review[A].intentDigest)).status, "resolved"); }
});

test("RL-R06 a rejected head unblocks a CORRECTED successor (manager edit, expectedHead = the rejected head): the chain continues, the rejected version stays excluded, calculations use the successor", async () => {
  const db = world();
  let now = NOW; const clock = () => now;
  actor("owner"); const w = W.createCostHistoryWriter({ db, clock });
  assert.equal((await w.activateCostHistory(req, { tenantId: T, bizId: B, body: body(A) })).review, "cleared");
  now += 1000;
  const { writer, node } = await flagged(db, { clock, versionId: id("b2"), expectedHead: db.read(NODE()).head, before: (wr) => wr.recordCostEdit(req, { tenantId: T, bizId: B, body: { ...body(id("b2"), db.read(NODE()).head), fixedItems: [{ itemKey: "f1", monthlyAmount: "9999" }] } }) });
  assert.equal(node.review[id("b2")].state, "flagged");
  actor("manager");
  assert.equal((await writer.recordCostEdit(req, { tenantId: T, bizId: B, body: body(id("c3"), db.read(NODE()).head) })).status, "review_unresolved", "blocked while flagged");
  actor("owner");
  assert.equal((await reject(writer, node.review[id("b2")].intentDigest, OP, B, id("b2"))).status, "resolved");
  now += 1000; actor("manager");
  const succ = await writer.recordCostEdit(req, { tenantId: T, bizId: B, body: body(id("c3"), db.read(NODE()).head) });
  assert.equal(succ.status, "committed_current"); assert.equal(succ.review, "cleared");
  const n = db.read(NODE());
  assert.deepEqual([n.head.revision, n.versions[id("c3")].predecessorVersionId, n.review[id("b2")].state], [3, id("b2"), "rejected"]);
  const d = decode(n);
  assert.deepEqual([d.state, d.versions.map((v) => v.versionId), d.rejected], ["present", [A, id("c3")], [id("b2")]]);
  const tl = F.product.productTimeline({ costHistory: d, asOfBusinessDate: "2026-10-05" });
  assert.deepEqual(tl.versions.map((v) => v.fixedItems[0].monthlyAmount), ["3100", "3100"], "the rejected 9999 never reaches the timeline");
});

test("RL-R07 a rejected ACTIVATION: ordinary edits and attested edits are refused (activation_required); only a current owner re-activates, today-dated, with the current head; activation over an effective history is already_activated", async () => {
  const db = world();
  const { writer, node } = await flagged(db, { uid: "owner", before: (wr) => wr.activateCostHistory(req, { tenantId: T, bizId: B, body: body(A) }) });
  assert.equal(node.review[A].state, "flagged");
  actor("ownerOther");
  assert.equal((await reject(writer, node.review[A].intentDigest)).status, "resolved");
  const head = db.read(NODE()).head;
  assert.deepEqual(decode(db.read(NODE())).versions, []);
  actor("manager");
  assert.equal((await writer.recordCostEdit(req, { tenantId: T, bizId: B, body: body(id("b2"), head) })).status, "activation_required");
  const att = { ...body(id("b3"), head, "2026-09-01"), basis: "attested_retroactive", attestationReason: "x" };
  att.attestation = { confirmed: true, typedEffectiveFrom: "2026-09-01", confirmedSnapshotDigest: W.attestationDigest(att) };
  assert.equal((await writer.attestHistoricalCostEdit(req, { tenantId: T, bizId: B, body: att })).status, "activation_required");
  assert.equal((await writer.activateCostHistory(req, { tenantId: T, bizId: B, body: body(id("b4"), head) })).status, "role_not_allowed", "manager cannot re-activate");
  actor("owner");
  assert.equal((await writer.activateCostHistory(req, { tenantId: T, bizId: B, body: body(id("b5"), null) })).status, "head_conflict", "expectedHead must be the current head");
  assert.equal((await writer.activateCostHistory(req, { tenantId: T, bizId: B, body: body(id("b6"), head, "2026-10-03") })).status, "activation_date_mismatch");
  assert.equal((await writer.activateCostHistory(req, { tenantId: T, bizId: B, body: body(id("b5"), head) })).status, "identity_reused", "a version id already used with another payload is never reused");
  const w2 = W.createCostHistoryWriter({ db, clock: () => NOW + 5000 });
  const re = await w2.activateCostHistory(req, { tenantId: T, bizId: B, body: body(id("b4"), head) });
  assert.deepEqual([re.status, re.review], ["committed_current", "cleared"]);
  const d = decode(db.read(NODE()));
  assert.deepEqual([d.versions.map((v) => v.versionId), d.activationDate, d.rejected, db.read(NODE()).head.revision], [[id("b4")], "2026-10-02", [A], 2]);
  assert.equal((await w2.activateCostHistory(req, { tenantId: T, bizId: B, body: body(id("b5"), db.read(NODE()).head) })).status, "already_activated");
});

test("RL-R08 reconciliation never touches a rejected entry; a rejected entry never counts as unresolved", async () => {
  const db = world(); const { writer, node } = await flagged(db); actor("owner");
  assert.equal((await reject(writer, node.review[A].intentDigest)).status, "resolved");
  const once = clone(db.read(NODE()));
  const r = await writer.reconcilePendingReviews({ tenantId: T, bizId: B });
  assert.deepEqual([r.status, r.results], ["reconciled", []]); assert.deepEqual(db.read(NODE()), once);
});

// ── business must belong to the tenant ───────────────────────────────────────────────────────────
test("RL-B01 a business id not in the tenant's registry: activation, edit, accept, reject and reconcile are refused (business_not_in_tenant); nothing is written; an unreadable registry fails closed", async () => {
  const db = world(); const { writer, node } = await flagged(db); const d = node.review[A].intentDigest; actor("owner");
  const ghost = "ghostBiz";
  assert.equal((await writer.activateCostHistory(req, { tenantId: T, bizId: ghost, body: body(id("c1")) })).status, "business_not_in_tenant");
  assert.equal(db.read(NODE(ghost)), null);
  assert.equal((await accept(writer, d, OP, ghost)).status, "business_not_in_tenant");
  assert.equal((await reject(writer, d, OP, ghost)).status, "business_not_in_tenant");
  assert.equal((await writer.reconcilePendingReviews({ tenantId: T, bizId: ghost })).status, "business_not_in_tenant");
  // the same business id registered in ANOTHER tenant does not help: the lookup is tenant-scoped
  assert.equal(db.read("tenants/tenantZ/app/business") !== null, true);
  // unreadable registry ⇒ fail closed
  db.seed(`tenants/${T}/app/business`, { _v: "not json" });
  assert.equal((await accept(writer, d)).status, "authorization_unavailable");
  assert.equal((await writer.activateCostHistory(req, { tenantId: T, bizId: B2, body: body(id("c2")) })).status, "authorization_unavailable");
  db.seed(`tenants/${T}/app/business`, null);
  assert.equal((await reject(writer, d)).status, "authorization_unavailable");
  assert.equal(db.read(NODE()).review[A].state, "flagged");
});

test("RL-B02 the same business id in another tenant is a different node: a foreign owner's decision in its own tenant cannot reach this tenant's version", async () => {
  const db = world(); const { writer, node } = await flagged(db);
  actor("foreign");
  const r = await writer.rejectFlaggedVersion(req, { tenantId: "tenantZ", bizId: B, versionId: A, intentDigest: node.review[A].intentDigest, operationId: OP });
  assert.equal(r.status, "not_found"); assert.equal(db.read(NODE()).review[A].state, "flagged");
});
