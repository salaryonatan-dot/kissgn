// MARJIN_COSTH/1 — strict, pure F1 history reader, ported from the reviewed R2 experiment.
import { israelBusinessDate, parseBusinessDate } from "./businessDate.js";
export const COST_HISTORY_CAPABILITY = "MARJIN_COSTH/1";
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
export const HISTORY_KEY_RE = /^biz:[^:]+:cost_history$/; // the ONE storage key (R2)
export const RECORD_SCHEMA = "MARJIN_COSTV/1";
export const UUID4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const DEC = /^(0|[1-9][0-9]*)(\.[0-9]*[1-9])?$/;
const MAX_INSTANT_MS = 8640000000000000; // ECMAScript Date range
const isObj = (x) => x !== null && typeof x === "object" && !Array.isArray(x);
const only = (o, allowed) => Object.keys(o).every((k) => allowed.includes(k));
const RECORD_FIELDS = ["versionId", "schema", "effectiveFrom", "recordedAt", "recordedBy", "basis", "globalEmployeesCount", "fixedItemsCount", "globalEmployees", "fixedItems", "rent", "royalty", "note", "predecessorVersionId"];
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
        if (r.schema !== RECORD_SCHEMA)
            return { error: "schema_invalid" };
        if (!validDate(r.effectiveFrom))
            return { error: "effective_from_invalid" };
        if (!validInstant(r.recordedAt))
            return { error: "recorded_at_invalid" };
        if (typeof r.recordedBy !== "string" || r.recordedBy === "")
            return { error: "recorded_by_invalid" };
        if (r.basis !== "recorded" && r.basis !== "attested_retroactive")
            return { error: "basis_invalid" };
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
        return { record: out };
    }
    function validHead(h) {
        return isObj(h) && Object.keys(h).length === 2 && only(h, ["revision", "headVersionId"]) &&
            Number.isSafeInteger(h.revision) && h.revision >= 1 && typeof h.headVersionId === "string" && UUID4.test(h.headVersionId);
    }
    /** read = { exists, value } from ONE snapshot of the node, or { failed: error }. */
    function decodeHistory(read) {
        if (!read || read.failed !== undefined) {
            return { state: "unreadable", reason: "read_failed", detail: String((read && read.failed && typeof read.failed === "object" && "message" in read.failed && read.failed.message) || (read && read.failed) || "no_read") };
        }
        const raw = read.value;
        if (!read.exists || raw === null || raw === undefined)
            return { state: "absent" };
        if (!isObj(raw) || Object.keys(raw).length !== 2 || !only(raw, ["head", "versions"]))
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
        return { state: "present", head: { revision: raw.head.revision, headVersionId: raw.head.headVersionId }, versions: chain, activationDate: activationDate(chain) };
    }
    return { decodeRecord, decodeHistory, validHead };
}
/** First RECORDED version's effectiveFrom (attested versions never move activation). Unchanged from F1. */
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
