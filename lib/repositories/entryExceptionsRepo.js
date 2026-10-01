// ─────────────────────────────────────────────────────────────────────────────
// entryExceptionsRepo.js — RTDB repository for structured entry exceptions.
//
// Authoritative node (one atomic envelope per business-date):
//   tenants/{tenantId}/entry_exceptions/{bizId}/{businessDate} = { state, operations }
//
// All state + operation-ledger mutations happen inside ONE transaction on the
// business-date node (no separate audit write, no root/tenant-level transaction,
// no unguarded read-then-multipath-update). The transaction body is the PURE
// `applyOperation` from lib/entryExceptions.js.
// ─────────────────────────────────────────────────────────────────────────────
import { getAdminDb } from "../adminSdk.js";
import { applyOperation, buildEffectiveRecord, LEGACY_AMBIGUOUS } from "../entryExceptions.js";
import { requireEntriesRows, rowForDate } from "../analytics/entriesReader.js";

const nodePath = (t, b, d) => `tenants/${t}/entry_exceptions/${b}/${d}`;
const bizPath  = (t, b)    => `tenants/${t}/entry_exceptions/${b}`;
const entriesPath = (t, b) => `tenants/${t}/biz:${b}:entries`;

/**
 * Run a set/clear command as ONE transaction on the business-date node.
 * @returns {{outcome:"applied"|"replayed"|"conflict", code?, state?, revision?}}
 */
export async function runEntryExceptionTxn(cmd, dbOverride) {
  const db = dbOverride || getAdminDb();
  const ref = db.ref(nodePath(cmd.tenantId, cmd.bizId, cmd.businessDate));
  let captured = null;
  let runs = 0;
  try {
    await ref.transaction((current) => {
      runs += 1;
      const r = applyOperation(current, cmd);
      captured = r;
      if (r.outcome === "applied") return r.envelope; // commit state + operation together
      // CD-M2: the FIRST invocation runs against the instance's LOCAL cache, which is `null`
      // (or stale) in a cold server instance. Aborting there reported a spurious
      // `revision_conflict` for every operation on an existing state (clear, re-set,
      // replace) and never consulted the server. The first run therefore re-submits the
      // value it saw unchanged: RTDB verifies it against the server and either commits
      // that identical value (the cache was right — the decision stands, nothing changes)
      // or re-runs this function with the server value. Every later run aborts as before.
      return runs === 1 ? current : undefined;         // replayed / conflict → no state change
    }, undefined, false);
  } catch (e) {
    console.error("[entry-exceptions] transaction error:", e && e.message);
    return { outcome: "conflict", code: "txn_failed" };
  }
  if (!captured) return { outcome: "conflict", code: "txn_failed" };
  if (captured.outcome === "applied") return { outcome: "applied", state: captured.state, revision: captured.revision };
  if (captured.outcome === "replayed") return { outcome: "replayed", state: captured.state, revision: captured.state ? captured.state.revision : 0 };
  return { outcome: "conflict", code: captured.code };
}

/**
 * List NORMALIZED effective exception states for a business over [fromDate,toDate].
 * Structured-first with narrow legacy fallback. Never exposes the operations ledger.
 * @returns {{ [businessDate]: { businessDate, isException, origin, state|null } }}
 */
export async function listEntryExceptions({ tenantId, bizId, fromDate, toDate }) {
  const db = getAdminDb();
  const [structuredSnap, entriesSnap] = await Promise.all([
    // Structured: RTDB key-range query on the business-date keys (NO full-node scan).
    db.ref(bizPath(tenantId, bizId)).orderByKey().startAt(fromDate).endAt(toDate).once("value"),
    // Entries (legacy-embedded fallback source): the whole node, read through the
    //   shared dual-mode reader — legacy `_v` OR Storage V2 rows, never both, never a
    //   fallback to the frozen `_v` once the node is V2. A malformed node throws a typed
    //   EntriesStorageError (→ the API's existing `list_failed` boundary).
    db.ref(entriesPath(tenantId, bizId)).once("value"),
  ]);
  const structured = structuredSnap.val() || {};
  const rows = requireEntriesRows(entriesSnap.val(), { tenantId, bizId, site: "entryExceptionsRepo.listEntryExceptions" });
  const inRange = rows.filter((e) => e && typeof e.date === "string" && e.date >= fromDate && e.date <= toDate);
  const legacyByDate = {};
  for (const d of new Set(inRange.map((e) => e.date))) {
    // CTO D1: the embedded fallback needs ONE row for a date. 0 → nothing; 1 → that row;
    // >1 → an explicit ambiguity marker — never first-wins, last-wins or an id order.
    const r = rowForDate(inRange, d);
    legacyByDate[d] = r.status === "ambiguous" ? { [LEGACY_AMBIGUOUS]: true, count: r.count, ids: r.ids } : r.row;
  }
  const dates = new Set([...Object.keys(structured), ...Object.keys(legacyByDate)]);
  const out = {};
  for (const d of dates) {
    const rec = buildEffectiveRecord(d, structured[d] || null, legacyByDate[d] || null);
    if (rec.source === "none") continue; // omit pure-normal days (client defaults absent → normal)
    out[d] = rec; // normalized effective shape; NEVER the operations ledger
  }
  return out;
}
