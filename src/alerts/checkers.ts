// Marjin â Parameter-Based Alert Checkers
// 7 deterministic checks. Each compares data against user-defined thresholds.
// Zero AI. Pure math.

import type { FiredAlert, AlertThresholds, AlertSeverity } from "./types.js";
import { getDb } from "../firebase/admin.js";
import { todayIso, daysAgoIso } from "../utils/dates.js";

// ââ Helper ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ

function makeAlert(
  tenantId: string,
  bizId: string,
  type: FiredAlert["type"],
  severity: AlertSeverity,
  title: string,
  message: string,
  currentValue: number,
  threshold: number,
  date: string,
  context?: Record<string, unknown>
): FiredAlert {
  const deviationPct = threshold !== 0
    ? Math.round(((currentValue - threshold) / threshold) * 100 * 10) / 10
    : 0;

  return {
    id: `${bizId}:${type}:${date}${context?.key ? ":" + context.key : ""}`,
    tenantId,
    bizId,
    type,
    severity,
    title,
    message,
    currentValue,
    threshold,
    deviationPct,
    date,
    firedAt: new Date().toISOString(),
    context,
    dismissed: false,
    notifiedWhatsApp: false,
  };
}

// ââ 1. Labor % Exceeded ââââââââââââââââââââââââââââââââââââââââââââââââââââââ

export async function checkLaborPct(
  tenantId: string,
  bizId: string,
  thresholds: AlertThresholds
): Promise<FiredAlert | null> {
  const today = todayIso();
  const db = getDb();

  // Get last 7 days of daily metrics
  const start = daysAgoIso(7);
  const snap = await db.ref(`tenants/${tenantId}/analytics/daily`)
    .orderByKey()
    .startAt(start)
    .endAt(today)
    .once("value");

  const raw = snap.val();
  if (!raw) return null;

  // Compute average labor %
  const days = Object.values(raw) as any[];
  let totalLabor = 0, totalRevenue = 0, count = 0;

  for (const day of days) {
    const entries = typeof day === "object" ? Object.values(day) : [day];
    for (const entry of entries as any[]) {
      if (entry?.laborCost && entry?.revenue && entry.revenue > 0) {
        totalLabor += Number(entry.laborCost);
        totalRevenue += Number(entry.revenue);
        count++;
      }
    }
  }

  if (count === 0 || totalRevenue === 0) return null;

  const laborPct = Math.round((totalLabor / totalRevenue) * 100 * 10) / 10;

  if (laborPct >= thresholds.laborPctCritical) {
    return makeAlert(tenantId, bizId, "labor_pct_exceeded", "critical",
      `×¢×××ª ××× ××× ×§×¨××××ª â ${laborPct}%`,
      `×-7 ××××× ××××¨×× ×× ×¢×××ª ××× ××× ×¢××× ×¢× ${laborPct}% ××××× ×¡××ª (×¡×£: ${thresholds.laborPctCritical}%). ×¡×"× ×¢×××ª: ${totalLabor.toLocaleString()} âª, ×¡×"× ××× ×¡××ª: ${totalRevenue.toLocaleString()} âª.`,
      laborPct, thresholds.laborPctCritical, today);
  }

  if (laborPct >= thresholds.laborPctMax) {
    return makeAlert(tenantId, bizId, "labor_pct_exceeded", "warning",
      `×¢×××ª ××× ××× ××¢× ××¡×£ â ${laborPct}%`,
      `×-7 ××××× ××××¨×× ×× ×¢×××ª ××× ××× ×¢××× ×¢× ${laborPct}% ××××× ×¡××ª (×¡×£: ${thresholds.laborPctMax}%). ×¡×"× ×¢×××ª: ${totalLabor.toLocaleString()} âª, ×¡×"× ××× ×¡××ª: ${totalRevenue.toLocaleString()} âª.`,
      laborPct, thresholds.laborPctMax, today);
  }

  return null;
}

// ââ 2. Food Cost % Exceeded âââââââââââââââââââââââââââââââââââââââââââââââââââ

