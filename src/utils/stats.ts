import { avg, stdDev } from "./math.js";

export interface ZScoreResult {
  zScore: number;
  isAnomaly: boolean;
  direction: "high" | "low" | "normal";
}

export function zScore(value: number, values: number[], threshold = 2.0): ZScoreResult {
  const mean = avg(values);
  const sd = stdDev(values);
  if (sd === 0) {
    return { zScore: 0, isAnomaly: value !== mean, direction: value > mean ? "high" : value < mean ? "low" : "normal" };
  }
  const z = (value - mean) / sd;
  return {
    zScore: z,
    isAnomaly: Math.abs(z) > threshold,
    direction: z > threshold ? "high" : z < -threshold ? "low" : "normal",
  };
}

export function iqrOutlier(value: number, values: number[], factor = 1.5): boolean {
  const sorted = [...values].sort((a, b) => a - b);
  const q1 = sorted[Math.floor(sorted.length * 0.25)];
  const q3 = sorted[Math.floor(sorted.length * 0.75)];
  const iqr = q3 - q1;
  return value < q1 - factor * iqr || value > q3 + factor * iqr;
}

export function trendDirection(values: number[]): "rising" | "falling" | "flat" {
  if (values.length < 3) return "flat";
  const firstHalf = values.slice(0, Math.floor(values.length / 2));
  const secondHalf = values.slice(Math.floor(values.length / 2));
  const avgFirst = avg(firstHalf);
  const avgSecond = avg(secondHalf);
  const changePct = avgFirst === 0 ? 0 : ((avgSecond - avgFirst) / avgFirst) * 100;
  if (changePct > 5) return "rising";
  if (changePct < -5) return "falling";
  return "flat";
}
