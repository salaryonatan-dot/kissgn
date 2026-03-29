export function isDefined<T>(val: T | undefined | null): val is T {
  return val !== undefined && val !== null;
}

export function isNonEmptyArray<T>(arr: T[] | undefined | null): arr is T[] {
  return Array.isArray(arr) && arr.length > 0;
}

export function isPositiveNumber(val: unknown): val is number {
  return typeof val === "number" && val > 0 && isFinite(val);
}

export function hasMinSample(count: number, required = 3): boolean {
  return count >= required;
}

export function isWithinDays(dateIso: string, maxDays: number): boolean {
  const now = Date.now();
  const then = new Date(dateIso + "T00:00:00").getTime();
  return (now - then) / 86_400_000 <= maxDays;
}
