// /api/whatsapp — send WhatsApp message via Green API
import { requireAuth } from "../lib/verifyToken.js";
import { sendWhatsAppMessage } from "../lib/whatsappMessages.js";

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

  // GET — health check / status
  if (req.method === "GET") {
    const instanceId = process.env.GREENAPI_INSTANCE_ID;
    const token = process.env.GREENAPI_TOKEN;
    if (!instanceId || !token) {
      return res.status(200).json({ status: "not_configured" });
    }
    try {
      const resp = await fetch(
        `https://api.green-api.com/waInstance${instanceId}/getStateInstance/${token}`
      );
      const data = await resp.json();
      return res.status(200).json({ status: data.stateInstance || "unknown" });
    } catch (err) {
      return res.status(200).json({ status: "error", message: err.message });
    }
  }

  // POST — send message
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    await requireAuth(req);
    const { phone, message, tenantId } = req.body || {};

    if (!phone || !message) {
      return res.status(400).json({ error: "phone and message are required" });
    }

    const result = await sendWhatsAppMessage(phone, message);
    return res.status(200).json({ ok: true, ...result });
  } catch (err) {
    console.error("[whatsapp]", err);
    return res.status(err.status || 500).json({ error: err.message || "Internal error" });
  }
}
