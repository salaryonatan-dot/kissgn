// Compatibility cost timeline (R1.2 doc 02 §2.3, owner decision BD-2): today's config and
// fixed list, applied retrospectively and labelled `current_applied_retrospectively`.
// Historic values were overwritten in place by the current product and cannot be
// reconstructed; this adapter never pretends otherwise.
// Global employees (FINAL owner contract 2026-09-29, MARJIN_LABOR/2): for `employees[]`
// entries with `type === "global"`, `monthlySalary` is the employee's monthly FULL EMPLOYER
// COST as entered in Marjin — not gross, not net, no multiplier. It is carried as an
// `authoritative_employer_cost` global entry and allocated by calendar day. The Employees
// screen still labels the input "משכורת חודשית ברוטו" (index.html f5d0a8ed:7953); the owner
// contract overrides that label, and the label correction is a consumer (Slice C1) item.
// A listed global employee without an amount is MISSING (never zero); an unparsable amount
// is INVALID. The list is a single undated current-state list (biz:{id}:config.employees):
// there is no per-month history, so it is applied retrospectively and labelled so.
import { parseAmount } from "../../finance/cells.js";
import { decIsNegative, decIsZero, serializeDec } from "../../finance/decimal.js";
import type { Flag } from "../../finance/types.js";
import type { CostTimeline, CostVersion, GlobalEmployeeEntry } from "../costTimeline.js";

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

  const globalEmployees: GlobalEmployeeEntry[] = [];
  const employees = Array.isArray(config.employees) ? config.employees : [];
  employees.forEach((e: unknown, idx: number) => {
    const emp = obj(e);
    const key = emp.id === undefined || emp.id === null ? "idx:" + String(idx) : String(emp.id);
    const cell = parseAmount(emp.monthlySalary, noSkip);
    if (emp.type !== "global") {
      // Not a global employee: its amount is never labor cost here (meaning unknown) — reported, not counted.
      if (cell.state !== "absent") flags.push({ code: "employee_amount_not_global", key });
      return;
    }
    if (cell.state === "present" && decIsNegative(cell.value)) flags.push({ code: "invalid_global_amount", key, reason: "negative_amount" });
    else if (cell.state === "present") {
      globalEmployees.push({ employeeKey: key, kind: "authoritative_employer_cost", monthlyAmount: serializeDec(cell.value), sourceSystem: "marjin_employee_config", ingestionMethod: "manual" });
    } else if (cell.state === "invalid") flags.push({ code: "invalid_global_amount", key, reason: cell.reason });
    else flags.push({ code: "missing_global_amount", key });
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
    globalEmployees: globalEmployees.sort((a, b) => (a.employeeKey < b.employeeKey ? -1 : a.employeeKey > b.employeeKey ? 1 : 0)),
    fixedItems: fixedItems.sort((a, b) => (a.itemKey < b.itemKey ? -1 : a.itemKey > b.itemKey ? 1 : 0)),
    rent,
    royalty,
  };
  return { versions: [version], timelineSource: "compat_current_config", vatBasis: "net_of_vat", flags };
}
