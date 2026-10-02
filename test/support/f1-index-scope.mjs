// F1 page delta over the fixed VD-50 candidate page. Each allowed hunk is the
// subscription, capability check or read-only cost-history input seam.
import { diffHunks, C1_WRITE_TOKENS } from "./c1-index-scope.mjs";
export const F1_INDEX_BASE = "2e4e2030765d3c1e302658c52f9131087df9c4d8";
const HUNKS = Object.freeze([[793, 0], [876, 1], [1092, 0], [1286, 0], [1295, 1], [6301, 1], [6303, 1], [6322, 0], [6385, 2]]);
const writes = (s) => s.split("\n").filter((l) => C1_WRITE_TOKENS.some((t) => l.includes(t))).sort();
export function f1IndexVerdict(baseBytes, candidateBytes) {
  const a = Buffer.isBuffer(baseBytes) ? baseBytes.toString("utf8") : String(baseBytes);
  const b = Buffer.isBuffer(candidateBytes) ? candidateBytes.toString("utf8") : String(candidateBytes);
  const hunks = diffHunks(a, b).map((h) => [h.start, h.count]);
  if (JSON.stringify(hunks) !== JSON.stringify(HUNKS)) return { ok: false, reason: "f1_scope_changed", detail: hunks };
  if (JSON.stringify(writes(a)) !== JSON.stringify(writes(b))) return { ok: false, reason: "write_path_changed" };
  if (!b.includes('v.costHistory !== "MARJIN_COSTH/1"') || !b.includes("window.storage.subscribeCostHistory =")) return { ok: false, reason: "f1_capability_or_subscription_missing" };
  return { ok: true };
}
