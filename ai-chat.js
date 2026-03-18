// /api/ai-chat — secure Anthropic proxy
// API key stays server-side; client sends only the prompt context.
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", process.env.ALLOWED_ORIGIN || "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") { res.status(204).end(); return; }
  if (req.method !== "POST")    { res.status(405).json({ error: "Method not allowed" }); return; }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: "ANTHROPIC_API_KEY not configured" });
    return;
  }

  const { prompt } = req.body || {};
  if (!prompt || typeof prompt !== "string" || prompt.trim().length === 0) {
    res.status(400).json({ error: "Missing prompt" });
    return;
  }
  if (prompt.length > 8000) {
    res.status(400).json({ error: "Prompt too long" });
    return;
  }

  try {
    const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type":    "application/json",
        "x-api-key":       apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model:      "claude-sonnet-4-20250514",
        max_tokens: 400,
        messages:   [{ role: "user", content: prompt }],
      }),
    });

    if (!anthropicRes.ok) {
      const err = await anthropicRes.text();
      console.error("[ai-chat] Anthropic error:", anthropicRes.status, err);
      res.status(502).json({ error: "AI service error", status: anthropicRes.status });
      return;
    }

    const data = await anthropicRes.json();
    const text = data.content?.[0]?.text ?? "לא הצלחתי לעבד את הבקשה.";

    res.setHeader("Cache-Control", "no-store");
    res.status(200).json({ text });
  } catch (e) {
    console.error("[ai-chat] fetch failed:", e.message);
    res.status(503).json({ error: "Network error reaching AI service" });
  }
}
