// Marjin AI — Proactive Insights Job Orchestrator
// Scheduled job that runs detectors for each tenant+biz.
// Deterministic. No LLM. Reuses existing pipeline modules.

import type { AgentContext, MetricsPlan, FetchedData, BaselineResult } from "../types/agent.js";
import type { DetectorResult, ProactiveInsight, ProactiveJobResult, ProactiveJobSummary, DailyDigest } from "./types.js";

// Existing pipeline modules — reused as-is, never modified
import { fetchPlannedData } from "../../services/analyticsService.js";
import { validateData } from "../validation/validateData.js";
import { selectBaseline } from "../baseline/selectBaseline.js";
import { scoreConfidence } from "../confidence/scoreConfidence.js";
import { saveBusinessInsight } from "../memory/saveBusinessInsight.js";

// Proactive layer modules — Phase 1 detectors
import { detectDailyRevenueUnderperformance } from "./detectors/detectDailyRevenueUnderperformance.js";
import { detectLaborInefficiency } from "./detectors/detectLaborInefficiency.js";
import { detectWeakDayPattern } from "./detectors/detectWeakDayPattern.js";
// Phase 2 detectors
import { detectWeakHourPattern } from "./detectors/detectWeakHourPattern.js";
import { detectPurchasesWithoutRevenueSupport } from "./detectors/detectPurchasesWithoutRevenueSupport.js";
import { detectForecastRisk } from "./detectors/detectForecastRisk.js";
// Dedup, suppression, repo
import { computeFingerprint, checkDeduplication, bumpExistingInsight } from "./deduplication.js";
import { evaluateSuppression } from "./suppressionRules.js";
import { saveProactiveInsight, getRecentInsights } from "../../repositories/proactive/insightsRepo.js";
// Phase 2: memory + digest + prioritization
import { trackInsightOccurrence, isInCooldown, setCooldown } from "./memoryManager.js";
import { buildDailyDigest } from "./digestBuilder.js";

// Utilities
import { daysAgoIso, todayIso } from "../../utils/dates.js";
import { logger } from "../../utils/logging.js";
import { proactiveBizIndexRef } from "../../firebase/refs.js";

/**
 * Run the full proactive insights job for all active tenants.
 * Designed to be called by a Vercel cron or manual trigger.
 */
export async function runProactiveJob(): Promise<ProactiveJobSummary> {
  const jobId = `proactive-${Date.now()}`;
  const startedAt = new Date().toISOString();
  logger.info(`[Proactive] Job ${jobId} started`);

  const tenantBizPairs = await getActiveTenantBizPairs();
  const results: ProactiveJobResult[] = [];

  for (const { tenantId, bizId } of tenantBizPairs) {
    try {
      const result = await runForBiz(tenantId, bizId);
      results.push(result);
    } catch (err) {
      logger.error(`[Proactive] Failed for ${tenantId}/${bizId}:`, err);
      results.push({
        tenantId,
        bizId,
        insightsGenerated: 0,
        insightsSuppressed: 0,
        insightsUpdated: 0,
        errors: [String(err)],
      });
    }
  }

  const summary: ProactiveJobSummary = {
    jobId,
    startedAt,
    completedAt: new Date().toISOString(),
    tenantsScanned: tenantBizPairs.length,
    totalInsightsGenerated: results.reduce((s, r) => s + r.insightsGenerated, 0),
    totalInsightsSuppressed: results.reduce((s, r) => s + r.insightsSuppressed, 0),
    totalErrors: results.reduce((s, r) => s + r.errors.length, 0),
  };

  logger.info(`[Proactive] Job ${jobId} completed: ${summary.totalInsightsGenerated} generated, ${summary.totalInsightsSuppressed} suppressed, ${summary.totalErrors} errors`);
  return summary;
}

/**
 * Run proactive detectors for a single tenant+biz pair.
 * This is the core per-business flow.
 */
