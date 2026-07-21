// api/alerts/run.ts — thin Vercel adapter (PR #2A).
// CORS + real-dependency injection only; all control flow (dispatch,
// authorization, cron authentication) lives in the behaviorally-tested core
// lib/alertsCore.js. The cron branch authenticates via Bearer CRON_SECRET only
// (requireCron); x-vercel-cron is NOT accepted as authorization. User branches
// (GET read viewer+, POST run/config/dismiss manager+) are biz-authorized.
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { runAlertsForBiz, runAlertsForAll } from "../../src/alerts/runner.js";
import { getActiveAlerts, dismissAlert } from "../../src/alerts/alertsRepo.js";
import { getThresholds, saveThresholds } from "../../src/alerts/configRepo.js";
import { handleAlerts } from "../../lib/alertsCore.js";
import { requireCron, requireBizContext } from "../../lib/securityContext.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const origin = req.headers.origin || "";
  const ALLOWED_ORIGINS = ["https://kissgn.vercel.app", "http://localhost:3000"];
  if (ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Vary", "Origin");

  const repos = { runAlertsForBiz, runAlertsForAll, getActiveAlerts, dismissAlert, getThresholds, saveThresholds };
  const logError = (where: string, err: unknown): void => {
    console.error("[alerts]", where, (err as { message?: string })?.message ?? err);
  };
  const out = await handleAlerts(req, { requireCron, requireBizContext, repos, logError });
  if (out.end) return res.status(out.status).end();
  return res.status(out.status).json(out.json);
}
