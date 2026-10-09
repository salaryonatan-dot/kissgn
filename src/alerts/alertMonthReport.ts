// Server-API read for alert checkers. Threshold decisions stay in checkers.ts.
import { getDb } from "../firebase/admin.js";
import { loadCanonicalInputs } from "../finance-server/canonicalInputs.js";
import { canonicalMonthReport } from "../finance-server/canonicalMetrics.js";

export async function loadAlertMonthReport(tenantId: string, bizId: string, nowMs: number):
  Promise<ReturnType<typeof canonicalMonthReport>["report"]> {
  const inputs = await loadCanonicalInputs(getDb(), tenantId, bizId, {
    site: "alerts.monthlyRatio", nowMs, need: { config: true, fixed: true, exceptions: true },
  });
  return canonicalMonthReport(inputs, { kind: "open_month", month: inputs.asOfBusinessDate.slice(0, 7) }).report;
}