export async function runForBiz(
  tenantId: string,
  bizId: string,
  branchId?: string
): Promise<ProactiveJobResult> {
  const errors: string[] = [];
  let insightsGenerated = 0;
  let insightsSuppressed = 0;
  let insightsUpdated = 0;

  // Step 1: Build synthetic context + plan for 28-day window
  const context = buildSyntheticContext(tenantId, bizId, branchId);
  const plan = buildProactivePlan(context);

  // Step 2: Fetch data (reuse existing fetchPlannedData)
  const fetched = await fetchPlannedData(plan, context);

  // Step 3: Validate data (reuse existing validateData)
  const validation = validateData({ fetched, plan, context });
  if (!validation.ok) {
    logger.info(`[Proactive] ${tenantId}/${bizId}: validation failed — skipping`);
    return { tenantId, bizId, insightsGenerated: 0, insightsSuppressed: 0, insightsUpdated: 0, errors: ["validation_failed"] };
  }

  // Step 4: Build baseline (reuse existing selectBaseline)
  const baseline = selectBaseline(plan, fetched, context);
  if (!baseline.valid) {
    logger.info(`[Proactive] ${tenantId}/${bizId}: baseline invalid — skipping`);
    return { tenantId, bizId, insightsGenerated: 0, insightsSuppressed: 0, insightsUpdated: 0, errors: ["baseline_invalid"] };
  }

  // Step 5: Load recent insights for dedup + suppression
  const recentInsights = await getRecentInsights(tenantId, bizId, 7);

  // Step 6: Run all detectors (Phase 1 + Phase 2)
  const detectorResults: DetectorResult[] = [];
  const detectors = [
    // Phase 1 detectors (unchanged)
    { name: "revenue_underperformance", fn: () => detectDailyRevenueUnderperformance(fetched, baseline) },
    { name: "labor_inefficiency", fn: () => detectLaborInefficiency(fetched, baseline) },
    { name: "weak_day_pattern", fn: () => detectWeakDayPattern(fetched, baseline) },
    // Phase 2 detectors
    { name: "weak_hour_pattern", fn: () => detectWeakHourPattern(fetched, baseline) },
    { name: "purchases_without_revenue", fn: () => detectPurchasesWithoutRevenueSupport(fetched, baseline) },
    { name: "forecast_risk", fn: () => detectForecastRisk(fetched, baseline) },
  ];

  for (const detector of detectors) {
    try {
      const result = detector.fn();
      if (result) {
        detectorResults.push(result);
      }
    } catch (err) {
      logger.error(`[Proactive] Detector ${detector.name} failed:`, err);
      errors.push(`detector_${detector.name}_failed`);
    }
  }

  // Step 7: Process each detector result through pipeline
  for (const result of detectorResults) {
    try {
      const processed = await processDetectorResult(
        result, tenantId, bizId, branchId, validation, baseline, fetched, recentInsights
      );

      if (processed === "generated") insightsGenerated++;
      else if (processed === "suppressed") insightsSuppressed++;
      else if (processed === "updated") insightsUpdated++;
    } catch (err) {
      logger.error(`[Proactive] Processing ${result.type} failed:`, err);
      errors.push(`processing_${result.type}_failed`);
    }
  }

  // Step 8 (Phase 2): Build daily digest — best-effort, never fails the job
  try {
    const todaysInsights = await getRecentInsights(tenantId, bizId, 1);
    const digest = buildDailyDigest(tenantId, bizId, todaysInsights, insightsSuppressed);
    // Store digest for dashboard/WhatsApp retrieval
    await saveDailyDigest(tenantId, bizId, digest);
  } catch (err) {
    logger.error(`[Proactive] Digest build failed for ${tenantId}/${bizId}:`, err);
    // Best-effort — don't add to errors, don't fail the job
  }

  return { tenantId, bizId, insightsGenerated, insightsSuppressed, insightsUpdated, errors };
}

