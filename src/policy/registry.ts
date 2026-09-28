// Policy registry (MARJIN_POLICY/0-compat). Owner decision BD-4: there are NO new
// owner-approved numeric goals/thresholds. The values below are the product's existing
// compatibility defaults, recorded with their code origin and `ownerApproved: false`;
// they must never be presented as owner business policy. Business-configured goals
// (config.targets.*, written by the setup wizard) take precedence.
import type { AmountString } from "../finance/decimal.js";
import { serializeDec } from "../finance/decimal.js";
import { parseAmount } from "../finance/cells.js";

export const POLICY_VERSION = "MARJIN_POLICY/0-compat";

export type PolicyKey =
  | "goal.foodCostPct"
  | "goal.laborCostPct"
  | "goal.salesGrowthPct"
  | "alert.laborPctMax"
  | "alert.laborPctCritical"
  | "alert.foodCostPctMax"
  | "alert.foodCostPctCritical";

export interface PolicyValue {
  readonly value: AmountString;
  readonly source: "business_config" | "compatibility_product_default";
  readonly ownerApproved: boolean;
  readonly origin: string;
}

export const COMPATIBILITY_PRODUCT_DEFAULTS: Readonly<Record<PolicyKey, PolicyValue>> = Object.freeze({
  "goal.foodCostPct": { value: "33", source: "compatibility_product_default", ownerApproved: false, origin: "index.html TARGETS (f5d0a8ed:2844-2848)" },
  "goal.laborCostPct": { value: "27", source: "compatibility_product_default", ownerApproved: false, origin: "index.html TARGETS (f5d0a8ed:2844-2848)" },
  "goal.salesGrowthPct": { value: "5", source: "compatibility_product_default", ownerApproved: false, origin: "index.html TARGETS (f5d0a8ed:2844-2848)" },
  "alert.laborPctMax": { value: "30", source: "compatibility_product_default", ownerApproved: false, origin: "src/alerts/types.ts DEFAULT_THRESHOLDS" },
  "alert.laborPctCritical": { value: "35", source: "compatibility_product_default", ownerApproved: false, origin: "src/alerts/types.ts DEFAULT_THRESHOLDS" },
  "alert.foodCostPctMax": { value: "33", source: "compatibility_product_default", ownerApproved: false, origin: "src/alerts/types.ts DEFAULT_THRESHOLDS" },
  "alert.foodCostPctCritical": { value: "38", source: "compatibility_product_default", ownerApproved: false, origin: "src/alerts/types.ts DEFAULT_THRESHOLDS" },
});

export interface ResolvedPolicy {
  readonly policyVersion: string;
  readonly values: Readonly<Record<PolicyKey, PolicyValue>>;
}

const CONFIG_GOAL_KEYS: ReadonlyArray<[PolicyKey, string]> = [
  ["goal.foodCostPct", "foodCostPct"],
  ["goal.laborCostPct", "laborCostPct"],
  ["goal.salesGrowthPct", "salesGrowthPct"],
];

/** Resolve business goals from config.targets.* (the key the wizard writes), else compat defaults. */
export function resolvePolicy(configRaw: unknown): ResolvedPolicy {
  const values: Record<string, PolicyValue> = { ...COMPATIBILITY_PRODUCT_DEFAULTS };
  const cfg = typeof configRaw === "object" && configRaw !== null ? (configRaw as Record<string, unknown>) : {};
  const targets = typeof cfg.targets === "object" && cfg.targets !== null ? (cfg.targets as Record<string, unknown>) : {};
  for (const [key, field] of CONFIG_GOAL_KEYS) {
    const cell = parseAmount(targets[field], { allowSkip: false });
    if (cell.state === "present") values[key] = { value: serializeDec(cell.value), source: "business_config", ownerApproved: false, origin: "config.targets." + field };
  }
  return { policyVersion: POLICY_VERSION, values: values as Record<PolicyKey, PolicyValue> };
}
