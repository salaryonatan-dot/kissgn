import nodemailer from "nodemailer";

let _transporter = null;

function getTransporter() {
  if (!_transporter) {
    const email = process.env.SMTP_EMAIL;
    const pass = process.env.SMTP_APP_PASSWORD;
    if (!email || !pass) throw new Error("Missing SMTP_EMAIL or SMTP_APP_PASSWORD env vars");
    _transporter = nodemailer.createTransport({
      service: "gmail",
      auth: { user: email, pass },
    });
  }
  return _transporter;
}

export async function sendEmail(to, subject, html) {
  const transporter = getTransporter();
  const from = `Marjin <${process.env.SMTP_EMAIL}>`;

  const info = await transporter.sendMail({ from, to, subject, html });
  console.log(`[sendEmail] sent to ${to}, messageId: ${info.messageId}`);
  return { messageId: info.messageId };
}

export async function sendAlertDigest(to, bizName, alerts) {
  if (!alerts || alerts.length === 0) return null;

  const critical = alerts.filter(a => a.severity === "critical").length;
  const warning = alerts.filter(a => a.severity === "warning").length;
  const info = alerts.filter(a => a.severity === "info").length;

  const severityIcon = (s) => {
    if (s === "critical") return "\u{1F534}";
    if (s === "warning") return "\u{1F7E1}";
    return "\u{1F535}";
  };

  const subject = critical > 0
    ? `\u{1F534} ${critical} התראות קריטיות — ${bizName}`
    : `\u{1F4CA} דוח בוקר — ${bizName} — ${alerts.length} תובנות`;

  const alertRows = alerts.map(a => `
    <tr style="border-bottom:1px solid #eee;">
      <td style="padding:10px;font-size:22px;text-align:center;">${severityIcon(a.severity)}</td>
      <td style="padding:10px;">
        <strong style="color:#1a1a1a;">${a.title || a.type}</strong><br/>
        <span style="color:#666;font-size:13px;">${a.message}</span>
      </td>
    </tr>
  `).join("");

  const html = `<!DOCTYPE html>
<html dir="rtl" lang="he">
<head><meta charset="utf-8"/></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:Arial,sans-serif;">
  <div style="max-width:600px;margin:20px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
    <div style="background:linear-gradient(135deg,#667eea 0%,#764ba2 100%);padding:24px;text-align:center;">
      <h1 style="color:#fff;margin:0;font-size:22px;">📊 דוח בוקר — ${bizName}</h1>
      <p style="color:rgba(255,255,255,0.85);margin:8px 0 0;font-size:14px;">Marjin Alert System</p>
    </div>
    <div style="display:flex;justify-content:center;gap:16px;padding:16px;background:#fafafa;border-bottom:1px solid #eee;">
      ${critical > 0 ? `<span style="background:#fee;color:#c00;padding:6px 14px;border-radius:20px;font-size:13px;font-weight:bold;">🔴 ${critical} קריטי</span>` : ""}
      ${warning > 0 ? `<span style="background:#fff8e1;color:#f57f17;padding:6px 14px;border-radius:20px;font-size:13px;font-weight:bold;">🟡 ${warning} אזהרה</span>` : ""}
      ${info > 0 ? `<span style="background:#e3f2fd;color:#1565c0;padding:6px 14px;border-radius:20px;font-size:13px;font-weight:bold;">🔵 ${info} מידע</span>` : ""}
    </div>
    <table style="width:100%;border-collapse:collapse;">
      ${alertRows}
    </table>
    <div style="padding:20px;text-align:center;color:#999;font-size:12px;border-top:1px solid #eee;">
      <p>נשלח אוטומטית ע״י Marjin • <a href="https://kissgn.vercel.app" style="color:#667eea;">כניסה למערכת</a></p>
    </div>
  </div>
</body>
</html>`;

  return sendEmail(to, subject, html);
}
