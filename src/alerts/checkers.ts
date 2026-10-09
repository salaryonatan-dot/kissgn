// Marjin â Parameter-Based Alert Checkers
// 7 deterministic checks. Each compares data against user-defined thresholds.
// Zero AI. Pure math.

import type { FiredAlert, AlertThresholds, AlertSeverity } from "./types.js";
import { getDb } from "../firebase/admin.js";
import { todayIso, daysAgoIso } from "../utils/dates.js";
import { strictLegacyDailyMetric } from "../../lib/analytics/strictDailyMetrics.js";
import { requireEntriesRows, rowsInRange } from "../../lib/analytics/entriesReader.js";
import { loadAlertMonthReport } from "./alertMonthReport.js";
import { amountToNumber } from "../metrics/adapters/legacyNumber.js";
import { parseAmountString, ratCmp } from "../finance/decimal.js";

// ── CTO D2 — entries-backed anomaly checkers stay NON-FIRING in this slice ────
// checkSupplierAnomaly and checkExpensiveEmployee historically queried the entries
// node with `orderByKey().startAt(date)`; the node's children are `_v` / `generation` /
// `rows` / `schemaVersion`, never date keys, so the query returned null and neither
// checker ever produced an alert. Their storage access is converged below (whole node
// through the shared dual-mode reader, date window applied after decoding, every row
// counted), but activating them is a separate product decision: while this constant is
// `false` both return `[]` BEFORE any read, so no alert is saved and no digest is sent.
// Activation requires a separately reviewed change that removes this constant.
export const ENTRIES_ANOMALY_CHECKS_ENABLED = false;

// Read the AUTHORIZED per-business flat analytics source
// (tenants/{tid}/biz:{bizId}:analytics:daily:{date}). The legacy tenant-wide
// tenants/{tid}/analytics/daily node is now Rules-denied to clients and orphaned.
// Returns the legacy-shaped map {date: {bizId: {revenue, laborCost, foodCost}}} so
// downstream checker logic is unchanged. Admin SDK (this cron) is authorized.
async function readLegacyShapedDaily(
  db: any,
  tenantId: string,
  bizId: string,
  fromDate: string,
  toDate: string
): Promise<Record<string, Record<string, { revenue: number; laborCost: number; foodCost: number }>>> {
  const out: Record<string, Record<string, { revenue: number; laborCost: number; foodCost: number }>> = {};
  const [fy, fm, fd] = fromDate.split("-").map(Number);
  const [ty, tm, td] = toDate.split("-").map(Number);
  let cur = Date.UTC(fy, (fm || 1) - 1, fd || 1);
  const end = Date.UTC(ty, (tm || 1) - 1, td || 1);
  const dates: string[] = [];
  while (cur <= end && dates.length <= 400) { dates.push(new Date(cur).toISOString().slice(0, 10)); cur += 86_400_000; }
  const snaps = await Promise.all(
    dates.map((k) => db.ref(`tenants/${tenantId}/biz:${bizId}:analytics:daily:${k}`).once("value").catch(() => null))
  );
  snaps.forEach((snap: any, i: number) => {
    const doc: any = snap && typeof snap.val === "function" ? snap.val() : null;
    const rev = doc && doc.revenue ? doc.revenue : null;
    // Part 3: strict finite-metric validation. Only dates whose total/payroll/
    // food_cost are ALL valid finite numerics enter alert calculations; anything
    // missing/empty/NaN/±Infinity/text/boolean/object/array skips the whole date
    // (no zero record, no false alert).
    const strict = strictLegacyDailyMetric(rev);
    if (strict) {
      out[dates[i]] = { [bizId]: strict };
    }
  });
  return out;
}

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

