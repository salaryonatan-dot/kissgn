import { getAdminDb, getAdminAuth } from "../lib/adminSdk.js";

export default async function handler(req, res) {
  const allowedOrigin = process.env.ALLOWED_ORIGIN || "https://kissgn.vercel.app";
  const incoming = req.headers.origin || "";
  if (incoming && incoming === allowedOrigin) {
    res.setHeader("Access-Control-Allow-Origin", allowedOrigin);
  }
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Vary", "Origin");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    // Verify Firebase ID token
    const authHeader = req.headers.authorization || "";
    const idToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!idToken) {
      return res.status(401).json({ error: "Missing Authorization header" });
    }

    const auth = getAdminAuth();
    const decoded = await auth.verifyIdToken(idToken);
    const uid = decoded.uid;

    const { tenantId, businessName, ownerName, phone } = req.body || {};
    if (!tenantId || !businessName) {
      return res.status(400).json({ error: "tenantId and businessName required" });
    }

    const db = getAdminDb();
    const now = new Date().toISOString();

    // Bootstrap: create tenant + owner using Admin SDK (bypasses RTDB rules)
    const updates = {};
    updates[`tenants/${tenantId}/businessName`] = businessName;
    updates[`tenants/${tenantId}/createdAt`] = now;
    updates[`tenants/${tenantId}/owner`] = uid;
    updates[`tenants/${tenantId}/plan`] = "free";
    updates[`tenants/${tenantId}/users/${uid}/role`] = "owner";
    updates[`tenants/${tenantId}/users/${uid}/displayName`] = ownerName || decoded.name || "";
    updates[`tenants/${tenantId}/users/${uid}/phone`] = phone || "";
    updates[`tenants/${tenantId}/users/${uid}/joinedAt`] = now;

    await db.ref().update(updates);

    return res.status(200).json({ ok: true, tenantId });
  } catch (err) {
    console.error("[bootstrap-owner]", err);
    return res.status(err.status || 500).json({ error: err.message || "Internal error" });
  }
}
