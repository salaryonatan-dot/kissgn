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
 *
 * HR1 — THE DAILY-ONLY DELIVERY HOLD (operational r2 HOLD_PROPOSAL, corrected for OP-R1..R3; see the HR1 section below)
 *   One server-only node `delivery_control/daily_snapshot` carries the hold state AND its audit log, changed only by ONE
 *   transaction per change. Gates read it with a bounded timeout and treat everything except a well-formed, logged
 *   "released" record as HELD (absent, deleted, malformed, unreadable, timed out: fail closed). A held Daily is never handed
 *   to the provider: the scheduled run is refused right after the read-only build, before any claim (G1), per message before
 *   the claim (G0) and at the
 *   final boundary in beforeTransport (G3); the manual send is refused before the build (G2) and at the final boundary (G3).
 *   A hold is NOT a provider failure: G0 writes no claim, and G3 expires the claim at the SAME attempt number with a
 *   `held_before_send` history entry and skips the terminal write, so no attempt of MAX_AUTOMATIC_ATTEMPTS is consumed and
 *   no new receipt state exists. A business date on which any scheduled Daily was held is marked under
 *   `delivery_control/daily_snapshot_held_dates/{date}` and an exact refusal inventory; no release-date range is sealed.
 *   HR3 release remains blocked while complete coverage cannot be verified (see the HR3 handoff).
 *   The manual send writes a durable attempt record under
 *   `email_delivery_manual/{tenant}/{business}/{attemptId}` BEFORE the hand-off (refused if it cannot), the evidence a drain
 *   needs. A hand-off that already started cannot be recalled; `unknown` stays held for reconciliation (P7) exactly as before.
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
/**
 * R7 (review finding OD-02): the notice STORE state — never a manufactured notice. Never throws.
 *   { state: "present", record }   a node is stored for this business (`record` is the well-formed notice, or null for a
 *                                  foreign node that is not a notice)
 *   { state: "absent" }            the store was read and holds nothing for this business (confirmed)
 *   { state: "unavailable" }       the store could not be read: nothing is known about the stored notice; the error is
 *                                  untrusted and discarded (a fixed state only, nothing of it is kept)
 */
export async function readDeliveryNoticeState(db, tenantId, bizId) {
  const path = deliveryNoticePath(tenantId, bizId);
  if (path === null) return { state: "absent" };
  let v;
  try { v = (await db.ref(path).once("value")).val(); } catch { return { state: "unavailable" }; }
  if (v === null || v === undefined) return { state: "absent" };
  return { state: "present", record: isRecord(v) && v.code === "business_name_unavailable" ? v : null };
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
 *
 * R6 (independent R4 review, finding E4-01): the STRUCTURE of the whole resolved result is validated before any field is
 * read as evidence. The adapter's resolved result is a plain record { accepted: string[], rejected: string[], rejectedErrors?,
 * response: string, envelope: { from, to: string[] }, messageId, … }: a value that is not a plain record (an array — even one
 * decorated with the right properties — a function, a class instance, a Proxy whose prototype cannot be read) is malformed
 * evidence, exactly like a wrong-typed field; so is an `envelope` that is not a plain record or a refusal detail that is a
 * list. R4 accepted a decorated array as the result (`typeof [] === "object"`) and recorded a final acceptance from it.
 */
