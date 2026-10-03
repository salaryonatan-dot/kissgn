// MARJIN_COSTH/1 — strict, pure F1 history reader, ported from the reviewed R2 experiment.
import { israelBusinessDate, parseBusinessDate } from "./businessDate.js";

// MARJIN_COSTH/2 (F1 R1): the node carries a per-version AUTHORIZATION REVIEW map written in the SAME
// transaction as the version. A version whose review is unresolved (pending / flagged) makes the whole
// history non-authoritative (unreadable), so a DEC-AUTH-1 in-window commit can never silently become
// ordinary history when its post-commit audit fails. A /1 reader sees a /2 node as malformed (fail closed).
// MARJIN_COSTH/5 (R3): the common review lifecycle gains the terminal `rejected` state (owner decision 2):
// a rejected version stays immutable with its flag audit, is PERMANENTLY excluded from calculations, never
// withholds the history, can never be reactivated, and the chain continues from it (a corrected successor
// names it as predecessor). The reader can be BOUND to the expected tenant / business: a flag audit that
// names another business is unreadable. A /4 reader sees a rejected entry as malformed (fail closed).
export const COST_HISTORY_CAPABILITY = "MARJIN_COSTH/5";
export type CostHistoryDecision =
  | { readonly state: "absent" }
  | { readonly state: "present"; readonly head: { readonly revision: number; readonly headVersionId: string }; readonly versions: readonly any[]; readonly activationDate: string | null; readonly rejected: readonly string[] }
  | { readonly state: "unreadable"; readonly reason: string; readonly detail?: unknown };
/**
 * Authorization-review states (MARJIN_COSTR/3). Only `cleared` and `acknowledged` (cleared BY THE OWNER
 * after a flag; the flag audit is retained) are authoritative. `pending` / `flagged` are unresolved and
 * withhold the history. `rejected` is terminal and never authoritative; it does not withhold the history.
 */
export type CostReviewState = "pending" | "cleared" | "flagged" | "acknowledged" | "rejected";
/** Expected binding of a stored node (R3): every flag audit must name exactly this tenant and business. */
export interface HistoryBinding { readonly tenantId: string; readonly bizId: string }
//
// PURE and browser-safe: no imports, no clock, no I/O. The approved core date functions are INJECTED
// (server: fincore/v1/finance/businessDate.js; browser: window.MarjinFinance.finance.businessDate),
// so server and browser run the same decision logic over the same raw snapshot value.
//
//   decodeHistory(read) → { state:"absent" }                               successful read, node absent
//                       | { state:"present", head, versions, activationDate } fully valid history
//                       | { state:"unreadable", reason, detail? }          failed/denied read OR any defect
// There is no partial result: one invalid record, a broken chain, a semantic-invariant violation or a
// malformed envelope makes the WHOLE history unreadable (withhold cost-dependent outputs).
// A failed or denied read is never "absent".
export const HISTORY_KEY_RE = /^biz:[^:]+:cost_history$/;          // the ONE storage key (R2)
export const RECORD_SCHEMA = "MARJIN_COSTV/1";
export const ATTESTED_RECORD_SCHEMA = "MARJIN_COSTV/2";
export const REVIEW_SCHEMA = "MARJIN_COSTR/3";
export const FLAG_AUDIT_SCHEMA = "MARJIN_COST_AUDIT/2";
export const REVIEW_RESOLUTIONS = Object.freeze({
  cleared: ["post_commit_authorized", "reconciled_authorized"],
  flagged: ["revoked_during_commit", "reconciled_unauthorized"],
});
const DIGEST = /^[0-9a-f]{64}$/;
export const UUID4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const DEC = /^(0|[1-9][0-9]*)(\.[0-9]*[1-9])?$/;
const MAX_INSTANT_MS = 8640000000000000;                             // ECMAScript Date range
const isObj = (x: unknown): x is Record<string, any> => x !== null && typeof x === "object" && !Array.isArray(x);
const only = (o: Record<string, any>, allowed: readonly string[]) => Object.keys(o).every((k) => allowed.includes(k));
const RECORD_FIELDS = ["versionId", "schema", "effectiveFrom", "recordedAt", "recordedBy", "basis", "globalEmployeesCount", "fixedItemsCount", "globalEmployees", "fixedItems", "rent", "royalty", "note", "predecessorVersionId", "attestationReason", "attestationDigest", "attestedBy", "attestedAt"];

/**
 * @param core {{ israelBusinessDate(ms:number):string, parseBusinessDate(d:string):object|null }}
 */
