import { getDb } from "./admin.js";

export function tenantRef(tenantId: string) {
  return getDb().ref(`tenants/${tenantId}`);
}

export function analyticsRef(tenantId: string) {
  return getDb().ref(`tenants/${tenantId}/analytics`);
}

export function dailyMetricsRef(tenantId: string) {
  return getDb().ref(`tenants/${tenantId}/analytics/daily`);
}

export function hourlyMetricsRef(tenantId: string) {
  return getDb().ref(`tenants/${tenantId}/analytics/hourly`);
}

export function laborMetricsRef(tenantId: string) {
  return getDb().ref(`tenants/${tenantId}/analytics/labor`);
}

export function productMetricsRef(tenantId: string) {
  return getDb().ref(`tenants/${tenantId}/analytics/products`);
}

export function purchasesRef(tenantId: string) {
  return getDb().ref(`tenants/${tenantId}/analytics/purchases`);
}

export function baselinesRef(tenantId: string) {
  return getDb().ref(`tenants/${tenantId}/analytics/baselines`);
}

export function anomaliesRef(tenantId: string) {
  return getDb().ref(`tenants/${tenantId}/analytics/anomalies`);
}

export function agentMemoryRef(tenantId: string) {
  return getDb().ref(`tenants/${tenantId}/agentMemory`);
}

export function recommendationsRef(tenantId: string) {
  return getDb().ref(`tenants/${tenantId}/agentMemory/recommendations`);
}

export function entriesRef(tenantId: string) {
  return getDb().ref(`tenants/${tenantId}/entries`);
}

export function suppliersRef(tenantId: string) {
  return getDb().ref(`tenants/${tenantId}/suppliers`);
}

export function metricsRef(tenantId: string) {
  return getDb().ref(`tenants/${tenantId}/metrics`);
}

// --- Biz-scoped data (entries, suppliers, config) ---
export function bizEntriesRef(tenantId: string, bizId: string) {
  return getDb().ref(`tenants/${tenantId}/biz:${bizId}:entries`);
}

export function bizSuppliersRef(tenantId: string, bizId: string) {
  return getDb().ref(`tenants/${tenantId}/biz:${bizId}:suppliers`);
}

export function bizConfigRef(tenantId: string, bizId: string) {
  return getDb().ref(`tenants/${tenantId}/biz:${bizId}:config`);
}

// --- Proactive Insights ---
export function proactiveInsightsRef(tenantId: string, bizId: string) {
  return getDb().ref(`tenants/${tenantId}/proactive_insights/${bizId}`);
}

export function proactiveJobLogRef(tenantId: string) {
  return getDb().ref(`tenants/${tenantId}/proactive_job_log`);
}

/** Flat index of all active tenant+biz pairs for proactive scanning. */
export function proactiveBizIndexRef() {
  return getDb().ref("proactive_biz_index");
}

// --- Phase 3: Dashboard Insight Actions ---
export function insightActionsRef(tenantId: string, bizId: string) {
  return getDb().ref(`tenants/${tenantId}/insight_actions/${bizId}`);
}

// --- Parameter-Based Alerts ---
export function alertConfigRef(tenantId: string, bizId: string) {
  return getDb().ref(`tenants/${tenantId}/alert_config/${bizId}`);
}

export function alertsRef(tenantId: string, bizId: string) {
  return getDb().ref(`tenants/${tenantId}/alerts/${bizId}`);
}