/**
 * Process a single detector result through: confidence → dedup → suppression → store.
 */
async function processDetectorResult(
  result: DetectorResult,
  tenantId: string,
  bizId: string,
  branchId: string | undefined,
  validation: ReturnType<typeof validateData>,
  baseline: BaselineResult,
  fetched: FetchedData,
  recentInsights: ProactiveInsight[]
): Promise<"generated" | "suppressed" | "updated"> {
  // Step A: Score confidence (reuse existing scoreConfidence)
  const syntheticAnalysis = {
    answer: "",
    supportingFacts: result.supportingFacts,
    usedSources: result.evidenceRefs,
  };
  const confidence = scoreConfidence({
    validation,
    baseline,
    analysis: syntheticAnalysis,
    fetched,
  });

  // Only high or medium confidence level — low is auto-rejected
  if (confidence.shouldRefuse || confidence.score < 0.65) {
    return "suppressed";
  }

  // Step A.5 (Phase 2): Cooldown check — skip if recently surfaced
  const fingerprint = computeFingerprint(result);
  const coolingDown = await isInCooldown(tenantId, bizId, fingerprint);
  if (coolingDown) {
    return "suppressed";
  }

  // Step B: Deduplication check
  const { isDuplicate, existingInsight } = await checkDeduplication(
    tenantId, bizId, result, recentInsights
  );

  if (isDuplicate && existingInsight) {
    await bumpExistingInsight(existingInsight);
    return "updated";
  }

  // Step C: Suppression rules
  const suppression = evaluateSuppression({
    result,
    confidence,
    validation,
    recentInsights,
    isDuplicate,
  });

  // Step D: Build the insight object
  const now = new Date().toISOString();
  // fingerprint already computed in Step A.5
  const dateKey = todayIso();

  const insight: ProactiveInsight = {
    id: buildSafeInsightId(tenantId, bizId, result.type, dateKey),
    tenantId,
    bizId,
    branchId,

    type: result.type,
    severity: result.severity,

    metric: result.metric,
    currentValue: result.currentValue,
    baselineValue: result.baselineValue,
    deviationPct: result.deviationPct,

    periodStart: result.periodStart,
    periodEnd: result.periodEnd,
    dataPointCount: result.dataPointCount,

    confidenceScore: confidence.score,
    confidenceLevel: confidence.level === "high" ? "high" : "medium",

    fingerprint,
    firstDetectedAt: now,
    lastDetectedAt: now,
    occurrenceCount: 1,

    suppressed: suppression.suppressed,
    suppressionReason: suppression.reason,

    evidenceRefs: result.evidenceRefs,
    supportingFacts: result.supportingFacts,

    writtenToMemory: false,
  };

  // Step E: Store the insight
  await saveProactiveInsight(insight);

  // Step E.5 (Phase 2): Track occurrence in memory + set cooldown
  // ONLY for non-suppressed insights — suppressed must NOT inflate recurrence/chronic
  if (!suppression.suppressed) {
    const memEntry = await trackInsightOccurrence(tenantId, bizId, insight);
    await setCooldown(tenantId, bizId, insight.fingerprint, insight.severity, memEntry.isChronic);
  }

  // Step F: Write to agent memory if eligible
  // Rules: confidenceLevel === "high" AND occurrenceCount >= 2 (but this is new, so skip)
  // Memory write will happen on next occurrence when it gets bumped to count >= 2
  // Exception: high-severity insights are written immediately
  if (!suppression.suppressed && confidence.level === "high" && result.severity === "high") {
    await writeToAgentMemory(insight);
  }

  return suppression.suppressed ? "suppressed" : "generated";
}

/**
 * Write a proactive insight to the existing agent memory system.
 * Uses existing saveBusinessInsight — never modifies it.
 */
