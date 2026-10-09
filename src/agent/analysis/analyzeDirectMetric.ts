import type { MetricsPlan, FetchedData, AnalysisResult, BaselineResult } from "../types/agent.js";
import type { AgentContext } from "../types/agent.js";
import { avg, pctChange, round2 } from "../../utils/math.js";
import { METRIC_LABELS_HE } from "../types/shared.js";
import type { AgentFinancialMonth } from "../financialMonth.js";
import { completeRatio, coversRequestedMonth, revenueClosedDates, trustedCompletedRevenueDays } from "../financialMonth.js";
import { israelBusinessDate } from "../../finance/businessDate.js";
import { formatShekel } from "../../presenters/money.js";
import { formatPercent } from "../../presenters/percent.js";

export function analyzeDirectMetric(
  plan: MetricsPlan,
  fetched: FetchedData,
  baseline: BaselineResult,
  context: AgentContext
): AnalysisResult {
  const daily = (fetched.metrics["daily"] as Array<{ date: string; revenue: number; laborCost?: number; laborPct?: number; foodCost?: number; foodCostPct?: number }>) ?? [];
  const products = (fetched.metrics["products"] as Array<{ productName: string; quantitySold: number; revenue: number }>) ?? [];
  const month = fetched.metrics["financialMonth"] as AgentFinancialMonth | undefined;

  const facts: string[] = [];
  let answer = "";
  let meaning: string | undefined;

  // Product query
  if (plan.metrics.includes("product_quantity") || plan.metrics.includes("product_revenue")) {
    const sorted = [...products].sort((a, b) => b.quantitySold - a.quantitySold);
    if (sorted.length > 0) {
      const top = sorted[0];
      answer = `המוצר הכי נמכר הוא ${top.productName} עם ${top.quantitySold} יחידות`;
      facts.push(`${top.productName}: ${top.quantitySold} יח׳, ${formatShekel(String(top.revenue))}`);
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
    const asOfMs = Date.parse(context.nowIso);
    const closed = revenueClosedDates(fetched.metrics);
    const trusted = Number.isFinite(asOfMs) && fetched.fetchStatus?.daily === "ok" && closed !== null
      ? trustedCompletedRevenueDays(daily, plan.timeRange, israelBusinessDate(asOfMs), closed)
      : null;
    if (!trusted) return { answer: "נתוני הכנסה מלאים לתקופה המבוקשת אינם זמינים", supportingFacts: [], usedSources: fetched.sources };
    const revenues = trusted.days.map((d) => d.revenue);
    const total = revenues.reduce((a, b) => a + b, 0);
    const average = avg(revenues);

    // Detect whether user asked specifically for average or total
    const q = context.userQuestion ?? "";
    const askedForAverage = /ממוצע|average/i.test(q);
    const askedForTotal = /סה״כ|סה"כ|סה׳׳כ|סכום|בסך הכל|total|sum/i.test(q);

    if (askedForAverage) {
      answer = `ממוצע יומי: ${formatShekel(String(average))}`;
      facts.push(`סה״כ הכנסות: ${formatShekel(String(total))}`);
    } else if (askedForTotal) {
      answer = `סה״כ הכנסות: ${formatShekel(String(total))}`;
      facts.push(`ממוצע יומי: ${formatShekel(String(average))}`);
    } else {
      // Default: lead with total, show average as supporting fact
      answer = `סה״כ הכנסות: ${formatShekel(String(total))}`;
      facts.push(`ממוצע יומי: ${formatShekel(String(average))}`);
    }
    facts.push(`${trusted.days.length} ימי פעילות מאומתים עד ${trusted.completedThrough}`);

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

  // Period financial facts come from the canonical month report. The day series cannot
  // reconstruct a period ratio, especially when credits have a gross-absent issue date.
  if (plan.metrics.includes("supplier_purchases") || plan.metrics.includes("food_cost") || plan.metrics.includes("food_cost_pct") || plan.metrics.includes("food_cost_mtd")) {
    if (!coversRequestedMonth(month, plan.timeRange)) {
      return { answer: "נתון עלות המזון לתקופה המבוקשת אינו זמין ממקור פיננסי מאומת", supportingFacts: [], usedSources: fetched.sources };
    }
    const purchases = month.report.actual.purchases;
    const ratio = completeRatio(month.report.actual.purchasesPct);
    if (!purchases.complete || purchases.value === null) {
      return { answer: "עלות המזון אינה זמינה או אינה שלמה לתקופה המבוקשת", supportingFacts: [`מצב יחס: ${month.report.actual.purchasesPct.state}`], usedSources: fetched.sources };
    }
    facts.push(`רכישות נטו: ${formatShekel(purchases.value)}`);
    facts.push(`קרדיטים לספקים: ${formatShekel(purchases.credits.value)}`);
    if (ratio === null) facts.push("שיעור עלות המזון אינו זמין: בסיס ההכנסות אינו מאפשר יחס מאומת");
    facts.push(`תקופה עד ${month.report.window.to}`);
    if (plan.metrics.includes("supplier_purchases")) {
      for (const [source, amount] of Object.entries(purchases.bySource).sort()) facts.push(`${source}: ${formatShekel(amount)}`);
      answer = `רכישות ספקים נטו: ${formatShekel(purchases.value)}`;
    } else if (plan.metrics.includes("food_cost_pct")) {
      answer = ratio === null ? `עלות מזון נטו לתקופה: ${formatShekel(purchases.value)}; שיעור עלות המזון אינו זמין` :
        `שיעור עלות מזון לתקופה: ${formatPercent(month.report.actual.purchasesPct)}`;
    } else {
      answer = `עלות מזון נטו לתקופה: ${formatShekel(purchases.value)}${ratio === null ? "; שיעור עלות המזון אינו זמין" : ` (${formatPercent(month.report.actual.purchasesPct)})`}`;
    }
    return { answer, supportingFacts: facts, usedSources: fetched.sources };
  }

  // Labor query
  if (plan.metrics.includes("labor_cost") || plan.metrics.includes("labor_cost_mtd") || plan.metrics.includes("labor_pct")) {
    if (!coversRequestedMonth(month, plan.timeRange) || month!.report.actual.labor.employerCost.state !== "complete") {
      return { answer: "עלות כוח האדם לתקופה המבוקשת אינה זמינה ממקור פיננסי מאומת", supportingFacts: [], usedSources: fetched.sources };
    }
    const ratio = completeRatio(month.report.actual.labor.employerCostPct);
    if (ratio === null) facts.push("שיעור כוח האדם אינו זמין: בסיס ההכנסות אינו מאפשר יחס מאומת");
    answer = (plan.metrics.includes("labor_cost") || plan.metrics.includes("labor_cost_mtd")) && !plan.metrics.includes("labor_pct")
      ? `עלות מעסיק מלאה לתקופה: ${formatShekel(month.report.actual.labor.employerCost.value)}`
      : ratio === null ? `עלות מעסיק מלאה לתקופה: ${formatShekel(month.report.actual.labor.employerCost.value)}; שיעור כוח האדם אינו זמין` :
        `שיעור עלות כוח אדם לתקופה: ${formatPercent(month.report.actual.labor.employerCostPct)}`;
    facts.push(`עלות מעסיק מלאה: ${formatShekel(month.report.actual.labor.employerCost.value)}`);
    facts.push(`תקופה עד ${month.report.window.to}`);
    return { answer, supportingFacts: facts, meaning, usedSources: fetched.sources };
  }

  answer = "הנתונים נשלפו אבל לא הצלחתי לנתח את המדד המבוקש";
  return { answer, supportingFacts: facts, usedSources: fetched.sources };
}
