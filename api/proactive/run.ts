// Marjin AI — Proactive Insights Endpoint (Combined)
// Handles both: cron/scan operations AND dashboard insights retrieval.
// Route by query param: ?action=insights → dashboard, otherwise → cron/scan.

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { runProactiveJob, runForBiz } from "../../src/agent/proactive/runProactiveJob.js";
import { getTopActiveInsights } from "../../src/agent/proactive/getTopActiveInsights.js";
import { buildWeeklySummary } from "../../src/agent/proactive/digestBuilder.js";
import { tenantRef } from "../../src/firebase/refs.js";
import { getDb } from "../../src/firebase/admin.js";

// Shared secret for cron authentication
const CRON_SECRET = process.env.CRON_SECRET;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS
  const origin = req.headers.origin || "";
  const allowed = ["https://kissgn.vercel.app", "http://localhost:3000"];
  if (allowed.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  // --- Route: Dashboard insights retrieval ---
  if (req.query.action === "insights" && req.method === "GET") {
    return handleInsights(req, res);
  }

  // --- Route: Daily digest retrieval (Phase 2) ---
  if (req.query.action === "digest" && req.method === "GET") {
    return handleDigest(req, res);
  }

  // --- Route: Weekly summary (Phase 2) ---
  if (req.query.action === "weekly" && req.method === "GET") {
    return handleWeeklySummary(req, res);
  }

  // --- Route: Cron / scan (requires auth) ---
  return handleCronScan(req, res);
}

/**
 * Dashboard insights retrieval.
 * GET /api/proactive/run?action=insights&tenantId=X&bizId=Y&limit=5
 */
async function handleInsights(req: VercelRequest, res: VercelResponse) {
  const tenantId = req.query.tenantId as string;
  const bizId = req.query.bizId as string;
  const limit = Math.min(Number(req.query.limit) || 5, 10);

  if (!tenantId || !bizId) {
    return res.status(400).json({ error: "Missing tenantId or bizId" });
  }

  try {
    // Verify tenant exists in Firebase
    const tenantSnap = await tenantRef(tenantId).child("config").once("value");
    if (!tenantSnap.exists()) {
      return res.status(404).json({ error: "Tenant not found" });
    }

    const insights = await getTopActiveInsights(tenantId, bizId, limit);
    return res.status(200).json({ ok: true, insights });
  } catch (err: any) {
    console.error("[Marjin AI] Insights retrieval failed:", err);
    return res.status(500).json({
      ok: false,
      insights: [],
      error: "Failed to load insights",
    });
  }
}

/**
 * Daily digest retrieval (Phase 2).
 * GET /api/proactive/run?action=digest&tenantId=X&bizId=Y&date=2026-03-29
 */
async function handleDigest(req: VercelRequest, res: VercelResponse) {
  const tenantId = req.query.tenantId as string;
  const bizId = req.query.bizId as string;
  const date = req.query.date as string; // optional — defaults to today

  if (!tenantId || !bizId) {
    return res.status(400).json({ error: "Missing tenantId or bizId" });
  }

  try {
    // Verify tenant exists
    const tenantSnap = await tenantRef(tenantId).child("config").once("value");
    if (!tenantSnap.exists()) {
      return res.status(404).json({ error: "Tenant not found" });
    }

    const targetDate = date || new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jerusalem" });
    const snap = await getDb()
      .ref(`tenants/${tenantId}/proactive_digests/${bizId}/daily/${targetDate}`)
      .once("value");

    const digest = snap.val();
    if (!digest) {
      return res.status(200).json({ ok: true, digest: null, message: "No digest for this date" });
    }

    return res.status(200).json({ ok: true, digest });
  } catch (err: any) {
    console.error("[Marjin AI] Digest retrieval failed:", err);
    return res.status(500).json({ ok: false, error: "Failed to load digest" });
  }
}

/**
 * Weekly summary (Phase 2).
 * GET /api/proactive/run?action=weekly&tenantId=X&bizId=Y
 */
async function handleWeeklySummary(req: VercelRequest, res: VercelResponse) {
  const tenantId = req.query.tenantId as string;
  const bizId = req.query.bizId as string;

  if (!tenantId || !bizId) {
    return res.status(400).json({ error: "Missing tenantId or bizId" });
  }

  try {
    // Verify tenant exists
    const tenantSnap = await tenantRef(tenantId).child("config").once("value");
    if (!tenantSnap.exists()) {
      return res.status(404).json({ error: "Tenant not found" });
    }

    const summary = await buildWeeklySummary(tenantId, bizId);
    return res.status(200).json({ ok: true, summary });
  } catch (err: any) {
    console.error("[Marjin AI] Weekly summary failed:", err);
    return res.status(500).json({ ok: false, error: "Failed to build weekly summary" });
  }
}

/**
 * Cron scan / manual trigger (requires auth).
 * GET /api/proactive/run → full scan (Vercel cron)
 * POST /api/proactive/run { tenantId, bizId } → single-biz scan
 */
async function handleCronScan(req: VercelRequest, res: VercelResponse) {
  // Auth: either Vercel cron header or CRON_SECRET
  const authHeader = req.headers.authorization;
  const vercelCron = req.headers["x-vercel-cron"];

  if (vercelCron) {
    // Vercel cron — allowed
  } else if (!CRON_SECRET) {
    // CRON_SECRET not configured — reject all non-cron requests
    return res.status(401).json({ error: "Unauthorized — CRON_SECRET not configured" });
  } else if (authHeader !== `Bearer ${CRON_SECRET}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    // Single-biz mode: POST with tenantId + bizId
    if (req.method === "POST" && req.body?.tenantId && req.body?.bizId) {
      const { tenantId, bizId, branchId } = req.body;
      const result = await runForBiz(tenantId, bizId, branchId);
      return res.status(200).json({ ok: true, result });
    }

    // Full scan mode: GET (Vercel cron) or POST without body
    const summary = await runProactiveJob();
    return res.status(200).json({ ok: true, summary });
  } catch (err: any) {
    console.error("[Marjin AI] Proactive job failed:", err);
    return res.status(500).json({
      ok: false,
      error: "Proactive job failed",
      message: err?.message || "Unknown error",
    });
  }
}
