export const PB_NET_POLICY_ID = "PB_NET/BD-1";
export const PB_NET_POLICY = Object.freeze({
    policyId: PB_NET_POLICY_ID,
    segments: Object.freeze([
        Object.freeze({ from: "0000-01-01", kind: "net_of_vat", origin: "owner_decision", versionId: "BD-1/2026-09-28" }),
    ]),
});
/** The canonical purchase-basis input every caller passes to computePeriodReport. */
export function productPurchaseBasis() {
    return { mode: "product_policy", policy: PB_NET_POLICY };
}
