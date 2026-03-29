export function todayIso(tz = "Asia/Jerusalem"): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: tz });
}

export function daysAgoIso(days: number, tz = "Asia/Jerusalem"): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toLocaleDateString("en-CA", { timeZone: tz });
}

export function startOfMonthIso(tz = "Asia/Jerusalem"): string {
  // Extract year/month in the target timezone to avoid UTC boundary bugs
  const nowInTz = new Date().toLocaleDateString("en-CA", { timeZone: tz });
  const [y, m] = nowInTz.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-CA", { timeZone: tz });
}

export function dayOfWeek(dateIso: string): number {
  return new Date(dateIso + "T12:00:00").getDay();
}

export function daysBetween(a: string, b: string): number {
  const msPerDay = 86_400_000;
  const da = new Date(a + "T00:00:00").getTime();
  const db = new Date(b + "T00:00:00").getTime();
  return Math.round(Math.abs(db - da) / msPerDay);
}

export function dateRange(start: string, end: string): string[] {
  const result: string[] = [];
  const d = new Date(start + "T12:00:00");
  const endD = new Date(end + "T12:00:00");
  while (d <= endD) {
    result.push(d.toISOString().slice(0, 10));
    d.setDate(d.getDate() + 1);
  }
  return result;
}

export function isoToHebDay(dateIso: string): string {
  const days = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];
  return days[dayOfWeek(dateIso)];
}

/**
 * Convert a JS day-of-week number (0=Sunday..6=Saturday) to Hebrew day name.
 * Use this instead of constructing fake ISO dates from dow numbers.
 */
export function dowToHebDay(dow: number): string {
  const days = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];
  return days[dow] ?? "לא ידוע";
}
