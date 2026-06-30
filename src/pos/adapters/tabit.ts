/**
 * POS Ingestion Foundation — Tabit adapter PLACEHOLDER (Phase 1, INERT).
 *
 * Stub only. NOT wired to any live API. No network here, no secret imports.
 * NOTE: Tabit's current known integration is labor-only (fetchTabitHours); no
 * sales/item endpoint is known yet — so dailySummary capability is false until
 * the right endpoint is identified (separate diagnosis). Throws a sanitized
 * not_implemented error.
 */

import type {
  NormalizedSalesReport,
  PosCapabilities,
  PosConnector,
  PosFetchContext,
  PosFetchError,
} from "../types.js";

export const TABIT_CAPABILITIES: PosCapabilities = {
  dailySummary: false, // no known Tabit sales endpoint yet
  hourly: false,
  itemSales: false,
  payments: false,
};

export class TabitConnector implements PosConnector {
  readonly sourceSystem = "tabit" as const;
  readonly capabilities = TABIT_CAPABILITIES;

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async fetchDailySummary(
    _businessDate: string,
    _ctx: PosFetchContext
  ): Promise<NormalizedSalesReport> {
    const err: PosFetchError = { source: "tabit", reason: "not_implemented" };
    throw err;
  }
}

export const tabitConnector = new TabitConnector();
