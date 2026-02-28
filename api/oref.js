export const config = { runtime: "edge" };
import { isRateLimited, errResponse, secHeaders, getIP } from "./lib/helpers.js";

const UPSTREAM = "https://www.oref.org.il/WarningMessages/alert/alerts.json";

// Cache: serve same response for 15s (oref updates at most every few seconds)
let _cache = null;   // { body, expiresAt }

export default async function handler(req) {
  if (req.method !== "GET") return errResponse(405, "method not allowed", req);

  const ip = getIP(req);
  // Light rate limit — clients should poll every 30s, allow burst
  if (isRateLimited(ip, 10, 30_000)) return errResponse(429, "too many requests", req);

  // Serve from cache if fresh
  if (_cache && Date.now() < _cache.expiresAt) {
    return new Response(_cache.body, {
      status: 200,
      headers: { ...secHeaders(), "X-Cache": "HIT" },
    });
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

    // Validate: empty or valid JSON, max 10 KB
    if (text.length > 10_240)  { _cache = { body: "{}", expiresAt: Date.now() + 15_000 }; }
    else if (text.trim() !== "") {
      try { JSON.parse(text); } catch { _cache = { body: "{}", expiresAt: Date.now() + 15_000 }; }
      if (!_cache) _cache = { body: text, expiresAt: Date.now() + 15_000 };
    } else {
      _cache = { body: "{}", expiresAt: Date.now() + 15_000 };
    }

    return new Response(_cache.body, {
      status: 200,
      headers: { ...secHeaders(), "X-Cache": "MISS" },
    });
  } catch (err) {
    // Never log request details
    console.error("[oref]", err?.name === "AbortError" ? "timeout" : "upstream-error");
    return new Response("{}", { status: 200, headers: secHeaders() });
  }
}
