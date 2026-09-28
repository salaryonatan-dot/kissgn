import { serializeDec } from "../finance/decimal.js";
import { parseAmount } from "../finance/cells.js";
export const POLICY_VERSION = "MARJIN_POLICY/0-compat";
export const COMPATIBILITY_PRODUCT_DEFAULTS = Object.freeze({
    "goal.foodCostPct": { value: "33", source: "compatibility_product_default", ownerApproved: false, origin: "index.html TARGETS (f5d0a8ed:2844-2848)" },
    "goal.laborCostPct": { value: "27", source: "compatibility_product_default", ownerApproved: false, origin: "index.html TARGETS (f5d0a8ed:2844-2848)" },
    "goal.salesGrowthPct": { value: "5", source: "compatibility_product_default", ownerApproved: false, origin: "index.html TARGETS (f5d0a8ed:2844-2848)" },
    "alert.laborPctMax": { value: "30", source: "compatibility_product_default", ownerApproved: false, origin: "src/alerts/types.ts DEFAULT_THRESHOLDS" },
    "alert.laborPctCritical": { value: "35", source: "compatibility_product_default", ownerApproved: false, origin: "src/alerts/types.ts DEFAULT_THRESHOLDS" },
    "alert.foodCostPctMax": { value: "33", source: "compatibility_product_default", ownerApproved: false, origin: "src/alerts/types.ts DEFAULT_THRESHOLDS" },
    "alert.foodCostPctCritical": { value: "38", source: "compatibility_product_default", ownerApproved: false, origin: "src/alerts/types.ts DEFAULT_THRESHOLDS" },
});
const CONFIG_GOAL_KEYS = [
    ["goal.foodCostPct", "foodCostPct"],
    ["goal.laborCostPct", "laborCostPct"],
    ["goal.salesGrowthPct", "salesGrowthPct"],
];
/** Resolve business goals from config.targets.* (the key the wizard writes), else compat defaults. */
export function resolvePolicy(configRaw) {
    const values = { ...COMPATIBILITY_PRODUCT_DEFAULTS };
    const cfg = typeof configRaw === "object" && configRaw !== null ? configRaw : {};
    const targets = typeof cfg.targets === "object" && cfg.targets !== null ? cfg.targets : {};
    for (const [key, field] of CONFIG_GOAL_KEYS) {
        const cell = parseAmount(targets[field], { allowSkip: false });
        if (cell.state === "present")
            values[key] = { value: serializeDec(cell.value), source: "business_config", ownerApproved: false, origin: "config.targets." + field };
    }
    return { policyVersion: POLICY_VERSION, values: values };
}
