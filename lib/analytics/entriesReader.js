// Marjin — SERVER-SIDE ENTRIES READER (P0-DATA-01, server reader convergence).
//
// The ONE server-side seam for reading a business's daily-entries node in either
// physical storage form. It mirrors the browser's `MarjinStorageV2.readEntriesNode`
// decision table exactly (pinned by test/analytics/entries-reader-client-parity.test.mjs)
// and is consumed by every production-reachable server reader of entries data.
//
// HARD BOUNDARY — this module:
//   • is PURE: no Firebase import, no I/O, no cache, no logging, no writes;
//   • takes the raw snapshot value (`snapshot.val()`) and returns typed results;
//   • once `schemaVersion === 2`, NEVER reads, merges or falls back to the frozen `_v`;
//   • preserves immutable ids and duplicate business dates as stored;
//   • never exposes `schemaVersion`, `generation`, `_v` or the reserved `_gen` as rows;
//   • never picks a "winner" among rows that share a business date (CTO D1): the V2
//     `(date, id)` sort exists for deterministic OUTPUT ARRAYS only and carries no
//     selection meaning — `rowForDate` reports ambiguity instead.

export const ENTRIES_STORAGE_V2 = 2;
export const ROW_GEN_KEY = "_gen";
const ENTRY_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export const isValidEntryId = (v) => typeof v === "string" && ENTRY_ID_RE.test(v);
export const isGenerationEpoch = (v) => typeof v === "number" && Number.isInteger(v) && v >= 1;
const isPlainRow = (r) => !!r && typeof r === "object" && !Array.isArray(r);

/** Typed, fail-closed storage failure. `status` ∈ malformed_storage | malformed_v2. */
export class EntriesStorageError extends Error {
  constructor({ status, mode, reason, key, tenantId, bizId, site } = {}) {
    super(`entries storage ${status || "malformed_storage"}: ${reason || "unknown"}${key ? " (" + key + ")" : ""}`);
    this.name = "EntriesStorageError";
    this.status = status || "malformed_storage";
    this.mode = mode || "malformed";
    this.reason = reason || "unknown";
    if (key !== undefined) this.key = key;
    if (tenantId !== undefined) this.tenantId = tenantId;
    if (bizId !== undefined) this.bizId = bizId;
    if (site !== undefined) this.site = site;
  }
}
/** Typed ambiguity: more than one immutable row shares one business date (CTO D1). */
export class EntriesAmbiguityError extends Error {
  constructor({ tenantId, bizId, date, count, ids, site } = {}) {
    super(`duplicate_business_date: ${date} has ${count} rows`);
    this.name = "EntriesAmbiguityError";
    this.status = "duplicate_business_date";
    this.date = date;
    this.count = count;
    this.ids = Array.isArray(ids) ? ids.slice() : [];
    if (tenantId !== undefined) this.tenantId = tenantId;
    if (bizId !== undefined) this.bizId = bizId;
    if (site !== undefined) this.site = site;
  }
}
export const isEntriesStorageError = (e) => !!e && e.name === "EntriesStorageError";
export const isEntriesAmbiguityError = (e) => !!e && e.name === "EntriesAmbiguityError";
/** Either typed failure — the boundary orchestration code isolates per business (CTO D3). */
export const isEntriesReadError = (e) => isEntriesStorageError(e) || isEntriesAmbiguityError(e);

const isV2Node = (raw) => isPlainRow(raw) && raw.schemaVersion === ENTRIES_STORAGE_V2;
const looksLikeStrippedV2 = (raw) => isPlainRow(raw) && raw.schemaVersion === undefined
  && (raw.rows !== undefined || raw.generation !== undefined);

// Mirror of the browser's parseEntriesNode (legacy envelope) — refuses V2-structured nodes.
function parseLegacy(raw) {
  if (raw === null || raw === undefined) return { absent: true };
  let json = null;
  if (isPlainRow(raw) && (raw.schemaVersion !== undefined || raw.rows !== undefined || raw.generation !== undefined))
    return { malformed: true, reason: "storage_v2_node" };
  if (isPlainRow(raw) && typeof raw._v === "string") json = raw._v;
  else if (typeof raw === "string") json = raw;
  else if (Array.isArray(raw)) return { rows: raw };
  else return { malformed: true, reason: "legacy_unparseable" };
  let parsed;
  try { parsed = JSON.parse(json); } catch (_) { return { malformed: true, reason: "legacy_unparseable" }; }
  if (!Array.isArray(parsed)) return { malformed: true, reason: "legacy_unparseable" };
  return { rows: parsed };
}

function detectStorageMode(raw) {
  if (raw === null || raw === undefined) return { mode: "absent" };
  if (isV2Node(raw)) return { mode: "v2" };
  if (looksLikeStrippedV2(raw)) return { mode: "malformed", reason: "v2_structure_without_schema_version" };
  if (isPlainRow(raw) && raw.schemaVersion !== undefined) return { mode: "malformed", reason: "unsupported_schema_version", schemaVersion: raw.schemaVersion };
  const p = parseLegacy(raw);
  if (p.malformed) return { mode: "malformed", reason: "legacy_unparseable" };
  return { mode: "legacy" };
}

