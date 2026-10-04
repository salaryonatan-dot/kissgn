// MARJIN_COSTH/1 — strict, pure F1 history reader, ported from the reviewed R2 experiment.
import { israelBusinessDate, parseBusinessDate } from "./businessDate.js";
import { canonicalDigest, canonicalJson } from "./canonical.js";
// MARJIN_COSTH/2 (F1 R1): the node carries a per-version AUTHORIZATION REVIEW map written in the SAME
// transaction as the version. A version whose review is unresolved (pending / flagged) makes the whole
// history non-authoritative (unreadable), so a DEC-AUTH-1 in-window commit can never silently become
// ordinary history when its post-commit audit fails. A /1 reader sees a /2 node as malformed (fail closed).
// MARJIN_COSTH/6 (Core/F1 R4) — the CANONICAL review lifecycle. Stored states are EXACTLY
//   pending · cleared · flagged · rejected
// (no fifth state). The owner's acceptance of a flagged version stores `cleared` with a bound decision audit
// `accepted`; the owner's rejection stores `rejected` with a decision audit `rejected`. Only `cleared` is
// authoritative. `pending` / `flagged` withhold the whole history; `rejected` is terminal, never
// authoritative, never withholds the history, and a corrected successor may follow it.
// Every review and audit record is strictly BOUND: the review's `intentDigest` is recomputed by the reader
// from the stored version bytes, the tenant and the business (MARJIN_COST_INTENT/2, one canonical digest
// procedure shared by writer, server, browser and page); the flag audit's operation identity is the
// deterministic digest of its own bindings; the decision audit names tenant, business, version, digest,
// string operation id, actor, decision, resulting state, instant and schema. Missing, malformed, stale,
// conflicting or wrongly bound evidence is unreadable. The reader REQUIRES a tenant / business binding:
// there is no unbound authoritative decode. A /5 (R3) node — the R3 fifth review state, MARJIN_COSTR/3 — is
// unreadable by this reader; a client never converts it (CONTRACT.md documents the only trusted operator path).
export const COST_HISTORY_CAPABILITY = "MARJIN_COSTH/6";
export const COST_REVIEW_STATES = Object.freeze(["pending", "cleared", "flagged", "rejected"]);
export const COST_REVIEW_DECISIONS = Object.freeze(["accepted", "rejected"]);
//
// PURE and browser-safe: no imports beyond the core, no clock, no I/O. The approved core date functions are
// INJECTED (server: fincore/v1/finance/businessDate.js; browser: window.MarjinFinance.finance.businessDate),
// so server and browser run the same decision logic over the same raw snapshot value.
//
//   decodeHistory(read, bind) → { state:"absent" }                               successful read, node absent
//                             | { state:"present", head, versions, activationDate } fully valid history
//                             | { state:"unreadable", reason, detail? }          failed/denied read OR any defect
// There is no partial result: one invalid record, a broken chain, a semantic-invariant violation, a malformed
// envelope or an unbound / wrongly bound review makes the WHOLE history unreadable (withhold cost-dependent
// outputs). A failed or denied read is never "absent". A missing binding is never "absent" either.
export const HISTORY_KEY_RE = /^biz:[^:]+:cost_history$/; // the ONE storage key (R2)
export const RECORD_SCHEMA = "MARJIN_COSTV/1";
export const ATTESTED_RECORD_SCHEMA = "MARJIN_COSTV/2";
export const REVIEW_SCHEMA = "MARJIN_COSTR/4";
export const FLAG_AUDIT_SCHEMA = "MARJIN_COST_AUDIT/3";
export const DECISION_AUDIT_SCHEMA = "MARJIN_COST_DECISION/1";
export const INTENT_SCHEMA = "MARJIN_COST_INTENT/2";
export const REVIEW_RESOLUTIONS = Object.freeze({
    cleared: ["post_commit_authorized", "reconciled_authorized"],
    flagged: ["revoked_during_commit", "reconciled_unauthorized"],
});
const DIGEST = /^[0-9a-f]{64}$/;
export const UUID4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const DEC = /^(0|[1-9][0-9]*)(\.[0-9]*[1-9])?$/;
const MAX_INSTANT_MS = 8640000000000000; // ECMAScript Date range
const isObj = (x) => x !== null && typeof x === "object" && !Array.isArray(x);
const only = (o, allowed) => Object.keys(o).every((k) => allowed.includes(k));
const exactly = (o, fields) => Object.keys(o).length === fields.length && only(o, fields) && fields.every((f) => o[f] !== undefined);
const nonEmptyString = (x) => typeof x === "string" && x !== "";
const RECORD_FIELDS = ["versionId", "schema", "effectiveFrom", "recordedAt", "recordedBy", "basis", "globalEmployeesCount", "fixedItemsCount", "globalEmployees", "fixedItems", "rent", "royalty", "note", "predecessorVersionId", "attestationReason", "attestationDigest", "attestedBy", "attestedAt"];
const FLAG_AUDIT_FIELDS = ["schema", "operationId", "tenantId", "bizId", "versionId", "intentDigest", "recordedBy", "recordedAt", "outcome", "resultingState", "detectedAt"];
const DECISION_AUDIT_FIELDS = ["schema", "operationId", "tenantId", "bizId", "versionId", "intentDigest", "decidedBy", "decision", "resultingState", "decidedAt"];
// ── the canonical integrity values (shared by writer and every reader) ─────────────────────────────
/**
 * The version intent: every stored field of the wire record EXCEPT the server timestamp `recordedAt`, bound
 * to the tenant and the business. Its digest is the review's `intentDigest`; a review of one version or one
 * business can never validate another.
 */
