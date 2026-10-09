/**
 * lib/emailDelivery.js — per-message delivery receipts, duplicate-send prevention and provider-outcome classification for
 * the scheduled morning snapshot e-mail (Marjin 1.0 daily e-mail reliability; LOCAL candidate, pending independent review).
 *
 * WHAT A RECEIPT CAN AND CANNOT SAY
 *   The provider is Gmail SMTP through nodemailer (lib/sendEmail.js). SMTP has no idempotency key: once the message data has
 *   been handed to the server, a lost or late answer leaves it UNKNOWN whether the server accepted it. "accepted" below means
 *   only that the SMTP server answered 250 for this recipient — never that the message reached an inbox. Exactly-once is NOT
 *   claimed: the design is AT MOST ONCE per (kind, tenant, business, business date) for automatic sends, and an ambiguous
 *   outcome is recorded as `unknown` and never retried automatically (an owner / operator reconciles it).
 *
 * STORAGE
 *   One node per message: email_delivery/{kind}/{tenantId}/{bizId}/{businessDate} (top level). The Rules deny every client
 *   read and write there (`$other: false`); only the Admin SDK (server) reaches it. No e-mail address and no message body is
 *   stored — only a SHA-256 of the normalized recipient (pseudonymous, not anonymous), the Message-ID WE generated for the
 *   attempt, a bounded classification of what the provider echoed back, and a bounded SMTP status code.
 *
 * UNTRUSTED PROVIDER DATA (R1, review finding D4)
 *   Everything a transport returns or throws — error codes, commands, response codes, accepted / rejected lists, the
 *   Message-ID it reports — is untrusted input: it may be of any type, any size, carry personal data, or throw from a getter.
 *   It is read only through safeRead() and reduced to BOUNDED values before it reaches a decision, a log, a response or a
 *   receipt: providerCode() / providerCommand() map to fixed allow-lists (anything else is "OTHER"), providerResponseCode()
 *   to an integer 200–599 (else null), providerIdEcho() to match | different | absent | invalid. The provider's Message-ID
 *   string itself is never logged, returned or stored.
 *
 * PROVIDER OUTCOME EVIDENCE (R2, review findings E1 / E2) — what each delivery outcome requires
 *   Our own attempt state is the ONLY evidence of the send phase: `ctx.handedToProvider` is set by beforeTransport() right
 *   before lib/sendEmail.js invokes transporter.sendMail, `ctx.claimLost` when our claim transaction refused the hand-off.
 *   Nothing the provider returns or throws can move an attempt back to "not handed over" (an error property such as
 *   `deliveryPhase`, a message text such as "Connection timeout", a syscall or an error code is never phase evidence).
 *     failed (retryable, not handed over)  sendMail was never invoked: our render / claim / configuration step failed first
 *     failed (provider refusal)            sendMail was invoked and the adapter relayed an SMTP NEGATIVE REPLY in the exact
 *                                          nodemailer 6.x shape (lib/smtp-connection _formatError): code + command among
 *                                          EENVELOPE/{MAIL FROM, RCPT TO, DATA}, EMESSAGE/DATA, EAUTH/{AUTH …}, and an
 *                                          integer responseCode 400–599 EQUAL to the leading code of the reply text
 *                                          `response`. 5xx ⇒ final; 4xx ⇒ retryable (a deferral). An SMTP negative reply
 *                                          means the server did not take responsibility for the message (RFC 5321).
 *     failed (recipient rejected)          a resolved result lists the recipient in `rejected` and not in `accepted`
 *     accepted                             a resolved result lists the recipient in `accepted`, not in `rejected`, and its
 *                                          `response` (when present) carries a 2xx reply code
 *     unknown                              everything else once sendMail was invoked: connection loss, timeouts (whatever
 *                                          their text), DNS / socket codes, local adapter errors without a server reply,
 *                                          our deadline, a second hand-off, a reply-shaped error whose fields disagree, a
 *                                          result that lists the recipient nowhere, both ways, or cannot be read
 *   An unknown outcome is terminal for automation: it is never retried in the run, never re-claimed by a later invocation,
 *   and it keeps the run from being reported clean.
 *
 * STATE MACHINE (one RTDB transaction per transition; each transition is bound to the claim id that made the claim)
 *   (absent) ──claim──▶ claimed ──beforeTransport──▶ sending ──provider answered 250──▶ accepted        (terminal)
 *                          │                            ├──definitive refusal / not handed over──▶ failed  (retryable | final)
 *                          │                            └──no answer / connection lost / deadline──▶ unknown (terminal for automation)
 *                          └──failed before the provider (render / receipt write)──▶ failed (retryable)
 *   claim decisions on an existing node:
 *     accepted                       → skip `already_accepted`        (never resent)
 *     unknown                        → skip `unknown_requires_reconciliation`
 *     claimed|sending, lease running → skip `in_progress`              (a concurrent invocation owns it)
 *     claimed, lease expired         → re-claim (the provider was never reached)
 *     sending, lease expired         → becomes `unknown`               (the invocation died while the provider had it)
 *     failed, retryable, attempts < MAX → re-claim (attempt + 1)
 *     failed otherwise               → skip `failed_final`
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, randomUUID } from "node:crypto";
import { isValidId } from "./securityContext.js";
import { isRegistryBizId, decodeRegistryNode, classifyRegistryTarget } from "./businessRegistry.js";

export const RECEIPT_VERSION = "MARJIN_EMAIL_RECEIPT/1";
export const RECEIPT_ROOT = "email_delivery";
export const DAILY_SNAPSHOT_KIND = "daily_snapshot";
export const MAX_AUTOMATIC_ATTEMPTS = 3;            // provider attempts per message, across invocations
export const IN_RUN_ATTEMPTS = 2;                   // attempts within one invocation (only for definitive, transient refusals)
export const CLAIM_LEASE_MS = 10 * 60 * 1000;       // > one bounded send (lib/sendEmail.js SEND_DEADLINE_MS) + render
export const HISTORY_KEEP = 10;

// ── identity rules of the delivery scope (owner decisions of 2026-10-09; delivery-contract resolution) ──────────────────
// The identities a message is addressed and receipted under are the APPROVED shared predicates, applied per slot:
//   tenant   lib/securityContext.js isValidId     — an RTDB key: no `. # $ [ ] /`, 1..128 characters; `:` is PERMITTED
//   business lib/businessRegistry.js isRegistryBizId — isValidId AND no `:` (the per-business keys `biz:{b}:…`)
// plus, in both slots, the characters RTDB itself cannot hold in a key (the Admin SDK refuses them when the Reference is
// created): ASCII control characters U+0000–U+001F and U+007F. They are refused BEFORE any database reference is built,
// so an id carrying one is a deterministic `invalid_delivery_scope`, never an outage-looking `receipt_unavailable`.
// Identity is never trimmed, sanitized, replaced or aliased: an id is accepted exactly as stored or refused.
export const RTDB_CONTROL_CHARS = /[\u0000-\u001f\u007f]/;
/** A tenant id the delivery scope can address (the approved tenant rule + RTDB key safety). */
export function isTenantKey(v) { return isValidId(v) && !RTDB_CONTROL_CHARS.test(v); }
/** A business id the delivery scope can address (the approved business rule + RTDB key safety). */
export function isBusinessKey(v) { return isRegistryBizId(v) && !RTDB_CONTROL_CHARS.test(v); }

