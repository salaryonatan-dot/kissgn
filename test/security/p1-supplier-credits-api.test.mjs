// P1 Supplier Credits (P1 R1, MARJIN_CREDITS/4) — storage domain (lib/supplierCredits.js), repository and
// the REAL api/admin.js handlers with ONLY the Admin-SDK / auth / email seams replaced.
//   SC-L*  pure domain: create / void / replace / owner decisions, idempotency, CAS, limits, fail-closed nodes
//   SC-P*  parity: the writer's amount / id / document rules ≡ the Financial Core decoder; every write decodes VALID
//   SC-A*  authorization: unauthenticated, viewer / shift_manager, removed member, cross-business, cross-tenant,
//          unknown supplier, unreadable supplier list, version fence, DEC-AUTH-1 (pre-check immediately before
//          the transaction, durable post-commit review)
//   SC-C*  concurrency: stale sequence, double void, replay, idempotency conflict, actor-bound replay
//   SC-S*  surface
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, cpSync, mkdirSync, symlinkSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { makeDb, installDb, ROOT, T, B } from "../support/server-reader-harness.mjs";
import { loadCommitted } from "../support/fincore-load.mjs";
import * as SC from "../../lib/supplierCredits.js";

const CORE = (await loadCommitted()).finance.supplierCredits;

// ── the real handler with only the Admin-SDK / auth / email seams replaced ──────
const dir = mkdtempSync(join(tmpdir(), "p1-admin-"));
cpSync(join(ROOT, "lib"), join(dir, "lib"), { recursive: true });
mkdirSync(join(dir, "api"), { recursive: true });
cpSync(join(ROOT, "api", "admin.js"), join(dir, "api", "admin.js"));
mkdirSync(join(dir, "fincore"), { recursive: true });
cpSync(join(ROOT, "fincore", "v1"), join(dir, "fincore", "v1"), { recursive: true });
try { symlinkSync(join(ROOT, "node_modules"), join(dir, "node_modules"), "dir"); } catch (_) {}
writeFileSync(join(dir, "lib", "adminSdk.js"), `export function getAdminDb() { return globalThis.__DB; }\nexport function getAdminAuth() { return { getUser: async () => ({}) }; }\n`);
writeFileSync(join(dir, "lib", "verifyToken.js"), `export async function requireAuth() { if (!globalThis.__CLAIMS) throw new Error("no auth"); return globalThis.__CLAIMS; }\nexport async function verifyIdToken() { return globalThis.__CLAIMS; }\n`);
writeFileSync(join(dir, "lib", "sendEmail.js"), `export async function sendEmail() { return { messageId: "m" }; }\nexport async function sendAlertDigest() { return { messageId: "d" }; }\n`);
const handler = (await import(pathToFileURL(join(dir, "api", "admin.js")).href)).default;

const NODE = `tenants/${T}/biz:${B}:supplier_credits`;
const SUPPLIERS = [{ id: "s1", name: "קוקה קולה" }, { id: 2, name: "ירקות" }];
const cid = (n) => `c0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const oid = (n) => `0a000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
function seed({ role = "owner", uid = "u1", member = true, bizAccess = true, policy, suppliers = SUPPLIERS } = {}) {
  const db = installDb(makeDb());
  db.seed(`tenants/${T}/app/business`, { _v: JSON.stringify([{id:B},{id:"bizB"}]) });
  db.seed(`tenants/${T}/members/${uid}`, member);
  db.seed(`tenants/${T}/roles/${uid}`, role);
  if (bizAccess) db.seed(`tenants/${T}/biz_access/${B}/${uid}`, true);
  if (suppliers !== undefined) db.seed(`tenants/${T}/biz:${B}:suppliers`, suppliers === null ? null : { _v: JSON.stringify(suppliers) });
  if (policy !== undefined) db.seed(`storage_v2_control/${T}/${B}`, policy);
  // a second tenant / business the caller does NOT belong to
  db.seed(`tenants/tenantB/members/uB`, true); db.seed(`tenants/tenantB/roles/uB`, "owner");
  db.seed(`tenants/${T}/biz:bizB:suppliers`, { _v: JSON.stringify(SUPPLIERS) });
  globalThis.__CLAIMS = { uid, email: uid + "@example.invalid" };
  return db;
}
async function call(action, body, method = "POST", query = {}) {
  const r = { code: null, body: null, setHeader() {}, status(n) { this.code = n; return this; }, json(v) { this.body = v; return this; }, end() { return this; } };
  await handler({ method, query: { action, ...query }, headers: { authorization: "Bearer t" }, body }, r);
  return { code: r.code, body: r.body };
}
const CREATE = (n, over = {}) => ({ tenantId: T, bizId: B, creditId: cid(n), operationId: oid(n), supplierId: "s1", issueDate: "2026-10-02", amount: "300.50", documentNumber: "CR-" + n, ...over });
const stored = (db) => db.read(NODE);
const decoded = (db) => CORE.decodeSupplierCredits(SC.safeNodeView(stored(db)), { tenantId: T, bizId: B });

