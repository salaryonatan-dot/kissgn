// Storage V2 — ATOMIC PER-BUSINESS CUTOVER, for LOCAL/emulator proof only.
//
// HARD BOUNDARY — this module:
//   • has NO CLI entry point and NO side effects on import;
//   • is not imported by the runtime;
//   • reads no credentials, no environment and no configuration;
//   • performs exactly the one transaction its caller hands it a transport for, and the
//     emulator suites are the only callers in this repository;
//   • grants no authorization to convert any Production business.
//
// The cutover is ONE compare-and-swap at the business entries node. The current `_v` is
// parsed INSIDE the transaction callback, never from a snapshot the caller read
// earlier, so a legacy writer that commits between read and commit simply re-runs the
// callback against its value. No legacy write can be lost.

export function createStorageV2Upgrader(deps) {
  const { preflightLegacyNode, isV2Node, stampRow, generationFirst } = deps || {};
  for (const k of ["preflightLegacyNode", "isV2Node", "stampRow"]) {
    if (typeof (deps || {})[k] !== "function") throw new Error("upgrader requires: " + k);
  }
  if (!(Number.isInteger(generationFirst) && generationFirst >= 1)) throw new Error("upgrader requires: generationFirst");

  // transactNode(tenantId, key, txnFn) -> { committed, snapshot }
  // R-V2-H2: the epoch is NOT a caller input. A converted collection always starts at
  // the runtime's first epoch; only clear-all can ever advance it, and only by one.
  // R-V2-H6: every row is stamped through the runtime's own `stampRow`, which writes the
  // reserved epoch key and the approved canonical form — a legacy domain field named
  // `gen` (or anything else) is preserved exactly; a row already carrying the reserved
  // key never reaches here because preflight blocks it.
  async function upgradeBusinessToV2(io, { tenantId, bizId, generation }) {
    if (!tenantId || !bizId) return { status: "blocked_no_owner" };
    if (generation !== undefined) return { status: "blocked", reason: "generation_not_callable" };
    const key = `biz:${bizId}:entries`;
    let outcome = null, runs = 0;
    try {
      const res = await io.transactNode(tenantId, key, (cur) => {
        runs++;
        if (isV2Node(cur)) { outcome = { ok: false, status: "already_v2" }; return undefined; }
        const report = preflightLegacyNode(cur);
        if (!report.ok) { outcome = { ok: false, status: "preflight_blocked", report }; return undefined; }
        const rows = {};
        report.rows.forEach((r) => { rows[r.id] = stampRow(r, generationFirst); });
        const next = { schemaVersion: 2, generation: generationFirst };
        if (report.rows.length) next.rows = rows;
        // The pre-cutover blob is retained byte-identically as a frozen audit and
        // rollback snapshot. Rules make it unwritable from here on, so it can never be
        // a second source of truth.
        if (cur && typeof cur._v === "string") next._v = cur._v;
        outcome = { ok: true, rowCount: report.rows.length, normalization: report.normalization };
        return next;
      });
      if (!outcome) return { status: "failed", error: "transaction_never_ran", runs };
      if (outcome.ok) {
        if (res && res.committed === false) return { status: "failed", error: "not_committed", runs };
        return { status: "committed", rowCount: outcome.rowCount, generation: generationFirst, normalization: outcome.normalization, runs };
      }
      return { status: outcome.status, report: outcome.report, runs };
    } catch (err) {
      return { status: "failed", error: (err && err.message) || "transaction_failed", runs };
    }
  }

  // NEGATIVE CONTROL ONLY — the read-then-write shape this cutover deliberately avoids.
  // It reads the node once, builds V2 from that stale snapshot, then writes. A legacy
  // writer that commits in between is silently lost. It exists so the emulator suite can
  // prove the atomic path is doing real work; it must never be used for anything else.
  async function unsafeReadThenWriteUpgrade_NEGATIVE_CONTROL(io, { tenantId, bizId, pause }) {
    const key = `biz:${bizId}:entries`;
    const cur = await io.readNode(tenantId, key);
    const report = preflightLegacyNode(cur);
    if (!report.ok) return { status: "preflight_blocked", report };
    if (typeof pause === "function") await pause();          // the window a concurrent writer uses
    const rows = {};
    report.rows.forEach((r) => { rows[r.id] = stampRow(r, generationFirst); });
    const next = { schemaVersion: 2, generation: generationFirst };
    if (report.rows.length) next.rows = rows;
    if (cur && typeof cur._v === "string") next._v = cur._v;
    await io.writeNode(tenantId, key, next);
    return { status: "committed", rowCount: report.rows.length, generation: generationFirst };
  }

  return { upgradeBusinessToV2, unsafeReadThenWriteUpgrade_NEGATIVE_CONTROL };
}
