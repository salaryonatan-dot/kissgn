// EV-1 classifier R2 — PURE, fixture-tested (no I/O, no network, no credentials).
//
// Input: the decoded logical rows of ONE business (as returned by the shared entries reader)
// and the evaluation Israel business date. Output: counts and safe technical identifiers only
// (canonical row UUIDs of specific risk classes, capped). Never amounts, dates of rows, row
// payloads, notes/free text, names, malformed id values, or user/customer identifiers.
//
// Deliberately independent of the Financial Core implementation: it re-derives the R1.3
// presence rules and the MARJIN_DEC/1 grammar from the contract text so that EV-1 evidence
// can cross-check the core instead of repeating it.
//
// Counter semantics: unless a field says "exclusive", counters OVERLAP (one row can be counted
// in several classes). Exclusive groups and their precedence are documented next to them.

export const EV1_CLASSIFIER_VERSION = "EV1/2";

export class Ev1InputError extends Error {
  constructor(code, detail) {
    super("ev1_input:" + code);
    this.name = "Ev1InputError";
    this.code = code;
    this.detail = detail;
  }
}

// ── calendar ────────────────────────────────────────────────────────────────
const DATE_SHAPE = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/;
const isLeap = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
const dim = (y, m) => (m === 2 ? (isLeap(y) ? 29 : 28) : [4, 6, 9, 11].includes(m) ? 30 : 31);

/** "valid" | "bad_shape" | "impossible_date" — real proleptic-Gregorian validation, not a regex. */
export function dateState(v) {
  if (typeof v !== "string") return "bad_shape";
  const m = DATE_SHAPE.exec(v);
  if (!m) return "bad_shape";
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  if (mo < 1 || mo > 12) return "impossible_date";
  if (d < 1 || d > dim(y, mo)) return "impossible_date";
  return "valid";
}

// ── identity ────────────────────────────────────────────────────────────────
// Canonical entry id (identical pattern to lib/analytics/entriesReader.js ENTRY_ID_RE).
const ENTRY_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
/** "valid" | "missing" | "malformed" */
export function idState(v) {
  if (v === undefined || v === null || v === "") return "missing";
  if (typeof v === "string" && ENTRY_ID.test(v)) return "valid";
  return "malformed";
}

// ── cells (MARJIN_DEC/1 §4.2) ───────────────────────────────────────────────
const PLAIN = /^[+-]?(0|[1-9][0-9]*)(\.[0-9]+)?$/;
const GROUPED = /^[+-]?[1-9][0-9]{0,2}(,[0-9]{3})+(\.[0-9]+)?$/;
const MAX_INT = 15, MAX_FRAC = 6;

function digits(text) {
  const t = text.replace(/^[+-]/, "").replace(/,/g, "");
  const [ip, fp = ""] = t.split(".");
  return { ok: ip.replace(/^0+(?=.)/, "").length <= MAX_INT && fp.length <= MAX_FRAC, sign: text.startsWith("-") ? -1n : 1n, ip, fp };
}

/** Exact scaled BigInt of a canonical decimal string (for sign/offset tests only; never output). */
function exact(text) {
  const { sign, ip, fp } = digits(text);
  return { n: sign * BigInt(ip + fp), s: fp.length };
}

/**
 * { state: "absent" | "zero" | "positive" | "negative" | "skip" | "invalid", reason?, exact? }
 */
export function cellState(raw, allowSkip) {
  if (raw === undefined || raw === null) return { state: "absent" };
  let text;
  if (typeof raw === "number") {
    if (!Number.isFinite(raw)) return { state: "invalid", reason: "non_finite" };
    text = raw.toString();
    if (/e/.test(text)) return { state: "invalid", reason: "out_of_range" };
  } else if (typeof raw === "string") {
    text = raw.replace(/^[ \t\n\r\f\v]+|[ \t\n\r\f\v]+$/g, "");
    if (text === "") return { state: "absent" };
    if (text === "skip") return allowSkip ? { state: "skip" } : { state: "invalid", reason: "bad_grammar" };
    if (!PLAIN.test(text) && !GROUPED.test(text)) return { state: "invalid", reason: text.includes(",") ? "ambiguous_comma" : "bad_grammar" };
  } else return { state: "invalid", reason: "wrong_type" };
  if (!digits(text).ok) return { state: "invalid", reason: "out_of_range" };
  const e = exact(text);
  return { state: e.n === 0n ? "zero" : e.n < 0n ? "negative" : "positive", exact: e };
}
const PRESENT = new Set(["zero", "positive", "negative", "skip"]);
const isPresent = (c) => PRESENT.has(c.state);