const BUSINESS_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** The receipt node path, or null when an identity is not safely addressable. The path FORMAT is unchanged since DE1
 *  (email_delivery/{kind}/{tenantId}/{bizId}/{businessDate}): every identity accepted before keeps its exact node. */
export function receiptPath(kind, tenantId, bizId, businessDate) {
  if (typeof kind !== "string" || !/^[a-z_]{1,40}$/.test(kind)) return null;
  if (!isTenantKey(tenantId)) return null;
  if (!isBusinessKey(bizId)) return null;
  if (typeof businessDate !== "string" || !BUSINESS_DATE.test(businessDate)) return null;
  return `${RECEIPT_ROOT}/${kind}/${tenantId}/${bizId}/${businessDate}`;
}

// ── the delivery target: the ONE registered business a message may be addressed to (G4 / G10) ──────────────────────────
// Before a business-scoped path is built or a message is addressed, the identity is resolved against the tenant's registry
// (tenants/{t}/app/business) with the approved shared classification (lib/businessRegistry.js classifyRegistryTarget).
// Every state carries a bounded code; the caller decides the HTTP mapping. A registered business whose record has no usable
// name is `name_unavailable` (owner decision G4): preserved, never given a placeholder name, never e-mailed until repaired.
// A business whose name IS the string "Unknown" (or any non-blank string) is a named business.
const isRecord = (e) => e !== null && typeof e === "object" && !Array.isArray(e);
const usableName = (name) => (typeof name === "string" && name.trim() !== "" ? name : null);

/** Pure resolution of (tenantId, bizId) against a raw registry node value. */
export function resolveDeliveryTarget(raw, tenantId, bizId) {
  if (!isTenantKey(tenantId) || !isBusinessKey(bizId)) return { state: "invalid_identity", code: "invalid_business_identity" };
  const c = classifyRegistryTarget(raw, bizId);
  if (c.state === "invalid_request") return { state: "invalid_identity", code: "invalid_business_identity" };
  if (c.state === "unreadable") return { state: "unreadable", code: "registry_unreadable", reason: c.reason };
  if (c.state === "ambiguous") return { state: "ambiguous", code: "ambiguous_business_identity", reason: c.reason };
  if (c.state !== "registered") return { state: "not_registered", code: "business_not_registered" };
  // the ONE canonical record (M1 R2 resolveRegistryTarget semantics): never a first match among duplicates
  const records = decodeRegistryNode(raw).list.filter((e) => isRecord(e) && e.id === bizId);
  if (records.length !== 1) return { state: "ambiguous", code: "ambiguous_business_identity", reason: "duplicate_target" };
  const name = usableName(records[0].name);
  if (name === null) return { state: "name_unavailable", code: "business_name_unavailable" };
  return { state: "deliverable", code: null, name };
}

