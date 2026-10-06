/**
 * lib/sendEmail.js — send email via Gmail SMTP (nodemailer).
 *
 * Env vars:
 *   SMTP_EMAIL         — Gmail address, e.g. "appmarjin@gmail.com"
 *   SMTP_APP_PASSWORD  — App Password (NOT the regular password).
 *                        Generate at: https://myaccount.google.com/apppasswords
 *   GMAIL_FROM_NAME    — (optional) Display name, defaults to "Marjin"
 */

import nodemailer from "nodemailer";
import { currentDeliveryAttempt, recipientRef } from "./emailDelivery.js";

// Bounded SMTP session (daily e-mail reliability). nodemailer's defaults are a 2-minute connection timeout and a ONE-HOUR
// socket inactivity timeout, so a stalled Gmail session could hold a scheduled run until the platform killed it — with every
// later business left unsent and nothing recorded. These bounds make every send settle; SEND_DEADLINE_MS is the backstop
// for a promise that still never settles (its outcome is then UNKNOWN, see lib/emailDelivery.js).
export const SMTP_TIMEOUTS = Object.freeze({ connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 30000, dnsTimeout: 10000 });
export const SEND_DEADLINE_MS = 60000;
/** The effective backstop: EMAIL_SEND_DEADLINE_MS may only LOWER it (1 ms … SEND_DEADLINE_MS); anything else is ignored. */
function sendDeadlineMs() {
  const v = Number(process.env.EMAIL_SEND_DEADLINE_MS);
  return Number.isInteger(v) && v >= 1 && v <= SEND_DEADLINE_MS ? v : SEND_DEADLINE_MS;
}

let _transporter = null;

function getTransporter() {
  if (_transporter) return _transporter;

  const user = process.env.SMTP_EMAIL;
  const pass = process.env.SMTP_APP_PASSWORD;

  if (!user || !pass) {
    const e = new Error("Missing SMTP_EMAIL or SMTP_APP_PASSWORD env vars");
    e.code = "ECONFIG";
    throw e;
  }

  _transporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user, pass },
    ...SMTP_TIMEOUTS,
  });

  return _transporter;
}

function withDeadline(promise, ms) {
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => { const e = new Error("no provider answer within " + ms + " ms"); e.code = "EDEADLINE"; reject(e); }, ms);
  });
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
}

/**
 * Send a single email.
 * When called inside a delivery attempt (lib/emailDelivery.js deliverWithReceipt), the attempt is marked as handed to the
 * provider BEFORE the message leaves (a failure there aborts the send), the message carries the attempt's deterministic
 * Message-ID (for reconciliation only — SMTP does not de-duplicate on it), and the provider result or error is recorded
 * on the attempt. Logs never contain the recipient address or provider response text.
 * @param {string} to       — recipient email address
 * @param {string} subject  — email subject
 * @param {string} html     — email body (HTML)
 * @returns {Promise<{messageId: string}>}
 */
export async function sendEmail(to, subject, html) {
  const attempt = currentDeliveryAttempt();
  const transporter = getTransporter();
  const fromName = process.env.GMAIL_FROM_NAME || "Marjin";
  const fromAddr = process.env.SMTP_EMAIL;

  if (attempt) await attempt.beforeTransport();
  let info;
  try {
    info = await withDeadline(transporter.sendMail({
      from: `${fromName} <${fromAddr}>`,
      to,
      subject,
      html,
      ...(attempt ? { messageId: attempt.messageId } : {}),
    }), sendDeadlineMs());
  } catch (err) {
    if (attempt) attempt.error = err;
    console.error(`[sendEmail] provider error code=${(err && err.code) || "none"} smtp=${(err && err.responseCode) || "none"} command=${(err && err.command) || "none"} ${recipientRef(to)}`);
    throw err;
  }
  if (attempt) attempt.info = info;
  console.log(`[sendEmail] provider answered for ${recipientRef(to)}, id: ${info.messageId}`);
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
