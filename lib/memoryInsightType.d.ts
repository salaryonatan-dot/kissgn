// Declarations for lib/memoryInsightType.js. Return type is the canonical agent
// MemoryInsightType so callers stay strictly typed. Every runtime value returned
// by the .js is a member of this union (verified by focused tests).
import type { MemoryInsightType } from "../src/agent/types/agent.js";

export function mapProactiveTypeToMemoryType(insightType: string): MemoryInsightType;
