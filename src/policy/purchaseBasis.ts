// Product purchase-basis policy — owner decision BD-1 (2026-09-28, R1.4):
// Marjin financial data is NET OF VAT, historically and prospectively. One segment
// covers every business date; there is no per-business selector and no interim
// "basis unknown" state. This record is data, not arithmetic: nothing here converts VAT.
import type { PurchaseBasisInput, PurchaseBasisPolicy } from "../finance/purchaseBasis.js";

export const PB_NET_POLICY_ID = "PB_NET/BD-1";

export const PB_NET_POLICY: PurchaseBasisPolicy = Object.freeze({
  policyId: PB_NET_POLICY_ID,
  segments: Object.freeze([
    Object.freeze({ from: "0000-01-01", kind: "net_of_vat" as const, origin: "owner_decision" as const, versionId: "BD-1/2026-09-28" }),
  ]),
});

/** The canonical purchase-basis input every caller passes to computePeriodReport. */
export function productPurchaseBasis(): PurchaseBasisInput {
  return { mode: "product_policy", policy: PB_NET_POLICY };
}
