// MARJIN_NORM/2 — row normalization and same-date grouping.
//
// TI-14: presence is derived from the input state only (Cell.state), never from a
// number's magnitude. An explicitly recorded 0 is a present fact; absence is null.
// normalizeRows() is the only place a raw cell is interpreted; groupByDate() is the only
// place two rows of one business date meet. No row is ever chosen as "first" or "latest":
// every same-date contribution is added exactly, so storage order is irrelevant.
import type { Dec } from "./decimal.js";
import { decAdd, decIsNegative, serializeDec } from "./decimal.js";
import { parseAmount } from "./cells.js";
import { datesInRange, isBusinessDate } from "./businessDate.js";
import type {
  BusinessDate, CanonicalDay, Cell, Flag, MetricValue, NormalizedRow, Presence, PurchaseSourceKey, Quarantine, RowId,
} from "./types.js";
import { FinanceContractError } from "./types.js";

export const NORMALIZATION_VERSION = "MARJIN_NORM/2";
export const LEGACY_FOOD_SOURCE: PurchaseSourceKey = "legacy_food_cost";

// ── deterministic identity for id-less legacy rows ────────────────────────────
function canonicalJson(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v === undefined ? null : v);
  if (Array.isArray(v)) return "[" + v.map(canonicalJson).join(",") + "]";
  const o = v as Record<string, unknown>;
  return "{" + Object.keys(o).sort().map((k) => JSON.stringify(k) + ":" + canonicalJson(o[k])).join(",") + "}";
}

