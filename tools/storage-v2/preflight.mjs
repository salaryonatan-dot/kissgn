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
});

export function createLegacyPreflight(deps) {
  const { parseEntriesNode, isValidEntryId, isPlainRow, entryDateKey, detectStorageMode } = deps || {};
  for (const k of ["parseEntriesNode", "isValidEntryId", "isPlainRow", "entryDateKey", "detectStorageMode"]) {
    if (typeof (deps || {})[k] !== "function") throw new Error("preflight requires the runtime contract helper: " + k);
  }

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
    rows.forEach((r, i) => {
      if (!isPlainRow(r)) { malformedRows.push(i); return; }
      const id = r.id;
      if (id === undefined || id === null || id === "") { missing.push(i); return; }
      if (!isValidEntryId(id)) { malformedRows.push(i); return; }
      if (firstSeen[id] !== undefined) { if (dupIds.indexOf(id) === -1) dupIds.push(id); }
      else firstSeen[id] = i;
      if (!entryDateKey(r.date)) badDate.push(i);
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
    const ok = blockers.length === 0;
    return ok
      ? { ok: true, mode: "legacy", rowCount: rows.length, rows, blockers: [] }
      : { ok: false, mode: "legacy", rowCount: rows.length, blockers };
  }

  return { preflightLegacyNode };
}
