// M1 integration — the index.html contract of the integrated page (local candidate, pending independent Codex review).
//
// The integrated page has NO free-form scope: it must be EXACTLY the recorded 3-way derivation of the two approved
// input pages over their merge base (test/support/m1-derivation.mjs: `git merge-file` Core/F1 R4 ⊕ P1 R7 over C1 R2,
// three recorded conflict resolutions bound to the exact conflict sides). On top of that exactness, the reviewed
// INVARIANTS of BOTH inputs are asserted on the integrated bytes, so a recorded resolution can never drop either side:
//   P1 (p1-index-scope R2–R7): the P1 browser block once; bundle identity MARJIN_PRODUCT/3 (bootstrap + EXPECT); the six
//     credit actions once each; legacy pending-credit card retired; MARJIN_P1/2 over MARJIN_CREDITS/4; no new subtraction
//     primitive and no new supplier_payments / write-path line beyond the Core page (P1 adds none over the base);
//     the C1 protected write / lifecycle regions identical to the Core page.
//   Core/F1 R4 (r4-index-scope REQUIRED / FORBIDDEN, restated literally below): MARJIN_COSTH/6 capability checks, the
//     historyBinding seam, the BOUND finSrc decode, the generation-bound subscription, the editor lifecycle controls; no
//     fifth state, no stale capability, no unbound decode, no global-tenant binding.
//   M1: the merged finSrc / inputsFor carry BOTH sources (cost history bound through historyBinding AND the P1 credit
//     source), and the bootstrap checks BOTH identities (MARJIN_PRODUCT/3 and MARJIN_COSTH/6).
import { spawnSync } from "node:child_process";
import { C1_PROTECTED, C1_WRITE_TOKENS } from "./c1-index-scope.mjs";
import { P1_ACTIONS, P1_RETIRED_LEGACY } from "./p1-index-scope.mjs";
import { deriveMerged, M1_RESOLUTIONS } from "./m1-derivation.mjs";
import { M1_CORE_COMMIT, M1_P1_COMMIT, M1_MERGE_BASE } from "./m1-integration-pin.mjs";

const text = (b) => (Buffer.isBuffer(b) ? b.toString("utf8") : String(b));
const countOf = (s, sub) => s.split(sub).length - 1;
const blob = (root, spec) => { const r = spawnSync("git", ["-C", root, "cat-file", "blob", spec], { encoding: "buffer", maxBuffer: 1 << 28 }); if (r.status !== 0) throw new Error(spec); return r.stdout.toString("utf8"); };
function locate(src, start, end) { const i = src.indexOf(start); if (i < 0 || src.indexOf(start, i + 1) !== -1) return null; const j = src.indexOf(end, i + start.length); return j < 0 ? null : src.slice(i, j + end.length); }
function writeLines(src) { const m = new Map(); for (const l of src.split("\n")) if (C1_WRITE_TOKENS.some((t) => l.includes(t))) m.set(l, (m.get(l) || 0) + 1); return m; }
const sameMap = (a, b) => a.size === b.size && [...a].every(([k, v]) => b.get(k) === v);

export const M1_R4_REQUIRED = Object.freeze([
  'v.costHistory !== "MARJIN_COSTH/6"', 'api.versions.costHistory !== "MARJIN_COSTH/6"',
  'function historyBinding(raw, sel, currentBizId, businesses) {', '      if (!bound) return { ok: false, reason: "context_unbound" };',
  '      if (!registered) return { ok: false, reason: "business_unregistered" };', 'historyBinding: historyBinding,',
  'const histBind = window.MarjinC1.historyBinding(finRaw, finSel, currentBizId, businesses);', '      : !histBind.ok ? { state: "unreadable", reason: histBind.reason }',
  'finF.costHistory.codec.decodeHistory({ failed: "read_failed" }, histBind.bind)', 'finF.costHistory.codec.decodeHistory({ exists: raw.costHistory.kind !== "absent", value: raw.costHistory.raw }, histBind.bind)',
  '  }, [currentBizId, finSel.gen, finSel.tenantId]);',
  'setFinRaw({ config: FIN_NODE_LOADING, fixed: FIN_NODE_LOADING, costHistory: FIN_NODE_LOADING, bizId: currentBizId || null, tenantId: bound ? ctx.tenantId : null, gen: bound ? ctx.gen : null });',
  'setFinRaw(prev => (prev.bizId === currentBizId && prev.tenantId === ctx.tenantId && prev.gen === ctx.gen ? { ...prev, [name]: v } : prev))',
  '    : !bound ? {state:"unreadable",reason:"context_unbound"}', '    : codec.decodeHistoryStructure({exists:node.kind === "raw",value:node.raw},{tenantId,bizId});',
  '{review?.state==="cleared"&&review?.decision==="accepted"&&<p data-f2="accepted">', '{activating&&role!=="owner"&&<p data-f2="activation-owner-only">',
  '{(activating?role==="owner":state.state==="present"&&!unresolved)&&draft&&<>', 'reviewCommand(review.state==="flagged"?"accept_flag":"reconcile")',
  'data-f2="reject-flag"', 'reviewCommand("reject_flag")',
  'if (activating && (role!=="owner" || !activationConfirmed)) {setResult({status:"activation_confirmation_required"});return;}',
  'data-f2="cost-editor"', 'financeLocked={finRaw.bizId!==currentBizId || finRaw.costHistory.kind!=="absent"}',
]);
export const M1_R4_FORBIDDEN = Object.freeze([/acknowledged/, /MARJIN_COSTH\/[45]"/, /decodeHistory\(\{ exists: raw\.costHistory\.kind !== "absent", value: raw\.costHistory\.raw \}\)/,
  /decodeHistory\(\{ exists: raw\.costHistory\.kind !== "absent", value: raw\.costHistory\.raw \}, histBind\)/, /historyBinding\([^)]*_currentTenantId/]);
