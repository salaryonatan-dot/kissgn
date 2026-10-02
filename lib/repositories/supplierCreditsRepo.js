// ─────────────────────────────────────────────────────────────────────────────
// supplierCreditsRepo.js — RTDB repository for supplier-credit documents (P1).
//
// Node: tenants/{t}/biz:{b}:supplier_credits (see lib/supplierCredits.js). Every mutation is ONE
// transaction on that node whose body is the PURE applyCreditOperation; record + operation
// ledger + node revision change together. No other write, no multi-path update.
// ─────────────────────────────────────────────────────────────────────────────
import { getAdminDb } from "../adminSdk.js";
import { applyCreditOperation, nodePath, safeNodeView } from "../supplierCredits.js";

/**
 * Run a create / void / replace command as ONE transaction.
 * @returns {{outcome:"applied"|"replayed"|"conflict", code?, result?, before?, after?}}
 */
export async function runSupplierCreditTxn(cmd, dbOverride) {
  const db = dbOverride || getAdminDb();
  const ref = db.ref(nodePath(cmd.tenantId, cmd.bizId));
  let captured = null;
  let before = null;
  let result;
  try {
    result = await ref.transaction((current) => {
      const r = applyCreditOperation(current, cmd);
      captured = r;
      before = current;
      if (r.outcome === "applied") return r.node;
      // A replay or a conflict is NEVER decided on an unconfirmed value: the body re-submits the
      // value it saw, so the transaction only COMMITS (as a no-op) when the server holds exactly
      // that value — otherwise RTDB re-runs the body with the server's value. This covers the cold
      // first run (local cache null) AND the SDK re-running queued concurrent transactions on a
      // still-stale cache (observed on the emulator: a SECOND run can also see null, so the CD-M2
      // "re-submit once, then abort" rule is not enough here). The decision reported below is
      // therefore always the one made on the committed (server-confirmed) value.
      return current;
    }, undefined, false);
  } catch (e) {
    console.error("[supplier-credits] transaction error:", e && e.message);
    return { outcome: "conflict", code: "txn_failed" };
  }
  if (!captured || !result || result.committed !== true) return { outcome: "conflict", code: "txn_failed" };
  if (captured.outcome === "applied") return { outcome: "applied", result: captured.result, before, after: captured.node };
  if (captured.outcome === "replayed") return { outcome: "replayed", result: captured.result };
  return { outcome: "conflict", code: captured.code };
}

/** The stored node as readers see it (no operations ledger). null when absent. */
export async function readSupplierCredits({ tenantId, bizId }, dbOverride) {
  const db = dbOverride || getAdminDb();
  const snap = await db.ref(nodePath(tenantId, bizId)).once("value");
  return safeNodeView(snap.val());
}
