import { agentMemoryRef } from "../../firebase/refs.js";
import type { MemoryInsight } from "../../agent/types/agent.js";
import type { MemoryQuery } from "../../agent/types/memory.js";

export async function queryMemory(query: MemoryQuery): Promise<MemoryInsight[]> {
  const ref = agentMemoryRef(query.tenantId).child("insights");
  const snapshot = await ref.orderByChild("confidence").limitToLast(50).once("value");
  const raw = snapshot.val();
  if (!raw) return [];

  let entries: MemoryInsight[] = Object.values(raw);
  const now = new Date().toISOString();

  // Filter stale
  entries = entries.filter((e) => !e.validUntil || e.validUntil > now);

  // Filter by branch
  if (query.branchId) {
    entries = entries.filter((e) => !e.branchId || e.branchId === query.branchId);
  }

  // Filter by types
  if (query.types?.length) {
    entries = entries.filter((e) => query.types!.includes(e.type as any));
  }

  // Filter by min confidence
  if (query.minConfidence) {
    entries = entries.filter((e) => e.confidence >= query.minConfidence!);
  }

  // Sort by confidence descending
  entries.sort((a, b) => b.confidence - a.confidence);

  return entries.slice(0, query.limit ?? 10);
}
