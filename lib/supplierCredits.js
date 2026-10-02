// ─────────────────────────────────────────────────────────────────────────────
// supplierCredits.js — server-authoritative supplier-credit document domain (P1, schema v1).
//
// Owner direction (2026-09-29 / 2026-10-02): a supplier credit is entered ONLY as its own
// credit document in the Supplier Credits tab — never as a negative purchase. It is attributed
// to the period of its ISSUE DATE (no restatement of the original purchase month); amounts are
// net of VAT and strictly positive.
//
// Storage (one atomic node per business, server-written only; client Rules deny every
// unknown `biz:*` key, so `biz:{b}:supplier_credits` needs no Rules change):
//   tenants/{t}/biz:{b}:supplier_credits = {
//     schemaVersion: 1, revision: <int ≥ 1>, updatedAt,
//     records:    { [creditId]: record },
//     operations: { [operationId]: { kind, creditId, newCreditId?, requestHash, at, by, recordRevision } }
//   }
// Mutation policy (the safest pattern consistent with the accepted structured documents —
// CD-M2 entry exceptions: one transaction per node, durable idempotency, no destructive edit):
//   create  — a NEW record (client-generated UUID v4 creditId); never overwrites an id;
//   void    — the record stays, status "voided" with who/when/why; it no longer counts;
//   replace — an EDIT is void-old + create-new in the SAME transaction, linked both ways;
//   no hard delete exists. void/replace require the record's current revision (CAS); a create
//   is append-safe (no CAS) because its id is new. A repeated operationId with the same request
//   replays the stored result; with a different request it is an idempotency conflict.
//
// PURE (node:crypto only for the request hash). The read side is the Financial Core decoder
// (src/finance/supplierCredits.ts decodeSupplierCredits); parity is tested
// (test/finance/p1-supplier-credits-parity.test.mjs): every record written here decodes as valid.
// ─────────────────────────────────────────────────────────────────────────────
import { createHash } from "node:crypto";
import { isValidBusinessDate, isValidOperationId } from "./entryExceptions.js";

export const SCHEMA_VERSION = 1;
export const CREDIT_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const AMOUNT_RE = /^(?:0|[1-9][0-9]{0,8})(?:\.[0-9]{1,2})?$/;
const SUPPLIER_ID_FORBIDDEN = /[.#$\[\]\/:]/;
export const MAX_SUPPLIER_ID_LENGTH = 128;
export const MAX_DOCUMENT_NUMBER_LENGTH = 64;
export const MAX_NOTE_LENGTH = 500;
/** Hard bounds (no pruning, no compaction): beyond them a write is refused, never truncated. */
export const MAX_RECORDS = 5000;
export const MAX_OPERATIONS = 20000;

export const nodePath = (tenantId, bizId) => `tenants/${tenantId}/biz:${bizId}:supplier_credits`;

function bad(code) { const e = new Error(code); e.code = code; return e; }
function isPlainObject(v) { return typeof v === "object" && v !== null && !Array.isArray(v); }

export function isValidCreditId(v) { return typeof v === "string" && CREDIT_ID_RE.test(v); }
export function isValidSupplierId(v) {
  return typeof v === "string" && v.length > 0 && v.length <= MAX_SUPPLIER_ID_LENGTH && v.trim() === v && !SUPPLIER_ID_FORBIDDEN.test(v);
}
export function isValidRecordRevision(v) { return Number.isSafeInteger(v) && v >= 1; }

/**
 * Canonical positive amount string, or null. Accepts ONLY a plain decimal string with at most
 * 9 integer digits and 2 fraction digits ("300", "300.5", "300.50" → "300.5"). No sign, no
 * grouping, no exponent, no number type (an IEEE double is never a financial input), never 0.
 */
export function canonicalAmount(raw) {
  if (typeof raw !== "string" || !AMOUNT_RE.test(raw)) return null;
  let [i, f = ""] = raw.split(".");
  while (f.endsWith("0")) f = f.slice(0, -1);
  if (/^0+$/.test(i) && f === "") return null; // zero
  i = i.replace(/^0+(?=\d)/, "");
  return f === "" ? i : `${i}.${f}`;
}

function optionalText(v, max, code) {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "string") throw bad(code);
  const t = v.trim();
  if (t === "") return undefined;
  if (t.length > max) throw bad(code + "_too_long"); // rejected, never truncated
  if (/[\u0000-\u001f]/.test(t)) throw bad(code);
  return t;
}

