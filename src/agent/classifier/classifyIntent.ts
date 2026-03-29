import type { AgentContext, AgentIntent } from "../types/agent.js";

interface IntentPattern {
  intent: AgentIntent;
  patterns: RegExp[];
  priority: number; // higher = checked first
}

const INTENT_PATTERNS: IntentPattern[] = [
  {
    intent: "forecast_request",
    priority: 10,
    patterns: [
      /צפוי|תחזית|איך.*(חודש|שבוע).*י(י)?גמר/i,
      /מה צפוי|כמה נגמור|איפה נסיים/i,
      /forecast|predict/i,
    ],
  },
  {
    intent: "anomaly_detection",
    priority: 9,
    patterns: [
      /חריג[הות]|אובר|חריג|גבוה מדי|נמוך מדי|יוצא דופן/i,
      /לא רגיל|לא נורמלי|בעייתי|חשוד/i,
      /anomal|unusual|spike|drop/i,
    ],
  },
  {
    intent: "comparison_query",
    priority: 8,
    patterns: [
      /מול|לעומת|השוואה|בהשוואה ל|יחס ל|ביחס ל/i,
      /שבוע שעבר|חודש שעבר|אשתקד|שנה שעברה/i,
      /compare|versus|vs\b/i,
    ],
  },
  {
    intent: "trend_analysis",
    priority: 7,
    patterns: [
      /מגמ[הת]|נחלש|מתחזק|מה קורה ב|דפוס|תבנית/i,
      /עולה|יורד|משתנה|טרנד|שינוי לאורך/i,
      /trend|pattern|over time/i,
    ],
  },
  {
    intent: "recommendation_request",
    priority: 6,
    patterns: [
      /מה כדאי|מה לעשות|המלצ[הת]|מה מציע|איך לשפר/i,
      /מה הייתי|מה אתה ממליץ|עצה/i,
      /recommend|suggest|advice/i,
    ],
  },
  {
    intent: "strategic_question",
    priority: 5,
    patterns: [
      /מה היית עושה|איפה הבעיה|איפה הכסף|למה.*(נחלש|ירד|עלה)/i,
      /מה הסיבה|מה גורם|הסבר.*ירידה|הסבר.*עליה/i,
      /why.*drop|why.*increase|root cause/i,
    ],
  },
  {
    intent: "direct_aggregation_query",
    priority: 4.5,
    patterns: [
      /ממוצע|ממוצע יומי|ממוצע שבועי|ממוצע חודשי/i,
      /סה״כ|סה"כ|סה׳׳כ|סכום|סיכום|בסך הכל/i,
      /כמה בסך הכל|מה הסכום|מה הסה״כ|מה הסה"כ/i,
      /total|average|sum|aggregate/i,
    ],
  },
  {
    intent: "direct_metric_query",
    priority: 4,
    patterns: [
      /הכי נמכר|כמה היה|מה ה(הכנסות|פדיון|רווח)/i,
      /כמה עלה|כמה עובדים|מה עלות|כמה הוצאנו/i,
      /כמה הכנסנו|מה המחזור|כמה מכרנו/i,
      /revenue|sales|cost|labor|food cost/i,
    ],
  },
];

export function classifyIntent(question: string, _context: AgentContext): AgentIntent {
  const q = question.trim();
  if (q.length < 2) return "unknown_or_insufficient";

  // Sort by priority descending
  const sorted = [...INTENT_PATTERNS].sort((a, b) => b.priority - a.priority);

  for (const { intent, patterns } of sorted) {
    for (const regex of patterns) {
      if (regex.test(q)) {
        return intent;
      }
    }
  }

  // Fallback: only classify as direct_metric_query if it looks like a BUSINESS question
  // Requires both a question pattern AND at least one business keyword
  const isQuestionLike = /\?|מה|כמה|איך|למה|איפה|מתי/.test(q);
  const hasBusinessKeyword = /הכנס|פדיון|מחזור|רווח|הוצא|עלות|מכיר|עובד|משמרת|מנה|מוצר|ספק|הזמנ|מלאי|תפריט|לקוח|שולחן|טיפ|דליבר|משלוח|קניי|ממוצע|סה״כ|סה"כ|סיכום|סכום|food.?cost|labor|revenue|sales|cost|total|average/i.test(q);
  if (isQuestionLike && hasBusinessKeyword) {
    return "direct_metric_query"; // safe fallback for business questions
  }

  return "unknown_or_insufficient";
}

export function isDataIntent(intent: AgentIntent): boolean {
  return [
    "direct_metric_query",
    "direct_aggregation_query",
    "comparison_query",
    "anomaly_detection",
    "trend_analysis",
    "forecast_request",
  ].includes(intent);
}

export function requiresAI(intent: AgentIntent): boolean {
  return [
    "strategic_question",
    "recommendation_request",
  ].includes(intent);
}
