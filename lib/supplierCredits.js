// ─────────────────────────────────────────────────────────────────────────────
// supplierCredits.js — server-authoritative supplier-credit document domain (P1 R1, MARJIN_CREDITS/3).
//
// Owner decisions (2026-09-29 / 2026-10-02 / 2026-10-03): a supplier credit is entered ONLY as its own
// credit document in the Supplier Credits tab — never as a negative purchase. It is attributed to the
// period of its ISSUE DATE (no restatement of the referenced purchase month); amounts are net of VAT and
// strictly positive. A document number is MANDATORY and unique per tenant + business + canonical
// supplier + normalized document number. DEC-AUTH-1: every operation commits with a PENDING review; only
// a cleared / acknowledged operation is authoritative; only the owner may accept or reject a flagged one.
//
// Storage: ONE node per business, server-written only (client Rules deny every unknown `biz:*` key):
//   tenants/{t}/biz:{b}:supplier_credits — the MARJIN_CREDITS/3 shape documented in
//   src/finance/supplierCredits.ts, plus the server-only `operations` idempotency ledger.
// Every mutation is ONE transaction on that node whose body is the PURE function below; the record,
// void event, identity reservation, current pointer, review entry, ledger entry and node revision
// change together. Records, void events and identity reservations are IMMUTABLE once written; edit is
// a traceable successor (replace); delete is a void event; nothing is ever hard-deleted.
//
// The current node is decoded with the SAME strict Financial Core decoder the readers use (fincore
// generated from src/finance/supplierCredits.ts): a node the readers would not trust is never written
// on top of, and every result is re-decoded before it is returned (defence in depth).
// ─────────────────────────────────────────────────────────────────────────────
import { createHash } from "node:crypto";
import { isValidBusinessDate, isValidOperationId } from "./entryExceptions.js";
import {
  decodeSupplierCredits, normalizeDocumentNumber, canonicalCreditAmount, isValidSupplierId, isValidNote,
  CREDIT_ID_RE, SUPPLIER_CREDITS_SCHEMA_VERSION, SUPPLIER_CREDITS_CONTRACT_VERSION, CREDIT_REVIEW_SCHEMA,
  CREDIT_REVIEW_DECIDER_ROLES, REVIEW_ISSUE_CODES, REVIEW_RESOLUTIONS, MAX_NOTE_LENGTH, documentSupplierKey, documentNumberKey,
  CREDIT_FLAG_AUDIT_SCHEMA, CREDIT_DECISION_AUDIT_SCHEMA,
} from "../fincore/v1/finance/supplierCredits.js";

export const SCHEMA_VERSION = SUPPLIER_CREDITS_SCHEMA_VERSION;
export const CONTRACT = SUPPLIER_CREDITS_CONTRACT_VERSION;
export { CREDIT_ID_RE, MAX_NOTE_LENGTH, CREDIT_REVIEW_DECIDER_ROLES, normalizeDocumentNumber };
/** Hard bounds (no pruning, no compaction): beyond them a write is refused, never truncated. */
export const MAX_RECORDS = 5000;
export const MAX_OPERATIONS = 20000;

export const nodePath = (tenantId, bizId) => `tenants/${tenantId}/biz:${bizId}:supplier_credits`;
export function isStrictReadableNode(node, tenantId, bizId) {
  const d = decodeSupplierCredits(safeNodeView(node), { tenantId, bizId });
  return d.state === "present" && d.issues.every((i) => REVIEW_ISSUE_CODES.includes(i.code));
}

function bad(code) { const e = new Error(code); e.code = code; return e; }
function isPlainObject(v) { return typeof v === "object" && v !== null && !Array.isArray(v); }

export function isValidCreditId(v) { return typeof v === "string" && CREDIT_ID_RE.test(v); }
export { isValidSupplierId };
export function isValidSeq(v) { return Number.isSafeInteger(v) && v >= 1; }