function exactSumIsZero(cells) {
  let scale = 0;
  for (const c of cells) if (c.exact && c.exact.s > scale) scale = c.exact.s;
  let total = 0n;
  for (const c of cells) if (c.exact) total += c.exact.n * 10n ** BigInt(scale - c.exact.s);
  return total === 0n;
}

const isObj = (v) => typeof v === "object" && v !== null && !Array.isArray(v);

// Today's production purchase proxy (calcMetrics / dailyMetricsRepo): Σ Number(supplier)||0 || Number(food_cost)||0
function legacyProxySource(row) {
  const sup = isObj(row.supplier_payments) ? Object.values(row.supplier_payments).reduce((a, v) => a + (Number(v) || 0), 0) : 0;
  if (sup) return "supplier";
  return (Number(row.food_cost) || 0) ? "legacy_food_cost" : "none";
}

const TEXT_FIELDS = ["notes", "exception_note", "exception_reason", "weather_impact"];

function emptyResult() {
  return {
    classifier: EV1_CLASSIFIER_VERSION,
    rowsTotal: 0,
    malformedRows: 0, // row is not a plain object (exclusive: such rows are counted nowhere else)
    identity: { validIds: 0, missingIds: 0, malformedIds: 0, duplicateIdRows: 0, duplicateIdValues: 0, duplicateIds: [] },
    dates: { validDateRows: 0, badShapeDateRows: 0, impossibleDateRows: 0, futureRows: 0, actualWindowRows: 0, duplicateDateDates: 0 },
    // Everything below counts only rows with a valid, non-future date ("actual-window rows").
    supplier: {
      rowsWithSupplierRecorded: 0, rowsWithExplicitZeroCell: 0, rowsWithSkipCell: 0, rowsWithNegativeCell: 0, rowsWithInvalidCell: 0,
      rowsWithOffsettingNonzeroCells: 0, invalidMapShapeRows: 0,
      cells: { zero: 0, skip: 0, positive: 0, negative: 0, invalid: 0 },
    },
    legacyFood: { presentPositiveRows: 0, presentNegativeRows: 0, presentZeroRows: 0, invalidRows: 0, legacyOnlyRows: 0 },
    vd16: { supplierRecordedAndLegacyFoodRecorded: 0, ofWhichSelectionChanges: 0, supplierRecordedAndLegacyFoodInvalid: 0, rowIds: [] },
    labor: { rowsWithLaborPresent: 0, rowsWithLaborZero: 0, rowsWithLaborInvalid: 0, invalidHourlyMapShapeRows: 0 },
    presence: {
      noFinancialValueRows: 0, // no financial cell present (absent and/or invalid)
      notesOnlyRows: 0, // subset of noFinancialValueRows with ≥1 non-empty text annotation and no invalid cell
      emptyRows: 0, // subset of noFinancialValueRows: no text annotation, no invalid cell
      invalidOnlyRows: 0, // subset of noFinancialValueRows: ≥1 invalid cell
      rowsWithInvalidFinancialCell: 0, // any row with ≥1 invalid financial cell or invalid map shape (overlaps everything)
    },
    vd23: {
      rowsZeroOnlyPresent: 0, rowsNotEnteredTodayButPresentNow: 0,
      // "only" drivers are exclusive with each other by definition (the row's present financial
      // groups are exactly that group); revenueZeroRows overlaps them.
      revenueZeroRows: 0, laborOnlyRows: 0, hourlyOnlyRows: 0, otherIncomeOnlyRows: 0, otherExpenseOnlyRows: 0, purchasesOnlyRows: 0,
    },
    invalidCellsByReason: {},
    invalidCellsByField: {},
    includeVatTrueRows: 0,
  };
}

/**
 * Classify one business. Throws Ev1InputError for input that cannot be evidence (non-array
 * rows, invalid as-of date) so a collector can never record an empty successful census.
 */
