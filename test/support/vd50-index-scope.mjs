// VD-50 successor to the independently reviewed C2 page. This scope is tied to the
// exact C2 blob and the five approved gross-profit presentation hunks. Identity is
// separately fixed by VD50_INDEX_PIN; neither scope nor HEAD derives that pin.
import { diffHunks, C1_WRITE_TOKENS } from "./c1-index-scope.mjs";

export const VD50_BASE = "3ca62af7076fac413edf199f0971227bb951d629";
const HUNKS = Object.freeze([[1482, 0], [1511, 5], [1543, 1], [10380, 1], [10513, 2]]);
const writeLines = (src) => src.split("\n").filter((l) => C1_WRITE_TOKENS.some((t) => l.includes(t))).sort();

export function vd50IndexVerdict(baseBytes, candidateBytes) {
  const a = Buffer.isBuffer(baseBytes) ? baseBytes.toString("utf8") : String(baseBytes);
  const b = Buffer.isBuffer(candidateBytes) ? candidateBytes.toString("utf8") : String(candidateBytes);
  const hunks = diffHunks(a, b).map((h) => [h.start, h.count]);
  if (JSON.stringify(hunks) !== JSON.stringify(HUNKS)) return { ok: false, reason: "vd50_scope_changed", detail: hunks };
  if (JSON.stringify(writeLines(a)) !== JSON.stringify(writeLines(b))) return { ok: false, reason: "write_path_changed" };
  if (!b.includes("gross: typedValue(A.grossProfitBeforeFixed),") || !b.includes("function pnlGrossLineVD50(F, actual)")) return { ok: false, reason: "vd50_core_delegation_missing" };
  return { ok: true };
}
