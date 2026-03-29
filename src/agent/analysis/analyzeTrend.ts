import type { MetricsPlan, FetchedData, AnalysisResult, BaselineResult } from "../types/agent.js";
import type { AgentContext } from "../types/agent.js";
import { avg, round2 } from "../../utils/math.js";
import { trendDirection } from "../../utils/stats.js";
import { dowToHebDay } from "../../utils/dates.js";

export function analyzeTrend(
  plan: MetricsPlan,
  fetched: FetchedData,
  baseline: BaselineResult,
  context: AgentContext
): AnalysisResult {
  const daily = (fetched.metrics["daily"] as Array<{ date: string; revenue: number; laborPct?: number }>) ?? [];
  const facts: string[] = [];
  const patterns: string[] = [];
  let answer = "";
  let meaning: string | undefined;

  if (daily.length < 7) {
    return {
      answer: "אין מספיק נתונים לניתוח מגמה",
      supportingFacts: [],
      usedSources: fetched.sources,
    };
  }

  const sorted = [...daily].sort((a, b) => a.date.localeCompare(b.date));
  const revenues = sorted.map((d) => d.revenue);
  const direction = trendDirection(revenues);

  // Weekly breakdown
  const byDow: Record<number, number[]> = {};
  for (const d of sorted) {
    const dow = new Date(d.date + "T12:00:00").getDay();
    if (!byDow[dow]) byDow[dow] = [];
    byDow[dow].push(d.revenue);
  }

  // Find weakest and strongest days
  const dowAvgs = Object.entries(byDow).map(([dow, vals]) => ({
    dow: Number(dow),
    avg: avg(vals),
    count: vals.length,
  }));
  dowAvgs.sort((a, b) => a.avg - b.avg);

  const weakest = dowAvgs[0];
  const strongest = dowAvgs[dowAvgs.length - 1];

  answer = `מגמת הכנסות: ${direction === "rising" ? "עולה" : direction === "falling" ? "יורדת" : "יציבה"}`;
  facts.push(`ממוצע יומי: ₪${round2(avg(revenues))}`);
  facts.push(`היום החזק ביותר: ${dowToHebDay(strongest.dow)} (₪${round2(strongest.avg)})`);
  facts.push(`היום החלש ביותר: ${dowToHebDay(weakest.dow)} (₪${round2(weakest.avg)})`);

  if (direction === "falling") {
    meaning = "מגמה יורדת — שווה לבדוק אם מדובר בעונתיות או בבעיה מתמשכת";
    patterns.push("מגמת ירידה בהכנסות");
  } else if (direction === "rising") {
    meaning = "מגמה עולה — הכיוון חיובי";
    patterns.push("מגמת עלייה בהכנסות");
  }

  // Check for consistently weak day
  if (weakest.count >= 3 && weakest.avg < avg(revenues) * 0.7) {
    patterns.push(`יום ${dowToHebDay(weakest.dow)} חלש באופן עקבי`);
  }

  return { answer, supportingFacts: facts, meaning, patterns, usedSources: fetched.sources };
}
