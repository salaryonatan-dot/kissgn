// Validation constants and rules

export const MIN_DAYS_FOR_BASELINE = 14;
export const MIN_DAYS_FOR_TREND = 21;
export const MIN_DAYS_FOR_FORECAST = 14;
export const MAX_STALE_HOURS = 26; // allow for timezone + processing delay
export const MIN_RECORDS_FOR_ANOMALY = 7;
export const MIN_SAMPLE_FOR_WEEKLY_BASELINE = 4; // at least 4 occurrences of same day

export function isDataFreshEnough(lastUpdateIso: string, maxHours = MAX_STALE_HOURS): boolean {
  const now = Date.now();
  const last = new Date(lastUpdateIso).getTime();
  return (now - last) / 3_600_000 <= maxHours;
}

export function hasEnoughDaysForBaseline(dayCount: number): boolean {
  return dayCount >= MIN_DAYS_FOR_BASELINE;
}

export function hasEnoughDaysForTrend(dayCount: number): boolean {
  return dayCount >= MIN_DAYS_FOR_TREND;
}
