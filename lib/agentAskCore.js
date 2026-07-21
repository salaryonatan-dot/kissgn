// lib/agentAskCore.js — /api/agent/ask request core (PR #2A).
//
// Pure control flow with INJECTED dependencies (requireBizContext, routeQuestion,
// rateLimit, now). Returns { status, json?, end? } and never touches res, so it
// is fully behaviorally testable without firebase. The thin Vercel wrapper
// (api/agent/ask.ts) injects the real deps.
//
// Order: method → question → scope (ids body-only, timezone, branchId) →
// security gate (read roles) → rate limit → routeQuestion. On ANY denial the
// data path (routeQuestion / analytics / memory) is never reached.

import { validateAskScope } from "./apiScope.js";

function errOut(e) {
  const status = e && typeof e.status === "number" ? e.status : 403;
  const msg = e && typeof e.msg === "string" ? e.msg : "forbidden";
  return { status, json: { error: msg } };
}

export async function handleAgentAsk(req, deps) {
  const { requireBizContext, routeQuestion, rateLimit, now, logError } = deps || {};

  if (req.method === "OPTIONS") return { status: 200, end: true };
  if (req.method !== "POST") return { status: 405, json: { error: "Method not allowed" } };

  const body = req.body || {};
  const question = body.question;
  if (!question || typeof question !== "string" || question.trim().length < 2) {
    return { status: 400, json: { error: "Missing or invalid question" } };
  }

  // Scope: ids from body only, timezone + branchId policy (throws { status, msg }).
  let scope;
  try {
    scope = validateAskScope(req);
  } catch (e) {
    return errOut(e);
  }

  // Security gate (READ roles): auth + tenant membership + biz access.
  let ctx;
  try {
    ctx = await requireBizContext(req, { tenantId: scope.tenantId, bizId: scope.bizId, mode: "read" });
  } catch (e) {
    return errOut(e);
  }

  // Rate limit AFTER auth, keyed by the authorized principal (uid + tenant + biz).
  if (typeof rateLimit === "function" && !rateLimit(`${ctx.uid}:${scope.tenantId}:${scope.bizId}`)) {
    return { status: 429, json: { error: "Rate limit exceeded" } };
  }

  const context = {
    tenantId: scope.tenantId,
    bizId: scope.bizId,
    branchId: scope.branchId, // undefined unless caller passed branchId === bizId
    timezone: scope.timezone,
    locale: "he-IL",
    nowIso: typeof now === "function" ? now() : new Date().toISOString(),
    userQuestion: question.trim(),
  };

  try {
    const response = await routeQuestion(context);
    return {
      status: 200,
      json: {
        answer: response.text,
        confidence: response.confidence.level,
        intent: response.intent,
        sources: response.usedSources,
      },
    };
  } catch (err) {
    if (typeof logError === "function") { try { logError("ask:routeQuestion", err); } catch (_) { /* logging must never leak */ } }
    return {
      status: 500,
      json: {
        answer: "אין לי מספיק מידע כרגע כדי לענות על זה בצורה מדויקת",
        confidence: "low",
        intent: "unknown_or_insufficient",
        sources: [],
      },
    };
  }
}
