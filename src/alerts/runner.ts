// Marjin â Alert Runner
// Runs all 7 checkers, deduplicates, saves results, sends WhatsApp.
// Called by Vercel cron or manual trigger.

import type { FiredAlert } from "./types.js";
import { getThresholds } from "./configRepo.js";
import { saveAlert, alertExistsToday } from "./alertsRepo.js";
import {
  checkLaborPct,
  checkFoodCostPct,
  checkSupplierAnomaly,
  checkMinRevenue,
  checkExpensiveEmployee,
  checkWeakDay,
  checkPurchaseTrend,
} from "./checkers.js";

// ââ Run All Checks for a Biz ââââââââââââââââââââââââââââââââââââââââââââââââââ

export interface AlertRunResult {
  tenantId: string;
  bizId: string;
  alertsFired: number;
  alertsSkipped: number;
  whatsappSent: number;
  errors: string[];
}

/**
 * Run all 7 checkers for a single biz.
 * Deduplicates (no duplicate alert on same day).
 * Saves to Firebase and optionally sends WhatsApp.
 */
export async function runAlertsForBiz(
  tenantId: string,
  bizId: string
): Promise<AlertRunResult> {
  const result: AlertRunResult = {
    tenantId,
    bizId,
    alertsFired: 0,
    alertsSkipped: 0,
    whatsappSent: 0,
    errors: [],
  };

  // Load user-defined thresholds (or defaults)
  const thresholds = await getThresholds(tenantId, bizId);

  // Collect all alerts from all checkers
  const candidates: FiredAlert[] = [];

  try {
    const labor = await checkLaborPct(tenantId, bizId, thresholds);
    if (labor) candidates.push(labor);
  } catch (e: any) { result.errors.push(`labor: ${e.message}`); }

  try {
    const food = await checkFoodCostPct(tenantId, bizId, thresholds);
    if (food) candidates.push(food);
  } catch (e: any) { result.errors.push(`food: ${e.message}`); }

  try {
    const suppliers = await checkSupplierAnomaly(tenantId, bizId, thresholds);
    candidates.push(...suppliers);
  } catch (e: any) { result.errors.push(`supplier: ${e.message}`); }

  try {
    const revenue = await checkMinRevenue(tenantId, bizId, thresholds);
    if (revenue) candidates.push(revenue);
  } catch (e: any) { result.errors.push(`revenue: ${e.message}`); }

  try {
    const employees = await checkExpensiveEmployee(tenantId, bizId, thresholds);
    candidates.push(...employees);
  } catch (e: any) { result.errors.push(`employee: ${e.message}`); }

  try {
    const weakDays = await checkWeakDay(tenantId, bizId, thresholds);
    candidates.push(...weakDays);
  } catch (e: any) { result.errors.push(`weakday: ${e.message}`); }

  try {
    const purchases = await checkPurchaseTrend(tenantId, bizId, thresholds);
    if (purchases) candidates.push(purchases);
  } catch (e: any) { result.errors.push(`purchases: ${e.message}`); }

  // Deduplicate + save + notify
  for (const alert of candidates) {
    try {
      const exists = await alertExistsToday(tenantId, bizId, alert.id);
      if (exists) {
        result.alertsSkipped++;
        continue;
      }

      await saveAlert(alert);
      result.alertsFired++;

      // WhatsApp notification
      if (thresholds.whatsappEnabled) {
        try {
          const sent = await sendWhatsAppAlert(alert);
          if (sent) {
            alert.notifiedWhatsApp = true;
            await saveAlert(alert); // update flag
            result.whatsappSent++;
          }
        } catch (e: any) {
          result.errors.push(`whatsapp: ${e.message}`);
        }
      }
    } catch (e: any) {
      result.errors.push(`save: ${e.message}`);
    }
  }

  return result;
}

// ââ Run for All Businesses (Cron) âââââââââââââââââââââââââââââââââââââââââââââ

export async function runAlertsForAll(): Promise<AlertRunResult[]> {
  const { getDb } = await import("../firebase/admin.js");
  const db = getDb();

  // Use proactive_biz_index for fast discovery
  const indexSnap = await db.ref("proactive_biz_index").once("value");
  const index = indexSnap.val();

  const results: AlertRunResult[] = [];

  if (!index) return results;

  for (const entry of Object.values(index) as any[]) {
    if (!entry?.tenantId || !entry?.bizId || !entry?.active) continue;
    try {
      const r = await runAlertsForBiz(entry.tenantId, entry.bizId);
      results.push(r);
    } catch (e: any) {
      results.push({
        tenantId: entry.tenantId,
        bizId: entry.bizId,
        alertsFired: 0,
        alertsSkipped: 0,
        whatsappSent: 0,
        errors: [e.message],
      });
    }
  }

  return results;
}

// ââ WhatsApp Notification âââââââââââââââââââââââââââââââââââââââââââââââââââââ

async function sendWhatsAppAlert(alert: FiredAlert): Promise<boolean> {
  const instanceId = process.env.GREENAPI_INSTANCE_ID;
  const token = process.env.GREENAPI_TOKEN;
  const phone = process.env.ALERT_WHATSAPP_PHONE; // owner phone number

  if (!instanceId || !token || !phone) return false;

  const icon = alert.severity === "critical" ? "ð´" : alert.severity === "warning" ? "ð¡" : "ðµ";
  const text = `${icon} *××ª×¨××ª Marjin*\n\n*${alert.title}*\n${alert.message}\n\nð ${alert.date}`;

  try {
    const resp = await fetch(
      `https://api.green-api.com/waInstance${instanceId}/sendMessage/${token}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chatId: phone.replace("+", "") + "@c.us",
          message: text,
        }),
      }
    );
    const data = await resp.json();
    return !!data?.idMessage;
  } catch {
    return false;
  }
}
