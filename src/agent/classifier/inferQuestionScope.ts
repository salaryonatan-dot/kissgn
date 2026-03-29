import type { AgentContext } from "../types/agent.js";

export interface QuestionScope {
  mentionedMetrics: string[];
  mentionedTimeframe: "today" | "yesterday" | "this_week" | "last_week" | "this_month" | "last_month" | "custom" | "unspecified";
  mentionedDayOfWeek?: number; // 0-6
  mentionedProduct?: string;
  mentionedSupplier?: string;
  mentionedBranch?: string;
}

const DAY_PATTERNS: [RegExp, number][] = [
  [/ראשון/i, 0],
  [/שני/i, 1],
  [/שלישי/i, 2],
  [/רביעי/i, 3],
  [/חמישי/i, 4],
  [/שישי/i, 5],
  [/שבת/i, 6],
];

const TIME_PATTERNS: [RegExp, QuestionScope["mentionedTimeframe"]][] = [
  [/היום/i, "today"],
  [/אתמול/i, "yesterday"],
  [/השבוע/i, "this_week"],
  [/שבוע שעבר/i, "last_week"],
  [/החודש/i, "this_month"],
  [/חודש שעבר/i, "last_month"],
];

const METRIC_PATTERNS: [RegExp, string][] = [
  [/הכנסות|פדיון|מחזור|revenue/i, "daily_revenue"],
  [/כוח אדם|עובדים|labor/i, "labor_cost"],
  [/עלות מזון|food cost/i, "food_cost"],
  [/מוצר|מוצרים|product/i, "product_quantity"],
  [/ספק|ספקים|רכישות|purchase/i, "supplier_purchases"],
];

export function inferQuestionScope(question: string, _context: AgentContext): QuestionScope {
  const q = question.trim();

  const mentionedMetrics: string[] = [];
  for (const [pattern, metric] of METRIC_PATTERNS) {
    if (pattern.test(q)) mentionedMetrics.push(metric);
  }

  let mentionedTimeframe: QuestionScope["mentionedTimeframe"] = "unspecified";
  for (const [pattern, tf] of TIME_PATTERNS) {
    if (pattern.test(q)) {
      mentionedTimeframe = tf;
      break;
    }
  }

  let mentionedDayOfWeek: number | undefined;
  for (const [pattern, dow] of DAY_PATTERNS) {
    if (pattern.test(q)) {
      mentionedDayOfWeek = dow;
      break;
    }
  }

  return {
    mentionedMetrics,
    mentionedTimeframe,
    mentionedDayOfWeek,
  };
}