export function classifyTransportInfo(info, to) {
  const UNREADABLE = Symbol("unreadable");
  // one read per property; a throwing getter / revoked Proxy is UNREADABLE (never "absent"); `undefined` is absent
  const field = (obj, k) => {
    if (obj === null || typeof obj !== "object") return UNREADABLE;
    try { return obj[k]; } catch { return UNREADABLE; }
  };
  // a PLAIN record: a non-null object that is not an array, whose prototype is Object.prototype or null and can be read
  const isPlainRecord = (x) => {
    if (x === null || typeof x !== "object") return false;
    try {                                             // a revoked Proxy throws even on Array.isArray: unreadable, not a record
      if (Array.isArray(x)) return false;
      const proto = Object.getPrototypeOf(x);
      return proto === Object.prototype || proto === null;
    } catch { return false; }
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
  if (!isPlainRecord(info)) return malformed(null);     // R6: the result itself must be a plain record (never an array)
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
        if (e === null || typeof e !== "object" || Array.isArray(e)) return malformed(rc);   // a detail is a record, never a list
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
    if (!isPlainRecord(envelope)) return malformed(rc);   // R6: the envelope is a plain record (never an array / instance)
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

// ── HR1: the Daily-only delivery hold (server-only state; Rules `$other` denies every client) ──────────────────────────────
// Record (one node, one transaction per change — OP-R1). HR3 records exact dates and uncertain intents:
//   delivery_control/daily_snapshot = { schema: 1, state: "held" | "released", version: n,
//                                       log: { "v000000001": { action, state, version, prevVersion, actor, reason, at, replaced? } } }
// The gates count the Daily as RELEASED only when the complete canonical audit progression is valid and ends in release.
// Everything else is HELD. The scheduled gate also enforces the retained date exclusion.
// Nothing here is tamper-proof against a holder of the service account (the Admin SDK bypasses Rules); the protocol makes an
// accidental, partial or log-less change fail closed and keeps state and audit consistent.
export const DELIVERY_HOLD_PATH = "delivery_control/daily_snapshot";
export const HELD_DATES_ROOT = "delivery_control/daily_snapshot_held_dates";
export const MANUAL_ATTEMPT_ROOT = "email_delivery_manual";
export const MANUAL_ATTEMPT_VERSION = "MARJIN_MANUAL_ATTEMPT/1";
export const HOLD_SCHEMA = 1;
export const HOLD_READ_TIMEOUT_MS = 5000;
/** The state each hold action leads to. `init` creates (or re-creates over an absent / malformed record) a HELD record. */
export const HOLD_ACTIONS = Object.freeze({ init: "held", hold: "held", release: "released" });
/** The log key of a version (zero-padded so the keys sort in version order). */
export function holdLogKey(version) { return "v" + String(version).padStart(9, "0"); }
const isPlain = (x) => x !== null && typeof x === "object" && !Array.isArray(x);
const isVersion = (v) => Number.isInteger(v) && v >= 1 && v <= 1e9;
const ISRAEL_DATE = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Jerusalem", year: "numeric", month: "2-digit", day: "2-digit" });
function israelDate(nowMs) {
  if (!Number.isSafeInteger(nowMs) || nowMs < 0) return null;
  const date = new Date(nowMs);
  if (!Number.isFinite(date.getTime())) return null;
  const parts = Object.fromEntries(ISRAEL_DATE.formatToParts(date).map((p) => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}
const validDate = (s) => typeof s === "string" && BUSINESS_DATE.test(s) &&
  !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;

/**
 * Pure classification of a raw hold node. Returns { state: "released" | "held", code, version }:
 *   code null                        released: well-formed and logged
 *   code "delivery_held"             a well-formed record whose state is held
 *   code "delivery_hold_unreadable"  absent, deleted, malformed, or a state / log entry that does not match (fail closed)
 */
export function classifyHoldRecord(raw) {
  const unreadable = { state: "held", code: "delivery_hold_unreadable", version: null };
  if (!isPlain(raw) || raw.schema !== HOLD_SCHEMA || !isVersion(raw.version)) return unreadable;
  if (raw.state !== "held" && raw.state !== "released") return unreadable;
  if (!isPlain(raw.log)) return unreadable;
  if (raw.excludedThrough !== undefined && !validDate(raw.excludedThrough)) return unreadable;
  if (raw.refusedDates !== undefined && (!isPlain(raw.refusedDates) || Object.entries(raw.refusedDates).some(([date, x]) =>
      !validDate(date) || !isPlain(x) || typeof x.generation !== "string" || typeof x.intent !== "string"))) return unreadable;
  if (raw.inventory !== undefined) {
    const i = raw.inventory;
    if (!isPlain(i) || i.schema !== 1 || !/^[a-f0-9-]{36}$/.test(i.generation) || !isVersion(i.holdVersion) || i.holdVersion > raw.version ||
        !Number.isSafeInteger(i.revision) || i.revision < 0 || i.coverage !== "unverified" || (i.legacyUncertainThrough !== undefined && !validDate(i.legacyUncertainThrough)) ||
        (i.entries !== undefined && (!isPlain(i.entries) || Object.entries(i.entries).some(([id, x]) => !/^[a-f0-9-]{36}$/.test(id) ||
          !isPlain(x) || !validDate(x.businessDate) || !isVersion(x.observedVersion) || !/^[a-f0-9-]{36}$/.test(x.generation) || !["pending", "refused", "allowed"].includes(x.state))))) return unreadable;
    if (i.confirmation != null && (!isPlain(i.confirmation) || i.confirmation.generation !== i.generation ||
        !/^[a-f0-9]{64}$/.test(i.confirmation.digest) || !ACTOR.test(i.confirmation.actor) || !validReason(i.confirmation.reason) ||
        !Number.isSafeInteger(i.confirmation.at) || i.confirmation.at < 0)) return unreadable;
  }
  if (raw.refusedDates && Object.entries(raw.refusedDates).some(([date, proof]) => {
    const entry = raw.inventory?.entries?.[proof.intent];
    return !entry || entry.state !== "refused" || entry.businessDate !== date || entry.generation !== proof.generation;
  })) return unreadable;
  if (Object.keys(raw.log).length !== raw.version) return unreadable;
  let previousState = null;
  for (let version = 1; version <= raw.version; version++) {
    const entry = raw.log[holdLogKey(version)];
    if (!isPlain(entry) || entry.version !== version || entry.prevVersion !== version - 1 ||
        typeof entry.actor !== "string" || !ACTOR.test(entry.actor) || !validReason(entry.reason) || !Number.isSafeInteger(entry.at) || entry.at < 0) return unreadable;
    if (version === 1 ? entry.action !== "init" || entry.state !== "held" :
      entry.action !== (previousState === "held" ? "release" : "hold") || entry.state !== HOLD_ACTIONS[entry.action]) return unreadable;
    if (version > 1 && entry.replaced !== undefined) return unreadable;
    if (entry.replaced !== undefined && (!isPlain(entry.replaced) || !/^[a-f0-9]{64}$/.test(entry.replaced.sha256))) return unreadable;
    previousState = entry.state;
  }
  if (previousState !== raw.state) return unreadable;
  if (raw.state === "held") return { state: "held", code: "delivery_held", version: raw.version };
  return { state: "released", code: null, version: raw.version };
}

/** One read with a bounded wait. Never throws: { ok: true, value } | { ok: false } (the error is untrusted and discarded). */
async function readBounded(db, path, timeoutMs) {
  let timer;
  try {
    const timeout = new Promise((resolve) => { timer = setTimeout(() => resolve({ ok: false }), timeoutMs); });
    const read = (async () => ({ ok: true, value: (await db.ref(path).once("value")).val() }))().catch(() => ({ ok: false }));
    return await Promise.race([read, timeout]);
  } catch { return { ok: false }; } finally { clearTimeout(timer); }
}

/** The hold as the gates see it. Never throws; a read that fails or times out is HELD (`delivery_hold_unavailable`). */
export async function readDeliveryHold(db, { timeoutMs = HOLD_READ_TIMEOUT_MS } = {}) {
  const r = await readBounded(db, DELIVERY_HOLD_PATH, timeoutMs);
  if (!r.ok) return { state: "held", code: "delivery_hold_unavailable", version: null };
  return classifyHoldRecord(r.value === undefined ? null : r.value);
}

/** The held-date marker path of a business date, or null. */
export function heldDatePath(businessDate) {
  return typeof businessDate === "string" && BUSINESS_DATE.test(businessDate) ? `${HELD_DATES_ROOT}/${businessDate}` : null;
}

/**
 * The scheduled Daily gate for one business date (G1 / G0 / G3). Never throws. Open ONLY when the hold is released AND the
 * date carries no held-date marker (read and absent). { open, code, version }:
 *   delivery_held | delivery_hold_unreadable | delivery_hold_unavailable   the hold record (see readDeliveryHold)
 *   held_day                 this business date was held earlier: it is not sent automatically after release (owner decision)
 *   held_day_unverifiable    the marker could not be read, or the date is not a business date (fail closed)
 */
export async function readDailyDeliveryGate(db, businessDate, { timeoutMs = HOLD_READ_TIMEOUT_MS, ignoredIntent = null } = {}) {
  const markerPath = heldDatePath(businessDate);
  const [holdRead, marker] = await Promise.all([readBounded(db, DELIVERY_HOLD_PATH, timeoutMs),
    markerPath === null ? Promise.resolve({ ok: false }) : readBounded(db, markerPath, timeoutMs)]);
  const hold = holdRead.ok ? classifyHoldRecord(holdRead.value) : { state: "held", code: "delivery_hold_unavailable", version: null };
  if (hold.state !== "released") return { open: false, code: hold.code, version: hold.version };
  // Exact refusal evidence only. Legacy excludedThrough is validated but never interpreted as a date range.
  if (validDate(businessDate) && holdRead.value.refusedDates?.[businessDate])
    return { open: false, code: "held_day", version: hold.version };
  if (Object.entries(holdRead.value.inventory?.entries ?? {}).some(([id, x]) => id !== ignoredIntent && x.businessDate === businessDate && x.state === "pending" && x.observedVersion !== hold.version))
    return { open: false, code: "held_day_unverifiable", version: hold.version };
  // An old HR2 range cannot reveal which dates were actually refused. Preserve uncertainty, never call it proof.
  const legacyUncertainThrough = holdRead.value.inventory?.legacyUncertainThrough ??
    (holdRead.value.inventory === undefined ? holdRead.value.excludedThrough : undefined);
  if (validDate(businessDate) && validDate(legacyUncertainThrough) && businessDate <= legacyUncertainThrough)
    return { open: false, code: "held_day_unverifiable", version: hold.version };
  if (!marker.ok) return { open: false, code: "held_day_unverifiable", version: hold.version };
  if (marker.value?.uncertain === true || marker.value?.code === "held_day_unverifiable") return { open: false, code: "held_day_unverifiable", version: hold.version };
  if (marker.value !== null && marker.value !== undefined) return { open: false, code: "held_day", version: hold.version };
  return { open: true, code: null, version: hold.version };
}

/** Mark a business date as held (create-if-absent; the first marker stands). Never throws: "recorded" | "exists" | "not_recorded". */
export async function recordHeldDate(db, businessDate, { code, version = null, stage, nowMs = Date.now(), uncertain = false } = {}) {
  const path = heldDatePath(businessDate);
  if (path === null) return "not_recorded";
  try {
    const r = await transact(db, path, (cur) => (cur !== null
      ? { next: undefined, result: "exists" }
      : { next: { businessDate, ...(uncertain ? { uncertain: true } : {}), firstHeldAt: nowMs, code: boundedCode(code) ?? "delivery_held", holdVersion: isVersion(version) ? version : null, stage: boundedCode(stage) ?? "unknown" }, result: "recorded" }));
    return r.committed ? r.result : "not_recorded";
  } catch { return "not_recorded"; }
}

/**
 * The gate function the scheduled route passes to deliverWithReceipt for one business date: it reads the gate and, when it
 * is closed, marks the date as held (so the held day is not sent automatically later). Never throws.
 */
export function makeDailyDeliveryGate(db, businessDate, { timeoutMs = HOLD_READ_TIMEOUT_MS, clock = () => Date.now() } = {}) {
  return async (stage) => {
    const id = randomUUID(), generation = randomUUID();
    // Write ahead of the hold read. An acknowledged intent is never inferred from a local callback.
    const admitted = await inventoryTransaction(db, (cur) => {
      if (classifyHoldRecord(cur).code === "delivery_hold_unreadable" || !validDate(businessDate))
        return { next: undefined, result: { ok: false } };
      const inv = cur.inventory ?? { ...newInventory(generation, cur.version), ...(cur.excludedThrough ? { legacyUncertainThrough: cur.excludedThrough } : {}) };
      return { next: { ...cur, inventory: { ...inv, revision: inv.revision + 1, confirmation: null,
        entries: { ...inv.entries, [id]: { businessDate, observedVersion: cur.version, generation: inv.generation, stage: boundedCode(stage) ?? "unknown", state: "pending" } } } },
        result: { ok: true, generation: inv.generation } };
    }, timeoutMs);
    if (!admitted?.result?.ok || !admitted.committed) {
      // No claim of a proven refused date when the write-ahead acknowledgement is uncertain.
      const read = await readDailyDeliveryGate(db, businessDate, { timeoutMs });
      const code = read.open ? "held_day_unverifiable" : read.code;
      const marker = await recordHeldDate(db, businessDate, { code, version: read.version, stage, nowMs: clock(), uncertain: true });
      return { open: false, code, version: read.version, heldDate: marker };
    }
    const g = await readDailyDeliveryGate(db, businessDate, { timeoutMs, ignoredIntent: id });
    const finalized = await inventoryTransaction(db, (cur) => {
      const inv = cur?.inventory, entry = inv?.entries?.[id];
      if (!entry || inv.generation !== admitted.result.generation) return { next: undefined, result: { ok: false } };
      // The pending entry of THIS invocation must not turn its own open read into uncertainty.
      const state = g.open ? "allowed" : ["delivery_held", "held_day"].includes(g.code) ? "refused" : "pending";
      // A valid unchanged RELEASED audit/version proves there was no hold transition since these intents were admitted.
      // Resolve only those intents; an intent from an earlier version/generation remains uncertain. This is not coverage proof.
      const entries = Object.fromEntries(Object.entries(inv.entries ?? {}).map(([key, value]) => [key,
        cur.state === "released" && value.state === "pending" && value.observedVersion === cur.version
          ? { ...value, state: "allowed", code: null, basis: "unchanged_released_audit" } : value]));
      const refusedDates = state === "refused" ? { ...cur.refusedDates, [businessDate]: { generation: inv.generation, intent: id } } : cur.refusedDates;
      return { next: { ...cur, ...(refusedDates ? { refusedDates } : {}), inventory: { ...inv, revision: inv.revision + 1, confirmation: null,
        entries: { ...entries, [id]: { ...entry, state, code: g.code } } } }, result: { ok: state !== "pending" } };
    }, timeoutMs);
    if (g.open && !finalized?.result?.ok) return { open: false, code: "held_day_unverifiable", version: g.version };
    if (g.open) return g;
    const marker = await recordHeldDate(db, businessDate, { code: g.code, version: g.version, stage, nowMs: clock() });
    return { ...g, heldDate: marker };
  };
}

// This is deliberately NOT a completeness proof: unregistered invocations may exist after first-write failure.
// A confirmation records only operator review of these exact bytes. No declaration can enable release.
const newInventory = (generation, holdVersion) => ({ schema: 1, generation, holdVersion, revision: 0,
  coverage: "unverified", entries: {} });
const canonical = (v) => v === null || typeof v !== "object" ? JSON.stringify(v) : Array.isArray(v)
  ? `[${v.map(canonical).join(",")}]` : `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(",")}}`;
export function deliveryInventoryView(raw) {
  const inv = raw?.inventory;
  if (classifyHoldRecord(raw).code === "delivery_hold_unreadable" || !inv) return { ok: false, code: "inventory_missing_or_unreadable" };
  const content = { generation: inv.generation, holdVersion: inv.holdVersion, revision: inv.revision,
    legacyUncertainThrough: inv.legacyUncertainThrough ?? null, entries: inv.entries ?? {}, refusedDates: raw.refusedDates ?? {}, log: raw.log, state: raw.state, version: raw.version };
  return { ok: true, ...content, digest: createHash("sha256").update(canonical(content)).digest("hex"),
    coverage: "unverified", complete: false, pending: Object.keys(inv.entries ?? {}).filter((k) => inv.entries[k].state === "pending") };
}
async function inventoryTransaction(db, decide, timeoutMs = HOLD_READ_TIMEOUT_MS) {
  let timer;
  try { return await Promise.race([transact(db, DELIVERY_HOLD_PATH, decide),
    new Promise((resolve) => { timer = setTimeout(() => resolve(null), Math.min(timeoutMs, HOLD_READ_TIMEOUT_MS)); })]); }
  catch { return null; } finally { clearTimeout(timer); }
}
export async function confirmDeliveryInventory(db, { generation, digest, actor, reason, nowMs = Date.now(), timeoutMs = HOLD_READ_TIMEOUT_MS } = {}) {
  if (typeof generation !== "string" || !/^[a-f0-9-]{36}$/.test(generation) || typeof digest !== "string" || !/^[a-f0-9]{64}$/.test(digest) ||
      typeof actor !== "string" || !ACTOR.test(actor) || !validReason(reason) || !Number.isSafeInteger(nowMs) || nowMs < 0)
    return { ok: false, code: "invalid_request" };
  const r = await inventoryTransaction(db, (cur) => {
    const view = deliveryInventoryView(cur);
    if (!view.ok || cur.state !== "held") return { next: undefined, result: { ok: false, code: "inventory_missing_or_unreadable" } };
    if (view.generation !== generation || view.digest !== digest) return { next: undefined, result: { ok: false, code: "inventory_confirmation_mismatch" } };
    if (view.pending.length) return { next: undefined, result: { ok: false, code: "inventory_incomplete" } };
    return { next: { ...cur, inventory: { ...cur.inventory, confirmation: { generation, digest, actor, reason, at: nowMs } } },
      result: { ok: true, code: "inventory_review_recorded", releaseBlocked: true, coverage: "unverified" } };
  }, timeoutMs);
  return r?.committed ? r.result : { ok: false, code: "inventory_read_or_write_unavailable" };
}

/** The manual Daily gate: the hold record only (a held-date marker does not block an owner's explicit send). Never throws. */
export async function readManualDeliveryGate(db, { timeoutMs = HOLD_READ_TIMEOUT_MS } = {}) {
  const hold = await readDeliveryHold(db, { timeoutMs });
  return hold.state === "released" ? { open: true, code: null, version: hold.version } : { open: false, code: hold.code, version: hold.version };
}

const ACTOR = /^[A-Za-z0-9._@+-]{1,64}$/;
const validReason = (r) => typeof r === "string" && r.trim().length >= 3 && r.length <= 200 && !RTDB_CONTROL_CHARS.test(r);
/**
 * Change the hold (the operator tool's only write). ONE transaction on the record writes state, version and the log entry
 * together, or nothing. Returns { ok, code, state?, version? }:
 *   applied            the change committed (state / version are the new ones)
 *   invalid_request    unknown action, actor not a bounded id, reason not 3..200 printable characters, missing expectVersion
 *   exists             `init` on a well-formed record (use hold / release)
 *   not_initialized    hold / release on an absent record (use init; the gates already hold)
 *   unreadable_record  hold / release on a malformed record (use init, which re-creates it HELD and digests what it replaced)
 *   version_conflict   the record's version is not `expectVersion` (someone else changed it: re-read the status)
 *   no_change          the record is already in that state (nothing is written: no empty log entry)
 *   transaction_failed the transaction could not be committed (nothing is known to have changed: re-read the status)
 */
export async function changeDeliveryHold(db, { action, actor, reason, expectVersion, nowMs = Date.now() } = {}) {
  if (!Object.prototype.hasOwnProperty.call(HOLD_ACTIONS, action) || typeof actor !== "string" || !ACTOR.test(actor) ||
      !validReason(reason) || israelDate(nowMs) === null) return { ok: false, code: "invalid_request" };
  if (action !== "init" && !isVersion(expectVersion)) return { ok: false, code: "invalid_request" };
  if (action === "release") {
    const read = await readBounded(db, DELIVERY_HOLD_PATH, HOLD_READ_TIMEOUT_MS);
    if (!read.ok) return { ok: false, code: "inventory_read_unavailable" };
    const c = classifyHoldRecord(read.value);
    if (c.code === "delivery_hold_unreadable") return { ok: false, code: read.value === null ? "not_initialized" : "unreadable_record" };
    if (read.value.version !== expectVersion) return { ok: false, code: "version_conflict", version: read.value.version };
    if (read.value.state === "released") return { ok: false, code: "no_change", version: read.value.version };
    const view = deliveryInventoryView(read.value);
    if (!view.ok) return { ok: false, code: view.code };
    if (view.pending.length) return { ok: false, code: "inventory_incomplete" };
    if (!read.value.inventory.confirmation || read.value.inventory.confirmation.digest !== view.digest)
      return { ok: false, code: "inventory_confirmation_required" };
    // There is no authoritative durable ingress inventory in this component. A complete-looking local set and an
    // operator declaration do not prove completeness after first-write loss. Leave the hold and audit unchanged.
    return { ok: false, code: "inventory_coverage_unverified" };
  }
  const target = HOLD_ACTIONS[action];
  let r;
  try {
    r = await transact(db, DELIVERY_HOLD_PATH, (cur) => {
      const c = classifyHoldRecord(cur);
      const wellFormed = c.code !== "delivery_hold_unreadable";
      if (action === "init") {
        if (wellFormed) return { next: undefined, result: { code: "exists" } };
        const replaced = cur === null ? null : { sha256: createHash("sha256").update(JSON.stringify(cur)).digest("hex") };
        const entry = { action, state: target, version: 1, prevVersion: 0, actor, reason, at: nowMs, ...(replaced ? { replaced } : {}) };
        return { next: { schema: HOLD_SCHEMA, state: target, version: 1, inventory: newInventory(randomUUID(), 1), log: { [holdLogKey(1)]: entry } }, result: { code: "applied", state: target, version: 1 } };
      }
      if (cur === null) return { next: undefined, result: { code: "not_initialized" } };
      if (!wellFormed) return { next: undefined, result: { code: "unreadable_record" } };
      if (cur.version !== expectVersion) return { next: undefined, result: { code: "version_conflict", version: cur.version } };
      if (cur.state === target) return { next: undefined, result: { code: "no_change", version: cur.version } };
      const version = cur.version + 1;
      const entry = { action, state: target, version, prevVersion: cur.version, actor, reason, at: nowMs };
      return { next: { ...cur, state: target, version, inventory: { ...newInventory(randomUUID(), version), ...((cur.inventory?.legacyUncertainThrough ?? (cur.inventory === undefined ? cur.excludedThrough : undefined)) ? { legacyUncertainThrough: cur.inventory?.legacyUncertainThrough ?? cur.excludedThrough } : {}), entries: cur.inventory?.entries ?? {}, revision: (cur.inventory?.revision ?? 0) + 1 },
        log: { ...cur.log, [holdLogKey(version)]: entry } }, result: { code: "applied", state: target, version } };
    });
  } catch { return { ok: false, code: "transaction_failed" }; }
  const res = r.result || { code: "transaction_failed" };
  if (res.code === "applied" && !r.committed) return { ok: false, code: "transaction_failed" };
  return { ok: res.code === "applied", ...res };
}

/** The manual-attempt record path, or null when an identity is not safely addressable. */
export function manualAttemptPath(tenantId, bizId, attemptId) {
  if (!isTenantKey(tenantId) || !isBusinessKey(bizId)) return null;
  if (typeof attemptId !== "string" || !/^[A-Za-z0-9-]{8,64}$/.test(attemptId)) return null;
  return `${MANUAL_ATTEMPT_ROOT}/${tenantId}/${bizId}/${attemptId}`;
}

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
  // HR1: a deliberate hold refused the hand-off (G3) — not a provider failure and not a failed attempt
  if (ctx.held && !ctx.handedToProvider) return { outcome: "held", code: ctx.held };
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

/** Consult an HR1 gate; a gate that throws or answers anything but { open: true } is CLOSED (fail closed). Never throws. */
async function callGate(gate, stage) {
  try {
    const g = await gate(stage);
    if (g && g.open === true) return { open: true, code: null };
    return { open: false, code: boundedCode(g && g.code) ?? "delivery_hold_unavailable" };
  } catch { return { open: false, code: "delivery_hold_unavailable" }; }
}

/**
 * Deliver ONE message under a receipt. `send()` performs the real send (e.g. sendSnapshotEmail(to, snapshot)); every
 * lib/sendEmail.js call inside it is bound to this attempt (pre-transport mark, deterministic Message-ID, outcome capture).
 * Never throws for delivery problems: returns { outcome, code, attempt, messageId?, receipt, phase? } where outcome is
 *   accepted | failed | unknown | skipped | held   and receipt is "recorded" | "write_failed" | "unavailable" | "not_written".
 * messageId is the Message-ID this module generated for the attempt (never a provider-reported string). `phase` accompanies a
 * skipped `in_progress`: the state of the other invocation's unresolved claim ("claimed" | "sending").
 *
 * HR1 `gate` (the scheduled Daily passes makeDailyDeliveryGate): an async function returning { open, code }. It is consulted
 * before every claim (G0: closed ⇒ `held`, no claim, receipt untouched) and as the final boundary inside beforeTransport (G3:
 * closed ⇒ the claim is expired at the SAME attempt number with a `held_before_send` history entry, the provider is never
 * invoked, no terminal state is written). Neither consumes an attempt. Without `gate` the behaviour is unchanged.
 */
export async function deliverWithReceipt({ db, kind = DAILY_SNAPSHOT_KIND, tenantId, bizId, businessDate, recipient, send,
  clock = () => Date.now(), leaseMs = CLAIM_LEASE_MS, maxAttempts = MAX_AUTOMATIC_ATTEMPTS, inRunAttempts = IN_RUN_ATTEMPTS,
  backoffMs = 1500, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), newClaimId = () => randomUUID(), gate = null }) {
  const path = receiptPath(kind, tenantId, bizId, businessDate);
  if (!path) return { outcome: "failed", code: "invalid_delivery_scope", receipt: "not_written" };
  const rcpt = recipientHash(recipient);
  const ids = { kind, tenantId, bizId, businessDate };
  let last = null;
  for (let round = 1; round <= inRunAttempts; round++) {
    // G0 (HR1): a held Daily writes no claim — nothing is consumed and the receipt is not touched
    if (gate) {
      const g = await callGate(gate, "g0");
      if (!g.open) return last || { outcome: "held", code: g.code, receipt: "not_written" };
    }
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
      handedToProvider: false, claimLost: false, multipleHandoffs: false, info: null, error: null, held: null, heldReceipt: null,
      async beforeTransport() {
        // one provider hand-off per attempt: a second sendEmail inside the same send() follows a message that may already be
        // with the provider ⇒ refuse it, and the attempt ends unknown (never "failed", which would re-send the first one)
        if (ctx.handedToProvider) { ctx.multipleHandoffs = true; const e = new Error("second provider hand-off in one delivery attempt"); e.code = "EMULTISEND"; throw e; }
        // G3 (HR1), the final boundary: a hold set after G0 still stops the hand-off. The claim is expired at the same attempt
        // number (the next claim after release re-claims it without consuming an attempt) and the provider is never invoked.
        if (gate) {
          const g = await callGate(gate, "g3");
          if (!g.open) {
            ctx.held = g.code;
            let x;
            try {
              x = await transact(db, path, (cur) => (ownedIn("claimed")(cur, claimId)
                ? { next: { ...cur, leaseUntil: clock(), updatedAt: clock(), history: [...historyOf(cur), { attempt: cur.attempt, state: "held_before_send", code: boundedCode(g.code), at: clock() }] }, result: true }
                : { next: undefined, result: false }));
            } catch { x = null; }
            ctx.heldReceipt = x && x.committed && x.result === true ? "recorded" : "write_failed";
            const e = new Error("daily delivery held before transport"); e.code = "EDELIVERYHELD"; throw e;
          }
        }
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
    // HR1: a held attempt keeps its (expired) claim — no terminal state, no attempt consumed; nothing was handed over
    if (outcome.outcome === "held") return { outcome: "held", code: outcome.code, attempt, receipt: ctx.heldReceipt || "write_failed" };
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

/**
 * HR1 — the manual (owner-requested) Daily send with the hold's final boundary and a DURABLE attempt record (the evidence a
 * stop / drain needs; the manual send still has no receipt and is still not de-duplicated — P4 is not decided here).
 *   G3       the hold is read inside beforeTransport, right before the hand-off: closed ⇒ `held`, the provider is never invoked
 *   record   email_delivery_manual/{tenant}/{business}/{attemptId} is CREATED (create-only transaction) in state "handing_off"
 *            BEFORE the hand-off; if it cannot be written the send is refused (`manual_record_unavailable`, not handed over).
 *            After the provider settles it is finalized to accepted | failed | unknown (+ the bounded code). A finalization that
 *            fails leaves "handing_off", which a drain counts as unresolved — never as "not sent".
 * The record holds no address, no body and no financial figure: ids, our Message-ID, the business date, the bounded outcome,
 * the deployment id, the authorized actor's ROLE (owner | super_owner; the route's authorization section is unchanged, so the
 * uid is not threaded through — an alternative recorded for review) and which recipient policy selected the address.
 * Returns { outcome: accepted | failed | unknown | held, code, attemptId, record, messageId? }; never throws for delivery problems.
 */
export async function deliverManualDaily({ db, tenantId, bizId, businessDate, recipient, recipientSelection = null, actorRole = null, send,
  gate = () => readManualDeliveryGate(db), clock = () => Date.now(), newClaimId = () => randomUUID(),
  deploymentId = typeof process !== "undefined" && process.env ? process.env.VERCEL_DEPLOYMENT_ID : undefined }) {
  const attemptId = newClaimId();
  const path = manualAttemptPath(tenantId, bizId, attemptId);
  if (!path) return { outcome: "failed", code: "invalid_delivery_scope", attemptId: null, record: "not_written" };
  const bounded = (v, re) => (typeof v === "string" && re.test(v) ? v : null);
  const ctx = {
    kind: "manual", claimId: attemptId, attempt: 1, path, messageId: `<manual.${attemptId}@delivery.marjin.app>`,
    handedToProvider: false, claimLost: false, multipleHandoffs: false, info: null, error: null, held: null, recordFailed: false,
    async beforeTransport() {
      if (ctx.handedToProvider) { ctx.multipleHandoffs = true; const e = new Error("second provider hand-off in one delivery attempt"); e.code = "EMULTISEND"; throw e; }
      const g = await callGate(gate, "g3");
      if (!g.open) { ctx.held = g.code; const e = new Error("daily delivery held before transport"); e.code = "EDELIVERYHELD"; throw e; }
      let r;
      try {
        r = await transact(db, path, (cur) => (cur !== null ? { next: undefined, result: false } : { result: true, next: {
          v: MANUAL_ATTEMPT_VERSION, attemptId, kind: DAILY_SNAPSHOT_KIND, tenantId, bizId,
          businessDate: typeof businessDate === "string" && BUSINESS_DATE.test(businessDate) ? businessDate : null,
          state: "handing_off", messageIdHeader: ctx.messageId, startedAt: clock(), updatedAt: clock(),
          deploymentId: bounded(deploymentId, /^[A-Za-z0-9_-]{1,64}$/), actorRole: bounded(actorRole, /^(owner|super_owner)$/),
          recipientSelection: bounded(recipientSelection, /^[a-z_]{1,40}$/) } }));
      } catch { r = null; }
      if (!r || !r.committed || r.result !== true) { ctx.recordFailed = true; const e = new Error("manual attempt record unavailable"); e.code = "EATTEMPTRECORD"; throw e; }
      ctx.handedToProvider = true;
    },
  };
  let threw = false, thrown;
  try { await attemptStore.run(ctx, send); } catch (err) { threw = true; thrown = err; }
  const c = ctx.recordFailed && !ctx.handedToProvider ? { outcome: "failed", code: "manual_record_unavailable" } : attemptOutcome(ctx, threw, thrown, recipient);
  if (!ctx.handedToProvider) return { outcome: c.outcome, code: c.code ?? null, attemptId, record: "not_written" };
  let record = "recorded";
  try {
    const now = clock();
    const fin = await transact(db, path, (cur) => (cur && cur.attemptId === attemptId && cur.state === "handing_off"
      ? { next: { ...cur, state: c.outcome, code: c.code ?? null, settledAt: now, updatedAt: now }, result: true }
      : { next: undefined, result: false }));
    if (!fin.committed || fin.result !== true) record = "write_failed";
  } catch { record = "write_failed"; }
  return c.outcome === "accepted"
    ? { outcome: "accepted", code: null, attemptId, record, messageId: ctx.messageId }
    : { outcome: c.outcome, code: c.code ?? null, attemptId, record };
}
