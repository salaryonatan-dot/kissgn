// WP-C2 — the index.html scope contract of the C2 rebuild-trigger change (B2G-05, C2 layer).
//
// The C2 BASE page is the C1 R2 index.html at C2_BASE, recomputed from git objects by the B2G-05
// guard and checked there against the C1 identity pin and the C1 contract. A C2 candidate may
// differ from that base page ONLY:
//   R1  inside the two fixed C2 zones below, located by anchors unique in the BASE bytes
//       (every changed / inserted line of a line diff falls inside one zone);
//   R2  while the save call site and its injection stay byte-identical (C2-02);
//   R3  while the multiset of lines calling a write / lifecycle entry point is unchanged across
//       the WHOLE file (the C1 write-token list, unchanged);
//   R4  while the C2 block exists exactly once and the trigger delegates to it.
// Everything outside the two zones — the C1 seam and every C1 surface included — is therefore
// byte-identical to the reviewed C1 R2 page. This is not an exemption: content identity is the
// separate C2_INDEX_PIN layer of B2G-05 (an in-zone edit passes this scope and fails the pin).
import { C1_WRITE_TOKENS, diffHunks } from "./c1-index-scope.mjs";

export const C2_BASE = "358ce56be97a4222609a02f1a126e261744ee6fa"; // C1 R2 (consolidated review 2026-10-02: C1_R2_VERDICT APPROVED_EXCEPT_VD-50)

/** Files C2 retires (C2-03): absent from HEAD, the index and the working tree. */
export const C2_RETIRED = Object.freeze(["lib/entryDelta.js"]);

/** C2 zones in the BASE page: [name, startAnchor, endAnchor, kind?] (inclusive lines). */
export const C2_ZONES = Object.freeze([
  ["rebuild trigger body (C2-01)", "  // Real material-change detector for the rebuild decision (mirrors lib/entryDelta.js).\n  const __revenueMaterialChanged = (prev, next) => {", "    return false;\n  };"],
  ["C2 fingerprint block insertion", "      money: money, pctText: pctText,\n    });\n  })();\n  </script>", '  <script type="text/babel" data-presets="react">', "insert"],
]);

/** Lines that must be byte-identical and present exactly once in BOTH pages (C2-02). */
export const C2_PROTECTED_LINES = Object.freeze([
  "  const __revenueMaterialChanged = io.materialChanged;",
  "  const __revenueChanged = __revenueMaterialChanged(__prevEntry, netForm);",
  "  const shouldRebuild = __revenueChanged || (__exResponse && __exResponse.applied === true && __exResponse.rebuildRequired === true);",
  "        materialChanged: __revenueMaterialChanged,",
]);

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

/** Verdict of the C2 contract for a candidate page against the C2 BASE page (both bytes). */
export function c2IndexVerdict(baseBytes, candidateBytes) {
  const A = text(baseBytes), B = text(candidateBytes);
  const zones = [];
  for (const [name, s, e, kind] of C2_ZONES) {
    const z = locate(A, s, e);
    if (z.error) return { ok: false, reason: "zone_anchor_invalid", detail: [name, z.error] };
    zones.push({ name, kind: kind || "replace", ...z });
  }
  const outside = [];
  for (const h of diffHunks(A, B)) {
    const inZone = h.count === 0
      ? zones.some((z) => h.start >= z.firstLine && h.start < z.lastLine)
      : zones.some((z) => z.kind === "replace" && h.start >= z.firstLine && h.start + h.count - 1 <= z.lastLine);
    if (!inZone) outside.push(h.count === 0 ? `insertion after line ${h.start}` : `lines ${h.start}-${h.start + h.count - 1}`);
  }
  if (outside.length) return { ok: false, reason: "change_outside_c2_zones", detail: outside };
  for (const l of C2_PROTECTED_LINES) {
    if (countOf(A, l + "\n") !== 1) return { ok: false, reason: "protected_line_invalid", detail: ["base", l] };
    if (countOf(B, l + "\n") !== 1) return { ok: false, reason: "protected_line_changed", detail: [l] };
  }
  const wa = writeLines(A), wb = writeLines(B), changed = [];
  for (const k of new Set([...wa.keys(), ...wb.keys()])) if ((wa.get(k) || 0) !== (wb.get(k) || 0)) changed.push(k.trim().slice(0, 160));
  if (changed.length) return { ok: false, reason: "write_path_lines_changed", detail: changed };
  if (countOf(B, "// ── C2 canonical financial fingerprint") !== 1 || countOf(B, "window.MarjinC2 = Object.freeze(") !== 1) return { ok: false, reason: "c2_block_shape" };
  if (countOf(B, "window.MarjinC2.financialChanged(fin, prev, next).changed") !== 1) return { ok: false, reason: "c2_trigger_shape" };
  return { ok: true };
}
