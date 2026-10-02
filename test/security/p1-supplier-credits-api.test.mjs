// P1 Supplier Credits — storage domain (lib/supplierCredits.js), repository and the REAL api/admin.js
// handlers (list / create / void / replace) with ONLY the Admin-SDK / auth / email seams replaced.
//   SC-L*  pure domain: create / void / replace, idempotency, CAS, limits, fail-closed node shapes
//   SC-P*  parity: the writer's amount / id rules ≡ the Financial Core decoder; every written record decodes VALID
//   SC-A*  authorization: unauthenticated, viewer / shift_manager, removed member, cross-business,
//          cross-tenant, unknown supplier, unreadable supplier list, version fence, post-commit re-check
//   SC-C*  concurrency: stale revision, double void, replay, idempotency conflict
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
const CREATE = (n, over = {}) => ({ tenantId: T, bizId: B, creditId: cid(n), operationId: oid(n), supplierId: "s1", issueDate: "2026-10-02", amount: "300.50", documentNumber: "CR-1", ...over });
const stored = (db) => db.read(NODE);
const decoded = (db) => CORE.decodeSupplierCredits(SC.safeNodeView(stored(db)));

// ── SC-L pure domain ───────────────────────────────────────────────────────────
const cmd = (over) => { const c = { tenantId: T, bizId: B, actorUid: "u1", actorRole: "owner", now: 1000, ...over }; c.requestHash = SC.requestHash(c); return c; };
const input = (over = {}) => SC.validateCreditInput({ supplierId: "s1", issueDate: "2026-10-02", amount: "300", ...over });

test("SC-L01 create on an absent node: schema v1, revision 1, one active record with audit metadata and the operation ledger entry", () => {
  const r = SC.applyCreditOperation(null, cmd({ action: "create", creditId: cid(1), operationId: oid(1), input: input() }));
  assert.equal(r.outcome, "applied");
  assert.equal(r.node.schemaVersion, 1); assert.equal(r.node.revision, 1);
  assert.deepEqual(r.node.records[cid(1)], { creditId: cid(1), supplierId: "s1", issueDate: "2026-10-02", amount: "300", status: "active", revision: 1, createdAt: 1000, createdBy: "u1", createdRole: "owner", updatedAt: 1000, updatedBy: "u1" });
  assert.equal(r.node.operations[oid(1)].kind, "create");
  assert.deepEqual(r.result, { creditId: cid(1), recordRevision: 1, revision: 1 });
});

test("SC-L02 validateCreditInput: supplier, issue date, positive canonical amount, optional bounded text — rejected never truncated", () => {
  assert.deepEqual(input({ amount: "300.50", documentNumber: "  CR-9 ", note: "  " }), { supplierId: "s1", issueDate: "2026-10-02", amount: "300.5", documentNumber: "CR-9" });
  const bad = [
    [{ supplierId: "" }, "invalid_supplier_id"], [{ supplierId: "a/b" }, "invalid_supplier_id"], [{ supplierId: 2 }, "invalid_supplier_id"],
    [{ issueDate: "2027-02-29" }, "invalid_issue_date"], [{ issueDate: "2026-10-2" }, "invalid_issue_date"], [{ issueDate: undefined }, "invalid_issue_date"],
    [{ amount: "0" }, "invalid_amount"], [{ amount: "-5" }, "invalid_amount"], [{ amount: 5 }, "invalid_amount"], [{ amount: "5.001" }, "invalid_amount"], [{ amount: "1,000" }, "invalid_amount"],
    [{ documentNumber: "x".repeat(65) }, "invalid_document_number_too_long"], [{ documentNumber: 7 }, "invalid_document_number"], [{ documentNumber: "a\u0001" }, "invalid_document_number"],
    [{ note: "x".repeat(501) }, "invalid_note_too_long"],
  ];
  for (const [o, code] of bad) assert.throws(() => input(o), (e) => e.code === code, JSON.stringify(o));
});