/** Validate + normalize the document fields of a create/replace. Throws {code}. */
export function validateCreditInput({ supplierId, issueDate, amount, documentNumber, note } = {}) {
  if (!isValidSupplierId(supplierId)) throw bad("invalid_supplier_id");
  if (!isValidBusinessDate(issueDate)) throw bad("invalid_issue_date");
  const a = canonicalAmount(amount);
  if (a === null) throw bad("invalid_amount");
  const doc = optionalText(documentNumber, MAX_DOCUMENT_NUMBER_LENGTH, "invalid_document_number");
  const n = optionalText(note, MAX_NOTE_LENGTH, "invalid_note");
  return { supplierId, issueDate, amount: a, ...(doc ? { documentNumber: doc } : {}), ...(n ? { note: n } : {}) };
}

/** Canonical request (semantic fields only) and its hash — the idempotency identity of an operation. */
export function canonicalRequest(cmd) {
  const o = { action: cmd.action, tenantId: cmd.tenantId, bizId: cmd.bizId, creditId: cmd.creditId };
  if (cmd.newCreditId !== undefined) o.newCreditId = cmd.newCreditId;
  if (cmd.expectedRecordRevision !== undefined) o.expectedRecordRevision = cmd.expectedRecordRevision;
  if (cmd.input) for (const k of ["supplierId", "issueDate", "amount", "documentNumber", "note"]) if (cmd.input[k] !== undefined) o[k] = cmd.input[k];
  if (cmd.voidReason !== undefined) o.voidReason = cmd.voidReason;
  return JSON.stringify(Object.keys(o).sort().reduce((acc, k) => { acc[k] = o[k]; return acc; }, {}));
}
export function requestHash(cmd) { return createHash("sha256").update(canonicalRequest(cmd)).digest("hex"); }

/** The node as readers see it: never the operations ledger. A malformed node is returned as stored (the core decoder reports it unreadable). */
export function safeNodeView(node) {
  if (!isPlainObject(node)) return node === undefined ? null : node;
  const { operations, ...rest } = node;
  return rest;
}

function newRecord(creditId, input, cmd, extra = {}) {
  return {
    creditId, supplierId: input.supplierId, issueDate: input.issueDate, amount: input.amount,
    ...(input.documentNumber ? { documentNumber: input.documentNumber } : {}),
    ...(input.note ? { note: input.note } : {}),
    status: "active", revision: 1,
    createdAt: cmd.now, createdBy: cmd.actorUid, createdRole: cmd.actorRole,
    updatedAt: cmd.now, updatedBy: cmd.actorUid,
    ...extra,
  };
}

function voided(rec, cmd, extra) {
  return { ...rec, status: "voided", revision: rec.revision + 1, updatedAt: cmd.now, updatedBy: cmd.actorUid, voidedAt: cmd.now, voidedBy: cmd.actorUid, voidedRole: cmd.actorRole, ...extra };
}

/**
 * The PURE transaction body. `current` is the stored node (or null). Returns
 *   { outcome:"applied", node, result } | { outcome:"replayed", result } | { outcome:"conflict", code }.
 */
