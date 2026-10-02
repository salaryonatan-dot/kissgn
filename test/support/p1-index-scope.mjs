// P1 Supplier Credits — the index.html scope contract (B2G-05, P1 layer).
//
// The P1 BASE page is the C1 R2 index.html at P1_BASE (the approved C1 R2 commit), recomputed from
// git objects by the B2G-05 guard and checked there against the C1 identity pin and the C1
// contract. A P1 candidate may differ from that base page ONLY:
//   R1  inside the fixed P1 zones below, located by anchors unique in the BASE bytes (every changed
//       / inserted line of a line diff falls inside one zone; "insert" zones accept new lines only);
//   R2  while every C1 protected write / lifecycle sub-region (C1_PROTECTED) stays byte-identical
//       — the supplier purchase grid write lane included (a credit is never entered there);
//   R3  while the multiset of lines calling a C1 write / lifecycle entry point is unchanged across
//       the WHOLE file, and `supplier_payments` appears exactly as often as in the base (no
//       negative-purchase substitution);
//   R4  while the P1 browser block exists exactly once, the bundle identity names MARJIN_PRODUCT/3,
//       and the four credit actions each appear exactly once;
//   R5  while the subtraction primitives (decSub / ratSub / subAmounts) appear exactly as often as
//       in the base: the page never computes net purchases itself (formula duplication) — net is
//       the shared core's.
// Everything outside the zones is byte-identical to the reviewed C1 R2 page. This is not an
// exemption: content identity is the separate P1 pin layer (test/support/p1-candidate-pin.mjs).
import { C1_PROTECTED, C1_WRITE_TOKENS, diffHunks } from "./c1-index-scope.mjs";

export const P1_BASE = "358ce56be97a4222609a02f1a126e261744ee6fa"; // C1 R2 (consolidated review 2026-10-02: C1_R2_VERDICT APPROVED_EXCEPT_VD-50)

/**
 * P1 zones in the BASE page: [name, startAnchor, endAnchor, kind?] (inclusive lines). The end
 * anchor is searched AFTER the start anchor's text, so a one-line zone splits that line in two.
 */
export const P1_ZONES = Object.freeze([
  ["fincore bootstrap identity (MARJIN_PRODUCT/3)", '      if (!api || api !== window.MarjinFinance || !v || v.product !== "MARJIN_PRODUCT/2" || v.forecast !== "REV_FORECAST/v2") {', '        throw new Error("fincore_version_mismatch");'],
  ["P1 browser block insertion", '      sanitizeExceptionOnSave:sanitizeExceptionOnSave, FORMULA_ID:"REV_FORECAST/v1"', "  <!-- ═══ C1: browser financial view models", "insert"],
  ["C1 EXPECT identity", '    var EXPECT = Object.freeze({ product: "MARJIN_PRODUCT/2",', ' forecast: "REV_FORECAST/v2" });'],
  ["C1 TXT credit disclosures (insertion)", '      forecastInsufficient: "אין מספיק היסטוריה לתחזית",', "    });", "insert"],
  ["C1 inputsFor (credit source)", "     * src = { rows, config, fixed, asOf, ledger:{state, states, from, to}, rowsReady }", "    function guarded(fn) {"],
  ["C1 suppliers view (gross / credits / net)", "    // ── suppliers / food cost (S-01…S-05, S-08, U-05)", "    /** S-08: mean revenue of completed present days"],
  ["dashboard credit list + form wiring, finance source", "  }, [finF, finLedgerKey]);", '  const finStatus = finCoreState === "failed"'],
  ["Purchases sub-tabs (+ זיכויי ספקים)", '            {[["summary","סיכום"],["by_supplier","הזנת ספקים"],', '["alerts","התראות"]].map(([t,l])=>('],
  ["supplier strip disclosures (insertion)", '                          <div style={{fontSize:11,color:"#64748B"}}>{sv.top.text} · {sv.top.pctText}</div>', "{sv.revenue.partial&&<div", "insert"],
  ["supplier row gross − credits", '                              <span data-c1={"sup-row-"+sup.id}', "{supRow.text}</span>"],
  ["Supplier Credits tab (insertion)", '                  <span data-c1="sup-footer-total"', "          {/* ─── Weather Impact Analysis ─── */}", "insert"],
]);