// ── SC-L pure domain ───────────────────────────────────────────────────────────
const cmd = (over) => { const c = { tenantId: T, bizId: B, actorUid: "u1", actorRole: "owner", now: 1000, ...over }; c.requestHash = SC.requestHash(c); return c; };
const input = (over = {}) => SC.validateCreditInput({ supplierId: "s1", issueDate: "2026-10-02", amount: "300", documentNumber: "CR-1", ...over });
const applied = (node, c) => { const r = SC.applyCreditOperation(node, c); assert.equal(r.outcome, "applied", JSON.stringify(r)); return r.node; };
const cleared = (node, op, now = 1001) => SC.applyReviewTransition(node, { tenantId: T, bizId: B, operationId: op, intentDigest: node.review[op].intentDigest, to: "cleared", resolution: "post_commit_authorized", now }).node;

test("SC-L01 create on an absent node: MARJIN_CREDITS/4 envelope bound to tenant + business, immutable record, identity reservation, head, PENDING review, ledger", () => {
  const r = SC.applyCreditOperation(null, cmd({ action: "create", creditId: cid(1), operationId: oid(1), input: input() }));
  assert.equal(r.outcome, "applied");
  const n = r.node;
  assert.deepEqual([n.schemaVersion, n.contract, n.tenantId, n.bizId, n.revision], [4, "MARJIN_CREDITS/4", T, B, 1]);
  assert.deepEqual(n.records[cid(1)], { creditId: cid(1), logicalId: cid(1), tenantId: T, bizId: B, supplierId: "s1", issueDate: "2026-10-02", amount: "300", documentNumber: "CR-1", documentKey: "cr~2d~1", operationId: oid(1), seq: 1, createdAt: 1000, createdBy: "u1", createdRole: "owner" });
  assert.deepEqual(n.documents, { s_s1: { "d_cr~2d~1": { logicalId: cid(1), creditId: cid(1), operationId: oid(1), reservedAt: 1000, reservedBy: "u1" } } });
  assert.deepEqual(n.heads, { [cid(1)]: { creditId: cid(1), seq: 1 } });
  assert.equal(n.review[oid(1)].state, "pending"); assert.equal(n.review[oid(1)].kind, "create"); assert.match(n.review[oid(1)].intentDigest, /^[0-9a-f]{64}$/);
  assert.equal(n.review[oid(1)].intentDigest, SC.storedIntentDigest(n, oid(1)), "the review is bound to the full stored payload");
  assert.equal(n.operations[oid(1)].kind, "create"); assert.equal(n.operations[oid(1)].by, "u1");
  assert.deepEqual(r.result, { kind: "create", logicalId: cid(1), creditId: cid(1), seq: 1, intentDigest: n.review[oid(1)].intentDigest, revision: 1 });
});

test("SC-L02 validateCreditInput: supplier, issue date, positive canonical amount, MANDATORY document number, bounded note — rejected never truncated", () => {
  assert.deepEqual(input({ amount: "300.50", documentNumber: "  CR   9 ", note: "  " }), { supplierId: "s1", issueDate: "2026-10-02", amount: "300.5", documentNumber: "CR 9", documentKey: "cr~20~9", documentFingerprint: "cr9" });
  const bad = [
    [{ supplierId: "" }, "invalid_supplier_id"], [{ supplierId: "a/b" }, "invalid_supplier_id"], [{ supplierId: 2 }, "invalid_supplier_id"],
    [{ issueDate: "2027-02-29" }, "invalid_issue_date"], [{ issueDate: "2026-10-2" }, "invalid_issue_date"], [{ issueDate: undefined }, "invalid_issue_date"],
    [{ amount: "0" }, "invalid_amount"], [{ amount: "-5" }, "invalid_amount"], [{ amount: 5 }, "invalid_amount"], [{ amount: "5.001" }, "invalid_amount"], [{ amount: "1,000" }, "invalid_amount"],
    [{ documentNumber: undefined }, "document_number_required"], [{ documentNumber: null }, "document_number_required"], [{ documentNumber: "   " }, "document_number_required"],
    [{ documentNumber: "x".repeat(65) }, "invalid_document_number_too_long"], [{ documentNumber: 7 }, "invalid_document_number"], [{ documentNumber: "a\u0001" }, "invalid_document_number"],
    [{ documentNumber: "--" }, "invalid_document_number_chars"], [{ documentNumber: "CR*1" }, "invalid_document_number_chars"],
    [{ note: "x".repeat(501) }, "invalid_note_too_long"],
  ];
  for (const [o, code] of bad) assert.throws(() => input(o), (e) => e.code === code, JSON.stringify(o));
});

