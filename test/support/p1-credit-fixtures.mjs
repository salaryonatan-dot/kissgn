// P1 R1 test support: MARJIN_CREDITS/3 nodes built with the REAL pure writer domain
// (lib/supplierCredits.js applyCreditOperation + applyReviewTransition) — never hand-written envelopes —
// so every fixture is exactly what the server would store. Invalid shapes are produced by mutating a
// valid node AFTER it was built (`mutate`).
import * as SC from "../../lib/supplierCredits.js";

export const T = "tenantA", B = "bizA";
export const cid = (n) => `c0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const oid = (n) => `0a000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const clone = (v) => JSON.parse(JSON.stringify(v));

/**
 * One credit spec: n (id), supplierId, issueDate, amount, plus optional
 *   documentNumber (default "CR-<n>"), note, actor / role,
 *   review: "cleared" (default) | "pending" | "flagged" | "acknowledged" | "rejected" — of its CREATE,
 *   voided: true | { review } — a later void operation (cleared unless its own review is given),
 *   raw: { field: value } — stored-record overrides applied AFTER the build (invalid data).
 */
export const spec = (n, supplierId, issueDate, amount, extra = {}) => ({ n, supplierId, issueDate, amount, ...extra });

const PLACEHOLDER = { supplierId: "s1", issueDate: "2026-08-01", amount: "1" };

function run(node, cmd) {
  cmd.requestHash = SC.requestHash(cmd);
  const r = SC.applyCreditOperation(node, cmd);
  if (r.outcome !== "applied") throw new Error("fixture op refused: " + r.code + " " + JSON.stringify(r.detail || ""));
  return r.node;
}
export function resolve(node, operationId, state, { now = 100000, owner = "own" } = {}) {
  if (state === "pending") return node;
  const rv = node.review[operationId];
  const to = state === "cleared" ? "cleared" : "flagged";
  let n = node;
  if (rv.state === "pending") {
    const t = SC.applyReviewTransition(node, { tenantId: node.tenantId, bizId: node.bizId, operationId, intentDigest: rv.intentDigest, to, resolution: to === "cleared" ? "post_commit_authorized" : "revoked_during_commit", now });
    if (t.o !== "applied") throw new Error("fixture transition refused: " + t.o);
    n = t.node;
  } else if (rv.state !== to) throw new Error("fixture: cannot move " + rv.state + " to " + state);
  if (state === "acknowledged" || state === "rejected") {
    n = run(n, { action: state === "acknowledged" ? "review_accept" : "review_reject", tenantId: n.tenantId, bizId: n.bizId, targetOperationId: operationId, intentDigest: rv.intentDigest, decision: state === "acknowledged" ? "accept" : "reject", operationId: "dec-" + operationId, actorUid: owner, actorRole: "owner", now: now + 1 });
  }
  return n;
}

/** Build a node from specs (create in order, then the requested review states, voids and raw overrides). */
export function creditNode(specs, { tenantId = T, bizId = B, actor = "u1", role = "manager" } = {}) {
  let node = null, now = 1000;
  const raws = [];
  for (const s of specs) {
    let input;
    try { input = SC.validateCreditInput({ supplierId: s.supplierId, issueDate: s.issueDate, amount: s.amount, documentNumber: s.documentNumber === undefined ? "CR-" + s.n : s.documentNumber, note: s.note }); }
    catch (_) {
      input = SC.validateCreditInput({ ...PLACEHOLDER, documentNumber: "CR-" + s.n });
      raws.push([s.n, { supplierId: s.supplierId, issueDate: s.issueDate, amount: s.amount }]);
    }
    now += 10;
    node = run(node, { action: "create", tenantId, bizId, creditId: cid(s.n), operationId: oid(s.n), input, actorUid: s.actor || actor, actorRole: s.role || role, now });
    node = resolve(node, oid(s.n), s.review || "cleared", { now: now + 1 });
    if (s.voided) {
      now += 10;
      const head = node.heads[cid(s.n)];
      node = run(node, { action: "void", tenantId, bizId, creditId: cid(s.n), expectedSeq: head.seq, operationId: oid(5000 + s.n), actorUid: s.actor || actor, actorRole: s.role || role, now });
      node = resolve(node, oid(5000 + s.n), (s.voided && s.voided.review) || "cleared", { now: now + 1 });
    }
    if (s.raw) raws.push([s.n, s.raw]);
  }
  for (const [n, over] of raws) for (const [k, v] of Object.entries(over)) {
    if (v === undefined) delete node.records[cid(n)][k]; else node.records[cid(n)][k] = v;
  }
  return node;
}

/** A replace operation on an existing node (returns the new node; review cleared unless given). */
export function replaceIn(node, fromN, toN, fields, { review = "cleared", identityCorrection, actor = "u1", role = "manager", now = 900000 } = {}) {
  const target = node.records[cid(fromN)];
  const input = SC.validateCreditInput({ supplierId: target.supplierId, issueDate: target.issueDate, amount: target.amount, documentNumber: target.documentNumber, ...fields });
  const head = node.heads[target.logicalId];
  const n = run(node, { action: "replace", tenantId: node.tenantId, bizId: node.bizId, creditId: cid(fromN), newCreditId: cid(toN), expectedSeq: head.seq, ...(identityCorrection ? { identityCorrection: true } : {}), input, operationId: oid(toN), actorUid: actor, actorRole: role, now });
  return resolve(n, oid(toN), review, { now: now + 1 });
}
/** A void operation on an existing node. */
export function voidIn(node, n, { review = "cleared", actor = "u1", role = "manager", now = 900000, opN = 7000 + n } = {}) {
  const target = node.records[cid(n)];
  const head = node.heads[target.logicalId];
  const out = run(node, { action: "void", tenantId: node.tenantId, bizId: node.bizId, creditId: head.creditId, expectedSeq: head.seq, operationId: oid(opN), actorUid: actor, actorRole: role, now });
  return resolve(out, oid(opN), review, { now: now + 1 });
}
/** A deep copy changed by `fn(copy)` (for corruption cases). */
export function mutate(node, fn) { const c = clone(node); fn(c); return c; }
/** The node as readers see it (no ledger). */
export const view = (node) => SC.safeNodeView(node);
