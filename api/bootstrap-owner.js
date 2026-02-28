/**
 * POST /api/bootstrap-owner
 * Body: { tenantId, uid }
 *
 * One-time bootstrap: creates the first owner for a tenant.
 * Guards:
 *   1. BOOTSTRAP_ENABLED=true required (deleted immediately after use)
 *   2. Warns loudly if NODE_ENV=production
 *   3. Rate-limited (IP + uid)
 *   4. Zero-owner check + RTDB transaction (atomic — race-safe)
 *   5. Caller can only bootstrap themselves
 */

import { requireAuth }                        from "../../lib/verifyToken.js";
import { isRateLimited, errResponse, getIP }  from "../../lib/helpers.js";
import { getAdminDb }                         from "../../lib/adminSdk.js";

export default async function handler(req, res) {

  // ── 1. Feature flag — 404 "opaque" when disabled ─────────────────────────
  if (process.env.BOOTSTRAP_ENABLED !== "true") {
    res.status(404).json({ error: "not found" });
    return;
  }

  // ── 2. Loud warning if accidentally left on in production ─────────────────
  if (process.env.NODE_ENV === "production") {
    console.warn(
      "[bootstrap-owner] WARNING: BOOTSTRAP_ENABLED=true in production. " +
      "Disable immediately after use."
    );
  }

  if (req.method !== "POST") { res.status(405).json({ error: "method not allowed" }); return; }

  // ── 3. Auth ───────────────────────────────────────────────────────────────
  let claims;
  try { claims = await requireAuth(req); }
  catch { res.status(401).json({ error: "unauthorized" }); return; }

  // ── 4. Rate limit — bootstrap is a one-time action, keep very tight ───────
  const ip = getIP(req);
  try {
    if (await isRateLimited(`bootstrap:ip:${ip}`,          3, 60_000)) { res.status(429).json({ error: "too many requests" }); return; }
    if (await isRateLimited(`bootstrap:uid:${claims.uid}`, 2, 60_000)) { res.status(429).json({ error: "too many requests" }); return; }
  } catch (e) { res.status(e.status || 503).json({ error: e.msg || "rate limiter error" }); return; }

  // ── 5. Validate body ──────────────────────────────────────────────────────
  let body;
  try { body = req.body; if (typeof body === "string") body = JSON.parse(body); }
  catch { res.status(400).json({ error: "invalid json" }); return; }

  const { tenantId, uid } = body ?? {};
  if (!tenantId || typeof tenantId !== "string" || tenantId.length > 128) { res.status(400).json({ error: "invalid tenantId" }); return; }
  if (!uid      || typeof uid      !== "string" || uid.length      > 128) { res.status(400).json({ error: "invalid uid" });      return; }
  if (/[.#$\[\]\/]/.test(tenantId) || /[.#$\[\]\/]/.test(uid))               { res.status(400).json({ error: "invalid characters" }); return; }

  // ── 6. Caller may only bootstrap themselves ───────────────────────────────
  if (claims.uid !== uid) { res.status(403).json({ error: "uid mismatch" }); return; }

  const db = getAdminDb();

  // ── 7. RTDB transaction on roles node — race-safe zero-owner check ─────────
  // admin SDK runTransaction reads current value and only commits if our
  // update function returns a non-undefined value; abort by returning undefined.
  let committed = false;
  let txError   = null;

  try {
    const rolesRef = db.ref(`tenants/${tenantId}/roles`);

    const result = await rolesRef.transaction(currentRoles => {
      const roles   = currentRoles ?? {};
      const owners  = Object.values(roles).filter(r => r === "owner");

      // Abort transaction if an owner already exists
      if (owners.length > 0) return undefined;

      // Write the first owner atomically within the transaction
      return { ...roles, [uid]: "owner" };
    });

    committed = result.committed;

  } catch (e) {
    txError = e;
  }

  if (txError) {
    console.error("[bootstrap-owner] transaction failed:", txError?.message);
    res.status(503).json({ error: "db transaction failed" });
    return;
  }

  if (!committed) {
    // Transaction aborted — another owner already exists
    res.status(409).json({ error: "tenant already has an owner" });
    return;
  }

  // ── 8. Write membership + audit atomically (role already written above) ────
  try {
    const auditKey = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    await db.ref().update({
      [`tenants/${tenantId}/members/${uid}`]:          true,
      [`tenants/${tenantId}/audit/roles/${auditKey}`]: {
        ts:        Date.now(),
        actorUid:  uid,
        targetUid: uid,
        role:      "owner",
        note:      "bootstrap",
      },
    });
  } catch (e) {
    // Role already written — log the membership/audit failure but don't fail the request
    console.error("[bootstrap-owner] membership/audit write failed:", e?.message);
  }

  res.status(200).json({ ok: true, tenantId, uid, role: "owner" });
}