function optionalNote(v, code) {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "string") throw bad(code);
  const t = v.trim();
  if (t === "") return undefined;
  if (t.length > MAX_NOTE_LENGTH) throw bad(code + "_too_long"); // rejected, never truncated
  if (!isValidNote(t)) throw bad(code);
  return t;
}

/** Validate + normalize the document fields of a create / replace. Throws {code}. The document number is MANDATORY. */
export function validateCreditInput({ supplierId, issueDate, amount, documentNumber, note, documentCaseSensitive = false } = {}) {
  if (!isValidSupplierId(supplierId)) throw bad("invalid_supplier_id");
  if (!isValidBusinessDate(issueDate)) throw bad("invalid_issue_date");
  const a = canonicalCreditAmount(amount);
  if (a === null) throw bad("invalid_amount");
  if (typeof documentCaseSensitive !== "boolean") throw bad("invalid_document_case_policy");
  const doc = normalizeDocumentNumber(documentNumber, documentCaseSensitive);
  if (!doc.ok) throw bad(doc.code);
  const n = optionalNote(note, "invalid_note");
  return { supplierId, issueDate, amount: a, documentNumber: doc.display, documentKey: doc.key,
    documentFingerprint: doc.fingerprint, documentCaseSensitive, ...(n ? { note: n } : {}) };
}

/** A void reason (optional free text). Throws {code}. */
export function validateVoidReason(v) { return optionalNote(v, "invalid_void_reason"); }

/** Canonical request (semantic fields only) and its hash — the idempotency identity of an operation (the actor is bound separately). */
export function canonicalRequest(cmd) {
  const o = { action: cmd.action, tenantId: cmd.tenantId, bizId: cmd.bizId };
  for (const k of ["creditId", "newCreditId", "expectedSeq", "voidReason", "identityCorrection", "targetOperationId", "intentDigest", "decision", "similarityConfirmation"]) if (cmd[k] !== undefined) o[k] = cmd[k];
  if (cmd.input) for (const k of ["supplierId", "issueDate", "amount", "documentNumber", "documentCaseSensitive", "note"]) if (cmd.input[k] !== undefined) o[k] = cmd.input[k];
  return JSON.stringify(Object.keys(o).sort().reduce((acc, k) => { acc[k] = o[k]; return acc; }, {}));
}
export function requestHash(cmd) { return createHash("sha256").update(canonicalRequest(cmd)).digest("hex"); }

const sortedJson = (v) => JSON.stringify(v, (k, x) => (isPlainObject(x) ? Object.keys(x).sort().reduce((a, kk) => { a[kk] = x[kk]; return a; }, {}) : x));
const RECORD_INTENT = ["creditId", "logicalId", "tenantId", "bizId", "supplierId", "issueDate", "amount", "documentNumber", "documentKey", "documentCaseSensitive", "similarityConfirmation", "note", "replacesCreditId", "identityCorrection", "operationId", "createdBy", "createdRole"];
const VOID_INTENT = ["operationId", "kind", "creditId", "logicalId", "voidedBy", "voidedRole", "reasonCode", "reasonText", "replacedByCreditId"];
const pick = (o, keys) => keys.reduce((a, k) => { if (o && o[k] !== undefined) a[k] = o[k]; return a; }, {});
export function similarityAuditOf(cmd) {
  const c = cmd.similarityConfirmation;
  if (!c) return null;
  return { fingerprint: cmd.input.documentFingerprint, confirmedAgainst: c.confirmedAgainst,
    reason: c.reason, by: cmd.actorUid, at: cmd.now };
}
function similarityFor(node, cmd, logicalId) {
  const matches = new Set();
  for (const rec of Object.values(node.records)) {
    if (rec.logicalId === logicalId || rec.supplierId !== cmd.input.supplierId || rec.documentKey === cmd.input.documentKey) continue;
    const normalized = normalizeDocumentNumber(rec.documentNumber, rec.documentCaseSensitive);
    if (normalized.ok && normalized.fingerprint === cmd.input.documentFingerprint) matches.add(rec.logicalId);
  }
  const ids = [...matches].sort();
  const c = cmd.similarityConfirmation;
  if (ids.length === 0) return c ? { error: "similarity_confirmation_not_applicable" } : { audit: null };
  if (!isPlainObject(c) || Object.keys(c).sort().join("|") !== "confirmed|confirmedAgainst|reason" ||
      c.confirmed !== true || !Array.isArray(c.confirmedAgainst) ||
      JSON.stringify(c.confirmedAgainst) !== JSON.stringify(ids) || typeof c.reason !== "string" ||
      c.reason.trim().length < 3 || c.reason.trim() !== c.reason || c.reason.length > MAX_NOTE_LENGTH)
    return { error: "similar_document", detail: { confirmedAgainst: ids } };
  return { audit: similarityAuditOf(cmd) };
}
/**
 * The FULL stored-payload identity of one operation: every written record / void event field except the
 * server instants and the chain sequence. Two different payloads never share it; a retry of the same
 * request produces the same value. Its SHA-256 is the review entry's `intentDigest`.
 */
