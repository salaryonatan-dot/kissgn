// Marjin AI — Proactive Insights Repository
// Firebase CRUD for proactive insights. Best-effort writes — never blocks callers.

import type { ProactiveInsight } from "../../agent/proactive/types.js";
import { proactiveInsightsRef } from "../../firebase/refs.js";
import { logger } from "../../utils/logging.js";

/**
 * Save a new proactive insight or update an existing one (by id).
 */
export async function saveProactiveInsight(insight: ProactiveInsight): Promise<void> {
  try {
    const ref = proactiveInsightsRef(insight.tenantId, insight.bizId);
    await ref.child(insight.id).set(insight);
  } catch (err) {
    logger.error("Failed to save proactive insight:", err);
  }
}

/**
 * Update an existing insight (partial update).
 */
export async function updateProactiveInsight(
  tenantId: string,
  bizId: string,
  insightId: string,
  updates: Partial<ProactiveInsight>
): Promise<void> {
  try {
    const ref = proactiveInsightsRef(tenantId, bizId);
    await ref.child(insightId).update(updates);
  } catch (err) {
    logger.error("Failed to update proactive insight:", err);
  }
}

/**
 * Get recent insights for a tenant+biz within the last N days.
 * Used for deduplication and quota checks.
 */
export async function getRecentInsights(
  tenantId: string,
  bizId: string,
  sinceDaysAgo: number = 7
): Promise<ProactiveInsight[]> {
  try {
    const ref = proactiveInsightsRef(tenantId, bizId);
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - sinceDaysAgo);
    const cutoffIso = cutoff.toISOString();

    const snapshot = await ref
      .orderByChild("lastDetectedAt")
      .startAt(cutoffIso)
      .once("value");

    const raw = snapshot.val();
    if (!raw) return [];

    return Object.values(raw) as ProactiveInsight[];
  } catch (err) {
    logger.error("Failed to get recent insights:", err);
    return [];
  }
}

/**
 * Get active (non-suppressed) insights for dashboard display.
 * Sorted by severity (high first), then by lastDetectedAt (newest first).
 */
export async function getActiveInsights(
  tenantId: string,
  bizId: string,
  limit: number = 10
): Promise<ProactiveInsight[]> {
  try {
    const ref = proactiveInsightsRef(tenantId, bizId);
    // Fetch recent insights (last 14 days)
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 14);
    const cutoffIso = cutoff.toISOString();

    const snapshot = await ref
      .orderByChild("lastDetectedAt")
      .startAt(cutoffIso)
      .once("value");

    const raw = snapshot.val();
    if (!raw) return [];

    const all = Object.values(raw) as ProactiveInsight[];

    // Filter: non-suppressed only
    const active = all.filter((i) => !i.suppressed);

    // Sort: high severity first, then newest
    const severityOrder: Record<string, number> = { high: 0, medium: 1, low: 2 };
    active.sort((a, b) => {
      const sevDiff = (severityOrder[a.severity] ?? 2) - (severityOrder[b.severity] ?? 2);
      if (sevDiff !== 0) return sevDiff;
      return b.lastDetectedAt.localeCompare(a.lastDetectedAt);
    });

    return active.slice(0, limit);
  } catch (err) {
    logger.error("Failed to get active insights:", err);
    return [];
  }
}

/**
 * Find insight by fingerprint (for deduplication).
 */
export async function findByFingerprint(
  tenantId: string,
  bizId: string,
  fingerprint: string
): Promise<ProactiveInsight | null> {
  try {
    const ref = proactiveInsightsRef(tenantId, bizId);
    const snapshot = await ref
      .orderByChild("fingerprint")
      .equalTo(fingerprint)
      .limitToFirst(1)
      .once("value");

    const raw = snapshot.val();
    if (!raw) return null;

    const entries = Object.values(raw) as ProactiveInsight[];
    return entries[0] ?? null;
  } catch (err) {
    logger.error("Failed to find insight by fingerprint:", err);
    return null;
  }
}
