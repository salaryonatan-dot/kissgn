// Intelligence / alert model contracts — owner decision BD-4 (R1.4). TYPES ONLY in
// Slice A: the engines are Slices D/E. No numeric threshold is defined here.
import type { AmountString } from "../finance/decimal.js";
import type { BusinessDate } from "../finance/types.js";

/** A historical baseline, B expected exceptions, C shock/scenario, D root cause, E recoverability. */
export type IntelligenceLayer = "historical_baseline" | "expected_exception" | "scenario" | "root_cause" | "recoverability";

export interface ExpectedExceptionWindow {
  readonly from: BusinessDate;
  readonly to: BusinessDate;
  readonly reason: string; // e.g. holiday / known seasonal period
  readonly expectedEffect: "revenue_down" | "revenue_up" | "cost_ratio_up" | "cost_ratio_down" | "unspecified";
}

/** Unexpected shocks are scenarios with explicit assumptions — never certain predictions. */
export interface ScenarioAssumption {
  readonly scenarioId: string;
  readonly label: string;
  readonly revenueChangePct: AmountString; // sensitivity input, not a forecast
  readonly costRatioChangePts: AmountString;
}

export type RootCauseDriverKind = "supplier_variance" | "product" | "implausible_quantity" | "price_change" | "mix_effect";

export interface RootCauseDriver {
  readonly kind: RootCauseDriverKind;
  readonly sourceKey: string | null; // e.g. "supplier:<id>" from report.actual.purchases.bySource
  readonly contribution: AmountString | null;
  readonly evidence: string;
}

export type RecoverabilityState = "ON_TRACK" | "AT_RISK" | "RECOVERY_REQUIRED" | "UNRECOVERABLE_THIS_MONTH";

/**
 * Formal recoverability contract (engine in Slice E):
 * requiredRemainingRatio = (target × (actualRevenue + expectedRemainingRevenue) − actualCost) / expectedRemainingRevenue.
 * The state compares requiredRemainingRatio with the business's own historically achievable
 * ratio range (layer A) — no calendar rule such as "last Saturday" is hardcoded.
 */
export interface RecoverabilityInput {
  readonly targetRatioPct: AmountString;
  readonly actualRevenue: AmountString;
  readonly actualCost: AmountString;
  readonly expectedRemainingRevenue: AmountString; // from the projection layer, never from Actual
  readonly historicalMinAchievableRatioPct: AmountString | null;
}

export interface RecoverabilityResult {
  readonly state: RecoverabilityState;
  readonly requiredRemainingRatioPct: AmountString | null;
  readonly basis: { readonly projectionFormula: string; readonly policyVersion: string };
}
