// Marjin — Fired Alerts Repository
// CRUD for alerts that have been triggered.

import type { FiredAlert } from "./types.js";
import { getDb } from "../firebase/admin.js";

function alertsRef(tenantId: string, bizId: string) {
  return getDb().ref(`tenants/${tenantId}/alerts/${bizId}`);
}

/**
 * Save a fired alert.
 */
export async function saveAlert(alert: FiredAlert): Promise<void> {
  await alertsRef(alert.tenantId, alert.bizId).child(alert.id).set(alert);
}

/**
 * Get recent alerts (last N days).
 */
export async function getRecentAlerts(
  tenantId: string,
  bizId: string,
  sinceDaysAgo: number = 7
): Promise<FiredAlert[]> {
  try {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - sinceDaysAgo);
    const cutoffIso = cutoff.toISOString();

    const snap = await alertsRef(tenantId, bizId)
      .orderByChild("firedAt")
      .startAt(cutoffIso)
      .once("value");

    const raw = snap.val();
    if (!raw) return [];
    return Object.values(raw) as FiredAlert[];
  } catch {
    return [];
  }
}

/**
 * Get active (non-dismissed) alerts.
 */
export async function getActiveAlerts(
  tenantId: string,
  bizId: string
): Promise<FiredAlert[]> {
  const recent = await getRecentAlerts(tenantId, bizId, 14);
  return recent.filter((a) => !a.dismissed);
}

/**
 * Dismiss an alert.
 */
export async function dismissAlert(
  tenantId: string,
  bizId: string,
  alertId: string
): Promise<void> {
  await alertsRef(tenantId, bizId).child(alertId).child("dismissed").set(true);
}

/**
 * Check if an alert already exists (avoid duplicates on same day).
 */
export async function alertExistsToday(
  tenantId: string,
  bizId: string,
  alertId: string
): Promise<boolean> {
  const snap = await alertsRef(tenantId, bizId).child(alertId).once("value");
  return snap.exists();
}
