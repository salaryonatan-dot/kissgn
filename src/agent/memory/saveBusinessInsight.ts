import type { MemoryInsight } from "../types/agent.js";
import { agentMemoryRef } from "../../firebase/refs.js";

export async function saveBusinessInsight(insight: MemoryInsight): Promise<void> {
  try {
    const ref = agentMemoryRef(insight.tenantId).child("insights");

    // Check for existing similar insight to update instead of duplicate
    const existing = await ref
      .orderByChild("title")
      .equalTo(insight.title)
      .limitToFirst(1)
      .once("value");

    const existingVal = existing.val();

    if (existingVal) {
      // Update existing insight
      const key = Object.keys(existingVal)[0];
      const prev = existingVal[key] as MemoryInsight;
      await ref.child(key).update({
        confidence: Math.min(1, prev.confidence + 0.05), // strengthen with repetition
        updatedAt: new Date().toISOString(),
        description: insight.description,
        evidenceRefs: [
          ...(prev.evidenceRefs ?? []),
          ...(insight.evidenceRefs ?? []),
        ].slice(-10), // keep last 10 refs
      });
    } else {
      // New insight
      await ref.push({
        ...insight,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    }
  } catch (err) {
    // Memory writes are best-effort — never fail the pipeline
    console.error("[Marjin AI] Failed to save business insight:", err);
  }
}