async function writeToAgentMemory(insight: ProactiveInsight): Promise<void> {
  try {
    const memoryTypeMap: Record<string, string> = {
      revenue_underperformance: "recurring_anomaly",
      labor_inefficiency: "labor_inefficiency",
      weak_day_pattern: "repeated_weak_day",
      weak_hour_pattern: "repeated_weak_hour",
      purchases_without_revenue: "purchase_anomaly",
      forecast_risk: "forecast_risk",
    };
    const memoryType = memoryTypeMap[insight.type] || "recurring_anomaly";

    await saveBusinessInsight({
      tenantId: insight.tenantId,
      branchId: insight.branchId,
      type: memoryType,
      title: `[proactive] ${insight.type}: ${insight.metric}`,
      description: insight.supportingFacts.join(". "),
      confidence: insight.confidenceScore,
      createdAt: insight.firstDetectedAt,
      updatedAt: insight.lastDetectedAt,
      evidenceRefs: insight.evidenceRefs,
    });

    // Mark as written to memory
    await import("../../repositories/proactive/insightsRepo.js").then((repo) =>
      repo.updateProactiveInsight(insight.tenantId, insight.bizId, insight.id, {
        writtenToMemory: true,
      })
    );
  } catch (err) {
    // Best-effort — never fail the job for a memory write
    logger.error("[Proactive] Failed to write to agent memory:", err);
  }
}

/**
 * Save daily digest to Firebase for dashboard/WhatsApp retrieval.
 * Path: tenants/{tenantId}/proactive_digests/{bizId}/daily/{date}
 */
async function saveDailyDigest(tenantId: string, bizId: string, digest: DailyDigest): Promise<void> {
  try {
    const { getDb } = await import("../../firebase/admin.js");
    await getDb()
      .ref(`tenants/${tenantId}/proactive_digests/${bizId}/daily/${digest.date}`)
      .set(digest);
  } catch (err) {
    logger.error("[Proactive] Failed to save daily digest:", err);
  }
}

// --- Synthetic context/plan builders ---

function buildSyntheticContext(tenantId: string, bizId: string, branchId?: string): AgentContext {
  return {
    tenantId,
    bizId,
    branchId,
    timezone: "Asia/Jerusalem",
    locale: "he-IL",
    nowIso: new Date().toISOString(),
    userQuestion: "__proactive_scan__", // not a real user question
  };
}

function buildProactivePlan(context: AgentContext): MetricsPlan {
  return {
    intent: "anomaly_detection",  // closest existing intent for baseline selection
    metrics: ["daily_revenue", "labor_cost", "labor_pct", "hourly_revenue", "purchases", "food_cost"],
    dimensions: ["date", "day_of_week", "hour"],
    filters: {},
    timeRange: {
      start: daysAgoIso(28),
      end: todayIso(),
    },
    requiresBaseline: true,
    requiresComparison: false,
    requiresAnomalyDetection: false,
    requiresForecast: false,
    requiresMemory: false,
    branchScope: context.branchId ? "single" : "all",
    preferredSources: ["processed_analytics"],
  };
}

/**
 * Get active tenant+biz pairs from a dedicated flat index.
 * Reads ONLY `proactive_biz_index/` — O(number_of_businesses), never touches tenant data.
 *
 * Index structure at `proactive_biz_index/`:
 *   { "tenantId_bizId": { tenantId: "...", bizId: "...", active: true } }
 *
 * The index is populated by the daily-builder job or a separate registration flow.
 * If the index is empty, falls back to scanning tenant keys with a shallow read.
 */
