// Node.js serverless — public endpoint, no auth required
import { isRateLimited, getIP } from "../lib/helpers.js";

const UPSTREAM = "https://www.oref.org.il/WarningMessages/alert/alerts.json";

// Cache: serve same response for 15s (oref updates at most every few seconds)
let _cache = null;   // { body, expiresAt }

export default async function handler(req, res) {
  if (req.method !== "GET") { res.status(405).json({ error: "method not allowed" }); return; }

  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Content-Type", "application/json");

  const ip = getIP(req);
  try {
    if (await isRateLimited(`oref:ip:${ip}`, 10, 30_000)) {
      res.status(429).json({ error: "too many requests" }); return;
    }
  } catch { /* rate limiter optional for public endpoint */ }

  // Serve from cache if fresh
  if (_cache && Date.now() < _cache.expiresAt) {
    res.setHeader("X-Cache", "HIT");
    res.status(200).send(_cache.body);
    return;
  }

  try {
    const ctrl  = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 4_000);

    const up = await fetch(UPSTREAM, {
      signal: ctrl.signal,
      headers: {
        "X-Requested-With": "XMLHttpRequest",
        "Referer":          "https://www.oref.org.il/",
        "User-Agent":       "Mozilla/5.0 (compatible; MarjinProxy/1.0)",
      },
    });
    clearTimeout(timer);

    const text = await up.text();

    if (text.length > 10_240) {
      _cache = { body: "{}", expiresAt: Date.now() + 15_000 };
    } else if (text.trim() !== "") {
      try { JSON.parse(text); _cache = { body: text, expiresAt: Date.now() + 15_000 }; }
      catch { _cache = { body: "{}", expiresAt: Date.now() + 15_000 }; }
    } else {
      _cache = { body: "{}", expiresAt: Date.now() + 15_000 };
    }

    res.setHeader("X-Cache", "MISS");
    res.status(200).send(_cache.body);
  } catch (err) {
    console.error("[oref]", err?.name === "AbortError" ? "timeout" : "upstream-error");
    res.status(200).send("{}");
  }
}