export function classifyBusiness(rows, asOfBusinessDate, opts = {}) {
  if (!Array.isArray(rows)) throw new Ev1InputError("rows_not_array", typeof rows);
  if (dateState(asOfBusinessDate) !== "valid") throw new Ev1InputError("invalid_as_of");
  const maxIds = opts.maxRowIdsPerClass ?? 50;
  const out = emptyResult();
  const idCounts = new Map();
  const dateCount = new Map();
  const bump = (obj, key) => { obj[key] = (obj[key] || 0) + 1; };

  for (const row of rows) {
    out.rowsTotal += 1;
    if (!isObj(row)) { out.malformedRows += 1; continue; }
    const ids = idState(row.id);
    if (ids === "valid") out.identity.validIds += 1;
    else if (ids === "missing") out.identity.missingIds += 1;
    else out.identity.malformedIds += 1;
    if (ids !== "missing") {
      const key = typeof row.id === "string" ? "s:" + row.id : "x:" + typeof row.id + ":" + JSON.stringify(row.id);
      idCounts.set(key, (idCounts.get(key) || 0) + 1);
    }

    const ds = dateState(row.date);
    if (ds === "bad_shape") { out.dates.badShapeDateRows += 1; continue; }
    if (ds === "impossible_date") { out.dates.impossibleDateRows += 1; continue; }
    out.dates.validDateRows += 1;
    if (row.date > asOfBusinessDate) { out.dates.futureRows += 1; continue; }
    out.dates.actualWindowRows += 1;
    dateCount.set(row.date, (dateCount.get(row.date) || 0) + 1);
    if (row.includeVat === true) out.includeVatTrueRows += 1;

    let rowInvalid = false;
    const noteInvalid = (field, c) => {
      if (c.state === "invalid") { bump(out.invalidCellsByReason, c.reason); bump(out.invalidCellsByField, field); rowInvalid = true; }
    };
    const simple = (field) => { const c = cellState(row[field], false); noteInvalid(field, c); return c; };
    const rev = ["sales", "deliveries", "other_income"].map((f) => [f, simple(f)]);
    const payroll = simple("payroll");
    const otherExp = simple("other_expense");
    const food = simple("food_cost");

    const readMap = (field, allowSkip) => {
      const m = row[field];
      if (m === undefined || m === null || m === "") return { cells: [], shapeInvalid: false };
      if (!isObj(m)) { rowInvalid = true; bump(out.invalidCellsByField, field); bump(out.invalidCellsByReason, "invalid_map_shape"); return { cells: [], shapeInvalid: true }; }
      const cells = Object.values(m).map((v) => cellState(v, allowSkip));
      for (const c of cells) noteInvalid(field, c);
      return { cells, shapeInvalid: false };
    };
    const sup = readMap("supplier_payments", true);
    const hourly = readMap("hourly_payroll", false);
    if (sup.shapeInvalid) out.supplier.invalidMapShapeRows += 1;
    if (hourly.shapeInvalid) out.labor.invalidHourlyMapShapeRows += 1;

    // supplier census
    for (const c of sup.cells) if (c.state in out.supplier.cells) out.supplier.cells[c.state] += 1;
    const supRecorded = sup.cells.some(isPresent);
    if (supRecorded) out.supplier.rowsWithSupplierRecorded += 1;
    if (sup.cells.some((c) => c.state === "zero")) out.supplier.rowsWithExplicitZeroCell += 1;
    if (sup.cells.some((c) => c.state === "skip")) out.supplier.rowsWithSkipCell += 1;
    if (sup.cells.some((c) => c.state === "negative")) out.supplier.rowsWithNegativeCell += 1;
    if (sup.cells.some((c) => c.state === "invalid")) out.supplier.rowsWithInvalidCell += 1;
    const nonzero = sup.cells.filter((c) => c.state === "positive" || c.state === "negative");
    if (nonzero.length >= 2 && exactSumIsZero(nonzero)) out.supplier.rowsWithOffsettingNonzeroCells += 1;

    // legacy food_cost census
    if (food.state === "positive") out.legacyFood.presentPositiveRows += 1;
    if (food.state === "negative") out.legacyFood.presentNegativeRows += 1;
    if (food.state === "zero") out.legacyFood.presentZeroRows += 1;
    if (food.state === "invalid") out.legacyFood.invalidRows += 1;
    const foodPresent = isPresent(food);
    if (foodPresent && !supRecorded) out.legacyFood.legacyOnlyRows += 1;

    // VD-16 collision
    if (supRecorded && foodPresent) {
      out.vd16.supplierRecordedAndLegacyFoodRecorded += 1;
      if (legacyProxySource(row) === "legacy_food_cost") out.vd16.ofWhichSelectionChanges += 1;
      if (ids === "valid" && out.vd16.rowIds.length < maxIds) out.vd16.rowIds.push(row.id);
    }
    if (supRecorded && food.state === "invalid") out.vd16.supplierRecordedAndLegacyFoodInvalid += 1;

    // labor census (entered authoritative employer cost fields)
    const laborCells = [payroll, ...hourly.cells];
    if (laborCells.some(isPresent)) out.labor.rowsWithLaborPresent += 1;
    if (laborCells.some(isPresent) && laborCells.filter(isPresent).every((c) => c.state === "zero")) out.labor.rowsWithLaborZero += 1;
    if (laborCells.some((c) => c.state === "invalid") || hourly.shapeInvalid) out.labor.rowsWithLaborInvalid += 1;

    // presence / VD-23
    const groups = {
      revenue: rev.map(([, c]) => c).filter(isPresent),
      purchases: [...sup.cells.filter(isPresent), ...(supRecorded ? [] : foodPresent ? [food] : [])],
      labor: laborCells.filter(isPresent),
      otherExpense: [otherExp].filter(isPresent),
    };
    const presentGroups = Object.entries(groups).filter(([, cs]) => cs.length >= 1).map(([g]) => g);
    const allPresent = Object.values(groups).flat();
    if (rowInvalid) out.presence.rowsWithInvalidFinancialCell += 1;
    if (allPresent.length === 0) {
      out.presence.noFinancialValueRows += 1;
      const hasText = TEXT_FIELDS.some((f) => typeof row[f] === "string" && row[f].trim() !== "");
      if (rowInvalid) out.presence.invalidOnlyRows += 1;
      else if (hasText) out.presence.notesOnlyRows += 1;
      else out.presence.emptyRows += 1;
    } else {
      if (allPresent.every((c) => c.state === "zero" || c.state === "skip")) out.vd23.rowsZeroOnlyPresent += 1;
      const revPresent = groups.revenue;
      if (revPresent.length >= 1 && revPresent.every((c) => c.state === "zero")) out.vd23.revenueZeroRows += 1;
      const only = (g) => presentGroups.length === 1 && presentGroups[0] === g;
      if (only("labor")) {
        out.vd23.laborOnlyRows += 1;
        if (!isPresent(payroll)) out.vd23.hourlyOnlyRows += 1;
      }
      if (only("otherExpense")) out.vd23.otherExpenseOnlyRows += 1;
      if (only("purchases")) out.vd23.purchasesOnlyRows += 1;
      if (only("revenue") && rev.every(([f, c]) => f === "other_income" || !isPresent(c))) out.vd23.otherIncomeOnlyRows += 1;
      // today's analytics had_entry: sales>0 || deliveries>0 || proxy food>0
      const foodNum = legacyProxySource(row) === "supplier"
        ? Object.values(row.supplier_payments).reduce((a, v) => a + (Number(v) || 0), 0)
        : Number(row.food_cost) || 0;
      const hadEntryToday = (Number(row.sales) || 0) > 0 || (Number(row.deliveries) || 0) > 0 || foodNum > 0;
      if (!hadEntryToday) out.vd23.rowsNotEnteredTodayButPresentNow += 1;
    }
  }

  for (const [id, n] of idCounts) {
    if (n >= 2) {
      out.identity.duplicateIdRows += n;
      out.identity.duplicateIdValues += 1;
      const raw = id.startsWith("s:") ? id.slice(2) : null;
      if (raw !== null && idState(raw) === "valid" && out.identity.duplicateIds.length < maxIds) out.identity.duplicateIds.push(raw);
    }
  }
  out.identity.duplicateIds.sort();
  out.dates.duplicateDateDates = [...dateCount.values()].filter((n) => n >= 2).length;
  out.vd16.rowIds.sort();
  return out;
}

