import { getDb } from "../../firebase/admin.js";
import { loadCanonicalInputs } from "../../finance-server/canonicalInputs.js";
import { canonicalLaborRecords } from "../../finance-server/canonicalMetrics.js";
import type { CanonicalLaborMetric } from "../../finance-server/canonicalMetrics.js";

// Financial Core B1: one labor record per PRESENT COMPLETED business date (duplicate dates
// fold), served by the canonical server API. totalCost = the canonical daily labor
// (`payroll` + global calendar-day allocation, MARJIN_LABOR/2); `hourly_payroll` is never
// counted; facts that manual entries do not carry (hours, head count, cost per hour) are null.
export async function getLaborMetrics(
  tenantId: string,
  startDate: string,
  endDate: string,
  bizId: string,
  _branchId?: string
): Promise<CanonicalLaborMetric[]> {
  const inputs = await loadCanonicalInputs(getDb(), tenantId, bizId, { site: "laborRepo.getLaborMetrics", need: { config: true, fixed: false } });
  return canonicalLaborRecords(inputs, { from: startDate, to: endDate });
}
