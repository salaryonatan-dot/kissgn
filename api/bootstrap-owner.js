// api/bootstrap-owner.js
//
// SECURITY: this legacy route is DISABLED and fails closed.
//
// The active first-owner setup flow uses `/api/admin?action=bootstrap-self`.
// This legacy endpoint accepted a caller-supplied tenantId and wrote with the
// Admin SDK, bypassing RTDB Rules. It now returns a stable 410 before any auth
// or DB access, matching the disabled-endpoint pattern used by create-tenant
// and whatsapp.

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
  return res.status(410).json({ error: "unsupported_action", action: "bootstrap-owner" });
}
