// Shared utility types used across the brain

export const SAFE_FAIL_RESPONSE_HE = "אין לי מספיק מידע כרגע כדי לענות על זה בצורה מדויקת";

export const DAYS_HE: Record<number, string> = {
  0: "ראשון",
  1: "שני",
  2: "שלישי",
  3: "רביעי",
  4: "חמישי",
  5: "שישי",
  6: "שבת",
};

export const METRIC_LABELS_HE: Record<string, string> = {
  daily_revenue: "הכנסות יומיות",
  hourly_revenue: "הכנסות שעתיות",
  labor_cost: "עלות כוח אדם",
  labor_pct: "אחוז כוח אדם מהכנסות",
  food_cost: "עלות מזון",
  food_cost_pct: "אחוז עלות מזון",
  product_quantity: "כמות מוצר שנמכרה",
  product_revenue: "הכנסות מוצר",
  product_mix: "תמהיל מוצרים",
  supplier_purchases: "רכישות מספקים",
};

export type FirebasePath = string;

export interface TenantRef {
  tenantId: string;
  basePath: string; // tenants/{tenantId}
}

export function tenantPath(tenantId: string): string {
  return `tenants/${tenantId}`;
}

export function analyticsPath(tenantId: string, sub: string): string {
  return `tenants/${tenantId}/analytics/${sub}`;
}

export function memoryPath(tenantId: string): string {
  return `tenants/${tenantId}/agentMemory`;
}
