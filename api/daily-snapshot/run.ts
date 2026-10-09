import { VercelRequest, VercelResponse } from "@vercel/node";
import { getDb } from "../../src/firebase/admin.js";
import { buildSnapshotForBiz, buildSnapshotForAll } from "../../src/snapshot/snapshotBuilder.js";
import { sendSnapshotEmail } from "../../src/snapshot/snapshotEmail.js";
import { requireCron, requireBizContext } from "../../lib/securityContext.js";
import { deliverWithReceipt, deliverWithoutReceipt, boundedCode, DAILY_SNAPSHOT_KIND,
  readDeliveryTarget, recordMissingNameNotice, clearDeliveryNotice, readDeliveryNotice, MISSING_NAME_NOTICE_HE } from "../../lib/emailDelivery.js";
import type { DeliveryTarget, DeliveryTargetCode } from "../../lib/emailDelivery.js";

function setCorsHeaders(req: VercelRequest, res: VercelResponse): void {
  const origin = (req.headers.origin as string) || "";
  const allowed = ["https://kissgn.vercel.app", "http://localhost:3000"];
  if (allowed.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

// Recipient resolution — the SAME selection as before (owner / super_owner with a real address, else the first user with a
// real address; never a @temp.marjin.app placeholder). Daily e-mail reliability: a failed READ is no longer reported as
// "no owner e-mail" — it is `recipient_unavailable` (transient), distinct from `no_recipient` (nothing to send to).
//
// R1 (review finding D3): ABSENCE is distinguished from DAMAGE.
//   no_recipient            the list is absent or holds no user with a usable address (the legitimate empty cases)
//   recipient_unavailable   the list could not be read (transient)
//   recipient_data_invalid  the list is present but not a supported representation, or one of its users is malformed
//                           (a non-object element, or a role / email of the wrong type) — never treated as "empty"
//   recipient_invalid       the user the policy SELECTS has an address that is not a single well-formed mailbox; the run
//                           never moves on to another user (that would widen the fallback)
// Supported representations are those of the canonical server parser (lib/bizAccess.js parseAppUsers): an array, a JSON
// array string, or the runtime envelope {_v: "<JSON array>"}; a bare null element (an RTDB hole) carries no user. The
// selection predicates themselves are unchanged; validation only turns a would-be send into a visible failure. Whether a
// non-owner may receive the report at all is an owner decision (review C3), not changed here.
type RecipientCode = "no_recipient" | "recipient_unavailable" | "recipient_data_invalid" | "recipient_invalid";
type RecipientSelection = "owner" | "first_user_with_email";
type RecipientResult = { ok: true; email: string; selection: RecipientSelection } | { ok: false; code: RecipientCode };
type UserRecord = { role?: string; email?: string };
const TEMP_ADDRESS_SUFFIX = "@temp.marjin.app";
const MAILBOX = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}@(?=.{1,253}$)[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;
/** One plain mailbox (no display name, list, comment, whitespace or control character), at most 254 characters. */
function isSingleMailbox(x: string): boolean { return x.length <= 254 && MAILBOX.test(x); }
/** The stored list with the canonical server semantics: absent ⇒ empty; anything unsupported ⇒ malformed (never empty). */
function decodeUserList(raw: unknown): unknown[] | null {
  if (raw === null || raw === undefined) return [];
  if (Array.isArray(raw)) return raw;
  let json: string;
  if (typeof raw === "object" && typeof (raw as { _v?: unknown })._v === "string") json = (raw as { _v: string })._v;
  else if (typeof raw === "string") json = raw;
  else return null;
  let parsed: unknown;
  try { parsed = JSON.parse(json); } catch { return null; }
  return Array.isArray(parsed) ? parsed : null;
}
/** One stored user: null for a hole, undefined when malformed. */
function readUser(u: unknown): UserRecord | null | undefined {
  if (u === null || u === undefined) return null;
  if (typeof u !== "object" || Array.isArray(u)) return undefined;
  const role = (u as { role?: unknown }).role, email = (u as { email?: unknown }).email;
  if (role !== undefined && role !== null && typeof role !== "string") return undefined;
  if (email !== undefined && email !== null && typeof email !== "string") return undefined;
  return { role: typeof role === "string" ? role : undefined, email: typeof email === "string" ? email : undefined };
}
async function resolveOwnerRecipient(tenantId: string): Promise<RecipientResult> {
  const db = getDb();

  let usersData: unknown;
  try {
    const usersSnap = await db.ref(`tenants/${tenantId}/app/users`).once("value");
    usersData = usersSnap.val();
  } catch {
    // the error object is untrusted (its code / message may carry anything): a fixed code only (D4)
    console.error(`[daily-snapshot] recipient read failed for tenant ${tenantId} (recipient_unavailable)`);
    return { ok: false, code: "recipient_unavailable" };
  }

  const list = decodeUserList(usersData);
  if (list === null) return { ok: false, code: "recipient_data_invalid" };
  const users: Array<UserRecord | null> = [];
  for (const element of list) {
    const u = readUser(element);
    if (u === undefined) return { ok: false, code: "recipient_data_invalid" };
    users.push(u);
  }
  const pick = (email: string, selection: RecipientSelection): RecipientResult =>
    isSingleMailbox(email) ? { ok: true, email, selection } : { ok: false, code: "recipient_invalid" };

  // Find owner or super_owner
  const owner = users.find((u) => u && (u.role === "owner" || u.role === "super_owner"));
  if (owner && owner.email && !owner.email.endsWith(TEMP_ADDRESS_SUFFIX)) {
    return pick(owner.email, "owner");
  }

  // Fallback to first user with email
  const firstWithEmail = users.find((u) => u && u.email && !u.email.endsWith(TEMP_ADDRESS_SUFFIX));
  if (firstWithEmail && firstWithEmail.email) {
    return pick(firstWithEmail.email, "first_user_with_email");
  }

  return { ok: false, code: "no_recipient" };
}

// Run outcome (R1, review finding D1). Every row settles into exactly one class:
//   delivered   provider acceptance is DURABLY RECORDED: accepted with the receipt recorded, or already_accepted
//   no_send     reserved: no contract no-send condition remains (owner decision G4, 2026-10-09: a business without a name is a
//               FAILED row `business_name_unavailable`, never a silent no-send); the class is kept for the response shape
//   pending     an unresolved active claim held by another invocation (in_progress): not delivered, not failed — yet
//   unknown     the provider may have accepted it (unknown / unknown_requires_reconciliation): never re-sent automatically
//   unrecorded  the provider accepted it but the receipt could not be finalized
//   failed      confirmed not delivered, an unreadable / unconfirmed receipt, or ANY outcome not listed above (fail closed)
// The run is "completed" (HTTP 200) ONLY when every row is delivered or no_send. Any failed / unknown / unrecorded row (or a
// receipt write problem) ⇒ "completed_with_failures" (500); otherwise any pending row ⇒ "incomplete" (503). An unresolved
// claim is never re-claimed early and never re-sent: a later invocation observes its outcome (accepted ⇒ already_accepted;
// an invocation that died while sending ⇒ unknown after the lease).
type Settlement = "delivered" | "no_send" | "pending" | "unknown" | "unrecorded" | "failed";
function settle(outcome: string, code: string | null, receipt?: string): Settlement {
  if (outcome === "accepted") return receipt === "recorded" ? "delivered" : "unrecorded";
  if (outcome === "skipped" && code === "already_accepted") return "delivered";
  if (outcome === "skipped" && code === "in_progress") return "pending";
  if (outcome === "unknown" || (outcome === "skipped" && code === "unknown_requires_reconciliation")) return "unknown";
  return "failed";
}
const SAFE_ERROR_NAMES = new Set(["Error", "TypeError", "RangeError", "ReferenceError", "SyntaxError", "URIError", "EvalError", "AggregateError"]);
/** The class of an unexpected error for the log: a built-in error name, else "OTHER" — never its message (D4). */
function errorClass(error: unknown): string {
  let name: unknown;
  try { name = (error as { name?: unknown } | null)?.name; } catch { name = undefined; }
  return typeof name === "string" && SAFE_ERROR_NAMES.has(name) ? name : "OTHER";
}

// ── the pre-send identity gate (owner decisions G4 / G10 / control characters, 2026-10-09) ─────────────────────────────
// Before a business-scoped path is built or a message is addressed, (tenantId, bizId) is resolved against the tenant's
// registry with the approved shared predicates (lib/emailDelivery.js readDeliveryTarget → lib/businessRegistry.js). Every
// refusal happens BEFORE the recipient is resolved and BEFORE any provider hand-off, so "nothing was sent" is certain, and
// the refusal is disjoint — by status and by code — from a provider refusal (502 email_not_sent) and from an unknown
// acceptance (504 email_outcome_unknown). Nothing is sent, no receipt is written and no claim is touched for a refused row.
//
// Manual POST mapping (owner decision G10):
//   400  invalid_business_identity   the request names nothing addressable (control character, `:` in a business id, …)
//   404  business_not_registered     the registry is readable and denotes no such business (definitive)
//   422  ambiguous_business_identity the registry cannot establish the identity uniquely (duplicate / non-canonical twin)
//   422  registry_unreadable         the registry node exists but is malformed (shape / JSON / not an array)
//   422  business_name_unavailable   the registered record has no usable name (owner decision G4): preserved, not e-mailed
//   503  registry_unavailable        the registry could not be read (transport)
//   503  snapshot_build_failed       the snapshot could not be built (any builder failure); a SyntaxError from an undecodable
//                                    registry envelope inside the builder is 422 registry_unreadable
// Bodies are a fixed sentence plus the bounded code (and the caller-supplied, already authorized ids); never raw error
// text, never registry bytes (a Node SyntaxError message embeds the input), never an address or a financial figure.
const MANUAL_REFUSALS: Record<DeliveryTargetCode | "snapshot_build_failed", { status: number; error: string }> = {
  invalid_business_identity:   { status: 400, error: "Business identity is not addressable; email not sent" },
  business_not_registered:     { status: 404, error: "Business is not registered in this tenant; email not sent" },
  ambiguous_business_identity: { status: 422, error: "Business identity is ambiguous in the registry; email not sent" },
  registry_unreadable:         { status: 422, error: "Business registry is unreadable; email not sent" },
  business_name_unavailable:   { status: 422, error: "Unknown business snapshot; email not sent" },
  registry_unavailable:        { status: 503, error: "Business registry temporarily unavailable; email not sent" },
  snapshot_build_failed:       { status: 503, error: "Snapshot could not be built; email not sent" },
};
/** The bounded manual refusal for a builder throw: a registry SyntaxError is a malformed registry, anything else a build failure. */
function builderRefusal(error: unknown): keyof typeof MANUAL_REFUSALS {
  return errorClass(error) === "SyntaxError" ? "registry_unreadable" : "snapshot_build_failed";
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCorsHeaders(req, res);

  // Handle OPTIONS
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  // Reject unsupported methods before any authorization or side effect.
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // GET = scheduled cron (all businesses): authorized ONLY by a server-verified
  // `Authorization: Bearer ${CRON_SECRET}` (centralized requireCron).
  // x-vercel-cron is never accepted.
  if (req.method === "GET") {
    try {
      requireCron(req);
    } catch (e: any) {
      return res.status(e?.status ?? 401).json({ error: e?.msg ?? "unauthorized" });
    }
  }

  // POST = manual single-business email: a VERIFIED owner/super_owner with
  // canonical server-side tenant + business scope. requireBizContext rejects a
  // caller-supplied tenant/biz the user does not own (fail-closed); no
  // client-supplied role or membership can establish authorization.
  let snapshotCtx: { tenantId: string; bizId: string; role: string } | null = null;
  if (req.method === "POST") {
    const rawTenantId = (req.body as { tenantId?: unknown } | undefined)?.tenantId;
    const rawBizId = (req.body as { bizId?: unknown } | undefined)?.bizId;
    try {
      const ctx = await requireBizContext(req, {
        tenantId: rawTenantId as string,
        bizId: rawBizId as string,
        mode: "write",
      });
      if (ctx.role !== "owner" && ctx.role !== "super_owner") {
        return res.status(403).json({ error: "owner_role_required" });
      }
      snapshotCtx = { tenantId: ctx.tenantId, bizId: ctx.bizId, role: ctx.role };
    } catch (e: any) {
      return res.status(e?.status ?? 401).json({ error: e?.msg ?? "unauthorized" });
    }
  }

  try {
    // GET = cron trigger (run for all businesses)
    if (req.method === "GET") {
      const snapshots = await buildSnapshotForAll();
      const db = getDb();

      // Daily e-mail reliability: every business ends in exactly one recorded outcome. A message is sent at most once per
      // (business, business date) by automation: a receipt (lib/emailDelivery.js) is claimed before the provider is
      // called, so a duplicate, concurrent or re-run invocation never re-sends an accepted or possibly-accepted message.
      type Row = { tenantId: string; bizId: string; businessDate: string | null; outcome: string; code: string | null; settlement: Settlement;
        attempt?: number; receipt?: string; phase?: string; recipientSelection?: RecipientSelection; notice?: "recorded" | "not_recorded" };
      const results: Row[] = [];
      const registryCache = new Map<string, unknown>();   // one registry read per tenant per run

      for (const snapshot of snapshots) {
        const base = { tenantId: snapshot.tenantId, bizId: snapshot.bizId, businessDate: snapshot.date ?? null };
        // the pre-send identity gate: only the ONE registered business with a usable name is addressed (G4 / G10 / control
        // characters). A refused business is a FAILED row with its bounded code — no send, no receipt, no claim — and a
        // missing name additionally records the owner notice (never a placeholder name, never the e-mail as the notice).
        const target: DeliveryTarget = await readDeliveryTarget(db, snapshot.tenantId, snapshot.bizId, { cache: registryCache });
        if (target.state !== "deliverable") {
          console.warn("[daily-snapshot] business not deliverable", { tenantId: snapshot.tenantId, bizId: snapshot.bizId, code: target.code });
          const row: Row = { ...base, outcome: "failed", code: target.code, settlement: "failed", receipt: "not_written" };
          if (target.state === "name_unavailable") row.notice = await recordMissingNameNotice(db, { tenantId: snapshot.tenantId, bizId: snapshot.bizId, businessDate: base.businessDate });
          results.push(row);
          continue;
        }

        const recipient = await resolveOwnerRecipient(snapshot.tenantId);
        if (!recipient.ok) {
          console.warn(`[daily-snapshot] no deliverable recipient for ${snapshot.tenantId}:${snapshot.bizId} (${recipient.code})`);
          results.push({ ...base, outcome: "failed", code: recipient.code, settlement: "failed" });
          continue;
        }

        const r = await deliverWithReceipt({
          db,
          kind: DAILY_SNAPSHOT_KIND,
          tenantId: snapshot.tenantId,
          bizId: snapshot.bizId,
          businessDate: snapshot.date,
          recipient: recipient.email,
          send: () => sendSnapshotEmail(recipient.email, snapshot),
        });
        const code = boundedCode(r.code);
        const settlement = settle(r.outcome, code, r.receipt);
        const attemptNo = Number.isInteger(r.attempt) ? r.attempt : undefined;
        if (settlement === "pending") {
          console.warn(`[daily-snapshot] delivery pending for ${snapshot.tenantId}:${snapshot.bizId}:${snapshot.date}: another invocation holds the claim (${r.phase === "sending" ? "sending" : "claimed"})`);
        } else if (settlement !== "delivered") {
          console.error(`[daily-snapshot] delivery ${settlement} for ${snapshot.tenantId}:${snapshot.bizId}:${snapshot.date} code=${code} attempt=${attemptNo ?? "-"} receipt=${r.receipt}`);
        }
        results.push({ ...base, outcome: r.outcome, code, settlement, attempt: attemptNo, receipt: r.receipt,
          ...(settlement === "pending" ? { phase: r.phase === "sending" ? "sending" : "claimed" } : {}), recipientSelection: recipient.selection });
      }

      const count = (pred: (x: Row) => boolean) => results.filter(pred).length;
      const sentCount = count((x) => x.outcome === "accepted");
      const alreadyAcceptedCount = count((x) => x.outcome === "skipped" && x.code === "already_accepted");
      const inProgressCount = count((x) => x.settlement === "pending");
      const unknownCount = count((x) => x.settlement === "unknown");
      const failureCount = count((x) => x.settlement === "failed");
      const unrecordedCount = count((x) => x.settlement === "unrecorded");
      const skippedCount = count((x) => x.settlement === "no_send");
      const deliveredCount = count((x) => x.settlement === "delivered");
      const receiptWriteFailures = count((x) => x.receipt === "write_failed" || x.receipt === "unavailable");
      const broken = failureCount > 0 || unknownCount > 0 || unrecordedCount > 0 || receiptWriteFailures > 0;
      const complete = !broken && inProgressCount === 0 && deliveredCount + skippedCount === results.length;

      // A run with any undelivered, ambiguous, unrecorded OR still-unresolved message is NOT reported as success to the
      // scheduler: only a run whose every message is durably recorded as accepted (or a contract no-send) is "completed".
      return res.status(complete ? 200 : broken ? 500 : 503).json({
        status: complete ? "completed" : broken ? "completed_with_failures" : "incomplete",
        totalSnapshots: snapshots.length,
        successCount: sentCount,
        alreadyAcceptedCount,
        inProgressCount,
        failureCount,
        unknownCount,
        unrecordedCount,
        skippedCount,
        receiptWriteFailures,
        results,
      });
    }

    // POST = manual trigger for single business (authorized above). A manual send is an explicit owner request: it is not
    // de-duplicated against the scheduled receipt, but its provider outcome is classified (never a false success).
    if (req.method === "POST" && snapshotCtx) {
      const { tenantId, bizId } = snapshotCtx;
      const db = getDb();
      const refuse = (code: keyof typeof MANUAL_REFUSALS) => {
        console.warn("[daily-snapshot] manual send refused", { tenantId, bizId, code });
        return res.status(MANUAL_REFUSALS[code].status).json({ error: MANUAL_REFUSALS[code].error, code, tenantId, bizId });
      };
      const action = (req.body as { action?: unknown } | undefined)?.action;
      if (action !== undefined && action !== "notice") return res.status(400).json({ error: "invalid_action" });

      // the pre-send identity gate (G4 / G10 / control characters): resolved before any business-scoped path is built
      const target = await readDeliveryTarget(db, tenantId, bizId);

      // action: "notice" — the owner-authorized read of the in-app notice for this business (same authorization as a manual
      // send: owner / super_owner of the tenant, through requireBizContext). Nothing is sent. A notice whose cause is gone
      // (the name is present again) is removed on read; a target that is not deliverable for another reason is reported as such.
      if (action === "notice") {
        if (target.state === "unavailable") return refuse("registry_unavailable");
        if (target.state === "deliverable") {
          await clearDeliveryNotice(db, tenantId, bizId);
          return res.status(200).json({ status: "ok", tenantId, bizId, deliverable: true, code: null, notice: null });
        }
        let notice: Awaited<ReturnType<typeof readDeliveryNotice>> | null = null;
        if (target.state === "name_unavailable") {
          try { notice = await readDeliveryNotice(db, tenantId, bizId); } catch { notice = null; }
          // no scheduled run has recorded it yet (or the read failed): the same notice, not yet counted
          if (notice === null) notice = { code: "business_name_unavailable", message: MISSING_NAME_NOTICE_HE, tenantId, bizId, businessDate: null, firstSeenAt: 0, lastSeenAt: 0, runs: 0 };
        }
        return res.status(200).json({ status: "ok", tenantId, bizId, deliverable: false, code: target.code, notice });
      }

      if (target.state !== "deliverable") return refuse(target.code);

      let snapshot: Awaited<ReturnType<typeof buildSnapshotForBiz>>;
      try { snapshot = await buildSnapshotForBiz(tenantId, bizId); }
      catch (error) {
        // the error is untrusted (D4): only its class is read; a registry SyntaxError is a malformed registry, the rest a build failure
        console.error(`[daily-snapshot] manual build failed (${errorClass(error)})`);
        return refuse(builderRefusal(error));
      }
      // the registry's own name is the one the owner sees in the message — never the builder's placeholder
      snapshot = { ...snapshot, bizName: target.name };

      const recipient = await resolveOwnerRecipient(tenantId);

      if (!recipient.ok) {
        if (recipient.code === "no_recipient") return res.status(404).json({ error: "No owner email found for this tenant" });
        if (recipient.code === "recipient_unavailable") return res.status(503).json({ error: "Owner email temporarily unavailable", code: recipient.code });
        return res.status(422).json({ error: "Owner email record invalid", code: recipient.code });
      }
      const ownerEmail = recipient.email;

      const r = await deliverWithoutReceipt({ recipient: ownerEmail, send: () => sendSnapshotEmail(ownerEmail, snapshot) });
      if (r.outcome === "failed") return res.status(502).json({ error: "email_not_sent", code: boundedCode(r.code) });
      if (r.outcome !== "accepted") return res.status(504).json({ error: "email_outcome_unknown", code: boundedCode(r.code) });

      // R1 (review finding D2): the response never names the recipient — no address, no hash — only which policy selected it.
      return res.status(200).json({
        status: "success",
        snapshot: {
          tenantId: snapshot.tenantId,
          bizId: snapshot.bizId,
          bizName: snapshot.bizName,
          date: snapshot.date,
          netProfit: snapshot.netProfit,
          totalSales: snapshot.totalSales,
        },
        delivery: { outcome: "accepted", recipient: recipient.selection },
      });
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (error) {
    // never the message, stack or properties of the error: they are untrusted and may carry personal data (D4)
    console.error(`[daily-snapshot] run failed (${errorClass(error)})`);
    return res.status(500).json({
      error: "Internal server error",
    });
  }
}
