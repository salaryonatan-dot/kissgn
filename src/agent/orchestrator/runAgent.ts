import type { AgentContext, AgentResponse, BaselineResult } from "../types/agent.js";
import { classifyIntent } from "../classifier/classifyIntent.js";
import { buildMetricsPlan } from "../planner/buildMetricsPlan.js";
import { fetchPlannedData } from "../../services/analyticsService.js";
import { validateData } from "../validation/validateData.js";
import { selectBaseline } from "../baseline/selectBaseline.js";
import { analyzeData } from "../analysis/analyzeData.js";
import { scoreConfidence } from "../confidence/scoreConfidence.js";
import { composeResponse } from "../response/composeResponse.js";
import { failSafeResponse } from "../response/failSafeResponse.js";
import { getRelevantBusinessMemory } from "../memory/getRelevantBusinessMemory.js";
import { saveBusinessInsight } from "../memory/saveBusinessInsight.js";
import { logger } from "../../utils/logging.js";

// Deterministic detector for questions specifically about hourly / weak-hour
// performance. Hourly POS data is unsupported this release (no per-business
// source), so such questions get the deterministic unsupported-data response —
// never a fabricated answer and never a daily-aggregate fallback.
const HOURLY_QUESTION_RE = /שעות\s+(שקטות|חלשות|חזקות|עמוסות|מתות)|לפי\s+שעה|פילוח\s+שעתי|ניתוח\s+שעתי|שעתי(ים|ות)?\b|weak.?hour|hourly|by\s+hour|per\s+hour/i;
function isHourlyQuestion(q: string): boolean {
  return HOURLY_QUESTION_RE.test(q || "");
}

export async function runAgent(context: AgentContext): Promise<AgentResponse> {
  const startMs = Date.now();

  try {
    // 1. Classify intent
    const intent = classifyIntent(context.userQuestion, context);
    logger.info(`intent=${intent} | question="${context.userQuestion.slice(0, 60)}"`);

    if (intent === "unknown_or_insufficient") {
      return failSafeResponse(intent, {
        ok: false,
        completenessScore: 0,
        freshnessScore: 0,
        consistencyScore: 0,
        sampleAdequacyScore: 0,
        issues: [{ code: "missing_data", severity: "high", message: "לא הצלחתי להבין את השאלה" }],
      }, []);
    }

    // Hourly / weak-hour questions: POS hourly data is unsupported this release.
    // Return the deterministic unsupported-data response (no fabrication, no
    // daily-aggregate fallback, no LLM) before any data fetch.
    if (isHourlyQuestion(context.userQuestion)) {
      logger.info("hourly question — unsupported data source; returning deterministic response");
      return failSafeResponse(intent, {
        ok: false,
        completenessScore: 0,
        freshnessScore: 0,
        consistencyScore: 0,
        sampleAdequacyScore: 0,
        issues: [{ code: "unsupported_hourly", severity: "high", message: "hourly POS data is not available" }],
      }, []);
    }

    // 2. Build metrics plan
    const plan = buildMetricsPlan(intent, context.userQuestion, context);

    // 3. Fetch memory (non-blocking, optional)
    const memory = plan.requiresMemory
      ? await getRelevantBusinessMemory(context.userQuestion, context)
      : [];

    // 4. Fetch data
    const fetched = await fetchPlannedData(plan, context);

    // 5. Validate data
    const validation = validateData({ fetched, plan, context });

    if (!validation.ok) {
      logger.warn(`Validation failed: ${validation.issues.map((i) => i.code).join(", ")}`);
      return failSafeResponse(intent, validation, fetched.sources);
    }

    // 6. Select baseline
    let baseline: BaselineResult = { baselineType: "none", sampleSize: 0, valid: true };
    if (plan.requiresBaseline) {
      baseline = selectBaseline(plan, fetched, context);
      if (!baseline.valid) {
        logger.warn(`Baseline invalid: ${baseline.reason}`);
        return failSafeResponse(intent, validation, fetched.sources);
      }
    }

    // 7. Analyze
    const analysis = await analyzeData({
      intent,
      plan,
      fetched,
      baseline,
      memory,
      context,
    });

    // 8. Score confidence
    const confidence = scoreConfidence({
      validation,
      baseline,
      analysis,
      fetched,
      plan,
    });

    if (confidence.shouldRefuse) {
      logger.warn(`Confidence too low: ${confidence.score}`);
      return failSafeResponse(intent, validation, fetched.sources);
    }

    // 9. Compose response
    const response = composeResponse({
      intent,
      analysis,
      confidence,
      context,
    });

    // 10. Update memory if warranted
    if (response.shouldUpdateMemory && analysis.patterns?.length) {
      await saveBusinessInsight({
        tenantId: context.tenantId,
        branchId: context.branchId,
        type: "recurring_anomaly",
        title: analysis.patterns[0],
        description: analysis.meaning ?? analysis.answer,
        confidence: confidence.score,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        evidenceRefs: fetched.evidenceRefs,
      });
    }

    const latencyMs = Date.now() - startMs;
    logger.info(`response ready | intent=${intent} | confidence=${confidence.score} | latency=${latencyMs}ms`);

    return response;
  } catch (err) {
    logger.error("runAgent failed:", err);
    return failSafeResponse("unknown_or_insufficient", {
      ok: false,
      completenessScore: 0,
      freshnessScore: 0,
      consistencyScore: 0,
      sampleAdequacyScore: 0,
      issues: [{ code: "missing_data", severity: "high", message: "שגיאה פנימית" }],
    }, []);
  }
}
