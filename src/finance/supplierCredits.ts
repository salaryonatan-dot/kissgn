// MARJIN_CREDITS/4 — supplier credit documents (P1 R1; owner decisions 2026-09-29 / 2026-10-02 / 2026-10-03).
//
// ACCOUNTING (unchanged from P1): a supplier credit is its OWN document, never a negative purchase. It
// belongs to the period of the credit document's ISSUE DATE: a credit issued in October reduces October
// even when it refers to a September invoice — the earlier month is never restated. Amounts are net of
// VAT (BD-1), strictly positive, exact decimals with at most two fraction digits. For a period:
//   supplier net purchases = gross purchases from the supplier − credits from the supplier,
//   overall net purchases  = Σ gross purchases − Σ credits,
// and Food Cost uses the net result. A net result may be negative: it is kept (never clamped) and flagged.
//
// P1 R3 (MARJIN_CREDITS/4) — the stored node (server-written only; client Rules deny the key):
//   tenants/{t}/biz:{b}:supplier_credits = {
//     schemaVersion: 4, contract: "MARJIN_CREDITS/4", tenantId, bizId, revision, updatedAt,
//     records:   { [creditId]:    immutable credit document (payload + creation audit) },
//     voids:     { [operationId]: immutable void / replace event (target, actor, reason) },
//     documents: { ["s_" + supplierId]: { ["d_" + documentKey]: immutable document-identity reservation } },
//                (prefixed keys: RTDB never turns them into arrays, whatever the supplier id / number)
//     heads:     { [logicalId]:   { creditId, seq }  — the current pointer of one logical credit },
//     review:    { [operationId]: DEC-AUTH-1 authorization review of the operation (MARJIN_CREDITR/3) },
//     operations: …server-only idempotency ledger (never decoded here)
//   }
// A LOGICAL credit is one chain: its root record (logicalId === creditId) and the successors created by
// replacements. Every mutation (create / void / replace) is one operation with a sequence number `seq`
// on its logical credit and ONE review entry: pending → cleared | flagged; flagged → cleared (accepted) |
// rejected (owner decision). Only cleared operations are AUTHORITATIVE. The accounting
// state of a logical credit is the fold of its authoritative operations in seq order; a pending or
// flagged operation (at most one, the latest) is NOT applied and makes the dates it touches INCOMPLETE —
// an unresolved credit never reduces purchases and is never silently treated as absent.
//
// Decoding is strict and fail-closed: an undecodable envelope is UNREADABLE (never "no credits"); a
// record / chain / audit / document / review defect is an ISSUE attributed to the dates of the logical
// credit it belongs to (that credit contributes NOTHING — an earlier, apparently valid record of a
// corrupt chain is never used); a defect that cannot be attributed makes EVERY date incomplete.
import { creditEvidence } from "./creditEvidence.js";
import type { AmountString, Dec } from "./decimal.js";
import { decAdd, decFromPlainString, decIsNegative, decIsZero, decSub, serializeDec } from "./decimal.js";
import { isBusinessDate } from "./businessDate.js";
import type { BusinessDate, CanonicalDay, DayCredits, Flag } from "./types.js";
import { sortFlags } from "./normalize.js";

