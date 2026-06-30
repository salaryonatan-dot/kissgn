/**
 * POS Ingestion Foundation — Beecomm adapter PLACEHOLDER (Phase 1, INERT).
 *
 * Stub only. NOT wired to any live API. No network here, no secret imports.
 * When activated (separate approval), fetchDailySummary will: resolve the key
 * server-side from ctx.apiKey, call the Beecomm daily-summary endpoint, then
 * run the raw payload through normalizeBeecommDaily + finalizeReport.
 * Until then it throws a sanitized not_implemented error.
 */

import type {
  NormalizedSalesReport,
  PosCapabilities,
  PosConnector,
  PosFetchContext,
  PosFetchError,
} from "../types.js";

export const BEECOMM_CAPABILITIES: PosCapabilities = {
  dailySummary: true,
  hourly: true,
  itemSales: false, // daily-summary has no item-level; revisit when an items endpoint exists
  payments: false,
};

export class BeecommConnector implements PosConnector {
  readonly sourceSystem = "beecomm" as const;
  readonly capabilities = BEECOMM_CAPABILITIES;

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async fetchDailySummary(
    _businessDate: string,
    _ctx: PosFetchContext
  ): Promise<NormalizedSalesReport> {
    const err: PosFetchError = { source: "beecomm", reason: "not_implemented" };
    throw err;
  }
}

export const beecommConnector = new BeecommConnector();
