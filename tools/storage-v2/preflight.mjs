// Storage V2 — LEGACY NODE PREFLIGHT. Read-only, pure, deterministic.
//
// HARD BOUNDARY — this module:
//   • exports PURE functions only and performs NO I/O of any kind;
//   • never assigns, repairs, reorders, deduplicates or rewrites anything;
//   • is not imported by the runtime and has no CLI entry point;
//   • grants no authorization to change any data, in any environment.
//
// Runtime purity is guaranteed by INJECTION: the caller passes the real vm-extracted
// production helpers, so the preflight cannot drift from the contract it is checking.
//
// It answers exactly one question: may this business's legacy node be converted to V2
// as it stands? Every blocker names the state that has to change first, and one of them
// explicitly defers to the separately approved offline entry-id data action — this
// preflight will not perform it.

export const PREFLIGHT_BLOCKERS = Object.freeze({
  ALREADY_V2: "already_v2",
  MALFORMED_NODE: "malformed_node",
  NOT_AN_ARRAY: "not_an_array",
  MISSING_ENTRY_ID: "missing_entry_id",
  DUPLICATE_ENTRY_ID: "duplicate_entry_id",
  UNSUPPORTED_ROW_SHAPE: "unsupported_row_shape",
  INVALID_ENTRY_DATE: "invalid_entry_date",
  // R-V2-H6 — representation boundary. Every accepted row must be storable as RTDB
  // children WITHOUT any transformation beyond the one approved canonicalization
  // (`null` / `{}` / `[]` values are absent in the store). Anything else is a blocker.
  RESERVED_FIELD_PRESENT: "reserved_field_present",       // the row already carries the reserved epoch stamp key
  UNREPRESENTABLE_FIELD_KEY: "unrepresentable_field_key", // a key RTDB cannot hold as a child name
  UNREPRESENTABLE_VALUE: "unrepresentable_value",         // a value RTDB would silently alter (e.g. null inside an array)
});

