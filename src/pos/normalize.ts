/**
 * POS Ingestion Foundation — normalization (Phase 1, INERT).
 *
 * Pure functions. No network, no DB, no secrets. Maps a raw daily-summary
 * payload (Beecomm field aliases live here) onto the internal
 * NormalizedReportContent, and finalizes a report with provenance stamps.
 */

import type {
  NormalizedReportContent,
  NormalizedSalesReport,
  PosFetchContext,
} from "./types.js";
import { contentHashFor, makeImportId } from "./hash.js";

export const SCHEMA_VERSION = "1.0.0";

/** Hour buckets we surface (matches the existing analytics fetcher). */
const HOURS = [
  "08", "09", "10", "11", "12", "13", "14",
  "15", "16", "17", "18", "19", "20", "21",
];

/** Coerce to a finite number, else null (0 is valid; missing is null, never 0). */
export function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** avgCheck = revenueTotal / tickets, rounded to 2dp; null if not computable. */
export function computeAvgCheck(
  revenueTotal: number | null,
  tickets: number | null
): number | null {
  if (revenueTotal === null || tickets === null || tickets <= 0) return null;
  return Math.round((revenueTotal / tickets) * 100) / 100;
}

/** Build the hourly map from a raw hourly object; null if none present. */
export function extractHourly(
  hourlyRaw: Record<string, unknown> | null | undefined
): Record<string, number> | null {
  if (!hourlyRaw || typeof hourlyRaw !== "object") return null;
  const out: Record<string, number> = {};
  let any = false;
  for (const h of HOURS) {
    const raw =
      hourlyRaw[h] ?? hourlyRaw[`${h}:00`] ?? hourlyRaw[String(parseInt(h, 10))];
    const n = numOrNull(raw);
    if (n !== null) any = true;
    out[h] = n ?? 0;
  }
  return any ? out : null;
}

/** Raw Beecomm daily-summary shape (loose — field aliases handled here). */
export interface BeecommDailyRaw {
  total_sales?: unknown;
  totalSales?: unknown;
  transaction_count?: unknown;
  transactionCount?: unknown;
  dine_in_sales?: unknown;
  dineInSales?: unknown;
  delivery_sales?: unknown;
  deliverySales?: unknown;
  takeaway_sales?: unknown;
  takeawaySales?: unknown;
  hourly?: Record<string, unknown> | null;
  hourlyBreakdown?: Record<string, unknown> | null;
}

/**
 * Map a raw Beecomm daily-summary to NormalizedReportContent (no provenance
 * stamps yet). Pure — caller supplies identity via ctx + businessDate.
 */
export function normalizeBeecommDaily(
  raw: BeecommDailyRaw,
  ctx: Pick<PosFetchContext, "tenantId" | "businessId">,
  businessDate: string
): NormalizedReportContent {
  const revenueTotal = numOrNull(raw.total_sales ?? raw.totalSales);
  const tickets = numOrNull(raw.transaction_count ?? raw.transactionCount);

  return {
    businessId: ctx.businessId,
    tenantId: ctx.tenantId,
    businessDate,
    sourceSystem: "beecomm",
    reportType: "daily_summary",
    revenueTotal,
    tickets,
    avgCheck: computeAvgCheck(revenueTotal, tickets),
    channels: {
      dineIn: numOrNull(raw.dine_in_sales ?? raw.dineInSales),
      delivery: numOrNull(raw.delivery_sales ?? raw.deliverySales),
      takeaway: numOrNull(raw.takeaway_sales ?? raw.takeawaySales),
    },
    hourly: extractHourly(raw.hourly ?? raw.hourlyBreakdown ?? null),
    items: null, // future-ready; daily-summary has no item-level
    schemaVersion: SCHEMA_VERSION,
  };
}

/** Names of content fields that are absent (null) — useful for diagnostics. */
export function missingFields(content: NormalizedReportContent): string[] {
  const out: string[] = [];
  if (content.revenueTotal === null) out.push("revenueTotal");
  if (content.tickets === null) out.push("tickets");
  if (content.channels.dineIn === null) out.push("channels.dineIn");
  if (content.channels.delivery === null) out.push("channels.delivery");
  if (content.channels.takeaway === null) out.push("channels.takeaway");
  if (content.hourly === null) out.push("hourly");
  if (content.items === null) out.push("items");
  return out;
}

/**
 * Stamp a content object with provenance to produce a full report:
 * deterministic contentHash + a fresh importId + importedAt.
 */
export function finalizeReport(
  content: NormalizedReportContent,
  now: number = Date.now()
): NormalizedSalesReport {
  return {
    ...content,
    importId: makeImportId(),
    contentHash: contentHashFor(content),
    importedAt: now,
  };
}
