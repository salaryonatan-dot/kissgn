/**
 * POS Ingestion — Beecomm READ-ONLY diagnostic endpoint (Phase 1B).
 *
 * Purpose: verify that a live Beecomm daily-summary can be fetched and mapped
 * to Marjin's NormalizedSalesReport — WITHOUT persisting anything.
 *
 * HARD GUARANTEES (by design):
 *   - Read-only. No RTDB / DB writes. No raw payload storage. No normalized
 *     report storage. No import log. No effect on entries / cron / frontend.
 *   - Uses only process.env.BEECOMM_API_KEY (via the existing fetchBeecommDaily).
 *     The secret is never printed, returned, or stored.
 *   - CRON_SECRET-gated (Vercel cron header OR Authorization: Bearer). Not a
 *     public/browser endpoint.
 *
 * Auth: identical pattern to api/proactive/run.ts and api/analytics/daily-builder.ts.
 * Method: POST { date: "YYYY-MM-DD" }.  (bizId / branchRef accepted but NOT used
 *         yet — no real per-branch mapping exists; reserved for a later phase.)
 */

import { VercelRequest, VercelResponse } from "@vercel/node";
import { fetchBeecommDaily } from "../../lib/analytics/sources.js";

const CRON_SECRET = process.env.CRON_SECRET;

// YYYY-MM-DD, minimal sanity check (no time component, real-ish date shape).
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // ── Auth: ALWAYS require Bearer CRON_SECRET. Manual diagnostic endpoint —
  // intentionally does NOT honor the x-vercel-cron header (no bypass). ────────
  const authHeader = (req.headers.authorization as string) || "";
  if (!CRON_SECRET) {
    return res.status(401).json({ error: "unauthorized_cron_secret_not_configured" });
  }
  if (authHeader !== `Bearer ${CRON_SECRET}`) {
    return res.status(401).json({ error: "unauthorized" });
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "method_not_allowed" });
  }

  // ── Config presence: never expose the value, only whether it exists. ───────
  if (!process.env.BEECOMM_API_KEY) {
    return res.status(412).json({ success: false, error: "missing_beecomm_config" });
  }

  // ── Input ──────────────────────────────────────────────────────────────────
  const date = (req.body?.date as string) || "";
  // bizId / branchRef are intentionally accepted but unused (no real mapping yet).
  if (!DATE_RE.test(date)) {
    return res.status(400).json({ success: false, error: "invalid_date_format" });
  }

  // Generic event log only — no payload, no headers, no secret.
  console.log("[pos/beecomm-diagnose] request", { businessDate: date });

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
    const durationMs = Date.now() - started;
    return res.status(200).json({
      success: false,
      durationMs,
      businessDate: date,
      sourceSystem: "beecomm",
      error: reason, // e.g. "timeout" | "network" | "http_401" | "http_404"
    });
  }

  const durationMs = Date.now() - started;

  // ── Field presence (booleans only) ─────────────────────────────────────────
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
    items: false, // daily-summary endpoint does not provide item-level
  };

  const missingFields: string[] = [];
  if (!fieldPresence.revenueTotal) missingFields.push("revenueTotal");
  if (!fieldPresence.tickets) missingFields.push("tickets");
  if (!fieldPresence.channels.dineIn) missingFields.push("channels.dineIn");
  if (!fieldPresence.channels.delivery) missingFields.push("channels.delivery");
  if (!fieldPresence.channels.takeaway) missingFields.push("channels.takeaway");
  if (!fieldPresence.hourly) missingFields.push("hourly");
  missingFields.push("items"); // expected missing in daily-summary

  // ── Normalized preview — general totals only, NO raw payload ───────────────
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
