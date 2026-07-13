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
import { applyOperation, resolveEffectiveException, safeStateView } from "../entryExceptions.js";

const nodePath = (t, b, d) => `tenants/${t}/entry_exceptions/${b}/${d}`;
const bizPath  = (t, b)    => `tenants/${t}/entry_exceptions/${b}`;
const legacyEntriesPath = (t, b) => `tenants/${t}/biz:${b}:entries`;

/** Parse the legacy entries `_v` envelope → array (read-only; never mutated here). */
function parseLegacyEntries(raw) {
  if (raw == null) return [];
  if (Array.isArray(raw)) return raw;
  let json = null;
  if (raw && typeof raw === "object" && typeof raw._v === "string") json = raw._v;
  else if (typeof raw === "string") json = raw;
  if (!json) return [];
  try { const p = JSON.parse(json); return Array.isArray(p) ? p : []; } catch { return []; }
}

/**
 * Run a set/clear command as ONE transaction on the business-date node.
 * @returns {{outcome:"applied"|"replayed"|"conflict", code?, state?, revision?}}
 */
export async function runEntryExceptionTxn(cmd) {
  const db = getAdminDb();
  const ref = db.ref(nodePath(cmd.tenantId, cmd.bizId, cmd.businessDate));
  let captured = null;
  try {
    await ref.transaction((current) => {
      const r = applyOperation(current, cmd);
      captured = r;
      if (r.outcome === "applied") return r.envelope; // commit state + operation together
      return undefined;                                // replayed / conflict → ABORT (no write)
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
  const [structuredSnap, legacySnap] = await Promise.all([
    db.ref(bizPath(tenantId, bizId)).once("value"),
    db.ref(legacyEntriesPath(tenantId, bizId)).once("value"),
  ]);
  const structured = structuredSnap.val() || {};
  const legacyByDate = {};
  for (const e of parseLegacyEntries(legacySnap.val())) {
    if (e && typeof e.date === "string") legacyByDate[e.date] = e;
  }

  const inRange = (d) => (!fromDate || d >= fromDate) && (!toDate || d <= toDate);
  const dates = new Set();
  for (const d of Object.keys(structured)) if (inRange(d)) dates.add(d);
  for (const d of Object.keys(legacyByDate)) if (inRange(d)) dates.add(d);

  const out = {};
  for (const d of dates) {
    const eff = resolveEffectiveException(structured[d] || null, legacyByDate[d] || null);
    // Emit only meaningful entries: a true exception, or a structured record (incl. cleared) so the client
    //   can distinguish "structured normal" from "unknown". Pure-normal legacy days are omitted (implied normal).
    if (eff.origin === "none") continue;
    out[d] = {
      businessDate: d,
      isException: eff.isException,
      origin: eff.origin,
      state: eff.origin === "structured" ? safeStateView(eff.state) : null,
    };
  }
  return out;
}