// Mirror of the browser's readV2Rows: fail-closed, strips `_gen`, sorts (date, id) for
// a deterministic array. The order is NOT a duplicate-date policy.
function readV2Rows(raw) {
  const generation = raw.generation;
  if (!isGenerationEpoch(generation)) return { status: "malformed_v2", reason: "invalid_generation" };
  const node = raw.rows;
  if (node === null || node === undefined) return { ok: true, rows: [], generation };
  if (typeof node !== "object" || Array.isArray(node)) return { status: "malformed_v2", reason: "rows_not_a_map" };
  const rows = [];
  for (const k of Object.keys(node)) {
    const r = node[k];
    if (!isValidEntryId(k)) return { status: "malformed_v2", reason: "row_key_not_canonical_id", key: k };
    if (!isPlainRow(r)) return { status: "malformed_v2", reason: "row_not_an_object", key: k };
    if (r.id !== k) return { status: "malformed_v2", reason: "row_id_key_mismatch", key: k };
    if (r[ROW_GEN_KEY] !== generation) return { status: "malformed_v2", reason: "row_generation_mismatch", key: k };
    const sem = { ...r };
    delete sem[ROW_GEN_KEY];
    rows.push(sem);
  }
  rows.sort((a, b) => (String(a.date) < String(b.date) ? -1 : String(a.date) > String(b.date) ? 1 : (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)));
  return { ok: true, rows, generation };
}

/**
 * The dual-mode read seam. Never throws.
 *  absent  → { ok:true,  mode:"absent",  rows:[],   generation:null }
 *  legacy  → { ok:true,  mode:"legacy",  rows,      generation:null }   // `_v` array verbatim
 *  v2      → { ok:true,  mode:"v2",      rows,      generation:<int> }  // rows/*, `_gen` stripped
 *  failure → { ok:false, mode:"malformed"|"v2", status, reason, key? }
 */
export function readEntriesNode(raw) {
  const d = detectStorageMode(raw);
  if (d.mode === "absent") return { ok: true, mode: "absent", rows: [], generation: null };
  if (d.mode === "malformed") return { ok: false, mode: "malformed", status: "malformed_storage", reason: d.reason };
  if (d.mode === "v2") {
    const r = readV2Rows(raw);
    if (r.status) return { ok: false, mode: "v2", status: r.status, reason: r.reason, key: r.key };
    return { ok: true, mode: "v2", rows: r.rows, generation: r.generation };
  }
  const p = parseLegacy(raw);
  if (p.malformed) return { ok: false, mode: "malformed", status: "malformed_storage", reason: p.reason || "legacy_unparseable" };
  return { ok: true, mode: "legacy", rows: p.absent ? [] : p.rows, generation: null };
}

/** Authoritative logical rows, or throw EntriesStorageError. */
export function requireEntriesRows(raw, ctx) {
  const read = readEntriesNode(raw);
  if (!read.ok) throw new EntriesStorageError({ status: read.status, mode: read.mode, reason: read.reason, key: read.key, ...(ctx || {}) });
  return read.rows;
}

const rowDate = (r) => (isPlainRow(r) && typeof r.date === "string" ? r.date : null);

/**
 * One-row-per-date resolution WITHOUT a winner (CTO D1):
 *  { status:"absent",    row:null }
 *  { status:"single",    row }
 *  { status:"ambiguous", row:null, count, ids }   // >1 rows — never picks
 */
export function rowForDate(rows, date) {
  const hits = (Array.isArray(rows) ? rows : []).filter((r) => rowDate(r) === date);
  if (hits.length === 0) return { status: "absent", row: null };
  if (hits.length === 1) return { status: "single", row: hits[0] };
  const ids = hits.map((r) => (r.id === undefined || r.id === null ? null : String(r.id)));
  return { status: "ambiguous", row: null, count: hits.length, ids: ids.slice().sort() };
}
/** row | null, or throw EntriesAmbiguityError (duplicate_business_date). */
export function requireRowForDate(rows, date, ctx) {
  const r = rowForDate(rows, date);
  if (r.status === "ambiguous") throw new EntriesAmbiguityError({ date, count: r.count, ids: r.ids, ...(ctx || {}) });
  return r.row;
}
/** Inclusive YYYY-MM-DD string range; every row kept (no collapse). */
export function rowsInRange(rows, fromDate, toDate) {
  return (Array.isArray(rows) ? rows : []).filter((r) => { const d = rowDate(r); return d !== null && d >= fromDate && d <= toDate; });
}
/** [{ date, ids }] for every business date carried by more than one row (sorted). */
export function duplicateDates(rows) {
  const byDate = new Map();
  for (const r of Array.isArray(rows) ? rows : []) {
    const d = rowDate(r); if (d === null) continue;
    if (!byDate.has(d)) byDate.set(d, []);
    byDate.get(d).push(r.id === undefined || r.id === null ? null : String(r.id));
  }
  return [...byDate.entries()].filter(([, ids]) => ids.length > 1)
    .map(([date, ids]) => ({ date, ids: ids.slice().sort() }))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}
