// Marjin AI — Proactive Insights Endpoint (Combined)
// Handles both: cron/scan operations AND dashboard insights retrieval.
// Route by query param: ?action=insights → dashboard, otherwise → cron/scan.

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { runProactiveJob, runForBiz } from "../../src/agent/proactive/runProactiveJob.js";
import { getTopActiveInsights } from "../../src/agent/proactive/getTopActiveInsights.js";
import { buildWeeklySummary } from "../../src/agent/proactive/digestBuilder.js";
import { tenantRef } from "../../src/firebase/refs.js";
import { getDb } from "../../src/firebase/admin.js";
import { requireBizContext, requireCron } from "../../lib/securityContext.js";
import { handleProactiveRead } from "../../lib/proactiveCore.js";


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
  // Reject unsupported methods before any authorization or side effect.
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // GET = full scan (scheduled cron): authorized ONLY by a server-verified
  // `Authorization: Bearer ${CRON_SECRET}` (centralized requireCron).
  // x-vercel-cron is never accepted.
  if (req.method === "GET") {
    try {
      requireCron(req);
    } catch (e: any) {
      return res.status(e?.status ?? 401).json({ error: e?.msg ?? "unauthorized" });
    }
    try {
      const summary = await runProactiveJob();
      return res.status(200).json({ ok: true, summary });
    } catch (err: any) {
      console.error("[Marjin AI] Proactive job failed:", err?.message ?? "unknown");
      return res.status(500).json({
        ok: false,
        error: "Proactive job failed",
        message: err?.message || "Unknown error",
      });
    }
  }

  // POST = single-business manual scan: a VERIFIED owner/super_owner with
  // canonical server-side tenant + business scope. requireBizContext rejects a
  // caller-supplied tenant/biz the user does not own (fail-closed); no
  // client-supplied role or membership can establish authorization.
  const rawTenantId = (req.body as { tenantId?: unknown } | undefined)?.tenantId;
  const rawBizId = (req.body as { bizId?: unknown } | undefined)?.bizId;
  const branchId = (req.body as { branchId?: unknown } | undefined)?.branchId;
  let ctx;
  try {
    ctx = await requireBizContext(req, {
      tenantId: rawTenantId as string,
      bizId: rawBizId as string,
      mode: "write",
    });
  } catch (e: any) {
    return res.status(e?.status ?? 401).json({ error: e?.msg ?? "unauthorized" });
  }
  if (ctx.role !== "owner" && ctx.role !== "super_owner") {
    return res.status(403).json({ error: "owner_role_required" });
  }

  try {
    const result = await runForBiz(ctx.tenantId, ctx.bizId, branchId as string | undefined);
    return res.status(200).json({ ok: true, result });
  } catch (err: any) {
    console.error("[Marjin AI] Proactive job failed:", err?.message ?? "unknown");
    return res.status(500).json({
      ok: false,
      error: "Proactive job failed",
      message: err?.message || "Unknown error",
    });
  }
}
