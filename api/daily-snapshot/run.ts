import { VercelRequest, VercelResponse } from "@vercel/node";
import { getDb } from "../../src/firebase/admin.js";
import { buildSnapshotForBiz, buildSnapshotRun } from "../../src/snapshot/snapshotBuilder.js";
import { sendSnapshotEmail } from "../../src/snapshot/snapshotEmail.js";
import { requireCron, requireBizContext } from "../../lib/securityContext.js";
import { deliverWithReceipt, deliverManualDaily, boundedCode, DAILY_SNAPSHOT_KIND,
  readDeliveryTarget, recordMissingNameNotice, clearDeliveryNotice, readDeliveryNoticeState,
  makeDailyDeliveryGate, readManualDeliveryGate } from "../../lib/emailDelivery.js";
import type { DeliveryTarget, DeliveryTargetCode, DeliveryNotice, DeliveryNoticeState } from "../../lib/emailDelivery.js";

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
//   held        HR1: the Daily-only hold refused the message before the provider (G0 / G3): not sent, not failed, no attempt
//               consumed; the business date is marked held and is NOT sent automatically after release (owner decision)
//   failed      confirmed not delivered, an unreadable / unconfirmed receipt, or ANY outcome not listed above (fail closed)
// The run is "completed" (HTTP 200) ONLY when every row is delivered or no_send. Any failed / unknown / unrecorded row (or a
// receipt write problem) ⇒ "completed_with_failures" (500); otherwise any pending or held row ⇒ 503 — "held" when every row
// that is not delivered is held, else "incomplete". An unresolved claim is never re-claimed early and never re-sent: a later
// invocation observes its outcome (accepted ⇒ already_accepted; an invocation that died while sending ⇒ unknown after the lease).
type Settlement = "delivered" | "no_send" | "pending" | "unknown" | "unrecorded" | "held" | "failed";
function settle(outcome: string, code: string | null, receipt?: string): Settlement {
  if (outcome === "held") return "held";
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
//   503  snapshot_build_failed       the snapshot could not be built: ANY builder throw that the builder itself did not
//                                    attribute to the registry (R7, review finding OD-01 — a failure is classified by the
//                                    operation that failed, never by the exception class: a SyntaxError raised while the
//                                    snapshot data is read is a build failure, not a malformed registry; R8, review finding
//                                    CF5-01 — an attribution needs the builder's provenance marker, never the message alone)
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
// The bounded codes a builder may attribute itself (delivery coordination contract §3). Only the builder knows which of its
// operations failed; the route never infers the source from the exception class or from the message text alone.
const BUILDER_ATTRIBUTED_CODES: ReadonlySet<string> = new Set<DeliveryTargetCode>(["invalid_business_identity", "business_not_registered",
  "ambiguous_business_identity", "registry_unreadable", "business_name_unavailable", "registry_unavailable"]);
// The builder's provenance marker (R8, review finding CF5-01; contract §3 as refined by the Builder successor 690a07d9): a
// genuine refusal is an Error whose `name` is exactly this, whose OWN `code` property equals its `message`, and whose
// message is one of the bounded codes. The class itself stays private to the builder; nothing else is read.
const BUILDER_REFUSAL_NAME = "SnapshotIdentityRefusal";
/**
 * The bounded manual refusal for a builder throw (R8): the code the builder attributed — only when all three fields of the
 * provenance marker agree (name, own code, message in the bounded set; every read guarded against a throwing accessor or
 * Proxy) — else snapshot_build_failed. A plain Error(code), a SyntaxError(code), a record { message, code }, a marker
 * with a mismatched or inherited code, or a value whose properties cannot be read is a failure of the build, not of the
 * registry: the route's own gate already read the registry and found the business deliverable before the builder ran.
 * Nothing of the thrown value is logged or echoed (the caller logs the bounded class only).
 */
function builderRefusal(error: unknown): keyof typeof MANUAL_REFUSALS {
  let name: unknown, message: unknown, code: unknown, ownCode = false;
  try {
    if (!(error instanceof Error)) return "snapshot_build_failed";     // a revoked Proxy throws even here
    name = error.name;
    message = error.message;
    ownCode = Object.prototype.hasOwnProperty.call(error, "code");
    code = ownCode ? (error as { code?: unknown }).code : undefined;
  } catch { return "snapshot_build_failed"; }
  if (name !== BUILDER_REFUSAL_NAME || !ownCode || typeof message !== "string" || code !== message) return "snapshot_build_failed";
  return BUILDER_ATTRIBUTED_CODES.has(message) ? (message as DeliveryTargetCode) : "snapshot_build_failed";
}

// ── the owner notice read (action: "notice"; R7, review finding OD-02) ─────────────────────────────────────────────────
// Three states are reported DISTINCTLY and never collapsed into one another:
//   deliverable / code   the business / name state from the registry read (the route's own gate; null when the registry
//                        could not be read)
//   noticeState          the notice STORE state: "active" (stored, and the cause persists), "stale" (stored, but the
//                        business is no longer in the missing-name state), "none" (read, nothing stored — confirmed),
//                        "unavailable" (the store could not be read — nothing is known, nothing is manufactured)
//   clearState           what happened to a stored notice whose cause is gone: "cleared" (the removal was acknowledged),
//                        "failed" (the removal failed — the notice is STILL stored), "not_needed" (nothing was stored),
//                        "not_attempted" (an earlier step failed), "not_applicable" (the cause persists)
// HTTP 200 only when every step succeeded; a store that cannot be read or cleared is 503 with `status: "unavailable"`, the
// same bounded shape as the pre-send infrastructure refusals (no raw error text; the stored record, when returned, carries
// no financial figure, no address and no name). A notice is NEVER synthesized: when nothing is stored, `notice` is null
// and `noticeState` says so; the business state alone says whether the Daily is blocked.
type NoticeState = "active" | "stale" | "none" | "unavailable";
type ClearState = "cleared" | "failed" | "not_needed" | "not_attempted" | "not_applicable";
const NOTICE_UNAVAILABLE = { registry: "Business registry temporarily unavailable; notice state unknown",
  read: "Daily notice store temporarily unavailable; notice state unknown", clear: "Daily notice could not be cleared; notice still stored" };

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
      // Agent/Daily integration (I1; Builder contract G1/G2/G7): the scheduled run consumes the builder's STRUCTURED result,
      // never the lossy array adapter. ONE clock read fixes the run's business date for discovery, every build and every
      // failure row. A throw here (the builder's accounting invariant, an unusable run instant) fails the WHOLE run before
      // any delivery: the outer catch answers 500 with a fixed body and logs the class only (G7 — never an empty success).
      const run = await buildSnapshotRun({ nowMs: Date.now() });
      const db = getDb();
      // G1: evaluate the Daily-only hold for the run's own business date before claims, notices or recipient resolution.
      // Only an atomically committed refusal records that date as held. Missing, malformed or unavailable state closes
      // this invocation without creating refusal evidence. The build itself only reads; held rows keep failure accounting,
      // and a held-only run answers 503.
      const g1 = await makeDailyDeliveryGate(db, run.businessDate)("g1");
      if (!g1.open) {
        console.warn("[daily-snapshot] scheduled run held", { code: g1.code, businessDate: run.businessDate, heldDate: g1.heldDate ?? null });
        const failures = new Map(run.failedBuilds.map((f) => [JSON.stringify([f.tenantId, f.bizId]), f] as const));
        const results = run.expectedBusinesses.map((x) => {
          const failure = failures.get(JSON.stringify([x.tenantId, x.bizId]));
          return failure
            ? { tenantId: x.tenantId, bizId: x.bizId, businessDate: x.businessDate, outcome: "failed", code: boundedCode(failure.code) ?? "snapshot_build_failed", settlement: "failed", receipt: "not_written" }
            : { tenantId: x.tenantId, bizId: x.bizId, businessDate: x.businessDate, outcome: "held", code: g1.code, settlement: "held", receipt: "not_written" };
        });
        const failureCount = run.failedBuilds.length;
        const discoveryFailed = run.discovery.status !== "complete";
        const broken = failureCount > 0 || discoveryFailed || run.status !== "complete";
        return res.status(broken ? 500 : 503).json({ status: broken ? "completed_with_failures" : "held", code: g1.code, businessDate: run.businessDate,
          holdVersion: g1.version, heldDate: g1.heldDate ?? null, expectedBusinesses: run.expectedBusinesses.length,
          totalSnapshots: run.snapshots.length, failedBuildCount: failureCount,
          discovery: { status: run.discovery.status, failures: run.discovery.failures.map((f) => ({ source: f.source, code: f.code })) },
          exclusionCount: run.exclusions.length, exclusions: run.exclusions.map((x) => ({ tenantId: x.tenantId, bizId: x.bizId, businessDate: x.businessDate, reason: x.reason })),
          successCount: 0, failureCount, unknownCount: 0, heldCount: results.length - failureCount, results });
      }

      // Daily e-mail reliability: every business ends in exactly one recorded outcome. A message is sent at most once per
      // (business, business date) by automation: a receipt (lib/emailDelivery.js) is claimed before the provider is
      // called, so a duplicate, concurrent or re-run invocation never re-sends an accepted or possibly-accepted message.
      type Row = { tenantId: string; bizId: string; businessDate: string | null; outcome: string; code: string | null; settlement: Settlement;
        attempt?: number; receipt?: string; phase?: string; recipientSelection?: RecipientSelection; notice?: "recorded" | "not_recorded" };
      const results: Row[] = [];
      const registryCache = new Map<string, unknown>();   // one registry read per tenant per run
      // HR1: once a message of this run is held, every later message of the run is held too (one held day, never a partial
      // release inside a run); other invocations see the held-date marker.
      let runHeld: string | null = null;
      const gatesByDate = new Map<string, ReturnType<typeof makeDailyDeliveryGate>>();

      // Every EXPECTED business becomes exactly one row (G1 / G3), in discovery order within each class: its snapshot is
      // delivered below, or its failed build is a FAILED row with the builder's bounded code and the run's business date — no
      // send, no receipt, no claim (G6). A missing name additionally records the owner notice (D-G4; contract §1.3).
      // Identities are matched by the structured pair, never by a delimiter concatenation of the ids.
      const pairKey = (t: string, b: string) => JSON.stringify([t, b]);
      const builtByPair = new Map(run.snapshots.map((s) => [pairKey(s.tenantId, s.bizId), s] as const));
      const failedByPair = new Map(run.failedBuilds.map((f) => [pairKey(f.tenantId, f.bizId), f] as const));
      const snapshots: typeof run.snapshots[number][] = [];
      for (const expected of run.expectedBusinesses) {
        const key = pairKey(expected.tenantId, expected.bizId);
        const built = builtByPair.get(key);
        if (built) { snapshots.push(built); continue; }
        const failure = failedByPair.get(key);
        const code = boundedCode(failure?.code) ?? "snapshot_build_failed";
        console.warn("[daily-snapshot] business not deliverable (build failed)", { tenantId: expected.tenantId, bizId: expected.bizId, code });
        const row: Row = { tenantId: expected.tenantId, bizId: expected.bizId, businessDate: expected.businessDate, outcome: "failed", code,
          settlement: "failed", receipt: "not_written" };
        if (code === "business_name_unavailable") row.notice = await recordMissingNameNotice(db, { tenantId: expected.tenantId, bizId: expected.bizId, businessDate: expected.businessDate });
        results.push(row);
      }

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

        if (runHeld !== null) { results.push({ ...base, outcome: "held", code: runHeld, settlement: "held", receipt: "not_written" }); continue; }
        let gate = gatesByDate.get(snapshot.date);
        if (!gate) { gate = makeDailyDeliveryGate(db, snapshot.date); gatesByDate.set(snapshot.date, gate); }
        const r = await deliverWithReceipt({
          db,
          kind: DAILY_SNAPSHOT_KIND,
          tenantId: snapshot.tenantId,
          bizId: snapshot.bizId,
          businessDate: snapshot.date,
          recipient: recipient.email,
          send: () => sendSnapshotEmail(recipient.email, snapshot),
          gate,
        });
        if (r.outcome === "held") runHeld = boundedCode(r.code) ?? "delivery_held";
        const code = boundedCode(r.code);
        const settlement = settle(r.outcome, code, r.receipt);
        const attemptNo = Number.isInteger(r.attempt) ? r.attempt : undefined;
        if (settlement === "held") {
          console.warn(`[daily-snapshot] delivery held for ${snapshot.tenantId}:${snapshot.bizId}:${snapshot.date} code=${code}`);
        } else if (settlement === "pending") {
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
      const heldCount = count((x) => x.settlement === "held");
      const receiptWriteFailures = count((x) => x.receipt === "write_failed" || x.receipt === "unavailable");
      // G2: a failed discovery breaks the run even with zero known businesses; G1: the builder's own status must be complete
      const discoveryFailed = run.discovery.status !== "complete";
      const broken = failureCount > 0 || unknownCount > 0 || unrecordedCount > 0 || receiptWriteFailures > 0 || discoveryFailed;
      const complete = !broken && run.status === "complete" && inProgressCount === 0 && heldCount === 0 && deliveredCount + skippedCount === results.length;
      const heldOnly = !broken && !complete && heldCount > 0 && inProgressCount === 0 && deliveredCount + skippedCount + heldCount === results.length;

      // A run with any undelivered, ambiguous, unrecorded OR still-unresolved message is NOT reported as success to the
      // scheduler: only a run whose every message is durably recorded as accepted (or a contract no-send) is "completed".
      return res.status(complete ? 200 : broken ? 500 : 503).json({
        status: complete ? "completed" : broken ? "completed_with_failures" : heldOnly ? "held" : "incomplete",
        businessDate: run.businessDate,
        expectedBusinesses: run.expectedBusinesses.length,
        totalSnapshots: run.snapshots.length,
        failedBuildCount: run.failedBuilds.length,
        // G2: the builder's discovery accounting, verbatim (sources and bounded codes only — no identity, no raw text)
        discovery: { status: run.discovery.status, failures: run.discovery.failures.map((f) => ({ source: f.source, code: f.code })) },
        // G5: legitimate exclusions are reported as non-deliverable rows and a count; they never make the run incomplete
        exclusionCount: run.exclusions.length,
        exclusions: run.exclusions.map((x) => ({ tenantId: x.tenantId, bizId: x.bizId, businessDate: x.businessDate, reason: x.reason })),
        successCount: sentCount,
        alreadyAcceptedCount,
        inProgressCount,
        failureCount,
        unknownCount,
        unrecordedCount,
        skippedCount,
        heldCount,
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
      const heldReply = (code: string | null) => {
        console.warn("[daily-snapshot] manual send held", { tenantId, bizId, code });
        return res.status(503).json({ error: "Daily delivery is held; email not sent", code: boundedCode(code) ?? "delivery_held", tenantId, bizId });
      };
      // G2 (HR1): a manual send requested while the Daily is held is refused before the build (the notice read is unaffected)
      if (action === undefined) {
        const g2 = await readManualDeliveryGate(db);
        if (!g2.open) return heldReply(g2.code);
      }

      // the pre-send identity gate (G4 / G10 / control characters): resolved before any business-scoped path is built
      const target = await readDeliveryTarget(db, tenantId, bizId);

      // action: "notice" — the owner-authorized read of the in-app notice for this business (same authorization as a manual
      // send: owner / super_owner of the tenant, through requireBizContext). Nothing is sent. A notice whose cause is gone
      // (the name is present again) is removed on read; a target that is not deliverable for another reason is reported as such.
      if (action === "notice") {
        const reply = (ok: boolean, error: string | null, noticeState: NoticeState, clearState: ClearState, notice: DeliveryNotice | null) => {
          if (!ok) console.warn("[daily-snapshot] notice state unavailable", { tenantId, bizId, noticeState, clearState });
          const deliverable = target.state === "unavailable" ? null : target.state === "deliverable";
          return res.status(ok ? 200 : 503).json({ status: ok ? "ok" : "unavailable", ...(error === null ? {} : { error }),
            tenantId, bizId, deliverable, code: target.code, notice, noticeState, clearState });
        };
        // 1. the business / name state: unknown when the registry could not be read — the store is not consulted
        if (target.state === "unavailable") return reply(false, NOTICE_UNAVAILABLE.registry, "unavailable", "not_attempted", null);
        // 2. the notice store state: read, never manufactured
        const stored: DeliveryNoticeState = await readDeliveryNoticeState(db, tenantId, bizId);
        if (stored.state === "unavailable") return reply(false, NOTICE_UNAVAILABLE.read, "unavailable", "not_attempted", null);
        const record = stored.state === "present" ? stored.record : null;
        // 3. the cause persists: the stored notice (if any) is active; the business state alone blocks the Daily
        if (target.state === "name_unavailable") return reply(true, null, stored.state === "present" ? "active" : "none", "not_applicable", record);
        // 4. the business is not deliverable for another reason: a stored notice is stale but is not touched (no healthy state was confirmed)
        if (target.state !== "deliverable") return reply(true, null, stored.state === "present" ? "stale" : "none", "not_applicable", record);
        // 5. the name is present again: a stored notice is removed; "cleared" is claimed only once the removal is acknowledged
        if (stored.state === "absent") return reply(true, null, "none", "not_needed", null);
        const cleared = await clearDeliveryNotice(db, tenantId, bizId);
        return cleared ? reply(true, null, "none", "cleared", null) : reply(false, NOTICE_UNAVAILABLE.clear, "stale", "failed", record);
      }

      if (target.state !== "deliverable") return refuse(target.code);

      let snapshot: Awaited<ReturnType<typeof buildSnapshotForBiz>>;
      try { snapshot = await buildSnapshotForBiz(tenantId, bizId); }
      catch (error) {
        // the error is untrusted (D4): only its class is logged; the refusal is the code the builder attributed (provenance marker), else a build failure
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

      // HR1: the final boundary (G3) and the durable manual-attempt record, written BEFORE the hand-off
      const r = await deliverManualDaily({ db, tenantId, bizId, businessDate: snapshot.date ?? null, recipient: ownerEmail,
        recipientSelection: recipient.selection, actorRole: snapshotCtx.role, send: () => sendSnapshotEmail(ownerEmail, snapshot) });
      if (r.record === "write_failed") console.error(`[daily-snapshot] manual attempt record not finalized (${boundedCode(r.code) ?? "accepted"}) for ${tenantId}:${bizId}`);
      if (r.outcome === "held") return heldReply(r.code);
      if (r.outcome === "failed" && r.code === "manual_record_unavailable") return res.status(503).json({ error: "Delivery record unavailable; email not sent", code: r.code, tenantId, bizId });
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
