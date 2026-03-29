import { analyticsRef } from "../../firebase/refs.js";

export interface StoredForecast {
  month: string;           // YYYY-MM
  projectedRevenue: number;
  projectedLaborCost: number;
  projectedFoodCost: number;
  confidence: number;
  computedAt: string;
  method: string;
}

export async function getLatestForecast(
  tenantId: string,
  month: string
): Promise<StoredForecast | null> {
  const ref = analyticsRef(tenantId).child("forecasts");
  const snapshot = await ref
    .orderByChild("month")
    .equalTo(month)
    .limitToLast(1)
    .once("value");

  const raw = snapshot.val();
  if (!raw) return null;

  const entries: StoredForecast[] = Object.values(raw);
  return entries[0] ?? null;
}

export async function saveForecast(
  tenantId: string,
  forecast: StoredForecast
): Promise<void> {
  const ref = analyticsRef(tenantId).child("forecasts");
  await ref.push(forecast);
}