export function versionIntent(tenantId, bizId, wire) {
    const version = {};
    for (const k of Object.keys(wire))
        if (k !== "recordedAt")
            version[k] = wire[k];
    return { schema: INTENT_SCHEMA, tenantId, bizId, version };
}
export const intentDigestOf = (tenantId, bizId, wire) => canonicalDigest(versionIntent(tenantId, bizId, wire));
/** The deterministic operation identity of a flag audit: a function of exactly its bindings. */
export const flagOperationIdOf = (a) => canonicalDigest({ schema: FLAG_AUDIT_SCHEMA, tenantId: a.tenantId, bizId: a.bizId, versionId: a.versionId, intentDigest: a.intentDigest, outcome: a.outcome });
/** canonicalJson re-exported for callers that need the exact text (the writer's readback comparisons). */
export const canonicalText = canonicalJson;
/**
 * @param core {{ israelBusinessDate(ms:number):string, parseBusinessDate(d:string):object|null }}
 */
export function createHistoryCodec(core) {
    if (!core || typeof core.israelBusinessDate !== "function" || typeof core.parseBusinessDate !== "function")
        throw new Error("core date functions required");
    const nonNegInt = (x) => typeof x === "number" && Number.isSafeInteger(x) && x >= 0;
    const validDate = (s) => typeof s === "string" && core.parseBusinessDate(s) !== null;
    const validInstant = (x) => typeof x === "number" && Number.isSafeInteger(x) && x >= 1 && x <= MAX_INSTANT_MS;
    function decodeList(raw, count, keyField, amountField, label) {
        if (!nonNegInt(count))
            return { error: label + "_count_invalid" };
        if (count === 0)
            return raw === undefined ? { items: [] } : { error: label + "_present_with_zero_count" };
        if (raw === undefined)
            return { error: label + "_missing" };
        if (!Array.isArray(raw))
            return { error: label + "_not_dense_list" };
        if (raw.length !== count)
            return { error: label + "_count_mismatch" };
        const items = [], seen = new Set();
        for (let i = 0; i < raw.length; i++) {
            const it = raw[i];
            if (!isObj(it))
                return { error: label + "_hole_or_bad_item" };
            if (!only(it, [keyField, "name", amountField]))
                return { error: label + "_item_extra_field" };
            if (typeof it[keyField] !== "string" || it[keyField] === "")
                return { error: label + "_item_key_invalid" };
            if (seen.has(it[keyField]))
                return { error: label + "_duplicate_key" };
            seen.add(it[keyField]);
            if (it.name !== undefined && typeof it.name !== "string")
                return { error: label + "_item_name_invalid" };
            if (typeof it[amountField] !== "string" || !DEC.test(it[amountField]))
                return { error: label + "_item_amount_invalid" };
            items.push(it.name === undefined ? { [keyField]: it[keyField], [amountField]: it[amountField] } : { [keyField]: it[keyField], name: it.name, [amountField]: it[amountField] });
        }
        return { items };
    }
    /** One stored record (wire) → logical record, or { error }. Includes the R2 semantic invariants. */
    function decodeRecord(key, r) {
        if (!isObj(r))
            return { error: "record_not_object" };
        if (!only(r, RECORD_FIELDS))
            return { error: "extra_field" };
        if (!UUID4.test(key) || r.versionId !== key)
            return { error: "version_id_mismatch" };
        if (r.schema !== RECORD_SCHEMA && r.schema !== ATTESTED_RECORD_SCHEMA)
            return { error: "schema_invalid" };
        if (!validDate(r.effectiveFrom))
            return { error: "effective_from_invalid" };
        if (!validInstant(r.recordedAt))
            return { error: "recorded_at_invalid" };
        if (typeof r.recordedBy !== "string" || r.recordedBy === "")
            return { error: "recorded_by_invalid" };
        if (r.basis !== "recorded" && r.basis !== "attested_retroactive")
            return { error: "basis_invalid" };
        if (r.basis === "recorded" && r.schema !== RECORD_SCHEMA)
            return { error: "recorded_schema_invalid" };
        if (r.basis === "attested_retroactive") {
            if (r.schema !== ATTESTED_RECORD_SCHEMA || typeof r.attestationReason !== "string" || !r.attestationReason.trim() || r.attestationReason.length > 500 ||
                typeof r.attestationDigest !== "string" || !DIGEST.test(r.attestationDigest) || r.attestedBy !== r.recordedBy || r.attestedAt !== r.recordedAt)
                return { error: "attestation_record_invalid" };
        }
        else if (r.attestationReason !== undefined || r.attestationDigest !== undefined || r.attestedBy !== undefined || r.attestedAt !== undefined)
            return { error: "attestation_on_recorded" };
        if (r.predecessorVersionId === undefined)
            return { error: "predecessor_missing" };
        if (r.predecessorVersionId !== "none" && (!UUID4.test(r.predecessorVersionId) || r.predecessorVersionId === key))
            return { error: "predecessor_invalid" };
        // R2 C3: the authoritative server timestamp fixes the record's business date; FOD-4 basis rule.
        const recordedDate = core.israelBusinessDate(r.recordedAt);
        if (r.basis === "recorded" && r.effectiveFrom < recordedDate)
            return { error: "recorded_backdated" };
        if (r.basis === "attested_retroactive" && r.effectiveFrom >= recordedDate)
            return { error: "attested_not_past" };
        const ge = decodeList(r.globalEmployees, r.globalEmployeesCount, "employeeKey", "monthlyEmployerCost", "global_employees");
        if (ge.error)
            return ge;
        const fi = decodeList(r.fixedItems, r.fixedItemsCount, "itemKey", "monthlyAmount", "fixed_items");
        if (fi.error)
            return fi;
        const rent = r.rent, roy = r.royalty;
        if (!isObj(rent) || !only(rent, ["mode", "monthlyAmount", "ratePct"]))
            return { error: "rent_invalid" };
        if (rent.mode === "none" ? (rent.monthlyAmount !== undefined || rent.ratePct !== undefined)
            : rent.mode === "fixed" ? !(DEC.test(rent.monthlyAmount ?? "") && rent.ratePct === undefined)
                : rent.mode === "pct" ? !(DEC.test(rent.ratePct ?? "") && rent.monthlyAmount === undefined) : true)
            return { error: "rent_invalid" };
        if (!isObj(roy) || !only(roy, ["mode", "ratePct"]))
            return { error: "royalty_invalid" };
        if (roy.mode === "none" ? roy.ratePct !== undefined : roy.mode === "pct" ? !DEC.test(roy.ratePct ?? "") : true)
            return { error: "royalty_invalid" };
        if (r.note !== undefined && (typeof r.note !== "string" || r.note.length > 200))
            return { error: "note_invalid" };
        const out = { versionId: key, effectiveFrom: r.effectiveFrom, recordedAt: r.recordedAt, recordedBy: r.recordedBy, basis: r.basis,
            predecessorVersionId: r.predecessorVersionId, globalEmployees: ge.items, fixedItems: fi.items, rent: { ...rent }, royalty: { ...roy } };
        if (r.note !== undefined)
            out.note = r.note;
        if (r.basis === "attested_retroactive") {
            out.attestationReason = r.attestationReason;
            out.attestationDigest = r.attestationDigest;
            out.attestedBy = r.attestedBy;
            out.attestedAt = r.attestedAt;
        }
        return { record: out };
    }
    function validHead(h) {
        return isObj(h) && Object.keys(h).length === 2 && only(h, ["revision", "headVersionId"]) &&
            Number.isSafeInteger(h.revision) && h.revision >= 1 && typeof h.headVersionId === "string" && UUID4.test(h.headVersionId);
    }
    /** The flag audit of a flagged / accepted / rejected entry: exact fields, exact bindings, recomputed identity. */
    function flagAuditError(a, key, e, v, bind) {
        if (!isObj(a) || !exactly(a, FLAG_AUDIT_FIELDS))
            return "flag_audit_invalid";
        if (a.schema !== FLAG_AUDIT_SCHEMA)
            return "flag_audit_schema_invalid";
        if (!nonEmptyString(a.tenantId) || !nonEmptyString(a.bizId))
            return "flag_audit_invalid";
        if (a.tenantId !== bind.tenantId || a.bizId !== bind.bizId)
            return "flag_audit_binding_mismatch";
        if (a.versionId !== key || a.intentDigest !== e.intentDigest || a.recordedBy !== v.recordedBy || a.recordedAt !== v.recordedAt)
            return "flag_audit_invalid";
        if (a.outcome !== e.resolution || a.resultingState !== "flagged")
            return "flag_audit_invalid";
        if (!validInstant(a.detectedAt) || a.detectedAt < v.recordedAt || a.detectedAt !== e.resolvedAt)
            return "flag_audit_invalid";
        if (typeof a.operationId !== "string" || !DIGEST.test(a.operationId))
            return "flag_audit_operation_invalid";
        if (a.operationId !== flagOperationIdOf({ tenantId: a.tenantId, bizId: a.bizId, versionId: key, intentDigest: e.intentDigest, outcome: a.outcome }))
            return "flag_audit_operation_mismatch";
        return null;
    }
    /** The owner's decision audit of an accepted (cleared) / rejected entry: exact fields and bindings. */
    function decisionAuditError(a, key, e, bind) {
        if (!isObj(a) || !exactly(a, DECISION_AUDIT_FIELDS))
            return "decision_audit_invalid";
        if (a.schema !== DECISION_AUDIT_SCHEMA)
            return "decision_audit_schema_invalid";
        if (!nonEmptyString(a.tenantId) || !nonEmptyString(a.bizId))
            return "decision_audit_invalid";
        if (a.tenantId !== bind.tenantId || a.bizId !== bind.bizId)
            return "decision_audit_binding_mismatch";
        if (a.versionId !== key || a.intentDigest !== e.intentDigest)
            return "decision_audit_invalid";
        if (typeof a.operationId !== "string" || !UUID4.test(a.operationId))
            return "decision_audit_operation_invalid";
        if (!nonEmptyString(a.decidedBy))
            return "decision_audit_actor_invalid";
        if (a.decision !== e.decision || !COST_REVIEW_DECISIONS.includes(a.decision))
            return "decision_audit_decision_mismatch";
        if (a.resultingState !== e.state || (a.decision === "accepted" ? e.state !== "cleared" : e.state !== "rejected"))
            return "decision_audit_state_mismatch";
        if (!validInstant(a.decidedAt) || a.decidedAt < e.resolvedAt)
            return "decision_audit_instant_invalid";
        return null;
    }
    /**
     * One review entry, bound to its version AND to the tenant / business: the actor and commit instant must be
     * the version's own recordedBy / recordedAt, and the stored `intentDigest` must equal the digest RECOMPUTED
     * from the stored version bytes (a review cannot be re-pointed at another version, payload or business).
     */
    function decodeReview(key, e, rawVersion, v, bind) {
        if (!isObj(e))
            return { error: "review_not_object" };
        if (e.schema !== REVIEW_SCHEMA)
            return { error: "review_schema_invalid" };
        if (typeof e.intentDigest !== "string" || !DIGEST.test(e.intentDigest))
            return { error: "review_digest_invalid" };
        if (!isObj(rawVersion) || e.intentDigest !== intentDigestOf(bind.tenantId, bind.bizId, rawVersion))
            return { error: "review_digest_mismatch" };
        if (e.actor !== v.recordedBy || e.committedAt !== v.recordedAt)
            return { error: "review_binding_mismatch" };
        if (!COST_REVIEW_STATES.includes(e.state))
            return { error: "review_state_invalid" };
        const base = ["schema", "state", "intentDigest", "actor", "committedAt"];
        if (e.state === "pending")
            return exactly(e, base) ? { review: { state: "pending", intentDigest: e.intentDigest, resolution: null, decision: null } } : { error: "review_extra_field" };
        const resolved = [...base, "resolvedAt", "resolution"];
        // an owner's decision: `cleared` carrying `decision: accepted` (the flag evidence retained) or `rejected`
        const decided = e.state === "rejected" || (e.state === "cleared" && e.decision !== undefined);
        const fields = decided ? [...resolved, "flagAudit", "decision", "decisionAudit"] : e.state === "flagged" ? [...resolved, "flagAudit"] : resolved;
        if (!exactly(e, fields))
            return { error: "review_fields_invalid" };
        if (!validInstant(e.resolvedAt) || e.resolvedAt < e.committedAt)
            return { error: "review_resolved_at_invalid" };
        const family = e.state === "cleared" && !decided ? REVIEW_RESOLUTIONS.cleared : REVIEW_RESOLUTIONS.flagged;
        if (!family.includes(e.resolution))
            return { error: "review_resolution_invalid" };
        if (e.state === "flagged" || decided) {
            const fa = flagAuditError(e.flagAudit, key, e, v, bind);
            if (fa)
                return { error: fa };
        }
        if (decided) {
            if (e.decision !== (e.state === "cleared" ? "accepted" : "rejected"))
                return { error: "review_decision_invalid" };
            const da = decisionAuditError(e.decisionAudit, key, e, bind);
            if (da)
                return { error: da };
        }
        return { review: { state: e.state, intentDigest: e.intentDigest, resolution: e.resolution, decision: decided ? e.decision : null } };
    }
    /**
     * read = { exists, value } from ONE snapshot of the node, or { failed: error }. Authoritative decision.
     * `bind` is REQUIRED: the expected tenant / business; a record naming another one is unreadable, and no
     * decode happens without a verified binding. `versions` holds ONLY the effective (non-rejected) versions,
     * oldest → newest; `rejected` lists the rejected version ids. A history whose every version is rejected is
     * present with no effective version (no activation date): cost outputs stay withheld until an owner
     * activates again.
     */
    function decodeHistory(read, bind) {
        const h = decodeHistoryStructure(read, bind);
        if (h.state !== "present")
            return h;
        // F1 R1: an unresolved authorization review (DEC-AUTH-1 window) withholds the WHOLE history.
        if (h.unresolved.pending.length)
            return { state: "unreadable", reason: "authorization_review_pending", detail: h.unresolved.pending };
        if (h.unresolved.flagged.length)
            return { state: "unreadable", reason: "authorization_review_flagged", detail: h.unresolved.flagged };
        return { state: "present", head: h.head, versions: h.effectiveVersions, activationDate: h.activationDate, rejected: h.rejected };
    }
    /**
     * Structural decision only (TRUSTED WRITERS / REVIEW RESOLUTION): the same strict validation, but an
     * unresolved review is reported in `unresolved` instead of withholding the history. Never used to
     * compute financial outputs. The binding is required here too.
     */
    function decodeHistoryStructure(read, bind) {
        if (bind === undefined || bind === null)
            return { state: "unreadable", reason: "binding_required" };
        if (!isObj(bind) || typeof bind.tenantId !== "string" || bind.tenantId === "" || typeof bind.bizId !== "string" || bind.bizId === "")
            return { state: "unreadable", reason: "binding_invalid" };
        if (!read || read.failed !== undefined) {
            return { state: "unreadable", reason: "read_failed", detail: String((read && read.failed && typeof read.failed === "object" && "message" in read.failed && read.failed.message) || (read && read.failed) || "no_read") };
        }
        const raw = read.value;
        if (!read.exists || raw === null || raw === undefined)
            return { state: "absent" };
        if (!isObj(raw) || Object.keys(raw).length !== 3 || !only(raw, ["head", "versions", "review"]))
            return { state: "unreadable", reason: "envelope_shape" };
        if (!validHead(raw.head))
            return { state: "unreadable", reason: "head_shape" };
        const vs = raw.versions;
        if (!isObj(vs) || Object.keys(vs).length === 0)
            return { state: "unreadable", reason: "versions_shape" };
        const byId = {};
        for (const key of Object.keys(vs)) {
            if (!UUID4.test(key))
                return { state: "unreadable", reason: "version_key_invalid", detail: key };
            const d = decodeRecord(key, vs[key]);
            if (d.error) {
                return { state: "unreadable", reason: "record_invalid", detail: { versionId: key, error: d.error } };
            }
            byId[key] = d.record;
        }
        // chain: head → predecessor … → "none"; visits every version once; length = revision; strictly monotone recordedAt
        const chain = [], seen = new Set();
        let id = raw.head.headVersionId;
        if (!byId[id])
            return { state: "unreadable", reason: "head_missing_version" };
        while (id !== "none") {
            const v = byId[id];
            if (!v)
                return { state: "unreadable", reason: "chain_dangling", detail: id };
            if (seen.has(id))
                return { state: "unreadable", reason: "chain_cycle", detail: id };
            seen.add(id);
            chain.push(v);
            id = v.predecessorVersionId;
        }
        if (seen.size !== Object.keys(byId).length)
            return { state: "unreadable", reason: "chain_disconnected" };
        if (chain.length !== raw.head.revision)
            return { state: "unreadable", reason: "head_revision_mismatch" };
        chain.reverse(); // oldest → newest
        for (let i = 1; i < chain.length; i++)
            if (!(chain[i].recordedAt > chain[i - 1].recordedAt))
                return { state: "unreadable", reason: "chain_not_monotonic", detail: chain[i].versionId };
        // review map: exactly one valid entry per version (keys equal), bound to that version, this tenant and business
        const rv = raw.review;
        if (!isObj(rv) || Object.keys(rv).length !== chain.length || !Object.keys(rv).every((k) => byId[k] !== undefined))
            return { state: "unreadable", reason: "review_shape" };
        const review = {}, pending = [], flagged = [], rejected = [];
        for (const v of chain) {
            const r = decodeReview(v.versionId, rv[v.versionId], vs[v.versionId], v, bind);
            if (r.error)
                return { state: "unreadable", reason: "review_invalid", detail: { versionId: v.versionId, error: r.error } };
            review[v.versionId] = r.review;
            if (r.review.state === "pending")
                pending.push(v.versionId);
            if (r.review.state === "flagged")
                flagged.push(v.versionId);
            if (r.review.state === "rejected")
                rejected.push(v.versionId);
        }
        // a rejected version is structurally part of the chain but never part of the effective timeline
        const effectiveVersions = chain.filter((v) => review[v.versionId].state !== "rejected");
        return { state: "present", head: { revision: raw.head.revision, headVersionId: raw.head.headVersionId }, versions: chain, effectiveVersions, rejected, activationDate: activationDate(effectiveVersions), review, unresolved: { pending, flagged } };
    }
    return { decodeRecord, decodeHistory, decodeHistoryStructure, decodeReview, validHead };
}
/** First RECORDED effective version's effectiveFrom (attested versions never move activation; rejected versions never count). */
export function activationDate(versions) {
    const rec = versions.filter((v) => v.basis === "recorded").map((v) => v.effectiveFrom).sort();
    return rec.length ? rec[0] : null;
}
/**
 * Approved same-effective-date rule (F1 §3): greatest (recordedAt, versionId) wins. Under R2's strictly
 * monotone chain this is always the newest version in chain order; the versionId tie-break is retained
 * for determinism but is unreachable for any history the codec accepts.
 */
export function winnersByEffectiveDate(versions) {
    const out = {};
    for (const v of versions) {
        const w = out[v.effectiveFrom];
        if (!w || v.recordedAt > w.recordedAt || (v.recordedAt === w.recordedAt && v.versionId > w.versionId))
            out[v.effectiveFrom] = v;
    }
    return out;
}
/**
 * F1 timeline-source mapping. Unreadable history NEVER falls back to current settings.
 *   absent     → labelled compat_current_config (FOD-1; existing "לפי הגדרות נוכחיות" basis label)
 *   present    → recorded history (FOD-6: preActivation "none")
 *   unreadable → unavailable (cost-dependent outputs withheld, typed issue carried)
 */
export function timelineSourceFor(decoded) {
    if (decoded && decoded.state === "absent")
        return { source: "compat_current_config", basis: "current_applied_retrospectively" };
    if (decoded && decoded.state === "present")
        return { source: "cost_history", preActivation: "none", activationDate: decoded.activationDate };
    return { source: "unavailable", issue: "cost_history_unreadable", reason: decoded && decoded.reason };
}
export const costHistoryCodec = createHistoryCodec({ israelBusinessDate, parseBusinessDate });
