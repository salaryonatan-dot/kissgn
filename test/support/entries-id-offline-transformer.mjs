// TEST-ONLY offline transformer for the FUTURE, separately-approved entry-ID data
// action. It exists solely so the approved transformation semantics can be verified
// before that work is authorized.
//
// HARD BOUNDARY — this module:
//   • exports PURE functions only;
//   • performs NO file, network, Firebase or RTDB I/O;
//   • reads NO credentials and NO environment;
//   • has NO CLI entry point and NO side effects on import;
//   • is NOT imported by any runtime module and NOT referenced by any package script;
//   • is NOT an approved Production tool and grants no authorization to change data.
//
// The runtime (index.html) contains no transformer and no executor: it only VALIDATES
// and ENFORCES the post-contract state. `test/dashboard/entries-id-boundary.test.mjs`
// proves that separation, and the unchanged VAT S0 guard proves no such code entered
// the runtime.
//
// Runtime purity is guaranteed by INJECTION: the caller passes the real vm-extracted
// runtime helpers, so this module can never drift from the production contract.

export function createOfflineEntryIdTransformer(deps) {
  const { contentFingerprint, isValidEntryId, isPlainRow } = deps || {};
  if (typeof contentFingerprint !== "function" || typeof isValidEntryId !== "function" || typeof isPlainRow !== "function") {
    throw new Error("offline transformer requires the runtime contract helpers");
  }

  // Plan the transformation from an EXACT full-node snapshot plus ids generated
  // OUTSIDE any transaction callback, so a retry reuses identical ids.
  function planEntryIdAssignment(snapshotRows, pregeneratedIds) {
    if (!Array.isArray(snapshotRows)) return { status: "malformed_remote" };
    if (!Array.isArray(pregeneratedIds)) return { status: "invalid_ids" };
    const seen = Object.create(null);
    const needIndexes = [];
    for (let i = 0; i < snapshotRows.length; i++) {
      const r = snapshotRows[i];
      if (!isPlainRow(r)) return { status: "malformed_remote", index: i };
      if (r.id === undefined || r.id === null || r.id === "") { needIndexes.push(i); continue; }
      if (!isValidEntryId(r.id)) return { status: "malformed_remote", index: i, reason: "invalid_id" };
      if (seen[r.id]) return { status: "duplicate_id", id: r.id };
      seen[r.id] = true;
    }
    if (pregeneratedIds.length !== needIndexes.length) {
      return { status: "id_count_mismatch", need: needIndexes.length, got: pregeneratedIds.length };
    }
    for (const id of pregeneratedIds) {
      if (!isValidEntryId(id)) return { status: "invalid_ids" };
      if (seen[id]) return { status: "duplicate_id", id };
      seen[id] = true;
    }
    return {
      ok: true,
      expectedFingerprint: contentFingerprint(snapshotRows),
      assignments: needIndexes.map((idx, n) => ({ index: idx, id: pregeneratedIds[n] })),
      alreadyIdentified: needIndexes.length === 0,
      rowCount: snapshotRows.length,
    };
  }

  // The pure body a future approved action would run inside one transaction.
  // Deterministic: repeated execution on the same input yields identical output.
  function applyEntryIdAssignment(currentRows, plan) {
    if (!plan || !plan.ok) return { ok: false, status: "invalid_plan" };
    if (currentRows !== null && !Array.isArray(currentRows)) return { ok: false, status: "malformed_remote" };
    const rows = currentRows === null ? [] : currentRows;
    if (contentFingerprint(rows) !== plan.expectedFingerprint) {
      return { ok: false, status: "precondition_failed", actual: contentFingerprint(rows) };
    }
    if (plan.alreadyIdentified) return { ok: true, noop: true, status: "already_identified" };
    const out = rows.slice();                       // array ORDER preserved exactly
    for (const a of plan.assignments) {
      const r = out[a.index];
      if (!isPlainRow(r)) return { ok: false, status: "malformed_remote", index: a.index };
      if (r.id !== undefined && r.id !== null && r.id !== "") {
        return { ok: false, status: "precondition_failed", reason: "row_already_identified", index: a.index };
      }
      out[a.index] = { ...r, id: a.id };            // ONLY `id` is added
    }
    return { ok: true, rows: out, assigned: plan.assignments.length };
  }

  // Rollback is only legitimate while nothing has been mutated since.
  function canRollback(currentRows, postFingerprint) {
    return contentFingerprint(currentRows == null ? [] : currentRows) === postFingerprint;
  }

  return { planEntryIdAssignment, applyEntryIdAssignment, canRollback };
}