/** Read the registry through `db` and resolve. `cache` (a Map keyed by tenantId) lets one run read each registry once. */
export async function readDeliveryTarget(db, tenantId, bizId, { cache } = {}) {
  if (!isTenantKey(tenantId) || !isBusinessKey(bizId)) return { state: "invalid_identity", code: "invalid_business_identity" };
  let entry = cache && cache.get(tenantId);
  if (!entry) {
    try { entry = { raw: (await db.ref(`tenants/${tenantId}/app/business`).once("value")).val() }; }
    catch { entry = { failed: true }; }     // the error is untrusted: a fixed code only, nothing of it is kept
    if (cache) cache.set(tenantId, entry);
  }
  if (entry.failed) return { state: "unavailable", code: "registry_unavailable" };
  return resolveDeliveryTarget(entry.raw, tenantId, bizId);
}

// ── the owner notice for a business whose Daily cannot be prepared (G4) ──────────────────────────────────────────────────
// One node per business at email_delivery/daily_snapshot_notices/{tenantId}/{bizId} (top level: `$other` denies every
// client; only the server reads and writes it). It carries no financial data and no address: the bounded code, the fixed
// Hebrew message, the identity, the business date last affected and the run count. It is written only when a scheduled
// run refuses the business for a missing name, read only through the owner-authorized route, and removed when the name is
// present again. It never changes business data: repair is the owner's (business settings) or the admin's (update-client).
export const DELIVERY_NOTICE_ROOT = "email_delivery/daily_snapshot_notices";
export const MISSING_NAME_NOTICE_HE = "לא ניתן להכין את הסיכום היומי כי חסר שם העסק. נדרש תיקון פרטי העסק.";
/** The notice node path, or null when an identity is not safely addressable. */
export function deliveryNoticePath(tenantId, bizId) {
  if (!isTenantKey(tenantId) || !isBusinessKey(bizId)) return null;
  return `${DELIVERY_NOTICE_ROOT}/${tenantId}/${bizId}`;
}
/** Record (or refresh) the missing-name notice. Never throws: returns "recorded" | "not_recorded". */
export async function recordMissingNameNotice(db, { tenantId, bizId, businessDate, nowMs = Date.now() }) {
  const path = deliveryNoticePath(tenantId, bizId);
  if (path === null) return "not_recorded";
  try {
    const r = await db.ref(path).transaction((cur) => {
      const prev = isRecord(cur) && cur.code === "business_name_unavailable" ? cur : null;
      return { code: "business_name_unavailable", message: MISSING_NAME_NOTICE_HE, tenantId, bizId,
        businessDate: typeof businessDate === "string" ? businessDate : null,
        firstSeenAt: prev && Number.isFinite(prev.firstSeenAt) ? prev.firstSeenAt : nowMs, lastSeenAt: nowMs,
        runs: prev && Number.isInteger(prev.runs) && prev.runs >= 0 ? prev.runs + 1 : 1 };
    });
    return r && r.committed ? "recorded" : "not_recorded";
  } catch { return "not_recorded"; }
}
/** Remove the notice (the name is present again). Never throws. */
export async function clearDeliveryNotice(db, tenantId, bizId) {
  const path = deliveryNoticePath(tenantId, bizId);
  if (path === null) return false;
  try { await db.ref(path).remove(); return true; } catch { return false; }
}
/** The stored notice, or null. Throws only through `db` (the caller classifies a read failure). */
export async function readDeliveryNotice(db, tenantId, bizId) {
  const path = deliveryNoticePath(tenantId, bizId);
  if (path === null) return null;
  const v = (await db.ref(path).once("value")).val();
  return isRecord(v) && v.code === "business_name_unavailable" ? v : null;
}

/** Pseudonymous recipient reference (never the address itself). */
export function recipientHash(email) {
  return createHash("sha256").update(String(email).trim().toLowerCase()).digest("hex");
}
/** Short reference of a recipient. Pseudonymous (dictionary-matchable), so R1 no longer writes it to logs; kept for callers. */
export const recipientRef = (email) => "rcpt:" + recipientHash(email).slice(0, 12);

// ── bounded views of untrusted provider data (R1 / D4) ───────────────────────────────────────────────────────────────────
/** Read obj[key] without trusting obj: a non-object, a throwing getter or a Proxy trap yields undefined. */
export function safeRead(obj, key) {
  if (obj === null || (typeof obj !== "object" && typeof obj !== "function")) return undefined;
  try { return obj[key]; } catch { return undefined; }
}
const PROVIDER_CODES = new Set(["ECONFIG", "EAUTH", "ENOAUTH", "EOAUTH2", "EENVELOPE", "EMESSAGE", "ETIMEDOUT", "EDNS", "ESOCKET",
  "ECONNECTION", "ETLS", "EPROTOCOL", "ESTREAM", "EMULTISEND", "EDEADLINE"]);
const PROVIDER_COMMANDS = new Set(["CONN", "API", "EHLO", "HELO", "LHLO", "STARTTLS", "AUTH PLAIN", "AUTH LOGIN", "AUTH XOAUTH2",
  "AUTH CRAM-MD5", "MAIL FROM", "RCPT TO", "DATA", "RSET"]);
