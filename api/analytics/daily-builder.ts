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
 * POST → user action { action:"rebuild_after_entry_save", tenantId, bizId, date }.
 *
 * Auth:
 * - GET and legacy manual/backfill POST paths use the Vercel cron header OR
 *   `Authorization: Bearer ${CRON_SECRET}`.
 * - POST { action:"rebuild_after_entry_save", ... } uses Firebase user auth
 *   plus tenant/business RBAC.
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
  buildAndSaveInsights,
  yesterdayInIsrael,
} from "../../src/analytics/dailyBuilder.js";
import { fetchBeecommDaily } from "../../lib/analytics/sources.js";
import { getAdminDb } from "../../lib/adminSdk.js";
import { requireAuth } from "../../lib/verifyToken.js";
import { requireTenantAccess, isRateLimited } from "../../lib/helpers.js";

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

type AppBusiness = {
  id?: string;
  name?: string;
  active?: boolean;
  inactive?: boolean;
  disabled?: boolean;
  deleted?: boolean;
  archived?: boolean;
  status?: string;
};

type AppUser = {
  uid?: string;
  firebaseUid?: string;
  role?: string;
  allowedBizIds?: unknown;
};

function isSafeId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value.trim());
}

function isRealBusinessDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const utc = Date.UTC(year, month - 1, day);
  if (!Number.isFinite(utc)) return false;
  return new Date(utc).toISOString().slice(0, 10) === value;
}

function unwrapEnvelope<T>(value: unknown, fallback: T): T {
  if (value == null) return fallback;
  if (typeof value === "string") {
    try { return JSON.parse(value) as T; } catch { return fallback; }
  }
  if (typeof value === "object" && "_v" in (value as Record<string, unknown>)) {
    const wrapped = (value as { _v?: unknown })._v;
    if (typeof wrapped === "string") {
      try { return JSON.parse(wrapped) as T; } catch { return fallback; }
    }
  }
  return value as T;
}

function isExplicitlyInactive(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  if (record.active === false) return true;
  if (record.inactive === true || record.disabled === true || record.deleted === true || record.archived === true) {
    return true;
  }
  if (typeof record.status === "string") {
    return ["inactive", "disabled", "deleted", "archived"].includes(record.status.trim().toLowerCase());
  }
  return false;
}

function findBusiness(rawBusiness: unknown, bizId: string): AppBusiness | null {
  const data = unwrapEnvelope<unknown>(rawBusiness, null);
  if (Array.isArray(data)) {
    return (data.find((b) => b && typeof b === "object" && (b as AppBusiness).id === bizId) as AppBusiness | undefined) || null;
  }
  if (data && typeof data === "object") {
    const record = data as Record<string, unknown>;
    const direct = record[bizId];
    if (direct && typeof direct === "object") return direct as AppBusiness;
    for (const value of Object.values(record)) {
      if (value && typeof value === "object" && (value as AppBusiness).id === bizId) {
        return value as AppBusiness;
      }
    }
  }
  return null;
}

function parseAppUsers(rawUsers: unknown): AppUser[] {
  const data = unwrapEnvelope<unknown>(rawUsers, []);
  if (Array.isArray(data)) return data.filter((u): u is AppUser => !!u && typeof u === "object");
  if (data && typeof data === "object") {
    return Object.values(data).filter((u): u is AppUser => !!u && typeof u === "object");
  }
  return [];
}

function hasBusinessAccess(role: string, uid: string, users: AppUser[], bizId: string): boolean {
  if (role === "owner" || role === "super_owner") return true;
  const user = users.find((u) => u.firebaseUid === uid || u.uid === uid);
  const rawAllowed = user?.allowedBizIds;
  const allowed = Array.isArray(rawAllowed)
    ? rawAllowed.filter((id): id is string => typeof id === "string")
    : [];
  return allowed.includes(bizId);
}

function validInsightsReadback(value: unknown, tenantId: string, bizId: string, date: string, rebuildStartedAt: number): boolean {
  if (!value || typeof value !== "object") return false;
  const doc = value as Record<string, unknown>;
  return doc.tenantId === tenantId &&
    doc.bizId === bizId &&
    doc.date === date &&
    doc.engineVersion === "insights-v1" &&
    typeof doc.generatedAt === "number" &&
    doc.generatedAt >= rebuildStartedAt;
}

// ── Analytics-rebuild rate limiter: bounded module-local fallback ───────────
// The authenticated rebuild_after_entry_save branch normally uses the shared
// remote limiter (lib/helpers.isRateLimited). When that limiter is UNAVAILABLE
// (returns null/undefined or throws inside the limiter call), we fall back to a
// bounded in-process sliding-window limiter with the SAME key and policy, so a
// limiter outage cannot leave insights un-rebuilt after a save. A remote
// decision (true = limited / false = allowed) is always honored and is never
// overridden by the fallback. Only a failure of the limiter CALL triggers the
// fallback; errors elsewhere in the handler are never treated as limiter faults.
const ANALYTICS_REBUILD_RL_MAX_KEYS = 5000;
const analyticsRebuildRlHits: Map<string, number[]> = new Map();

