import { getDb } from "../../firebase/admin.js";
import { loadCanonicalInputs } from "../../finance-server/canonicalInputs.js";
import { canonicalDailySeries, canonicalLatestCompletedPresentDate } from "../../finance-server/canonicalMetrics.js";
import type { CanonicalDailyMetric } from "../../finance-server/canonicalMetrics.js";

// Financial Core B1: the per-business-date daily series for every downstream analytical
// consumer (agent analyses, proactive detectors, baseline selection, forecast) is served by
// the canonical server API over the approved Slice A core. Every stored row of a date
// contributes (duplicate business dates fold into one canonical day; no winner row); only
// PRESENT COMPLETED days (≤ D-1) are emitted; ratios are null when not a value; the legacy
// `hourly_payroll` map is never counted; daily labor = `payroll` + the global employees'
// calendar-day allocation. A malformed entries node throws the reader's typed
// EntriesStorageError; a Financial Core contract violation (e.g. duplicate row id) throws a
// typed FinanceContractError. This repository has no arithmetic of its own.
export async function getDailyMetrics(
  tenantId: string,
  startDate: string,
  endDate: string,
  bizId: string,
  _branchId?: string
): Promise<CanonicalDailyMetric[]> {
  const inputs = await loadCanonicalInputs(getDb(), tenantId, bizId, { site: "dailyMetricsRepo.getDailyMetrics", need: { config: true, fixed: false } });
  return canonicalDailySeries(inputs, { from: startDate, to: endDate }).days;
}

export async function getLatestDailyDate(tenantId: string, bizId: string): Promise<string | null> {
  const inputs = await loadCanonicalInputs(getDb(), tenantId, bizId, { site: "dailyMetricsRepo.getLatestDailyDate", need: { config: false, fixed: false } });
  return canonicalLatestCompletedPresentDate(inputs);
}
