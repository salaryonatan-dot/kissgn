// Marjin — Alert Config Repository
// Reads/writes user-defined thresholds from Firebase.

import type { AlertThresholds } from "./types.js";
import { DEFAULT_THRESHOLDS } from "./types.js";
import { getDb } from "../firebase/admin.js";

function configRef(tenantId: string, bizId: string) {
  return getDb().ref(`tenants/${tenantId}/alert_config/${bizId}`);
}

/**
 * An absent configuration uses compatibility defaults. A failed or malformed
 * read is not an absent configuration and must not silently select defaults.
 */
export async function getThresholds(
  tenantId: string,
  bizId: string
): Promise<AlertThresholds> {
  const snap = await configRef(tenantId, bizId).once("value");
  const raw = snap.val();
  if (raw === null || raw === undefined) return { ...DEFAULT_THRESHOLDS };
  if (typeof raw !== "object" || Array.isArray(raw)) throw new Error("alert_config_malformed");
  const configured = raw as Partial<AlertThresholds>;
  for (const key of Object.keys(DEFAULT_THRESHOLDS) as Array<keyof AlertThresholds>) {
    if (configured[key] === undefined) continue;
    const value = configured[key];
    if (typeof DEFAULT_THRESHOLDS[key] === "number" ? typeof value !== "number" || !Number.isFinite(value) : typeof value !== "boolean") {
      throw new Error(`alert_config_invalid:${key}`);
    }
  }
  return { ...DEFAULT_THRESHOLDS, ...configured };
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
