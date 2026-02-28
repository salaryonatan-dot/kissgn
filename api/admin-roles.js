// Node.js serverless runtime — NOT Edge

import { requireAuth }                                from "../../lib/verifyToken.js";
import { requireTenantAccess, isRateLimited,
         getIP, VALID_ROLES }                         from "../../lib/helpers.js";
import { getAdminDb }                                 from "../../lib/adminSdk.js";

const RTDB_FORBIDDEN = /[.#$\[\]\/]/;

export default async function handler(req, res) {
  if (req.method !== "POST") { res.status(405).json({ error: "method not allowed" }); return; }

  // ── 1. Auth ────────────────────────────────────────────────────────────────
  let claims;
  try { claims = await requireAuth(req); }
  catch { res.status(401).json({ error: "unauthorized" }); return; }

  // ── 2. Rate limit ──────────────────────────────────────────────────────────
  const ip = getIP(req);
  try {
    if (await isRateLimited(`roles:ip:${ip}`,          5, 60_000)) { res.status(429).json({ error: "too many requests" }); return; }
    if (await isRateLimited(`roles:uid:${claims.uid}`, 5, 60_000)) { res.status(429).json({ error: "too many requests" }); return; }
  } catch (e) { res.status(e.status || 503).json({ error: e.msg || "rate limiter error" }); return; }

  // ── 3. Parse + validate body ───────────────────────────────────────────────
  let body;
  try { body = req.body; if (typeof body === "string") body = JSON.parse(body); }
  catch { res.status(400).json({ error: "invalid json" }); return; }

  const { tenantId, targetUid, role } = body ?? {};

  if (!tenantId  || typeof tenantId  !== "string" || tenantId.length  > 128) { res.status(400).json({ error: "invalid tenantId"  }); return; }
  if (!targetUid || typeof targetUid !== "string" || targetUid.length > 128) { res.status(400).json({ error: "invalid targetUid" }); return; }
  if (role !== null && !VALID_ROLES.has(role))                                { res.status(400).json({ error: "invalid role"       }); return; }
  // D2: forbidden chars on both ids — prevents RTDB path injection
  if (RTDB_FORBIDDEN.test(tenantId) || RTDB_FORBIDDEN.test(targetUid))       { res.status(400).json({ error: "invalid characters" }); return; }

  // ── 4. Verify caller is owner (RTDB membership + role check) ──────────────
  try { await requireTenantAccess(claims.uid, tenantId, "owner"); }
  catch (e) { res.status(e.status || 403).json({ error: e.msg || "forbidden" }); return; }

  const db = getAdminDb();

  // ── 5. Last-owner protection via RTDB transaction (race-safe) ──────────────
  // Transaction on roles node: read-modify-commit atomically.
  // Abort if the change would leave zero owners.
  if (role !== "owner") {
    let committed = false;
    let txError   = null;
    let txAbortReason = null;

    try {
      const result = await db.ref(`tenants/${tenantId}/roles`).transaction(currentRoles => {
        const roles  = currentRoles ?? {};
        const owners = Object.entries(roles).filter(([, r]) => r === "owner").map(([uid]) => uid);

        // Abort: removing/downgrading the last owner
        if (owners.length === 1 && owners[0] === targetUid) {
          txAbortReason = "last-owner";
          return undefined; // abort
        }

        // Apply the change inside the transaction
        if (role === null) {
          const updated = { ...roles };
          delete updated[targetUid];
          return updated;
        }
        return { ...roles, [targetUid]: role };
      });

      committed = result.committed;
    } catch (e) {
      txError = e;
    }

    if (txError) {
      console.error("[admin-roles] transaction failed:", txError?.message);
      res.status(503).json({ error: "db transaction failed" });
      return;
    }
    if (!committed) {
      if (txAbortReason === "last-owner") {
        res.status(409).json({ error: "cannot remove or downgrade the last owner" });
      } else {
        res.status(409).json({ error: "role update aborted" });
      }
      return;
    }

  } else {
    // Setting to owner: simple write (no last-owner risk)
    try {
      await db.ref(`tenants/${tenantId}/roles/${targetUid}`).set(role);
    } catch (e) {
      console.error("[admin-roles] role write failed:", e?.message);
      res.status(502).json({ error: "db write failed" });
      return;
    }
  }

  // ── 6. Write membership + audit atomically ─────────────────────────────────
  // Role already written atomically above; now sync membership + audit.
  try {
    // Use DB push() key — guaranteed unique, no collision risk
    const auditRef = db.ref(`tenants/${tenantId}/audit/roles`).push();
    const updates  = {
      [`tenants/${tenantId}/members/${targetUid}`]:           role === null ? null : true,
      [`tenants/${tenantId}/audit/roles/${auditRef.key}`]:    {
        ts:        Date.now(),
        actorUid:  claims.uid,
        targetUid,
        role:      role ?? "REMOVED",
      },
    };
    await db.ref().update(updates);
  } catch (e) {
    // Role already written — log but don't fail the request
    console.error("[admin-roles] membership/audit write failed:", e?.message);
  }

  res.status(200).json({ ok: true, tenantId, targetUid, role });
}
