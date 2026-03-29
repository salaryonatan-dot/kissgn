import { recommendationsRef } from "../../firebase/refs.js";
import type { RecommendationRecord } from "../../agent/types/memory.js";

export async function saveRecommendation(
  tenantId: string,
  rec: Omit<RecommendationRecord, "id">
): Promise<string> {
  const ref = recommendationsRef(tenantId);
  const pushed = await ref.push({
    ...rec,
    createdAt: new Date().toISOString(),
  });
  return pushed.key!;
}

export async function getRecentRecommendations(
  tenantId: string,
  limit = 10
): Promise<RecommendationRecord[]> {
  const ref = recommendationsRef(tenantId);
  const snapshot = await ref.orderByChild("createdAt").limitToLast(limit).once("value");
  const raw = snapshot.val();
  if (!raw) return [];
  return Object.entries(raw).map(([id, data]) => ({
    ...(data as RecommendationRecord),
    id,
  }));
}
