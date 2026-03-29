// Marjin AI — Proactive Insights Memory Manager (Phase 2)
// Tracks recurrence, chronic patterns, and cooldown windows.
// Deterministic. No LLM.

import type { ProactiveInsight, InsightMemoryEntry } from "./types.js";
import { getDb } from "../../firebase/admin.js";
import { logger } from "../../utils/logging.js";

// --- Constants ---
const CHRONIC_THRESHOLD = 7;             // ≥7 occurrences = chronic
const COOLDOWN_HOURS_MEDIUM = 48;        // medium severity: 48h cooldown
const COOLDOWN_HOURS_HIGH = 24;          // high severity: 24h cooldown
const COOLDOWN_HOURS_CHRONIC = 168;      // chronic: 7 days cooldown

/**
 * Firebase path for insight memory entries.
 * Stored at: tenants/{tenantId}/proactive_memory/{bizId}/{fingerprint}
 */
function memoryRef(tenantId: string, bizId: string) {
  return getDb().ref(`tenants/${tenantId}/proactive_memory/${bizId}`);
}

/**
 * Get or create a memory entry for an insight's fingerprint.
 * Called after each detector result to track recurrence.
 */
export async function trackInsightOccurrence(
  tenantId: string,
  bizId: string,
  insight: ProactiveInsight
): Promise<InsightMemoryEntry> {
  try {
    const ref = memoryRef(tenantId, bizId).child(insight.fingerprint);
    const snap = await ref.once("value");
    const existing = snap.val() as InsightMemoryEntry | null;

    const now = new Date().toISOString();

    if (existing) {
      // Update existing memory entry
      const updated: InsightMemoryEntry = {
        ...existing,
        recurrenceCount: existing.recurrenceCount + 1,
        isChronic: (existing.recurrenceCount + 1) >= CHRONIC_THRESHOLD,
        lastDetectedAt: now,
        lastConfidence: insight.confidenceScore,
        avgDeviationPct: Math.round(
          ((existing.avgDeviationPct * existing.recurrenceCount) + Math.abs(insight.deviationPct)) /
          (existing.recurrenceCount + 1) * 100
        ) / 100,
      };

      await ref.set(updated);
      return updated;
    }

    // Create new memory entry
    const entry: InsightMemoryEntry = {
      fingerprint: insight.fingerprint,
      type: insight.type,
      metric: insight.metric,
      recurrenceCount: 1,
      isChronic: false,
      cooldownUntil: null,
      firstDetectedAt: now,
      lastDetectedAt: now,
      lastConfidence: insight.confidenceScore,
      avgDeviationPct: Math.abs(insight.deviationPct),
    };

    await ref.set(entry);
    return entry;
  } catch (err) {
    logger.error("[Proactive Memory] Failed to track occurrence:", err);
    // Return a safe default — never block the pipeline
    return {
      fingerprint: insight.fingerprint,
      type: insight.type,
      metric: insight.metric,
      recurrenceCount: 1,
      isChronic: false,
      cooldownUntil: null,
      firstDetectedAt: new Date().toISOString(),
      lastDetectedAt: new Date().toISOString(),
      lastConfidence: insight.confidenceScore,
      avgDeviationPct: Math.abs(insight.deviationPct),
    };
  }
}

/**
 * Check if an insight is in its cooldown window.
 * Returns true if the insight should NOT be surfaced (still cooling down).
 */
export async function isInCooldown(
  tenantId: string,
  bizId: string,
  fingerprint: string
): Promise<boolean> {
  try {
    const ref = memoryRef(tenantId, bizId).child(fingerprint).child("cooldownUntil");
    const snap = await ref.once("value");
    const cooldownUntil = snap.val() as string | null;

    if (!cooldownUntil) return false;

    return new Date().toISOString() < cooldownUntil;
  } catch {
    return false; // never block on memory errors
  }
}

/**
 * Set a cooldown window for an insight after it's been surfaced.
 * Prevents re-surfacing the same insight too frequently.
 */
export async function setCooldown(
  tenantId: string,
  bizId: string,
  fingerprint: string,
  severity: string,
  isChronic: boolean
): Promise<void> {
  try {
    const hours = isChronic
      ? COOLDOWN_HOURS_CHRONIC
      : severity === "high"
        ? COOLDOWN_HOURS_HIGH
        : COOLDOWN_HOURS_MEDIUM;

    const cooldownUntil = new Date(Date.now() + hours * 3600_000).toISOString();

    await memoryRef(tenantId, bizId).child(fingerprint).child("cooldownUntil")
      .set(cooldownUntil);
  } catch (err) {
    logger.error("[Proactive Memory] Failed to set cooldown:", err);
  }
}

/**
 * Get all memory entries for a biz — used for weekly summary chronic detection.
 */
export async function getMemoryEntries(
  tenantId: string,
  bizId: string
): Promise<InsightMemoryEntry[]> {
  try {
    const snap = await memoryRef(tenantId, bizId).once("value");
    const raw = snap.val();
    if (!raw) return [];
    return Object.values(raw) as InsightMemoryEntry[];
  } catch (err) {
    logger.error("[Proactive Memory] Failed to get memory entries:", err);
    return [];
  }
}

/**
 * Get chronic patterns — memory entries with isChronic = true.
 */
export async function getChronicPatterns(
  tenantId: string,
  bizId: string
): Promise<InsightMemoryEntry[]> {
  try {
    const entries = await getMemoryEntries(tenantId, bizId);
    return entries.filter((e) => e.isChronic);
  } catch {
    return [];
  }
}
