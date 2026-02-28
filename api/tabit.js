// Node.js serverless runtime — NOT Edge (requires firebase-admin)

import { requireAuth }                                   from "./lib/verifyToken.js";
import { requireTenantAccess, isRateLimited, getIP } from "./lib/helpers.js";

const UPSTREAM_BASE = "https://api.tabit.cloud";
const ALLOWED_PATHS = new Map([
  ["/v1/shifts/summary", "shifts-summary"],
  ["/v1/shifts/current", "shifts-current"],
  ["/v1/labor/daily",    "labor-daily"],
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

  let claims;
  try { claims = await requireAuth(req); }
  catch { res.status(401).json({ error: "unauthorized" }); return; }

  const ip = getIP(req);
  try {
    if (await isRateLimited(`tabit:ip:${ip}`,          30, 60_000)) { res.status(429).json({ error: "too many requests" }); return; }
    if (await isRateLimited(`tabit:uid:${claims.uid}`, 20, 60_000)) { res.status(429).json({ error: "too many requests" }); return; }
  } catch (e) { res.status(e.status || 503).json({ error: e.msg || "rate limiter error" }); return; }

  const tenantId = req.query.tenantId || "";
  if (!tenantId) { res.status(400).json({ error: "missing tenantId" }); return; }

  try { await requireTenantAccess(claims.uid, tenantId, "shift_manager"); }
  catch (e) { res.status(e.status || 403).json({ error: e.msg || "forbidden" }); return; }

  const path = req.query.path || "";
  const date = req.query.date || "";

  if (!ALLOWED_PATHS.has(path)) { res.status(400).json({ error: "invalid path" }); return; }
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) { res.status(400).json({ error: "invalid date" }); return; }

  const upstream = date
    ? `${UPSTREAM_BASE}${path}?date=${encodeURIComponent(date)}`
    : `${UPSTREAM_BASE}${path}`;

  try {
    const ctrl  = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8_000);

    const up = await fetch(upstream, {
      signal:  ctrl.signal,
      headers: {
        "Authorization": `Bearer ${process.env.TABIT_API_KEY}`,
        "X-Tabit-Org":   process.env.TABIT_ORG_ID || "",
        "Accept":        "application/json",
        "User-Agent":    "MarjinProxy/1.0",
      },
    });
    clearTimeout(timer);

    if (!up.ok) { console.error("[tabit] upstream:", up.status); res.status(502).json({ error: "upstream error" }); return; }

    res.status(200).json(extractShiftAggregates(await up.json(), ALLOWED_PATHS.get(path)));

  } catch (err) {
    console.error("[tabit]", err?.name === "AbortError" ? "timeout" : "fetch-error");
    res.status(502).json({ error: "upstream unavailable" });
  }
}

function extractShiftAggregates(raw, pathKey) {
  switch (pathKey) {
    case "shifts-summary":
    case "labor-daily":
      return {
        date:           strOrNull(raw.date),
        totalHours:     numOrNull(raw.total_hours     ?? raw.totalHours),
        totalLaborCost: numOrNull(raw.total_labor_cost ?? raw.totalLaborCost),
        employeeCount:  numOrNull(raw.employee_count  ?? raw.employeeCount),
        shiftsCount:    numOrNull(raw.shifts_count     ?? raw.shiftsCount),
      };
    case "shifts-current":
      return {
        isOpen:            typeof raw.is_open === "boolean" ? raw.is_open : (raw.isOpen ?? null),
        openedAt:          strOrNull(raw.opened_at ?? raw.openedAt),
        currentStaffCount: numOrNull(raw.current_staff ?? raw.currentStaffCount),
      };
    default:
      return {};
  }
}

const numOrNull = v => (v !== undefined && v !== null && !isNaN(Number(v))) ? Number(v) : null;
const strOrNull = v => (typeof v === "string" && v.length < 64) ? v : null;
