// api/create-tenant.js
//
// SECURITY (PR #2A): this route is DISABLED and fails closed.
//
// The previous handler was gated on requireAuth ONLY and performed a destructive
// Admin-SDK `.set()` on `tenants/${tenantId}` using a caller-supplied tenantId.
// Because `.set()` replaces the entire node, any authenticated user could
// overwrite/WIPE ANY tenant's subtree (roles, members, biz_access, all business
// data) by supplying that tenant's id — an unauthorized cross-tenant
// data-destruction P0. The Admin SDK bypasses RTDB Rules, so Rules did not help.
//
// Legitimate tenant provisioning is the super_owner-gated `create-client` flow
// in api/admin.js; first-owner bootstrap is `/api/admin?action=bootstrap-self`.
// (index.html only MENTIONS create-tenant in a stale comment — it is not fetched.)
// This endpoint now returns a stable 410 for every method, BEFORE any auth or DB
// access — no read, no write, no side effect.

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
  return res.status(410).json({ error: "unsupported_action", action: "create-tenant" });
}
