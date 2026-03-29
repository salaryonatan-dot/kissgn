// Baseline selection rules and constants

export const MIN_SAMPLES_DAY_OF_WEEK = 3;
export const MIN_SAMPLES_HOURLY = 5;
export const MIN_SAMPLES_ROLLING = 7;
export const ROLLING_4_WEEK_DAYS = 28;
export const ROLLING_8_WEEK_DAYS = 56;

// When to use which baseline:
// - day_of_week: when question is about a specific day pattern (e.g., "מה קורה בימי שלישי?")
// - hourly: when question is about specific hours (e.g., "שעות שקטות")
// - rolling_4_weeks: default for recent performance assessment and anomaly detection
// - rolling_8_weeks: for longer-term trend analysis
// - same_day_across_weeks: comparing same day over consecutive weeks
// - branch: comparing branch against multi-branch average
// - period_over_period: explicit comparison (this week vs last week)
// - none: when there isn't enough data for any baseline

export const BASELINE_PRIORITY_BY_INTENT: Record<string, string[]> = {
  direct_metric_query: ["rolling_4_weeks"],
  comparison_query: ["period_over_period", "same_day_across_weeks"],
  anomaly_detection: ["rolling_4_weeks", "day_of_week"],
  trend_analysis: ["day_of_week", "rolling_8_weeks"],
  forecast_request: ["rolling_4_weeks", "rolling_8_weeks"],
  strategic_question: ["rolling_4_weeks", "day_of_week"],
  recommendation_request: ["rolling_4_weeks", "day_of_week"],
};

export {};
