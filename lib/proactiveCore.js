// lib/proactiveCore.js — authenticated proactive read-route core.
//
// Pure control flow with injected authorization and repositories. This keeps the
// Vercel wrapper thin and lets security tests prove business-scope enforcement
// without Firebase, network, or production data.

import { extractScope } from "./apiScope.js";

const READ_ACTIONS = new Set(["insights", "digest", "weekly"]);
const SAFE_AUTH_MESSAGES = new Set([
  "unauthorized",
  "business_access_denied",
  "role_not_allowed",
  "not a tenant member",
  "authorization check unavailable",
]);

function query(req) {
  return (req && req.query) || {};
}

function error(status, msg) {
  return { status, json: { error: msg } };
}

function authError(e) {
  const status = e && typeof e.status === "number" ? e.status : 403;
  const raw = e && typeof e.msg === "string" ? e.msg : "";
  if (status === 400) return error(400, "invalid_scope");
  if (status === 401) return error(401, "unauthorized");
  if (status === 503) return error(503, "authorization check unavailable");
  return error(status, SAFE_AUTH_MESSAGES.has(raw) ? raw : "forbidden");
}

function internalError(logError, where, err) {
  if (typeof logError === "function") {
    try { logError(where, err); } catch (_) { /* logging must never affect response */ }
  }
  return { status: 500, json: { ok: false, error: "internal_error" } };
}

function limitFrom(req) {
  return Math.min(Number(query(req).limit) || 5, 10);
}

function dateFrom(req, now = new Date()) {
  const raw = query(req).date;
  if (raw == null || raw === "") {
    return now.toLocaleDateString("en-CA", { timeZone: "Asia/Jerusalem" });
  }
  if (typeof raw !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    throw { status: 400, msg: "invalid date" };
  }
  return raw;
}

function assertAllowedQuery(req, action) {
  const allowed = action === "insights"
    ? new Set(["action", "tenantId", "bizId", "limit"])
    : action === "digest"
      ? new Set(["action", "tenantId", "bizId", "date"])
      : new Set(["action", "tenantId", "bizId"]);
  for (const k of Object.keys(query(req))) {
    if (!allowed.has(k)) throw { status: 400, msg: "unknown query mode" };
  }
}

export async function handleProactiveRead(req, deps) {
  const { requireBizContext, repos, now, logError } = deps || {};
  if (!req || req.method !== "GET") return error(405, "Method not allowed");

  const action = query(req).action;
  if (!READ_ACTIONS.has(action)) return error(400, "invalid action");

  let scope;
  try {
    assertAllowedQuery(req, action);
    scope = extractScope(req, { source: "query" });
  } catch (e) {
    return error(e?.status || 400, e?.msg || "invalid_scope");
  }

  try {
    await requireBizContext(req, { tenantId: scope.tenantId, bizId: scope.bizId, mode: "read" });
  } catch (e) {
    return authError(e);
  }

  try {
    if (repos.tenantExists && !(await repos.tenantExists(scope.tenantId))) {
      return error(404, "Tenant not found");
    }

    if (action === "insights") {
      const insights = await repos.getInsights(scope.tenantId, scope.bizId, limitFrom(req));
      return { status: 200, json: { ok: true, insights } };
    }

    if (action === "digest") {
      const targetDate = dateFrom(req, now);
      const digest = await repos.getDigest(scope.tenantId, scope.bizId, targetDate);
      if (!digest) {
        return { status: 200, json: { ok: true, digest: null, message: "No digest for this date" } };
      }
      return { status: 200, json: { ok: true, digest } };
    }

    const summary = await repos.getWeeklySummary(scope.tenantId, scope.bizId);
    return { status: 200, json: { ok: true, summary } };
  } catch (err) {
    return internalError(logError, `read:${action}`, err);
  }
}