/** The error code as one of the known transport codes, "none" when absent, else "OTHER" (never the raw value). */
export function providerCode(err) {
  const c = safeRead(err, "code");
  if (c === undefined || c === null || c === "") return "none";
  return typeof c === "string" && PROVIDER_CODES.has(c) ? c : "OTHER";
}
/** The SMTP command as one of the known commands, "none" when absent, else "OTHER". */
export function providerCommand(err) {
  const c = safeRead(err, "command");
  if (c === undefined || c === null || c === "") return "none";
  return typeof c === "string" && PROVIDER_COMMANDS.has(c) ? c : "OTHER";
}
/** An SMTP reply code: an integer 200–599, else null (strings, floats, out-of-range and huge values are discarded). */
export function providerResponseCode(x) { return Number.isInteger(x) && x >= 200 && x <= 599 ? x : null; }
/** The leading SMTP reply code of a provider response text (only its first 4 characters are examined), else null. */
function responseTextCode(x) {
  if (typeof x !== "string") return null;
  const m = /^([2-5]\d\d)(?:[ \-]|$)/.exec(x.slice(0, 4));
  return m ? Number(m[1]) : null;
}
/** What the provider reported as the Message-ID, compared with the one WE set — never the reported string itself. */
export function providerIdEcho(reported, ours) {
  if (reported === undefined || reported === null || reported === "") return "absent";
  if (typeof reported !== "string" || reported.length > 998) return "invalid";
  return reported === ours ? "match" : "different";
}
const OUR_CODE = /^[a-z][a-z0-9_]{0,63}$/;
/** A delivery outcome code safe for logs / responses: our own token shape, else "invalid_code". */
export function boundedCode(code) {
  if (code === null || code === undefined) return null;
  return typeof code === "string" && OUR_CODE.test(code) ? code : "invalid_code";
}

// ── provider outcome classification (nodemailer 6.x error shapes: lib/smtp-connection/index.js _formatError) ──────────────
// The exact (code, command) pairs under which nodemailer relays an SMTP server reply (the reply text is `response`, its leading
// integer `responseCode`). Any other shape carries no server reply and so no evidence that the message was not accepted.
const NEGATIVE_REPLY_SHAPES = Object.freeze({
  EENVELOPE: new Set(["MAIL FROM", "RCPT TO", "DATA"]),
  EMESSAGE: new Set(["DATA"]),
  EAUTH: new Set(["AUTH PLAIN", "AUTH LOGIN", "AUTH XOAUTH2", "AUTH CRAM-MD5"]),
});
/**
 * The SMTP negative reply an adapter error relays, or null: an integer responseCode 400–599 that equals the leading reply code
 * of the error's `response` text, under one of the exact nodemailer (code, command) pairs. Every field is read through
 * safeRead and bounded (D4); a field that is absent, of the wrong type or inconsistent with the others yields null.
 */
export function smtpNegativeReply(err) {
  const code = providerCode(err), command = providerCommand(err);
  const shapes = NEGATIVE_REPLY_SHAPES[code];
  if (!shapes || !shapes.has(command)) return null;
  const rc = providerResponseCode(safeRead(err, "responseCode"));
  if (rc === null || rc < 400) return null;
  return responseTextCode(safeRead(err, "response")) === rc ? { code, command, responseCode: rc } : null;
}
/**
 * Classify a transport error raised AFTER sendMail was invoked (the caller has established that from its own attempt state;
 * an error before the hand-off is never classified here).
 *   { outcome: "failed", retryable, inRunRetry, code }  the server definitively did NOT accept it (an SMTP negative reply)
 *   { outcome: "unknown", code }                         anything else: it may have been accepted
 * R2 (E1): no provider-controlled property can turn a handed-over attempt into a "not sent" — no internal-looking marker, no
 * message text, no syscall, no transport error code without the server's reply.
 */
export function classifyTransportError(err) {
  const reply = smtpNegativeReply(err);
  if (reply) {
    // an authentication refusal comes before MAIL FROM: not sent; fixable only by configuration (no in-run retry)
    if (reply.code === "EAUTH") return { outcome: "failed", retryable: true, inRunRetry: false, code: "provider_auth_failed" };
    if (reply.responseCode >= 500) return { outcome: "failed", retryable: false, inRunRetry: false, code: "provider_rejected_" + reply.responseCode };
    return { outcome: "failed", retryable: true, inRunRetry: true, code: "provider_deferred_" + reply.responseCode };
  }
  const code = providerCode(err);
  if (code === "EDEADLINE") return { outcome: "unknown", code: "provider_no_answer_deadline" };
  if (code === "ETIMEDOUT") return { outcome: "unknown", code: "provider_timeout_unknown_phase" };
  if (code === "ESOCKET" || code === "ECONNECTION" || code === "EDNS") return { outcome: "unknown", code: "provider_connection_lost" };
  if (code === "EENVELOPE" || code === "EMESSAGE" || code === "EAUTH") return { outcome: "unknown", code: "provider_refusal_unverifiable" };
  return { outcome: "unknown", code: "provider_error_unclassified" };
}