export function operationIntent(kind, logicalId, records, voidEvent) {
  return sortedJson({ kind, logicalId, records: records.map((r) => pick(r, RECORD_INTENT)).sort((a, b) => (a.creditId < b.creditId ? -1 : 1)), void: voidEvent ? pick(voidEvent, VOID_INTENT) : null });
}
export const digest = (s) => createHash("sha256").update(s).digest("hex");

/** The intent the STORED node holds for an operation (null when the operation wrote nothing there). */
export function storedIntentDigest(node, operationId) {
  if (!isPlainObject(node)) return null;
  const rv = isPlainObject(node.review) ? node.review[operationId] : undefined;
  if (!isPlainObject(rv)) return null;
  const records = Object.values(isPlainObject(node.records) ? node.records : {}).filter((r) => isPlainObject(r) && r.operationId === operationId);
  const ev = isPlainObject(node.voids) && isPlainObject(node.voids[operationId]) ? node.voids[operationId] : null;
  if (records.length === 0 && !ev) return null;
  return digest(operationIntent(rv.kind, rv.logicalId, records, ev));
}

/** The node as readers see it: never the operations ledger. A malformed node is returned as stored (the decoder reports it). */
export function safeNodeView(node) {
  if (!isPlainObject(node)) return node === undefined ? null : node;
  const { operations, ...rest } = node;
  return rest;
}

const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
/** Decode for a WRITE: unreadable, or any data defect (anything but an unresolved review), refuses every write. */
function decodeForWrite(current, cmd) {
  const d = decodeSupplierCredits(safeNodeView(current), { tenantId: cmd.tenantId, bizId: cmd.bizId });
  if (d.state === "unreadable") return { error: "node_unreadable", detail: d.reason };
  if (d.state === "present" && d.issues.some((i) => !REVIEW_ISSUE_CODES.includes(i.code))) return { error: "node_unreadable", detail: "invalid_credit_data" };
  return { decoded: d };
}

function pendingReview(kind, logicalId, creditId, newCreditId, seq, intentDigest, cmd) {
  return {
    schema: CREDIT_REVIEW_SCHEMA, state: "pending", kind, logicalId, creditId, ...(newCreditId ? { newCreditId } : {}), seq, intentDigest,
    actor: cmd.actorUid, actorRole: cmd.actorRole, committedAt: cmd.now,
  };
}

/**
 * The PURE transaction body. `current` is the stored node (or null). Returns
 *   { outcome:"applied", node, result } | { outcome:"replayed", result, ledger } | { outcome:"conflict", code, detail? }.
 * Actions: create · void · replace (credit operations, each committed with a PENDING review) and
 * review_accept · review_reject (the owner's decision on a FLAGGED operation).
 */
