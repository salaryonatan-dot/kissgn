import { recommendationsRef } from "../../firebase/refs.js";

export async function markRecommendationOutcome(
  tenantId: string,
  recommendationId: string,
  outcome: "implemented" | "ignored" | "partially_implemented",
  notes?: string,
  metricBefore?: number,
  metricAfter?: number
): Promise<void> {
  try {
    await recommendationsRef(tenantId).child(recommendationId).update({
      outcome,
      outcomeNotes: notes ?? null,
      outcomeRecordedAt: new Date().toISOString(),
      resultMetricBefore: metricBefore ?? null,
      resultMetricAfter: metricAfter ?? null,
    });
  } catch (err) {
    console.error("[Marjin AI] Failed to mark recommendation outcome:", err);
  }
}
