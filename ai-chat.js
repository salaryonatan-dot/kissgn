// /api/ai-chat.js — secure Anthropic proxy for Marjin
// Deploy to: kissgn.vercel.app/api/ai-chat
// Required env var: ANTHROPIC_API_KEY
// Test: GET /api/ai-chat → should return 405 {"error":"Method not allowed"}

export default async function handler(req, res) {
  console.log("[ai-chat] method:", req.method, "| path:", req.url);

  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") { res.status(204).end(); return; }
  if (req.method !== "POST") {
    console.log("[ai-chat] rejected method:", req.method);
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error("[ai-chat] ANTHROPIC_API_KEY is not set");
    res.status(500).json({ error: "ANTHROPIC_API_KEY not configured" });
    return;
  }
  console.log("[ai-chat] API key OK, length:", apiKey.length);

  const { prompt } = req.body || {};
  if (!prompt || typeof prompt !== "string" || !prompt.trim()) {
    res.status(400).json({ error: "Missing prompt" });
    return;
  }
  if (prompt.length > 8000) {
    res.status(400).json({ error: "Prompt too long" });
    return;
  }
  console.log("[ai-chat] prompt length:", prompt.length);

  try {
    console.log("[ai-chat] calling Anthropic...");
    const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type":      "application/json",
        "x-api-key":         apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model:      "claude-haiku-4-5-20251001",
        max_tokens: 400,
        messages:   [{ role: "user", content: prompt }],
      }),
    });

    console.log("[ai-chat] Anthropic status:", anthropicRes.status);

    if (!anthropicRes.ok) {
      const errText = await anthropicRes.text();
      console.error("[ai-chat] Anthropic error:", errText.slice(0, 300));
      res.status(502).json({ error: `AI error ${anthropicRes.status}`, detail: errText.slice(0, 200) });
      return;
    }

    const data = await anthropicRes.json();
    const text = data.content?.[0]?.text ?? "לא הצלחתי לעבד את הבקשה.";
    console.log("[ai-chat] success, reply length:", text.length);

    res.setHeader("Cache-Control", "no-store");
    res.status(200).json({ text });

  } catch (e) {
    console.error("[ai-chat] exception:", e.message);
    res.status(503).json({ error: "Network error", detail: e.message });
  }
}
