/**
 * lib/sendEmail.js — send email via Resend API.
 *
 * Why Resend (and not Gmail SMTP)?
 *   Gmail SMTP works but blasts mail with mismatched SPF/DKIM/DMARC, which
 *   corporate mail servers silently drop. Resend signs every message with
 *   proper auth headers so corporate inboxes accept it.
 *
 * Env vars:
 *   RESEND_API_KEY — Resend API key (starts with "re_")
 *   RESEND_FROM    — verified sender, e.g. "Marjin Alerts <alerts@marjin.co.il>"
 *                    (optional — falls back to "Marjin <onboarding@resend.dev>"
 *                    which is Resend's shared sandbox sender, fine for testing
 *                    but limited in deliverability and daily volume)
 */

import { Resend } from "resend";

let _resend = null;

function getResend() {
  if (_resend) return _resend;

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    throw new Error("Missing RESEND_API_KEY env var");
  }

  _resend = new Resend(apiKey);
  return _resend;
}

/**
 * Send a single email.
 * @param {string} to       — recipient email address
 * @param {string} subject  — email subject
 * @param {string} html     — email body (HTML)
 * @returns {Promise<{messageId: string}>}
 */
export async function sendEmail(to, subject, html) {
  const resend = getResend();
  const from = process.env.RESEND_FROM || "Marjin <onboarding@resend.dev>";

  const { data, error } = await resend.emails.send({
    from,
    to: [to],
    subject,
    html,
  });

  if (error) {
    // Resend returns a structured error object — surface its message so
    // callers (and Vercel logs) get something actionable instead of "[object]".
    const msg = error.message || error.name || JSON.stringify(error);
    throw new Error(`Resend send failed: ${msg}`);
  }

  console.log(`[sendEmail] sent to ${to}, id: ${data?.id}`);
  return { messageId: data?.id };
}

/**
 * Build and send a daily alerts digest email for a business.
 * @param {string} to         — recipient email
 * @param {string} bizName    — business name
 * @param {Array}  alerts     — array of FiredAlert objects
 * @returns {Promise<{messageId: string}>}
 */
export async function sendAlertDigest(to, bizName, alerts) {
  if (!alerts || alerts.length === 0) return null;

  const today = new Date().toLocaleDateString("he-IL", {
    year: "numeric", month: "long", day: "numeric",
  });

  const severityIcon = (s) =>
    s === "critical" ? "🔴" : s === "warning" ? "🟡" : "🔵";

  const alertRows = alerts.map(a => `
    <tr style="border-bottom:1px solid #eee;">
      <td style="padding:12px 8px;font-size:20px;text-align:center;width:40px;">
        ${severityIcon(a.severity)}
      </td>
      <td style="padding:12px 8px;">
        <strong style="color:#1a1a1a;">${a.title}</strong><br/>
        <span style="color:#555;font-size:14px;">${a.message}</span>
      </td>
    </tr>
  `).join("");

  const criticalCount = alerts.filter(a => a.severity === "critical").length;
  const warningCount  = alerts.filter(a => a.severity === "warning").length;
  const infoCount     = alerts.filter(a => a.severity === "info").length;

  const summaryParts = [];
  if (criticalCount > 0) summaryParts.push(`🔴 ${criticalCount} קריטי`);
  if (warningCount > 0)  summaryParts.push(`🟡 ${warningCount} אזהרה`);
  if (infoCount > 0)     summaryParts.push(`🔵 ${infoCount} מידע`);
  const summaryText = summaryParts.join("  ·  ");

  const subject = criticalCount > 0
    ? `🔴 ${criticalCount} התראות קריטיות — ${bizName}`
    : `📊 דוח בוקר — ${bizName} — ${alerts.length} תובנות`;

  const html = `
<!DOCTYPE html>
<html dir="rtl" lang="he">
<head><meta charset="UTF-8"/></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:'Segoe UI',Tahoma,sans-serif;">
  <div style="max-width:600px;margin:20px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">

    <!-- Header -->
    <div style="background:linear-gradient(135deg,#111827,#1f2937);padding:24px 28px;color:#fff;">
      <h1 style="margin:0;font-size:22px;">📊 דוח בוקר — Marjin</h1>
      <p style="margin:6px 0 0;opacity:0.8;font-size:14px;">${bizName} · ${today}</p>
    </div>

    <!-- Summary bar -->
    <div style="background:#f9fafb;padding:14px 28px;border-bottom:1px solid #e5e7eb;font-size:15px;color:#374151;">
      ${summaryText} · סה״כ ${alerts.length} תובנות
    </div>

    <!-- Alerts table -->
    <table style="width:100%;border-collapse:collapse;">
      ${alertRows}
    </table>

    <!-- Footer -->
    <div style="padding:20px 28px;background:#f9fafb;border-top:1px solid #e5e7eb;text-align:center;">
      <p style="margin:0;font-size:13px;color:#9ca3af;">
        נשלח אוטומטית מ-Marjin · <a href="https://kissgn.vercel.app" style="color:#6366f1;">כניסה למערכת</a>
      </p>
    </div>

  </div>
</body>
</html>
  `.trim();

  return sendEmail(to, subject, html);
}
