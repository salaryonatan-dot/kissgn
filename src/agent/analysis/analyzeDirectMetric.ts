import type { MetricsPlan, FetchedData, AnalysisResult, BaselineResult } from "../types/agent.js";
import type { AgentContext } from "../types/agent.js";
import { avg, pctChange, round2 } from "../../utils/math.js";
import { METRIC_LABELS_HE } from "../types/shared.js";

export function analyzeDirectMetric(
  plan: MetricsPlan,
  fetched: FetchedData,
  baseline: BaselineResult,
  context: AgentContext
): AnalysisResult {
  const daily = (fetched.metrics["daily"] as Array<{ date: string; revenue: number; laborCost?: number; laborPct?: number; foodCost?: number; foodCostPct?: number }>) ?? [];
  const products = (fetched.metrics["products"] as Array<{ productName: string; quantitySold: number; revenue: number }>) ?? [];

  const facts: string[] = [];
  let answer = "";
  let meaning: string | undefined;

  // Product query
  if (plan.metrics.includes("product_quantity") || plan.metrics.includes("product_revenue")) {
    const sorted = [...products].sort((a, b) => b.quantitySold - a.quantitySold);
    if (sorted.length > 0) {
      const top = sorted[0];
      answer = `המוצר הכי נמכר הוא ${top.productName} עם ${top.quantitySold} יחידות`;
      facts.push(`${top.productName}: ${top.quantitySold} יח׳, ₪${round2(top.revenue)}`);
      if (sorted.length > 1) {
        facts.push(`מקום שני: ${sorted[1].productName} עם ${sorted[1].quantitySold} יח׳`);
      }
      if (sorted.length > 2) {
        facts.push(`מקום שלישי: ${sorted[2].productName} עם ${sorted[2].quantitySold} יח׳`);
      }
    } else {
      answer = "אין נתוני מוצרים לתקופה המבוקשת";
    }
    return { answer, supportingFacts: facts, meaning, usedSources: fetched.sources };
  }

  // Revenue query — respond with the metric the user asked for
  if (plan.metrics.includes("daily_revenue")) {
    const revenues = daily.map((d) => d.revenue);
    const total = revenues.reduce((a, b) => a + b, 0);
    const average = avg(revenues);

    // Detect whether user asked specifically for average or total
    const q = context.userQuestion ?? "";
    const askedForAverage = /ממוצע|average/i.test(q);
    const askedForTotal = /סה״כ|סה"כ|סה׳׳כ|סכום|בסך הכל|total|sum/i.test(q);

    if (askedForAverage) {
      answer = `ממוצע יומי: ₪${round2(average)}`;
      facts.push(`סה״כ הכנסות: ₪${round2(total)}`);
    } else if (askedForTotal) {
      answer = `סה״כ הכנסות: ₪${round2(total)}`;
      facts.push(`ממוצע יומי: ₪${round2(average)}`);
    } else {
      // Default: lead with total, show average as supporting fact
      answer = `סה״כ הכנסות: ₪${round2(total)}`;
      facts.push(`ממוצע יומי: ₪${round2(average)}`);
    }
    facts.push(`${daily.length} ימים בטווח`);

    if (baseline.valid && baseline.value) {
      const change = pctChange(average, baseline.value);
      facts.push(`${change > 0 ? "עלייה" : "ירידה"} של ${round2(Math.abs(change))}% מול baseline`);
      if (Math.abs(change) > 10) {
        meaning = change > 0
          ? "ביצועים מעל הממוצע — מגמה חיובית"
          : "ביצועים מתחת לממוצע — שווה לבדוק מה השתנה";
      }
    }

    return { answer, supportingFacts: facts, meaning, usedSources: fetched.sources };
  }

  // Labor query
  if (plan.metrics.includes("labor_cost") || plan.metrics.includes("labor_pct")) {
    const laborPcts = daily.filter((d) => d.laborPct != null).map((d) => d.laborPct!);
    const avgPct = avg(laborPcts);
    answer = `אחוז כוח אדם ממוצע: ${round2(avgPct)}%`;
    facts.push(`${daily.length} ימים בטווח`);
    if (avgPct > 30) {
      meaning = "אחוז כוח אדם גבוה — ייתכן שיש עודף שעות ביחס להכנסות";
    }
    return { answer, supportingFacts: facts, meaning, usedSources: fetched.sources };
  }

  // Food cost query
  if (plan.metrics.includes("food_cost") || plan.metrics.includes("food_cost_pct")) {
    const fcPcts = daily.filter((d) => d.foodCostPct != null).map((d) => d.foodCostPct!);
    const avgFc = avg(fcPcts);
    answer = `אחוז עלות מזון ממוצע: ${round2(avgFc)}%`;
    facts.push(`${daily.length} ימים בטווח`);
    return { answer, supportingFacts: facts, meaning, usedSources: fetched.sources };
  }

  answer = "הנתונים נשלפו אבל לא הצלחתי לנתח את המדד המבוקש";
  return { answer, supportingFacts: facts, usedSources: fetched.sources };
}
