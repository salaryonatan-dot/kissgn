import { VercelRequest, VercelResponse } from "@vercel/node";
import { getDb } from "../../src/firebase/admin.js";
import { buildSnapshotForBiz, buildSnapshotForAll } from "../../src/snapshot/snapshotBuilder.js";
import { sendSnapshotEmail } from "../../src/snapshot/snapshotEmail.js";
import { requireCron, requireBizContext } from "../../lib/securityContext.js";

function setCorsHeaders(req: VercelRequest, res: VercelResponse): void {
  const origin = (req.headers.origin as string) || "";
  const allowed = ["https://kissgn.vercel.app", "http://localhost:3000"];
  if (allowed.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

async function getOwnerEmail(tenantId: string): Promise<string | null> {
  const db = getDb();

  try {
    const usersSnap = await db.ref(`tenants/${tenantId}/app/users`).once("value");
    const usersData = usersSnap.val();

    if (!usersData) return null;

    let users: Array<{ name: string; email: string; role: string }> = [];

    if (typeof usersData === "string") {
      try {
        users = JSON.parse(usersData);
      } catch {
        return null;
      }
    } else if (usersData._v && typeof usersData._v === "string") {
      try {
        users = JSON.parse(usersData._v);
      } catch {
        return null;
      }
    } else if (Array.isArray(usersData)) {
      users = usersData;
    }

    // Find owner or super_owner
    const owner = users.find((u) => u.role === "owner" || u.role === "super_owner");
    if (owner && owner.email && !owner.email.endsWith("@temp.marjin.app")) {
      return owner.email;
    }

    // Fallback to first user with email
    const firstWithEmail = users.find((u) => u.email && !u.email.endsWith("@temp.marjin.app"));
    if (firstWithEmail) {
      return firstWithEmail.email;
    }

    return null;
  } catch (error) {
    console.error(`Error getting owner email for tenant ${tenantId}:`, error);
    return null;
  }
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

      let successCount = 0;
      let failureCount = 0;
      let skippedCount = 0;
      const failures: Array<{ tenantId: string; bizId: string; error: string }> = [];
      const skipped: Array<{ tenantId: string; bizId: string; reason: string }> = [];

      for (const snapshot of snapshots) {
        try {
          if (isUnknownBusinessName(snapshot.bizName)) {
            console.warn("[daily-snapshot] skipping snapshot email for unknown business", {
              tenantId: snapshot.tenantId,
              bizId: snapshot.bizId,
              reason: "unknown_business_name",
            });
            skippedCount++;
            skipped.push({
              tenantId: snapshot.tenantId,
              bizId: snapshot.bizId,
              reason: "unknown_business_name",
            });
            continue;
          }

          const ownerEmail = await getOwnerEmail(snapshot.tenantId);

          if (!ownerEmail) {
            console.warn(
              `No owner email found for tenant ${snapshot.tenantId}, skipping snapshot email`
            );
            failureCount++;
            failures.push({
              tenantId: snapshot.tenantId,
              bizId: snapshot.bizId,
              error: "No owner email found",
            });
            continue;
          }

          await sendSnapshotEmail(ownerEmail, snapshot);
          successCount++;
        } catch (error) {
          console.error(
            `Error sending snapshot email for ${snapshot.tenantId}:${snapshot.bizId}:`,
            error
          );
          failureCount++;
          failures.push({
            tenantId: snapshot.tenantId,
            bizId: snapshot.bizId,
            error: String(error),
          });
        }
      }

      return res.status(200).json({
        status: "completed",
        totalSnapshots: snapshots.length,
        successCount,
        failureCount,
        skippedCount,
        failures: failures.length > 0 ? failures : undefined,
        skipped: skipped.length > 0 ? skipped : undefined,
      });
    }

    // POST = manual trigger for single business (authorized above).
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

      const ownerEmail = await getOwnerEmail(tenantId);

      if (!ownerEmail) {
        return res.status(404).json({ error: "No owner email found for this tenant" });
      }

      await sendSnapshotEmail(ownerEmail, snapshot);

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
    console.error("Error in daily-snapshot/run:", error);
    return res.status(500).json({
      error: "Internal server error",
      message: String(error),
    });
  }
}
