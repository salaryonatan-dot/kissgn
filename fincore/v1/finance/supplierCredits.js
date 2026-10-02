import { decAdd, decFromPlainString, decIsNegative, decIsZero, decSub, serializeDec } from "./decimal.js";
import { isBusinessDate } from "./businessDate.js";
import { sortFlags } from "./normalize.js";
export const SUPPLIER_CREDITS_CONTRACT_VERSION = "MARJIN_CREDITS/1";
export const SUPPLIER_CREDITS_SCHEMA_VERSION = 1;
/** Same identity grammar as entry rows (UUID v4, lower-case). */
export const CREDIT_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
/** Positive, at most 9 integer digits and 2 fraction digits, no sign, no grouping, no exponent. */
const AMOUNT_RE = /^(?:0|[1-9][0-9]{0,8})(?:\.[0-9]{1,2})?$/;
const SUPPLIER_ID_FORBIDDEN = /[.#$\[\]\/:]/;
export const MAX_SUPPLIER_ID_LENGTH = 128;
export const SUPPLIER_SOURCE_PREFIX = "supplier:";
function isPlainObject(v) {
    return typeof v === "object" && v !== null && !Array.isArray(v);
}
/** Canonical credit amount ("300.50" → "300.5"), or null when the text is not a valid positive amount. */
export function canonicalCreditAmount(raw) {
    if (typeof raw !== "string" || !AMOUNT_RE.test(raw))
        return null;
    const d = decFromPlainString(raw);
    if (decIsZero(d) || decIsNegative(d))
        return null;
    return serializeDec(d);
}
export function isValidSupplierId(v) {
    return typeof v === "string" && v.length > 0 && v.length <= MAX_SUPPLIER_ID_LENGTH && v.trim() === v && !SUPPLIER_ID_FORBIDDEN.test(v);
}
const isRevision = (v) => typeof v === "number" && Number.isSafeInteger(v) && v >= 1;
const isLink = (v) => v === undefined || v === null || (typeof v === "string" && CREDIT_ID_RE.test(v));
function decodeRecord(key, r) {
    if (!isPlainObject(r))
        return { key, code: "invalid_record", issueDate: null };
    const issueDate = isBusinessDate(r.issueDate) ? r.issueDate : null;
    if (!CREDIT_ID_RE.test(key) || r.creditId !== key)
        return { key, code: "id_mismatch", issueDate };
    if (issueDate === null)
        return { key, code: "invalid_issue_date", issueDate: null };
    if (!isValidSupplierId(r.supplierId))
        return { key, code: "invalid_supplier", issueDate };
    const amount = canonicalCreditAmount(r.amount);
    // the stored amount must already be canonical (the writer canonicalizes): "300.50" is not a stored form
    if (amount === null || amount !== r.amount)
        return { key, code: "invalid_amount", issueDate };
    if (r.status !== "active" && r.status !== "voided")
        return { key, code: "invalid_status", issueDate };
    if (!isRevision(r.revision))
        return { key, code: "invalid_revision", issueDate };
    if (!isLink(r.replacesCreditId) || !isLink(r.replacedByCreditId))
        return { key, code: "invalid_link", issueDate };
    if (r.status === "active" && r.replacedByCreditId)
        return { key, code: "invalid_link", issueDate };
    const doc = typeof r.documentNumber === "string" && r.documentNumber !== "" ? r.documentNumber : null;
    const note = typeof r.note === "string" && r.note !== "" ? r.note : null;
    return {
        creditId: key, supplierId: r.supplierId, issueDate, amount, status: r.status, documentNumber: doc, note, revision: r.revision,
        replacesCreditId: r.replacesCreditId || null, replacedByCreditId: r.replacedByCreditId || null,
    };
}
/**
 * Strict decoding of the stored node. null/undefined/{} ⇒ absent (zero credits, complete). A node
 * that is not `{schemaVersion:1, revision:int≥1, records?:object}` ⇒ unreadable. Every record is
 * validated on its own; invalid records are returned as issues (never silently dropped and never
 * counted). Records are returned sorted by creditId.
 */
export function decodeSupplierCredits(raw) {
    if (raw === null || raw === undefined)
        return { state: "absent" };
    if (!isPlainObject(raw))
        return { state: "unreadable", reason: "node_shape" };
    // an object without any key is no node (RTDB never stores one; same rule as decodeEnvelope)
    if (Object.keys(raw).length === 0)
        return { state: "absent" };
    if (raw.schemaVersion !== SUPPLIER_CREDITS_SCHEMA_VERSION)
        return { state: "unreadable", reason: "schema_version" };
    if (!isRevision(raw.revision))
        return { state: "unreadable", reason: "revision" };
    const recs = raw.records;
    if (recs !== undefined && recs !== null && !isPlainObject(recs))
        return { state: "unreadable", reason: "records_shape" };
    const records = [];
    const issues = [];
    for (const key of Object.keys(recs || {}).sort()) {
        const d = decodeRecord(key, recs[key]);
        if ("code" in d)
            issues.push(d);
        else
            records.push(d);
    }
    // A replacement link must point at an existing record of the node (both directions).
    const byId = new Map(records.map((r) => [r.creditId, r]));
    const linked = [];
    for (const r of records) {
        const broken = (r.replacesCreditId !== null && !byId.has(r.replacesCreditId)) || (r.replacedByCreditId !== null && !byId.has(r.replacedByCreditId));
        if (broken)
            issues.push({ key: r.creditId, code: "invalid_link", issueDate: r.issueDate });
        else
            linked.push(r);
    }
    return { state: "present", revision: raw.revision, records: linked, issues };
}
const ABSENT_CREDITS = Object.freeze({ presence: "absent", partial: false, value: null, bySupplier: Object.freeze({}), count: 0, reason: null });
/**
 * Per-date credit facts for the given dates (active credits only, keyed by ISSUE date).
 * unreadable / not_loaded / an undated invalid record ⇒ every date is INVALID (never zero).
 * A dated invalid record ⇒ its date is partial (presence invalid when no valid credit is there).
 */
export function creditsByDate(state, dates) {
    const out = new Map();
    const st = state || { state: "absent" };
    if (st.state === "absent") {
        for (const d of dates)
            out.set(d, ABSENT_CREDITS);
        return out;
    }
    const allInvalid = st.state !== "present" || st.issues.some((i) => i.issueDate === null);
    const reasonAll = st.state === "unreadable" ? "supplier_credits_unreadable" : st.state === "not_loaded" ? "supplier_credits_not_loaded" : "invalid_supplier_credit";
    const wanted = new Set(dates);
    const sums = new Map();
    const invalidDates = new Set();
    if (st.state === "present") {
        for (const r of st.records) {
            if (r.status !== "active" || !wanted.has(r.issueDate))
                continue;
            const v = decFromPlainString(r.amount);
            const s = sums.get(r.issueDate) || { value: decFromPlainString("0"), by: new Map(), count: 0 };
            s.value = decAdd(s.value, v);
            const k = SUPPLIER_SOURCE_PREFIX + r.supplierId;
            s.by.set(k, s.by.has(k) ? decAdd(s.by.get(k), v) : v);
            s.count += 1;
            sums.set(r.issueDate, s);
        }
        for (const i of st.issues)
            if (i.issueDate !== null)
                invalidDates.add(i.issueDate);
    }
    for (const d of dates) {
        const s = sums.get(d);
        const invalid = allInvalid || invalidDates.has(d);
        if (!s && !invalid) {
            out.set(d, ABSENT_CREDITS);
            continue;
        }
        const bySupplier = s ? Object.fromEntries([...s.by.keys()].sort().map((k) => [k, serializeDec(s.by.get(k))])) : {};
        out.set(d, {
            presence: s ? "present" : "invalid",
            partial: !!s && invalid,
            value: s ? s.value : null,
            bySupplier,
            count: s ? s.count : 0,
            reason: invalid ? (allInvalid ? reasonAll : "invalid_supplier_credit") : null,
        });
    }
    return out;
}
/**
 * Apply one date's credits to its canonical day (the ONE place gross becomes net).
 *   purchasesGross = the day's purchases as recorded in entries (unchanged);
 *   purchases      = gross − credits when gross is present (bySource per supplier net; a credit
 *                    of a supplier without gross that day is a negative entry); gross absent or
 *                    invalid stays absent/invalid (the credit is still carried in supplierCredits
 *                    and counted by the period report);
 *   an invalid / unreadable credit source marks present purchases partial (never complete).
 */
export function applySupplierCreditsToDay(day, credits) {
    const gross = day.purchases;
    const flags = [...day.flags];
    // no credit issued that date and a readable source: the day is unchanged (no added fields), so a
    // business without credits gives byte-identical days, reports and docs to MARJIN_PRODUCT/2.
    if (credits.presence === "absent" && !credits.partial)
        return day;
    const done = (d) => ({ ...d, flags: sortFlags(d.flags) });
    const creditsIncomplete = credits.presence === "invalid" || credits.partial;
    if (creditsIncomplete)
        flags.push({ code: credits.reason === "supplier_credits_unreadable" || credits.reason === "supplier_credits_not_loaded" ? "supplier_credits_unreadable" : "invalid_supplier_credit", date: day.date, ...(credits.reason ? { reason: credits.reason } : {}) });
    if (gross.presence !== "present" || gross.value === null) {
        return done({ ...day, purchasesGross: gross, supplierCredits: credits, flags });
    }
    let value = gross.value;
    const by = new Map();
    for (const [k, v] of Object.entries(gross.bySource))
        by.set(k, decFromPlainString(v));
    if (credits.presence === "present" && credits.value !== null) {
        value = decSub(value, credits.value);
        for (const [k, v] of Object.entries(credits.bySupplier)) {
            const c = decFromPlainString(v);
            by.set(k, by.has(k) ? decSub(by.get(k), c) : decSub(decFromPlainString("0"), c));
        }
    }
    if (decIsNegative(value))
        flags.push({ code: "negative_net_purchases", date: day.date });
    const bySource = Object.fromEntries([...by.keys()].sort().map((k) => [k, serializeDec(by.get(k))]));
    const purchases = { presence: gross.presence, partial: gross.partial || creditsIncomplete, value, bySource };
    return done({ ...day, purchases, purchasesGross: gross, supplierCredits: credits, flags });
}