export function applyCreditOperation(current, cmd) {
  if (current !== null && current !== undefined && (!isPlainObject(current) || current.schemaVersion !== SCHEMA_VERSION)) {
    return { outcome: "conflict", code: "node_unreadable", detail: isPlainObject(current) && current.schemaVersion === 1 ? "schema_v1_unsupported" : "node_shape" };
  }
  const ops = current && isPlainObject(current.operations) ? current.operations : {};
  const prior = ops[cmd.operationId];
  if (prior !== undefined) {
    if (isPlainObject(prior) && prior.requestHash === cmd.requestHash && prior.by === cmd.actorUid) {
      return { outcome: "replayed", ledger: clone(prior), result: { ...resultOf(prior), revision: current.revision } };
    }
    return { outcome: "conflict", code: "idempotency_conflict" };
  }
  const dw = decodeForWrite(current, cmd);
  if (dw.error) return { outcome: "conflict", code: dw.error, detail: dw.detail };
  const dec = dw.decoded;
  if (Object.keys(ops).length >= MAX_OPERATIONS) return { outcome: "conflict", code: "operation_limit_reached" };
  const node = current ? clone(current) : { schemaVersion: SCHEMA_VERSION, contract: CONTRACT, tenantId: cmd.tenantId, bizId: cmd.bizId, revision: 0, updatedAt: cmd.now, records: {} };
  for (const k of ["records", "voids", "documents", "heads", "review", "operations"]) if (!isPlainObject(node[k])) node[k] = {};
  const recs = node.records;
  const reserved = (sid, key) => { const s = node.documents[documentSupplierKey(sid)]; return isPlainObject(s) ? s[documentNumberKey(key)] : undefined; };
  const reserve = (sid, key, entry) => { const sk = documentSupplierKey(sid); node.documents[sk] = { ...(node.documents[sk] || {}), [documentNumberKey(key)]: entry }; };
  const logicalOfCredit = (creditId) => {
    const r = recs[creditId];
    if (!isPlainObject(r) || dec.state !== "present") return null;
    return dec.logical.find((l) => l.logicalId === r.logicalId) || null;
  };
  let ledger, result;
  if (cmd.action === "create") {
    if (recs[cmd.creditId] !== undefined) return { outcome: "conflict", code: "credit_id_exists" };
    if (Object.keys(recs).length >= MAX_RECORDS) return { outcome: "conflict", code: "record_limit_reached" };
    const holder = reserved(cmd.input.supplierId, cmd.input.documentKey);
    if (holder !== undefined) return { outcome: "conflict", code: "duplicate_document", detail: { logicalId: holder.logicalId } };
    const similarity = similarityFor(node, cmd, cmd.creditId);
    if (similarity.error) return { outcome: "conflict", code: similarity.error, detail: similarity.detail };
    const rec = recordOf(cmd.creditId, cmd.creditId, cmd.input, { ...cmd, storedSimilarityConfirmation: similarity.audit }, 1);
    const intentDigest = digest(operationIntent("create", cmd.creditId, [rec], null));
    recs[cmd.creditId] = rec;
    reserve(cmd.input.supplierId, cmd.input.documentKey, { logicalId: cmd.creditId, creditId: cmd.creditId, operationId: cmd.operationId, reservedAt: cmd.now, reservedBy: cmd.actorUid });
    node.heads[cmd.creditId] = { creditId: cmd.creditId, seq: 1 };
    node.review[cmd.operationId] = pendingReview("create", cmd.creditId, cmd.creditId, null, 1, intentDigest, cmd);
    ledger = { kind: "create", logicalId: cmd.creditId, creditId: cmd.creditId, seq: 1, intentDigest };
  } else if (cmd.action === "void" || cmd.action === "replace") {
    const l = logicalOfCredit(cmd.creditId);
    if (!l) return { outcome: "conflict", code: "credit_not_found" };
    if (l.unresolved) return { outcome: "conflict", code: "review_unresolved", detail: { operationId: l.unresolved.operationId, state: l.unresolved.state } };
    if (l.status !== "active") return { outcome: "conflict", code: "credit_not_active" };
    if (l.head.creditId !== cmd.creditId) return { outcome: "conflict", code: "credit_not_current" };
    if (l.head.seq !== cmd.expectedSeq) return { outcome: "conflict", code: "revision_conflict" };
    const seq = l.head.seq + 1;
    const target = recs[cmd.creditId];
    if (cmd.action === "void") {
      const ev = { operationId: cmd.operationId, kind: "void", creditId: cmd.creditId, logicalId: l.logicalId, seq, voidedAt: cmd.now, voidedBy: cmd.actorUid, voidedRole: cmd.actorRole, reasonCode: "voided", ...(cmd.voidReason ? { reasonText: cmd.voidReason } : {}) };
      const intentDigest = digest(operationIntent("void", l.logicalId, [], ev));
      node.voids[cmd.operationId] = ev;
      node.heads[l.logicalId] = { creditId: cmd.creditId, seq };
      node.review[cmd.operationId] = pendingReview("void", l.logicalId, cmd.creditId, null, seq, intentDigest, cmd);
      ledger = { kind: "void", logicalId: l.logicalId, creditId: cmd.creditId, seq, intentDigest };
    } else {
      if (recs[cmd.newCreditId] !== undefined) return { outcome: "conflict", code: "credit_id_exists" };
      if (Object.keys(recs).length >= MAX_RECORDS) return { outcome: "conflict", code: "record_limit_reached" };
      const sameIdentity = target.supplierId === cmd.input.supplierId && target.documentKey === cmd.input.documentKey;
      if (sameIdentity && cmd.identityCorrection === true) return { outcome: "conflict", code: "identity_correction_not_applicable" };
      if (!sameIdentity && cmd.identityCorrection !== true) return { outcome: "conflict", code: "identity_change_requires_correction" };
      const holder = reserved(cmd.input.supplierId, cmd.input.documentKey);
      if (holder !== undefined && holder.logicalId !== l.logicalId) return { outcome: "conflict", code: "duplicate_document", detail: { logicalId: holder.logicalId } };
      const similarity = similarityFor(node, cmd, l.logicalId);
      if (similarity.error) return { outcome: "conflict", code: similarity.error, detail: similarity.detail };
      const rec = recordOf(cmd.newCreditId, l.logicalId, cmd.input, { ...cmd, storedSimilarityConfirmation: similarity.audit }, seq, { replacesCreditId: cmd.creditId, ...(sameIdentity ? {} : { identityCorrection: true }) });
      const ev = { operationId: cmd.operationId, kind: "replace", creditId: cmd.creditId, logicalId: l.logicalId, seq, voidedAt: cmd.now, voidedBy: cmd.actorUid, voidedRole: cmd.actorRole, reasonCode: "replaced", replacedByCreditId: cmd.newCreditId };
      const intentDigest = digest(operationIntent("replace", l.logicalId, [rec], ev));
      recs[cmd.newCreditId] = rec;
      node.voids[cmd.operationId] = ev;
      // a corrected identity is RESERVED for this logical credit; the old identity stays reserved
      if (holder === undefined) reserve(cmd.input.supplierId, cmd.input.documentKey, { logicalId: l.logicalId, creditId: cmd.newCreditId, operationId: cmd.operationId, reservedAt: cmd.now, reservedBy: cmd.actorUid });
      node.heads[l.logicalId] = { creditId: cmd.newCreditId, seq };
      node.review[cmd.operationId] = pendingReview("replace", l.logicalId, cmd.creditId, cmd.newCreditId, seq, intentDigest, cmd);
      ledger = { kind: "replace", logicalId: l.logicalId, creditId: cmd.creditId, newCreditId: cmd.newCreditId, seq, intentDigest };
    }
  } else if (cmd.action === "review_accept" || cmd.action === "review_reject") {
    // defence in depth: the API already requires a FRESH owner role
    if (!CREDIT_REVIEW_DECIDER_ROLES.includes(cmd.actorRole)) return { outcome: "conflict", code: "role_not_allowed" };
    const rv = node.review[cmd.targetOperationId];
    if (!isPlainObject(rv)) return { outcome: "conflict", code: "review_not_found" };
    if (rv.intentDigest !== cmd.intentDigest) return { outcome: "conflict", code: "review_identity_mismatch" };
    if (rv.state !== "flagged") return { outcome: "conflict", code: "review_not_flagged", detail: { state: rv.state } };
    const head = node.heads[rv.logicalId];
    if (!isPlainObject(head) || head.seq !== rv.seq || head.creditId !== (rv.newCreditId || rv.creditId)) return { outcome: "conflict", code: "review_head_mismatch" };
    const to = cmd.action === "review_accept" ? "acknowledged" : "rejected";
    const decidedAt = Math.max(cmd.now, rv.resolvedAt);
    const decisionAudit = { contract: CREDIT_DECISION_AUDIT_SCHEMA, operationId: cmd.operationId, targetOperationId: cmd.targetOperationId,
      tenantId: cmd.tenantId, bizId: cmd.bizId, intentDigest: rv.intentDigest, decision: to, by: cmd.actorUid, at: decidedAt };
    node.review[cmd.targetOperationId] = { ...rv, state: to, decidedAt, decidedBy: cmd.actorUid, decisionAudit };
    if (to === "rejected") {
      // the current pointer returns to the last non-rejected record (a rejected creation keeps its root)
      const h = node.heads[rv.logicalId];
      if (rv.kind === "replace") node.heads[rv.logicalId] = { creditId: rv.creditId, seq: h.seq };
    }
    ledger = { kind: cmd.action, logicalId: rv.logicalId, creditId: rv.creditId, targetOperationId: cmd.targetOperationId, decision: to };
  } else {
    return { outcome: "conflict", code: "invalid_action" };
  }
  node.revision = (node.revision || 0) + 1;
  node.updatedAt = Math.max(cmd.now, current && Number.isSafeInteger(current.updatedAt) ? current.updatedAt : 0);
  node.operations[cmd.operationId] = { ...ledger, requestHash: cmd.requestHash, at: cmd.now, by: cmd.actorUid };
  for (const k of ["voids", "documents", "heads", "review"]) if (Object.keys(node[k]).length === 0) delete node[k];
  // defence in depth: the result must decode with no data defect, and a credit operation must be pending
  const chk = decodeSupplierCredits(safeNodeView(node), { tenantId: cmd.tenantId, bizId: cmd.bizId });
  if (chk.state !== "present" || chk.issues.some((i) => !REVIEW_ISSUE_CODES.includes(i.code))) return { outcome: "conflict", code: "internal_invalid" };
  if (["create", "void", "replace"].includes(cmd.action) && !chk.unresolved.pending.includes(cmd.operationId)) return { outcome: "conflict", code: "internal_invalid" };
  result = { ...resultOf(node.operations[cmd.operationId]), revision: node.revision };
  return { outcome: "applied", node, result };
}

