// Marjin AI — Proactive Insights Digest Builders (Phase 2)
// Daily Digest + Weekly Summary. Deterministic. No LLM.

import type {
  ProactiveInsight,
  DailyDigest,
  WeeklySummary,
  ChronicPattern,
} from "./types.js";
import { pickTopInsights } from "./prioritization.js";
import { getMemoryEntries } from "./memoryManager.js";
import { getRecentInsights } from "../../repositories/proactive/insightsRepo.js";
import { todayIso } from "../../utils/dates.js";
import { logger } from "../../utils/logging.js";

// --- Constants ---
const MAX_DAILY_INSIGHTS = 3;
const MAX_WEEKLY_HIGHLIGHTS = 5;

// ── Daily Digest ─────────────────────────────────────────────────────────────

/**
 * Build a daily digest for a single biz.
 * Contains top 2-3 insights by impact score, plus summary counts.
 *
 * Input: today's ProactiveJobResult insights (already generated + suppressed)
 * Output: structured DailyDigest object for WhatsApp/dashboard.
 */
export function buildDailyDigest(
  tenantId: string,
  bizId: string,
  generatedInsights: ProactiveInsight[],
  suppressedCount: number
): DailyDigest {
  const today = todayIso();

  // Only non-suppressed insights for ranking
  const active = generatedInsights.filter((i) => !i.suppressed);
  const topInsights = pickTopInsights(active, MAX_DAILY_INSIGHTS);

  return {
    tenantId,
    bizId,
    date: today,
    topInsights,
    totalDetected: generatedInsights.length + suppressedCount,
    totalSuppressed: suppressedCount,
    generatedAt: new Date().toISOString(),
  };
}

// ── Weekly Summary ───────────────────────────────────────────────────────────

/**
 * Build a weekly summary for a single biz.
 * Aggregates 7 days of insights, identifies repeated patterns and chronic issues.
 *
 * This reads from Firebase (last 7 days of stored insights) + memory entries.
 */
export async function buildWeeklySummary(
  tenantId: string,
  bizId: string
): Promise<WeeklySummary> {
  const now = new Date();
  const weekStr = getIsoWeekStr(now);
  const periodEnd = todayIso();
  const periodStart = daysAgoIso(7);

  // Fetch all insights from the past 7 days
  let weekInsights: ProactiveInsight[] = [];
  try {
    weekInsights = await getRecentInsights(tenantId, bizId, 7);
  } catch (err) {
    logger.error("[Proactive Digest] Failed to fetch weekly insights:", err);
  }

  const activeInsights = weekInsights.filter((i) => !i.suppressed);
  const suppressedInsights = weekInsights.filter((i) => i.suppressed);

  // Top 5 highlights by impact score
  const highlights = pickTopInsights(activeInsights, MAX_WEEKLY_HIGHLIGHTS);

  // Detect chronic patterns from memory
  let chronicPatterns: ChronicPattern[] = [];
  try {
    const memoryEntries = await getMemoryEntries(tenantId, bizId);
    chronicPatterns = memoryEntries
      .filter((e) => e.isChronic)
      .map((e) => ({
        type: e.type,
        metric: e.metric,
        occurrenceCount: e.recurrenceCount,
        firstSeen: e.firstDetectedAt,
        lastSeen: e.lastDetectedAt,
        avgDeviationPct: e.avgDeviationPct,
      }));
  } catch (err) {
    logger.error("[Proactive Digest] Failed to get chronic patterns:", err);
  }

  return {
    tenantId,
    bizId,
    weekStr,
    periodStart,
    periodEnd,
    highlights,
    chronicPatterns,
    totalInsightsGenerated: activeInsights.length,
    totalInsightsSuppressed: suppressedInsights.length,
    generatedAt: new Date().toISOString(),
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function getIsoWeekStr(date: Date): string {
  const year = date.getFullYear();
  const jan1 = new Date(year, 0, 1);
  const days = Math.floor((date.getTime() - jan1.getTime()) / 86_400_000);
  const week = Math.ceil((days + jan1.getDay() + 1) / 7);
  return `${year}-W${String(week).padStart(2, "0")}`;
}
