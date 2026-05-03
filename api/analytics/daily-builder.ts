/**
 * Daily analytics-builder cron endpoint.
 *
 * Schedule (vercel.json): "0 23 * * *" UTC = 02:00 IST.
 * Runs after midnight Israel time, captures *yesterday's* feature doc per
 * active business (revenue + weather + oref + calendar + war-day status),
 * and persists to:
 *   tenants/{tenantId}/biz:{bizId}:analytics:daily:{YYYY-MM-DD}
 *
 * GET  → cron trigger (all active businesses, yesterday's date).
 * POST → manual trigger { tenantId, bizId, date? } for backfills / testing.
 *
 * Auth identical to /api/daily-snapshot/run: Vercel cron header OR
 * `Authorization: Bearer ${CRON_SECRET}`.
 */

import { VercelRequest, VercelResponse } from "@vercel/node";
import {
  buildAnalyticsForBiz,
  buildAnalyticsForAll,
  saveAnalyticsDoc,
  yesterdayInIsrael,
} from "../../src/analytics/dailyBuilder.js";

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
  if (req.headers["x-vercel-cron"]) return true;

  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    console.warn("[analytics/daily-builder] CRON_SECRET not configured");
    return false;
  }

  const authHeader = (req.headers.authorization as string) || "";
  const [scheme, token] = authHeader.split(" ");
  return scheme === "Bearer" && token === cronSecret;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCorsHeaders(req, res);

  if (req.method === "OPTIONS") return res.status(200).end();
  if (!verifyAuth(req)) return res.status(401).json({ error: "Unauthorized" });

  try {
    // GET = cron trigger: yesterday's data for every active biz.
    if (req.method === "GET") {
      const date = yesterdayInIsrael();
      const { docs, failures } = await buildAnalyticsForAll(date);

      return res.status(200).json({
        status: "completed",
        date,
        totalBusinesses: docs.length + failures.length,
        successCount: docs.length,
        failureCount: failures.length,
        failures: failures.length > 0 ? failures : undefined,
        // Light summary so the cron run is auditable from logs without
        // dumping the full feature doc.
        summary: docs.map((d) => ({
          tenantId: d.tenantId,
          bizId: d.bizId,
          bizName: d.bizName,
          revenue_total: d.revenue.total,
          had_entry: d.revenue.had_entry,
          rain_mm: d.weather?.rain_mm ?? null,
          alert_count: d.alerts?.alert_count ?? null,
          war_day: d.operational.war_day,
        })),
      });
    }

    // POST = manual: backfill a specific (tenant, biz, date).
    if (req.method === "POST") {
      const { tenantId, bizId, date } = (req.body || {}) as {
        tenantId?: string;
        bizId?: string;
        date?: string;
      };

      if (!tenantId || !bizId) {
        return res.status(400).json({ error: "Missing tenantId or bizId" });
      }
      const targetDate = date || yesterdayInIsrael();
      // Sanity-check the format so we don't write garbage paths.
      if (!/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) {
        return res.status(400).json({ error: "date must be YYYY-MM-DD" });
      }

      const doc = await buildAnalyticsForBiz(tenantId, bizId, targetDate);
      await saveAnalyticsDoc(doc);

      return res.status(200).json({
        status: "success",
        path: `tenants/${tenantId}/biz:${bizId}:analytics:daily:${targetDate}`,
        doc,
      });
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (error) {
    console.error("[analytics/daily-builder] error:", error);
    return res.status(500).json({
      error: "Internal server error",
      message: String((error as Error)?.message ?? error),
    });
  }
}
