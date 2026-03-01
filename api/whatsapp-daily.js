// POST /api/whatsapp-daily — send daily WhatsApp report to all tenant recipients
// Called by Vercel cron at 21:00 UTC (23:00-00:00 Israel)
import { getAdminDb }          from "../lib/adminSdk.js";
import { sendWhatsApp }        from "./whatsapp.js";
import { dailyReportMessage }  from "../lib/whatsappMessages.js";
import crypto                  from "crypto";

const CRON_SECRET        = process.env.CRON_SECRET;
const FALLBACK_RECIPIENT = process.env.GREENAPI_RECIPIENT; // fallback if no recipients configured

function timingSafeEqual(a, b) {
  try { return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b)); }
  catch { return false; }
}

export default async function handler(req, res) {
  if (req.method !== "POST") { res.status(405).end(); return; }

  const secret = req.headers["x-cron-secret"] || req.headers["authorization"]?.replace("Bearer ", "");
  if (!CRON_SECRET || !secret || !timingSafeEqual(secret, CRON_SECRET)) {
    res.status(401).json({ error: "unauthorized" }); return;
  }

  const db = getAdminDb();
  const yesterday = (() => {
    const d = new Date(); d.setDate(d.getDate() - 1);
    return d.toISOString().slice(0, 10);
  })();

  const snap = await db.ref("tenants").once("value");
  if (!snap.exists()) { res.status(200).json({ sent: 0 }); return; }

  const results = [];

  for (const [tenantId, tenant] of Object.entries(snap.val())) {
    try {
      // Get business config (contains whatsappRecipients list)
      const bizKeys = Object.keys(tenant).filter(k => k.startsWith("biz_") && k.endsWith(":config"));
      let config = {};
      for (const key of bizKeys) {
        const val = tenant[key];
        if (val?._v) { try { config = JSON.parse(val._v); } catch(_){} break; }
      }

      // Also try app/business to get biz name
      const bizName = config.businessName || tenantId;

      // Build recipients list — group ID takes priority
      const recipients = [];
      if (config.whatsappGroupId) {
        recipients.push({ phone: config.whatsappGroupId, name: "group" });
      } else if (config.whatsappRecipients?.length > 0) {
        recipients.push(...config.whatsappRecipients.filter(r => r.phone));
      } else if (FALLBACK_RECIPIENT) {
        recipients.push({ phone: FALLBACK_RECIPIENT, name: "Owner" });
      }
      if (recipients.length === 0) {
        results.push({ tenantId, skipped: "no recipients configured" }); continue;
      }

      // Get analytics doc for yesterday
      const docSnap = await db.ref(`tenants/${tenantId}/analytics/daily/main/${yesterday}`).once("value");
      if (!docSnap.exists()) { results.push({ tenantId, skipped: "no analytics data" }); continue; }
      const doc = docSnap.val();

      const targets = config.targets || {};
      const vat     = 1.18;
      const sales   = (doc.revenue_total || 0) / vat;
      const entry   = {
        total_sales: doc.revenue_total || 0,
        food_cost:   0,
        payroll:     doc.staffing?.total_hours ? doc.staffing.total_hours * 35 : 0,
      };

      const msg = dailyReportMessage({ bizName, date: yesterday, entry, targets });

      // Send to all recipients
      const sent = [];
      for (const r of recipients) {
        try {
          await sendWhatsApp(r.phone, msg);
          sent.push(r.name || r.phone);
        } catch(e) {
          console.error(`[whatsapp-daily] ${tenantId} → ${r.phone}:`, e.message);
        }
      }
      results.push({ tenantId, sent });
    } catch (e) {
      console.error(`[whatsapp-daily] tenant ${tenantId}:`, e.message);
      results.push({ tenantId, error: e.message });
    }
  }

  res.status(200).json({ date: yesterday, results });
}
