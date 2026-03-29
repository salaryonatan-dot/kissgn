import type { AgentContext } from "../types/agent.js";
import type { MemoryInsight } from "../types/agent.js";
import { agentMemoryRef } from "../../firebase/refs.js";

export async function getRelevantBusinessMemory(
  question: string,
  context: AgentContext
): Promise<MemoryInsight[]> {
  try {
    const ref = agentMemoryRef(context.tenantId).child("insights");
    const snapshot = await ref.orderByChild("confidence").limitToLast(20).once("value");
    const raw = snapshot.val();
    if (!raw) return [];

    const now = new Date().toISOString();
    const entries: MemoryInsight[] = Object.values(raw);

    // Filter: not stale, minimum confidence, relevant to tenant
    const valid = entries.filter((m) => {
      if (m.confidence < 0.6) return false;
      if (m.validUntil && m.validUntil < now) return false;
      if (context.branchId && m.branchId && m.branchId !== context.branchId) return false;
      return true;
    });

    // Sort by confidence descending, take top 5
    valid.sort((a, b) => b.confidence - a.confidence);
    return valid.slice(0, 5);
  } catch (err) {
    // Memory is optional — never block the pipeline
    console.error("[Marjin AI] Memory retrieval failed:", err);
    return [];
  }
}