// RTDB child keys: non-empty, no `. # $ / [ ]`, no control characters.
const RTDB_KEY_OK = /^[^.#$/\[\]\x00-\x1f\x7f]+$/;
// R2-B3: a non-empty object whose keys are ALL non-negative integers is handed back by
// the RTDB SDK as an ARRAY. Inside a MAP field (supplier/employee ids) that readback is
// the same value under the runtime's canonical equality; anywhere else it is a shape
// the row cannot round-trip, so it is a blocker rather than a silent transformation.
const INTEGER_KEY = /^(0|[1-9][0-9]*)$/;
const isNumericKeyObject = (v) => !!v && typeof v === "object" && !Array.isArray(v)
  && Object.keys(v).length > 0 && Object.keys(v).every((k) => INTEGER_KEY.test(k));

// Walk a row and classify every value RTDB would not store as given. Returns
// { dropped: [paths whose value canonicalizes to absent], bad: [{path, reason}],
//   numericKeyMaps: [top-level MAP fields that RTDB will read back as arrays] }.
function representation(row, rowGenKey, mapFields) {
  const dropped = [], bad = [], numericKeyMaps = [];
  const walk = (v, path, inArray, mapField) => {
    if (v === null || v === undefined) {
      // inside a MAP field an array hole is simply an absent key (canonical map form)
      if (inArray && !mapField) bad.push({ path, reason: "null_inside_array" }); else dropped.push(path);
      return;
    }
    if (typeof v === "number" && !Number.isFinite(v)) { bad.push({ path, reason: "non_finite_number" }); return; }
    if (Array.isArray(v)) {
      if (!v.length) { dropped.push(path); return; }
      v.forEach((x, i) => walk(x, path + "[" + i + "]", true, false));
      return;
    }
    if (typeof v === "object") {
      const keys = Object.keys(v);
      if (!keys.length) { dropped.push(path); return; }
      if (!mapField && isNumericKeyObject(v)) { bad.push({ path, reason: "numeric_key_object_outside_map_field" }); return; }
      keys.forEach((k) => {
        if (!RTDB_KEY_OK.test(k)) { bad.push({ path: path + "." + k, reason: "invalid_key" }); return; }
        walk(v[k], path ? path + "." + k : k, false, false);
      });
      return;
    }
  };
  Object.keys(row).forEach((k) => {
    if (k === rowGenKey) return;                                  // reported separately as reserved
    if (!RTDB_KEY_OK.test(k)) { bad.push({ path: k, reason: "invalid_key" }); return; }
    const mapField = mapFields.indexOf(k) !== -1;
    if (mapField && (Array.isArray(row[k]) || isNumericKeyObject(row[k]))) numericKeyMaps.push(k);
    walk(row[k], k, false, mapField);
  });
  return { dropped, bad, numericKeyMaps };
}

export function createLegacyPreflight(deps) {
  const { parseEntriesNode, isValidEntryId, isPlainRow, entryDateKey, detectStorageMode, rowGenKey, mapFields } = deps || {};
  for (const k of ["parseEntriesNode", "isValidEntryId", "isPlainRow", "entryDateKey", "detectStorageMode"]) {
    if (typeof (deps || {})[k] !== "function") throw new Error("preflight requires the runtime contract helper: " + k);
  }
  if (typeof rowGenKey !== "string" || !rowGenKey) throw new Error("preflight requires the runtime contract value: rowGenKey");
  if (!Array.isArray(mapFields) || !mapFields.every((k) => typeof k === "string" && k)) throw new Error("preflight requires the runtime contract value: mapFields");

  // `raw` is the node EXACTLY as stored. Returns a deterministic report; the same input
  // always yields the same blockers in the same order.
  function preflightLegacyNode(raw) {
    const mode = detectStorageMode(raw);
    if (mode.mode === "v2") {
      return { ok: false, mode: "v2", rowCount: null, blockers: [{ code: PREFLIGHT_BLOCKERS.ALREADY_V2 }] };
    }
    if (mode.mode === "absent") {
      // A business with no entries yet converts to an empty V2 collection.
      return { ok: true, mode: "absent", rowCount: 0, rows: [], blockers: [] };
    }
    if (mode.mode === "malformed") {
      return { ok: false, mode: "malformed", rowCount: null,
               blockers: [{ code: PREFLIGHT_BLOCKERS.MALFORMED_NODE, reason: mode.reason }] };
    }
    const parsed = parseEntriesNode(raw);
    if (parsed.malformed) {
      return { ok: false, mode: "legacy", rowCount: null,
               blockers: [{ code: PREFLIGHT_BLOCKERS.MALFORMED_NODE, reason: "unparseable" }] };
    }
    const rows = parsed.absent ? [] : parsed.rows;
    if (!Array.isArray(rows)) {
      return { ok: false, mode: "legacy", rowCount: null, blockers: [{ code: PREFLIGHT_BLOCKERS.NOT_AN_ARRAY }] };
    }
    const missing = [], malformedRows = [], badDate = [], firstSeen = Object.create(null), dupIds = [];
    const reserved = [], badKeys = [], badValues = [], normalized = [], numericMaps = [], byDate = new Map();
    rows.forEach((r, i) => {
      if (!isPlainRow(r)) { malformedRows.push(i); return; }
      const id = r.id;
      if (id === undefined || id === null || id === "") { missing.push(i); return; }
      if (!isValidEntryId(id)) { malformedRows.push(i); return; }
      if (firstSeen[id] !== undefined) { if (dupIds.indexOf(id) === -1) dupIds.push(id); }
      else firstSeen[id] = i;
      if (!entryDateKey(r.date)) badDate.push(i);
      else { const dk = entryDateKey(r.date); if (!byDate.has(dk)) byDate.set(dk, []); byDate.get(dk).push(String(id)); }
      if (Object.prototype.hasOwnProperty.call(r, rowGenKey)) reserved.push(i);
      const rep = representation(r, rowGenKey, mapFields);
      rep.bad.forEach((b) => (b.reason === "invalid_key" ? badKeys : badValues).push({ index: i, path: b.path, reason: b.reason }));
      if (rep.dropped.length) normalized.push({ index: i, paths: rep.dropped });
      if (rep.numericKeyMaps.length) numericMaps.push({ index: i, fields: rep.numericKeyMaps });
    });
    const blockers = [];
    if (malformedRows.length) blockers.push({ code: PREFLIGHT_BLOCKERS.UNSUPPORTED_ROW_SHAPE, indexes: malformedRows, count: malformedRows.length });
    if (missing.length) blockers.push({
      code: PREFLIGHT_BLOCKERS.MISSING_ENTRY_ID, indexes: missing, count: missing.length,
      // Deferred, never performed here: this names the contract of the separately
      // approved offline entry-id data action. This preflight only reports.
      remedy: "approved_offline_entry_id_assignment",
    });
    if (dupIds.length) blockers.push({
      code: PREFLIGHT_BLOCKERS.DUPLICATE_ENTRY_ID, ids: dupIds.slice().sort(), count: dupIds.length,
      remedy: "operator_resolution_required",   // which of the two rows survives is a business decision
    });
    if (badDate.length) blockers.push({ code: PREFLIGHT_BLOCKERS.INVALID_ENTRY_DATE, indexes: badDate, count: badDate.length });
    if (reserved.length) blockers.push({
      code: PREFLIGHT_BLOCKERS.RESERVED_FIELD_PRESENT, key: rowGenKey, indexes: reserved, count: reserved.length,
      remedy: "operator_resolution_required",   // the row's own value would be indistinguishable from the epoch stamp
    });
    if (badKeys.length) blockers.push({ code: PREFLIGHT_BLOCKERS.UNREPRESENTABLE_FIELD_KEY, fields: badKeys, count: badKeys.length });
    if (badValues.length) blockers.push({ code: PREFLIGHT_BLOCKERS.UNREPRESENTABLE_VALUE, fields: badValues, count: badValues.length });
    const ok = blockers.length === 0;
    // `normalization` is REPORTED, never applied here: it names exactly which values the
    // approved canonicalization will drop, so the conversion's transformation is
    // reviewed up front instead of discovered after the fact.
    // R2-B3: MAP fields with integer keys are reported too — RTDB reads them back as
    // arrays; the runtime's canonical equality treats that readback as the same value.
    const normalization = { rowsAffected: normalized.length, rows: normalized,
                            numericKeyMaps: { rowsAffected: numericMaps.length, rows: numericMaps } };
    // CTO D1 — PRE-CUTOVER OPERATOR REPORT, never a blocker and never a repair: every
    // business date carried by more than one immutable row, with the stable ids. The
    // converted business will refuse one-row-per-date derivations for these dates
    // (`duplicate_business_date`) until the operator resolves them through the stable-id
    // delete path. Nothing here deletes or merges anything.
    const duplicateDates = [...byDate.entries()].filter(([, ids]) => ids.length > 1)
      .map(([date, ids]) => ({ date, ids: ids.slice().sort() })).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    return ok
      ? { ok: true, mode: "legacy", rowCount: rows.length, rows, blockers: [], normalization, duplicateDates }
      : { ok: false, mode: "legacy", rowCount: rows.length, blockers, normalization, duplicateDates };
  }

  return { preflightLegacyNode };
}