const MAX_LISTED = 50;          // a single-recipient send lists one address; a longer list is not a well-formed result
const MAX_ADDRESS = 320;
/**
 * Classify a resolved sendMail result for one recipient. The result is untrusted (D4): its lists are bounded, and a result that
 * cannot be interpreted is UNKNOWN — the message was handed over, so neither acceptance nor refusal is established.
 *
 * R3 (review E2 continuation): the fields are judged TOGETHER against the provider contract of the configured adapter
 * (lib/sendEmail.js: one recipient, nodemailer 6.x SMTP — lib/smtp-connection/index.js). For that adapter a RESOLVED result
 * exists only after the server answered the end of DATA with 2xx (`_actionSMTPStream`); DATA is sent only when the sole RCPT
 * was accepted (`_actionRCPT`), and every refusal — MAIL FROM, RCPT TO, DATA — reaches us as a REJECTED promise
 * (EENVELOPE / EMESSAGE), classified by classifyTransportError.
 *
 * R4 (review E2/D4 continuation): every field is in exactly one of four evidence states, and only VALID evidence counts:
 *   absent     the property is not there (or is `undefined`): it proves nothing and contradicts nothing
 *   unreadable a throwing getter / Proxy trap, a wrong type, an over-long list, an unreadable entry, `null`   ⇒ malformed
 *   empty/     present but naming no recipient where the adapter always names one (`envelope.to: []`), or naming another
 *   conflicting recipient / code than the other fields                                                     ⇒ inconsistent
 *   valid      present, readable and naming exactly this one recipient
 * A present field is NEVER read as if it were absent (R3 mapped a throwing getter, `envelope: null`, `envelope: {}`,
 * `envelope.to: []` and a `null` refusal detail to "absent" and so let them through). Hence:
 *   accepted  ONLY when `accepted` is exactly [recipient], `rejected` (when present) is empty, `rejectedErrors` (when present)
 *             is empty, the reply code (when present) is 2xx, and `envelope` (when present) is a readable object whose `to` is
 *             exactly [recipient].
 *   failed    (provider_rejected_recipient, final, never retried) ONLY for a fully consistent refusal: `rejected` is exactly
 *             [recipient], `accepted` is empty, the reply code is PRESENT and 4xx/5xx, `rejectedErrors` (when present) is a
 *             non-empty list of readable per-recipient records each naming this recipient with this reply code, and `envelope`
 *             (when present) is exactly [recipient]. No list and no code alone establishes a refusal.
 *   unknown   everything else: provider_result_malformed (unreadable evidence), provider_result_inconsistent (empty or
 *             conflicting evidence), provider_result_incomplete (a refusal without a reply code), provider_result_indeterminate
 *             (the recipient listed nowhere). Unknown is held: never re-sent automatically.
 * The provider-reported Message-ID is not judged here: it stays the bounded diagnostic of R1 (providerIdEcho on the receipt).
 */
