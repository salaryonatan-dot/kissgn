import { getAdminDb, getAdminAuth } from "../lib/adminSdk.js";
import { requireAuth } from "../lib/verifyToken.js";

export default async function handler(req, res) {
  // CORS
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
    const user = await requireAuth(req);
    const { tenantId, businessName, ownerName, phone } = req.body || {};

    if (!tenantId || !businessName) {
      return res.status(400).json({ error: "tenantId and businessName are required" });
    }

    const db = getAdminDb();
    const now = new Date().toISOString();

    // Create tenant node
    await db.ref(`tenants/${tenantId}`).set({
      businessName,
      createdAt: now,
      owner: user.uid,
      plan: "free",
    });

    // Create user role
    await db.ref(`tenants/${tenantId}/users/${user.uid}`).set({
      role: "owner",
      displayName: ownerName || user.name || "",
      phone: phone || "",
      joinedAt: now,
    });

    return res.status(200).json({ ok: true, tenantId });
  } catch (err) {
    console.error("[create-tenant]", err);
    return res.status(err.status || 500).json({ error: err.message || "Internal error" });
  }
}
