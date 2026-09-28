// MARJIN_PB/1 — purchase-basis contract, amended by owner decision BD-1 (R1.4):
// Marjin financial data is NET OF VAT, historically and prospectively. The core accepts
// only the `net_of_vat` basis; any other kind is a typed contract error, so a gross/net
// selector cannot be introduced silently. The basis is metadata attached to purchase
// amounts — it never changes which cells are read or how they are added (TI-15) and it
// never converts VAT (TI-8).
import type { BusinessDate } from "./types.js";
import { FinanceContractError } from "./types.js";
import { addDays, isBusinessDate } from "./businessDate.js";

export const PURCHASE_BASIS_CONTRACT_VERSION = "MARJIN_PB/1";

export type PurchaseBasisKind = "net_of_vat";

export interface PurchaseBasisSegment {
  readonly from: BusinessDate; // inclusive; the end is derived from the next segment
  readonly kind: PurchaseBasisKind;
  readonly origin: "owner_decision" | "attested_retroactive";
  readonly versionId: string;
}

export interface PurchaseBasisPolicy {
  readonly policyId: string;
  readonly segments: readonly PurchaseBasisSegment[];
}

export type PurchaseBasisInput = { readonly mode: "product_policy"; readonly policy: PurchaseBasisPolicy };

export interface PurchaseBasisResolution {
  readonly contract: typeof PURCHASE_BASIS_CONTRACT_VERSION;
  readonly policyId: string;
  readonly kind: PurchaseBasisKind | "unresolved";
  readonly comparability: "same_basis_as_revenue" | "unresolved";
  readonly compatibilityUsed: false;
  readonly segmentsApplied: ReadonlyArray<{ from: BusinessDate; to: BusinessDate | null; kind: PurchaseBasisKind; origin: PurchaseBasisSegment["origin"]; versionId: string }>;
  readonly supersededVersionIds: readonly string[];
  readonly unresolvedDates: readonly BusinessDate[];
}

/** Validates the caller's input; throws FinanceContractError for anything but the BD-1 net contract. */
export function validatePurchaseBasisInput(input: unknown): PurchaseBasisInput {
  if (input === undefined || input === null) throw new FinanceContractError("purchase_basis_required");
  const i = input as { mode?: unknown; policy?: unknown };
  if (i.mode !== "product_policy") throw new FinanceContractError("purchase_basis_mode_unsupported", i.mode);
  const p = i.policy as { policyId?: unknown; segments?: unknown } | undefined;
  if (!p || typeof p.policyId !== "string" || !Array.isArray(p.segments)) throw new FinanceContractError("purchase_basis_policy_malformed");
  for (const seg of p.segments as unknown[]) {
    const s = seg as Record<string, unknown>;
    if (!s || typeof s !== "object") throw new FinanceContractError("purchase_basis_policy_malformed");
    if (s.kind !== "net_of_vat") throw new FinanceContractError("purchase_basis_not_supported", s.kind);
    if ("scope" in s && s.scope !== "business") throw new FinanceContractError("purchase_basis_not_supported", s.scope);
    if (!isBusinessDate(s.from)) throw new FinanceContractError("purchase_basis_policy_malformed", s.from);
    if (s.origin !== "owner_decision" && s.origin !== "attested_retroactive") throw new FinanceContractError("purchase_basis_policy_malformed", s.origin);
    if (typeof s.versionId !== "string" || s.versionId === "") throw new FinanceContractError("purchase_basis_policy_malformed");
  }
  return input as PurchaseBasisInput;
}

/**
 * Resolve the basis for the dates that carry purchase contributions (window dates).
 * Equal `from` values: the greatest versionId wins; the others are reported superseded.
 */
export function resolvePurchaseBasis(dates: readonly BusinessDate[], rawInput: unknown): PurchaseBasisResolution {
  const input = validatePurchaseBasisInput(rawInput);
  const byFrom = new Map<string, PurchaseBasisSegment>();
  const superseded: string[] = [];
  for (const seg of input.policy.segments) {
    const prev = byFrom.get(seg.from);
    if (!prev) byFrom.set(seg.from, seg);
    else if (seg.versionId > prev.versionId) {
      superseded.push(prev.versionId);
      byFrom.set(seg.from, seg);
    } else superseded.push(seg.versionId);
  }
  const ordered = [...byFrom.values()].sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));
  const sortedDates = [...dates].sort();
  const applied = new Map<string, number>();
  const unresolved: BusinessDate[] = [];
  for (const d of sortedDates) {
    let idx = -1;
    for (let k = 0; k < ordered.length; k += 1) if (ordered[k].from <= d) idx = k;
    if (idx < 0) unresolved.push(d);
    else applied.set(ordered[idx].from, idx);
  }
  const segmentsApplied = [...applied.values()].sort((a, b) => a - b).map((k) => {
    const s = ordered[k];
    const next = ordered[k + 1];
    return { from: s.from, to: next ? addDays(next.from, -1) : null, kind: s.kind, origin: s.origin, versionId: s.versionId };
  });
  const ok = unresolved.length === 0;
  return {
    contract: PURCHASE_BASIS_CONTRACT_VERSION,
    policyId: input.policy.policyId,
    kind: ok ? "net_of_vat" : "unresolved",
    comparability: ok ? "same_basis_as_revenue" : "unresolved",
    compatibilityUsed: false,
    segmentsApplied,
    supersededVersionIds: superseded.sort(),
    unresolvedDates: unresolved,
  };
}