async function getActiveTenantBizPairs(): Promise<Array<{ tenantId: string; bizId: string }>> {
  const pairs: Array<{ tenantId: string; bizId: string }> = [];

  try {
    // Primary: read the flat index (lightweight — only contains tenantId+bizId pairs)
    const indexSnap = await proactiveBizIndexRef()
      .orderByChild("active")
      .equalTo(true)
      .once("value");

    const indexData = indexSnap.val();

    if (indexData) {
      for (const entry of Object.values(indexData) as Array<{ tenantId: string; bizId: string; active: boolean }>) {
        if (entry.tenantId && entry.bizId) {
          pairs.push({ tenantId: entry.tenantId, bizId: entry.bizId });
        }
      }
      if (pairs.length > 0) return pairs;
    }

    // Fallback: use Firebase REST API with ?shallow=true to get ONLY key names.
    // Admin SDK doesn't support shallow reads, so we call REST directly.
    const dbUrl = process.env.FIREBASE_DATABASE_URL || "";

    if (!dbUrl) {
      logger.error("[Proactive] No FIREBASE_DATABASE_URL — cannot discover tenants");
      return pairs;
    }

    // Step 1: Get tenant IDs only (shallow = just keys, no subtree)
    const tenantKeys = await shallowReadKeys(`${dbUrl}/tenants.json?shallow=true`);

    // Step 2: For each tenant, get child keys (shallow) to find biz:*:entries
    for (const tenantId of tenantKeys) {
      try {
        const childKeys = await shallowReadKeys(`${dbUrl}/tenants/${tenantId}.json?shallow=true`);

        const bizIds = new Set<string>();
        for (const key of childKeys) {
          const match = key.match(/^biz:(.+?):entries$/);
          if (match) {
            bizIds.add(match[1]);
          }
        }

        for (const bizId of bizIds) {
          pairs.push({ tenantId, bizId });
          // Register in index so next run uses the fast path
          await registerBizInIndex(tenantId, bizId);
        }
      } catch {
        // skip this tenant
      }
    }
  } catch (err) {
    logger.error("[Proactive] Failed to load tenant+biz pairs:", err);
  }

  return pairs;
}

/**
 * Register a tenant+biz pair in the proactive index.
 * Called during fallback discovery and can be called from daily-builder.
 */
export async function registerBizInIndex(tenantId: string, bizId: string): Promise<void> {
  try {
    const key = sanitizeFirebaseKey(`${tenantId}_${bizId}`);
    await proactiveBizIndexRef().child(key).set({
      tenantId,
      bizId,
      active: true,
      registeredAt: new Date().toISOString(),
    });
  } catch (err) {
    logger.error("[Proactive] Failed to register biz in index:", err);
  }
}

/**
 * Build a Firebase-safe insight ID. No colons, dots, or special chars.
 * Format: {sanitized_tenantId}_{sanitized_bizId}_{type}_{dateKey}
 */
function buildSafeInsightId(tenantId: string, bizId: string, type: string, dateKey: string): string {
  return sanitizeFirebaseKey(`${tenantId}_${bizId}_${type}_${dateKey}`);
}

/**
 * Sanitize a string for use as a Firebase RTDB key.
 * Replaces . $ # [ ] / with underscore. Colons replaced too for safety.
 */
function sanitizeFirebaseKey(raw: string): string {
  return raw.replace(/[.$#\[\]\/: ]/g, "_");
}

/**
 * Firebase REST shallow read — returns only the top-level keys.
 * ?shallow=true makes Firebase return { "key1": true, "key2": true, ... }
 * This downloads bytes proportional to key count, NOT data size.
 */
async function shallowReadKeys(url: string): Promise<string[]> {
  try {
    // Use Firebase Admin credential for REST auth
    const { getDb } = await import("../../firebase/admin.js");
    const app = getDb().app;
    const token = await app.options.credential?.getAccessToken();

    const authUrl = token
      ? `${url}${url.includes("?") ? "&" : "?"}access_token=${token.access_token}`
      : url;

    const response = await fetch(authUrl);
    if (!response.ok) return [];

    const data = await response.json();
    if (!data || typeof data !== "object") return [];

    return Object.keys(data);
  } catch (err) {
    logger.error("[Proactive] Shallow read failed:", err);
    return [];
  }
}
