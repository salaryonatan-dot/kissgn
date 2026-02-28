/**
 * GET /api/analytics/check?tenantId=&date=YYYY-MM-DD
 * Owner/manager only. Returns computed doc + checksum vs stored doc.
 * No raw upstream payload — aggregates only.
 */

import { requireAuth }               from "../../../lib/verifyToken.js";
import { requireTenantAccess,
         isRateLimited, getIP }      from "../../../lib/helpers.js";
import { getAdminDb }                from "../../../lib/adminSdk.js";
import { buildDailyDoc }             from "../../../lib/analytics/builder.js";

const RTDB_FORBIDDEN = /[.#$\[\]\/]/;
const BRANCH_ID = "main";

export default async function handler(req, res) {
  if (req.method !== "GET") { res.status(405).json({ error: "method not allowed" }); return; }

  let claims;
  try { claims = await requireAuth(req); }
  catch { res.status(401).json({ error: "unauthorized" }); return; }

  const ip = getIP(req);
  try {
    if (await isRateLimited(`check:ip:${ip}`,           10, 60_000)) { res.status(429).json({ error: "too many requests" }); return; }
    if (await isRateLimited(`check:uid:${claims.uid}`,  10, 60_000)) { res.status(429).json({ error: "too many requests" }); return; }
  } catch (e) { res.status(e.status || 503).json({ error: e.msg || "rate limiter error" }); return; }

  const tenantId = req.query.tenantId || "";
  const date     = req.query.date     || "";

  if (!tenantId || RTDB_FORBIDDEN.test(tenantId))  { res.status(400).json({ error: "invalid tenantId" }); return; }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date))          { res.status(400).json({ error: "invalid date" }); return; }

  try { await requireTenantAccess(claims.uid, tenantId, "manager"); }
  catch (e) { res.status(e.status || 403).json({ error: e.msg || "forbidden" }); return; }

  const db = getAdminDb();

  // ── Build fresh doc from upstreams ────────────────────────────────────────
  let freshDoc;
  try {
    const { doc } = await buildDailyDoc(tenantId, date);
    freshDoc = doc;
  } catch (e) {
    res.status(502).json({
      error:  "upstream failed",
      source: e?.source ?? "unknown",
      reason: e?.reason ?? e?.message ?? "unknown",
    });
    return;
  }

  // ── Read stored doc from RTDB ─────────────────────────────────────────────
  let storedDoc = null;
  try {
    const snap = await db.ref(`tenants/${tenantId}/analytics/daily/${BRANCH_ID}/${date}`).get();
    storedDoc = snap.val();
  } catch (e) {
    console.error("[check] RTDB read failed:", e?.message);
  }

  // ── Checksum: compare revenue_total + tickets only (no raw data) ──────────
  const checksum = {
    fresh_revenue:  freshDoc.revenue_total,
    fresh_tickets:  freshDoc.tickets,
    stored_revenue: storedDoc?.revenue_total ?? null,
    stored_tickets: storedDoc?.tickets       ?? null,
    match: storedDoc
      ? (freshDoc.revenue_total === storedDoc.revenue_total &&
         freshDoc.tickets       === storedDoc.tickets)
      : null,
    stored_at: storedDoc?.meta?.createdAt ?? null,
  };

  res.status(200).json({
    tenantId,
    date,
    branchId: BRANCH_ID,
    doc:      freshDoc,   // computed fresh — no raw upstream data
    checksum,
    stored:   storedDoc !== null,
  });
}
