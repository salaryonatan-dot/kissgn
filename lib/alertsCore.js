// lib/alertsCore.js — /api/alerts/run request core (PR #2A).
//
// Pure control flow with INJECTED dependencies (requireCron, requireBizContext,
// repos). Returns { status, json?, end? }; never touches res. Fully testable
// without firebase. The thin Vercel wrapper (api/alerts/run.ts) injects the real
// requireCron / requireBizContext and the real repository/runner functions.
//
// Dispatch (classifyAlertsRequest) runs first and reaches NO repository:
//   • GET empty query  → cron  (Bearer CRON_SECRET only; x-vercel-cron ignored)
//   • GET both ids      → read  (viewer+),  config=1 → thresholds read
//   • POST run/config/dismiss → write (manager+), body-only ids
//   • anything else     → deterministic 400/401/405
// On ANY denial the DB write / runner / email path is never reached.

import { classifyAlertsRequest, extractScope } from "./apiScope.js";

function errOut(e) {
  const status = e && typeof e.status === "number" ? e.status : 403;
  const msg = e && typeof e.msg === "string" ? e.msg : "forbidden";
  return { status, json: { error: msg } };
}

// Redact ALL execution failures (repository/runner/email/cron) to a stable
// generic response. The real error is preserved ONLY via the injected logError
// (server-side). Never expose firebase/SMTP/provider/DB paths, stack traces, or
// raw exception messages to the caller.
function internalError(logError, where, err) {
  if (typeof logError === "function") { try { logError(where, err); } catch (_) { /* logging must never leak */ } }
  return { status: 500, json: { ok: false, error: "internal_error" } };
}

export async function handleAlerts(req, deps) {
  const { requireCron, requireBizContext, repos, logError } = deps || {};
  const cls = classifyAlertsRequest(req);

  if (cls.mode === "options") return { status: 204, end: true };
  if (cls.mode === "error") return { status: cls.status, json: { error: cls.msg } };

  // ── Cron branch — Bearer CRON_SECRET only (requireCron). ──
  if (cls.mode === "cron") {
    try {
      requireCron(req);
    } catch (e) {
      return errOut(e);
    }
    try {
      const results = await repos.runAlertsForAll();
      const totalFired = results.reduce((s, r) => s + r.alertsFired, 0);
      const totalEmails = results.filter((r) => r.emailSent).length;
      return {
        status: 200,
        json: {
          ok: true,
          businessesChecked: results.length,
          totalAlertsFired: totalFired,
          totalEmailsSent: totalEmails,
          results,
        },
      };
    } catch (err) {
      return internalError(logError, "cron:runAlertsForAll", err);
    }
  }

  // ── User read branch — viewer+ within an authorized business. ──
  if (cls.mode === "read") {
    let scope;
    try {
      scope = extractScope(req, { source: "query" });
    } catch (e) {
      return errOut(e);
    }
    try {
      await requireBizContext(req, { tenantId: scope.tenantId, bizId: scope.bizId, mode: "read" });
    } catch (e) {
      return errOut(e);
    }
    if (cls.read === "config") {
      try {
        const thresholds = await repos.getThresholds(scope.tenantId, scope.bizId);
        return { status: 200, json: { ok: true, thresholds } };
      } catch (err) {
        return internalError(logError, "read:getThresholds", err);
      }
    }
    try {
      const alerts = await repos.getActiveAlerts(scope.tenantId, scope.bizId);
      const thresholds = await repos.getThresholds(scope.tenantId, scope.bizId);
      const sev = { critical: 0, warning: 1, info: 2 };
      const sorted = alerts.slice().sort((a, b) => (sev[a.severity] ?? 2) - (sev[b.severity] ?? 2));
      return { status: 200, json: { ok: true, alerts: sorted, thresholds } };
    } catch (err) {
      return internalError(logError, "read:getActiveAlerts", err);
    }
  }

  // ── User write branch — manager+ within an authorized business. ──
  if (cls.mode === "write") {
    let scope;
    try {
      scope = extractScope(req, { source: "body" });
    } catch (e) {
      return errOut(e);
    }
    try {
      await requireBizContext(req, { tenantId: scope.tenantId, bizId: scope.bizId, mode: "write" });
    } catch (e) {
      return errOut(e);
    }
    const body = req.body || {};
    if (cls.action === "run") {
      try {
        const result = await repos.runAlertsForBiz(scope.tenantId, scope.bizId);
        return { status: 200, json: { ok: true, result } };
      } catch (err) {
        return internalError(logError, "write:runAlertsForBiz", err);
      }
    }
    if (cls.action === "config") {
      if (!body.thresholds || typeof body.thresholds !== "object") {
        return { status: 400, json: { error: "Missing thresholds" } };
      }
      try {
        await repos.saveThresholds(scope.tenantId, scope.bizId, body.thresholds);
        const updated = await repos.getThresholds(scope.tenantId, scope.bizId);
        return { status: 200, json: { ok: true, thresholds: updated } };
      } catch (err) {
        return internalError(logError, "write:saveThresholds", err);
      }
    }
    if (cls.action === "dismiss") {
      if (!body.alertId || typeof body.alertId !== "string") {
        return { status: 400, json: { error: "Missing alertId" } };
      }
      try {
        await repos.dismissAlert(scope.tenantId, scope.bizId, body.alertId);
        return { status: 200, json: { ok: true } };
      } catch (err) {
        return internalError(logError, "write:dismissAlert", err);
      }
    }
  }

  return { status: 500, json: { ok: false, error: "internal_error" } };
}
