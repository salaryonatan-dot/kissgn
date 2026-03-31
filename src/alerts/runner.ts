// Marjin — Alert Runner
// Runs all 7 checkers, deduplicates, saves results, sends email digest.
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

// -- Run All Checks for a Biz --

export interface AlertRunResult {
  tenantId: string;
  bizId: string;
  alertsFired: number;
  alertsSkipped: number;
  emailSent: boolean;
  errors: string[];
}

/**
 * Run all 7 checkers for a single biz.
 * Deduplicates (no duplicate alert on same day).
 * Saves to Firebase and sends email digest.
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
    emailSent: false,
    errors: [],
  };

  const thresholds = await getThresholds(tenantId, bizId);
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

  // Deduplicate + save
  const firedAlerts: FiredAlert[] = [];
  for (const alert of candidates) {
    try {
      const exists = await alertExistsToday(tenantId, bizId, alert.id);
      if (exists) {
        result.alertsSkipped++;
        continue;
      }
      await saveAlert(alert);
      result.alertsFired++;
      firedAlerts.push(alert);
    } catch (e: any) {
      result.errors.push(`save: ${e.message}`);
    }
  }

  // Send email digest (one email with all alerts)
  if (firedAlerts.length > 0) {
    try {
      const sent = await sendEmailDigestForBiz(tenantId, bizId, firedAlerts);
      result.emailSent = sent;
    } catch (e: any) {
      result.errors.push(`email: ${e.message}`);
    }
  }

  return result;
}

// -- Run for All Businesses (Cron) --

export async function runAlertsForAll(): Promise<AlertRunResult[]> {
  const { getDb } = await import("../firebase/admin.js");
  const db = getDb();

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
        emailSent: false,
        errors: [e.message],
      });
    }
  }

  return results;
}

// -- Email Digest Notification --

async function sendEmailDigestForBiz(
  tenantId: string,
  bizId: string,
  alerts: FiredAlert[]
): Promise<boolean> {
  const { getDb } = await import("../firebase/admin.js");
  const db = getDb();

  // Look up owner email
  let ownerEmail: string | null = null;
  try {
    const usersSnap = await db.ref(`tenants/${tenantId}/app/users`).once("value");
    const users = usersSnap.val();
    if (users) {
      for (const u of Object.values(users) as any[]) {
        if (u?.email && !u.email.endsWith("@temp.marjin.app")) {
          ownerEmail = u.email;
          break;
        }
      }
    }
  } catch {}

  if (!ownerEmail) {
    ownerEmail = process.env.ALERT_FALLBACK_EMAIL || null;
  }
  if (!ownerEmail) return false;

  // Get business name
  let bizName = bizId;
  try {
    const bizSnap = await db.ref(`tenants/${tenantId}/app/business`).once("value");
    const bizData = bizSnap.val();
    if (bizData?.name) bizName = bizData.name;
  } catch {}

  // Send digest email
  const { sendAlertDigest } = await import("../../lib/sendEmail.js");
  const emailAlerts = alerts.map(a => ({
    severity: a.severity || "info",
    title: a.title || a.type || a.id,
    message: a.message || "",
    type: a.type || a.id,
  }));

  await sendAlertDigest(ownerEmail, bizName, emailAlerts);
  return true;
}
