/**
 * POS Ingestion Foundation — shared types (Phase 1, INERT).
 *
 * Pure type definitions. No runtime, no network, no DB, no secrets.
 * Imported by nothing in production until activation. Defines the uniform
 * internal contract every POS connector (Beecomm, Tabit, …) maps onto, so a
 * new POS can be plugged in without re-architecting the pipeline.
 */

export type SourceSystem = "beecomm" | "tabit";

export type ReportType = "daily_summary" | "item_sales";

/** What a given connector/source can provide. Checked before optional calls. */
export interface PosCapabilities {
  dailySummary: boolean;
  hourly: boolean;
  itemSales: boolean;
  payments: boolean;
}

/**
 * Per-call context. `apiKey` is resolved SERVER-SIDE from env (by a config's
 * credentialRef) and passed in at call time — it is never stored in config,
 * RTDB, or the frontend.
 */
export interface PosFetchContext {
  tenantId: string;
  businessId: string;
  externalBranchId?: string;
  apiKey: string;
}

/** One normalized item-sales row (future-ready; unused until item-level). */
export interface NormalizedSalesItem {
  sku: string | null;
  name: string;
  qty: number;
  revenue: number;
}

/** Content fields of a normalized report — everything except the run-stamped, volatile fields. */
export interface NormalizedReportContent {
  // identity / keying
  businessId: string;
  tenantId: string;
  businessDate: string; // "YYYY-MM-DD" (Asia/Jerusalem business day)
  sourceSystem: SourceSystem;
  reportType: ReportType;
  // core sales
  revenueTotal: number | null;
  tickets: number | null;
  avgCheck: number | null; // computed = revenueTotal / tickets
  channels: {
    dineIn: number | null;
    delivery: number | null;
    takeaway: number | null;
  };
  hourly: Record<string, number> | null;
  items: NormalizedSalesItem[] | null; // future-ready; null until item-level
  schemaVersion: string;
}

/** A full normalized report = content + provenance stamps. */
export interface NormalizedSalesReport extends NormalizedReportContent {
  importId: string; // per run (uuid-ish) — volatile, excluded from contentHash
  contentHash: string; // stable hash of NormalizedReportContent
  importedAt: number; // epoch ms — volatile, excluded from contentHash
}

/** Audit record for one import attempt. Never contains raw payload or secrets. */
export interface PosImportLog {
  importId: string;
  bizId: string;
  tenantId: string;
  businessDate: string;
  sourceSystem: SourceSystem;
  reportType: ReportType;
  status: "success" | "partial" | "failed" | "deduped";
  rowsIn: number;
  rowsOut: number;
  contentHash: string;
  durationMs: number; // volatile
  error: string | null; // summary only: "http_401" | "timeout" | "network" | ...
  createdAt: number;
}

/** Non-secret per-business POS configuration. `credentialRef` is an env var NAME, never a value. */
export interface PosConfig {
  sourceSystem: SourceSystem;
  externalBranchId: string;
  credentialRef: string; // e.g. "BEECOMM_KEY_KISS_GN" — NOT the secret itself
  capabilities: PosCapabilities;
  enabled: boolean;
}

/** Sanitized error thrown by connectors. No payload, no secret. */
export interface PosFetchError {
  source: SourceSystem;
  reason: string; // "timeout" | "network" | "http_401" | "not_implemented" | ...
}

/** Uniform connector contract. Business logic calls only this — never a POS API directly. */
export interface PosConnector {
  sourceSystem: SourceSystem;
  capabilities: PosCapabilities;
  /** Fetch + normalize one day's summary. Throws PosFetchError on failure. */
  fetchDailySummary(
    businessDate: string,
    ctx: PosFetchContext
  ): Promise<NormalizedSalesReport>;
  /** Future, capability-guarded. Optional. */
  fetchItemSales?(
    businessDate: string,
    ctx: PosFetchContext
  ): Promise<NormalizedSalesItem[]>;
}
