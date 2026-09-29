import { getDb } from "../../firebase/admin.js";
import { bizSuppliersRef } from "../../firebase/refs.js";
import { loadCanonicalInputs } from "../../finance-server/canonicalInputs.js";
import { canonicalPurchaseRecords } from "../../finance-server/canonicalMetrics.js";
import type { CanonicalPurchaseMetric } from "../../finance-server/canonicalMetrics.js";

// The SUPPLIERS list is a legacy `_v` envelope that is NOT part of Storage V2; this
// parser is kept for it alone (display names only). Entries go through the canonical API below.
function parseLegacyListEnvelope(snapshot: any): any[] {
  const raw = snapshot.val();
  if (!raw) return [];
  if (raw._v && typeof raw._v === "string") {
    try { return JSON.parse(raw._v); } catch { return []; }
  }
  if (Array.isArray(raw)) return raw;
  if (typeof raw === "object") return Object.values(raw);
  return [];
}

export async function getPurchaseMetrics(
  tenantId: string,
  startDate: string,
  endDate: string,
  bizId: string,
  _branchId?: string
): Promise<CanonicalPurchaseMetric[]> {
  // Supplier display names (the suppliers list is not financial data).
  const suppSnap = await bizSuppliersRef(tenantId, bizId).once("value");
  const suppliers = parseLegacyListEnvelope(suppSnap) as Array<{ id: string | number; name: string }>;
  const nameMap: Record<string, string> = {};
  for (const s of suppliers) {
    if (s && s.id !== undefined && s.id !== null) nameMap[String(s.id)] = s.name;
  }
  // Financial Core B1: one record per (present completed date, purchase source) — the
  // aggregate of ALL contributions of that date and source (several per supplier per day are
  // summed; explicit 0 / "skip" kept as 0; negatives (refunds) kept; legacy `food_cost` named).
  const inputs = await loadCanonicalInputs(getDb(), tenantId, bizId, { site: "purchasesRepo.getPurchaseMetrics", need: { config: false, fixed: false } });
  return canonicalPurchaseRecords(inputs, { from: startDate, to: endDate }, nameMap);
}
