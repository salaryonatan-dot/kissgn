// api/whatsapp.js
//
// SECURITY (PR #2A): this route is DISABLED and fails closed.
//
// The previous handler exposed an authenticated-ONLY WhatsApp send backed by
// SHARED provider credentials, with no tenant/business/role authorization, no
// recipient allowlist, no template restriction, no rate limiting, no audit and
// no attribution (tenantId was read but ignored) — a latent unauthorized-send
// P0. It was also non-functional (imported a non-existent export, crashing the
// function). Rather than repair the send path, the endpoint is disabled.
//
// This endpoint now returns a stable 410 for every method, BEFORE any auth or
// provider/network call — no WhatsApp message is ever sent.

export default async function handler(req, res) {
  const allowedOrigin = process.env.ALLOWED_ORIGIN || "https://kissgn.vercel.app";
  const incoming = req.headers.origin || "";
  if (incoming && incoming === allowedOrigin) {
    res.setHeader("Access-Control-Allow-Origin", allowedOrigin);
  }
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Vary", "Origin");

  if (req.method === "OPTIONS") return res.status(204).end();
  return res.status(410).json({ error: "unsupported_action", action: "whatsapp" });
}
