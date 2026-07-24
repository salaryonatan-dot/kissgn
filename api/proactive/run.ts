// Marjin AI — Proactive Insights Endpoint (Combined)
// Handles both: cron/scan operations AND dashboard insights retrieval.
// Route by query param: ?action=insights → dashboard, otherwise → cron/scan.

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { runProactiveJob, runForBiz } from "../../src/agent/proactive/runProactiveJob.js";
import { getTopActiveInsights } from "../../src/agent/proactive/getTopActiveInsights.js";
import { buildWeeklySummary } from "../../src/agent/proactive/digestBuilder.js";
import { tenantRef } from "../../src/firebase/refs.js";
import { getDb } from "../../src/firebase/admin.js";
import { requireBizContext } from "../../lib/securityContext.js";
import { handleProactiveRead } from "../../lib/proactiveCore.js";

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
    return handleRead(req, res);
  }

  // --- Route: Daily digest retrieval (Phase 2) ---
  if (req.query.action === "digest" && req.method === "GET") {
    return handleRead(req, res);
  }

  // --- Route: Weekly summary (Phase 2) ---
  if (req.query.action === "weekly" && req.method === "GET") {
    return handleRead(req, res);
  }

  // --- Route: Cron / scan (requires auth) ---
  return handleCronScan(req, res);
}

async function handleRead(req: VercelRequest, res: VercelResponse) {
  const repos = {
    tenantExists: async (tenantId: string): Promise<boolean> => {
      const tenantSnap = await tenantRef(tenantId).child("members").once("value");
      return tenantSnap.exists();
    },
    getInsights: getTopActiveInsights,
    getDigest: async (tenantId: string, bizId: string, date: string): Promise<unknown> => {
      const snap = await getDb()
        .ref(`tenants/${tenantId}/proactive_digests/${bizId}/daily/${date}`)
        .once("value");
      return snap.val();
    },
    getWeeklySummary: buildWeeklySummary,
  };
  const out = await handleProactiveRead(req, {
    requireBizContext,
    repos,
    logError: (where: string, err: unknown) => {
      console.error("[Marjin AI] Proactive read failed:", where, (err as { message?: string })?.message ?? err);
    },
  });
  return res.status(out.status).json(out.json);
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