export function classifyTransportInfo(info, to) {
  const UNREADABLE = Symbol("unreadable");
  // one read per property; a throwing getter / revoked Proxy is UNREADABLE (never "absent"); `undefined` is absent
  const field = (obj, k) => {
    if (obj === null || typeof obj !== "object") return UNREADABLE;
    try { return obj[k]; } catch { return UNREADABLE; }
  };
  const norm = (x) => {
    const v = x !== null && typeof x === "object" ? field(x, "address") : x;
    return typeof v === "string" && v.length <= MAX_ADDRESS ? v.trim().toLowerCase() : null;
  };
  // a bounded list of readable addresses; null when it is not one (an entry that cannot be read might have been this recipient)
  const addresses = (v) => {
    try {
      if (!Array.isArray(v) || v.length > MAX_LISTED) return null;
      const out = [];
      for (let i = 0; i < v.length; i++) {
        const n = norm(v[i]);
        if (n === null || n === "") return null;
        out.push(n);
      }
      return out;
    } catch { return null; }
  };
  const malformed = (rc) => ({ outcome: "unknown", code: "provider_result_malformed", responseCode: rc });
  const inconsistent = (rc) => ({ outcome: "unknown", code: "provider_result_inconsistent", responseCode: rc });
  if (info === null || typeof info !== "object") return malformed(null);
  const want = norm(to);
  if (want === null || want === "") return malformed(null);
  // the reply text: absent, or a string that starts with a reply code
  const response = field(info, "response");
  const rc = response === undefined ? null : responseTextCode(response);
  if (response !== undefined && rc === null) return malformed(null);
  // the recipient lists: `accepted` is required; `rejected` is absent or a readable list
  const acceptedRaw = field(info, "accepted"), rejectedRaw = field(info, "rejected");
  if (acceptedRaw === undefined) return malformed(rc);
  const accepted = addresses(acceptedRaw), rejected = rejectedRaw === undefined ? [] : addresses(rejectedRaw);
  if (accepted === null || rejected === null) return malformed(rc);
  // per-recipient refusal details: absent, or a bounded list of readable { responseCode, recipient } records
  const errsRaw = field(info, "rejectedErrors");
  let details = null;                                   // null = absent
  if (errsRaw !== undefined) {
    try {
      if (!Array.isArray(errsRaw) || errsRaw.length > MAX_LISTED) return malformed(rc);
      details = [];
      for (let i = 0; i < errsRaw.length; i++) {
        const e = errsRaw[i];
        if (e === null || typeof e !== "object") return malformed(rc);
        const erc = providerResponseCode(field(e, "responseCode")), rcp = field(e, "recipient");
        const who = rcp === UNREADABLE || rcp === undefined ? null : norm(rcp);
        if (erc === null || who === null || who === "") return malformed(rc);   // a record that names no readable recipient / code
        details.push({ responseCode: erc, recipient: who });
      }
    } catch { return malformed(rc); }
  }
  // the envelope the adapter reports: absent, or a readable object whose `to` is exactly this one recipient
  const envelope = field(info, "envelope");
  if (envelope !== undefined) {
    if (envelope === UNREADABLE || envelope === null || typeof envelope !== "object") return malformed(rc);
    const envToRaw = field(envelope, "to");
    if (envToRaw === undefined) return malformed(rc);    // the adapter always reports the envelope's recipients
    const envTo = addresses(envToRaw);
    if (envTo === null) return malformed(rc);
    if (envTo.length !== 1 || envTo[0] !== want) return inconsistent(rc);   // empty, another or more than one recipient
  }
  const rc2xx = rc !== null && rc >= 200 && rc < 300, rcNegative = rc !== null && rc >= 400;
  const onlyWant = (list) => list.length === 1 && list[0] === want;
  const isAccepted = accepted.includes(want), isRejected = rejected.includes(want);
  // another (or a repeated) accepted address contradicts a one-recipient envelope, whatever else is listed
  if (accepted.length > 0 && !onlyWant(accepted)) return inconsistent(rc);
  if (isAccepted) {
    if (rejected.length > 0 || (details !== null && details.length > 0) || (rc !== null && !rc2xx)) return inconsistent(rc);
    return { outcome: "accepted", responseCode: rc };
  }
  if (isRejected) {
    if (!onlyWant(rejected)) return inconsistent(rc);
    if (rc === null) return { outcome: "unknown", code: "provider_result_incomplete", responseCode: null };
    if (!rcNegative) return inconsistent(rc);   // e.g. rejected beside the 250 end-of-DATA reply: impossible for one recipient
    if (details !== null) {
      if (details.length === 0) return inconsistent(rc);                 // present but empty refusal details
      for (const d of details) if (d.recipient !== want || d.responseCode !== rc) return inconsistent(rc);
    }
    return { outcome: "failed", retryable: false, inRunRetry: false, code: "provider_rejected_recipient", responseCode: rc };
  }
  return { outcome: "unknown", code: "provider_result_indeterminate", responseCode: rc };
}

// ── the per-attempt context lib/sendEmail.js reads (no change to the presenter's call signature) ──────────────────────
const attemptStore = new AsyncLocalStorage();
/** The delivery attempt the current async call chain belongs to, or undefined (ordinary sendEmail callers). */
export function currentDeliveryAttempt() { return attemptStore.getStore(); }

// ── receipt store over the Admin SDK RTDB (ref(path).transaction) ───────────────────────────────────────────────────────
/**
 * decide(current) returns { next, result } — `next === undefined` means "leave the receipt as it is". Returns
 * { committed, result, value }; `result` is the decision taken on the value the commit was checked against.
 *
 * The SDK first runs the update function on its CACHED value — null for an uncached path, the server route's normal state —
 * and an `undefined` return aborts at once, without consulting the server (a decision taken on a guess). So "leave as is" is
 * written back as the unchanged value: the commit is checked against the server's value, and on a mismatch the SDK re-runs
 * decide() with the server's state. (Reproduced on the RTDB emulator: test/emulator/de1-receipt-emulator.mjs.)
 */
async function transact(db, path, decide) {
  let result;
  const r = await db.ref(path).transaction((current) => {
    const cur = current === undefined ? null : current;
    const d = decide(cur);
    result = d.result;
    return d.next === undefined ? cur : d.next;
  });
  const value = r && r.snapshot && typeof r.snapshot.val === "function" ? r.snapshot.val() : null;
  return { committed: !!(r && r.committed), result, value };
}

const historyOf = (cur) => (cur && Array.isArray(cur.history) ? cur.history.slice(-(HISTORY_KEEP - 1)) : []);

