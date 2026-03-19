// /api/ai-chat.js — secure Anthropic proxy for Marjin
export default async function handler(req, res) {
  console.log("[ai-chat] method:", req.method);

  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") { res.status(204).end(); return; }
  if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error("[ai-chat] ANTHROPIC_API_KEY missing");
    res.status(500).json({ error: "ANTHROPIC_API_KEY not configured" });
    return;
  }
  console.log("[ai-chat] key length:", apiKey.length, "| starts:", apiKey.slice(0, 12));

  const { prompt } = req.body || {};
  if (!prompt || typeof prompt !== "string" || !prompt.trim()) {
    res.status(400).json({ error: "Missing prompt" });
    return;
  }

  try {
    console.log("[ai-chat] calling Anthropic, prompt chars:", prompt.length);
    const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-3-haiku-20240307",
        max_tokens: 400,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    const body = await anthropicRes.text();
    console.log("[ai-chat] Anthropic status:", anthropicRes.status);
    console.log("[ai-chat] Anthropic body:", body.slice(0, 300));

    if (!anthropicRes.ok) {
      res.status(502).json({ error: `Anthropic ${anthropicRes.status}`, detail: body.slice(0, 200) });
      return;
    }

    const data = JSON.parse(body);
    const text = data.content?.[0]?.text ?? "לא הצלחתי לעבד את הבקשה.";
    res.setHeader("Cache-Control", "no-store");
    res.status(200).json({ text });

  } catch (e) {
    console.error("[ai-chat] exception:", e.message);
    res.status(503).json({ error: "Network error", detail: e.message });
  }
}
