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

// ── Run All Checks for a Biz ──────────────────────────────────────────────────

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
 * Saves to Firebase and collects alerts for email digest.
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

  // Send email digest if there are alerts
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

// ── Run for All Businesses (Cron) ─────────────────────────────────────────────

export async function runAlertsForAll(): Promise<AlertRunResult[]> {
  const { getDb } = await import("../firebase/admin.js");
  const db = getDb();

  const results: AlertRunResult[] = [];

  // Try proactive_biz_index first (fast path)
  let entries: { tenantId: string; bizId: string }[] = [];

  const indexSnap = await db.ref("proactive_biz_index").once("value");
  const index = indexSnap.val();

  if (index) {
    for (const entry of Object.values(index) as any[]) {
      if (entry?.tenantId && entry?.bizId && entry?.active) {
        entries.push({ tenantId: entry.tenantId, bizId: entry.bizId });
      }
    }
  }

  // Fallback: discover businesses directly from tenants/ if index is empty
  if (entries.length === 0) {
    console.log("[alerts] proactive_biz_index empty — discovering from tenants/");
    try {
      const tenantsSnap = await db.ref("tenants").once("value");
      const tenants = tenantsSnap.val();
      if (tenants) {
        for (const [tenantId, tenantData] of Object.entries(tenants) as any[]) {
          // Look for business list in app/business
          try {
            const bizRaw = tenantData?.app?.business?._v;
            if (bizRaw) {
              const bizList = JSON.parse(bizRaw);
              if (Array.isArray(bizList) && bizList.length > 0) {
                const bizId = bizList[0]?.id || "0";
                entries.push({ tenantId, bizId: String(bizId) });
              }
            }
          } catch (_) {
            // If biz has data at all, try with bizId "0"
            if (tenantData?.app?.daily || tenantData?.app?.monthly) {
              entries.push({ tenantId, bizId: "0" });
            }
          }
        }
      }
    } catch (e: any) {
      console.error("[alerts] fallback discovery failed:", e.message);
    }
  }

  console.log(`[alerts] running for ${entries.length} businesses`);

  for (const { tenantId, bizId } of entries) {
    try {
      const r = await runAlertsForBiz(tenantId, bizId);
      results.push(r);
    } catch (e: any) {
      results.push({
        tenantId,
        bizId,
        alertsFired: 0,
        alertsSkipped: 0,
        emailSent: false,
        errors: [e.message],
      });
    }
  }

  return results;
}

// ── Email Digest ──────────────────────────────────────────────────────────────

/**
 * Look up the business owner's email from Firebase and send the digest.
 */
async function sendEmailDigestForBiz(
  tenantId: string,
  bizId: string,
  alerts: FiredAlert[]
): Promise<boolean> {
  const { getDb } = await import("../firebase/admin.js");
  const db = getDb();

  // Get owner email from tenant users
  let ownerEmail = "";
  let bizName = tenantId;

  try {
    const usersSnap = await db.ref(`tenants/${tenantId}/app/users`).once("value");
    if (usersSnap.exists()) {
      const users = JSON.parse(usersSnap.val()?._v || "[]");
      const owner = users.find((u: any) => u.role === "owner" || u.role === "super_owner") || users[0];
      if (owner?.email && !owner.email.endsWith("@temp.marjin.app")) {
        ownerEmail = owner.email;
      }
    }
  } catch (e: any) {
    console.error(`[email-digest] failed to get owner email for ${tenantId}:`, e.message);
  }

  // Get biz name
  try {
    const bizSnap = await db.ref(`tenants/${tenantId}/app/business`).once("value");
    if (bizSnap.exists()) {
      const bizList = JSON.parse(bizSnap.val()?._v || "[]");
      bizName = bizList[0]?.name || tenantId;
    }
  } catch (_) {}

  // If no real email, try ALERT_FALLBACK_EMAIL env var
  if (!ownerEmail) {
    ownerEmail = process.env.ALERT_FALLBACK_EMAIL || "";
  }

  if (!ownerEmail) {
    console.warn(`[email-digest] no email found for ${tenantId}/${bizId}, skipping`);
    return false;
  }

  // Dynamic import of sendAlertDigest to keep it in lib/ (JS)
  const { sendAlertDigest } = await import("../../lib/sendEmail.js");
  const result = await sendAlertDigest(ownerEmail, bizName, alerts);
  return !!result?.messageId;
}