function recordOf(creditId, logicalId, input, cmd, seq, extra = {}) {
  return {
    creditId, logicalId, tenantId: cmd.tenantId, bizId: cmd.bizId,
    supplierId: input.supplierId, issueDate: input.issueDate, amount: input.amount, documentNumber: input.documentNumber, documentKey: input.documentKey,
    documentCaseSensitive: input.documentCaseSensitive,
    ...(cmd.storedSimilarityConfirmation ? { similarityConfirmation: cmd.storedSimilarityConfirmation } : {}),
    ...(input.note ? { note: input.note } : {}),
    ...extra,
    operationId: cmd.operationId, seq, createdAt: cmd.now, createdBy: cmd.actorUid, createdRole: cmd.actorRole,
  };
}

function resultOf(ledger) {
  const out = { kind: ledger.kind, logicalId: ledger.logicalId, creditId: ledger.creditId };
  for (const k of ["newCreditId", "seq", "intentDigest", "targetOperationId", "decision"]) if (ledger[k] !== undefined) out[k] = ledger[k];
  return out;
}

/**
 * PURE post-commit / reconciliation transition of ONE operation's review: pending → cleared | flagged.
 * It changes ONLY that review entry (records, events, reservations and pointers are never touched) and
 * requires the caller's intent digest, so it can never resolve a different operation or payload.
 *   { o:"applied", node } | { o:"already_<to>" } | { o:"review_not_found" | "review_identity_mismatch" | "review_already_resolved:<state>" | "node_unreadable" }
 */
