import { bizEntriesRef } from "../../firebase/refs.js";
import { bizSuppliersRef } from "../../firebase/refs.js";
import { requireEntriesRows } from "../../../lib/analytics/entriesReader.js";
import type { PurchaseMetric } from "../../agent/types/analytics.js";

function num(v: unknown): number {
  return Number(v) || 0;
}

// The SUPPLIERS list is a legacy `_v` envelope that is NOT part of Storage V2; this
// parser is kept for it alone. Entries go through the shared dual-mode reader below.
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
): Promise<PurchaseMetric[]> {
  // Get supplier names for lookup
  const suppSnap = await bizSuppliersRef(tenantId, bizId).once("value");
  const suppliers = parseLegacyListEnvelope(suppSnap) as Array<{ id: string | number; name: string }>;
  const nameMap: Record<string, string> = {};
  for (const s of suppliers) {
    nameMap[String(s.id)] = s.name;
  }

  // Entries: shared dual-mode reader; every stored row contributes its payments;
  // a malformed node throws a typed EntriesStorageError (no silent empty result).
  const ref = bizEntriesRef(tenantId, bizId);
  const snapshot = await ref.once("value");
  const rows: any[] = requireEntriesRows(snapshot.val(), { tenantId, bizId, site: "purchasesRepo.getPurchaseMetrics" });

  const results: PurchaseMetric[] = [];
  for (const e of rows) {
    if (!e.date || e.date < startDate || e.date > endDate) continue;
    if (!e.supplier_payments || typeof e.supplier_payments !== "object") continue;
    for (const [suppId, amount] of Object.entries(e.supplier_payments)) {
      const val = num(amount);
      if (val > 0) {
        results.push({
          date: e.date,
          supplierName: nameMap[suppId] || `ספק ${suppId}`,
          amount: val,
        });
      }
    }
  }

  return results.sort((a, b) => a.date.localeCompare(b.date));
}
