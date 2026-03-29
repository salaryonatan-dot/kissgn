import type { ProductMetric } from "../../agent/types/analytics.js";

// Manual entries do not contain product-level data.
// This repo will be populated when POS integration (Beecomm/Tabit) is connected.
// For now, returns empty arrays.

export async function getProductMetrics(
  _tenantId: string,
  _startDate: string,
  _endDate: string,
  _bizId?: string,
  _branchId?: string
): Promise<ProductMetric[]> {
  // TODO: connect to POS analytics when available
  return [];
}

export async function getTopProducts(
  _tenantId: string,
  _startDate: string,
  _endDate: string,
  _bizId?: string,
  _limit = 10
): Promise<ProductMetric[]> {
  // TODO: connect to POS analytics when available
  return [];
}
