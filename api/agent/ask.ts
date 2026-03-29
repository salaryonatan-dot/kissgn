import type { VercelRequest, VercelResponse } from "@vercel/node";
import { routeQuestion } from "../../src/agent/orchestrator/routeQuestion.js";
import type { AgentContext } from "../../src/agent/types/agent.js";

// Rate limiting: simple in-memory (per-instance, resets on cold start)
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT = 30;       // requests per window
const RATE_WINDOW_MS = 60000; // 1 minute

function checkRateLimit(tenantId: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(tenantId);
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(tenantId, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return true;
  }
  entry.count++;
  return entry.count <= RATE_LIMIT;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS
  const origin = req.headers.origin || "";
  const allowed = ["https://kissgn.vercel.app", "http://localhost:3000"];
  if (allowed.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { question, tenantId, bizId, branchId, timezone } = req.body ?? {};

    if (!question || typeof question !== "string" || question.trim().length < 2) {
      return res.status(400).json({ error: "Missing or invalid question" });
    }

    if (!tenantId || typeof tenantId !== "string") {
      return res.status(400).json({ error: "Missing tenantId" });
    }

    if (!bizId || typeof bizId !== "string") {
      return res.status(400).json({ error: "Missing bizId" });
    }

    // Rate limit
    if (!checkRateLimit(tenantId)) {
      return res.status(429).json({ error: "Rate limit exceeded" });
    }

    const context: AgentContext = {
      tenantId,
      bizId,
      branchId: branchId || undefined,
      timezone: timezone || "Asia/Jerusalem",
      locale: "he-IL",
      nowIso: new Date().toISOString(),
      userQuestion: question.trim(),
    };

    const response = await routeQuestion(context);

    return res.status(200).json({
      answer: response.text,
      confidence: response.confidence.level,
      intent: response.intent,
      sources: response.usedSources,
    });
  } catch (err: any) {
    console.error("[Marjin AI] ask endpoint error:", err);
    return res.status(500).json({
      answer: "אין לי מספיק מידע כרגע כדי לענות על זה בצורה מדויקת",
      confidence: "low",
      intent: "unknown_or_insufficient",
      sources: [],
    });
  }
}
