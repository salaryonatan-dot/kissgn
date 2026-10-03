// Shared Financial Core types (MARJIN_NORM/2 + report contracts).
import type { AmountString, Dec } from "./decimal.js";

export type BusinessDate = string; // "YYYY-MM-DD", Israel business date
export type RowId = string;
export type EmployeeKey = string;

export class FinanceContractError extends Error {
  readonly code: string;
  readonly detail: unknown;
  constructor(code: string, detail?: unknown) {
    super("finance_contract:" + code);
    this.name = "FinanceContractError";
    this.code = code;
    this.detail = detail;
  }
}

export type InvalidReason = "wrong_type" | "non_finite" | "ambiguous_comma" | "bad_grammar" | "out_of_range";

/**
 * TI-14 — presence is a property of the input, never of the number.
 * An explicitly recorded 0 is `present` with value 0; absence is never 0.
 */
export type Cell =
  | { readonly state: "absent" }
  | { readonly state: "present"; readonly value: Dec; readonly origin: "number" | "string" | "skip"; readonly thousands?: true }
  | { readonly state: "invalid"; readonly reason: InvalidReason };

export type Presence = "present" | "absent" | "invalid";

/** value !== null ⇔ presence === "present". */
export interface MetricValue {
  readonly presence: Presence;
  readonly partial: boolean;
  readonly value: Dec | null;
}

export type FlagCode =
  | "invalid_cell"
  | "invalid_map_shape"
  | "thousands_separator"
  | "negative_amount"
  | "metric_partial_invalid"
  | "supplier_and_legacy_food_both"
  | "vat_flag_unnormalized"
  | "row_without_id"
  | "rows_without_financial_values"
  | "exception_rows_disagree"
  | "future_row_quarantined"
  | "invalid_date_row"
  | "malformed_row"
  | "invalid_global_amount"
  | "missing_global_amount"
  | "employee_amount_not_global"
  | "invalid_fixed_amount"
  | "invalid_rate"
  | "missing_rate"
  | "missing_fixed_amount"
  | "cost_config_absent"
  | "superseded_versions"
  | "rent_fixed_and_rent_item_both"
  | "ratio_numerator_incomplete"
  | "legacy_hourly_payroll_not_counted"
  | "closed_day_has_recorded_values"
  // MARJIN_CREDITS/1 (P1 supplier credits)
  | "supplier_credits_unreadable"
  | "invalid_supplier_credit"
  // MARJIN_CREDITS/2 (P1 R1): a credit operation whose DEC-AUTH-1 authorization review is unresolved
  | "supplier_credit_review_pending"
  | "supplier_credit_review_flagged"
  | "negative_net_purchases"
  | "negative_supplier_net";

export interface Flag {
  readonly code: FlagCode;
  readonly rowId?: RowId;
  readonly date?: BusinessDate;
  readonly field?: string;
  readonly key?: string;
  readonly reason?: string;
}

export type PurchaseSourceKey = string; // "supplier:<id>" | "legacy_food_cost"

export interface NormalizedRow {
  readonly id: RowId;
  readonly date: BusinessDate;
  readonly metrics: {
    readonly revenue: MetricValue;
    readonly purchases: MetricValue;
    /** Hourly employees' authoritative employer cost (`payroll`) — MARJIN_LABOR/2. */
    readonly hourlyLabor: MetricValue;
    readonly otherExpense: MetricValue;
  };
  readonly revenueParts: { readonly sales: MetricValue; readonly deliveries: MetricValue; readonly otherIncome: MetricValue };
  readonly purchaseSource: "supplier" | "legacy_food_cost" | "none";
  /** Only the selected purchase representation contributes (R1.3 doc 01 §1.4). */
  readonly purchaseContributions: ReadonlyArray<{ readonly source: PurchaseSourceKey; readonly value: Dec }>;
  /** LEGACY `hourly_payroll` map: recorded for provenance only, NEVER counted as labor (MARJIN_LABOR/2). */
  readonly legacyHourlyPayroll: { readonly recorded: boolean; readonly entries: ReadonlyArray<{ readonly employee: EmployeeKey; readonly value: Dec }> };
  readonly isException: boolean;
  readonly annotations: { readonly notes: string[]; readonly weather: string[]; readonly exceptionReason: string[]; readonly exceptionNote: string[]; readonly securityEvent: boolean };
  readonly flags: readonly Flag[];
}

export interface Quarantine {
  readonly futureRows: ReadonlyArray<{ readonly rowId: RowId; readonly date: BusinessDate }>;
  readonly invalidDateRows: ReadonlyArray<{ readonly rowId: RowId }>;
}

export interface DayPresence {
  readonly day: "present" | "missing";
  readonly revenue: Presence;
  readonly purchases: Presence;
  readonly hourlyLabor: Presence;
  readonly otherExpense: Presence;
}

export interface CanonicalDay {
  readonly date: BusinessDate;
  readonly contributions: readonly RowId[];
  readonly rowCount: number;
  readonly presence: DayPresence;
  readonly revenue: MetricValue & { readonly parts: { readonly sales: MetricValue; readonly deliveries: MetricValue; readonly otherIncome: MetricValue } };
  readonly purchases: MetricValue & { readonly bySource: Readonly<Record<PurchaseSourceKey, AmountString>> };
  readonly hourlyLabor: MetricValue;
  /** LEGACY `hourly_payroll` values on this date: never counted (counted is always false). */
  readonly legacyHourlyPayroll: { readonly counted: false; readonly rows: readonly RowId[]; readonly byEmployee: Readonly<Record<EmployeeKey, AmountString>> };
  readonly otherExpense: MetricValue;
  readonly exception: { readonly isException: boolean; readonly source: "ledger" | "rows" | "none" };
  readonly annotations: { readonly notes: ReadonlyArray<{ rowId: RowId; value: string }>; readonly securityEventRows: readonly RowId[] };
  readonly flags: readonly Flag[];
  /**
   * MARJIN_CREDITS/2 (P1 R1): set by the product composition (applySupplierCreditsToDay). When set,
   * `purchases` is NET of the supplier credits issued on this date and `purchasesGross` is the
   * purchases recorded in entries. Absent on days built without the credit source (core tests).
   */
  readonly purchasesGross?: MetricValue & { readonly bySource: Readonly<Record<PurchaseSourceKey, AmountString>> };
  readonly supplierCredits?: DayCredits;
}

/** Supplier credits ISSUED on one date (EFFECTIVE credits only). value !== null ⇔ presence === "present". */
export interface DayCredits {
  /** absent: no credit issued that date (zero, complete) · present: credits counted · invalid: no valid credit and the source is invalid */
  readonly presence: Presence;
  /** present credits counted, but at least one credit fact of this date is invalid / unreadable / under an unresolved review */
  readonly partial: boolean;
  readonly value: Dec | null;
  /** "supplier:<id>" → amount issued that date */
  readonly bySupplier: Readonly<Record<PurchaseSourceKey, AmountString>>;
  readonly count: number;
  readonly reason: string | null;
}
