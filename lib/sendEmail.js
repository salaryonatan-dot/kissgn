/**
 * lib/sendEmail.js â send email via Gmail SMTP (nodemailer).
 *
 * Env vars:
 *   GMAIL_USER         â Gmail address, e.g. "appmarjin@gmail.com"
 *   GMAIL_APP_PASSWORD â App Password (NOT the regular password).
 *                        Generate at: https://myaccount.google.com/apppasswords
 *   GMAIL_FROM_NAME    â (optional) Display name, defaults to "Marjin"
 */

import nodemailer from "nodemailer";

let _transporter = null;

function getTransporter() {
  if (_transporter) return _transporter;

  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;

  if (!user || !pass) {
    throw new Error("Missing GMAIL_USER or GMAIL_APP_PASSWORD env vars");
  }

  _transporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user, pass },
  });

  return _transporter;
}

/**
 * Send a single email.
 * @param {string} to       â recipient email address
 * @param {string} subject  â email subject
 * @param {string} html     â email body (HTML)
 * @returns {Promise<{messageId: string}>}
 */
export async function sendEmail(to, subject, html) {
  const transporter = getTransporter();
  const fromName = process.env.GMAIL_FROM_NAME || "Marjin";
  const fromAddr = process.env.GMAIL_USER;

  const info = await transporter.sendMail({
    from: `${fromName} <${fromAddr}>`,
    to,
    subject,
    html,
  });

  console.log(`[sendEmail] sent to ${to}, id: ${info.messageId}`);
  return { messageId: info.messageId };
}

/**
 * Build and send a daily alerts digest email for a business.
 * @param {string} to         â recipient email
 * @param {string} bizName    â business name
 * @param {Array}  alerts     â array of FiredAlert objects
 * @returns {Promise<{messageId: string}>}
 */
export async function sendAlertDigest(to, bizName, alerts) {
  if (!alerts || alerts.length === 0) return null;

  const today = new Date().toLocaleDateString("he-IL", {
    year: "numeric", month: "long", day: "numeric",
  });

  const severityIcon = (s) =>
    s === "critical" ? "ð´" : s === "warning" ? "ð¡" : "ðµ";

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
  if (criticalCount > 0) summaryParts.push(`ð´ ${criticalCount} ×§×¨×××`);
  if (warningCount > 0)  summaryParts.push(`ð¡ ${warningCount} ××××¨×`);
  if (infoCount > 0)     summaryParts.push(`ðµ ${infoCount} ××××¢`);
  const summaryText = summaryParts.join("  Â·  ");

  const subject = criticalCount > 0
    ? `ð´ ${criticalCount} ××ª×¨×××ª ×§×¨×××××ª â ${bizName}`
    : `ð ××× ×××§×¨ â ${bizName} â ${alerts.length} ×ª××× ××ª`;

  const html = `
<!DOCTYPE html>
<html dir="rtl" lang="he">
<head><meta charset="UTF-8"/></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:'Segoe UI',Tahoma,sans-serif;">
  <div style="max-width:600px;margin:20px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">

    <!-- Header -->
    <div style="background:linear-gradient(135deg,#111827,#1f2937);padding:24px 28px;color:#fff;">
      <h1 style="margin:0;font-size:22px;">ð ××× ×××§×¨ â Marjin</h1>
      <p style="margin:6px 0 0;opacity:0.8;font-size:14px;">${bizName} Â· ${today}</p>
    </div>

    <!-- Summary bar -->
    <div style="background:#f9fafb;padding:14px 28px;border-bottom:1px solid #e5e7eb;font-size:15px;color:#374151;">
      ${summaryText} Â· ×¡××´× ${alerts.length} ×ª××× ××ª
    </div>

    <!-- Alerts table -->
    <table style="width:100%;border-collapse:collapse;">
      ${alertRows}
    </table>

    <!-- Footer -->
    <div style="padding:20px 28px;background:#f9fafb;border-top:1px solid #e5e7eb;text-align:center;">
      <p style="margin:0;font-size:13px;color:#9ca3af;">
        × ×©×× ××××××××ª ×-Marjin Â· <a href="https://kissgn.vercel.app" style="color:#6366f1;">×× ××¡× ×××¢×¨××ª</a>
      </p>
    </div>

  </div>
</body>
</html>
  `.trim();

  return sendEmail(to, subject, html);
}