export function createHistoryCodec(core: { israelBusinessDate(ms: number): string; parseBusinessDate(date: string): unknown | null }) {
  if (!core || typeof core.israelBusinessDate !== "function" || typeof core.parseBusinessDate !== "function") throw new Error("core date functions required");
  const nonNegInt = (x: unknown) => typeof x === "number" && Number.isSafeInteger(x) && x >= 0;
  const validDate = (s: unknown) => typeof s === "string" && core.parseBusinessDate(s) !== null;
  const validInstant = (x: unknown) => typeof x === "number" && Number.isSafeInteger(x) && x >= 1 && x <= MAX_INSTANT_MS;

  function decodeList(raw: unknown, count: unknown, keyField: string, amountField: string, label: string): any {
    if (!nonNegInt(count)) return { error: label + "_count_invalid" };
    if (count === 0) return raw === undefined ? { items: [] } : { error: label + "_present_with_zero_count" };
    if (raw === undefined) return { error: label + "_missing" };
    if (!Array.isArray(raw)) return { error: label + "_not_dense_list" };
    if (raw.length !== count) return { error: label + "_count_mismatch" };
    const items = [], seen = new Set();
    for (let i = 0; i < raw.length; i++) {
      const it = raw[i];
      if (!isObj(it)) return { error: label + "_hole_or_bad_item" };
      if (!only(it, [keyField, "name", amountField])) return { error: label + "_item_extra_field" };
      if (typeof it[keyField] !== "string" || it[keyField] === "") return { error: label + "_item_key_invalid" };
      if (seen.has(it[keyField])) return { error: label + "_duplicate_key" };
      seen.add(it[keyField]);
      if (it.name !== undefined && typeof it.name !== "string") return { error: label + "_item_name_invalid" };
      if (typeof it[amountField] !== "string" || !DEC.test(it[amountField])) return { error: label + "_item_amount_invalid" };
      items.push(it.name === undefined ? { [keyField]: it[keyField], [amountField]: it[amountField] } : { [keyField]: it[keyField], name: it.name, [amountField]: it[amountField] });
    }
    return { items };
  }

  /** One stored record (wire) → logical record, or { error }. Includes the R2 semantic invariants. */
  function decodeRecord(key: string, r: unknown): any {
    if (!isObj(r)) return { error: "record_not_object" };
    if (!only(r, RECORD_FIELDS)) return { error: "extra_field" };
    if (!UUID4.test(key) || r.versionId !== key) return { error: "version_id_mismatch" };
    if (r.schema !== RECORD_SCHEMA && r.schema !== ATTESTED_RECORD_SCHEMA) return { error: "schema_invalid" };
    if (!validDate(r.effectiveFrom)) return { error: "effective_from_invalid" };
    if (!validInstant(r.recordedAt)) return { error: "recorded_at_invalid" };
    if (typeof r.recordedBy !== "string" || r.recordedBy === "") return { error: "recorded_by_invalid" };
    if (r.basis !== "recorded" && r.basis !== "attested_retroactive") return { error: "basis_invalid" };
    if (r.basis === "recorded" && r.schema !== RECORD_SCHEMA) return { error: "recorded_schema_invalid" };
    if (r.basis === "attested_retroactive") {
      if (r.schema !== ATTESTED_RECORD_SCHEMA || typeof r.attestationReason !== "string" || !r.attestationReason.trim() || r.attestationReason.length > 500 ||
        typeof r.attestationDigest !== "string" || !DIGEST.test(r.attestationDigest) || r.attestedBy !== r.recordedBy || r.attestedAt !== r.recordedAt) return { error: "attestation_record_invalid" };
    } else if (r.attestationReason !== undefined || r.attestationDigest !== undefined || r.attestedBy !== undefined || r.attestedAt !== undefined) return { error: "attestation_on_recorded" };
    if (r.predecessorVersionId === undefined) return { error: "predecessor_missing" };
    if (r.predecessorVersionId !== "none" && (!UUID4.test(r.predecessorVersionId) || r.predecessorVersionId === key)) return { error: "predecessor_invalid" };
    // R2 C3: the authoritative server timestamp fixes the record's business date; FOD-4 basis rule.
    const recordedDate = core.israelBusinessDate(r.recordedAt);
    if (r.basis === "recorded" && r.effectiveFrom < recordedDate) return { error: "recorded_backdated" };
    if (r.basis === "attested_retroactive" && r.effectiveFrom >= recordedDate) return { error: "attested_not_past" };
    const ge = decodeList(r.globalEmployees, r.globalEmployeesCount, "employeeKey", "monthlyEmployerCost", "global_employees");
    if (ge.error) return ge;
    const fi = decodeList(r.fixedItems, r.fixedItemsCount, "itemKey", "monthlyAmount", "fixed_items");
    if (fi.error) return fi;
    const rent = r.rent, roy = r.royalty;
    if (!isObj(rent) || !only(rent, ["mode", "monthlyAmount", "ratePct"])) return { error: "rent_invalid" };
    if (rent.mode === "none" ? (rent.monthlyAmount !== undefined || rent.ratePct !== undefined)
      : rent.mode === "fixed" ? !(DEC.test(rent.monthlyAmount ?? "") && rent.ratePct === undefined)
      : rent.mode === "pct" ? !(DEC.test(rent.ratePct ?? "") && rent.monthlyAmount === undefined) : true) return { error: "rent_invalid" };
    if (!isObj(roy) || !only(roy, ["mode", "ratePct"])) return { error: "royalty_invalid" };
    if (roy.mode === "none" ? roy.ratePct !== undefined : roy.mode === "pct" ? !DEC.test(roy.ratePct ?? "") : true) return { error: "royalty_invalid" };
    if (r.note !== undefined && (typeof r.note !== "string" || r.note.length > 200)) return { error: "note_invalid" };
    const out: Record<string, any> = { versionId: key, effectiveFrom: r.effectiveFrom, recordedAt: r.recordedAt, recordedBy: r.recordedBy, basis: r.basis,
      predecessorVersionId: r.predecessorVersionId, globalEmployees: ge.items, fixedItems: fi.items, rent: { ...rent }, royalty: { ...roy } };
    if (r.note !== undefined) out.note = r.note;
    if (r.basis === "attested_retroactive") { out.attestationReason = r.attestationReason; out.attestationDigest = r.attestationDigest; out.attestedBy = r.attestedBy; out.attestedAt = r.attestedAt; }
    return { record: out };
  }

  function validHead(h: unknown) {
    return isObj(h) && Object.keys(h).length === 2 && only(h, ["revision", "headVersionId"]) &&
      Number.isSafeInteger(h.revision) && h.revision >= 1 && typeof h.headVersionId === "string" && UUID4.test(h.headVersionId);
  }

  /**
   * One review entry, bound to its version: the actor and commit instant must be the version's own
   * recordedBy / recordedAt (a review cannot be re-pointed at another version or payload).
   */
  function decodeReview(key: string, e: unknown, v: any, bind?: HistoryBinding | null): any {
    if (!isObj(e)) return { error: "review_not_object" };
    if (e.schema !== REVIEW_SCHEMA) return { error: "review_schema_invalid" };
    if (typeof e.intentDigest !== "string" || !DIGEST.test(e.intentDigest)) return { error: "review_digest_invalid" };
    if (e.actor !== v.recordedBy || e.committedAt !== v.recordedAt) return { error: "review_binding_mismatch" };
    const base = ["schema", "state", "intentDigest", "actor", "committedAt"];
    if (e.state === "pending") return only(e, base) ? { review: { state: "pending", intentDigest: e.intentDigest } } : { error: "review_extra_field" };
    if (e.state !== "cleared" && e.state !== "flagged" && e.state !== "acknowledged" && e.state !== "rejected") return { error: "review_state_invalid" };
    const resolved = [...base, "resolvedAt", "resolution"];
    const flagged = e.state === "flagged" || e.state === "acknowledged" || e.state === "rejected";
    const fields = e.state === "acknowledged" ? [...resolved, "flagAudit", "acknowledgedAt", "acknowledgedBy", "acceptOperationId"]
      : e.state === "rejected" ? [...resolved, "flagAudit", "rejectedAt", "rejectedBy", "rejectOperationId"]
      : flagged ? [...resolved, "flagAudit"] : resolved;
    if (!only(e, fields) || !fields.every((f) => e[f] !== undefined)) return { error: "review_fields_invalid" };
    if (!validInstant(e.resolvedAt) || e.resolvedAt < e.committedAt) return { error: "review_resolved_at_invalid" };
    const allowed = e.state === "cleared" ? REVIEW_RESOLUTIONS.cleared : REVIEW_RESOLUTIONS.flagged;
    if (!allowed.includes(e.resolution)) return { error: "review_resolution_invalid" };
    if (flagged) {
      const a = e.flagAudit;
      const auditFields = ["schema", "operationId", "tenantId", "bizId", "versionId", "intentDigest", "recordedBy", "recordedAt", "outcome", "detectedAt"];
      if (!isObj(a) || Object.keys(a).length !== auditFields.length || !only(a, auditFields) ||
        a.schema !== FLAG_AUDIT_SCHEMA || typeof a.operationId !== "string" || !DIGEST.test(a.operationId) ||
        typeof a.tenantId !== "string" || !a.tenantId || typeof a.bizId !== "string" || !a.bizId ||
        a.versionId !== key || a.intentDigest !== e.intentDigest || a.recordedBy !== v.recordedBy ||
        a.recordedAt !== v.recordedAt || a.outcome !== e.resolution || !validInstant(a.detectedAt) ||
        a.detectedAt < v.recordedAt || a.detectedAt !== e.resolvedAt) return { error: "flag_audit_invalid" };
      // R3: a bound reader refuses an audit that names another tenant or business
      if (bind && (a.tenantId !== bind.tenantId || a.bizId !== bind.bizId)) return { error: "flag_audit_binding_mismatch" };
    }
    if (e.state === "acknowledged" && (!validInstant(e.acknowledgedAt) || e.acknowledgedAt < e.resolvedAt || typeof e.acknowledgedBy !== "string" || e.acknowledgedBy === "")) return { error: "review_ack_invalid" };
    if (e.state === "acknowledged" && (typeof e.acceptOperationId !== "string" || !UUID4.test(e.acceptOperationId))) return { error: "review_ack_operation_invalid" };
    // R3: the owner's rejection carries the same decision evidence as an acceptance
    if (e.state === "rejected" && (!validInstant(e.rejectedAt) || e.rejectedAt < e.resolvedAt || typeof e.rejectedBy !== "string" || e.rejectedBy === "")) return { error: "review_reject_invalid" };
    if (e.state === "rejected" && (typeof e.rejectOperationId !== "string" || !UUID4.test(e.rejectOperationId))) return { error: "review_reject_operation_invalid" };
    return { review: { state: e.state, intentDigest: e.intentDigest, resolution: e.resolution } };
  }

  /**
   * read = { exists, value } from ONE snapshot of the node, or { failed: error }. Authoritative decision.
   * `bind` (R3, optional): the expected tenant / business; a flag audit naming another one is unreadable.
   * `versions` holds ONLY the effective (non-rejected) versions, oldest → newest; `rejected` lists the
   * rejected version ids. A history whose every version is rejected is present with no effective version
   * (no activation date): cost outputs stay withheld until an owner activates again.
   */
  function decodeHistory(read: { exists?: boolean; value?: unknown; failed?: unknown } | null, bind?: HistoryBinding | null): any {
    const h = decodeHistoryStructure(read, bind);
    if (h.state !== "present") return h;
    // F1 R1: an unresolved authorization review (DEC-AUTH-1 window) withholds the WHOLE history.
    if (h.unresolved.pending.length) return { state: "unreadable", reason: "authorization_review_pending", detail: h.unresolved.pending };
    if (h.unresolved.flagged.length) return { state: "unreadable", reason: "authorization_review_flagged", detail: h.unresolved.flagged };
    return { state: "present", head: h.head, versions: h.effectiveVersions, activationDate: h.activationDate, rejected: h.rejected };
  }

  /**
   * Structural decision only (TRUSTED WRITERS / REVIEW RESOLUTION): the same strict validation, but an
   * unresolved review is reported in `unresolved` instead of withholding the history. Never used to
   * compute financial outputs.
   */
  function decodeHistoryStructure(read: { exists?: boolean; value?: unknown; failed?: unknown } | null, bind?: HistoryBinding | null): any {
    if (bind !== undefined && bind !== null && (typeof bind.tenantId !== "string" || bind.tenantId === "" || typeof bind.bizId !== "string" || bind.bizId === "")) return { state: "unreadable", reason: "binding_invalid" };
    if (!read || read.failed !== undefined) {
      return { state: "unreadable", reason: "read_failed", detail: String((read && read.failed && typeof read.failed === "object" && "message" in read.failed && read.failed.message) || (read && read.failed) || "no_read") };
    }
    const raw = read.value;
    if (!read.exists || raw === null || raw === undefined) return { state: "absent" };
    if (!isObj(raw) || Object.keys(raw).length !== 3 || !only(raw, ["head", "versions", "review"])) return { state: "unreadable", reason: "envelope_shape" };
    if (!validHead(raw.head)) return { state: "unreadable", reason: "head_shape" };
    const vs = raw.versions;
    if (!isObj(vs) || Object.keys(vs).length === 0) return { state: "unreadable", reason: "versions_shape" };
    const byId: Record<string, any> = {};
    for (const key of Object.keys(vs)) {
      if (!UUID4.test(key)) return { state: "unreadable", reason: "version_key_invalid", detail: key };
      const d = decodeRecord(key, vs[key]);
      if (d.error) {
        return { state: "unreadable", reason: "record_invalid", detail: { versionId: key, error: d.error } };
      }
      byId[key] = d.record;
    }
    // chain: head → predecessor … → "none"; visits every version once; length = revision; strictly monotone recordedAt
    const chain: any[] = [], seen = new Set<string>();
    let id = raw.head.headVersionId;
    if (!byId[id]) return { state: "unreadable", reason: "head_missing_version" };
      while (id !== "none") {
        const v = byId[id];
        if (!v) return { state: "unreadable", reason: "chain_dangling", detail: id };
        if (seen.has(id)) return { state: "unreadable", reason: "chain_cycle", detail: id };
        seen.add(id); chain.push(v); id = v.predecessorVersionId;
      }
      if (seen.size !== Object.keys(byId).length) return { state: "unreadable", reason: "chain_disconnected" };
      if (chain.length !== raw.head.revision) return { state: "unreadable", reason: "head_revision_mismatch" };
      chain.reverse();                                                   // oldest → newest
        for (let i = 1; i < chain.length; i++) if (!(chain[i].recordedAt > chain[i - 1].recordedAt)) return { state: "unreadable", reason: "chain_not_monotonic", detail: chain[i].versionId };

    // review map: exactly one valid entry per version (keys equal), bound to that version
    const rv = raw.review;
    if (!isObj(rv) || Object.keys(rv).length !== chain.length || !Object.keys(rv).every((k) => byId[k] !== undefined)) return { state: "unreadable", reason: "review_shape" };
    const review: Record<string, any> = {}, pending: string[] = [], flagged: string[] = [], rejected: string[] = [];
    for (const v of chain) {
      const r = decodeReview(v.versionId, rv[v.versionId], v, bind);
      if (r.error) return { state: "unreadable", reason: "review_invalid", detail: { versionId: v.versionId, error: r.error } };
      review[v.versionId] = r.review;
      if (r.review.state === "pending") pending.push(v.versionId);
      if (r.review.state === "flagged") flagged.push(v.versionId);
      if (r.review.state === "rejected") rejected.push(v.versionId);
    }
    // R3: a rejected version is structurally part of the chain but never part of the effective timeline
    const effectiveVersions = chain.filter((v) => review[v.versionId].state !== "rejected");
    return { state: "present", head: { revision: raw.head.revision, headVersionId: raw.head.headVersionId }, versions: chain, effectiveVersions, rejected, activationDate: activationDate(effectiveVersions), review, unresolved: { pending, flagged } };
  }
  return { decodeRecord, decodeHistory, decodeHistoryStructure, decodeReview, validHead };
}