export function applyReviewTransition(current, { tenantId, bizId, operationId, intentDigest, to, resolution, now }) {
  if (!isPlainObject(current) || current.schemaVersion !== SCHEMA_VERSION) return { o: "node_unreadable" };
  const check = decodeSupplierCredits(safeNodeView(current), { tenantId, bizId });
  if (check.state !== "present" || check.issues.some((i) => !REVIEW_ISSUE_CODES.includes(i.code))) return { o: "node_unreadable" };
  if (to !== "cleared" && to !== "flagged") return { o: "invalid_transition" };
  if (!REVIEW_RESOLUTIONS[to].includes(resolution)) return { o: "invalid_transition" };
  const rv = isPlainObject(current.review) ? current.review[operationId] : undefined;
  if (!isPlainObject(rv)) return { o: "review_not_found" };
  if (rv.intentDigest !== intentDigest) return { o: "review_identity_mismatch" };
  if (rv.state === to) return { o: "already_" + to };
  if (rv.state !== "pending") return { o: "review_already_resolved:" + rv.state };
  const head = isPlainObject(current.heads) ? current.heads[rv.logicalId] : null;
  if (!isPlainObject(head) || head.seq !== rv.seq || head.creditId !== (rv.newCreditId || rv.creditId)) return { o: "review_head_mismatch" };
  const node = clone(current);
  const resolvedAt = Math.max(now, rv.committedAt);
  const flagAudit = to === "flagged" ? { contract: CREDIT_FLAG_AUDIT_SCHEMA, tenantId, bizId, operationId, logicalId: rv.logicalId,
    creditId: rv.creditId, intentDigest, actor: rv.actor, committedAt: rv.committedAt, outcome: resolution, detectedAt: resolvedAt } : null;
  node.review[operationId] = { ...rv, state: to, resolvedAt, resolution, ...(flagAudit ? { flagAudit } : {}) };
  node.revision = current.revision + 1;
  node.updatedAt = Math.max(now, current.updatedAt);
  const chk = decodeSupplierCredits(safeNodeView(node), { tenantId, bizId });
  if (chk.state !== "present" || chk.issues.some((i) => !REVIEW_ISSUE_CODES.includes(i.code))) return { o: "internal_invalid" };
  return { o: "applied", node };
}

/** The issue dates whose financial outputs change when an operation becomes authoritative (analytics rebuild targets). */
export function datesOfOperation(node, operationId) {
  const dates = new Set();
  if (!isPlainObject(node)) return [];
  const rv = isPlainObject(node.review) ? node.review[operationId] : undefined;
  if (!isPlainObject(rv)) return [];
  for (const id of [rv.creditId, rv.newCreditId]) {
    const r = id && isPlainObject(node.records) ? node.records[id] : undefined;
    if (isPlainObject(r) && typeof r.issueDate === "string") dates.add(r.issueDate);
  }
  return [...dates].sort();
}

export { isValidOperationId };