export async function checkFoodCostPct(
  tenantId: string,
  bizId: string,
  thresholds: AlertThresholds
): Promise<FiredAlert | null> {
  const today = todayIso();
  const db = getDb();
  const start = daysAgoIso(7);

  const snap = await db.ref(`tenants/${tenantId}/analytics/daily`)
    .orderByKey().startAt(start).endAt(today).once("value");

  const raw = snap.val();
  if (!raw) return null;

  const days = Object.values(raw) as any[];
  let totalFood = 0, totalRevenue = 0, count = 0;

  for (const day of days) {
    const entries = typeof day === "object" ? Object.values(day) : [day];
    for (const entry of entries as any[]) {
      if (entry?.foodCost && entry?.revenue && entry.revenue > 0) {
        totalFood += Number(entry.foodCost);
        totalRevenue += Number(entry.revenue);
        count++;
      }
    }
  }

  if (count === 0 || totalRevenue === 0) return null;

  const foodPct = Math.round((totalFood / totalRevenue) * 100 * 10) / 10;

  if (foodPct >= thresholds.foodCostPctCritical) {
    return makeAlert(tenantId, bizId, "food_cost_pct_exceeded", "critical",
      `×¢×××ª ×××× ×§×¨××××ª â ${foodPct}%`,
      `×-7 ××××× ××××¨×× ×× ×¢×××ª ×××× ×¢××× ×¢× ${foodPct}% ××××× ×¡××ª (×¡×£: ${thresholds.foodCostPctCritical}%). ×¡×"× ×¢×××ª: ${totalFood.toLocaleString()} âª.`,
      foodPct, thresholds.foodCostPctCritical, today);
  }

  if (foodPct >= thresholds.foodCostPctMax) {
    return makeAlert(tenantId, bizId, "food_cost_pct_exceeded", "warning",
      `×¢×××ª ×××× ××¢× ××¡×£ â ${foodPct}%`,
      `×-7 ××××× ××××¨×× ×× ×¢×××ª ×××× ×¢××× ×¢× ${foodPct}% ××××× ×¡××ª (×¡×£: ${thresholds.foodCostPctMax}%). ×¡×"× ×¢×××ª: ${totalFood.toLocaleString()} âª.`,
      foodPct, thresholds.foodCostPctMax, today);
  }

  return null;
}

// ââ 3. Supplier Anomaly (Leak Detection) ââââââââââââââââââââââââââââââââââââââ

export async function checkSupplierAnomaly(
  tenantId: string,
  bizId: string,
  thresholds: AlertThresholds
): Promise<FiredAlert[]> {
  const alerts: FiredAlert[] = [];
  const today = todayIso();
  const db = getDb();

  // Read raw entries (last 28 days) to extract supplier payments
  const start = daysAgoIso(28);
  const snap = await db.ref(`tenants/${tenantId}/biz:${bizId}:entries`)
    .orderByKey().startAt(start).endAt(today).once("value");

  const raw = snap.val();
  if (!raw) return alerts;

  // Parse entries and collect per-supplier payments
  const supplierPayments: Record<string, number[]> = {};

  for (const [_date, entryRaw] of Object.entries(raw)) {
    let entry: any = entryRaw;
    // Handle { _v: "JSON" } wrapper
    if (entry?._v && typeof entry._v === "string") {
      try { entry = JSON.parse(entry._v); } catch { continue; }
    }
    if (!entry?.supplier_payments) continue;

    for (const [suppId, amount] of Object.entries(entry.supplier_payments)) {
      const val = Number(amount);
      if (val > 0) {
        if (!supplierPayments[suppId]) supplierPayments[suppId] = [];
        supplierPayments[suppId].push(val);
      }
    }
  }

  // Load supplier names
  const suppSnap = await db.ref(`tenants/${tenantId}/biz:${bizId}:suppliers`).once("value");
  const suppliers = suppSnap.val() || {};

  // Check each supplier: last payment vs average
  for (const [suppId, payments] of Object.entries(supplierPayments)) {
    if (payments.length < 2) continue; // need history

    const lastPayment = payments[payments.length - 1];
    const avgWithoutLast = payments.slice(0, -1).reduce((a, b) => a + b, 0) / (payments.length - 1);

    if (avgWithoutLast === 0) continue;

    const deviation = ((lastPayment - avgWithoutLast) / avgWithoutLast) * 100;

    if (deviation >= thresholds.supplierDeviationPct) {
      const suppName = findSupplierName(suppliers, suppId);
      alerts.push(makeAlert(tenantId, bizId, "supplier_anomaly", "warning",
        `××××¤×ª ×¡×¤×§: ${suppName} â +${Math.round(deviation)}%`,
        `×ª×©××× ×××¨×× ×${suppName}: ${lastPayment.toLocaleString()} âª â ${Math.round(deviation)}% ××¢× ×××××¦×¢ ×©×× (${Math.round(avgWithoutLast).toLocaleString()} âª). ×-${payments.length} ×ª×©××××× ×××¨×× ××.`,
        lastPayment, avgWithoutLast, today,
        { key: suppId, supplierName: suppName, paymentCount: payments.length }
      ));
    }
  }

  return alerts;
}

