// Compatibility cost timeline (R1.2 doc 02 §2.3, owner decision BD-2): today's config and
// fixed list, applied retrospectively and labelled `current_applied_retrospectively`.
// Historic values were overwritten in place by the current product and cannot be
// reconstructed; this adapter never pretends otherwise.
// `employees[].monthlySalary` is the product's GROSS monthly salary ("משכורת חודשית ברוטו",
// index.html f5d0a8ed:7953). It is carried as a `gross_salary` datum and is never labor
// cost: the authoritative employer cost is the manually entered attendance figure on the
// entry rows (src/policy/laborSource.ts).
import { parseAmount } from "../../finance/cells.js";
import { decIsZero, serializeDec } from "../../finance/decimal.js";
import type { Flag } from "../../finance/types.js";
import type { CostTimeline, CostVersion } from "../costTimeline.js";

export const COMPAT_VERSION_ID = "compat:current-config";
export const COMPAT_EFFECTIVE_FROM = "0000-01-01";

function obj(v: unknown): Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

export function costTimelineFromCurrentConfig(configRaw: unknown, fixedRaw: unknown): CostTimeline {
  // No stored config at all ⇒ cost configuration is MISSING (not zero): an empty timeline,
  // so every recognised day raises `cost_config_absent` and profit is unavailable.
  const configPresent = typeof configRaw === "object" && configRaw !== null && !Array.isArray(configRaw);
  if (!configPresent) return { versions: [], timelineSource: "compat_current_config", vatBasis: "net_of_vat", flags: [] };
  const config = obj(configRaw);
  const flags: Flag[] = [];
  const noSkip = { allowSkip: false };

  const salaried: Array<{ employeeKey: string; kind: "gross_salary"; monthlyAmount: string }> = [];
  const employees = Array.isArray(config.employees) ? config.employees : [];
  employees.forEach((e: unknown, idx: number) => {
    const emp = obj(e);
    if (emp.type !== "global") return;
    const key = emp.id === undefined || emp.id === null ? "idx:" + String(idx) : String(emp.id);
    const cell = parseAmount(emp.monthlySalary, noSkip);
    if (cell.state === "present") salaried.push({ employeeKey: key, kind: "gross_salary", monthlyAmount: serializeDec(cell.value) });
    else if (cell.state === "invalid") flags.push({ code: "invalid_salary", key, reason: cell.reason });
  });

  const fixedItems: Array<{ itemKey: string; monthlyAmount: string }> = [];
  let rentItemRecorded = false;
  const fixedList = Array.isArray(fixedRaw) ? fixedRaw : [];
  fixedList.forEach((f: unknown, idx: number) => {
    const item = obj(f);
    if (item.rentPct === true || item.royaltyPct === true || item.disabled === true) return;
    const key = item.id === undefined || item.id === null ? "idx:" + String(idx) : String(item.id);
    const cell = parseAmount(item.amount, noSkip);
    if (cell.state === "present") {
      fixedItems.push({ itemKey: key, monthlyAmount: serializeDec(cell.value) });
      if (key === "rent" && !decIsZero(cell.value)) rentItemRecorded = true;
    } else if (cell.state === "invalid") flags.push({ code: "invalid_fixed_amount", key, reason: cell.reason });
    else flags.push({ code: "missing_fixed_amount", key }); // enabled item without an amount: missing, not zero
  });

  let rent: CostVersion["rent"] = { mode: "none" };
  if (config.rentType === "pct") {
    const c = parseAmount(config.rentPct, noSkip);
    if (c.state === "present") rent = { mode: "pct", ratePct: serializeDec(c.value) };
    else if (c.state === "invalid") flags.push({ code: "invalid_rate", field: "rentPct", reason: c.reason });
    else flags.push({ code: "missing_rate", field: "rentPct" });
  } else {
    const c = parseAmount(config.rentFixed, noSkip);
    if (c.state === "present") {
      rent = { mode: "fixed", monthlyAmount: serializeDec(c.value) };
      if (rentItemRecorded && !decIsZero(c.value)) flags.push({ code: "rent_fixed_and_rent_item_both", field: "rentFixed" });
    } else if (c.state === "invalid") flags.push({ code: "invalid_rate", field: "rentFixed", reason: c.reason });
  }

  let royalty: CostVersion["royalty"] = { mode: "none" };
  if (config.hasRoyalty === true) {
    const c = parseAmount(config.royaltyPct, noSkip);
    if (c.state === "present") royalty = { mode: "pct", ratePct: serializeDec(c.value) };
    else if (c.state === "invalid") flags.push({ code: "invalid_rate", field: "royaltyPct", reason: c.reason });
    else flags.push({ code: "missing_rate", field: "royaltyPct" });
  }

  const version: CostVersion = {
    versionId: COMPAT_VERSION_ID,
    effectiveFrom: COMPAT_EFFECTIVE_FROM,
    recordedAt: 0,
    basis: "current_applied_retrospectively",
    salaried: salaried.sort((a, b) => (a.employeeKey < b.employeeKey ? -1 : a.employeeKey > b.employeeKey ? 1 : 0)),
    fixedItems: fixedItems.sort((a, b) => (a.itemKey < b.itemKey ? -1 : a.itemKey > b.itemKey ? 1 : 0)),
    rent,
    royalty,
  };
  return { versions: [version], timelineSource: "compat_current_config", vatBasis: "net_of_vat", flags };
}
