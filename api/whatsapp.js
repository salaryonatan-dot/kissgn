// POST /api/whatsapp — send WhatsApp message via Green API
// Internal use only — called from other API endpoints or frontend (owner/manager only)
import { requireAuth }                        from "../lib/verifyToken.js";
import { requireTenantAccess, isRateLimited, getIP } from "../lib/helpers.js";

const INSTANCE_ID = process.env.GREENAPI_INSTANCE_ID;
const TOKEN       = process.env.GREENAPI_TOKEN;
const BASE_URL    = `https://api.green-api.com/waInstance${INSTANCE_ID}`;

/**
 * Send a WhatsApp message to a phone number.
 * @param {string} phone  - e.g. "972542098158"
 * @param {string} message
 */
export async function sendWhatsApp(phone, message) {
  if (!INSTANCE_ID || !TOKEN) throw new Error("Green API credentials missing");
  // Groups end with @g.us, individuals with @c.us
  const chatId = phone.includes("@") ? phone
    : /^[0-9]{15,}$/.test(phone) ? `${phone}@g.us`   // long number = group ID
    : `${phone}@c.us`;                                  // regular phone
  const res = await fetch(`${BASE_URL}/sendMessage/${TOKEN}`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ chatId, message }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.status);
    throw new Error(`Green API error: ${res.status} — ${text}`);
  }
  return await res.json();
}

// HTTP endpoint — POST /api/whatsapp
export default async function handler(req, res) {
  if (req.method !== "POST") { res.status(405).json({ error: "method not allowed" }); return; }

  try {
    const user = await requireAuth(req);
    const { tenantId, phone, message } = req.body || {};
    if (!tenantId || !message) { res.status(400).json({ error: "tenantId and message required" }); return; }

    await requireTenantAccess(user.uid, tenantId, "manager");

    const ip = getIP(req);
    if (await isRateLimited(`wa:${user.uid}`, 10, 60_000)) {
      res.status(429).json({ error: "too many requests" }); return;
    }

    const recipient = phone || process.env.GREENAPI_RECIPIENT;
    if (!recipient) { res.status(400).json({ error: "no recipient" }); return; }

    const result = await sendWhatsApp(recipient, message);
    res.status(200).json({ ok: true, result });
  } catch (e) {
    console.error("[whatsapp]", e.message);
    res.status(500).json({ error: e.message });
  }
}
