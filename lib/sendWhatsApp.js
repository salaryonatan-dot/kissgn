/**
 * lib/sendWhatsApp.js — send a WhatsApp text message via Green API.
 *
 * Env vars:
 *   GREENAPI_INSTANCE_ID   — Green API instance id
 *   GREENAPI_TOKEN         — Green API token
 */

export async function sendWhatsApp(phone, message) {
  const instanceId = process.env.GREENAPI_INSTANCE_ID;
  const token      = process.env.GREENAPI_TOKEN;

  if (!instanceId || !token) {
    throw new Error("Missing GREENAPI_INSTANCE_ID or GREENAPI_TOKEN env vars");
  }

  // Normalise phone: strip leading +, ensure @c.us suffix
  let chatId = phone.replace(/^\+/, "").replace(/\D/g, "");
  if (!chatId.endsWith("@c.us")) chatId += "@c.us";

  const url = `https://api.green-api.com/waInstance${instanceId}/sendMessage/${token}`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chatId, message }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Green API ${res.status}: ${text}`);
  }

  return res.json();
}
