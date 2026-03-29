// Example plans for testing/reference — not used at runtime
// "מה קורה בימי שלישי?" → trend_analysis, metrics: daily_revenue, hourly_revenue, dimensions: day_of_week, requiresBaseline: true
// "יש חריגה בכוח אדם?" → anomaly_detection, metrics: labor_cost, labor_pct, requiresAnomalyDetection: true
// "מה המוצר הכי נמכר השבוע?" → direct_metric_query, metrics: product_quantity, product_revenue, dimensions: product_name
// "למה החודש נחלש?" → strategic_question, metrics: daily_revenue + all, requiresMemory: true
// "איך החודש צפוי להיגמר?" → forecast_request, requiresForecast: true
export {};