function findSupplierName(suppliers: any, id: string): string {
  if (typeof suppliers === "object") {
    for (const val of Object.values(suppliers) as any[]) {
      if (val?.id?.toString() === id || val?.name === id) return val.name || id;
    }
  }
  return id;
}

// ââ 4. Minimum Revenue Breach âââââââââââââââââââââââââââââââââââââââââââââââââ

export async function checkMinRevenue(
  tenantId: string,
  bizId: string,
  thresholds: AlertThresholds
): Promise<FiredAlert | null> {
  if (thresholds.minDailyRevenue <= 0) return null; // disabled

  const today = todayIso();
  const db = getDb();

  // Check yesterday (today's data may not be complete)
  const yesterday = daysAgoIso(1);
  const snap = await db.ref(`tenants/${tenantId}/analytics/daily`)
    .orderByKey().equalTo(yesterday).once("value");

  const raw = snap.val();
  if (!raw) return null;

  // Sum revenue for the day
  let dayRevenue = 0;
  const dayData = raw[yesterday];
  if (typeof dayData === "object") {
    for (const entry of Object.values(dayData) as any[]) {
      dayRevenue += Number(entry?.revenue || 0);
    }
  }

  if (dayRevenue > 0 && dayRevenue < thresholds.minDailyRevenue) {
    return makeAlert(tenantId, bizId, "min_revenue_breach", "warning",
      `××× ×¡××ª ××ª××ª ×××× ×××× â ${dayRevenue.toLocaleString()} âª`,
      `××× ×¡××ª ×©× ××ª××× (${yesterday}): ${dayRevenue.toLocaleString()} âª â ××ª××ª ××¡×£ ×©× ${thresholds.minDailyRevenue.toLocaleString()} âª.`,
      dayRevenue, thresholds.minDailyRevenue, yesterday);
  }

  return null;
}

// ââ 5. Expensive Employee âââââââââââââââââââââââââââââââââââââââââââââââââââââ

export async function checkExpensiveEmployee(
  tenantId: string,
  bizId: string,
  thresholds: AlertThresholds
): Promise<FiredAlert[]> {
  const alerts: FiredAlert[] = [];
  const today = todayIso();
  const db = getDb();

  const start = daysAgoIso(28);
  const snap = await db.ref(`tenants/${tenantId}/biz:${bizId}:entries`)
    .orderByKey().startAt(start).endAt(today).once("value");

  const raw = snap.val();
  if (!raw) return alerts;

  // Collect per-employee payments
  const employeePayments: Record<string, number[]> = {};

  for (const [_date, entryRaw] of Object.entries(raw)) {
    let entry: any = entryRaw;
    if (entry?._v && typeof entry._v === "string") {
      try { entry = JSON.parse(entry._v); } catch { continue; }
    }
    if (!entry?.hourly_payroll) continue;

    for (const [empId, amount] of Object.entries(entry.hourly_payroll)) {
      const val = Number(amount);
      if (val > 0) {
        if (!employeePayments[empId]) employeePayments[empId] = [];
        employeePayments[empId].push(val);
      }
    }
  }

  // Check each employee
  for (const [empId, payments] of Object.entries(employeePayments)) {
    if (payments.length < 3) continue;

    const lastPayment = payments[payments.length - 1];
    const avg = payments.slice(0, -1).reduce((a, b) => a + b, 0) / (payments.length - 1);

    if (avg === 0) continue;

    const deviation = ((lastPayment - avg) / avg) * 100;

    if (deviation >= thresholds.employeeDeviationPct) {
      alerts.push(makeAlert(tenantId, bizId, "expensive_employee", "warning",
        `×¢××× ××§×¨: ${empId} â +${Math.round(deviation)}%`,
        `×ª×©××× ×××¨×× ××¢××× ${empId}: ${lastPayment.toLocaleString()} âª â ${Math.round(deviation)}% ××¢× ×××××¦×¢ ×©×× (${Math.round(avg).toLocaleString()} âª).`,
        lastPayment, avg, today,
        { key: empId, employeeId: empId }
      ));
    }
  }

  return alerts;
}

// ââ 6. Weak Day Detection âââââââââââââââââââââââââââââââââââââââââââââââââââââ

