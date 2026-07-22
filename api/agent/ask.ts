// api/agent/ask.ts — thin Vercel adapter (PR #2A).
// CORS + real-dependency injection only; all control flow lives in the
// behaviorally-tested core lib/agentAskCore.js. Previously this endpoint had NO
// authentication and honored caller-supplied tenantId/bizId (unauthenticated
// cross-tenant/business access via the Admin SDK).
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { routeQuestion } from "../../src/agent/orchestrator/routeQuestion.js";
import { handleAgentAsk } from "../../lib/agentAskCore.js";
import { requireBizContext } from "../../lib/securityContext.js";

// Per-instance in-memory rate limiter, keyed by the authorized principal
// (uid:tenant:biz — the core builds the key). Returns true when allowed.
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT = 30;
const RATE_WINDOW_MS = 60000;
function rateLimit(key: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(key);
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(key, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return true;
  }
  entry.count++;
  return entry.count <= RATE_LIMIT;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const origin = req.headers.origin || "";
  const allowed = ["https://kissgn.vercel.app", "http://localhost:3000"];
  if (allowed.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  const logError = (where: string, err: unknown): void => {
    console.error("[ask]", where, (err as { message?: string })?.message ?? err);
  };
  const out = await handleAgentAsk(req, { requireBizContext, routeQuestion, rateLimit, logError });
  if (out.end) return res.status(out.status).end();
  return res.status(out.status).json(out.json);
}
