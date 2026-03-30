// Marjin — Parameter-Based Alert System
// Pure threshold checks. Zero AI. User defines every number.

// ── Alert Types ───────────────────────────────────────────────────────────────

export type AlertType =
  | "labor_pct_exceeded"          // עלות כוח אדם חורגת מהסף
  | "food_cost_pct_exceeded"      // עלות מזון חורגת מהסף
  | "supplier_anomaly"            // דליפת ספק — תשלום חורג מממוצע
  | "min_revenue_breach"          // הכנסות מתחת למינימום
  | "expensive_employee"          // עובד שעתי חורג מממוצע
  | "weak_day_detected"           // יום חלש קבוע
  | "purchase_trend_rising";      // מגמת רכישות עולה ללא תמיכת הכנסות

export type AlertSeverity = "critical" | "warning" | "info";

// ── Fired Alert ───────────────────────────────────────────────────────────────

export interface FiredAlert {
  id: string;                      // unique: `${bizId}:${type}:${date}`
  tenantId: string;
  bizId: string;
  type: AlertType;
  severity: AlertSeverity;
  title: string;                   // Hebrew headline
  message: string;                 // Hebrew detail
  currentValue: number;
  threshold: number;               // the user-defined parameter
  deviationPct: number;
  date: string;                    // ISO date
  firedAt: string;                 // ISO timestamp
  context?: Record<string, unknown>; // extra data (supplier name, employee id, etc.)
  dismissed: boolean;
  notifiedWhatsApp: boolean;
}

// ── Threshold Configuration (User-Defined Parameters) ─────────────────────────

export interface AlertThresholds {
  // 1. Labor cost as % of revenue
  laborPctMax: number;             // default: 30 (percent)
  laborPctCritical: number;        // default: 35 (percent)

  // 2. Food cost as % of revenue
  foodCostPctMax: number;          // default: 33 (percent)
  foodCostPctCritical: number;     // default: 38 (percent)

  // 3. Supplier anomaly — deviation from supplier avg
  supplierDeviationPct: number;    // default: 30 (percent above avg)

  // 4. Minimum daily revenue
  minDailyRevenue: number;         // default: 0 (disabled). Set to e.g. 5000

  // 5. Expensive employee — hourly pay deviation from avg
  employeeDeviationPct: number;    // default: 40 (percent above avg)

  // 6. Weak day — % below day-of-week average
  weakDayDeviationPct: number;     // default: 25 (percent below avg)

  // 7. Purchase trend — purchases rising without revenue
  purchaseRisePct: number;         // default: 15 (percent week-over-week)
  purchaseRevenueGapPct: number;   // default: 5 (max revenue growth to trigger)

  // Notification settings
  whatsappEnabled: boolean;        // send alerts via WhatsApp
  dashboardEnabled: boolean;       // show alerts in app dashboard
}

// ── Default Thresholds ────────────────────────────────────────────────────────

export const DEFAULT_THRESHOLDS: AlertThresholds = {
  laborPctMax: 30,
  laborPctCritical: 35,
  foodCostPctMax: 33,
  foodCostPctCritical: 38,
  supplierDeviationPct: 30,
  minDailyRevenue: 0,
  employeeDeviationPct: 40,
  weakDayDeviationPct: 25,
  purchaseRisePct: 15,
  purchaseRevenueGapPct: 5,
  whatsappEnabled: true,
  dashboardEnabled: true,
};

// ── Firebase Paths ────────────────────────────────────────────────────────────
// Thresholds: tenants/{tenantId}/alert_config/{bizId}
// Fired alerts: tenants/{tenantId}/alerts/{bizId}/{alertId}