function reachesThreshold(value: string, threshold: number): boolean {
  return Number.isFinite(threshold) && ratCmp(parseAmountString(value), parseAmountString(String(threshold))) >= 0;
}
export async function checkLaborPct(tenantId: string, bizId: string, thresholds: AlertThresholds): Promise<FiredAlert | null> {
  const report = await loadAlertMonthReport(tenantId, bizId, Date.now());
  const ratio = report.actual.labor.employerCostPct;
  if (report.window.state !== "actual" || report.actual.labor.employerCost.state !== "complete" || ratio.state !== "value") return null;
  const value = amountToNumber(ratio.value);
  if (value === null) return null;
  const date = report.window.asOfBusinessDate;
  const context = { period: report.window.month, completedThrough: report.window.completedThrough, formula: report.versions.fin };
  if (reachesThreshold(ratio.value, thresholds.laborPctCritical)) {
    return makeAlert(tenantId, bizId, "labor_pct_exceeded", "critical", `עלות כוח אדם קריטית — ${value}%`,
      `עלות מעסיק מלאה בחודש עד D-1: ${value}% (סף: ${thresholds.laborPctCritical}%).`, value, thresholds.laborPctCritical, date, context);
  }
  if (reachesThreshold(ratio.value, thresholds.laborPctMax)) {
    return makeAlert(tenantId, bizId, "labor_pct_exceeded", "warning", `עלות כוח אדם מעל הסף — ${value}%`,
      `עלות מעסיק מלאה בחודש עד D-1: ${value}% (סף: ${thresholds.laborPctMax}%).`, value, thresholds.laborPctMax, date, context);
  }
  return null;
}
export async function checkFoodCostPct(tenantId: string, bizId: string, thresholds: AlertThresholds): Promise<FiredAlert | null> {
  const report = await loadAlertMonthReport(tenantId, bizId, Date.now());
  const ratio = report.actual.purchasesPct;
  if (report.window.state !== "actual" || !report.actual.purchases.complete || ratio.state !== "value") return null;
  const value = amountToNumber(ratio.value);
  if (value === null) return null;
  const date = report.window.asOfBusinessDate;
  const context = { period: report.window.month, completedThrough: report.window.completedThrough, formula: report.versions.fin, credits: report.actual.purchases.credits.value };
  if (reachesThreshold(ratio.value, thresholds.foodCostPctCritical)) {
    return makeAlert(tenantId, bizId, "food_cost_pct_exceeded", "critical", `עלות מזון קריטית — ${value}%`,
      `עלות מזון נטו מזיכויי ספקים בחודש עד D-1: ${value}% (סף: ${thresholds.foodCostPctCritical}%).`, value, thresholds.foodCostPctCritical, date, context);
  }
  if (reachesThreshold(ratio.value, thresholds.foodCostPctMax)) {
    return makeAlert(tenantId, bizId, "food_cost_pct_exceeded", "warning", `עלות מזון מעל הסף — ${value}%`,
      `עלות מזון נטו מזיכויי ספקים בחודש עד D-1: ${value}% (סף: ${thresholds.foodCostPctMax}%).`, value, thresholds.foodCostPctMax, date, context);
  }
  return null;
}
// Supplier and employee entry anomalies remain disabled until an approved evidence contract.
export async function checkSupplierAnomaly(
  tenantId: string,
  bizId: string,
  thresholds: AlertThresholds
): Promise<FiredAlert[]> {
  const alerts: FiredAlert[] = [];
  if (!ENTRIES_ANOMALY_CHECKS_ENABLED) return alerts;   // CTO D2: non-firing, no read
  const today = todayIso();
  const db = getDb();

  // Entries (last 28 days): the whole node through the shared dual-mode reader, the
  // date window applied AFTER decoding; every stored row contributes its payments in
  // (date, id) order. A malformed node throws a typed EntriesStorageError.
  const start = daysAgoIso(28);
  const snap = await db.ref(`tenants/${tenantId}/biz:${bizId}:entries`).once("value");
  const rows = rowsInRange(requireEntriesRows(snap.val(), { tenantId, bizId, site: "checkers.checkSupplierAnomaly" }), start, today);
  if (!rows.length) return alerts;

  // Collect per-supplier payments
  const supplierPayments: Record<string, number[]> = {};

  for (const entry of rows as any[]) {
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
  const raw = await readLegacyShapedDaily(db, tenantId, bizId, yesterday, yesterday);
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
  if (!ENTRIES_ANOMALY_CHECKS_ENABLED) return alerts;   // CTO D2: non-firing, no read
  const today = todayIso();
  const db = getDb();

  const start = daysAgoIso(28);
  const snap = await db.ref(`tenants/${tenantId}/biz:${bizId}:entries`).once("value");
  const rows = rowsInRange(requireEntriesRows(snap.val(), { tenantId, bizId, site: "checkers.checkExpensiveEmployee" }), start, today);
  if (!rows.length) return alerts;

  // Collect per-employee payments
  const employeePayments: Record<string, number[]> = {};

  for (const entry of rows as any[]) {
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
  _tenantId: string,
  _bizId: string,
  _thresholds: AlertThresholds
): Promise<FiredAlert[]> {
  // The legacy 28-day source cannot distinguish a declared closure from an
  // operating-day zero across month boundaries. The Daily month detector uses
  // the canonical calendar and reports only when its revenue coverage is complete.
  return [];
}

// ââ 7. Purchase Trend Rising Without Revenue ââââââââââââââââââââââââââââââââââ

export async function checkPurchaseTrend(
  _tenantId: string,
  _bizId: string,
  _thresholds: AlertThresholds
): Promise<FiredAlert | null> {
  // A canonical exact-window total must include credits issued on dates with no
  // gross purchase. The existing 7-day sums cannot establish that total.
  return null;
}
