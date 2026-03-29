// Anomaly detection rules — F&B operations specific

export const ANOMALY_RULES = {
  // Revenue
  revenue_z_threshold: 2.0,         // z-score threshold for revenue
  revenue_drop_pct_warning: 15,     // % drop that triggers warning
  revenue_drop_pct_alert: 25,       // % drop that triggers alert

  // Labor
  labor_z_threshold: 1.8,           // more sensitive for labor
  labor_abs_threshold_pct: 32,      // absolute % of revenue
  labor_abs_critical_pct: 38,       // critical level

  // Food cost
  food_cost_z_threshold: 2.0,
  food_cost_abs_threshold_pct: 35,
  food_cost_abs_critical_pct: 42,

  // Minimum data requirements
  min_days_for_anomaly: 7,
  min_days_for_weekly_anomaly: 14,

  // When NOT to flag anomaly:
  // - Fridays/Saturdays naturally differ from weekdays
  // - Holidays or known events should be excluded
  // - Less than 7 data points makes anomaly unreliable
} as const;

export {};
