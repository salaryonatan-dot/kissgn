// Maps a proactive detector insight type to an allowed agent-memory
// MemoryInsightType. Proactive types without a dedicated memory-taxonomy entry
// (weak_hour_pattern, purchases_without_revenue, forecast_risk) and any unknown
// type fall back to the generic "recurring_anomaly" — matching the historical
// default so no invalid taxonomy value is ever written. Pure and testable.
const MEMORY_TYPE_BY_PROACTIVE = {
  revenue_underperformance: "recurring_anomaly",
  labor_inefficiency: "labor_inefficiency",
  weak_day_pattern: "repeated_weak_day",
  weak_hour_pattern: "recurring_anomaly",
  purchases_without_revenue: "recurring_anomaly",
  forecast_risk: "recurring_anomaly",
};

export function mapProactiveTypeToMemoryType(insightType) {
  // hasOwnProperty guard so inherited keys ("constructor", "__proto__", ...) can
  // never resolve to a prototype value — unknown types fall back safely.
  return Object.prototype.hasOwnProperty.call(MEMORY_TYPE_BY_PROACTIVE, insightType)
    ? MEMORY_TYPE_BY_PROACTIVE[insightType]
    : "recurring_anomaly";
}
