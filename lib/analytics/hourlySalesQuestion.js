// Marjin — deterministic classifier for UNSUPPORTED hourly POS-sales questions.
//
// The Foundation Release has no per-business hourly POS source, so a question is
// "unsupported hourly sales" ONLY when it expresses BOTH:
//   (a) an hourly / time-of-day intent, AND
//   (b) a sales / transactions / customer-volume intent.
// This intersection deliberately lets ordinary labor/payroll/opening-hours
// questions through (they have hourly-time intent but no sales intent), while a
// mixed "hourly sales + labor" question still triggers because the hourly-sales
// component is unavailable. No LLM — pure regex, safe to run before data fetch.

// (a) hourly / time-of-day intent (English + Hebrew, tolerant of he- prefixes).
const HOURLY_TIME_RE =
  /\bhourly\b|\bper\s+hour\b|\bby\s+(the\s+)?hour\b|\bhour\s+by\s+hour\b|\btime\s+of\s+day\b|\b(weak|slow|weakest|slowest|busiest|quiet(?:est)?)\s+hours?\b|\b(which|what)\s+hours?\b|לפי\s+שע(ה|ות)|בכל\s+שעה|באיז[וה]\s+שעה|ה?שע(ה|ות)\s+ה?(חלש|מת|שקט|איטי|עמוס|חזק)/i;

// (b) sales / transactions / customer-volume intent (English + Hebrew).
const SALES_RE =
  /\b(sales|revenue|turnover|transactions?|tickets?|orders?|customers?|receipts?)\b|פדיון|מכיר|הכנס(ה|ות)|עסק(ה|א)|הזמנ(ה|ות)|לקוח(ות)?|חשבונ(ות)?|חשבון|קבל(ה|ות)/i;

// True only when BOTH an hourly/time-of-day intent and a sales/POS intent appear.
export function isUnsupportedHourlySalesQuestion(question) {
  if (typeof question !== "string" || question.trim() === "") return false;
  return HOURLY_TIME_RE.test(question) && SALES_RE.test(question);
}