export const P1_ACTIONS = Object.freeze(["list-supplier-credits", "create-supplier-credit", "void-supplier-credit", "replace-supplier-credit"]);
const SUBTRACTION = Object.freeze(["decSub(", "ratSub(", "subAmounts("]);

const text = (b) => (Buffer.isBuffer(b) ? b.toString("utf8") : String(b));
const lineAt = (src, idx) => src.slice(0, idx).split("\n").length;
function locate(src, start, end) {
  const i = src.indexOf(start);
  if (i < 0) return { error: "anchor_missing" };
  if (src.indexOf(start, i + 1) !== -1) return { error: "anchor_not_unique" };
  const j = src.indexOf(end, i + start.length);
  if (j < 0) return { error: "end_anchor_missing" };
  return { from: i, to: j + end.length, firstLine: lineAt(src, i), lastLine: lineAt(src, j + end.length - 1) };
}
function writeLines(src) {
  const m = new Map();
  for (const l of src.split("\n")) if (C1_WRITE_TOKENS.some((t) => l.includes(t))) m.set(l, (m.get(l) || 0) + 1);
  return m;
}
const countOf = (s, sub) => s.split(sub).length - 1;

/** Verdict of the P1 contract for a candidate page against the P1 BASE page (both bytes). */
export function p1IndexVerdict(baseBytes, candidateBytes) {
  const A = text(baseBytes), B = text(candidateBytes);
  const zones = [];
  for (const [name, s, e, kind] of P1_ZONES) {
    const z = locate(A, s, e);
    if (z.error) return { ok: false, reason: "zone_anchor_invalid", detail: [name, z.error] };
    zones.push({ name, kind: kind || "replace", ...z });
  }
  // R1
  const outside = [];
  for (const h of diffHunks(A, B)) {
    const inZone = h.count === 0
      ? zones.some((z) => h.start >= z.firstLine && h.start < z.lastLine)
      : zones.some((z) => z.kind === "replace" && h.start >= z.firstLine && h.start + h.count - 1 <= z.lastLine);
    if (!inZone) outside.push(h.count === 0 ? `insertion after line ${h.start}` : `lines ${h.start}-${h.start + h.count - 1}`);
  }
  if (outside.length) return { ok: false, reason: "change_outside_p1_zones", detail: outside };
  // R2
  for (const [name, s, e] of C1_PROTECTED) {
    const a = locate(A, s, e), b = locate(B, s, e);
    if (a.error) return { ok: false, reason: "protected_anchor_invalid", detail: [name, "base", a.error] };
    if (b.error) return { ok: false, reason: "protected_region_changed", detail: [name, b.error] };
    if (A.slice(a.from, a.to) !== B.slice(b.from, b.to)) return { ok: false, reason: "protected_region_changed", detail: [name] };
  }
  // R3
  const wa = writeLines(A), wb = writeLines(B), changed = [];
  for (const k of new Set([...wa.keys(), ...wb.keys()])) if ((wa.get(k) || 0) !== (wb.get(k) || 0)) changed.push(k.trim().slice(0, 160));
  if (changed.length) return { ok: false, reason: "write_path_lines_changed", detail: changed };
  if (countOf(B, "supplier_payments") !== countOf(A, "supplier_payments")) return { ok: false, reason: "purchase_path_changed", detail: [countOf(A, "supplier_payments"), countOf(B, "supplier_payments")] };
  // R4
  if (countOf(B, "// ── P1 supplier credits browser seam") !== 1 || countOf(B, "window.MarjinP1 = Object.freeze(") !== 1) return { ok: false, reason: "p1_block_shape" };
  if (countOf(B, 'v.product !== "MARJIN_PRODUCT/3"') !== 1 || countOf(B, 'var EXPECT = Object.freeze({ product: "MARJIN_PRODUCT/3", forecast: "REV_FORECAST/v2" });') !== 1) return { ok: false, reason: "bundle_identity" };
  for (const a of P1_ACTIONS) if (countOf(B, a) !== 1) return { ok: false, reason: "credit_action_shape", detail: [a, countOf(B, a)] };
  // R5
  for (const t of SUBTRACTION) if (countOf(B, t) !== countOf(A, t)) return { ok: false, reason: "formula_duplication", detail: [t, countOf(A, t), countOf(B, t)] };
  return { ok: true };
}
