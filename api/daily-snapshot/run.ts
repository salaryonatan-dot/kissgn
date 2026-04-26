import { VercelRequest, VercelResponse } from "@vercel/node";
import { getDb } from "../../src/firebase/admin.js";
import { buildSnapshotForBiz, buildSnapshotForAll } from "../../src/snapshot/snapshotBuilder.js";
import { sendSnapshotEmail } from "../../src/snapshot/snapshotEmail.js";

function setCorsHeaders(req: VercelRequest, res: VercelResponse): void {
  const origin = (req.headers.origin as string) || "";
  const allowed = ["https://kissgn.vercel.app", "http://localhost:3000"];
  if (allowed.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

function verifyAuth(req: VercelRequest): boolean {
  // Check for Vercel cron header
  const verelCron = req.headers["x-vercel-cron"];
  if (verelCron) {
    return true;
  }

  // Check for CRON_SECRET Bearer token
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    console.warn("CRON_SECRET not configured");
    return false;
  }

  const authHeader = req.headers.authorization || "";
  const [scheme, token] = authHeader.split(" ");

  if (scheme === "Bearer" && token === cronSecret) {
    return true;
  }

  return false;
}

/**
 * Get the snapshot recipient email for a specific business.
 * Checks `tenants/{tenantId}/snapshot_recipients/{bizId}` first.
 * Falls back to tenant-level owner from `tenants/{tenantId}/app/users`.
 */
async function getRecipientEmail(
  tenantId: string,
  bizId: string
): Promise<string | null> {
  const db = getDb();

  // Priority 1: Business-specific recipient from snapshot_recipients
  try {
    const recipientSnap = await db
      .ref(`tenants/${tenantId}/snapshot_recipients/${bizId}`)
      .once("value");
    const recipientVal = recipientSnap.val();

    if (recipientVal) {
      // Support single email string
      if (typeof recipientVal === "string" && recipientVal.includes("@")) {
        return recipientVal;
      }
      // Support object with email field
      if (typeof recipientVal === "object" && recipientVal.email) {
        return recipientVal.email;
      }
    }
  } catch (error) {
    console.warn(
      `Error reading snapshot_recipients for ${tenantId}/${bizId}:`,
      error
    );
  }

  // Priority 2: Fall back to tenant-level owner (original behavior)
  return getOwnerEmail(tenantId);
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

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCorsHeaders(req, res);

  // Handle OPTIONS
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  // Verify authentication for non-OPTIONS requests
  if (!verifyAuth(req)) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    // GET = cron trigger (run for all businesses)
    if (req.method === "GET") {
      const snapshots = await buildSnapshotForAll();

      let successCount = 0;
      let failureCount = 0;
      const failures: Array<{ tenantId: string; bizId: string; error: string }> = [];

      for (const snapshot of snapshots) {
        try {
          const recipientEmail = await getRecipientEmail(
            snapshot.tenantId,
            snapshot.bizId
          );

          if (!recipientEmail) {
            console.warn(
              `No recipient email found for ${snapshot.tenantId}/${snapshot.bizId}, skipping`
            );
            failureCount++;
            failures.push({
              tenantId: snapshot.tenantId,
              bizId: snapshot.bizId,
              error: "No recipient email found",
            });
            continue;
          }

          await sendSnapshotEmail(recipientEmail, snapshot);
          console.log(
            `[daily-snapshot] Sent ${snapshot.bizName} to ${recipientEmail}`
          );
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
        failures: failures.length > 0 ? failures : undefined,
      });
    }

    // POST = manual trigger for single business
    if (req.method === "POST") {
      const { tenantId, bizId } = req.body;

      if (!tenantId || !bizId) {
        return res.status(400).json({ error: "Missing tenantId or bizId" });
      }

      const snapshot = await buildSnapshotForBiz(tenantId, bizId);
      const recipientEmail = await getRecipientEmail(tenantId, bizId);

      if (!recipientEmail) {
        return res.status(404).json({
          error: "No recipient email found for this business",
        });
      }

      await sendSnapshotEmail(recipientEmail, snapshot);

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
        emailSentTo: recipientEmail,
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
