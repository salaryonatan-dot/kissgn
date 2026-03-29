/**
 * /api/ai-chat.js — Marjin AI chat endpoint (Vercel serverless)
 *
 * Receives { prompt, intent } from the frontend Data-First router.
 * Only called for HYBRID and AI_GENERAL intents — local data queries
 * are resolved client-side and never reach this endpoint.
 *
 * Uses Anthropic Claude API via REST (no SDK needed — keeps bundle small).
 */

import { requireAuth }       from "../lib/verifyToken.js";
import { requireTenantAccess, isRateLimited, getIP,
         errResponse, secHeaders } from "../lib/helpers.js";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const MODEL             = "claude-sonnet-4-20250514";
const MAX_TOKENS        = 1024;

// ── System prompt — instructs the model to act as Marjin business assistant ──
const SYSTEM_PROMPT = `אתה "מרג'ין AI", עוזר עסקי חכם למנהלי מסעדות.
אתה מקבל הקשר עסקי (מכירות, עלויות, חזויים) ועונה בעברית תמציתית ומקצועית.
כללים:
- ענה תמיד בעברית.
- היה תמציתי — 2-4 משפטים מקסימום אלא אם נדרש יותר.
- אם אין לך מספיק נתונים, אמור זאת בכנות.
- אל תמציא נתונים. השתמש רק במה שסופק לך.
- כשאתה נותן המלצות, בסס אותן על הנתונים שקיבלת.`;

export default async function handler(req, res) {
  // ── CORS ──────────────────────────────────────────────────────────────────
  const allowedOrigin  = process.env.ALLOWED_ORIGIN || "https://kissgn.vercel.app";
  const incomingOrigin = req.headers.origin || "";
  if (incomingOrigin && incomingOrigin === allowedOrigin) {
    res.setHeader("Access-Control-Allow-Origin", allowedOrigin);
  }
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Vary", "Origin");
  res.setHeader("Content-Type", "application/json");

  if (req.method === "OPTIONS") { res.status(204).end(); return; }
  if (req.method !== "POST")    { res.status(405).json({ error: "method not allowed" }); return; }

  // ── Auth ─────────────────────────────────────────────────────────────────
  let claims;
  try {
    claims = await requireAuth(req);
  } catch (e) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }

  // ── Rate limit — 30 AI requests per minute per user ─────────────────────
  try {
    const ip  = getIP(req);
    const key = `ai:${claims.uid}:${ip}`;
    if (await isRateLimited(key, 30, 60_000)) {
      res.status(429).json({ error: "too many requests — try again shortly" });
      return;
    }
  } catch (e) {
    // Rate limiter unavailable — fail open in dev, closed in prod
    if (e?.status === 503) {
      res.status(503).json({ error: e.msg || "rate limiter unavailable" });
      return;
    }
  }

  // ── Parse body ──────────────────────────────────────────────────────────
  const { prompt, intent } = req.body || {};

  if (!prompt || typeof prompt !== "string" || prompt.length > 8000) {
    res.status(400).json({ error: "invalid or missing prompt" });
    return;
  }

  // Only HYBRID and AI_GENERAL should reach this endpoint
  if (intent && !["HYBRID", "AI_GENERAL"].includes(intent)) {
    res.status(400).json({ error: "intent should be HYBRID or AI_GENERAL" });
    return;
  }

  // ── Anthropic API key ──────────────────────────────────────────────────
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error("[ai-chat] ANTHROPIC_API_KEY not configured");
    res.status(503).json({ error: "AI service not configured" });
    return;
  }

  // ── Call Anthropic ────────────────────────────────────────────────────
  try {
    const anthropicRes = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: {
        "Content-Type":      "application/json",
        "x-api-key":         apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model:      MODEL,
        max_tokens: MAX_TOKENS,
        system:     SYSTEM_PROMPT,
        messages:   [{ role: "user", content: prompt }],
      }),
    });

    if (!anthropicRes.ok) {
      const errBody = await anthropicRes.text().catch(() => "");
      console.error(`[ai-chat] Anthropic API error ${anthropicRes.status}:`, errBody);
      res.status(502).json({ error: "AI service temporarily unavailable" });
      return;
    }

    const data = await anthropicRes.json();
    const text = data?.content?.[0]?.text || "אין לי תשובה כרגע.";

    res.status(200).json({ text });

  } catch (e) {
    console.error("[ai-chat] unexpected error:", e?.message ?? e);
    res.status(500).json({ error: "internal error" });
  }
}
