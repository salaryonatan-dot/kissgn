import { baselinesRef } from "../../firebase/refs.js";
import type { StoredBaseline } from "../../agent/types/analytics.js";

export async function getStoredBaselines(
  tenantId: string,
  metric?: string
): Promise<StoredBaseline[]> {
  const ref = baselinesRef(tenantId);
  let snapshot;

  if (metric) {
    snapshot = await ref.orderByChild("metric").equalTo(metric).once("value");
  } else {
    snapshot = await ref.once("value");
  }

  const raw = snapshot.val();
  if (!raw) return [];

  const entries: StoredBaseline[] = Object.values(raw);

  // Filter out stale baselines
  const now = new Date().toISOString();
  return entries.filter((b) => !b.validUntil || b.validUntil > now);
}

export async function saveBaseline(
  tenantId: string,
  baseline: StoredBaseline
): Promise<void> {
  const ref = baselinesRef(tenantId);
  await ref.push(baseline);
}
