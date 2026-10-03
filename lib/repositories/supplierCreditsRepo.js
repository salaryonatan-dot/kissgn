// ─────────────────────────────────────────────────────────────────────────────
// supplierCreditsRepo.js — RTDB repository for supplier-credit documents (P1 R1, MARJIN_CREDITS/3).
//
// Node: tenants/{t}/biz:{b}:supplier_credits (see lib/supplierCredits.js). Every mutation is ONE
// transaction on that node whose body is a PURE function of lib/supplierCredits.js; no other write and
// no multi-path update touches the node. Flag and decision audits live inside the same atomic node.
//
// Transaction decision rule (P1, independently reproduced; NOT the CD-M2 rule): a replay or a conflict
// is NEVER decided on an unconfirmed value — the body re-submits the value it saw, so the transaction
// only commits (as a no-op) when the server holds exactly that value, otherwise RTDB re-runs the body
// with the server's value; a decision is reported only when the transaction reports committed:true.
//
// P1 R1 — a thrown transaction (lost acknowledgement, disconnect, SDK error) is an UNKNOWN outcome, not a
// failure: it is resolved by an authoritative readback of the node and a FULL stored-payload comparison
// (ledger request identity + actor + the stored records / event re-digested and compared with the
// request's own intent). Record existence alone never proves success. Without proof the outcome stays
// `unknown` — the caller must say "status unknown; retry with the same operation", never "not saved".
// ─────────────────────────────────────────────────────────────────────────────
import { getAdminDb } from "../adminSdk.js";
import {
  applyCreditOperation, applyReviewTransition, nodePath, safeNodeView, storedIntentDigest, operationIntent, digest, similarityAuditOf, isStrictReadableNode,
} from "../supplierCredits.js";

/** Expected intent digest of a credit command once its logical credit is known (create: its own id). */
function expectedIntentDigest(cmd, node) {
  const logicalId = cmd.action === "create" ? cmd.creditId : (node && node.records && node.records[cmd.creditId] && node.records[cmd.creditId].logicalId);
  if (!logicalId) return null;
  const rec = (creditId, extra) => ({
    creditId, logicalId, tenantId: cmd.tenantId, bizId: cmd.bizId, supplierId: cmd.input.supplierId, issueDate: cmd.input.issueDate, amount: cmd.input.amount,
    documentNumber: cmd.input.documentNumber, documentKey: cmd.input.documentKey, documentCaseSensitive: cmd.input.documentCaseSensitive,
    ...(cmd.similarityConfirmation ? { similarityConfirmation: similarityAuditOf({ ...cmd, now: node.operations[cmd.operationId].at }) } : {}),
    ...(cmd.input.note ? { note: cmd.input.note } : {}), ...extra,
    operationId: cmd.operationId, createdBy: cmd.actorUid, createdRole: cmd.actorRole,
  });
  const ev = (kind, extra) => ({ operationId: cmd.operationId, kind, creditId: cmd.creditId, logicalId, voidedBy: cmd.actorUid, voidedRole: cmd.actorRole, ...extra });
  if (cmd.action === "create") return digest(operationIntent("create", logicalId, [rec(cmd.creditId, {})], null));
  if (cmd.action === "void") return digest(operationIntent("void", logicalId, [], ev("void", { reasonCode: "voided", ...(cmd.voidReason ? { reasonText: cmd.voidReason } : {}) })));
  if (cmd.action === "replace") {
    const target = node.records[cmd.creditId];
    const same = target.supplierId === cmd.input.supplierId && target.documentKey === cmd.input.documentKey;
    return digest(operationIntent("replace", logicalId, [rec(cmd.newCreditId, { replacesCreditId: cmd.creditId, ...(same ? {} : { identityCorrection: true }) })], ev("replace", { reasonCode: "replaced", replacedByCreditId: cmd.newCreditId })));
  }
  return null;
}

/**
 * Authoritative readback after an ambiguous transaction outcome. Proof of commit requires ALL of:
 * the ledger entry of this operation id, the same request hash and actor, and (credit operations) the
 * stored records / event re-digested equal to both the ledger's and this request's intent digest;
 * (owner decisions) the target review in the decided state with this operation's decider.
 */