export function analyticsRebuildLocalRateLimit(
  key: string,
  limit: number,
  windowMs: number,
  now: number = Date.now()
): boolean {
  const cutoff = now - windowMs;
  // Prune stale timestamps across all keys so memory stays bounded.
  for (const [k, arr] of analyticsRebuildRlHits) {
    const kept = arr.filter((ts) => ts > cutoff);
    if (kept.length === 0) analyticsRebuildRlHits.delete(k);
    else analyticsRebuildRlHits.set(k, kept);
  }
  // Hard cap on total tracked keys (evict oldest-inserted first).
  if (analyticsRebuildRlHits.size > ANALYTICS_REBUILD_RL_MAX_KEYS) {
    const excess = analyticsRebuildRlHits.size - ANALYTICS_REBUILD_RL_MAX_KEYS;
    let i = 0;
    for (const k of analyticsRebuildRlHits.keys()) {
      if (i++ >= excess) break;
      analyticsRebuildRlHits.delete(k);
    }
  }
  const recent = (analyticsRebuildRlHits.get(key) || []).filter((ts) => ts > cutoff);
  if (recent.length >= limit) {
    analyticsRebuildRlHits.set(key, recent);
    return true; // limited
  }
  recent.push(now);
  analyticsRebuildRlHits.set(key, recent);
  return false; // allowed
}

// Test-only helper to reset the bounded fallback state between cases.
export function __resetAnalyticsRebuildLocalRateLimit(): void {
  analyticsRebuildRlHits.clear();
}

export async function resolveAnalyticsRebuildRateLimit(
  remoteCheck: () => Promise<unknown> | unknown,
  key: string,
  limit: number,
  windowMs: number,
  now: number = Date.now()
): Promise<"allow" | "limited"> {
  try {
    const remote = await remoteCheck();
    if (remote === true) return "limited"; // remote says limited -> honor, no fallback
    if (remote === false) return "allow";  // remote says allowed -> proceed normally
    // any other value (null/undefined/non-boolean) -> limiter unavailable -> fall through
  } catch {
    // limiter CALL threw -> unavailable -> fall through to bounded fallback
  }
  return analyticsRebuildLocalRateLimit(key, limit, windowMs, now) ? "limited" : "allow";
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

  if (req.method === "POST" && (req.body as { action?: string } | undefined)?.action === "rebuild_after_entry_save") {
    try {
      let claims: { uid: string };
      try {
        claims = await requireAuth(req);
      } catch {
        return res.status(401).json({ ok: false, error: "authentication_required" });
      }

      const { tenantId, bizId, date } = (req.body || {}) as {
        tenantId?: unknown;
        bizId?: unknown;
        date?: unknown;
      };

      if (!isSafeId(tenantId) || !isSafeId(bizId)) {
        return res.status(400).json({ ok: false, error: "invalid_tenant_or_biz_id" });
      }

      const safeTenantId = tenantId.trim();
      const safeBizId = bizId.trim();

      if (safeTenantId === safeBizId) {
        return res.status(400).json({ ok: false, error: "invalid_self_business" });
      }

      if (!isRealBusinessDate(date)) {
        return res.status(400).json({ ok: false, error: "date_must_be_real_yyyy_mm_dd" });
      }

      let role: string;
      try {
        role = await requireTenantAccess(claims.uid, safeTenantId, "shift_manager");
      } catch (e: any) {
        return res.status(e?.status || 403).json({ ok: false, error: e?.msg || "access_denied" });
      }

      const analyticsRebuildRateKey = `analytics-rebuild:${claims.uid}:${safeTenantId}:${safeBizId}`;
      const analyticsRebuildRateOutcome = await resolveAnalyticsRebuildRateLimit(
        () => isRateLimited(analyticsRebuildRateKey, 8, 60_000),
        analyticsRebuildRateKey,
        8,
        60_000
      );
      if (analyticsRebuildRateOutcome === "limited") {
        return res.status(429).json({ ok: false, error: "rate_limited" });
      }

      const db = getAdminDb();
      const [businessSnap, usersSnap] = await Promise.all([
        db.ref(`tenants/${safeTenantId}/app/business`).once("value"),
        db.ref(`tenants/${safeTenantId}/app/users`).once("value"),
      ]);

      const business = findBusiness(businessSnap.val(), safeBizId);
      if (!business || isExplicitlyInactive(business)) {
        return res.status(404).json({ ok: false, error: "business_not_found" });
      }

      if (!hasBusinessAccess(role, claims.uid, parseAppUsers(usersSnap.val()), safeBizId)) {
        return res.status(403).json({ ok: false, error: "business_access_denied" });
      }

      const rebuildStartedAt = Date.now();
      const analyticsDoc = await buildAnalyticsForBiz(safeTenantId, safeBizId, date);
      await saveAnalyticsDoc(analyticsDoc);
      await buildAndSaveInsights(safeTenantId, safeBizId, date, analyticsDoc);

      const insightsPath = `tenants/${safeTenantId}/biz:${safeBizId}:insights:daily:${date}`;
      const insightsSnap = await db.ref(insightsPath).once("value");
      const insightsDoc = insightsSnap.val();
      if (!validInsightsReadback(insightsDoc, safeTenantId, safeBizId, date, rebuildStartedAt)) {
        return res.status(502).json({ ok: false, error: "insights_rebuild_not_confirmed" });
      }

      return res.status(200).json({
        ok: true,
        status: "success",
        action: "rebuild_after_entry_save",
        date,
        analyticsBuiltAt: analyticsDoc.meta.builtAt,
        insightsGeneratedAt: insightsDoc.generatedAt,
        insightCount: Array.isArray(insightsDoc.insights) ? insightsDoc.insights.length : 0,
      });
    } catch (error) {
      console.error("[analytics/daily-builder] rebuild_after_entry_save error:", (error as Error)?.message ?? "unknown");
      return res.status(500).json({ ok: false, error: "rebuild_failed" });
    }
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
      // Insight Engine v1 — rebuild insights for this date too (isolated; never throws).
      await buildAndSaveInsights(tenantId, bizId, targetDate, doc);

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
