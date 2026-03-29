import { anomaliesRef } from "../../firebase/refs.js";
import type { StoredAnomaly } from "../../agent/types/analytics.js";

export async function getRecentAnomalies(
  tenantId: string,
  sinceDaysAgo = 30
): Promise<StoredAnomaly[]> {
  const sinceDate = new Date();
  sinceDate.setDate(sinceDate.getDate() - sinceDaysAgo);
  const sinceIso = sinceDate.toISOString().slice(0, 10);

  const ref = anomaliesRef(tenantId);
  const snapshot = await ref
    .orderByChild("date")
    .startAt(sinceIso)
    .once("value");

  const raw = snapshot.val();
  if (!raw) return [];

  return Object.values(raw) as StoredAnomaly[];
}

export async function saveAnomaly(
  tenantId: string,
  anomaly: StoredAnomaly
): Promise<void> {
  const ref = anomaliesRef(tenantId);
  await ref.push(anomaly);
}
