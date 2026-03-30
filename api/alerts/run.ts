// Marjin â Alerts API Endpoint
// Routes:
//   GET  /api/alerts/run?tenantId=X&bizId=Y          â get active alerts
//   GET  /api/alerts/run?tenantId=X&bizId=Y&config=1  â get current thresholds
//   POST /api/alerts/run { action: "run", tenantId, bizId }     â manual trigger
//   POST /api/alerts/run { action: "config", tenantId, bizId, thresholds: {...} }  â update config
//   POST /api/alerts/run { action: "dismiss", tenantId, bizId, alertId }  â dismiss alert
//   GET  /api/alerts/run  (Vercel cron / no params)  â run all businesses

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { runAlertsForBiz, runAlertsForAll } from "../../src/alerts/runner.js";
import { getActiveAlerts, dismissAlert } from "../../src/alerts/alertsRepo.js";
import { getThresholds, saveThresholds } from "../../src/alerts/configRepo.js";

const CRON_SECRET = process.env.CRON_SECRET;
const ALLOWED_ORIGINS = ["https://kissgn.vercel.app", "http://localhost:3000"];

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS
  const origin = req.headers.origin || "";
  if (ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Vary", "Origin");

  if (req.method === "OPTIONS") return res.status(204).end();

  if (req.method === "GET") return handleGet(req, res);
  if (req.method === "POST") return handlePost(req, res);

  return res.status(405).json({ error: "Method not allowed" });
}

// ââ GET âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ

async function handleGet(req: VercelRequest, res: VercelResponse) {
  const tenantId = req.query.tenantId as string;
  const bizId = req.query.bizId as string;

  // No params = cron trigger for all businesses
  if (!tenantId && !bizId) {
    return handleCron(req, res);
  }

  if (!tenantId || !bizId) {
    return res.status(400).json({ error: "Missing tenantId or bizId" });
  }

  // Return config
  if (req.query.config === "1") {
    const thresholds = await getThresholds(tenantId, bizId);
    return res.status(200).json({ ok: true, thresholds });
  }

  // Return active alerts
  try {
    const alerts = await getActiveAlerts(tenantId, bizId);
    const thresholds = await getThresholds(tenantId, bizId);
    return res.status(200).json({
      ok: true,
      alerts: alerts.sort((a, b) => {
        const sev = { critical: 0, warning: 1, info: 2 };
        return (sev[a.severity] ?? 2) - (sev[b.severity] ?? 2);
      }),
      thresholds,
    });
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err.message });
  }
}

// ââ POST ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ

async function handlePost(req: VercelRequest, res: VercelResponse) {
  const { action, tenantId, bizId, alertId, thresholds } = req.body || {};

  if (!action) {
    return res.status(400).json({ error: "Missing action" });
  }

  switch (action) {
    case "run": {
      if (!tenantId || !bizId) {
        return res.status(400).json({ error: "Missing tenantId or bizId" });
      }
      try {
        const result = await runAlertsForBiz(tenantId, bizId);
        return res.status(200).json({ ok: true, result });
      } catch (err: any) {
        return res.status(500).json({ ok: false, error: err.message });
      }
    }

    case "config": {
      if (!tenantId || !bizId || !thresholds) {
        return res.status(400).json({ error: "Missing tenantId, bizId, or thresholds" });
      }
      try {
        await saveThresholds(tenantId, bizId, thresholds);
        const updated = await getThresholds(tenantId, bizId);
        return res.status(200).json({ ok: true, thresholds: updated });
      } catch (err: any) {
        return res.status(500).json({ ok: false, error: err.message });
      }
    }

    case "dismiss": {
      if (!tenantId || !bizId || !alertId) {
        return res.status(400).json({ error: "Missing tenantId, bizId, or alertId" });
      }
      try {
        await dismissAlert(tenantId, bizId, alertId);
        return res.status(200).json({ ok: true });
      } catch (err: any) {
        return res.status(500).json({ ok: false, error: err.message });
      }
    }

    default:
      return res.status(400).json({ error: `Unknown action: ${action}` });
  }
}

// ââ Cron Handler ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ

async function handleCron(req: VercelRequest, res: VercelResponse) {
  const vercelCron = req.headers["x-vercel-cron"];
  const authHeader = req.headers.authorization;

  if (!vercelCron && (!CRON_SECRET || authHeader !== `Bearer ${CRON_SECRET}`)) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const results = await runAlertsForAll();
    const totalFired = results.reduce((s, r) => s + r.alertsFired, 0);
    const totalWhatsapp = results.reduce((s, r) => s + r.whatsappSent, 0);
    return res.status(200).json({
      ok: true,
      businessesChecked: results.length,
      totalAlertsFired: totalFired,
      totalWhatsappSent: totalWhatsapp,
      results,
    });
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err.message });
  }
}
