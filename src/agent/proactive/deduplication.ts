// Marjin AI — Proactive Insights Deduplication
// Deterministic fingerprint + dedup logic. No LLM.

import type { DetectorResult, ProactiveInsight, ProactiveInsightType } from "./types.js";
import { findByFingerprint, updateProactiveInsight } from "../../repositories/proactive/insightsRepo.js";
import { logger } from "../../utils/logging.js";

/**
 * Fingerprint formula: type + metric + severity + ISO week of periodEnd.
 * Same fingerprint within 7 days = same insight (update, don't create).
 */
export function computeFingerprint(result: DetectorResult): string {
  const week = getIsoWeek(result.periodEnd);
  // Simple string hash — deterministic, no crypto needed
  const raw = `${result.type}|${result.metric}|${result.severity}|${week}`;
  return simpleHash(raw);
}

/**
 * Check if this detector result is a duplicate of a recent insight.
 * Returns the existing insight if duplicate, null if new.
 *
 * Dedup rules:
 * - Same fingerprint within 7 days → UPDATE existing (bump lastDetectedAt + occurrenceCount)
 * - Same type but DIFFERENT severity → NEW insight (escalation/de-escalation is meaningful)
 * - Same type, severity dropped → return existing (will be suppressed by suppression rules)
 */
export async function checkDeduplication(
  tenantId: string,
  bizId: string,
  result: DetectorResult,
  recentInsights: ProactiveInsight[]
): Promise<{ isDuplicate: boolean; existingInsight: ProactiveInsight | null }> {
  const fingerprint = computeFingerprint(result);

  // Check in-memory recent insights first (cheaper than Firebase query)
  const matchByFingerprint = recentInsights.find((i) => i.fingerprint === fingerprint);

  if (matchByFingerprint) {
    return { isDuplicate: true, existingInsight: matchByFingerprint };
  }

  // Check same type with different severity — this is NOT a duplicate
  // (severity change = meaningful signal)
  const sameType = recentInsights.find(
    (i) => i.type === result.type && i.metric === result.metric && !i.suppressed
  );

  if (sameType && sameType.severity !== result.severity) {
    // Severity changed — treat as new insight
    return { isDuplicate: false, existingInsight: null };
  }

  // Fallback: query Firebase by fingerprint (in case recentInsights is stale)
  const fbExisting = await findByFingerprint(tenantId, bizId, fingerprint);
  if (fbExisting) {
    return { isDuplicate: true, existingInsight: fbExisting };
  }

  return { isDuplicate: false, existingInsight: null };
}

/**
 * Update an existing duplicate insight: bump occurrence count and timestamp.
 */
export async function bumpExistingInsight(existing: ProactiveInsight): Promise<void> {
  try {
    await updateProactiveInsight(existing.tenantId, existing.bizId, existing.id, {
      lastDetectedAt: new Date().toISOString(),
      occurrenceCount: existing.occurrenceCount + 1,
    });
  } catch (err) {
    logger.error("Failed to bump existing insight:", err);
  }
}

/**
 * Check if this type+metric has been firing chronically (7+ consecutive days).
 * If so, it should be auto-suppressed as a chronic known issue.
 */
export function isChronicPattern(
  recentInsights: ProactiveInsight[],
  type: ProactiveInsightType,
  metric: string
): boolean {
  const matching = recentInsights.filter(
    (i) => i.type === type && i.metric === metric && !i.suppressed
  );
  // If there's an insight with occurrenceCount >= 7, it's chronic
  return matching.some((i) => i.occurrenceCount >= 7);
}

// --- Helpers ---

function getIsoWeek(dateIso: string): string {
  const d = new Date(dateIso + "T12:00:00");
  const year = d.getFullYear();
  // Compute ISO week number
  const jan1 = new Date(year, 0, 1);
  const days = Math.floor((d.getTime() - jan1.getTime()) / 86_400_000);
  const week = Math.ceil((days + jan1.getDay() + 1) / 7);
  return `${year}-W${String(week).padStart(2, "0")}`;
}

function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + ch;
    hash |= 0; // Convert to 32-bit integer
  }
  // Return as hex string, always positive
  return (hash >>> 0).toString(16).padStart(8, "0");
}
