import type { FetchedData, BaselineResult } from "../../types/agent.js";
import type { DetectorResult } from "../types.js";

/**
 * The old detector compared two half-windows made from positive daily foodCost.
 * A credit issued on a date without a gross purchase is absent from that daily
 * series, so the conclusion cannot be justified from the available inputs.
 * The product source currently exposes complete NET purchases for a month, not
 * for two arbitrary matched half-windows. Keep this conclusion unavailable
 * until that exact-window source is supplied; the Daily digest records this
 * limitation rather than presenting a missing finding as a healthy condition.
 */
export function detectPurchasesWithoutRevenueSupport(_fetched: FetchedData, _baseline: BaselineResult): DetectorResult | null {
  return null;
}