test("SC-L03 create never overwrites: an existing creditId is credit_id_exists; record / operation limits refuse (never prune)", () => {
  const a = SC.applyCreditOperation(null, cmd({ action: "create", creditId: cid(1), operationId: oid(1), input: input() })).node;
  assert.deepEqual(SC.applyCreditOperation(a, cmd({ action: "create", creditId: cid(1), operationId: oid(2), input: input({ amount: "1" }) })), { outcome: "conflict", code: "credit_id_exists" });
  const full = { ...a, records: Object.fromEntries(Array.from({ length: SC.MAX_RECORDS }, (_, i) => [cid(i + 10), {}])) };
  assert.deepEqual(SC.applyCreditOperation(full, cmd({ action: "create", creditId: cid(2), operationId: oid(3), input: input() })), { outcome: "conflict", code: "record_limit_reached" });
  const ops = { ...a, operations: Object.fromEntries(Array.from({ length: SC.MAX_OPERATIONS }, (_, i) => [oid(i + 10), {}])) };
  assert.deepEqual(SC.applyCreditOperation(ops, cmd({ action: "create", creditId: cid(2), operationId: oid(3), input: input() })), { outcome: "conflict", code: "operation_limit_reached" });
});

test("SC-L04 void keeps the record (status voided + who/when/why), bumps its revision, requires the current record revision (CAS); no hard delete exists", () => {
  const a = SC.applyCreditOperation(null, cmd({ action: "create", creditId: cid(1), operationId: oid(1), input: input() })).node;
  assert.deepEqual(SC.applyCreditOperation(a, cmd({ action: "void", creditId: cid(1), operationId: oid(2), expectedRecordRevision: 2 })), { outcome: "conflict", code: "revision_conflict" });
  const v = SC.applyCreditOperation(a, cmd({ action: "void", creditId: cid(1), operationId: oid(2), expectedRecordRevision: 1, voidReason: "duplicate", now: 2000 }));
  assert.equal(v.outcome, "applied");
  const r = v.node.records[cid(1)];
  assert.equal(r.status, "voided"); assert.equal(r.revision, 2); assert.equal(r.voidedAt, 2000); assert.equal(r.voidedBy, "u1"); assert.equal(r.voidReason, "duplicate"); assert.equal(r.amount, "300", "the document is kept");
  assert.deepEqual(SC.applyCreditOperation(v.node, cmd({ action: "void", creditId: cid(1), operationId: oid(3), expectedRecordRevision: 2 })), { outcome: "conflict", code: "credit_not_active" });
  assert.deepEqual(SC.applyCreditOperation(v.node, cmd({ action: "void", creditId: cid(5), operationId: oid(4), expectedRecordRevision: 1 })), { outcome: "conflict", code: "credit_not_found" });
  for (const action of ["delete", "remove", "hard_delete", "update"]) assert.deepEqual(SC.applyCreditOperation(v.node, cmd({ action, creditId: cid(1), operationId: oid(9) })), { outcome: "conflict", code: "invalid_action" });
  assert.doesNotMatch(readFileSync(join(ROOT, "lib", "supplierCredits.js"), "utf8").replace(/\/\/.*$/gm, ""), /delete\s+recs\[|\.remove\(/, "no destructive path in the domain");
});

test("SC-L05 replace = void-old + create-new in ONE transaction, linked both ways; the new record carries its own issue date", () => {
  const a = SC.applyCreditOperation(null, cmd({ action: "create", creditId: cid(1), operationId: oid(1), input: input() })).node;
  const r = SC.applyCreditOperation(a, cmd({ action: "replace", creditId: cid(1), newCreditId: cid(2), operationId: oid(2), expectedRecordRevision: 1, input: input({ amount: "250", issueDate: "2026-10-05" }) }));
  assert.equal(r.outcome, "applied"); assert.equal(r.node.revision, 2);
  assert.equal(r.node.records[cid(1)].status, "voided"); assert.equal(r.node.records[cid(1)].replacedByCreditId, cid(2));
  assert.equal(r.node.records[cid(2)].replacesCreditId, cid(1)); assert.equal(r.node.records[cid(2)].issueDate, "2026-10-05");
  assert.deepEqual(SC.affectedIssueDates(a, r.node, r.result), ["2026-10-02", "2026-10-05"], "both issue dates must be rebuilt");
  assert.deepEqual(SC.applyCreditOperation(a, cmd({ action: "replace", creditId: cid(1), newCreditId: cid(1), operationId: oid(3), expectedRecordRevision: 1, input: input() })), { outcome: "conflict", code: "credit_id_exists" });
});

test("SC-L06 idempotency: the same operationId + same request replays (no second write); a different request is idempotency_conflict", () => {
  const c1 = cmd({ action: "create", creditId: cid(1), operationId: oid(1), input: input() });
  const a = SC.applyCreditOperation(null, c1).node;
  assert.deepEqual(SC.applyCreditOperation(a, c1), { outcome: "replayed", result: { creditId: cid(1), recordRevision: 1, revision: 1 } });
  assert.deepEqual(SC.applyCreditOperation(a, cmd({ action: "create", creditId: cid(1), operationId: oid(1), input: input({ amount: "1" }) })), { outcome: "conflict", code: "idempotency_conflict" });
  assert.equal(SC.requestHash(c1), SC.requestHash({ ...c1, now: 99, actorUid: "other" }), "the hash covers the semantic request only");
});

test("SC-L07 fail-closed on a malformed stored node: no write over an unreadable node", () => {
  for (const bad of ["x", 7, [], { schemaVersion: 2, revision: 1 }, { schemaVersion: 1, revision: 0 }, { schemaVersion: 1, revision: 1, records: [] }, { schemaVersion: 1, revision: 1, operations: "o" }])
    assert.deepEqual(SC.applyCreditOperation(bad, cmd({ action: "create", creditId: cid(1), operationId: oid(1), input: input() })), { outcome: "conflict", code: "node_unreadable" }, JSON.stringify(bad));
  assert.equal(SC.safeNodeView(undefined), null); assert.equal(SC.safeNodeView(null), null);
  assert.deepEqual(SC.safeNodeView({ schemaVersion: 1, revision: 1, records: {}, operations: { a: 1 } }), { schemaVersion: 1, revision: 1, records: {} }, "readers never see the operation ledger");
});

// ── SC-P parity ────────────────────────────────────────────────────────────────
test("SC-P01 the writer's amount and supplier-id rules are the Financial Core's (no third definition drifts)", () => {
  const amounts = ["300", "300.5", "300.50", "0.01", "0.10", "999999999.99", "1000000000", "0", "0.0", "00", "01", "-1", "+1", "1.", ".5", "1.234", "1e2", "1,000", " 1", "1 ", 1, null, undefined, "", "NaN", "0x10", "007.50"];
  for (const a of amounts) assert.equal(SC.canonicalAmount(a), CORE.canonicalCreditAmount(a), JSON.stringify(a));
  for (const s of ["s1", "2", "", " s", "a.b", "a#b", "a$b", "a[b", "a/b", "a:b", "x".repeat(128), "x".repeat(129), 2, null, "קוקה"]) assert.equal(SC.isValidSupplierId(s), CORE.isValidSupplierId(s), JSON.stringify(s));
  assert.equal(SC.CREDIT_ID_RE.source, CORE.CREDIT_ID_RE.source);
  assert.equal(SC.SCHEMA_VERSION, CORE.SUPPLIER_CREDITS_SCHEMA_VERSION);
});

test("SC-P02 every record the writer produces (create / void / replace chains, optional fields) decodes VALID with the core decoder", () => {
  let node = null, n = 0;
  const step = (c) => { const r = SC.applyCreditOperation(node, cmd({ operationId: oid(++n), ...c })); assert.equal(r.outcome, "applied", JSON.stringify(c)); node = r.node; };
  step({ action: "create", creditId: cid(1), input: input() });
  step({ action: "create", creditId: cid(2), input: input({ supplierId: "2", amount: "0.01", documentNumber: "D", note: "הערה" }) });
  step({ action: "void", creditId: cid(2), expectedRecordRevision: 1, voidReason: "טעות" });
  step({ action: "replace", creditId: cid(1), newCreditId: cid(3), expectedRecordRevision: 1, input: input({ amount: "999999999.99", issueDate: "2028-02-29" }) });
  step({ action: "replace", creditId: cid(3), newCreditId: cid(4), expectedRecordRevision: 1, input: input({ amount: "5" }) });
  const st = CORE.decodeSupplierCredits(SC.safeNodeView(JSON.parse(JSON.stringify(node))));
  assert.equal(st.state, "present"); assert.deepEqual(st.issues, []); assert.equal(st.records.length, 4); assert.equal(st.revision, 5);
  assert.deepEqual(st.records.filter((r) => r.status === "active").map((r) => [r.creditId, r.amount]), [[cid(4), "5"]]);
  assert.equal(st.records.find((r) => r.creditId === cid(2)).note, "הערה");
});

// ── SC-A authorization (real handler) ─────────────────────────────────────────
test("SC-A01 owner / manager (with business access) / super_owner create; the stored record is the canonical document; list returns it without the operation ledger", async () => {
  for (const [role, uid] of [["owner", "u1"], ["manager", "u2"], ["super_owner", "u3"]]) {
    const db = seed({ role, uid });
    const r = await call("create-supplier-credit", CREATE(1));
    assert.equal(r.code, 200, role + " " + JSON.stringify(r.body));
    assert.deepEqual([r.body.applied, r.body.replayed, r.body.revision, r.body.postCommitAccess, r.body.rebuildRequired], [true, false, 1, "unchanged", true]);
    assert.deepEqual(r.body.affectedDates, ["2026-10-02"]);
    const rec = stored(db).records[cid(1)];
    assert.equal(rec.amount, "300.5"); assert.equal(rec.createdBy, uid); assert.equal(rec.createdRole, role); assert.equal(rec.status, "active");
    const l = await call("list-supplier-credits", undefined, "GET", { tenantId: T, bizId: B });
    assert.equal(l.code, 200); assert.equal(l.body.node.operations, undefined); assert.ok(l.body.node.records[cid(1)]);
    assert.equal(decoded(db).records.length, 1);
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
    for (const [action, body] of [["create-supplier-credit", CREATE(1)], ["void-supplier-credit", { tenantId: T, bizId: B, creditId: cid(1), operationId: oid(2), expectedRecordRevision: 1 }], ["replace-supplier-credit", { ...CREATE(3), creditId: cid(1), newCreditId: cid(3), expectedRecordRevision: 1 }]]) {
      const r = await call(action, body);
      assert.equal(r.code, code, `case ${i} ${action}: ${JSON.stringify(r.body)}`);
      assert.equal(stored(db), null, "no write");
    }
  }
  // reads: viewer may list; a non-member / cross-business manager may not
  seed({ role: "viewer" }); assert.equal((await call("list-supplier-credits", undefined, "GET", { tenantId: T, bizId: B })).code, 200);
  seed({ role: "manager", bizAccess: false }); assert.equal((await call("list-supplier-credits", undefined, "GET", { tenantId: T, bizId: B })).code, 403);
  seed({ member: false }); assert.equal((await call("list-supplier-credits", undefined, "GET", { tenantId: T, bizId: B })).code, 403);
  seed(); globalThis.__CLAIMS = null; assert.equal((await call("list-supplier-credits", undefined, "GET", { tenantId: T, bizId: B })).code, 401);
});

test("SC-A03 business isolation: a credit written for bizA is invisible in bizB and the node path never crosses businesses / tenants", async () => {
  const db = seed({ role: "owner" });
  assert.equal((await call("create-supplier-credit", CREATE(1))).code, 200);
  db.seed(`tenants/${T}/biz_access/bizB/u1`, true);
  const other = await call("list-supplier-credits", undefined, "GET", { tenantId: T, bizId: "bizB" });
  assert.equal(other.code, 200); assert.equal(other.body.node, null);
  assert.equal(SC.nodePath("t", "b"), "tenants/t/biz:b:supplier_credits");
  for (const bizId of ["a:b", "a/b", "a.b", "", "x".repeat(200)]) {
    const r = await call("create-supplier-credit", CREATE(2, { bizId }));
    assert.equal(r.code, 400, JSON.stringify(bizId));
  }
  const r = await call("list-supplier-credits", undefined, "GET", { tenantId: T, bizId: "a:b" }); assert.equal(r.code, 400);
});

test("SC-A04 input validation before any write: unknown supplier 400, unreadable supplier list 503, invalid amount / date / ids 400", async () => {
  const cases = [
    [{}, CREATE(1, { supplierId: "nope" }), 400, "unknown_supplier"],
    [{ suppliers: null }, CREATE(1), 503, "suppliers_unavailable"],
    [{ suppliers: "bad" }, CREATE(1), 503, "suppliers_unavailable"],
    [{}, CREATE(1, { amount: "0" }), 400, "invalid_amount"],
    [{}, CREATE(1, { amount: -300 }), 400, "invalid_amount"],
    [{}, CREATE(1, { issueDate: "2026-02-30" }), 400, "invalid_issue_date"],
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
  // a numeric supplier id in the list matches its string form (supplier ids are compared as strings)
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

test("SC-A06 DEC-AUTH-1 bounded window: a revocation committed BEFORE the pre-write check denies; one landing between check and commit leaves the immutable record, explicitly flagged revoked_during_commit", async () => {
  // before: membership removed ⇒ denied, no write
  let db = seed({ role: "manager" }); db.seed(`tenants/${T}/biz_access/${B}/u1`, null);
  assert.equal((await call("create-supplier-credit", CREATE(1))).code, 403); assert.equal(stored(db), null);
  // between: the revocation lands inside the transaction window
  db = seed({ role: "manager" });
  const orig = db.ref;
  db.ref = (p) => {
    const r = orig(p);
    if (p !== NODE) return r;
    return { ...r, transaction: async (fn, ...rest) => { const out = await r.transaction(fn, ...rest); db.seed(`tenants/${T}/members/u1`, false); return out; } };
  };
  const res = await call("create-supplier-credit", CREATE(1));
  assert.equal(res.code, 200); assert.equal(res.body.applied, true); assert.equal(res.body.postCommitAccess, "revoked_during_commit", "explicitly flagged, never claimed as denied");
  assert.equal(stored(db).records[cid(1)].status, "active", "the stored version is kept (immutable document history)");
  // the next write by the revoked user is denied
  db.ref = orig;
  assert.equal((await call("create-supplier-credit", CREATE(2))).code, 403);
});

// ── SC-C concurrency ───────────────────────────────────────────────────────────
test("SC-C01 stale revision: two editors void / replace from the same revision — exactly one applies, the other is revision_conflict (409) with no change", async () => {
  const db = seed();
  assert.equal((await call("create-supplier-credit", CREATE(1))).code, 200);
  const a = await call("void-supplier-credit", { tenantId: T, bizId: B, creditId: cid(1), operationId: oid(10), expectedRecordRevision: 1 });
  const before = JSON.stringify(stored(db));
  const b = await call("replace-supplier-credit", { ...CREATE(11), creditId: cid(1), newCreditId: cid(11), operationId: oid(11), expectedRecordRevision: 1 });
  assert.equal(a.code, 200); assert.equal(b.code, 409); assert.ok(["revision_conflict", "credit_not_active"].includes(b.body.error), b.body.error);
  assert.equal(JSON.stringify(stored(db)), before, "the losing write changed nothing");
  const c = await call("void-supplier-credit", { tenantId: T, bizId: B, creditId: cid(1), operationId: oid(12), expectedRecordRevision: 2 });
  assert.equal(c.code, 409); assert.equal(c.body.error, "credit_not_active");
  const d = await call("void-supplier-credit", { tenantId: T, bizId: B, creditId: cid(99), operationId: oid(13), expectedRecordRevision: 1 });
  assert.equal(d.code, 404);
});

test("SC-C02 concurrent creates of different credits both land (append-safe); a retried create replays; a reused operationId with another body is idempotency_conflict", async () => {
  const db = seed();
  const [x, y] = await Promise.all([call("create-supplier-credit", CREATE(1)), call("create-supplier-credit", CREATE(2, { amount: "10" }))]);
  assert.equal(x.code, 200); assert.equal(y.code, 200);
  assert.equal(stored(db).revision, 2); assert.equal(Object.keys(stored(db).records).length, 2);
  const again = await call("create-supplier-credit", CREATE(1));
  assert.equal(again.code, 200); assert.equal(again.body.replayed, true); assert.equal(again.body.applied, false); assert.deepEqual(again.body.affectedDates, []);
  assert.equal(stored(db).revision, 2, "a replay writes nothing new");
  const clash = await call("create-supplier-credit", CREATE(1, { amount: "7" }));
  assert.equal(clash.code, 409); assert.equal(clash.body.error, "idempotency_conflict");
  const dupId = await call("create-supplier-credit", CREATE(1, { operationId: oid(50) }));
  assert.equal(dupId.code, 409); assert.equal(dupId.body.error, "credit_id_exists");
});

test("SC-C03 the repository runs ONE transaction per mutation on the per-business node; a cold first run re-submits the value it saw (never decides on a stale cache)", async () => {
  const { runSupplierCreditTxn } = await import(pathToFileURL(join(dir, "lib", "repositories", "supplierCreditsRepo.js")).href);
  const db = installDb(makeDb());
  const seen = [];
  const fake = { ref: (p) => ({ transaction: async (fn) => { seen.push(p); const first = fn(null); assert.equal(first.records[cid(1)].amount, "300"); const second = fn(null); return { committed: true, snapshot: { val: () => second } }; } }) };
  const c = cmd({ action: "create", creditId: cid(1), operationId: oid(1), input: input() });
  const out = await runSupplierCreditTxn(c, fake);
  assert.equal(out.outcome, "applied"); assert.deepEqual(seen, [NODE]);
  // a conflict / replay is re-submitted on EVERY run (never aborted), so it is only reported once
  // the server confirmed the value it was decided on (committed no-op); an unconfirmed decision fails
  const existing = SC.applyCreditOperation(null, c).node;
  const runs = [];
  const fake2 = { ref: () => ({ transaction: async (fn) => { runs.push(fn(null)); runs.push(fn(existing)); return { committed: true, snapshot: { val: () => existing } }; } }) };
  const out2 = await runSupplierCreditTxn(cmd({ action: "create", creditId: cid(1), operationId: oid(2), input: input() }), fake2);
  assert.deepEqual(out2, { outcome: "conflict", code: "credit_id_exists" }, "decided on the server value, not the cold null");
  assert.equal(runs[0].records[cid(1)].amount, "300", "the cold run would have APPLIED on the stale null — RTDB rejects it (hash mismatch) and re-runs");
  assert.equal(runs[1], existing, "the confirming run re-submits the server value");
  const voidCmd = cmd({ action: "void", creditId: cid(1), operationId: oid(3), expectedRecordRevision: 1 });
  const stale = [];
  const fake3 = { ref: () => ({ transaction: async (fn) => { stale.push(fn(null)); stale.push(fn(null)); return { committed: false }; } }) };
  assert.deepEqual(await runSupplierCreditTxn(voidCmd, fake3), { outcome: "conflict", code: "txn_failed" }, "never report credit_not_found from an unconfirmed (stale) null");
  assert.deepEqual(stale, [null, null], "a stale second run still re-submits (no abort)");
  const out3 = await runSupplierCreditTxn(c, { ref: () => ({ transaction: async () => { throw new Error("boom"); } }) });
  assert.deepEqual(out3, { outcome: "conflict", code: "txn_failed" });
  void db;
});

test("SC-S01 surface: the four actions exist ONLY in api/admin.js (Hobby cap: no new API file); writes are POST-only, list is GET-only", async () => {
  seed();
  assert.equal((await call("create-supplier-credit", CREATE(1), "GET")).code, 405);
  assert.equal((await call("list-supplier-credits", undefined, "POST", { tenantId: T, bizId: B })).code, 405);
  const src = readFileSync(join(ROOT, "api", "admin.js"), "utf8");
  for (const a of ["list-supplier-credits", "create-supplier-credit", "void-supplier-credit", "replace-supplier-credit"]) assert.equal(src.split(`"${a}"`).length - 1, 1, a);
  assert.doesNotMatch(src, /delete-supplier-credit|remove-supplier-credit/);
});
