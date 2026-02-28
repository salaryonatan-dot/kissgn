// Node.js serverless runtime — NOT Edge (requires firebase-admin)
// config.runtime omitted → defaults to Node on Vercel

import { requireAuth }                                   from "../lib/verifyToken.js";
import { requireTenantAccess, isRateLimited, getIP } from "../lib/helpers.js";

const UPSTREAM_BASE = "https://api.beecomm.co.il";
const ALLOWED_PATHS = new Map([
  ["/v1/reports/daily-summary", "daily-summary"],
  ["/v1/reports/sales",         "sales"],
  ["/v1/reports/payments",      "payments"],
]);

export default async function handler(req, res) {
  if (req.method === "OPTIONS") { res.status(204).end(); return; }
  if (req.method !== "GET") { res.status(405).json({ error: "method not allowed" }); return; }

  // ── CORS — strict origin, no wildcard ───────────────────────────────────────
  const _origin  = req.headers.origin || "";
  const _allowed = process.env.ALLOWED_ORIGIN || "";
  if (_origin && _origin !== "null" && _origin === _allowed) {
    res.setHeader("Access-Control-Allow-Origin", _origin);
  }

  // ── 1. Verify ID token (Admin SDK — checkRevoked) ──────────────────────────
  let claims;
  try { claims = await requireAuth(req); }
  catch { res.status(401).json({ error: "unauthorized" }); return; }

  // ── 2. Rate limit ──────────────────────────────────────────────────────────
  const ip = getIP(req);
  try {
    if (await isRateLimited(`beecomm:ip:${ip}`,          30, 60_000)) { res.status(429).json({ error: "too many requests" }); return; }
    if (await isRateLimited(`beecomm:uid:${claims.uid}`, 20, 60_000)) { res.status(429).json({ error: "too many requests" }); return; }
  } catch (e) { res.status(e.status || 503).json({ error: e.msg || "rate limiter error" }); return; }

  // ── 3. Tenant isolation — RTDB membership + role check ────────────────────
  const tenantId = req.query.tenantId || "";
  if (!tenantId) { res.status(400).json({ error: "missing tenantId" }); return; }

  try { await requireTenantAccess(claims.uid, tenantId, "manager"); }
  catch (e) { res.status(e.status || 403).json({ error: e.msg || "forbidden" }); return; }

  // ── 4. Path + date validation ──────────────────────────────────────────────
  const path = req.query.path || "";
  const date = req.query.date || "";

  if (!ALLOWED_PATHS.has(path))           { res.status(400).json({ error: "invalid path" }); return; }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { res.status(400).json({ error: "invalid date" }); return; }

  // ── 5. Upstream call — key from env only, never from client ───────────────
  try {
    const ctrl  = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8_000);

    const up = await fetch(`${UPSTREAM_BASE}${path}?date=${encodeURIComponent(date)}`, {
      signal:  ctrl.signal,
      headers: {
        "Authorization": `Bearer ${process.env.BEECOMM_API_KEY}`,
        "Accept":        "application/json",
        "User-Agent":    "MarjinProxy/1.0",
      },
    });
    clearTimeout(timer);

    if (!up.ok) { console.error("[beecomm] upstream:", up.status); res.status(502).json({ error: "upstream error" }); return; }

    const raw = await up.json();
    res.status(200).json(extractAggregates(raw, ALLOWED_PATHS.get(path)));

  } catch (err) {
    console.error("[beecomm]", err?.name === "AbortError" ? "timeout" : "fetch-error");
    res.status(502).json({ error: "upstream unavailable" });
  }
}

// ── Explicit field whitelist per path — zero fallback ────────────────────────
function extractAggregates(raw, pathKey) {
  switch (pathKey) {
    case "daily-summary":
      return {
        date:             strOrNull(raw.date             ?? raw.Date),
        totalSales:       numOrNull(raw.total_sales       ?? raw.totalSales),
        cashSales:        numOrNull(raw.cash_sales        ?? raw.cashSales),
        creditSales:      numOrNull(raw.credit_sales      ?? raw.creditSales),
        deliverySales:    numOrNull(raw.delivery_sales    ?? raw.deliverySales),
        otherSales:       numOrNull(raw.other_sales       ?? raw.otherSales),
        transactionCount: numOrNull(raw.transaction_count ?? raw.transactionCount),
        vatIncluded:      typeof raw.vat_included === "boolean" ? raw.vat_included : null,
      };
    case "sales":
      return {
        date:       strOrNull(raw.date),
        totalSales: numOrNull(raw.total_sales ?? raw.totalSales),
        netSales:   numOrNull(raw.net_sales   ?? raw.netSales),
      };
    case "payments":
      return {
        date:   strOrNull(raw.date),
        cash:   numOrNull(raw.cash),
        credit: numOrNull(raw.credit),
        other:  numOrNull(raw.other),
      };
    default:
      return {}; // unknown path → return nothing
  }
}

const numOrNull = v => (v !== undefined && v !== null && !isNaN(Number(v))) ? Number(v) : null;
const strOrNull = v => (typeof v === "string" && v.length < 64) ? v : null;