function fnv1a64(text: string): string {
  let h = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;
  for (let i = 0; i < text.length; i += 1) {
    h ^= BigInt(text.charCodeAt(i));
    h = (h * prime) & mask;
  }
  let hex = h.toString(16);
  while (hex.length < 16) hex = "0" + hex;
  return hex;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

// ── cell folding ─────────────────────────────────────────────────────────────
interface Tagged { field: string; key?: string; cell: Cell }

const ABSENT: MetricValue = { presence: "absent", partial: false, value: null };

function cellFlags(rowId: RowId, items: readonly Tagged[]): Flag[] {
  const out: Flag[] = [];
  for (const t of items) {
    const base = t.key === undefined ? { rowId, field: t.field } : { rowId, field: t.field, key: t.key };
    if (t.cell.state === "invalid") out.push({ code: "invalid_cell", ...base, reason: t.cell.reason });
    else if (t.cell.state === "present") {
      if (t.cell.thousands) out.push({ code: "thousands_separator", ...base });
      if (decIsNegative(t.cell.value)) out.push({ code: "negative_amount", ...base });
    }
  }
  return out;
}

/** Fold component cells into one metric (R1.3 doc 01 §1.3). */
export function foldCells(cells: readonly Cell[]): MetricValue {
  let present = false;
  let invalid = false;
  let sum: Dec | null = null;
  for (const c of cells) {
    if (c.state === "present") {
      present = true;
      sum = sum === null ? c.value : decAdd(sum, c.value);
    } else if (c.state === "invalid") invalid = true;
  }
  if (present) return { presence: "present", partial: invalid, value: sum };
  if (invalid) return { presence: "invalid", partial: false, value: null };
  return ABSENT;
}

interface MapEval { entries: Tagged[]; shapeInvalid: boolean }

function evalMap(raw: unknown, field: string, allowSkip: boolean): MapEval {
  if (raw === undefined || raw === null || raw === "") return { entries: [], shapeInvalid: false };
  if (!isPlainObject(raw)) return { entries: [], shapeInvalid: true };
  const keys = Object.keys(raw).sort();
  return { entries: keys.map((k) => ({ field, key: k, cell: parseAmount(raw[k], { allowSkip }) })), shapeInvalid: false };
}

const INVALID_SHAPE: Cell = { state: "invalid", reason: "wrong_type" };

function textValues(raw: unknown): string[] {
  if (typeof raw !== "string") return [];
  const t = raw.trim();
  return t === "" ? [] : [t];
}

export interface NormalizeResult {
  readonly rows: NormalizedRow[];
  readonly quarantine: Quarantine;
  readonly flags: Flag[];
}

/**
 * Interpret stored rows (legacy `_v` array rows or Storage V2 row objects, as returned by
 * the shared entries reader). Future-dated rows (date > asOfBusinessDate) never enter the
 * normalized set; they are quarantined with their ids. A duplicate row id is a storage
 * contract violation and rejects the dataset.
 */
export function normalizeRows(rawRows: unknown, opts: { asOfBusinessDate: BusinessDate }): NormalizeResult {
  if (!Array.isArray(rawRows)) throw new FinanceContractError("rows_not_array");
  if (!isBusinessDate(opts?.asOfBusinessDate)) throw new FinanceContractError("invalid_as_of", opts?.asOfBusinessDate);
  const asOf = opts.asOfBusinessDate;
  const flags: Flag[] = [];
  const out: NormalizedRow[] = [];
  const futureRows: Array<{ rowId: RowId; date: BusinessDate }> = [];
  const invalidDateRows: Array<{ rowId: RowId }> = [];
  const seenIds = new Set<string>();
  const noIdCounts = new Map<string, number>();

  for (const raw of rawRows as unknown[]) {
    let rowId: RowId;
    if (isPlainObject(raw) && typeof raw.id === "string" && raw.id !== "") {
      rowId = raw.id;
      if (seenIds.has(rowId)) throw new FinanceContractError("duplicate_row_id", rowId);
      seenIds.add(rowId);
    } else {
      const fp = "noid:" + fnv1a64(canonicalJson(raw));
      const n = (noIdCounts.get(fp) ?? 0) + 1;
      noIdCounts.set(fp, n);
      rowId = n === 1 ? fp : fp + "#" + String(n);
      flags.push({ code: isPlainObject(raw) ? "row_without_id" : "malformed_row", rowId });
    }
    if (!isPlainObject(raw)) {
      invalidDateRows.push({ rowId });
      continue;
    }
    const date = raw.date;
    if (!isBusinessDate(date)) {
      invalidDateRows.push({ rowId });
      flags.push({ code: "invalid_date_row", rowId });
      continue;
    }
    if (date > asOf) {
      futureRows.push({ rowId, date });
      flags.push({ code: "future_row_quarantined", rowId, date });
      continue;
    }
    out.push(normalizeOne(raw, rowId, date));
  }
  const byId = (a: { rowId: RowId }, b: { rowId: RowId }) => (a.rowId < b.rowId ? -1 : a.rowId > b.rowId ? 1 : 0);
  out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { rows: out, quarantine: { futureRows: futureRows.sort(byId), invalidDateRows: invalidDateRows.sort(byId) }, flags: sortFlags(flags) };
}

function normalizeOne(raw: Record<string, unknown>, rowId: RowId, date: BusinessDate): NormalizedRow {
  const flags: Flag[] = [];
  const noSkip = { allowSkip: false };

  const sales: Tagged = { field: "sales", cell: parseAmount(raw.sales, noSkip) };
  const deliveries: Tagged = { field: "deliveries", cell: parseAmount(raw.deliveries, noSkip) };
  const otherIncome: Tagged = { field: "other_income", cell: parseAmount(raw.other_income, noSkip) };
  const payroll: Tagged = { field: "payroll", cell: parseAmount(raw.payroll, noSkip) };
  const otherExpense: Tagged = { field: "other_expense", cell: parseAmount(raw.other_expense, noSkip) };
  const food: Tagged = { field: "food_cost", cell: parseAmount(raw.food_cost, noSkip) };
  const suppliers = evalMap(raw.supplier_payments, "supplier_payments", true);
  const hourly = evalMap(raw.hourly_payroll, "hourly_payroll", false);
  if (suppliers.shapeInvalid) flags.push({ code: "invalid_map_shape", rowId, field: "supplier_payments" });
  if (hourly.shapeInvalid) flags.push({ code: "invalid_map_shape", rowId, field: "hourly_payroll" });

  flags.push(...cellFlags(rowId, [sales, deliveries, otherIncome, payroll, otherExpense, food, ...suppliers.entries, ...hourly.entries]));

  // Revenue.
  const revenue = foldCells([sales.cell, deliveries.cell, otherIncome.cell]);

  // Purchases — presence-based representation selection (R1.3 doc 01 §1.4). No magnitude test.
  const supplierCells = suppliers.entries.map((e) => e.cell);
  const supplierShape = suppliers.shapeInvalid ? [INVALID_SHAPE] : [];
  const supplierRecorded = supplierCells.some((c) => c.state === "present");
  let purchases: MetricValue;
  let purchaseSource: NormalizedRow["purchaseSource"];
  const contributions: Array<{ source: PurchaseSourceKey; value: Dec }> = [];
  if (supplierRecorded) {
    purchases = foldCells([...supplierCells, ...supplierShape]);
    purchaseSource = "supplier";
    for (const e of suppliers.entries) if (e.cell.state === "present") contributions.push({ source: "supplier:" + e.key, value: e.cell.value });
    if (food.cell.state === "present") flags.push({ code: "supplier_and_legacy_food_both", rowId, field: "food_cost" });
  } else if (food.cell.state === "present") {
    purchases = foldCells([food.cell, ...supplierCells, ...supplierShape]);
    purchaseSource = "legacy_food_cost";
    contributions.push({ source: LEGACY_FOOD_SOURCE, value: food.cell.value });
  } else {
    purchases = foldCells([food.cell, ...supplierCells, ...supplierShape]);
    purchaseSource = "none";
  }

  // Direct labor = recorded full employer cost (payroll + hourly entries). No payroll formula.
  const hourlyShape = hourly.shapeInvalid ? [INVALID_SHAPE] : [];
  const directLabor = foldCells([payroll.cell, ...hourly.entries.map((e) => e.cell), ...hourlyShape]);
  const hourlyValues = hourly.entries
    .filter((e) => e.cell.state === "present")
    .map((e) => ({ employee: e.key as string, value: (e.cell as { value: Dec }).value }));

  const other = foldCells([otherExpense.cell]);

  for (const [name, m] of [["revenue", revenue], ["purchases", purchases], ["directLabor", directLabor], ["otherExpense", other]] as const) {
    if (m.partial) flags.push({ code: "metric_partial_invalid", rowId, field: name });
  }
  if (raw.includeVat === true) flags.push({ code: "vat_flag_unnormalized", rowId, field: "includeVat" });

  return {
    id: rowId,
    date,
    metrics: { revenue, purchases, directLabor, otherExpense: other },
    revenueParts: { sales: foldCells([sales.cell]), deliveries: foldCells([deliveries.cell]), otherIncome: foldCells([otherIncome.cell]) },
    purchaseSource,
    purchaseContributions: contributions,
    hourly: hourlyValues,
    isException: raw.is_exception === true,
    annotations: {
      notes: textValues(raw.notes),
      weather: textValues(raw.weather_impact),
      exceptionReason: textValues(raw.exception_reason),
      exceptionNote: textValues(raw.exception_note),
      securityEvent: raw.security_event === true,
    },
    flags: sortFlags(flags),
  };
}

// ── grouping ─────────────────────────────────────────────────────────────────
function foldMetrics(values: readonly MetricValue[]): MetricValue {
  let present = false;
  let invalid = false;
  let partial = false;
  let sum: Dec | null = null;
  for (const m of values) {
    if (m.presence === "present" && m.value !== null) {
      present = true;
      if (m.partial) partial = true;
      sum = sum === null ? m.value : decAdd(sum, m.value);
    } else if (m.presence === "invalid") invalid = true;
  }
  if (present) return { presence: "present", partial: partial || invalid, value: sum };
  if (invalid) return { presence: "invalid", partial: false, value: null };
  return ABSENT;
}

function sumByKey(pairs: ReadonlyArray<{ key: string; value: Dec }>): Record<string, string> {
  const acc = new Map<string, Dec>();
  for (const p of pairs) {
    const prev = acc.get(p.key);
    acc.set(p.key, prev === undefined ? p.value : decAdd(prev, p.value));
  }
  return Object.fromEntries([...acc.keys()].sort().map((k) => [k, serializeDec(acc.get(k) as Dec)]));
}

export interface GroupOptions {
  readonly from: BusinessDate;
  readonly to: BusinessDate;
  /** Structured date-level exception ledger (authoritative when a date is present). */
  readonly exceptionsByDate?: Readonly<Record<BusinessDate, boolean>>;
}

/**
 * One CanonicalDay per calendar date in [from, to] — missing days are explicit objects
 * (presence.day = "missing", metrics absent, value null), never inferred from gaps.
 */
export function groupByDate(rows: readonly NormalizedRow[], opts: GroupOptions): CanonicalDay[] {
  const dates = datesInRange(opts.from, opts.to);
  const byDate = new Map<BusinessDate, NormalizedRow[]>();
  for (const r of rows) {
    if (r.date < opts.from || r.date > opts.to) continue;
    const list = byDate.get(r.date);
    if (list) list.push(r);
    else byDate.set(r.date, [r]);
  }
  const ledger = opts.exceptionsByDate || {};
  return dates.map((date) => {
    const list = (byDate.get(date) || []).slice().sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const revenue = foldMetrics(list.map((r) => r.metrics.revenue));
    const purchases = foldMetrics(list.map((r) => r.metrics.purchases));
    const directLabor = foldMetrics(list.map((r) => r.metrics.directLabor));
    const otherExpense = foldMetrics(list.map((r) => r.metrics.otherExpense));
    const presentAny = [revenue, purchases, directLabor, otherExpense].some((m) => m.presence === "present");
    const flags: Flag[] = [];
    for (const r of list) flags.push(...r.flags);
    if (list.length >= 1 && !presentAny) flags.push({ code: "rows_without_financial_values", date });

    const rowExc = list.map((r) => r.isException);
    const rowsDisagree = rowExc.length > 1 && rowExc.some((x) => x !== rowExc[0]);
    let exception: CanonicalDay["exception"];
    if (Object.prototype.hasOwnProperty.call(ledger, date)) {
      const v = ledger[date] === true;
      exception = { isException: v, source: "ledger" };
      if (rowExc.some((x) => x !== v)) flags.push({ code: "exception_rows_disagree", date });
    } else if (rowExc.some((x) => x)) {
      exception = { isException: true, source: "rows" };
      if (rowsDisagree) flags.push({ code: "exception_rows_disagree", date });
    } else exception = { isException: false, source: "none" };

    const notes: Array<{ rowId: RowId; value: string }> = [];
    for (const r of list) for (const n of [...r.annotations.notes, ...r.annotations.exceptionNote, ...r.annotations.exceptionReason, ...r.annotations.weather]) notes.push({ rowId: r.id, value: n });

    const presenceOf = (m: MetricValue): Presence => m.presence;
    return {
      date,
      contributions: list.map((r) => r.id),
      rowCount: list.length,
      presence: {
        day: presentAny ? "present" : "missing",
        revenue: presenceOf(revenue),
        purchases: presenceOf(purchases),
        directLabor: presenceOf(directLabor),
        otherExpense: presenceOf(otherExpense),
      },
      revenue: {
        ...revenue,
        parts: {
          sales: foldMetrics(list.map((r) => r.revenueParts.sales)),
          deliveries: foldMetrics(list.map((r) => r.revenueParts.deliveries)),
          otherIncome: foldMetrics(list.map((r) => r.revenueParts.otherIncome)),
        },
      },
      purchases: { ...purchases, bySource: sumByKey(list.flatMap((r) => r.purchaseContributions.map((c) => ({ key: c.source, value: c.value })))) },
      directLabor: { ...directLabor, hourlyByEmployee: sumByKey(list.flatMap((r) => r.hourly.map((h) => ({ key: h.employee, value: h.value })))) },
      otherExpense,
      exception,
      annotations: { notes, securityEventRows: list.filter((r) => r.annotations.securityEvent).map((r) => r.id) },
      flags: sortFlags(flags),
    };
  });
}

export function sortFlags(flags: readonly Flag[]): Flag[] {
  const key = (f: Flag) => [f.code, f.rowId || "", f.date || "", f.field || "", f.key || "", f.reason || ""].join("\u0000");
  return [...flags].sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
}

/** JSON-safe view of a canonical day (exact values as canonical strings). */
export function dayToJson(day: CanonicalDay): unknown {
  const mv = (m: MetricValue) => ({ presence: m.presence, partial: m.partial, value: m.value === null ? null : serializeDec(m.value) });
  return {
    ...day,
    revenue: { ...mv(day.revenue), parts: { sales: mv(day.revenue.parts.sales), deliveries: mv(day.revenue.parts.deliveries), otherIncome: mv(day.revenue.parts.otherIncome) } },
    purchases: { ...mv(day.purchases), bySource: day.purchases.bySource },
    directLabor: { ...mv(day.directLabor), hourlyByEmployee: day.directLabor.hourlyByEmployee },
    otherExpense: mv(day.otherExpense),
  };
}

/** Latest business date whose day is present (explicit zero counts); null if none. */
export function latestPresentDate(days: readonly CanonicalDay[]): BusinessDate | null {
  let latest: BusinessDate | null = null;
  for (const d of days) if (d.presence.day === "present" && (latest === null || d.date > latest)) latest = d.date;
  return latest;
}
