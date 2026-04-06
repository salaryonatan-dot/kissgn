/**
 * lib/sendEmail.js — send email via Gmail SMTP using nodemailer.
 *
 * Env vars:
 *   SMTP_EMAIL        — Gmail address (e.g. appmarjin@gmail.com)
 *   SMTP_APP_PASSWORD — Google App Password (16 chars, no spaces)
 */

import nodemailer from "nodemailer";

let _transporter = null;

function getTransporter() {
  if (_transporter) {
    console.log("[sendEmail][debug] reusing cached transporter");
    return _transporter;
  }

  const user = process.env.SMTP_EMAIL;
  const pass = process.env.SMTP_APP_PASSWORD;

  console.log(`[sendEmail][debug] creating transporter — SMTP_EMAIL exists=${!!user} (length=${user?.length || 0}), SMTP_APP_PASSWORD exists=${!!pass} (length=${pass?.length || 0})`);

  if (!user || !pass) {
    throw new Error("Missing SMTP_EMAIL or SMTP_APP_PASSWORD env vars");
  }

  _transporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user, pass },
  });
  console.log("[sendEmail][debug] transporter created successfully");

  return _transporter;
}

/**
 * Send a single email.
 * @param {string} to       — recipient email address
 * @param {string} subject  — email subject
 * @param {string} html     — email body (HTML)
 * @returns {Promise<{messageId: string}>}
 */
export async function sendEmail(to, subject, html) {
  console.log(`[sendEmail][debug] sendEmail called — to=${to}, subject length=${subject?.length}`);
  const transporter = getTransporter();
  const from = `Marjin Alerts <${process.env.SMTP_EMAIL}>`;

  console.log(`[sendEmail][debug] calling sendMail — from=${from}, to=${to}`);
  const info = await transporter.sendMail({ from, to, subject, html });
  console.log(`[sendEmail] sent to ${to}, messageId: ${info.messageId}`);
  return { messageId: info.messageId };
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
