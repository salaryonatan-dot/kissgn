import type { AnomalyResult } from "../types/agent.js";
import { avg, pctChange, round2 } from "../../utils/math.js";
import { zScore } from "../../utils/stats.js";

interface DailyRecord {
  date: string;
  revenue: number;
  laborCost?: number;
  laborPct?: number;
  foodCostPct?: number;
}

export function detectAnomalies(data: DailyRecord[], options: { zThreshold?: number; absLaborThreshold?: number } = {}): AnomalyResult[] {
  const { zThreshold = 2.0, absLaborThreshold = 32 } = options;
  const anomalies: AnomalyResult[] = [];
  if (data.length < 7) return anomalies;

  const sorted = [...data].sort((a, b) => a.date.localeCompare(b.date));

  // Revenue anomalies — check last 3 days against history
  const revenues = sorted.map((d) => d.revenue);
  const recent3 = sorted.slice(-3);
  for (const day of recent3) {
    const z = zScore(day.revenue, revenues, zThreshold);
    if (z.isAnomaly) {
      anomalies.push({
        metric: "daily_revenue",
        detected: true,
        severity: Math.abs(z.zScore) > 3 ? "high" : "medium",
        type: "baseline_deviation",
        currentValue: day.revenue,
        baselineValue: avg(revenues),
        deviationPct: round2(pctChange(day.revenue, avg(revenues))),
        explanation: `${day.date}: הכנסות ${z.direction === "high" ? "גבוהות" : "נמוכות"} חריג (z=${round2(z.zScore)})`,
      });
    }
  }

  // Labor % anomalies
  const laborPcts = sorted.filter((d) => d.laborPct != null).map((d) => ({ date: d.date, val: d.laborPct! }));
  if (laborPcts.length >= 7) {
    const vals = laborPcts.map((l) => l.val);
    for (const day of laborPcts.slice(-3)) {
      const z = zScore(day.val, vals, 1.8);
      if (z.isAnomaly || day.val > absLaborThreshold) {
        anomalies.push({
          metric: "labor_pct",
          detected: true,
          severity: day.val > 38 ? "high" : day.val > absLaborThreshold ? "medium" : "low",
          type: z.isAnomaly ? "baseline_deviation" : "absolute",
          currentValue: day.val,
          baselineValue: avg(vals),
          deviationPct: round2(pctChange(day.val, avg(vals))),
          explanation: `${day.date}: כוח אדם ${round2(day.val)}% (ממוצע: ${round2(avg(vals))}%)`,
        });
      }
    }
  }

  return anomalies;
}