export function applyCreditOperation(current, cmd) {
  if (current !== null && current !== undefined) {
    if (!isPlainObject(current) || current.schemaVersion !== SCHEMA_VERSION || !isValidRecordRevision(current.revision)) return { outcome: "conflict", code: "node_unreadable" };
    if (current.records !== undefined && !isPlainObject(current.records)) return { outcome: "conflict", code: "node_unreadable" };
    if (current.operations !== undefined && !isPlainObject(current.operations)) return { outcome: "conflict", code: "node_unreadable" };
  }
  const node = current ? { ...current, records: { ...(current.records || {}) }, operations: { ...(current.operations || {}) } } : { schemaVersion: SCHEMA_VERSION, revision: 0, records: {}, operations: {} };
  const prior = node.operations[cmd.operationId];
  if (prior) {
    if (prior.requestHash === cmd.requestHash) return { outcome: "replayed", result: { creditId: prior.creditId, ...(prior.newCreditId ? { newCreditId: prior.newCreditId } : {}), recordRevision: prior.recordRevision, revision: node.revision } };
    return { outcome: "conflict", code: "idempotency_conflict" };
  }
  if (Object.keys(node.operations).length >= MAX_OPERATIONS) return { outcome: "conflict", code: "operation_limit_reached" };
  const recs = node.records;
  let result;
  if (cmd.action === "create") {
    if (recs[cmd.creditId] !== undefined) return { outcome: "conflict", code: "credit_id_exists" };
    if (Object.keys(recs).length >= MAX_RECORDS) return { outcome: "conflict", code: "record_limit_reached" };
    recs[cmd.creditId] = newRecord(cmd.creditId, cmd.input, cmd);
    result = { creditId: cmd.creditId, recordRevision: 1 };
  } else if (cmd.action === "void" || cmd.action === "replace") {
    const rec = recs[cmd.creditId];
    if (!isPlainObject(rec) || rec.creditId !== cmd.creditId) return { outcome: "conflict", code: "credit_not_found" };
    if (rec.status !== "active") return { outcome: "conflict", code: "credit_not_active" };
    if (!isValidRecordRevision(rec.revision) || rec.revision !== cmd.expectedRecordRevision) return { outcome: "conflict", code: "revision_conflict" };
    if (cmd.action === "void") {
      recs[cmd.creditId] = voided(rec, cmd, cmd.voidReason ? { voidReason: cmd.voidReason } : {});
      result = { creditId: cmd.creditId, recordRevision: rec.revision + 1 };
    } else {
      if (recs[cmd.newCreditId] !== undefined) return { outcome: "conflict", code: "credit_id_exists" };
      if (Object.keys(recs).length >= MAX_RECORDS) return { outcome: "conflict", code: "record_limit_reached" };
      recs[cmd.creditId] = voided(rec, cmd, { voidReason: "replaced", replacedByCreditId: cmd.newCreditId });
      recs[cmd.newCreditId] = newRecord(cmd.newCreditId, cmd.input, cmd, { replacesCreditId: cmd.creditId });
      result = { creditId: cmd.creditId, newCreditId: cmd.newCreditId, recordRevision: rec.revision + 1 };
    }
  } else {
    return { outcome: "conflict", code: "invalid_action" };
  }
  node.revision = node.revision + 1;
  node.updatedAt = cmd.now;
  node.operations[cmd.operationId] = {
    kind: cmd.action, creditId: cmd.creditId, ...(cmd.newCreditId ? { newCreditId: cmd.newCreditId } : {}),
    requestHash: cmd.requestHash, at: cmd.now, by: cmd.actorUid, recordRevision: result.recordRevision,
  };
  return { outcome: "applied", node, result: { ...result, revision: node.revision } };
}

/** The issue dates whose financial outputs change after an applied operation (analytics rebuild targets). */
export function affectedIssueDates(before, after, result) {
  const dates = new Set();
  for (const id of [result.creditId, result.newCreditId]) {
    if (!id) continue;
    for (const n of [before, after]) {
      const r = n && n.records && n.records[id];
      if (r && typeof r.issueDate === "string") dates.add(r.issueDate);
    }
  }
  return [...dates].sort();
}

export { isValidOperationId };