export const SUPPLIER_CREDITS_CONTRACT_VERSION = "MARJIN_CREDITS/4";
export const SUPPLIER_CREDITS_SCHEMA_VERSION = 4;
export const CREDIT_REVIEW_SCHEMA = "MARJIN_CREDITR/3";
export const CREDIT_FLAG_AUDIT_SCHEMA = "MARJIN_CREDIT_AUDIT/3";
export const CREDIT_DECISION_AUDIT_SCHEMA = "MARJIN_CREDIT_DECISION/2";
/** Same identity grammar as entry rows (UUID v4, lower-case). */
export const CREDIT_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
/** Operation ids: the entry-exception grammar (RTDB-safe). */
export const OPERATION_ID_RE = /^[A-Za-z0-9_-]{8,128}$/;
/** Positive, at most 9 integer digits and 2 fraction digits, no sign, no grouping, no exponent. */
const AMOUNT_RE = /^(?:0|[1-9][0-9]{0,8})(?:\.[0-9]{1,2})?$/;
const SUPPLIER_ID_FORBIDDEN = /[.#$\[\]\/:]/;
const ACTOR_FORBIDDEN = /[.#$\[\]\/]/;
const DIGEST_RE = /^[0-9a-f]{64}$/;
export const MAX_SUPPLIER_ID_LENGTH = 128;
export const MAX_DOCUMENT_NUMBER_LENGTH = 64;
export const MAX_NOTE_LENGTH = 500;
export const SUPPLIER_SOURCE_PREFIX = "supplier:";
/** The explicit write-role set of the server API (lib/securityContext.js WRITE_ROLES). */
export const CREDIT_WRITER_ROLES: readonly string[] = Object.freeze(["manager", "owner", "super_owner"]);
/** Roles that may decide (accept / reject) a FLAGGED operation: the business owner only (owner decision 6). */
export const CREDIT_REVIEW_DECIDER_ROLES: readonly string[] = Object.freeze(["owner"]);

// ── document identity (owner decisions 2 / 3) ────────────────────────────────────────────────────
/**
 * Separators: Unicode white space, the hyphen / dash family (U+002D, U+2010–U+2015, U+2212 minus,
 * U+05BE Hebrew maqaf), slash, backslash, underscore, full stop, colon and number sign. Separators are
 * preserved with their positions in the hard identity. A separate similarity fingerprint removes
 * them only to warn about likely duplicates; it never reserves or merges an identity.
 */
const SEPARATOR_CLASS = "\\s\\-\\u2010-\\u2015\\u2212\\u05BE\\/\\\\_.:#";
const SEP_RUN = new RegExp("[" + SEPARATOR_CLASS + "]+", "gu");
const SEP_CHAR = new RegExp("^[" + SEPARATOR_CLASS + "]$", "u");
const ALLOWED_CHAR = new RegExp("^[\\p{L}\\p{M}\\p{N}" + SEPARATOR_CLASS + "]$", "u");
const FORBIDDEN_CHAR = /[\p{Cc}\p{Cf}\p{Co}\p{Cs}\p{Zl}\p{Zp}]/u;
const HAS_ALNUM = /[\p{L}\p{N}]/u;

export type DocumentNumberResult =
  | { readonly ok: true; readonly display: string; readonly key: string; readonly fingerprint: string }
  | { readonly ok: false; readonly code: "document_number_required" | "invalid_document_number" | "invalid_document_number_too_long" | "invalid_document_number_chars" };

/**
 * The ONE document-number rule (writer, browser and readers):
 *   1. a string, NFKC-normalized; control / format (incl. bidi marks) / private-use / surrogate / line
 *      or paragraph separator characters are refused (never stripped);
 *   2. display = trimmed, every white-space run collapsed to one ASCII space; empty ⇒ required;
 *      display length ≤ 64 UTF-16 units (rejected, never truncated);
 *   3. every character is a letter, a combining mark, a digit or a separator (above);
 *   4. hard key = NFKC(lowercase(display)) with each separator escaped as ~hex~. Since ~ is not an
 *      allowed input character this preserves punctuation and positions without an RTDB-key collision.
 *   5. fingerprint = the same canonical text with separators removed. It is a warning signal only.
 * Case folding is the locale-INDEPENDENT Unicode default (String.prototype.toLowerCase).
 */
export function normalizeDocumentNumber(raw: unknown): DocumentNumberResult {
  if (raw === undefined || raw === null) return { ok: false, code: "document_number_required" };
  if (typeof raw !== "string") return { ok: false, code: "invalid_document_number" };
  const n = raw.normalize("NFKC");
  if (FORBIDDEN_CHAR.test(n)) return { ok: false, code: "invalid_document_number" };
  const display = n.trim().replace(/\s+/gu, " ");
  if (display === "") return { ok: false, code: "document_number_required" };
  if (display.length > MAX_DOCUMENT_NUMBER_LENGTH) return { ok: false, code: "invalid_document_number_too_long" };
  for (const ch of display) if (!ALLOWED_CHAR.test(ch)) return { ok: false, code: "invalid_document_number_chars" };
  const canonical = display.toLowerCase().normalize("NFKC");
  const fingerprint = display.toLowerCase().normalize("NFKC").replace(SEP_RUN, "");
  if (!HAS_ALNUM.test(fingerprint)) return { ok: false, code: "invalid_document_number_chars" };
  const key = [...canonical].map((ch) => SEP_CHAR.test(ch) ? "~" + (ch.codePointAt(0) as number).toString(16) + "~" : ch).join("");
  return { ok: true, display, key, fingerprint };
}

// ── decoded shapes ───────────────────────────────────────────────────────────────────────────────
export type ReviewState = "pending" | "cleared" | "flagged" | "rejected";
export type OperationKind = "create" | "void" | "replace";
export type RecordStatus = "active" | "voided" | "replaced" | "not_effective";
export interface UnresolvedOperation { readonly operationId: string; readonly kind: OperationKind; readonly state: "pending" | "flagged" }

export interface SupplierCredit {
  readonly creditId: string;
  readonly logicalId: string;
  readonly supplierId: string;
  readonly issueDate: BusinessDate;
  /** canonical positive exact amount, net of VAT */
  readonly amount: AmountString;
  /** AUTHORITATIVE lifecycle of THIS record (only "active" is counted) */
  readonly status: RecordStatus;
  readonly documentNumber: string;
  readonly documentKey: string;
  readonly similarityConfirmation: { readonly fingerprint:string; readonly confirmedAgainst:readonly string[]; readonly reason:string; readonly by:string; readonly at:number } | null;
  /** free-text note (display / edit only; never a financial input) */
  readonly note: string | null;
  readonly replacesCreditId: string | null;
  /** the non-rejected successor of this record, if any */
  readonly replacedByCreditId: string | null;
  readonly identityCorrection: boolean;
  readonly operationId: string;
  readonly seq: number;
  readonly createdAt: number;
  readonly createdBy: string;
  readonly createdRole: string;
  /** review state of the operation that CREATED this record */
  readonly review: ReviewState;
  /** the unresolved (pending / flagged) operation of this record's logical credit that touches this record */
  readonly unresolved: UnresolvedOperation | null;
}

export interface LogicalCredit {
  readonly logicalId: string;
  /** current pointer: the record the next void / replace must target, and the chain sequence */
  readonly head: { readonly creditId: string; readonly seq: number };
  /** authoritative status: active (counted) · voided · rejected (its creation was rejected) · its creation is unresolved */
  readonly status: "active" | "voided" | "rejected" | "unresolved_create";
  readonly unresolved: UnresolvedOperation | null;
}

export interface ReviewEntry {
  readonly operationId: string;
  readonly kind: OperationKind;
  readonly state: ReviewState;
  readonly logicalId: string;
  readonly creditId: string;
  readonly newCreditId: string | null;
  readonly seq: number;
  readonly intentDigest: string;
  readonly actor: string;
  readonly actorRole: string;
  readonly committedAt: number;
  readonly resolution: string | null;
}

/** An effective (authoritative, active) credit — the ONLY input of the accounting. */
export interface EffectiveCredit {
  readonly creditId: string;
  readonly logicalId: string;
  readonly supplierId: string;
  readonly issueDate: BusinessDate;
  readonly amount: AmountString;
}

export type CreditIssueCode =
  | "invalid_record" | "id_mismatch" | "binding_mismatch" | "invalid_supplier" | "invalid_issue_date" | "invalid_amount"
  | "invalid_audit" | "invalid_document" | "invalid_link" | "invalid_chain" | "invalid_void" | "invalid_head" | "invalid_review"
  | "orphan_entry" | "review_pending" | "review_flagged";

export interface CreditIssue {
  readonly key: string;
  readonly code: CreditIssueCode;
  /** the issue dates the defect is attributed to; EMPTY ⇒ unattributable: every date is incomplete */
  readonly dates: readonly BusinessDate[];
}

export type SupplierCreditsState =
  | { readonly state: "absent" }
  | {
    readonly state: "present";
    readonly revision: number;
    readonly tenantId: string;
    readonly bizId: string;
    readonly records: readonly SupplierCredit[];
    readonly logical: readonly LogicalCredit[];
    readonly reviews: readonly ReviewEntry[];
    readonly credits: readonly EffectiveCredit[];
    readonly issues: readonly CreditIssue[];
    readonly unresolved: { readonly pending: readonly string[]; readonly flagged: readonly string[] };
  }
  | { readonly state: "unreadable"; readonly reason: "node_shape" | "schema_version" | "contract" | "revision" | "envelope_keys" | "binding" | "section_shape" | "invalid_review_audit" }
  /** the caller did not read the node: never "no credits" — purchases are not complete */
  | { readonly state: "not_loaded" };

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
const isSafeInt = (v: unknown, min: number): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= min;
const isActor = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 128 && !ACTOR_FORBIDDEN.test(v);
const isCreditId = (v: unknown): v is string => typeof v === "string" && CREDIT_ID_RE.test(v);
const exactKeys = (o: Record<string, unknown>, required: readonly string[], optional: readonly string[] = []): boolean => {
  for (const k of required) if (!(k in o)) return false;
  for (const k of Object.keys(o)) if (!required.includes(k) && !optional.includes(k)) return false;
  return true;
};

/** Canonical credit amount ("300.50" → "300.5"), or null when the text is not a valid positive amount. */
export function canonicalCreditAmount(raw: unknown): AmountString | null {
  if (typeof raw !== "string" || !AMOUNT_RE.test(raw)) return null;
  const d = decFromPlainString(raw);
  if (decIsZero(d) || decIsNegative(d)) return null;
  return serializeDec(d);
}

export function isValidSupplierId(v: unknown): v is string {
  return typeof v === "string" && v.length > 0 && v.length <= MAX_SUPPLIER_ID_LENGTH && v.trim() === v && !SUPPLIER_ID_FORBIDDEN.test(v);
}

/** A stored note / void reason: trimmed, non-empty, bounded, no control characters. */
export function isValidNote(v: unknown): v is string {
  return typeof v === "string" && v.length > 0 && v.length <= MAX_NOTE_LENGTH && v.trim() === v && !/[\u0000-\u001f]/.test(v);
}

// ── per-entry decoding (no cross-reference) ──────────────────────────────────────────────────────
const RECORD_REQUIRED = ["creditId", "logicalId", "tenantId", "bizId", "supplierId", "issueDate", "amount", "documentNumber", "documentKey", "operationId", "seq", "createdAt", "createdBy", "createdRole"] as const;
const RECORD_OPTIONAL = ["note", "replacesCreditId", "identityCorrection", "similarityConfirmation"] as const;

interface RawRecord {
  creditId: string; logicalId: string; supplierId: string; issueDate: BusinessDate; amount: AmountString;
  documentNumber: string; documentKey: string; note: string | null; replacesCreditId: string | null; identityCorrection: boolean;
  similarityConfirmation: { fingerprint:string; confirmedAgainst:string[]; reason:string; by:string; at:number } | null;
  operationId: string; seq: number; createdAt: number; createdBy: string; createdRole: string;
}
type Bad = { code: CreditIssueCode };

function decodeRecord(key: string, r: Record<string, unknown>, bind: { tenantId: string; bizId: string }): RawRecord | Bad {
  if (!exactKeys(r, RECORD_REQUIRED, RECORD_OPTIONAL)) return { code: "invalid_record" };
  if (!isCreditId(key) || r.creditId !== key) return { code: "id_mismatch" };
  if (r.tenantId !== bind.tenantId || r.bizId !== bind.bizId) return { code: "binding_mismatch" };
  if (!isBusinessDate(r.issueDate)) return { code: "invalid_issue_date" };
  if (!isValidSupplierId(r.supplierId)) return { code: "invalid_supplier" };
  const amount = canonicalCreditAmount(r.amount);
  // the stored amount must already be canonical (the writer canonicalizes): "300.50" is not a stored form
  if (amount === null || amount !== r.amount) return { code: "invalid_amount" };
  const doc = normalizeDocumentNumber(r.documentNumber);
  if (!doc.ok || doc.display !== r.documentNumber || doc.key !== r.documentKey) return { code: "invalid_document" };
  const sc = r.similarityConfirmation;
  if (sc !== undefined && (!isPlainObject(sc) || !exactKeys(sc, ["fingerprint", "confirmedAgainst", "reason", "by", "at"]) ||
    sc.fingerprint !== doc.fingerprint || !Array.isArray(sc.confirmedAgainst) || sc.confirmedAgainst.length === 0 ||
    !sc.confirmedAgainst.every(isCreditId) || new Set(sc.confirmedAgainst).size !== sc.confirmedAgainst.length ||
    [...sc.confirmedAgainst].sort().join("|") !== sc.confirmedAgainst.join("|") || !isValidNote(sc.reason) ||
    sc.by !== r.createdBy || sc.at !== r.createdAt)) return { code: "invalid_document" };
  if (r.note !== undefined && !isValidNote(r.note)) return { code: "invalid_record" };
  if (typeof r.operationId !== "string" || !OPERATION_ID_RE.test(r.operationId) || !isSafeInt(r.seq, 1)) return { code: "invalid_audit" };
  if (!isSafeInt(r.createdAt, 1) || !isActor(r.createdBy) || typeof r.createdRole !== "string" || !CREDIT_WRITER_ROLES.includes(r.createdRole)) return { code: "invalid_audit" };
  const repl = r.replacesCreditId;
  if (repl !== undefined && (!isCreditId(repl) || repl === key)) return { code: "invalid_link" };
  // root ⇔ its logical id is its own id; a successor never names itself as its logical credit
  if ((repl === undefined) !== (r.logicalId === key)) return { code: "invalid_link" };
  if (r.identityCorrection !== undefined && (r.identityCorrection !== true || repl === undefined)) return { code: "invalid_link" };
  return {
    creditId: key, logicalId: r.logicalId as string, supplierId: r.supplierId as string, issueDate: r.issueDate as BusinessDate, amount,
    documentNumber: doc.display, documentKey: doc.key,
    similarityConfirmation: sc === undefined ? null : sc as RawRecord["similarityConfirmation"], note: r.note === undefined ? null : (r.note as string),
    replacesCreditId: repl === undefined ? null : (repl as string), identityCorrection: r.identityCorrection === true,
    operationId: r.operationId as string, seq: r.seq as number, createdAt: r.createdAt as number, createdBy: r.createdBy as string, createdRole: r.createdRole as string,
  };
}

interface RawVoid {
  operationId: string; kind: "void" | "replace"; creditId: string; logicalId: string; seq: number;
  voidedAt: number; voidedBy: string; voidedRole: string; reasonText: string | null; replacedByCreditId: string | null;
}
function decodeVoid(key: string, v: Record<string, unknown>): RawVoid | null {
  if (!OPERATION_ID_RE.test(key) || v.operationId !== key) return null;
  const isReplace = v.kind === "replace";
  if (v.kind !== "void" && !isReplace) return null;
  const base = ["operationId", "kind", "creditId", "logicalId", "seq", "voidedAt", "voidedBy", "voidedRole", "reasonCode"];
  if (!exactKeys(v, isReplace ? [...base, "replacedByCreditId"] : base, isReplace ? [] : ["reasonText"])) return null;
  if (!isCreditId(v.creditId) || !isCreditId(v.logicalId) || !isSafeInt(v.seq, 2)) return null;
  if (!isSafeInt(v.voidedAt, 1) || !isActor(v.voidedBy) || typeof v.voidedRole !== "string" || !CREDIT_WRITER_ROLES.includes(v.voidedRole)) return null;
  if (v.reasonCode !== (isReplace ? "replaced" : "voided")) return null;
  if (isReplace && (!isCreditId(v.replacedByCreditId) || v.replacedByCreditId === v.creditId)) return null;
  if (!isReplace && v.reasonText !== undefined && !isValidNote(v.reasonText)) return null;
  return {
    operationId: key, kind: isReplace ? "replace" : "void", creditId: v.creditId as string, logicalId: v.logicalId as string, seq: v.seq as number,
    voidedAt: v.voidedAt as number, voidedBy: v.voidedBy as string, voidedRole: v.voidedRole as string,
    reasonText: v.reasonText === undefined ? null : (v.reasonText as string), replacedByCreditId: isReplace ? (v.replacedByCreditId as string) : null,
  };
}

const REVIEW_BASE = ["schema", "state", "kind", "logicalId", "creditId", "seq", "intentDigest", "actor", "actorRole", "committedAt"] as const;
export const REVIEW_RESOLUTIONS: Readonly<Record<"cleared" | "flagged", readonly string[]>> = Object.freeze({
  cleared: Object.freeze(["post_commit_authorized", "reconciled_authorized"]),
  flagged: Object.freeze(["revoked_during_commit", "reconciled_unauthorized"]),
});
interface RawReview extends ReviewEntry { resolvedAt: number | null; decidedAt: number | null; decidedBy: string | null }
function decodeReview(key: string, e: Record<string, unknown>, bind: {tenantId:string;bizId:string}, node: Record<string, unknown>): RawReview | null {
  if (!OPERATION_ID_RE.test(key) || e.schema !== CREDIT_REVIEW_SCHEMA) return null;
  const st = e.state, kind = e.kind;
  const decided = st === "rejected" || (st === "cleared" && e.decisionAudit !== undefined);
  const evidence = creditEvidence(node, key);
  if (!evidence || e.intentDigest !== evidence.intentDigest) return null;
  if (kind !== "create" && kind !== "void" && kind !== "replace") return null;
  const base: string[] = [...REVIEW_BASE, ...(kind === "replace" ? ["newCreditId"] : [])];
  const resolved = decided ? ["resolvedAt", "resolution", "flagAudit", "decidedAt", "decidedBy", "decisionOperationId", "decisionAudit"] : st === "cleared" ? ["resolvedAt", "resolution"] : st === "flagged" ? ["resolvedAt", "resolution", "flagAudit"] : st === "pending" ? [] : null;
  if (resolved === null || !exactKeys(e, [...base, ...resolved])) return null;
  if (!isCreditId(e.logicalId) || !isCreditId(e.creditId)) return null;
  if (kind === "replace" && !isCreditId(e.newCreditId)) return null;
  if (!isSafeInt(e.seq, 1) || typeof e.intentDigest !== "string" || !DIGEST_RE.test(e.intentDigest)) return null;
  if (!isActor(e.actor) || typeof e.actorRole !== "string" || !CREDIT_WRITER_ROLES.includes(e.actorRole) || !isSafeInt(e.committedAt, 1)) return null;
  if (st !== "pending") {
    if (!isSafeInt(e.resolvedAt, 1) || (e.resolvedAt as number) < (e.committedAt as number)) return null;
    const family = st === "cleared" && !decided ? "cleared" : "flagged";
    if (typeof e.resolution !== "string" || !REVIEW_RESOLUTIONS[family].includes(e.resolution)) return null;
  }
  if (decided) {
    if (!isSafeInt(e.decidedAt, 1) || (e.decidedAt as number) < (e.resolvedAt as number) || !isActor(e.decidedBy)) return null;
    const a = e.decisionAudit;
    if (!isPlainObject(a) || !exactKeys(a, ["contract", "operationId", "targetOperationId", "tenantId", "bizId", "intentDigest", "decision", "state", "by", "at", "supplierId", "documentKey", "creditId", "versionId", "payloadDigest"]) ||
      a.contract !== CREDIT_DECISION_AUDIT_SCHEMA || typeof a.operationId !== "string" || !OPERATION_ID_RE.test(a.operationId) || a.operationId !== e.decisionOperationId || a.targetOperationId !== key ||
      a.intentDigest !== e.intentDigest || a.decision !== (st === "cleared" ? "accepted" : "rejected") || a.state !== st || a.by !== e.decidedBy || a.at !== e.decidedAt ||
      a.tenantId !== bind.tenantId || a.bizId !== bind.bizId || !evidence ||
      a.supplierId !== evidence.supplierId || a.documentKey !== evidence.documentKey || a.creditId !== e.creditId ||
      a.versionId !== evidence.versionId || a.payloadDigest !== evidence.payloadDigest) return null;
  }
  if (st === "flagged" || decided) {
    const a = e.flagAudit;
    if (!isPlainObject(a) || !exactKeys(a, ["contract", "tenantId", "bizId", "operationId", "logicalId", "creditId", "intentDigest", "actor", "committedAt", "outcome", "detectedAt", "decision", "state", "supplierId", "documentKey", "versionId", "payloadDigest"]) ||
      a.contract !== CREDIT_FLAG_AUDIT_SCHEMA || a.decision !== "flagged" || a.state !== "flagged" || a.operationId !== key || a.logicalId !== e.logicalId || a.creditId !== e.creditId ||
      a.intentDigest !== e.intentDigest || a.actor !== e.actor || a.committedAt !== e.committedAt || a.outcome !== e.resolution || a.detectedAt !== e.resolvedAt ||
      a.tenantId !== bind.tenantId || a.bizId !== bind.bizId || !evidence ||
      a.supplierId !== evidence.supplierId || a.documentKey !== evidence.documentKey || a.creditId !== e.creditId ||
      a.versionId !== evidence.versionId || a.payloadDigest !== evidence.payloadDigest) return null;
  }
  return {
    operationId: key, kind, state: st as ReviewState, logicalId: e.logicalId as string, creditId: e.creditId as string, newCreditId: kind === "replace" ? (e.newCreditId as string) : null,
    seq: e.seq as number, intentDigest: e.intentDigest as string, actor: e.actor as string, actorRole: e.actorRole as string, committedAt: e.committedAt as number,
    resolvedAt: st === "pending" ? null : (e.resolvedAt as number), resolution: st === "pending" ? null : (e.resolution as string),
    decidedAt: decided ? (e.decidedAt as number) : null, decidedBy: decided ? (e.decidedBy as string) : null,
  };
}

interface RawDoc { supplierId: string; documentKey: string; logicalId: string; creditId: string; operationId: string; reservedAt: number; reservedBy: string }
/** The RTDB keys of an identity reservation (prefixed: never array-like). */
export const documentSupplierKey = (supplierId: string): string => "s_" + supplierId;
export const documentNumberKey = (documentKey: string): string => "d_" + documentKey;
function decodeDoc(sKey: string, dKey: string, d: unknown): RawDoc | null {
  if (!sKey.startsWith("s_") || !dKey.startsWith("d_")) return null;
  const supplierId = sKey.slice(2), documentKey = dKey.slice(2);
  if (!isPlainObject(d) || !exactKeys(d, ["logicalId", "creditId", "operationId", "reservedAt", "reservedBy"])) return null;
  if (!isValidSupplierId(supplierId) || documentKey.length === 0) return null;
  if (!isCreditId(d.logicalId) || !isCreditId(d.creditId)) return null;
  if (typeof d.operationId !== "string" || !OPERATION_ID_RE.test(d.operationId) || !isSafeInt(d.reservedAt, 1) || !isActor(d.reservedBy)) return null;
  return { supplierId, documentKey, logicalId: d.logicalId as string, creditId: d.creditId as string, operationId: d.operationId, reservedAt: d.reservedAt as number, reservedBy: d.reservedBy as string };
}

// ── one logical credit: cross-checks and the authoritative fold ──────────────────────────────────
interface Op { seq: number; kind: OperationKind; operationId: string; review: RawReview; record?: RawRecord; target?: string }
interface Group { logicalId: string; records: RawRecord[]; voids: RawVoid[]; head: unknown; reviewIds: string[] }
interface Folded {
  ok: true; logical: LogicalCredit; effective: EffectiveCredit | null;
  recordStatus: Map<string, RecordStatus>; successor: Map<string, string>; unresolvedOp: Op | null; touched: BusinessDate[];
}
const AUTHORITATIVE: readonly ReviewState[] = ["cleared"];
const UNRESOLVED: readonly ReviewState[] = ["pending", "flagged"];

function foldGroup(g: Group, reviews: Map<string, RawReview>, docs: Map<string, RawDoc>): Folded | Bad {
  const byId = new Map(g.records.map((r) => [r.creditId, r]));
  const root = byId.get(g.logicalId);
  if (!root || root.replacesCreditId !== null) return { code: "invalid_chain" };
  const ops: Op[] = [];
  for (const r of g.records) {
    const rv = reviews.get(r.operationId);
    if (!rv) return { code: "invalid_review" };
    if (rv.actor !== r.createdBy || rv.actorRole !== r.createdRole || rv.committedAt !== r.createdAt || rv.logicalId !== g.logicalId || rv.seq !== r.seq) return { code: "invalid_audit" };
    if (r.replacesCreditId === null) {
      if (rv.kind !== "create" || rv.creditId !== r.creditId || r.seq !== 1) return { code: "invalid_review" };
      ops.push({ seq: 1, kind: "create", operationId: r.operationId, review: rv, record: r });
    } else {
      const pred = byId.get(r.replacesCreditId);
      if (!pred) return { code: "invalid_link" };
      const ev = g.voids.find((v) => v.operationId === r.operationId);
      // reciprocal: the replace event of the SAME operation voids the predecessor and names this record
      if (!ev || ev.kind !== "replace" || ev.creditId !== pred.creditId || ev.replacedByCreditId !== r.creditId) return { code: "invalid_link" };
      if (ev.seq !== r.seq || ev.voidedAt !== r.createdAt || ev.voidedBy !== r.createdBy || ev.voidedRole !== r.createdRole) return { code: "invalid_audit" };
      if (rv.kind !== "replace" || rv.creditId !== pred.creditId || rv.newCreditId !== r.creditId) return { code: "invalid_review" };
      // identity: same supplier + document key, or an EXPLICIT audited corrected-identity replacement
      const same = pred.supplierId === r.supplierId && pred.documentKey === r.documentKey;
      if (same === r.identityCorrection) return { code: "invalid_document" };
      ops.push({ seq: r.seq, kind: "replace", operationId: r.operationId, review: rv, record: r, target: pred.creditId });
    }
  }
  for (const ev of g.voids) {
    const target = byId.get(ev.creditId);
    if (!target) return { code: "invalid_void" };
    if (ev.voidedAt < target.createdAt) return { code: "invalid_audit" };
    if (ev.kind === "replace") { const succ = byId.get(ev.replacedByCreditId as string); if (!succ || succ.operationId !== ev.operationId) return { code: "invalid_link" }; continue; }
    const rv = reviews.get(ev.operationId);
    if (!rv) return { code: "invalid_review" };
    if (rv.kind !== "void" || rv.creditId !== ev.creditId || rv.seq !== ev.seq || rv.logicalId !== g.logicalId) return { code: "invalid_review" };
    if (rv.actor !== ev.voidedBy || rv.actorRole !== ev.voidedRole || rv.committedAt !== ev.voidedAt) return { code: "invalid_audit" };
    ops.push({ seq: ev.seq, kind: "void", operationId: ev.operationId, review: rv, target: ev.creditId });
  }
  // every review entry of this logical credit is one of its operations (no detached review)
  const opIds = new Set(ops.map((o) => o.operationId));
  if (opIds.size !== ops.length || g.reviewIds.some((id) => !opIds.has(id))) return { code: "invalid_review" };
  // sequence: exactly 1..n; commit time non-decreasing along it
  ops.sort((a, b) => a.seq - b.seq);
  for (let i = 0; i < ops.length; i++) {
    if (ops[i].seq !== i + 1) return { code: "invalid_chain" };
    if (i > 0 && ops[i].review.committedAt < ops[i - 1].review.committedAt) return { code: "invalid_audit" };
  }
  // every record is reachable from the root along its predecessor links (no cycle, no detached record)
  for (const r of g.records) {
    let cur: RawRecord | undefined = r; const seen = new Set<string>();
    while (cur && cur.replacesCreditId !== null) { if (seen.has(cur.creditId)) return { code: "invalid_chain" }; seen.add(cur.creditId); cur = byId.get(cur.replacesCreditId); }
    if (!cur || cur.creditId !== g.logicalId) return { code: "invalid_chain" };
  }
  // documents: every record's identity is reserved for THIS logical credit; the reservation names the
  // first record that carried it (same operation, actor and commit time)
  for (const r of g.records) {
    const d = docs.get(r.supplierId + "\u0000" + r.documentKey);
    if (!d || d.logicalId !== g.logicalId) return { code: "invalid_document" };
    const first = byId.get(d.creditId);
    if (!first || first.supplierId !== r.supplierId || first.documentKey !== r.documentKey || d.operationId !== first.operationId || d.reservedAt !== first.createdAt || d.reservedBy !== first.createdBy || r.seq < first.seq) return { code: "invalid_document" };
  }
  // the fold: at most ONE unresolved operation, and it is the latest; rejected operations are skipped
  const unresolvedOps = ops.filter((o) => UNRESOLVED.includes(o.review.state));
  if (unresolvedOps.length > 1 || (unresolvedOps.length === 1 && unresolvedOps[0].seq !== ops.length)) return { code: "invalid_review" };
  const unresolvedOp = unresolvedOps[0] || null;
  const status = new Map<string, RecordStatus>(g.records.map((r) => [r.creditId, "not_effective" as RecordStatus]));
  const successor = new Map<string, string>();
  const auth = { tip: null as string | null, active: false };   // authoritative (accounting) state
  const struct = { tip: null as string | null, active: false }; // structural state: also the unresolved operation (the head points past it)
  let createRejected = false;
  const apply = (o: Op, cur: { tip: string | null; active: boolean }): boolean => {
    if (o.kind === "create") { if (cur.tip !== null) return false; cur.tip = (o.record as RawRecord).creditId; cur.active = true; return true; }
    if (cur.tip !== o.target || !cur.active) return false;
    if (o.kind === "void") { cur.active = false; return true; }
    cur.tip = (o.record as RawRecord).creditId; cur.active = true; return true;
  };
  for (const o of ops) {
    const st = o.review.state;
    if (st === "rejected") { if (o.kind === "create") createRejected = true; continue; }
    if (createRejected || !apply(o, struct)) return { code: "invalid_chain" };
    if (o.kind === "replace") successor.set(o.target as string, (o.record as RawRecord).creditId);
    if (AUTHORITATIVE.includes(st)) {
      if (!apply(o, auth)) return { code: "invalid_chain" };
      if (o.kind === "void") status.set(o.target as string, "voided");
      if (o.kind === "replace") status.set(o.target as string, "replaced");
    }
  }
  if (auth.tip !== null && auth.active) status.set(auth.tip, "active");
  // the current pointer: the structural tip (the root of a rejected creation) and the last sequence
  const h = g.head;
  const headCredit = createRejected ? g.logicalId : struct.tip;
  if (!isPlainObject(h) || !exactKeys(h, ["creditId", "seq"]) || h.creditId !== headCredit || h.seq !== ops.length) return { code: "invalid_head" };
  const touched: BusinessDate[] = [];
  if (unresolvedOp) {
    if (unresolvedOp.record) touched.push(unresolvedOp.record.issueDate);
    if (unresolvedOp.target) touched.push((byId.get(unresolvedOp.target) as RawRecord).issueDate);
  }
  const tipRec = auth.tip === null ? null : (byId.get(auth.tip) as RawRecord);
  const effective = tipRec && auth.active ? { creditId: tipRec.creditId, logicalId: g.logicalId, supplierId: tipRec.supplierId, issueDate: tipRec.issueDate, amount: tipRec.amount } : null;
  const lStatus: LogicalCredit["status"] = createRejected ? "rejected" : auth.tip === null ? "unresolved_create" : auth.active ? "active" : "voided";
  const unres = unresolvedOp ? { operationId: unresolvedOp.operationId, kind: unresolvedOp.kind, state: unresolvedOp.review.state as "pending" | "flagged" } : null;
  return { ok: true, logical: { logicalId: g.logicalId, head: { creditId: headCredit as string, seq: ops.length }, status: lStatus, unresolved: unres }, effective, recordStatus: status, successor, unresolvedOp, touched };
}

const ENVELOPE_REQUIRED = ["schemaVersion", "contract", "tenantId", "bizId", "revision", "updatedAt", "records"] as const;
const ENVELOPE_OPTIONAL = ["voids", "documents", "heads", "review", "operations"] as const;

/**
 * Strict decoding of the stored node. null/undefined/{} ⇒ absent (zero credits, complete). `expect`
 * (tenantId, bizId of the business being read) binds the node: a node of another business is
 * UNREADABLE. Every defect is an issue (never silently dropped and never counted).
 */
export function decodeSupplierCredits(raw: unknown, expect?: { readonly tenantId: string; readonly bizId: string }): SupplierCreditsState {
  if (raw === null || raw === undefined) return { state: "absent" };
  if (!isPlainObject(raw)) return { state: "unreadable", reason: "node_shape" };
  if (Object.keys(raw).length === 0) return { state: "absent" };
  if (raw.schemaVersion !== SUPPLIER_CREDITS_SCHEMA_VERSION) return { state: "unreadable", reason: "schema_version" };
  if (raw.contract !== SUPPLIER_CREDITS_CONTRACT_VERSION) return { state: "unreadable", reason: "contract" };
  if (!exactKeys(raw, ENVELOPE_REQUIRED, ENVELOPE_OPTIONAL)) return { state: "unreadable", reason: "envelope_keys" };
  if (!isSafeInt(raw.revision, 1) || !isSafeInt(raw.updatedAt, 1)) return { state: "unreadable", reason: "revision" };
  if (!isActor(raw.tenantId) || !isActor(raw.bizId) || (raw.bizId as string).includes(":")) return { state: "unreadable", reason: "binding" };
  if (expect && (raw.tenantId !== expect.tenantId || raw.bizId !== expect.bizId)) return { state: "unreadable", reason: "binding" };
  for (const k of ["records", "voids", "documents", "heads", "review"]) if (raw[k] !== undefined && !isPlainObject(raw[k])) return { state: "unreadable", reason: "section_shape" };
  const recs = raw.records as Record<string, unknown>;
  if (Object.keys(recs).length === 0) return { state: "unreadable", reason: "section_shape" };
  const bind = { tenantId: raw.tenantId as string, bizId: raw.bizId as string };

  // Defects: [logicalId or null (unattributable), key, code]. Dates are attached at the end.
  const defects: Array<[string | null, string, CreditIssueCode]> = [];
  const lidOf = (x: unknown): string | null => (isPlainObject(x) && isCreditId(x.logicalId) ? (x.logicalId as string) : null);
  // every logical credit named by a record object of THIS business, and the raw issue dates of its
  // records (for attribution, even when a record is invalid)
  const named = new Set<string>();
  const rawDates = new Map<string, Set<BusinessDate>>();
  for (const r of Object.values(recs)) {
    const lid = lidOf(r);
    if (lid === null || !isPlainObject(r) || r.tenantId !== bind.tenantId || r.bizId !== bind.bizId) continue;
    named.add(lid);
    if (isBusinessDate(r.issueDate)) rawDates.set(lid, (rawDates.get(lid) || new Set()).add(r.issueDate as BusinessDate));
  }
  const records: RawRecord[] = [];
  for (const key of Object.keys(recs).sort()) {
    const r = recs[key];
    if (!isPlainObject(r)) { defects.push([null, key, "invalid_record"]); continue; }
    const d = decodeRecord(key, r, bind);
    // a record bound to ANOTHER business is unattributable (cross-business contamination)
    if ("code" in d) defects.push([d.code === "binding_mismatch" ? null : lidOf(r), key, d.code]);
    else records.push(d);
  }
  // a logical credit with a defective record is already excluded: its other entries are not re-reported
  const recordDefective = new Set(defects.map((d) => d[0]).filter((x): x is string => x !== null));
  const untrustedDates = new Set<string>();
  const report = (lid: string | null, key: string, code: CreditIssueCode) => { if (lid === null || !recordDefective.has(lid)) defects.push([lid, key, code]); };
  for (const r of records) if (r.similarityConfirmation) {
    const fp = normalizeDocumentNumber(r.documentNumber);
    for (const logicalId of r.similarityConfirmation.confirmedAgainst) {
      if (!records.some((other) => other.logicalId === logicalId && other.logicalId !== r.logicalId && other.supplierId === r.supplierId &&
          other.documentKey !== r.documentKey && normalizeDocumentNumber(other.documentNumber).ok &&
          (normalizeDocumentNumber(other.documentNumber) as Extract<DocumentNumberResult,{ok:true}>).fingerprint === (fp as Extract<DocumentNumberResult,{ok:true}>).fingerprint))
        report(r.logicalId, r.creditId, "invalid_document");
    }
  }
  const reviews = new Map<string, RawReview>();
  for (const [k, e] of Object.entries((raw.review as Record<string, unknown>) || {})) {
    // A failed digest also invalidates the stored issue date. Never attach its defect to rawDates.
    // Decided and flagged entries retain their existing unreadable-node behavior.
    if (isPlainObject(e)) {
      const evidence = creditEvidence(raw, k);
      if (!evidence || e.intentDigest !== evidence.intentDigest) {
        if (e.state === "flagged" || e.state === "rejected" || e.flagAudit !== undefined || e.decisionAudit !== undefined)
          return { state: "unreadable", reason: "invalid_review_audit" };
        const lid = lidOf(e);
        if (lid !== null && recordDefective.has(lid)) untrustedDates.add(lid);
        else if (!evidence) return { state: "unreadable", reason: "invalid_review_audit" };
        else defects.push([null, k, "invalid_review"]);
        continue;
      }
    }
    const r = isPlainObject(e) ? decodeReview(k, e, bind, raw) : null;
    if (!r) {
      if (isPlainObject(e) && (e.state === "flagged" || e.state === "rejected" || e.flagAudit !== undefined || e.decisionAudit !== undefined))
        return { state: "unreadable", reason: "invalid_review_audit" };
      report(lidOf(e), k, "invalid_review"); continue;
    }
    reviews.set(k, r);
  }
  // A review section can be absent while records remain. Only a successfully decoded,
  // digest-verified review can establish a record's issue date for defect attribution.
  // Check the records themselves so deleting evidence cannot make a moved date trustworthy.
  for (const r of Object.values(recs)) {
    const lid = lidOf(r);
    if (lid === null || !isPlainObject(r) || r.tenantId !== bind.tenantId || r.bizId !== bind.bizId) continue;
    if (typeof r.operationId !== "string" || !reviews.has(r.operationId)) untrustedDates.add(lid);
  }
  const voidsByLogical = new Map<string, RawVoid[]>();
  for (const [k, v] of Object.entries((raw.voids as Record<string, unknown>) || {})) {
    const ev = isPlainObject(v) ? decodeVoid(k, v) : null;
    if (!ev) { report(lidOf(v), k, "invalid_void"); continue; }
    voidsByLogical.set(ev.logicalId, [...(voidsByLogical.get(ev.logicalId) || []), ev]);
  }
  const docs = new Map<string, RawDoc>();
  for (const [sid, inner] of Object.entries((raw.documents as Record<string, unknown>) || {})) {
    if (!isPlainObject(inner)) { defects.push([null, sid, "invalid_document"]); continue; }
    for (const [dk, d] of Object.entries(inner)) {
      const doc = decodeDoc(sid, dk, d);
      if (!doc) { report(lidOf(d), sid + "/" + dk, "invalid_document"); continue; }
      docs.set(doc.supplierId + "\u0000" + doc.documentKey, doc);
    }
  }
  const heads = (raw.heads as Record<string, unknown>) || {};
  const groups = new Map<string, Group>();
  for (const r of records) {
    const g = groups.get(r.logicalId) || { logicalId: r.logicalId, records: [], voids: voidsByLogical.get(r.logicalId) || [], head: heads[r.logicalId], reviewIds: [] };
    g.records.push(r); groups.set(r.logicalId, g);
  }
  for (const [opId, rv] of reviews) { const g = groups.get(rv.logicalId); if (g) g.reviewIds.push(opId); }
  // every void / review / document / head must belong to a logical credit that has records
  const known = named;
  for (const lid of voidsByLogical.keys()) if (!known.has(lid)) defects.push([null, lid, "orphan_entry"]);
  for (const lid of Object.keys(heads)) if (!known.has(lid)) defects.push([null, lid, "orphan_entry"]);
  for (const d of docs.values()) {
    if (!known.has(d.logicalId)) defects.push([null, d.supplierId + "/" + d.documentKey, "orphan_entry"]);
    // a reservation that no record of its logical credit carries is a detached identity
    else if (!records.some((r) => r.logicalId === d.logicalId && r.supplierId === d.supplierId && r.documentKey === d.documentKey)) report(d.logicalId, d.supplierId + "/" + d.documentKey, "invalid_document");
  }
  for (const [opId, rv] of reviews) if (!known.has(rv.logicalId)) defects.push([null, opId, "orphan_entry"]);

  const badLogical = new Set(defects.map((d) => d[0]).filter((x): x is string => x !== null));
  const out: SupplierCredit[] = [];
  const logical: LogicalCredit[] = [];
  const credits: EffectiveCredit[] = [];
  const pending: string[] = [], flagged: string[] = [];
  const issues: CreditIssue[] = [];
  for (const lid of [...groups.keys()].sort()) {
    if (badLogical.has(lid)) continue;
    const g = groups.get(lid) as Group;
    const f = foldGroup(g, reviews, docs);
    if (!("ok" in f)) { defects.push([lid, lid, f.code]); badLogical.add(lid); continue; }
    logical.push(f.logical);
    if (f.effective) credits.push(f.effective);
    if (f.unresolvedOp) {
      const st = f.unresolvedOp.review.state;
      (st === "pending" ? pending : flagged).push(f.unresolvedOp.operationId);
      issues.push({ key: f.unresolvedOp.operationId, code: st === "pending" ? "review_pending" : "review_flagged", dates: [...new Set(f.touched)].sort() });
    }
    for (const r of g.records) {
      const u = f.unresolvedOp;
      const touches = !!u && ((u.record !== undefined && u.record.creditId === r.creditId) || u.target === r.creditId);
      out.push({
        creditId: r.creditId, logicalId: r.logicalId, supplierId: r.supplierId, issueDate: r.issueDate, amount: r.amount,
        status: f.recordStatus.get(r.creditId) as RecordStatus, documentNumber: r.documentNumber, documentKey: r.documentKey,
        similarityConfirmation: r.similarityConfirmation, note: r.note,
        replacesCreditId: r.replacesCreditId, replacedByCreditId: f.successor.get(r.creditId) || null, identityCorrection: r.identityCorrection,
        operationId: r.operationId, seq: r.seq, createdAt: r.createdAt, createdBy: r.createdBy, createdRole: r.createdRole,
        review: (reviews.get(r.operationId) as RawReview).state, unresolved: touches ? f.logical.unresolved : null,
      });
    }
  }
  // a defective logical credit contributes NOTHING; its issue covers every issue date of its records
  for (const [lid, key, code] of defects) issues.push({ key, code, dates: lid === null || untrustedDates.has(lid) ? [] : [...(rawDates.get(lid) || [])].sort() });
  out.sort((a, b) => (a.creditId < b.creditId ? -1 : a.creditId > b.creditId ? 1 : 0));
  const reviewList: ReviewEntry[] = [...reviews.values()]
    .map((r) => ({ operationId: r.operationId, kind: r.kind, state: r.state, logicalId: r.logicalId, creditId: r.creditId, newCreditId: r.newCreditId, seq: r.seq, intentDigest: r.intentDigest, actor: r.actor, actorRole: r.actorRole, committedAt: r.committedAt, resolution: r.resolution }))
    .sort((a, b) => (a.operationId < b.operationId ? -1 : 1));
  credits.sort((a, b) => (a.creditId < b.creditId ? -1 : 1));
  issues.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
  return {
    state: "present", revision: raw.revision as number, tenantId: bind.tenantId, bizId: bind.bizId,
    records: out, logical, reviews: reviewList, credits, issues, unresolved: { pending: pending.sort(), flagged: flagged.sort() },
  };
}

/** Issue codes that are NOT a data defect: the operation is valid but its authorization review is unresolved. */
export const REVIEW_ISSUE_CODES: readonly CreditIssueCode[] = Object.freeze(["review_pending", "review_flagged"]);

const ABSENT_CREDITS: DayCredits = Object.freeze({ presence: "absent", partial: false, value: null, bySupplier: Object.freeze({}) as Readonly<Record<string, AmountString>>, count: 0, reason: null });

/**
 * Per-date credit facts for the given dates (EFFECTIVE credits only, keyed by ISSUE date).
 * unreadable / not_loaded / an unattributable issue ⇒ every date is INVALID (never zero).
 * An attributable issue (a defective logical credit, or an unresolved review) ⇒ its dates are partial
 * (presence invalid when no effective credit is there). Reason precedence on a date: a data defect
 * (invalid_supplier_credit) over a flagged review over a pending review.
 */
export function creditsByDate(state: SupplierCreditsState | undefined, dates: readonly BusinessDate[]): Map<BusinessDate, DayCredits> {
  const out = new Map<BusinessDate, DayCredits>();
  const st: SupplierCreditsState = state || { state: "absent" };
  if (st.state === "absent") { for (const d of dates) out.set(d, ABSENT_CREDITS); return out; }
  const allInvalid = st.state !== "present" || st.issues.some((i) => i.dates.length === 0);
  const reasonAll = st.state === "unreadable" ? "supplier_credits_unreadable" : st.state === "not_loaded" ? "supplier_credits_not_loaded" : "invalid_supplier_credit";
  const wanted = new Set(dates);
  const sums = new Map<BusinessDate, { value: Dec; by: Map<string, Dec>; count: number }>();
  const dateReason = new Map<BusinessDate, string>();
  const rank = (r: string) => (r === "invalid_supplier_credit" ? 3 : r === "supplier_credit_review_flagged" ? 2 : 1);
  if (st.state === "present") {
    for (const c of st.credits) {
      if (!wanted.has(c.issueDate)) continue;
      const v = decFromPlainString(c.amount);
      const s = sums.get(c.issueDate) || { value: decFromPlainString("0"), by: new Map<string, Dec>(), count: 0 };
      s.value = decAdd(s.value, v);
      const k = SUPPLIER_SOURCE_PREFIX + c.supplierId;
      s.by.set(k, s.by.has(k) ? decAdd(s.by.get(k) as Dec, v) : v);
      s.count += 1;
      sums.set(c.issueDate, s);
    }
    for (const i of st.issues) {
      const r = i.code === "review_pending" ? "supplier_credit_review_pending" : i.code === "review_flagged" ? "supplier_credit_review_flagged" : "invalid_supplier_credit";
      for (const d of i.dates) { const prev = dateReason.get(d); if (!prev || rank(r) > rank(prev)) dateReason.set(d, r); }
    }
  }
  for (const d of dates) {
    const s = sums.get(d);
    const reason = allInvalid ? reasonAll : dateReason.get(d) || null;
    const invalid = reason !== null;
    if (!s && !invalid) { out.set(d, ABSENT_CREDITS); continue; }
    const bySupplier = s ? Object.fromEntries([...s.by.keys()].sort().map((k) => [k, serializeDec(s.by.get(k) as Dec)])) : {};
    out.set(d, { presence: s ? "present" : "invalid", partial: !!s && invalid, value: s ? s.value : null, bySupplier, count: s ? s.count : 0, reason });
  }
  return out;
}

/** The day flag that discloses an incomplete credit fact (by reason). */
function creditFlagCode(reason: string | null): Flag["code"] {
  if (reason === "supplier_credits_unreadable" || reason === "supplier_credits_not_loaded") return "supplier_credits_unreadable";
  if (reason === "supplier_credit_review_pending") return "supplier_credit_review_pending";
  if (reason === "supplier_credit_review_flagged") return "supplier_credit_review_flagged";
  return "invalid_supplier_credit";
}

/**
 * Apply one date's credits to its canonical day (the ONE place gross becomes net).
 *   purchasesGross = the day's purchases as recorded in entries (unchanged);
 *   purchases      = gross − credits when gross is present (bySource per supplier net; a credit
 *                    of a supplier without gross that day is a negative entry); gross absent or
 *                    invalid stays absent/invalid (the credit is still carried in supplierCredits
 *                    and counted by the period report);
 *   an incomplete credit fact (invalid / unreadable / unresolved review) marks present purchases
 *   partial (never complete).
 */
export function applySupplierCreditsToDay(day: CanonicalDay, credits: DayCredits): CanonicalDay {
  const gross = day.purchases;
  const flags: Flag[] = [...day.flags];
  // no credit issued that date and a complete source: the day is unchanged (no added fields), so a
  // business without credits gives byte-identical days, reports and docs to MARJIN_PRODUCT/2.
  if (credits.presence === "absent" && !credits.partial) return day;
  const done = (d: CanonicalDay): CanonicalDay => ({ ...d, flags: sortFlags(d.flags) });
  const creditsIncomplete = credits.presence === "invalid" || credits.partial;
  if (creditsIncomplete) flags.push({ code: creditFlagCode(credits.reason), date: day.date, ...(credits.reason ? { reason: credits.reason } : {}) });
  if (gross.presence !== "present" || gross.value === null) {
    return done({ ...day, purchasesGross: gross, supplierCredits: credits, flags });
  }
  let value = gross.value;
  const by = new Map<string, Dec>();
  for (const [k, v] of Object.entries(gross.bySource)) by.set(k, decFromPlainString(v));
  if (credits.presence === "present" && credits.value !== null) {
    value = decSub(value, credits.value);
    for (const [k, v] of Object.entries(credits.bySupplier)) {
      const c = decFromPlainString(v);
      by.set(k, by.has(k) ? decSub(by.get(k) as Dec, c) : decSub(decFromPlainString("0"), c));
    }
  }
  if (decIsNegative(value)) flags.push({ code: "negative_net_purchases", date: day.date });
  const bySource = Object.fromEntries([...by.keys()].sort().map((k) => [k, serializeDec(by.get(k) as Dec)]));
  const purchases = { presence: gross.presence, partial: gross.partial || creditsIncomplete, value, bySource };
  return done({ ...day, purchases, purchasesGross: gross, supplierCredits: credits, flags });
}
