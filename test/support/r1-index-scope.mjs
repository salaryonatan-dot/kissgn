// F1 R1 (consolidated core/F1 remediation) page delta over the FIXED F1 candidate page (F1_COMMIT:index.html,
// the F1 identity pin). The ONLY allowed hunks are:
//   885  bootstrap capability check  MARJIN_COSTH/1 → /2
//   1102 C1 seam capability check    MARJIN_COSTH/1 → /2
//   1298 C1 inputsFor: review-state reasons (authorization_review_*) surface as typed unavailable reasons
//   10532/10535 PnLScreen: the "other expenses" row moves BELOW the VD-50 gross line (presentation only)
// No write call may change (write-line multiset identical) and the old capability must be gone.
import { diffHunks, C1_WRITE_TOKENS } from "./c1-index-scope.mjs";
import { F1_COMMIT } from "./f1-candidate-pin.mjs";
export const R1_INDEX_BASE = F1_COMMIT;
const HUNKS = Object.freeze([[885, 1], [1102, 1], [1298, 1], [10532, 2], [10535, 0]]);
const writes = (s) => s.split("\n").filter((l) => C1_WRITE_TOKENS.some((t) => l.includes(t))).sort();
export function r1IndexVerdict(baseBytes, candidateBytes) {
  const a = Buffer.isBuffer(baseBytes) ? baseBytes.toString("utf8") : String(baseBytes);
  const b = Buffer.isBuffer(candidateBytes) ? candidateBytes.toString("utf8") : String(candidateBytes);
  const hunks = diffHunks(a, b).map((h) => [h.start, h.count]);
  if (JSON.stringify(hunks) !== JSON.stringify(HUNKS)) return { ok: false, reason: "r1_scope_changed", detail: hunks };
  if (JSON.stringify(writes(a)) !== JSON.stringify(writes(b))) return { ok: false, reason: "write_path_changed" };
  if (!b.includes('v.costHistory !== "MARJIN_COSTH/2"') || !b.includes('api.versions.costHistory !== "MARJIN_COSTH/2"') || b.includes("MARJIN_COSTH/1")) return { ok: false, reason: "r1_capability_missing" };
  if (!b.includes('"cost_history_" + src.costHistory.reason')) return { ok: false, reason: "r1_review_reason_missing" };
  const gross = b.indexOf('c1="pnl-vd50"'), other = b.indexOf('c1="pnl-other"');
  if (gross < 0 || other < 0 || other < gross) return { ok: false, reason: "r1_vd50_presentation_order" };
  return { ok: true };
}
