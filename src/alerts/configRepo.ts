// Marjin — Alert Config Repository
// Reads/writes user-defined thresholds from Firebase.

import type { AlertThresholds } from "./types.js";
import { DEFAULT_THRESHOLDS } from "./types.js";
import { getDb } from "../firebase/admin.js";

function configRef(tenantId: string, bizId: string) {
  return getDb().ref(`tenants/${tenantId}/alert_config/${bizId}`);
}

/**
 * Get alert thresholds for a biz. Returns defaults if not configured.
 */
export async function getThresholds(
  tenantId: string,
  bizId: string
): Promise<AlertThresholds> {
  try {
    const snap = await configRef(tenantId, bizId).once("value");
    const raw = snap.val();
    if (!raw) return { ...DEFAULT_THRESHOLDS };
    // Merge with defaults so new fields always have values
    return { ...DEFAULT_THRESHOLDS, ...raw };
  } catch {
    return { ...DEFAULT_THRESHOLDS };
  }
}

/**
 * Save alert thresholds for a biz. Partial update allowed.
 */
export async function saveThresholds(
  tenantId: string,
  bizId: string,
  thresholds: Partial<AlertThresholds>
): Promise<void> {
  await configRef(tenantId, bizId).update(thresholds);
}

/**
 * Reset thresholds to defaults.
 */
export async function resetThresholds(
  tenantId: string,
  bizId: string
): Promise<void> {
  await configRef(tenantId, bizId).set(DEFAULT_THRESHOLDS);
}