/** The integration-specific requirements of the three recorded resolutions (both sides present). */
export const M1_REQUIRED = Object.freeze([
  ['bootstrap_both_identities', '      if (!api || api !== window.MarjinFinance || !v || v.product !== "MARJIN_PRODUCT/3" || v.forecast !== "REV_FORECAST/v2" ||\n          v.costHistory !== "MARJIN_COSTH/6" || !api.costHistory || !api.costHistory.codec || typeof api.costHistory.codec.decodeHistory !== "function") {'],
  ['inputs_both_sources', '        rows: src.rows, config: src.config, fixed: src.fixed, costHistory: src.costHistory || { state: "absent" }, asOfBusinessDate: src.asOf,'],
  ['inputs_both_sources', '      if (C && C.state === "loading") return { status: "loading", reason: "supplier_credits" };'],
  ['inputs_both_sources', '      if (C) inputs.supplierCredits = C;'],
  ['finsrc_both_sources', '    return { rows: entries, config: nodeOf(raw.config, "object"), fixed: nodeOf(raw.fixed, "array"), costHistory, asOf: finAsOf, ledger, rowsReady: finRowsReady, credits };'],
  ['finsrc_both_sources', '  }, [finF, finAsOf, entries, finRaw, finLedger, finLedgerKey, finRowsReady, currentBizId, finSel.gen, finSel.tenantId, finSel.bizId, businesses, creditsHeld, creditsKey]);'],
  ['finsrc_both_sources', '    const credits = window.MarjinP1 ? window.MarjinP1.sourceFor(finF, creditsHeld, creditsKey, finSel && finSel.tenantId && finSel.bizId ? { tenantId: finSel.tenantId, bizId: finSel.bizId } : null) : { state: "not_loaded" };'],
]);

/** Verdict of the M1 page contract (bytes) on the repository at `root`; `resolutions` defaults to the recorded set. */
export function m1PageVerdict(root, candidateBytes, resolutions = M1_RESOLUTIONS) {
  const B = text(candidateBytes);
  const d = deriveMerged(root, "index.html", resolutions);
  if (!d.ok) return d;
  if (d.bytes.toString("utf8") !== B) return { ok: false, reason: "not_the_recorded_derivation" };
  const base = blob(root, `${M1_MERGE_BASE}:index.html`), core = blob(root, `${M1_CORE_COMMIT}:index.html`), p1 = blob(root, `${M1_P1_COMMIT}:index.html`);
  // P1 invariants
  if (countOf(B, "// ── P1 supplier credits browser seam") !== 1 || countOf(B, "window.MarjinP1 = Object.freeze(") !== 1) return { ok: false, reason: "p1_block_shape" };
  if (countOf(B, 'v.product !== "MARJIN_PRODUCT/3"') !== 1 || countOf(B, 'var EXPECT = Object.freeze({ product: "MARJIN_PRODUCT/3", forecast: "REV_FORECAST/v2" });') !== 1) return { ok: false, reason: "bundle_identity" };
  for (const a of P1_ACTIONS) if (countOf(B, a) !== 1) return { ok: false, reason: "credit_action_shape", detail: a };
  for (const t of P1_RETIRED_LEGACY) if (countOf(B, t) !== 0) return { ok: false, reason: "legacy_credit_card_reactivated", detail: t };
  if (countOf(B, 'var P1_VERSION = "MARJIN_P1/2";') !== 1 || countOf(B, 'var CREDITS_CONTRACT = "MARJIN_CREDITS/4";') !== 1) return { ok: false, reason: "p1_contract_identity" };
  for (const t of ["decSub(", "ratSub(", "subAmounts("]) if (countOf(B, t) !== countOf(core, t) + countOf(p1, t) - countOf(base, t)) return { ok: false, reason: "formula_duplication", detail: t };
  if (countOf(B, "supplier_payments") !== countOf(core, "supplier_payments") || countOf(p1, "supplier_payments") !== countOf(base, "supplier_payments")) return { ok: false, reason: "purchase_path_changed" };
  if (!sameMap(writeLines(B), writeLines(core)) || !sameMap(writeLines(p1), writeLines(base))) return { ok: false, reason: "write_path_lines_changed" };
  for (const [name, s, e] of C1_PROTECTED) { const m = locate(B, s, e), c = locate(core, s, e); if (m === null || m !== c) return { ok: false, reason: "protected_region_changed", detail: name }; }
  // Core/F1 R4 invariants
  for (const lit of M1_R4_REQUIRED) if (!B.includes(lit)) return { ok: false, reason: "r4_literal_missing", detail: lit };
  for (const re of M1_R4_FORBIDDEN) if (re.test(B)) return { ok: false, reason: "r4_forbidden_literal", detail: String(re) };
  if (B.split('historyNode={finRaw.bizId===currentBizId&&finRaw.tenantId===finSel.tenantId&&finRaw.gen===finSel.gen?finRaw.costHistory:{kind:"loading"}}').length !== 3) return { ok: false, reason: "r4_editor_node_binding_missing" };
  // M1 resolution invariants
  for (const [reason, lit] of M1_REQUIRED) if (countOf(B, lit) !== 1) return { ok: false, reason, detail: lit.slice(0, 120) };
  return { ok: true };
}
