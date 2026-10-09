import type { FetchedData, BaselineResult } from "../../types/agent.js";
import type { DetectorResult } from "../types.js";
import type { AgentFinancialMonth } from "../../financialMonth.js";
import { completeRatio } from "../../financialMonth.js";
import { formatShekel } from "../../../presenters/money.js";
import { formatPercent } from "../../../presenters/percent.js";

// Month-to-date labor uses the report's full employer cost and ratio of totals.
// A partial source, unreadable configuration, or missing month report is not a
// healthy condition and must never produce a detector conclusion.
export function detectLaborInefficiency(fetched: FetchedData, _baseline: BaselineResult): DetectorResult | null {
  const month = fetched.metrics["financialMonth"] as AgentFinancialMonth | undefined;
  const report = month?.report;
  const policy = month?.policy;
  if (!report || !policy || report.window.state !== "actual" || report.coverage.revenue.presentDays < 7) return null;
  if (report.actual.labor.employerCost.state !== "complete") return null;
  const ratio = completeRatio(report.actual.labor.employerCostPct);
  if (ratio === null) return null;
  const warning = Number(policy.values["alert.laborPctMax"].value);
  const critical = Number(policy.values["alert.laborPctCritical"].value);
  if (!Number.isFinite(warning) || warning <= 0 || !Number.isFinite(critical) || ratio <= warning) return null;
  return {
    type: "labor_inefficiency",
    severity: ratio > critical ? "high" : "medium",
    metric: "labor_pct",
    currentValue: ratio,
    baselineValue: warning,
    deviationPct: ((ratio - warning) / warning) * 100,
    periodStart: report.window.from!,
    periodEnd: report.window.to!,
    dataPointCount: report.coverage.revenue.presentDays,
    supportingFacts: [
      `עלות מעסיק מלאה MTD: ${formatShekel(report.actual.labor.employerCost.value)}`,
      `שיעור כוח אדם MTD: ${formatPercent(report.actual.labor.employerCostPct)}`,
      `סף התראה: ${formatPercent(String(warning))} (${policy.values["alert.laborPctMax"].source})`,
    ],
    evidenceRefs: [`finance:${report.window.month}:${report.versions.fin}`, `policy:${policy.policyVersion}`],
  };
}