export async function readbackOperation(cmd, dbOverride) {
  const db = dbOverride || getAdminDb();
  let node;
  try { node = (await db.ref(nodePath(cmd.tenantId, cmd.bizId)).get()).val(); }
  catch (e) { return { outcome: "unknown", code: "outcome_unknown", detail: "readback_failed" }; }
  const ledger = node && node.operations ? node.operations[cmd.operationId] : undefined;
  if (!ledger) return { outcome: "unknown", code: "outcome_unknown", detail: "operation_not_found_on_readback" };
  if (ledger.requestHash !== cmd.requestHash || ledger.by !== cmd.actorUid) return { outcome: "conflict", code: "idempotency_conflict" };
  if (!isStrictReadableNode(node, cmd.tenantId, cmd.bizId))
    return { outcome: "conflict", code: "stored_payload_mismatch" };
  if (cmd.action === "review_accept" || cmd.action === "review_reject") {
    const rv = node.review && node.review[cmd.targetOperationId];
    const want = cmd.action === "review_accept" ? "acknowledged" : "rejected";
    const a = rv && rv.decisionAudit;
    const head = rv && node.heads && node.heads[rv.logicalId];
    if (!rv || rv.state !== want || rv.decidedBy !== cmd.actorUid || rv.intentDigest !== cmd.intentDigest ||
        !a || a.operationId !== cmd.operationId || a.targetOperationId !== cmd.targetOperationId ||
        a.tenantId !== cmd.tenantId || a.bizId !== cmd.bizId || a.intentDigest !== cmd.intentDigest ||
        a.decision !== want || a.by !== cmd.actorUid || a.at !== rv.decidedAt ||
        !head || head.seq !== rv.seq || head.creditId !== (want === "rejected" && rv.kind === "replace" ? rv.creditId : (rv.newCreditId || rv.creditId)))
      return { outcome: "conflict", code: "stored_payload_mismatch" };
  } else {
    const stored = storedIntentDigest(node, cmd.operationId);
    const expected = expectedIntentDigest(cmd, node);
    if (!stored || stored !== ledger.intentDigest || stored !== expected) return { outcome: "conflict", code: "stored_payload_mismatch" };
  }
  const result = { kind: ledger.kind, logicalId: ledger.logicalId, creditId: ledger.creditId, revision: node.revision };
  for (const k of ["newCreditId", "seq", "intentDigest", "targetOperationId", "decision"]) if (ledger[k] !== undefined) result[k] = ledger[k];
  return { outcome: "applied", resolvedBy: "readback", result, after: node };
}

/**
 * Run one command (create / void / replace / review_accept / review_reject) as ONE transaction.
 * @returns {{outcome:"applied"|"replayed"|"conflict"|"unknown", code?, detail?, result?, before?, after?, resolvedBy?}}
 */
export async function runSupplierCreditTxn(cmd, dbOverride) {
  const db = dbOverride || getAdminDb();
  const ref = db.ref(nodePath(cmd.tenantId, cmd.bizId));
  let captured = null, before = null, result;
  try {
    result = await ref.transaction((current) => {
      const r = applyCreditOperation(current, cmd);
      captured = r; before = current;
      if (r.outcome === "applied") return r.node;
      return current; // replay / conflict: re-submit (decided only on a server-confirmed value)
    }, undefined, false);
  } catch (e) {
    console.error("[supplier-credits] transaction outcome unknown:", e && e.message);
    return readbackOperation(cmd, db);
  }
  if (!captured || !result || result.committed !== true) return readbackOperation(cmd, db);
  if (captured.outcome === "applied") return { outcome: "applied", result: captured.result, before, after: captured.node };
  if (captured.outcome === "replayed") return { outcome: "replayed", result: captured.result, ledger: captured.ledger, after: before };
  return { outcome: "conflict", code: captured.code, ...(captured.detail !== undefined ? { detail: captured.detail } : {}) };
}

/**
 * ONE transaction that moves one operation's review pending → cleared | flagged. A thrown transaction is
 * resolved by strict full-payload readback; otherwise the entry stays pending (never lost).
 * @returns {{status:"resolved"|"already_<to>"|"outcome_unknown"|<refusal>, state?, resolvedBy?}}
 */
export async function transitionReview({ tenantId, bizId, operationId, intentDigest, to, resolution, now }, dbOverride) {
  const db = dbOverride || getAdminDb();
  const ref = db.ref(nodePath(tenantId, bizId));
  let outcome = null, intended = null;
  try {
    const tx = await ref.transaction((current) => {
      const r = applyReviewTransition(current, { tenantId, bizId, operationId, intentDigest, to, resolution, now });
      outcome = r.o;
      if (r.o === "applied") intended = r.node.review[operationId];
      return r.o === "applied" ? r.node : current;
    }, undefined, false);
    if (!tx || tx.committed !== true) throw new Error("review_not_committed");
    return { status: outcome === "applied" ? "resolved" : outcome, state: to };
  } catch (err) {
    try {
      const v = (await ref.get()).val();
      const rv = v && v.review ? v.review[operationId] : undefined;
      const clean = isStrictReadableNode(v, tenantId, bizId);
      if (clean && rv && rv.intentDigest === intentDigest && rv.state === to && rv.resolution === resolution &&
          (!intended || JSON.stringify(rv) === JSON.stringify(intended))) return { status: "resolved", state: to, resolvedBy: "readback" };
      return { status: "outcome_unknown", detail: rv ? "review_" + rv.state : "readback_no_entry" };
    } catch { return { status: "outcome_unknown", detail: "readback_failed" }; }
  }
}

/** The stored node as readers see it (no operations ledger). null when absent. */
export async function readSupplierCredits({ tenantId, bizId }, dbOverride) {
  const db = dbOverride || getAdminDb();
  const snap = await db.ref(nodePath(tenantId, bizId)).once("value");
  return safeNodeView(snap.val());
}

/** The stored node INCLUDING the ledger (server-side decisions only; never returned to a client). */
export async function readSupplierCreditsRaw({ tenantId, bizId }, dbOverride) {
  const db = dbOverride || getAdminDb();
  return (await db.ref(nodePath(tenantId, bizId)).get()).val();
}
