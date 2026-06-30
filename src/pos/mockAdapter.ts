/**
 * POS Ingestion Foundation — MOCK adapter (Phase 1, INERT, OFFLINE).
 *
 * Implements PosConnector against a fixed local fixture — NO network, NO
 * secrets, NO DB. Used to validate normalize/hash/dedup offline, before any
 * real Beecomm/Tabit API exists. `ctx` is accepted but ignored (no apiKey use).
 */

import type {
  NormalizedSalesReport,
  PosCapabilities,
  PosConnector,
  PosFetchContext,
} from "./types.js";
import { finalizeReport, normalizeBeecommDaily } from "./normalize.js";
import type { BeecommDailyRaw } from "./normalize.js";
import sampleDaily from "./__fixtures__/beecommDailySummary.sample.json";

export const MOCK_CAPABILITIES: PosCapabilities = {
  dailySummary: true,
  hourly: true,
  itemSales: false,
  payments: false,
};

/**
 * Offline connector. Returns a normalized report built from the bundled
 * fixture, shaped exactly like the real Beecomm path will be.
 */
export class MockPosConnector implements PosConnector {
  readonly sourceSystem = "beecomm" as const;
  readonly capabilities = MOCK_CAPABILITIES;

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async fetchDailySummary(
    businessDate: string,
    ctx: PosFetchContext
  ): Promise<NormalizedSalesReport> {
    const raw = sampleDaily as BeecommDailyRaw;
    const content = normalizeBeecommDaily(
      raw,
      { tenantId: ctx.tenantId, businessId: ctx.businessId },
      businessDate
    );
    return finalizeReport(content);
  }
}

/** Convenience singleton. */
export const mockPosConnector = new MockPosConnector();
