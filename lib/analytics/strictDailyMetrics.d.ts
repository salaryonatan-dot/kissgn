// Type declarations for the runtime helper lib/analytics/strictDailyMetrics.js.
// Placed adjacent to the .js so the import
//   import { strictLegacyDailyMetric } from "../../lib/analytics/strictDailyMetrics.js";
// resolves under strict TypeScript WITHOUT allowJs and without broadening the
// tsconfig `include`. Signatures match the real implementation exactly:
// parseFiniteMetric returns `number | undefined`; strictLegacyDailyMetric returns
// `LegacyDailyMetric | null`.

export function parseFiniteMetric(value: unknown): number | undefined;

export interface LegacyDailyMetric {
  revenue: number;
  laborCost: number;
  foodCost: number;
}

export function strictLegacyDailyMetric(revenue: unknown): LegacyDailyMetric | null;
