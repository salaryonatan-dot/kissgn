import { getAdminDb } from "./adminSdk.js";

// ─── RBAC ─────────────────────────────────────────────────────────────────────
const ROLE_RANK = { owner: 4, manager: 3, shift_manager: 2, viewer: 1 };
const VALID_ROLES = new Set(["owner", "manager", "shift_manager", "viewer"]);

export function hasRole(role, minRole) {
  return (ROLE_RANK[role] || 0) >= (ROLE_RANK[minRole] || 999);
}

// ─── Tenant access — Admin SDK reads RTDB, fail-closed ───────────────────────
/**
 * Verifies membership + role from RTDB.
 * FAIL-CLOSED: any error (timeout, DB unreachable, unexpected value) → deny.
 *
 * @throws {{ status: number, msg: string }}
 * @returns {string} the user's role for this tenant
 */
export async function requireTenantAccess(uid, tenantId, minRole) {
  // Input validation — prevent path traversal
  if (!uid      || typeof uid      !== "string" || uid.length      > 128) throw { status: 400, msg: "invalid uid" };
  if (!tenantId || typeof tenantId !== "string" || tenantId.length > 128) throw { status: 400, msg: "invalid tenantId" };
  if (!VALID_ROLES.has(minRole))                                           throw { status: 400, msg: "invalid minRole" };

  // Characters that RTDB forbids in paths
  const RTDB_FORBIDDEN = /[.#$\[\]\/]/;
  if (RTDB_FORBIDDEN.test(uid) || RTDB_FORBIDDEN.test(tenantId)) throw { status: 400, msg: "invalid characters in id" };

  const db = getAdminDb();

  // ── Membership check — must be exactly boolean true ──────────────────────
  let memberVal;
  try {
    const snap = await withTimeout(
      db.ref(`tenants/${tenantId}/members/${uid}`).get(),
      3_000,
      "membership lookup timed out"
    );
    memberVal = snap.val();
  } catch (e) {
    // Fail-closed: DB error, timeout, anything unexpected → deny
    console.error("[requireTenantAccess] member check failed:", e?.message ?? "unknown");
    throw { status: 503, msg: "authorization check unavailable" };
  }

  if (memberVal !== true) throw { status: 403, msg: "not a tenant member" };

  // ── Role check ────────────────────────────────────────────────────────────
  let role;
  try {
    const snap = await withTimeout(
      db.ref(`tenants/${tenantId}/roles/${uid}`).get(),
      3_000,
      "role lookup timed out"
    );
    role = snap.val();
  } catch (e) {
    console.error("[requireTenantAccess] role check failed:", e?.message ?? "unknown");
    throw { status: 503, msg: "authorization check unavailable" };
  }

  if (typeof role !== "string" || !VALID_ROLES.has(role)) throw { status: 403, msg: "no valid role assigned" };
  if (!hasRole(role, minRole))                             throw { status: 403, msg: "insufficient role" };

  return role;
}

function withTimeout(promise, ms, msg) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(msg)), ms);
    promise.then(v => { clearTimeout(timer); resolve(v); },
                 e => { clearTimeout(timer); reject(e); });
  });
}

// ─── Rate limiter — Upstash Redis required in production ─────────────────────
const IS_PROD = process.env.NODE_ENV === "production";

async function upstashIncr(key, windowSec) {
  const url   = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;

  const pipeline = [["INCR", key], ["EXPIRE", key, windowSec, "NX"]];
  const res = await fetch(`${url}/pipeline`, {
    method:  "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body:    JSON.stringify(pipeline),
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data?.[0]?.result ?? null;
}

const _buckets = new Map();
function inMemoryIncr(key, windowMs) {
  const now = Date.now();
  let rec = _buckets.get(key);
  if (!rec || now > rec.resetAt) { _buckets.set(key, { count: 1, resetAt: now + windowMs }); return 1; }
  rec.count++;
  return rec.count;
}

/**
 * Returns true if rate-limited.
 * In production, Upstash must be configured — missing config throws 503.
 */
export async function isRateLimited(key, limit = 60, windowMs = 60_000) {
  const windowSec = Math.ceil(windowMs / 1000);
  const count = await upstashIncr(`rl:${key}`, windowSec);

  if (count === null) {
    if (IS_PROD) {
      // Production requires Upstash — no silent fallback
      console.error("[rate-limit] Upstash not configured in production");
      throw { status: 503, msg: "rate limiter unavailable" };
    }
    // Dev/pilot: in-memory fallback
    return inMemoryIncr(key, windowMs) > limit;
  }
  return count > limit;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
// ── CORS — restricted to ALLOWED_ORIGIN, never wildcard with auth ────────────
function getAllowedOrigin(req) {
  const configured = process.env.ALLOWED_ORIGIN || "";
  if (!configured) return "";                       // deny if not configured

  const incoming = (req?.headers?.get
    ? req.headers.get("origin")
    : req?.headers?.origin) || "";

  // Reject null origins (sandboxed iframe, file://, etc.)
  if (!incoming || incoming === "null") return "";

  // Strict equality — no startsWith / contains
  return incoming === configured ? incoming : "";
}

export function errResponse(status, message, req) {
  const origin = getAllowedOrigin(req);
  const headers = { "Content-Type": "application/json" };
  if (origin) headers["Access-Control-Allow-Origin"] = origin;
  return new Response(JSON.stringify({ error: message }), { status, headers });
}

export function secHeaders(req, extra = {}) {
  const origin = getAllowedOrigin(req);
  const h = {
    "Content-Type":           "application/json; charset=utf-8",
    "Cache-Control":          "no-store",
    "X-Content-Type-Options": "nosniff",
    ...extra,
  };
  if (origin) h["Access-Control-Allow-Origin"] = origin;
  return h;
}

export function getIP(req) {
  return (req.headers.get ? req.headers.get("x-forwarded-for") : req.headers["x-forwarded-for"] || "")
    .split(",")[0].trim() || "unknown";
}

export { VALID_ROLES };