export async function checkWeakDay(
  tenantId: string,
  bizId: string,
  thresholds: AlertThresholds
): Promise<FiredAlert[]> {
  const alerts: FiredAlert[] = [];
  const today = todayIso();
  const db = getDb();

  const start = daysAgoIso(28);
  const snap = await db.ref(`tenants/${tenantId}/analytics/daily`)
    .orderByKey().startAt(start).endAt(today).once("value");

  const raw = snap.val();
  if (!raw) return alerts;

  // Group revenue by day-of-week
  const dayRevenues: Record<number, number[]> = { 0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] };
  const DAYS_HEB = ["×¨××©××", "×©× ×", "×©×××©×", "×¨×××¢×", "××××©×", "×©××©×", "×©××ª"];

  for (const [dateStr, dayData] of Object.entries(raw)) {
    const dow = new Date(dateStr + "T12:00:00").getDay();
    let rev = 0;
    if (typeof dayData === "object") {
      for (const entry of Object.values(dayData) as any[]) {
        rev += Number(entry?.revenue || 0);
      }
    }
    if (rev > 0) dayRevenues[dow].push(rev);
  }

  // Calculate overall avg
  const allRevs = Object.values(dayRevenues).flat();
  if (allRevs.length < 14) return alerts; // need at least 2 weeks

  const overallAvg = allRevs.reduce((a, b) => a + b, 0) / allRevs.length;
  if (overallAvg === 0) return alerts;

  // Check each day-of-week
  for (let dow = 0; dow <= 6; dow++) {
    const revs = dayRevenues[dow];
    if (revs.length < 3) continue; // need history for this day

    const dayAvg = revs.reduce((a, b) => a + b, 0) / revs.length;
    const deviation = ((overallAvg - dayAvg) / overallAvg) * 100;

    if (deviation >= thresholds.weakDayDeviationPct) {
      alerts.push(makeAlert(tenantId, bizId, "weak_day_detected", "info",
        `××× ×××©: ××× ${DAYS_HEB[dow]} â ${Math.round(deviation)}% ××ª××ª ×××××¦×¢`,
        `××××¦×¢ ××× ×¡××ª ×××× ${DAYS_HEB[dow]}: ${Math.round(dayAvg).toLocaleString()} âª â ${Math.round(deviation)}% ××ª××ª ×××××¦×¢ ××××× (${Math.round(overallAvg).toLocaleString()} âª). ××××¡×¡ ×¢× ${revs.length} ×©×××¢××ª.`,
        dayAvg, overallAvg, today,
        { key: String(dow), dayOfWeek: dow, dayName: DAYS_HEB[dow] }
      ));
    }
  }

  return alerts;
}

// ââ 7. Purchase Trend Rising Without Revenue ââââââââââââââââââââââââââââââââââ

export async function checkPurchaseTrend(
  tenantId: string,
  bizId: string,
  thresholds: AlertThresholds
): Promise<FiredAlert | null> {
  const today = todayIso();
  const db = getDb();

  // Compare last 7 days vs prior 7 days
  const weekStart = daysAgoIso(7);
  const priorStart = daysAgoIso(14);

  const snap = await db.ref(`tenants/${tenantId}/analytics/daily`)
    .orderByKey().startAt(priorStart).endAt(today).once("value");

  const raw = snap.val();
  if (!raw) return null;

  let recentRevenue = 0, recentFood = 0, priorRevenue = 0, priorFood = 0;

  for (const [dateStr, dayData] of Object.entries(raw)) {
    const isRecent = dateStr >= weekStart;
    if (typeof dayData === "object") {
      for (const entry of Object.values(dayData) as any[]) {
        const rev = Number(entry?.revenue || 0);
        const food = Number(entry?.foodCost || 0);
        if (isRecent) { recentRevenue += rev; recentFood += food; }
        else { priorRevenue += rev; priorFood += food; }
      }
    }
  }

  if (priorFood === 0 || priorRevenue === 0) return null;

  const purchaseGrowth = ((recentFood - priorFood) / priorFood) * 100;
  const revenueGrowth = ((recentRevenue - priorRevenue) / priorRevenue) * 100;

  if (purchaseGrowth >= thresholds.purchaseRisePct &&
      revenueGrowth <= thresholds.purchaseRevenueGapPct) {
    return makeAlert(tenantId, bizId, "purchase_trend_rising",
      purchaseGrowth >= 30 ? "critical" : "warning",
      `×¨×××©××ª ×¢××××ª +${Math.round(purchaseGrowth)}% â ××× ×¡××ª ${revenueGrowth > 0 ? "+" : ""}${Math.round(revenueGrowth)}%`,
      `×¨×××©××ª ×¢×× ×-${Math.round(purchaseGrowth)}% (${Math.round(recentFood).toLocaleString()} âª ××¢×××ª ${Math.round(priorFood).toLocaleString()} âª) ××× ××× ×¡××ª ${revenueGrowth >= 0 ? "×¢××" : "××¨××"} ×¨×§ ×-${Math.round(Math.abs(revenueGrowth))}%. ×¤×¢×¨ ××©××.`,
      purchaseGrowth, thresholds.purchaseRisePct, today);
  }

  return null;
}
