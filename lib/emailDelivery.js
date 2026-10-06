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
 *   stored — only a SHA-256 of the normalized recipient, the provider message id and SMTP status codes.
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

export const RECEIPT_VERSION = "MARJIN_EMAIL_RECEIPT/1";
export const RECEIPT_ROOT = "email_delivery";
export const DAILY_SNAPSHOT_KIND = "daily_snapshot";
export const MAX_AUTOMATIC_ATTEMPTS = 3;            // provider attempts per message, across invocations
export const IN_RUN_ATTEMPTS = 2;                   // attempts within one invocation (only for definitive, transient refusals)
export const CLAIM_LEASE_MS = 10 * 60 * 1000;       // > one bounded send (lib/sendEmail.js SEND_DEADLINE_MS) + render
export const HISTORY_KEEP = 10;

const SAFE_ID = /^[^.#$\[\]\/:]{1,128}$/;
const BUSINESS_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** The receipt node path, or null when an identity is not safely addressable. */
export function receiptPath(kind, tenantId, bizId, businessDate) {
  if (typeof kind !== "string" || !/^[a-z_]{1,40}$/.test(kind)) return null;
  if (typeof tenantId !== "string" || !SAFE_ID.test(tenantId)) return null;
  if (typeof bizId !== "string" || !SAFE_ID.test(bizId)) return null;
  if (typeof businessDate !== "string" || !BUSINESS_DATE.test(businessDate)) return null;
  return `${RECEIPT_ROOT}/${kind}/${tenantId}/${bizId}/${businessDate}`;
}

/** Pseudonymous recipient reference (never the address itself). */
export function recipientHash(email) {
  return createHash("sha256").update(String(email).trim().toLowerCase()).digest("hex");
}
/** Short log-safe reference of a recipient. */
export const recipientRef = (email) => "rcpt:" + recipientHash(email).slice(0, 12);

// ── provider outcome classification (nodemailer 6.x error shapes: lib/smtp-connection/index.js _formatError) ──────────────
/**
 * Classify a transport error into a delivery outcome.
 *   { outcome: "failed", retryable, inRunRetry, code }  the provider definitively did NOT accept the message
 *   { outcome: "unknown", code }                         it may have accepted it (no answer after the data may have left)
 * nodemailer reports a socket inactivity timeout and a dropped connection as ETIMEDOUT / ESOCKET / ECONNECTION with command
 * "CONN" WHATEVER the protocol phase, so those are ambiguous unless the error proves the connection never existed.
 */
export function classifyTransportError(err) {
  const code = err && typeof err.code === "string" ? err.code : "";
  const rc = err && Number.isInteger(err.responseCode) ? err.responseCode : null;
  const msg = err && typeof err.message === "string" ? err.message : "";
  if (err && err.deliveryPhase === "before_transport") return { outcome: "failed", retryable: true, inRunRetry: false, code: err.deliveryCode || "not_handed_to_provider" };
  if (code === "ECONFIG") return { outcome: "failed", retryable: true, inRunRetry: false, code: "provider_not_configured" };
  // an authentication refusal happens before MAIL FROM: definitively not sent; fixable only by configuration (no in-run retry)
  if (code === "EAUTH") return { outcome: "failed", retryable: true, inRunRetry: false, code: "provider_auth_failed" };
  if (rc !== null && rc >= 500) return { outcome: "failed", retryable: false, inRunRetry: false, code: "provider_rejected_" + rc };
  if (rc !== null && rc >= 400) return { outcome: "failed", retryable: true, inRunRetry: true, code: "provider_deferred_" + rc };
  if (code === "EENVELOPE" || code === "EMESSAGE") return { outcome: "failed", retryable: false, inRunRetry: false, code: "provider_refused_message" };
  if (code === "ETIMEDOUT" && /^(Connection timeout|Greeting never received)/.test(msg)) return { outcome: "failed", retryable: true, inRunRetry: true, code: "provider_unreachable" };
  if (code === "EDNS") return { outcome: "failed", retryable: true, inRunRetry: true, code: "provider_unreachable" };
  if ((code === "ESOCKET" || code === "ECONNECTION") && err && (err.syscall === "connect" || err.syscall === "getaddrinfo")) return { outcome: "failed", retryable: true, inRunRetry: true, code: "provider_unreachable" };
  if (code === "EMULTISEND") return { outcome: "unknown", code: "multiple_provider_handoffs" };
  if (code === "EDEADLINE") return { outcome: "unknown", code: "provider_no_answer_deadline" };
  if (code === "ETIMEDOUT") return { outcome: "unknown", code: "provider_timeout_unknown_phase" };
  if (code === "ESOCKET" || code === "ECONNECTION") return { outcome: "unknown", code: "provider_connection_lost" };
  return { outcome: "unknown", code: "provider_error_unclassified" };
}

/** Classify a resolved sendMail result for one recipient. */
export function classifyTransportInfo(info, to) {
  const norm = (x) => String(x && typeof x === "object" && "address" in x ? x.address : x).trim().toLowerCase();
  const want = norm(to);
  const accepted = Array.isArray(info && info.accepted) ? info.accepted.map(norm) : [];
  const rejected = Array.isArray(info && info.rejected) ? info.rejected.map(norm) : [];
  const rc = typeof (info && info.response) === "string" ? Number((info.response.match(/^\d+/) || [])[0]) || null : null;
  if (rejected.includes(want) || !accepted.includes(want)) return { outcome: "failed", retryable: false, inRunRetry: false, code: "provider_rejected_recipient", responseCode: rc };
  return { outcome: "accepted", responseCode: rc };
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
  if ((s === "claimed" || s === "sending") && Number(current.leaseUntil) > nowMs) return { next: undefined, result: { action: "skip", code: "in_progress" } };
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
 * Deliver ONE message under a receipt. `send()` performs the real send (e.g. sendSnapshotEmail(to, snapshot)); every
 * lib/sendEmail.js call inside it is bound to this attempt (pre-transport mark, deterministic Message-ID, outcome capture).
 * Never throws for delivery problems: returns { outcome, code, attempt, messageId?, receipt } where outcome is
 *   accepted | failed | unknown | skipped   and receipt is "recorded" | "write_failed" | "unavailable" | "not_written".
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
      return { outcome: "skipped", code, receipt: claim.result && claim.result.converted ? "recorded" : "not_written" };
    }
    const attempt = claim.result.attempt;
    const ctx = {
      kind, claimId, attempt, path,
      messageId: `<${kind}.${attempt}.${claimId}@delivery.marjin.app>`,
      handedToProvider: false, info: null, error: null,
      async beforeTransport() {
        // one provider hand-off per attempt: a second sendEmail inside the same send() follows a message that may already be
        // with the provider ⇒ refuse it, and the attempt ends unknown (never "failed", which would re-send the first one)
        if (ctx.handedToProvider) { const e = new Error("second provider hand-off in one delivery attempt"); e.code = "EMULTISEND"; throw e; }
        const r = await transact(db, path, (cur) => (ownedIn("claimed")(cur, claimId)
          ? { next: { ...cur, state: "sending", sendingAt: clock(), messageIdHeader: ctx.messageId, updatedAt: clock() }, result: true }
          : { next: undefined, result: false }));
        if (!r.committed || r.result !== true) { const e = new Error("delivery claim lost before transport"); e.deliveryPhase = "before_transport"; e.deliveryCode = "claim_lost"; throw e; }
        ctx.handedToProvider = true;
      },
    };
    let outcome;
    try {
      await attemptStore.run(ctx, send);
      outcome = ctx.info ? classifyTransportInfo(ctx.info, recipient) : { outcome: "unknown", code: "provider_result_missing" };
    } catch (err) {
      if (!ctx.handedToProvider) {
        const isClaimLoss = err && err.deliveryPhase === "before_transport";
        outcome = { outcome: "failed", retryable: true, inRunRetry: false, code: isClaimLoss ? err.deliveryCode || "not_handed_to_provider" : (err && err.code === "ECONFIG" ? "provider_not_configured" : "failed_before_send") };
      } else outcome = classifyTransportError(ctx.error || err);
    }
    const now = clock();
    const terminal = outcome.outcome === "accepted"
      ? { state: "accepted", messageId: (ctx.info && ctx.info.messageId) || ctx.messageId, responseCode: outcome.responseCode ?? null }
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
 * Returns { outcome: "accepted" | "failed" | "unknown", code, messageId? }; never throws for delivery problems.
 */
export async function deliverWithoutReceipt({ recipient, send, newClaimId = () => randomUUID() }) {
  const ctx = {
    kind: "manual", claimId: newClaimId(), attempt: 1, path: null,
    messageId: null, handedToProvider: false, info: null, error: null,
    async beforeTransport() { ctx.handedToProvider = true; },
  };
  ctx.messageId = `<manual.${ctx.claimId}@delivery.marjin.app>`;
  try {
    await attemptStore.run(ctx, send);
  } catch (err) {
    if (!ctx.handedToProvider) return { outcome: "failed", code: err && err.code === "ECONFIG" ? "provider_not_configured" : "failed_before_send" };
    const c = classifyTransportError(ctx.error || err);
    return { outcome: c.outcome, code: c.code };
  }
  if (!ctx.info) return { outcome: "unknown", code: "provider_result_missing" };
  const c = classifyTransportInfo(ctx.info, recipient);
  return c.outcome === "accepted" ? { outcome: "accepted", code: null, messageId: ctx.info.messageId || ctx.messageId } : { outcome: c.outcome, code: c.code };
}
