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
 *
 * NOTE: this endpoint also hosts an ISOLATED, read-only POS diagnostic branch
 * (POST { action: "beecomm_diagnose", date }) — folded here only to avoid
 * adding a new Vercel Serverless Function (Hobby plan 12-function cap). The
 * branch has its own strict Bearer-CRON_SECRET check, does NOT honor
 * x-vercel-cron, early-returns before any cron/build/save/RTDB logic, and
 * never persists anything. It does not touch the analytics builder logic.
 */

import { VercelRequest, VercelResponse } from "@vercel/node";
import {
  buildAnalyticsForBiz,
  buildAnalyticsForAll,
  saveAnalyticsDoc,
  yesterdayInIsrael,
} from "../../src/analytics/dailyBuilder.js";
import { fetchBeecommDaily } from "../../lib/analytics/sources.js";

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

  // ── POS Ingestion — Beecomm READ-ONLY diagnostic branch (Phase 1B) ─────────
  // Isolated and early-returning. Enters ONLY on POST + explicit action.
  // Uses its OWN strict Bearer-CRON_SECRET check (does NOT honor x-vercel-cron,
  // no bypass). Read-only: calls fetchBeecommDaily only; no buildDailyDoc, no
  // buildAnalyticsForAll/Biz, no saveAnalyticsDoc, no weather/oref/calendar, no
  // RTDB write, no raw/normalized/import-log persistence. Returns before all
  // normal cron/backfill logic below.
  if (req.method === "POST" && (req.body as { action?: string } | undefined)?.action === "beecomm_diagnose") {
    const cronSecret = process.env.CRON_SECRET;
    if (!cronSecret) {
      return res.status(401).json({ error: "unauthorized_cron_secret_not_configured" });
    }
    const authHeader = (req.headers.authorization as string) || "";
    if (authHeader !== `Bearer ${cronSecret}`) {
      return res.status(401).json({ error: "unauthorized" });
    }

    // Config presence only — never expose the value.
    if (!process.env.BEECOMM_API_KEY) {
      return res.status(412).json({ success: false, error: "missing_beecomm_config" });
    }

    const date = ((req.body as { date?: string } | undefined)?.date as string) || "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ success: false, error: "invalid_date_format" });
    }

    // Generic event log only — no payload, no headers, no secret.
    console.log("[analytics/daily-builder] beecomm_diagnose request", { businessDate: date });

    const started = Date.now();
    let report: {
      revenue_total: number | null;
      tickets: number | null;
      revenue_dine_in: number | null;
      revenue_delivery: number | null;
      revenue_takeaway: number | null;
      hourly: Record<string, number> | null;
    };

    try {
      report = await fetchBeecommDaily(date);
    } catch (e: any) {
      // fetchBeecommDaily throws { source, reason } — already sanitized (no payload).
      const reason = typeof e?.reason === "string" ? e.reason : "unknown";
      return res.status(200).json({
        success: false,
        durationMs: Date.now() - started,
        businessDate: date,
        sourceSystem: "beecomm",
        error: reason, // "timeout" | "network" | "http_401" | "http_404" | ...
      });
    }

    const durationMs = Date.now() - started;
    const has = (v: unknown) => v !== null && v !== undefined;
    const hourlyKeys = report.hourly ? Object.keys(report.hourly) : [];
    const hourlyNonZero = report.hourly
      ? Object.values(report.hourly).filter((v) => Number(v) > 0).length
      : 0;

    const fieldPresence = {
      revenueTotal: has(report.revenue_total),
      tickets: has(report.tickets),
      channels: {
        dineIn: has(report.revenue_dine_in),
        delivery: has(report.revenue_delivery),
        takeaway: has(report.revenue_takeaway),
      },
      hourly: hourlyKeys.length > 0,
      items: false, // daily-summary does not provide item-level
    };

    const missingFields: string[] = [];
    if (!fieldPresence.revenueTotal) missingFields.push("revenueTotal");
    if (!fieldPresence.tickets) missingFields.push("tickets");
    if (!fieldPresence.channels.dineIn) missingFields.push("channels.dineIn");
    if (!fieldPresence.channels.delivery) missingFields.push("channels.delivery");
    if (!fieldPresence.channels.takeaway) missingFields.push("channels.takeaway");
    if (!fieldPresence.hourly) missingFields.push("hourly");
    missingFields.push("items"); // expected missing in daily-summary

    const revenueTotal = report.revenue_total;
    const tickets = report.tickets;
    const avgCheck =
      has(revenueTotal) && has(tickets) && (tickets as number) > 0
        ? Math.round(((revenueTotal as number) / (tickets as number)) * 100) / 100
        : null;

    const normalizedPreview = {
      sourceSystem: "beecomm",
      businessDate: date,
      revenueTotal,
      tickets,
      avgCheck, // computed, not from POS
      channels: {
        dineIn: report.revenue_dine_in,
        delivery: report.revenue_delivery,
        takeaway: report.revenue_takeaway,
      },
      hourlyBucketsPresent: hourlyKeys.length,
      hourlyBucketsNonZero: hourlyNonZero,
      items: null, // future-ready; not provided by daily-summary
      schemaVersion: "1.0.0",
    };

    return res.status(200).json({
      success: true,
      durationMs,
      businessDate: date,
      sourceSystem: "beecomm",
      fieldPresence,
      normalizedPreview,
      missingFields,
      error: null,
    });
  }

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
