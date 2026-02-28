/**
 * POST /api/analytics/backfill?tenantId=&from=YYYY-MM-DD&to=YYYY-MM-DD
 * Owner/manager only. Idempotent: full set() per day, never partial merge.
 * branchId = "main" (pilot — fixed).
 *
 * Concurrency: RTDB lock prevents parallel backfills for the same tenant.
 * Rate limit: separate, tighter than regular endpoints.
 */

import { requireAuth }               from "../../../lib/verifyToken.js";
import { requireTenantAccess,
         isRateLimited, getIP }      from "../../../lib/helpers.js";
import { getAdminDb }                from "../../../lib/adminSdk.js";
import { buildDailyDoc }             from "../../../lib/analytics/builder.js";

const RTDB_FORBIDDEN = /[.#$\[\]\/]/;
const MAX_DAYS       = 90;

export default async function handler(req, res) {
  if (req.method !== "POST") { res.status(405).json({ error: "method not allowed" }); return; }

  // ── Auth ───────────────────────────────────────────────────────────────────
  let claims;
  try { claims = await requireAuth(req); }
  catch { res.status(401).json({ error: "unauthorized" }); return; }

  // ── Rate limit — tighter than regular endpoints (backfill hits many upstreams)
  const ip = getIP(req);
  try {
    if (await isRateLimited(`backfill:ip:${ip}`,          2, 60_000)) { res.status(429).json({ error: "too many requests" }); return; }
    if (await isRateLimited(`backfill:uid:${claims.uid}`, 1, 60_000)) { res.status(429).json({ error: "too many requests" }); return; }
  } catch (e) { res.status(e.status || 503).json({ error: e.msg || "rate limiter error" }); return; }

  // ── Validate params ────────────────────────────────────────────────────────
  const tenantId = req.query.tenantId || "";
  const from     = req.query.from     || "";
  const to       = req.query.to       || "";

  if (!tenantId || RTDB_FORBIDDEN.test(tenantId))    { res.status(400).json({ error: "invalid tenantId" });  return; }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from))            { res.status(400).json({ error: "invalid from date" }); return; }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(to))              { res.status(400).json({ error: "invalid to date" });   return; }
  if (from > to)                                     { res.status(400).json({ error: "from must be ≤ to" }); return; }

  const dates = dateRange(from, to);
  if (dates.length > MAX_DAYS) { res.status(400).json({ error: `max ${MAX_DAYS} days per backfill` }); return; }

  // ── RBAC ───────────────────────────────────────────────────────────────────
  try { await requireTenantAccess(claims.uid, tenantId, "manager"); }
  catch (e) { res.status(e.status || 403).json({ error: e.msg || "forbidden" }); return; }

  // ── Concurrency lock: one backfill per tenant at a time ───────────────────
  const db      = getAdminDb();
  const lockRef  = db.ref(`tenants/${tenantId}/analytics/_lock/backfill`);
  const lockId   = await acquireLock(lockRef);

  if (!lockId) {
    res.status(409).json({ error: "another backfill is already running for this tenant" });
    return;
  }

  const results = { tenantId, from, to, built: [], skipped: [] };

  try {
    for (const date of dates) {
      try {
        const { path, doc } = await buildDailyDoc(tenantId, date);
        await db.ref(path).set(doc);
        results.built.push(date);
      } catch (e) {
        const reason = e?.source ? `${e.source}/${e.reason}` : e?.message ?? "unknown";
        console.error(`[backfill] skip date=${date}: ${reason}`);
        results.skipped.push({ date, reason });
      }
    }
  } finally {
    await releaseLock(lockRef, lockId); // only releases if lockId matches
  }

  res.status(200).json(results);
}

// ── RTDB transaction lock with lockId ──────────────────────────────────────────
// lockId prevents a later backfill from releasing a lock it didn't acquire.
async function acquireLock(ref) {
  const TTL_MS = 10 * 60 * 1000; // 10 min safety TTL
  const lockId = Math.random().toString(36).slice(2) + Date.now().toString(36);
  let acquired = false;
  try {
    const result = await ref.transaction(current => {
      if (current && current.expiresAt && Date.now() < current.expiresAt) {
        return undefined; // abort — valid lock held by another request
      }
      // Acquire: write lockId + expiry
      return { lockId, expiresAt: Date.now() + TTL_MS };
    });
    acquired = result.committed;
  } catch (e) {
    console.error("[backfill] lock acquire failed:", e?.message);
  }
  return acquired ? lockId : null; // return lockId so release can verify
}

async function releaseLock(ref, lockId) {
  try {
    // Only release if this request still holds the lock (lockId matches)
    await ref.transaction(current => {
      if (!current || current.lockId !== lockId) return undefined; // abort — not our lock
      return null; // delete
    });
  } catch (e) {
    console.error("[backfill] lock release failed:", e?.message);
  }
}

function dateRange(from, to) {
  const dates = [];
  const d = new Date(from + "T12:00:00Z");
  const end = new Date(to   + "T12:00:00Z");
  while (d <= end) {
    dates.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return dates;
}
