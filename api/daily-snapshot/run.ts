import { VercelRequest, VercelResponse } from "@vercel/node";
import { getDb } from "../../src/firebase/admin.js";
import { buildSnapshotForBiz, buildSnapshotForAll } from "../../src/snapshot/snapshotBuilder.js";
import { sendSnapshotEmail } from "../../src/snapshot/snapshotEmail.js";
import { requireCron, requireBizContext } from "../../lib/securityContext.js";
import { deliverWithReceipt, deliverWithoutReceipt, DAILY_SNAPSHOT_KIND } from "../../lib/emailDelivery.js";

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
type RecipientResult = { ok: true; email: string } | { ok: false; code: "no_recipient" | "recipient_unavailable" };
async function resolveOwnerRecipient(tenantId: string): Promise<RecipientResult> {
  const db = getDb();

  let usersData: unknown;
  try {
    const usersSnap = await db.ref(`tenants/${tenantId}/app/users`).once("value");
    usersData = usersSnap.val();
  } catch (error) {
    console.error(`[daily-snapshot] recipient read failed for tenant ${tenantId}: ${(error as any)?.code ?? "read_error"}`);
    return { ok: false, code: "recipient_unavailable" };
  }

  if (!usersData) return { ok: false, code: "no_recipient" };

  let users: Array<{ name: string; email: string; role: string }> = [];

  if (typeof usersData === "string") {
    try {
      users = JSON.parse(usersData);
    } catch {
      return { ok: false, code: "recipient_unavailable" };
    }
  } else if ((usersData as any)._v && typeof (usersData as any)._v === "string") {
    try {
      users = JSON.parse((usersData as any)._v);
    } catch {
      return { ok: false, code: "recipient_unavailable" };
    }
  } else if (Array.isArray(usersData)) {
    users = usersData;
  }
  if (!Array.isArray(users)) return { ok: false, code: "recipient_unavailable" };

  // Find owner or super_owner
  const owner = users.find((u) => u && (u.role === "owner" || u.role === "super_owner"));
  if (owner && owner.email && !owner.email.endsWith("@temp.marjin.app")) {
    return { ok: true, email: owner.email };
  }

  // Fallback to first user with email
  const firstWithEmail = users.find((u) => u && u.email && !u.email.endsWith("@temp.marjin.app"));
  if (firstWithEmail) {
    return { ok: true, email: firstWithEmail.email };
  }

  return { ok: false, code: "no_recipient" };
}

function isUnknownBusinessName(value?: string | null): boolean {
  const name = value?.trim();
  return !name || name === "Unknown";
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
      type Row = { tenantId: string; bizId: string; businessDate: string | null; outcome: string; code: string | null; attempt?: number; receipt?: string };
      const results: Row[] = [];

      for (const snapshot of snapshots) {
        const base = { tenantId: snapshot.tenantId, bizId: snapshot.bizId, businessDate: snapshot.date ?? null };
        if (isUnknownBusinessName(snapshot.bizName)) {
          console.warn("[daily-snapshot] skipping snapshot email for unknown business", {
            tenantId: snapshot.tenantId,
            bizId: snapshot.bizId,
            reason: "unknown_business_name",
          });
          results.push({ ...base, outcome: "skipped", code: "unknown_business_name" });
          continue;
        }

        const recipient = await resolveOwnerRecipient(snapshot.tenantId);
        if (!recipient.ok) {
          console.warn(`[daily-snapshot] no deliverable recipient for ${snapshot.tenantId}:${snapshot.bizId} (${recipient.code})`);
          results.push({ ...base, outcome: "failed", code: recipient.code });
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
        if (r.outcome !== "accepted" && !(r.outcome === "skipped" && (r.code === "already_accepted" || r.code === "in_progress"))) {
          console.error(`[daily-snapshot] delivery ${r.outcome} for ${snapshot.tenantId}:${snapshot.bizId}:${snapshot.date} code=${r.code} attempt=${r.attempt ?? "-"} receipt=${r.receipt}`);
        }
        results.push({ ...base, outcome: r.outcome, code: r.code, attempt: r.attempt, receipt: r.receipt });
      }

      const count = (pred: (x: Row) => boolean) => results.filter(pred).length;
      const sentCount = count((x) => x.outcome === "accepted");
      const alreadyAcceptedCount = count((x) => x.outcome === "skipped" && x.code === "already_accepted");
      const inProgressCount = count((x) => x.outcome === "skipped" && x.code === "in_progress");
      const unknownCount = count((x) => x.outcome === "unknown" || (x.outcome === "skipped" && x.code === "unknown_requires_reconciliation"));
      const failureCount = count((x) => x.outcome === "failed" || (x.outcome === "skipped" && (x.code === "failed_final" || x.code === "receipt_unreadable" || x.code === "claim_not_confirmed")));
      const skippedCount = count((x) => x.outcome === "skipped" && x.code === "unknown_business_name");
      const receiptWriteFailures = count((x) => x.receipt === "write_failed" || x.receipt === "unavailable");
      const clean = failureCount === 0 && unknownCount === 0 && receiptWriteFailures === 0;

      // A run with any undelivered, ambiguous or unrecorded message is NOT reported as success to the scheduler.
      return res.status(clean ? 200 : 500).json({
        status: clean ? "completed" : "completed_with_failures",
        totalSnapshots: snapshots.length,
        successCount: sentCount,
        alreadyAcceptedCount,
        inProgressCount,
        failureCount,
        unknownCount,
        skippedCount,
        receiptWriteFailures,
        results,
      });
    }

    // POST = manual trigger for single business (authorized above). A manual send is an explicit owner request: it is not
    // de-duplicated against the scheduled receipt, but its provider outcome is classified (never a false success).
    if (req.method === "POST" && snapshotCtx) {
      const { tenantId, bizId } = snapshotCtx;

      const snapshot = await buildSnapshotForBiz(tenantId, bizId);
      if (isUnknownBusinessName(snapshot.bizName)) {
        console.warn("[daily-snapshot] refusing to email snapshot for unknown business", {
          tenantId,
          bizId,
          reason: "unknown_business_name",
        });
        return res.status(422).json({
          error: "Unknown business snapshot; email not sent",
          tenantId,
          bizId,
        });
      }

      const recipient = await resolveOwnerRecipient(tenantId);

      if (!recipient.ok) {
        return recipient.code === "no_recipient"
          ? res.status(404).json({ error: "No owner email found for this tenant" })
          : res.status(503).json({ error: "Owner email temporarily unavailable", code: recipient.code });
      }
      const ownerEmail = recipient.email;

      const r = await deliverWithoutReceipt({ recipient: ownerEmail, send: () => sendSnapshotEmail(ownerEmail, snapshot) });
      if (r.outcome === "failed") return res.status(502).json({ error: "email_not_sent", code: r.code });
      if (r.outcome !== "accepted") return res.status(504).json({ error: "email_outcome_unknown", code: r.code });

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
        emailSentTo: ownerEmail,
      });
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (error) {
    console.error(`[daily-snapshot] run failed: ${String((error as any)?.name ?? "Error")}: ${String((error as any)?.message ?? "").slice(0, 200)}`);
    return res.status(500).json({
      error: "Internal server error",
    });
  }
}