test("SC-L03 create never overwrites: an existing creditId is credit_id_exists; the operation limit refuses (never prunes)", () => {
  const a = applied(null, cmd({ action: "create", creditId: cid(1), operationId: oid(1), input: input() }));
  assert.deepEqual(SC.applyCreditOperation(a, cmd({ action: "create", creditId: cid(1), operationId: oid(2), input: input({ documentNumber: "CR-2" }) })), { outcome: "conflict", code: "credit_id_exists" });
  const ops = { ...a, operations: { ...a.operations, ...Object.fromEntries(Array.from({ length: SC.MAX_OPERATIONS }, (_, i) => [oid(i + 10), {}])) } };
  assert.deepEqual(SC.applyCreditOperation(ops, cmd({ action: "create", creditId: cid(2), operationId: oid(3), input: input({ documentNumber: "CR-2" }) })), { outcome: "conflict", code: "operation_limit_reached" });
});

test("SC-L04 void is an immutable event (who / when / why); the record payload never changes; the head sequence is the CAS; no hard delete exists", () => {
  const a = cleared(applied(null, cmd({ action: "create", creditId: cid(1), operationId: oid(1), input: input() })), oid(1));
  assert.deepEqual(SC.applyCreditOperation(a, cmd({ action: "void", creditId: cid(1), operationId: oid(2), expectedSeq: 2 })), { outcome: "conflict", code: "revision_conflict" });
  const v = SC.applyCreditOperation(a, cmd({ action: "void", creditId: cid(1), operationId: oid(2), expectedSeq: 1, voidReason: "duplicate", now: 2000 }));
  assert.equal(v.outcome, "applied");
  assert.deepEqual(v.node.records[cid(1)], a.records[cid(1)], "the record itself is byte-identical (immutable)");
  assert.deepEqual(v.node.voids[oid(2)], { operationId: oid(2), kind: "void", creditId: cid(1), logicalId: cid(1), seq: 2, voidedAt: 2000, voidedBy: "u1", voidedRole: "owner", reasonCode: "voided", reasonText: "duplicate" });
  assert.deepEqual(v.node.heads[cid(1)], { creditId: cid(1), seq: 2 });
  assert.equal(SC.applyCreditOperation(v.node, cmd({ action: "void", creditId: cid(1), operationId: oid(3), expectedSeq: 2 })).code, "review_unresolved", "a second change waits for the first one's review");
  const vc = cleared(v.node, oid(2), 2001);
  assert.deepEqual(SC.applyCreditOperation(vc, cmd({ action: "void", creditId: cid(1), operationId: oid(3), expectedSeq: 2 })), { outcome: "conflict", code: "credit_not_active" });
  assert.deepEqual(SC.applyCreditOperation(vc, cmd({ action: "void", creditId: cid(5), operationId: oid(4), expectedSeq: 1 })), { outcome: "conflict", code: "credit_not_found" });
  for (const action of ["delete", "remove", "hard_delete", "update"]) assert.deepEqual(SC.applyCreditOperation(vc, cmd({ action, creditId: cid(1), operationId: oid(9) })), { outcome: "conflict", code: "invalid_action" });
  assert.doesNotMatch(readFileSync(join(ROOT, "lib", "supplierCredits.js"), "utf8").replace(/\/\/.*$/gm, ""), /delete\s+(recs|node\.records|node\.voids|node\.documents)\[|\.remove\(/, "no destructive path in the domain");
});

test("SC-L05 replace = a traceable successor in ONE operation: the predecessor stays immutable, a replace event links both ways, the pointer moves; same document identity unless explicitly corrected", () => {
  const a = cleared(applied(null, cmd({ action: "create", creditId: cid(1), operationId: oid(1), input: input() })), oid(1));
  const r = SC.applyCreditOperation(a, cmd({ action: "replace", creditId: cid(1), newCreditId: cid(2), operationId: oid(2), expectedSeq: 1, input: input({ amount: "250", issueDate: "2026-10-05", documentNumber: "cr-1" }), now: 3000 }));
  assert.equal(r.outcome, "applied");
  assert.deepEqual(r.node.records[cid(1)], a.records[cid(1)]);
  assert.equal(r.node.records[cid(2)].replacesCreditId, cid(1)); assert.equal(r.node.records[cid(2)].logicalId, cid(1)); assert.equal(r.node.records[cid(2)].issueDate, "2026-10-05");
  assert.equal(r.node.records[cid(2)].identityCorrection, undefined, "same normalized number: same identity");
  assert.equal(r.node.voids[oid(2)].replacedByCreditId, cid(2));
  assert.deepEqual(r.node.heads[cid(1)], { creditId: cid(2), seq: 2 });
  assert.deepEqual(SC.datesOfOperation(r.node, oid(2)), ["2026-10-02", "2026-10-05"], "both issue dates must be rebuilt");
  assert.equal(SC.applyCreditOperation(a, cmd({ action: "replace", creditId: cid(1), newCreditId: cid(3), operationId: oid(3), expectedSeq: 1, input: input({ documentNumber: "CR-77" }) })).code, "identity_change_requires_correction");
  assert.equal(SC.applyCreditOperation(a, cmd({ action: "replace", creditId: cid(1), newCreditId: cid(3), operationId: oid(3), expectedSeq: 1, identityCorrection: true, input: input() })).code, "identity_correction_not_applicable");
  const c = SC.applyCreditOperation(a, cmd({ action: "replace", creditId: cid(1), newCreditId: cid(3), operationId: oid(3), expectedSeq: 1, identityCorrection: true, input: input({ documentNumber: "CR-77" }) }));
  assert.equal(c.outcome, "applied"); assert.equal(c.node.records[cid(3)].identityCorrection, true);
  assert.ok(c.node.documents.s_s1["d_cr~2d~1"] && c.node.documents.s_s1["d_cr~2d~77"], "old identity still reserved; the corrected one reserved for the same logical credit");
  assert.equal(c.node.documents.s_s1["d_cr~2d~77"].logicalId, cid(1));
  assert.equal(SC.applyCreditOperation(a, cmd({ action: "replace", creditId: cid(1), newCreditId: cid(1), operationId: oid(4), expectedSeq: 1, input: input() })).code, "credit_id_exists");
});

test("SC-L06 idempotency: the same operationId + same request + same actor replays (no second write); another request or another actor is idempotency_conflict", () => {
  const c1 = cmd({ action: "create", creditId: cid(1), operationId: oid(1), input: input() });
  const a = applied(null, c1);
  const re = SC.applyCreditOperation(a, c1);
  assert.equal(re.outcome, "replayed"); assert.deepEqual(re.result, { kind: "create", logicalId: cid(1), creditId: cid(1), seq: 1, intentDigest: a.review[oid(1)].intentDigest, revision: 1 });
  assert.equal(SC.applyCreditOperation(a, cmd({ action: "create", creditId: cid(1), operationId: oid(1), input: input({ amount: "1" }) })).code, "idempotency_conflict");
  assert.equal(SC.applyCreditOperation(a, { ...c1, actorUid: "other" }).code, "idempotency_conflict", "another actor can never replay (or learn) someone else's operation");
  assert.equal(SC.requestHash(c1), SC.requestHash({ ...c1, now: 99, actorUid: "other" }), "the hash covers the semantic request; the actor is bound separately");
});

test("SC-L07 fail-closed: no write over an unreadable node, a v1 node, or a node with a data defect", () => {
  for (const bad of ["x", 7, [], { schemaVersion: 1, revision: 1, records: {} }, { schemaVersion: 2, revision: 1 }])
    assert.equal(SC.applyCreditOperation(bad, cmd({ action: "create", creditId: cid(1), operationId: oid(1), input: input() })).code, "node_unreadable", JSON.stringify(bad));
  const a = applied(null, cmd({ action: "create", creditId: cid(1), operationId: oid(1), input: input() }));
  const broken = JSON.parse(JSON.stringify(a)); delete broken.records[cid(1)].createdBy;
  assert.deepEqual(SC.applyCreditOperation(broken, cmd({ action: "create", creditId: cid(2), operationId: oid(2), input: input({ documentNumber: "CR-2" }) })), { outcome: "conflict", code: "node_unreadable", detail: "invalid_credit_data" });
  assert.equal(SC.safeNodeView(undefined), null); assert.equal(SC.safeNodeView(null), null);
  assert.equal(SC.safeNodeView(a).operations, undefined, "readers never see the operation ledger");
});

test("SC-L08 the owner's decision on a FLAGGED operation: accept ⇒ cleared + accepted; reject ⇒ rejected; never on pending / cleared; digest-bound; owner only", () => {
  const a = applied(null, cmd({ action: "create", creditId: cid(1), operationId: oid(1), input: input() }));
  const d = a.review[oid(1)].intentDigest;
  const dec = (node, over) => SC.applyCreditOperation(node, cmd({ action: "review_accept", targetOperationId: oid(1), intentDigest: d, decision: "accept", operationId: oid(90), ...over }));
  assert.deepEqual(dec(a, {}), { outcome: "conflict", code: "review_not_flagged", detail: { state: "pending" } }, "pending cannot be decided — only reconciled");
  const f = SC.applyReviewTransition(a, { tenantId: T, bizId: B, operationId: oid(1), intentDigest: d, to: "flagged", resolution: "revoked_during_commit", now: 1500 }).node;
  assert.equal(dec(f, { actorRole: "manager" }).code, "role_not_allowed");
  assert.equal(dec(f, { actorRole: "super_owner" }).code, "role_not_allowed", "owner decision 6: only the owner");
  assert.equal(dec(f, { intentDigest: "a".repeat(64) }).code, "review_identity_mismatch");
  assert.equal(dec(f, { targetOperationId: oid(77) }).code, "review_not_found");
  const acc = dec(f, {});
  assert.equal(acc.outcome, "applied"); assert.equal(acc.node.review[oid(1)].state, "cleared"); assert.equal(acc.node.review[oid(1)].decidedBy, "u1");
  assert.deepEqual(acc.node.records, f.records, "a decision changes no record");
  assert.equal(dec(acc.node, { operationId: oid(91) }).code, "review_not_flagged", "a second decision is refused");
  const rej = SC.applyCreditOperation(f, cmd({ action: "review_reject", targetOperationId: oid(1), intentDigest: d, decision: "reject", operationId: oid(92) }));
  assert.equal(rej.node.review[oid(1)].state, "rejected");
  assert.equal(CORE.decodeSupplierCredits(rej.node).logical[0].status, "rejected");
});

test("SC-L09 applyReviewTransition: only pending → cleared | flagged, only for the SAME payload digest; idempotent; never touches records, events, reservations or pointers", () => {
  const a = applied(null, cmd({ action: "create", creditId: cid(1), operationId: oid(1), input: input() }));
  const d = a.review[oid(1)].intentDigest;
  const t = (over) => SC.applyReviewTransition(a, { tenantId: T, bizId: B, operationId: oid(1), intentDigest: d, to: "cleared", resolution: "post_commit_authorized", now: 2000, ...over });
  assert.equal(t({ intentDigest: "b".repeat(64) }).o, "review_identity_mismatch");
  assert.equal(t({ operationId: oid(9) }).o, "review_not_found");
  assert.equal(t({ resolution: "revoked_during_commit" }).o, "invalid_transition");
  assert.equal(t({ to: "acknowledged" }).o, "invalid_transition");
  const ok = t({});
  assert.equal(ok.o, "applied");
  for (const k of ["records", "documents", "heads", "operations"]) assert.deepEqual(ok.node[k], a[k], k + " unchanged");
  assert.equal(SC.applyReviewTransition(ok.node, { tenantId: T, bizId: B, operationId: oid(1), intentDigest: d, to: "cleared", resolution: "post_commit_authorized", now: 3000 }).o, "already_cleared");
  assert.equal(SC.applyReviewTransition(ok.node, { tenantId: T, bizId: B, operationId: oid(1), intentDigest: d, to: "flagged", resolution: "revoked_during_commit", now: 3000 }).o, "review_already_resolved:cleared", "a cleared operation can never be flagged later");
});

// ── SC-P parity ────────────────────────────────────────────────────────────────
test("SC-P01 the writer's amount, supplier-id and document-number rules ARE the Financial Core's (imported, no second definition)", () => {
  for (const s of ["s1", "2", "", " s", "a.b", "a#b", "a$b", "a[b", "a/b", "a:b", "x".repeat(128), "x".repeat(129), 2, null, "קוקה"]) assert.equal(SC.isValidSupplierId(s), CORE.isValidSupplierId(s), JSON.stringify(s));
  for (const d of ["CR 1", "cr-1", "  א-12 ", "12/3", "", null, "x".repeat(65), "a‏b"]) assert.deepEqual(SC.normalizeDocumentNumber(d), CORE.normalizeDocumentNumber(d), JSON.stringify(d));
  assert.equal(SC.CREDIT_ID_RE.source, CORE.CREDIT_ID_RE.source);
  assert.equal(SC.SCHEMA_VERSION, CORE.SUPPLIER_CREDITS_SCHEMA_VERSION);
  assert.match(readFileSync(join(ROOT, "lib", "supplierCredits.js"), "utf8"), /from "\.\.\/fincore\/v1\/finance\/supplierCredits\.js"/, "the writer imports the core's rules");
});

test("SC-P02 every node the writer produces (create / void / replace / correction) decodes VALID with the core decoder", () => {
  let node = null, n = 0;
  const step = (c) => { node = applied(node, cmd({ operationId: oid(++n), now: 1000 + n * 10, ...c })); node = cleared(node, oid(n), 1000 + n * 10 + 1); };
  step({ action: "create", creditId: cid(1), input: input() });
  step({ action: "create", creditId: cid(2), input: input({ supplierId: "2", amount: "0.01", documentNumber: "D", note: "הערה" }) });
  step({ action: "void", creditId: cid(2), expectedSeq: 1, voidReason: "טעות" });
  step({ action: "replace", creditId: cid(1), newCreditId: cid(3), expectedSeq: 1, input: input({ amount: "999999999.99", issueDate: "2028-02-29" }) });
  step({ action: "replace", creditId: cid(3), newCreditId: cid(4), expectedSeq: 2, identityCorrection: true, input: input({ amount: "5", documentNumber: "CR-1A" }) });
  const st = CORE.decodeSupplierCredits(SC.safeNodeView(JSON.parse(JSON.stringify(node))), { tenantId: T, bizId: B });
  assert.equal(st.state, "present"); assert.deepEqual(st.issues, []); assert.equal(st.records.length, 4); assert.equal(st.revision, 10);
  assert.deepEqual(st.credits.map((r) => [r.creditId, r.amount]), [[cid(4), "5"]]);
  assert.equal(st.records.find((r) => r.creditId === cid(2)).note, "הערה");
  assert.equal(st.records.find((r) => r.creditId === cid(4)).identityCorrection, true);
});

// ── SC-A authorization (real handler) ─────────────────────────────────────────
test("SC-A01 owner / manager (with business access) / super_owner create; the review is CLEARED by the post-commit check; list returns the node without the ledger", async () => {
  for (const [role, uid] of [["owner", "u1"], ["manager", "u2"], ["super_owner", "u3"]]) {
    const db = seed({ role, uid });
    const r = await call("create-supplier-credit", CREATE(1));
    assert.equal(r.code, 200, role + " " + JSON.stringify(r.body));
    assert.deepEqual([r.body.applied, r.body.replayed, r.body.review, r.body.postCommitAccess, r.body.rebuildRequired], [true, false, "cleared", "current", true]);
    assert.deepEqual(r.body.affectedDates, ["2026-10-02"]);
    const rec = stored(db).records[cid(1)];
    assert.equal(rec.amount, "300.5"); assert.equal(rec.createdBy, uid); assert.equal(rec.createdRole, role); assert.equal(rec.documentNumber, "CR-1");
    assert.equal(stored(db).review[oid(1)].state, "cleared");
    const l = await call("list-supplier-credits", undefined, "GET", { tenantId: T, bizId: B });
    assert.equal(l.code, 200); assert.equal(l.body.node.operations, undefined); assert.ok(l.body.node.records[cid(1)]);
    assert.equal(decoded(db).credits.length, 1);
  }
});

test("SC-A02 denied without a write: unauthenticated 401; viewer / shift_manager 403; removed member 403; manager without business access 403; cross-tenant 403", async () => {
  const cases = [
    [() => { seed(); globalThis.__CLAIMS = null; }, 401],
    [() => seed({ role: "viewer" }), 403],
    [() => seed({ role: "shift_manager" }), 403],
    [() => seed({ member: false }), 403],
    [() => seed({ role: "manager", bizAccess: false }), 403],
    [() => { seed(); globalThis.__CLAIMS = { uid: "uB", email: "b@x" }; }, 403],                 // owner of ANOTHER tenant
    [() => seed({ role: "nobody" }), 403],
  ];
  for (const [i, [setup, code]] of cases.entries()) {
    setup();
    const db = globalThis.__DB;
    for (const [action, body] of [["create-supplier-credit", CREATE(1)], ["void-supplier-credit", { tenantId: T, bizId: B, creditId: cid(1), operationId: oid(2), expectedSeq: 1 }], ["replace-supplier-credit", { ...CREATE(3), creditId: cid(1), newCreditId: cid(3), expectedSeq: 1 }], ["decide-supplier-credit-review", { tenantId: T, bizId: B, operationId: oid(4), targetOperationId: oid(1), intentDigest: "a".repeat(64), decision: "accept" }], ["reconcile-supplier-credit-reviews", { tenantId: T, bizId: B, operationId: oid(5) }]]) {
      const r = await call(action, body);
      assert.equal(r.code, code, `case ${i} ${action}: ${JSON.stringify(r.body)}`);
      assert.equal(stored(db), null, "no write");
    }
  }
  seed({ role: "viewer" }); assert.equal((await call("list-supplier-credits", undefined, "GET", { tenantId: T, bizId: B })).code, 200);
  seed({ role: "manager", bizAccess: false }); assert.equal((await call("list-supplier-credits", undefined, "GET", { tenantId: T, bizId: B })).code, 403);
  seed({ member: false }); assert.equal((await call("list-supplier-credits", undefined, "GET", { tenantId: T, bizId: B })).code, 403);
  seed(); globalThis.__CLAIMS = null; assert.equal((await call("list-supplier-credits", undefined, "GET", { tenantId: T, bizId: B })).code, 401);
});

test("SC-A03 business isolation: a credit written for bizA is invisible in bizB; the stored node is bound to its business", async () => {
  const db = seed({ role: "owner" });
  assert.equal((await call("create-supplier-credit", CREATE(1))).code, 200);
  const other = await call("list-supplier-credits", undefined, "GET", { tenantId: T, bizId: "bizB" });
  assert.equal(other.code, 200); assert.equal(other.body.node, null);
  assert.equal(stored(db).bizId, B); assert.equal(stored(db).records[cid(1)].bizId, B);
  assert.equal(CORE.decodeSupplierCredits(stored(db), { tenantId: T, bizId: "bizB" }).state, "unreadable", "a node copied to another business is unreadable there");
  for (const bizId of ["a:b", "a/b", "a.b", "", "x".repeat(200)]) assert.equal((await call("create-supplier-credit", CREATE(2, { bizId }))).code, 400, JSON.stringify(bizId));
  assert.equal((await call("list-supplier-credits", undefined, "GET", { tenantId: T, bizId: "a:b" })).code, 400);
});

test("SC-A04 input validation before any write: unknown supplier 400, unreadable supplier list 503, invalid amount / date / ids / document number 400", async () => {
  const cases = [
    [{}, CREATE(1, { supplierId: "nope" }), 400, "unknown_supplier"],
    [{ suppliers: null }, CREATE(1), 503, "suppliers_unavailable"],
    [{ suppliers: "bad" }, CREATE(1), 503, "suppliers_unavailable"],
    [{}, CREATE(1, { amount: "0" }), 400, "invalid_amount"],
    [{}, CREATE(1, { amount: -300 }), 400, "invalid_amount"],
    [{}, CREATE(1, { issueDate: "2026-02-30" }), 400, "invalid_issue_date"],
    [{}, CREATE(1, { documentNumber: undefined }), 400, "document_number_required"],
    [{}, CREATE(1, { documentNumber: "  " }), 400, "document_number_required"],
    [{}, CREATE(1, { documentNumber: "CR*1" }), 400, "invalid_document_number_chars"],
    [{}, CREATE(1, { creditId: "x" }), 400, "invalid_credit_id"],
    [{}, CREATE(1, { operationId: "x" }), 400, "invalid_operation_id"],
  ];
  for (const [opts, body, code, err] of cases) {
    const db = seed(opts.suppliers === "bad" ? {} : opts);
    if (opts.suppliers === "bad") db.seed(`tenants/${T}/biz:${B}:suppliers`, { _v: "{not json" });
    const r = await call("create-supplier-credit", body);
    assert.equal(r.code, code, JSON.stringify([body, r.body])); assert.equal(r.body.error, err);
    assert.equal(stored(db), null);
  }
  const db = seed(); const r = await call("create-supplier-credit", CREATE(1, { supplierId: "2" })); assert.equal(r.code, 200, JSON.stringify(r.body));
  assert.equal(stored(db).records[cid(1)].supplierId, "2");
});

test("SC-A05 version fence: quiesced / recovery_hold / malformed policy → 423 and no write; unreadable policy → 423 policy_unavailable", async () => {
  const POL = (o = {}) => ({ contractVersion: 1, phase: "legacy", policyRevision: 1, allowV2Initialization: false, minStorageProtocol: 1, ...o });
  for (const policy of [POL({ phase: "quiesced", operation: { id: "op", kind: "cutover", owner: "a", startedAt: 1 } }), POL({ phase: "recovery_hold" }), { phase: "legacy" }]) {
    const db = seed({ policy });
    const r = await call("create-supplier-credit", CREATE(1));
    assert.equal(r.code, 423, JSON.stringify(r.body)); assert.equal(r.body.error, "maintenance"); assert.equal(stored(db), null);
  }
  const db = seed();
  const orig = db.ref; db.ref = (p) => (p.startsWith("storage_v2_control/") ? { once: async () => { throw new Error("net"); }, get: async () => { throw new Error("net"); } } : orig(p));
  const r = await call("create-supplier-credit", CREATE(1)); assert.equal(r.code, 423); assert.equal(r.body.reason, "policy_unavailable"); assert.equal(stored(db), null);
  for (const policy of [POL(), POL({ phase: "v2_active", minStorageProtocol: 2 })]) { seed({ policy }); assert.equal((await call("create-supplier-credit", CREATE(1))).code, 200); }
});

test("SC-A06 DEC-AUTH-1 pre-check IMMEDIATELY before the transaction: a revocation after the first check (during the supplier / policy reads) DENIES with no write (red on 1057af89: committed)", async () => {
  let db = seed({ role: "manager" }); db.seed(`tenants/${T}/biz_access/${B}/u1`, null);
  assert.equal((await call("create-supplier-credit", CREATE(1))).code, 403); assert.equal(stored(db), null);
  db = seed({ role: "manager" });
  const orig = db.ref;
  db.ref = (p) => { const r = orig(p); return p === `tenants/${T}/biz:${B}:suppliers` ? { ...r, once: async (e) => { const s = await r.once(e); db.seed(`tenants/${T}/members/u1`, false); return s; } } : r; };
  const res = await call("create-supplier-credit", CREATE(2));
  assert.equal(res.code, 403, JSON.stringify(res.body)); assert.equal(stored(db), null, "nothing committed");
});

test("SC-A07 DEC-AUTH-1 window: a revocation BETWEEN the re-check and the commit leaves the immutable record with a durable FLAGGED review + audit record — never counted, never claimed as denied", async () => {
  const db = seed({ role: "manager" });
  const orig = db.ref;
  let done = false;
  db.ref = (p) => { const r = orig(p); return p === NODE ? { ...r, transaction: async (fn, ...rest) => { const out = await r.transaction(fn, ...rest); if (!done && out.committed) { done = true; db.seed(`tenants/${T}/members/u1`, false); } return out; } } : r; };
  const res = await call("create-supplier-credit", CREATE(1));
  assert.equal(res.code, 200); assert.deepEqual([res.body.applied, res.body.postCommitAccess, res.body.review, res.body.audit, res.body.rebuildRequired], [true, "revoked_during_commit", "flagged", "flag_persisted", false]);
  assert.equal(stored(db).review[oid(1)].state, "flagged"); assert.equal(stored(db).review[oid(1)].resolution, "revoked_during_commit");
  const flag = stored(db).review[oid(1)].flagAudit;
  assert.equal(flag.outcome, "revoked_during_commit"); assert.equal(flag.operationId, oid(1)); assert.equal(flag.actor, "u1");
  assert.deepEqual(decoded(db).credits, [], "a flagged credit is never counted");
  db.ref = orig;
  assert.equal((await call("create-supplier-credit", CREATE(2))).code, 403, "the next write by the revoked user is denied");
});

test("SC-A08 post-commit check UNAVAILABLE (transport) is NOT reported as revoked: the review stays PENDING (red on 1057af89: revoked_during_commit, nothing durable)", async () => {
  const db = seed({ role: "manager" });
  const orig = db.ref; let committed = false;
  db.ref = (p) => { const r = orig(p);
    if (p === NODE) return { ...r, transaction: async (fn, ...rest) => { const o = await r.transaction(fn, ...rest); committed = committed || o.committed; return o; } };
    if (committed && p === `tenants/${T}/biz_access/${B}/u1`) return { ...r, get: async () => { throw new Error("transport"); }, once: async () => { throw new Error("transport"); } };
    return r; };
  const res = await call("create-supplier-credit", CREATE(1));
  assert.deepEqual([res.code, res.body.postCommitAccess, res.body.review, res.body.rebuildRequired], [200, "verification_unavailable", "pending", false]);
  assert.equal(db.read(`tenants/${T}/audit/supplier_credit_flags/${oid(1)}`), null, "no false revocation evidence");
  assert.deepEqual(decoded(db).unresolved.pending, [oid(1)]);
});

// ── SC-C concurrency ───────────────────────────────────────────────────────────
test("SC-C01 stale sequence: two editors void / replace from the same head — exactly one applies, the other is a typed 409 with no change", async () => {
  const db = seed();
  assert.equal((await call("create-supplier-credit", CREATE(1))).code, 200);
  const a = await call("void-supplier-credit", { tenantId: T, bizId: B, creditId: cid(1), operationId: oid(10), expectedSeq: 1 });
  const before = JSON.stringify(stored(db));
  const b = await call("replace-supplier-credit", { ...CREATE(11, { documentNumber: "CR-1" }), creditId: cid(1), newCreditId: cid(11), operationId: oid(11), expectedSeq: 1 });
  assert.equal(a.code, 200); assert.equal(b.code, 409); assert.ok(["revision_conflict", "credit_not_active"].includes(b.body.error), b.body.error);
  assert.equal(JSON.stringify(stored(db)), before, "the losing write changed nothing");
  const c = await call("void-supplier-credit", { tenantId: T, bizId: B, creditId: cid(1), operationId: oid(12), expectedSeq: 2 });
  assert.equal(c.code, 409); assert.equal(c.body.error, "credit_not_active");
  const d = await call("void-supplier-credit", { tenantId: T, bizId: B, creditId: cid(99), operationId: oid(13), expectedSeq: 1 });
  assert.equal(d.code, 404);
});

test("SC-C02 creates of different credits both land; a retried create replays (writes nothing new); a reused operationId with another body is idempotency_conflict", async () => {
  const db = seed();
  const [x, y] = await Promise.all([call("create-supplier-credit", CREATE(1)), call("create-supplier-credit", CREATE(2, { amount: "10" }))]);
  assert.equal(x.code, 200); assert.equal(y.code, 200);
  assert.equal(Object.keys(stored(db).records).length, 2);
  const rev = stored(db).revision;
  const again = await call("create-supplier-credit", CREATE(1));
  assert.equal(again.code, 200); assert.equal(again.body.replayed, true); assert.equal(again.body.applied, false); assert.equal(again.body.review, "cleared");
  assert.equal(stored(db).revision, rev, "a replay writes nothing new");
  const clash = await call("create-supplier-credit", CREATE(1, { amount: "7" }));
  assert.equal(clash.code, 409); assert.equal(clash.body.error, "idempotency_conflict");
  const dupId = await call("create-supplier-credit", CREATE(1, { operationId: oid(50), documentNumber: "CR-50" }));
  assert.equal(dupId.code, 409); assert.equal(dupId.body.error, "credit_id_exists");
});

test("SC-S01 surface: the six actions exist ONLY in api/admin.js (Hobby cap: no new API file); writes are POST-only, list is GET-only", async () => {
  seed();
  assert.equal((await call("create-supplier-credit", CREATE(1), "GET")).code, 405);
  assert.equal((await call("list-supplier-credits", undefined, "POST", { tenantId: T, bizId: B })).code, 405);
  const src = readFileSync(join(ROOT, "api", "admin.js"), "utf8");
  for (const a of ["list-supplier-credits", "create-supplier-credit", "void-supplier-credit", "replace-supplier-credit", "decide-supplier-credit-review", "reconcile-supplier-credit-reviews"]) assert.equal(src.split(`"${a}"`).length - 1, 1, a);
  assert.doesNotMatch(src, /delete-supplier-credit|remove-supplier-credit/);
});
