/**
 * Scheduled daily analytics builder.
 * Called by Vercel Cron — schedule: "0 23 * * *" (23:00 UTC = 01:00 IL winter / 02:00 IL summer)
 * Vercel crons run in UTC. No timezone conversion in schedule — adjust if DST matters.
 *
 * Writes to: tenants/{tenantId}/analytics/daily/main/{YYYY-MM-DD}
 *
 * Auth: x-cron-secret header must match CRON_SECRET env var.
 * If CRON_SECRET is unset → 503 (fail-closed, never runs unauthenticated).
 */

import { timingSafeEqual } from "crypto";
import { getAdminDb }      from "../../../lib/adminSdk.js";
import { buildDailyDoc }   from "../../../lib/analytics/builder.js";

export default async function handler(req, res) {

  // ── 1. Fail-closed: CRON_SECRET must be configured ────────────────────────
  const secret = process.env.CRON_SECRET || "";
  if (!secret) {
    console.error("[daily-builder] CRON_SECRET not set — refusing to run");
    res.status(503).json({ error: "not configured" });
    return;
  }

  // ── 2. Timing-safe compare — header only (query strings appear in logs) ────
  // Support both x-cron-secret and Authorization: Bearer <secret>
  const xHeader   = String(req.headers["x-cron-secret"]   || "");
  const authBearer = String(req.headers["authorization"]   || "").replace(/^Bearer\s+/i, "");
  const incoming  = xHeader || authBearer;

  let authorized = false;
  try {
    const a = Buffer.from(secret,   "utf8");
    const b = Buffer.from(incoming, "utf8");
    authorized = a.length === b.length && timingSafeEqual(a, b);
  } catch { authorized = false; }

  if (!authorized) {
    res.status(404).json({ error: "not found" }); // opaque — don't reveal endpoint exists
    return;
  }

  // ── 3. Date: override via query (manual trigger), else yesterday ───────────
  // "Yesterday" computed in UTC — cron fires at 23:00 UTC, date is already correct.
  const date = req.query.date || getYesterdayUTC();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    res.status(400).json({ error: "invalid date" });
    return;
  }

  // ── 4. Load tenants ───────────────────────────────────────────────────────
  const db = getAdminDb();
  let tenants;
  try {
    const snap = await db.ref("tenants").get();
    tenants = snap.val() ? Object.keys(snap.val()) : [];
  } catch (e) {
    console.error("[daily-builder] tenants load failed:", e?.message);
    res.status(503).json({ error: "db unavailable" });
    return;
  }

  // ── 5. Build + write, skip tenant on failure ──────────────────────────────
  const results = { date, built: [], skipped: [] };

  for (const tenantId of tenants) {
    try {
      const { path, doc } = await buildDailyDoc(tenantId, date);
      await db.ref(path).set(doc); // full set — never partial merge
      results.built.push(tenantId);
    } catch (e) {
      // source+reason only — no revenue figures or raw data in logs
      const reason = e?.source ? `${e.source}/${e.reason}` : e?.message ?? "unknown";
      console.error(`[daily-builder] skip tenant=${tenantId} date=${date}: ${reason}`);
      results.skipped.push({ tenantId, reason });
    }
  }

  res.status(200).json(results);
}

function getYesterdayUTC() {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}