function decideClaim(current, { claimId, nowMs, leaseMs, rcpt, ids, maxAttempts }) {
  const fresh = (attempt, history) => ({
    next: { v: RECEIPT_VERSION, ...ids, state: "claimed", claimId, attempt, claimedAt: nowMs, leaseUntil: nowMs + leaseMs, recipientHash: rcpt, updatedAt: nowMs, history },
    result: { action: "claimed", attempt },
  });
  if (current === null) return fresh(1, []);
  if (typeof current !== "object" || current.v !== RECEIPT_VERSION) return { next: undefined, result: { action: "skip", code: "receipt_unreadable" } };
  const s = current.state;
  if (s === "accepted") return { next: undefined, result: { action: "skip", code: "already_accepted" } };
  if (s === "unknown") return { next: undefined, result: { action: "skip", code: "unknown_requires_reconciliation" } };
  if ((s === "claimed" || s === "sending") && Number(current.leaseUntil) > nowMs) return { next: undefined, result: { action: "skip", code: "in_progress", phase: s } };
  if (s === "sending") {
    // the previous invocation stopped while the provider had the message: its outcome cannot be established
    return { next: { ...current, state: "unknown", outcome: { code: "invocation_lost_during_send" }, updatedAt: nowMs, history: [...historyOf(current), { attempt: current.attempt, state: "unknown", code: "invocation_lost_during_send", at: nowMs }] },
      result: { action: "skip", code: "unknown_requires_reconciliation", converted: true } };
  }
  if (s === "claimed") return fresh(Number(current.attempt) || 1, [...historyOf(current), { attempt: current.attempt, state: "abandoned_before_send", at: nowMs }]);
  if (s === "failed") {
    const attempts = Number(current.attempt) || 0;
    if (current.retryable === true && attempts < maxAttempts) return fresh(attempts + 1, historyOf(current));
    return { next: undefined, result: { action: "skip", code: "failed_final" } };
  }
  return { next: undefined, result: { action: "skip", code: "receipt_unreadable" } };
}

const ownedIn = (state) => (current, claimId) => current && typeof current === "object" && current.claimId === claimId && current.state === state;

/**
 * R2 (E1 / E2): the outcome of one attempt from OUR attempt state first, the provider's answer second.
 *   not handed over  ⇒ failed, retryable (claim lost / configuration / render: the provider was never invoked)
 *   handed over      ⇒ a second hand-off: unknown; a provider error: classifyTransportError (unknown unless an SMTP negative
 *                      reply); a resolved result: classifyTransportInfo; nothing recorded: unknown
 * An error thrown by our own code AFTER the provider answered does not change the provider's answer.
 */
function attemptOutcome(ctx, threw, thrown, recipient) {
  if (!ctx.handedToProvider) {
    if (!threw) return { outcome: "failed", retryable: true, inRunRetry: false, code: "not_handed_to_provider" };
    if (ctx.claimLost) return { outcome: "failed", retryable: true, inRunRetry: false, code: "claim_lost" };
    return { outcome: "failed", retryable: true, inRunRetry: false, code: providerCode(thrown) === "ECONFIG" ? "provider_not_configured" : "failed_before_send" };
  }
  if (ctx.multipleHandoffs) return { outcome: "unknown", code: "multiple_provider_handoffs" };
  if (ctx.error !== null && ctx.error !== undefined) return classifyTransportError(ctx.error);
  if (ctx.info !== null) return classifyTransportInfo(ctx.info, recipient);
  return { outcome: "unknown", code: threw ? "provider_error_unclassified" : "provider_result_missing" };
}

/**
 * Deliver ONE message under a receipt. `send()` performs the real send (e.g. sendSnapshotEmail(to, snapshot)); every
 * lib/sendEmail.js call inside it is bound to this attempt (pre-transport mark, deterministic Message-ID, outcome capture).
 * Never throws for delivery problems: returns { outcome, code, attempt, messageId?, receipt, phase? } where outcome is
 *   accepted | failed | unknown | skipped   and receipt is "recorded" | "write_failed" | "unavailable" | "not_written".
 * messageId is the Message-ID this module generated for the attempt (never a provider-reported string). `phase` accompanies a
 * skipped `in_progress`: the state of the other invocation's unresolved claim ("claimed" | "sending").
 */