/**
 * Aggregate per-business results. evidenceComplete is true only when every requested
 * business was read AND classified (fail-closed, like Gate 0 D1 R1).
 */
export function summarize(perBusiness, readFailures) {
  const failures = Array.isArray(readFailures) ? readFailures : [{ scope: "unknown" }];
  const list = Array.isArray(perBusiness) ? perBusiness : [];
  const sum = (f) => list.reduce((a, b) => a + f(b.result), 0);
  const count = (f) => list.filter((b) => f(b.result)).length;
  return {
    classifier: EV1_CLASSIFIER_VERSION,
    businessesScanned: list.length,
    readFailures: failures.map((f) => ({ scope: f.scope, tenantId: f.tenantId ?? null, bizId: f.bizId ?? null, code: f.code ?? null })),
    evidenceComplete: failures.length === 0 && list.length >= 1,
    businessesWithDuplicateIds: count((r) => r.identity.duplicateIdValues >= 1),
    businessesWithMissingOrMalformedIds: count((r) => r.identity.missingIds + r.identity.malformedIds >= 1),
    businessesWithVd16Collisions: count((r) => r.vd16.supplierRecordedAndLegacyFoodRecorded >= 1),
    businessesWithSelectionChanges: count((r) => r.vd16.ofWhichSelectionChanges >= 1),
    totalVd16Rows: sum((r) => r.vd16.supplierRecordedAndLegacyFoodRecorded),
    totalSelectionChanges: sum((r) => r.vd16.ofWhichSelectionChanges),
    businessesWithZeroOnlyRows: count((r) => r.vd23.rowsZeroOnlyPresent >= 1),
    businessesWithInvalidCells: count((r) => r.presence.rowsWithInvalidFinancialCell >= 1),
    businessesWithImpossibleDates: count((r) => r.dates.impossibleDateRows + r.dates.badShapeDateRows >= 1),
    businessesWithLegacyOnlyFoodRows: count((r) => r.legacyFood.legacyOnlyRows >= 1),
  };
}
