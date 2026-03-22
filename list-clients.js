// /api/admin/list-clients — returns all tenants (super_owner only)
import { requireAuth } from "../../lib/verifyToken.js";
import { getAdminDb }  from "../../lib/adminSdk.js";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") { res.status(204).end(); return; }
  if (req.method !== "GET") { res.status(405).json({ error: "Method not allowed" }); return; }

  // Auth — must be super_owner
  let claims;
  try { claims = await requireAuth(req); }
  catch { res.status(401).json({ error: "unauthorized" }); return; }

  const db = getAdminDb();

  // Check super_owner across all tenants
  const rolesSnap = await db.ref("tenants").once("value");
  if (!rolesSnap.exists()) {
    res.status(200).json({ clients: [] }); return;
  }

  const isSuperOwner = Object.keys(rolesSnap.val()).some(tenantId => {
    const roles = rolesSnap.val()[tenantId]?.roles || {};
    return roles[claims.uid] === "super_owner";
  });
  if (!isSuperOwner) { res.status(403).json({ error: "forbidden" }); return; }

  // Build client list
  const clients = [];
  const allTenants = rolesSnap.val();

  for (const [tenantId, tenantData] of Object.entries(allTenants)) {
    try {
      // Get biz name from app/business
      const bizSnap = await db.ref(`tenants/${tenantId}/app/business`).once("value");
      let bizName = "";
      let createdAt = null;
      if (bizSnap.exists()) {
        try {
          const bizList = JSON.parse(bizSnap.val()?._v || "[]");
          bizName = bizList[0]?.name || "";
          createdAt = bizList[0]?.createdAt || null;
        } catch(_) {}
      }

      // Get owner from app/users
      const usersSnap = await db.ref(`tenants/${tenantId}/app/users`).once("value");
      let ownerName = "", ownerEmail = "", ownerUsername = "", status = "unknown";
      if (usersSnap.exists()) {
        try {
          const users = JSON.parse(usersSnap.val()?._v || "[]");
          const owner = users.find(u => u.role === "owner" || u.role === "super_owner");
          if (owner) {
            ownerName = owner.name || "";
            ownerEmail = owner.email || "";
            ownerUsername = owner.username || "";
            status = owner.email ? "active" : "invited";
          }
        } catch(_) {}
      }

      // Get invite link if stored
      const inviteSnap = await db.ref(`tenants/${tenantId}/meta/inviteLink`).once("value");
      const inviteLink = inviteSnap.val() || null;

      clients.push({ tenantId, bizName, ownerName, ownerEmail, ownerUsername, status, createdAt, inviteLink });
    } catch(e) {
      console.error(`[list-clients] error reading tenant ${tenantId}:`, e.message);
    }
  }

  // Sort newest first
  clients.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

  res.status(200).json({ clients });
}