/** First RECORDED effective version's effectiveFrom (attested versions never move activation; rejected versions never count). */
export function activationDate(versions: readonly any[]): string | null {
  const rec = versions.filter((v) => v.basis === "recorded").map((v) => v.effectiveFrom).sort();
  return rec.length ? rec[0] : null;
}

/**
 * Approved same-effective-date rule (F1 §3): greatest (recordedAt, versionId) wins. Under R2's strictly
 * monotone chain this is always the newest version in chain order; the versionId tie-break is retained
 * for determinism but is unreachable for any history the codec accepts.
 */
export function winnersByEffectiveDate(versions: readonly any[]): Record<string, any> {
  const out: Record<string, any> = {};
  for (const v of versions) {
    const w = out[v.effectiveFrom];
    if (!w || v.recordedAt > w.recordedAt || (v.recordedAt === w.recordedAt && v.versionId > w.versionId)) out[v.effectiveFrom] = v;
  }
  return out;
}

/**
 * F1 timeline-source mapping. Unreadable history NEVER falls back to current settings.
 *   absent     → labelled compat_current_config (FOD-1; existing "לפי הגדרות נוכחיות" basis label)
 *   present    → recorded history (FOD-6: preActivation "none")
 *   unreadable → unavailable (cost-dependent outputs withheld, typed issue carried)
 */
export function timelineSourceFor(decoded: any) {
  if (decoded && decoded.state === "absent") return { source: "compat_current_config", basis: "current_applied_retrospectively" };
  if (decoded && decoded.state === "present") return { source: "cost_history", preActivation: "none", activationDate: decoded.activationDate };
  return { source: "unavailable", issue: "cost_history_unreadable", reason: decoded && decoded.reason };
}

export const costHistoryCodec = createHistoryCodec({ israelBusinessDate, parseBusinessDate });