export async function deliverWithReceipt({ db, kind = DAILY_SNAPSHOT_KIND, tenantId, bizId, businessDate, recipient, send,
  clock = () => Date.now(), leaseMs = CLAIM_LEASE_MS, maxAttempts = MAX_AUTOMATIC_ATTEMPTS, inRunAttempts = IN_RUN_ATTEMPTS,
  backoffMs = 1500, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), newClaimId = () => randomUUID() }) {
  const path = receiptPath(kind, tenantId, bizId, businessDate);
  if (!path) return { outcome: "failed", code: "invalid_delivery_scope", receipt: "not_written" };
  const rcpt = recipientHash(recipient);
  const ids = { kind, tenantId, bizId, businessDate };
  let last = null;
  for (let round = 1; round <= inRunAttempts; round++) {
    const claimId = newClaimId();
    let claim;
    try { claim = await transact(db, path, (cur) => decideClaim(cur, { claimId, nowMs: clock(), leaseMs, rcpt, ids, maxAttempts })); }
    catch { return last && last.outcome === "failed" ? { ...last, receipt: "unavailable" } : { outcome: "failed", code: "receipt_unavailable", receipt: "unavailable" }; }
    if (!claim.result || claim.result.action !== "claimed" || !claim.committed || !claim.value || claim.value.claimId !== claimId) {
      const code = claim.result && claim.result.code ? claim.result.code : "claim_not_confirmed";
      if (last) return last;   // our own earlier round's outcome stands (e.g. failed_final after an in-run retry)
      return { outcome: "skipped", code, receipt: claim.result && claim.result.converted ? "recorded" : "not_written",
        // an unresolved active claim held by another invocation: "claimed" (not yet handed over) or "sending" (may be with the provider)
        ...(code === "in_progress" && (claim.result.phase === "claimed" || claim.result.phase === "sending") ? { phase: claim.result.phase } : {}) };
    }
    const attempt = claim.result.attempt;
    const ctx = {
      kind, claimId, attempt, path,
      messageId: `<${kind}.${attempt}.${claimId}@delivery.marjin.app>`,
      // trusted attempt state, written ONLY by this module and lib/sendEmail.js (never derived from a provider value):
      //   handedToProvider  sendMail is invoked after this is set      claimLost        our claim refused the hand-off
      //   multipleHandoffs  a second hand-off was refused               info / error     what the provider call settled with
      handedToProvider: false, claimLost: false, multipleHandoffs: false, info: null, error: null,
      async beforeTransport() {
        // one provider hand-off per attempt: a second sendEmail inside the same send() follows a message that may already be
        // with the provider ⇒ refuse it, and the attempt ends unknown (never "failed", which would re-send the first one)
        if (ctx.handedToProvider) { ctx.multipleHandoffs = true; const e = new Error("second provider hand-off in one delivery attempt"); e.code = "EMULTISEND"; throw e; }
        let r;
        try {
          r = await transact(db, path, (cur) => (ownedIn("claimed")(cur, claimId)
            ? { next: { ...cur, state: "sending", sendingAt: clock(), messageIdHeader: ctx.messageId, updatedAt: clock() }, result: true }
            : { next: undefined, result: false }));
        } catch { r = null; }
        if (!r || !r.committed || r.result !== true) { ctx.claimLost = true; throw new Error("delivery claim lost before transport"); }
        ctx.handedToProvider = true;
      },
    };
    let threw = false, thrown;
    try { await attemptStore.run(ctx, send); } catch (err) { threw = true; thrown = err; }
    const outcome = attemptOutcome(ctx, threw, thrown, recipient);
    const now = clock();
    // the receipt names OUR Message-ID (the header we set on the message) and only a bounded echo classification of the
    // provider's reported id — never the provider's string (D4)
    const terminal = outcome.outcome === "accepted"
      ? { state: "accepted", messageId: ctx.messageId, providerIdEcho: providerIdEcho(safeRead(ctx.info, "messageId"), ctx.messageId), responseCode: providerResponseCode(outcome.responseCode) }
      : outcome.outcome === "failed"
        ? { state: "failed", retryable: outcome.retryable === true && attempt < maxAttempts, code: outcome.code }
        : { state: "unknown", code: outcome.code };
    let receipt = "recorded";
    try {
      const fin = await transact(db, path, (cur) => {
        if (!(cur && cur.claimId === claimId && (cur.state === "sending" || cur.state === "claimed"))) return { next: undefined, result: false };
        const { leaseUntil, ...rest } = cur;
        return { next: { ...rest, ...terminal, finishedAt: now, updatedAt: now, history: [...historyOf(cur), { attempt, state: terminal.state, code: terminal.code ?? null, at: now }] }, result: true };
      });
      if (!fin.committed || fin.result !== true) receipt = "write_failed";
    } catch { receipt = "write_failed"; }
    last = { outcome: outcome.outcome, code: outcome.code ?? null, attempt, receipt,
      ...(terminal.state === "accepted" ? { messageId: terminal.messageId } : {}),
      ...(terminal.state === "failed" ? { retryable: terminal.retryable } : {}) };
    const retryNow = outcome.outcome === "failed" && outcome.inRunRetry === true && terminal.retryable === true && receipt === "recorded" && round < inRunAttempts;
    if (!retryNow) return last;
    await sleep(backoffMs);
  }
  return last;
}

/**
 * Send ONE message with the same provider-outcome classification but WITHOUT a receipt (the manual, owner-requested send).
 * Returns { outcome: "accepted" | "failed" | "unknown", code, messageId? } (messageId: our generated id); never throws for
 * delivery problems.
 */
export async function deliverWithoutReceipt({ recipient, send, newClaimId = () => randomUUID() }) {
  const ctx = {
    kind: "manual", claimId: newClaimId(), attempt: 1, path: null,
    messageId: null, handedToProvider: false, claimLost: false, multipleHandoffs: false, info: null, error: null,
    async beforeTransport() {
      if (ctx.handedToProvider) { ctx.multipleHandoffs = true; const e = new Error("second provider hand-off in one delivery attempt"); e.code = "EMULTISEND"; throw e; }
      ctx.handedToProvider = true;
    },
  };
  ctx.messageId = `<manual.${ctx.claimId}@delivery.marjin.app>`;
  let threw = false, thrown;
  try { await attemptStore.run(ctx, send); } catch (err) { threw = true; thrown = err; }
  const c = attemptOutcome(ctx, threw, thrown, recipient);
  return c.outcome === "accepted" ? { outcome: "accepted", code: null, messageId: ctx.messageId } : { outcome: c.outcome, code: c.code };
}
