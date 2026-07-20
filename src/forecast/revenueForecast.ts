/**
 * Marjin — Revenue Month-End Forecast Engine (REV_FORECAST/v1).
 *
 * Binding spec: the Marjin Business Formula Bible (REV_FORECAST/v1, CONFIDENCE/v1,
 * exception-day rules, missing/current/future-day semantics). Pure & deterministic:
 * identical inputs (and a fixed `nowMs`) produce identical output. No network/DB/LLM.
 *
 *   monthForecast = Σ actual(eligible completed entered days)
 *                 + Σ forecast(each remaining date)     [current partial day + every future day]
 *   forecast(d)   = average of the last 4 VALID completed same-weekday occurrences (min 3)
 *
 * A remaining weekday with < 3 valid samples is NOT back-filled with a mixed/flat
 * average — it is marked insufficient, lowers completeness/confidence, and is
 * disclosed. If NO weekday has enough history the month figure is suppressed.
 */

export const REV_FORECAST_FORMULA_ID = "REV_FORECAST/v1";
export const CONFIDENCE_FORMULA_ID = "CONFIDENCE/v1";
export const FORECAST_WINDOW = 4; // last N same-weekday samples
export const MIN_SAMPLES = 3; // minimum valid same-weekday samples
export const MAX_CONFIDENCE = 0.95;

export interface ForecastDay {
  date: string; // "YYYY-MM-DD" in the business timezone
  total: number; // revenue.total
  had_entry: boolean;
  has_sales?: boolean; // legacy docs omit this; total>0 then governs
  is_exception?: boolean;
  is_outlier?: boolean;
  stale?: boolean;
}

export interface WeekdayBreakdown {
  weekday: number; // 0=Sun..6=Sat
  calendarOccurrencesInMonth: number;
  actualOccurrences: number;
  futureOrPartialOccurrences: number;
  validHistoricalSamples: number;
  sampleDates: string[];
  sampleValues: number[];
  sampleAverage: number | null;
  forecastContribution: number; // sum over this weekday's remaining dates
  status: "ready" | "insufficient_history";
}

export type ForecastWarning =
  | "missing_completed_days"
  | "insufficient_weekday_history"
  | "partial_current_day"
  | "stale_source_data"
  | "exception_days_excluded"
  | "duplicate_dates";

export interface RevenueForecastResult {
  formulaId: string;
  confidenceFormulaId: string;
  tenantId: string;
  bizId: string;
  targetMonth: string; // "YYYY-MM"
  businessTimezone: string;
  today: string; // business-local "YYYY-MM-DD"
  generatedAt: number;
  actualCompletedRevenue: number;
  partialTodayRevenue: number | null;
  remainingForecastRevenue: number;
  monthEndForecastRevenue: number | null; // null => suppressed (no reliable history)
  completedCalendarDays: number;
  enteredCompletedDays: number;
  missingCompletedDays: number;
  missingCompletedDates: string[];
  remainingDays: number;
  weekdayBreakdown: WeekdayBreakdown[];
  completeness: number; // 0..1
  confidence: number; // 0..MAX_CONFIDENCE
  confidenceBand: "high" | "medium" | "low";
  warnings: ForecastWarning[];
  evidence: string[];
}

// ── Deterministic calendar (no ambiguous UTC parsing) ────────────────────────
/** Day-of-week 0=Sun..6=Sat for a "YYYY-MM-DD" via Sakamoto's algorithm (pure). */
export function dowOf(dateStr: string): number {
  const [y, m, d] = dateStr.split("-").map(Number);
  const t = [0, 3, 2, 5, 0, 3, 5, 1, 4, 6, 2, 4];
  const yy = m < 3 ? y - 1 : y;
  return (yy + Math.floor(yy / 4) - Math.floor(yy / 100) + Math.floor(yy / 400) + t[m - 1] + d) % 7;
}
export function daysInMonth(year: number, month1: number): number {
  return new Date(Date.UTC(year, month1, 0)).getUTCDate(); // month1 is 1..12
}
export function datesInMonth(targetMonth: string): string[] {
  const [y, m] = targetMonth.split("-").map(Number);
  const n = daysInMonth(y, m);
  const out: string[] = [];
  for (let d = 1; d <= n; d++) out.push(`${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`);
  return out;
}
/** Business-local "YYYY-MM-DD" for a wall-clock instant + IANA tz (deterministic). */
export function businessLocalDate(nowMs: number, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(nowMs));
  return parts; // en-CA => YYYY-MM-DD
}

function isValidSample(d: ForecastDay): boolean {
  return (
    !!d &&
    d.had_entry === true &&
    Number.isFinite(d.total) &&
    d.total > 0 &&
    d.has_sales !== false &&
    d.is_exception !== true &&
    d.is_outlier !== true &&
    d.stale !== true
  );
}

/** Mean of the last `FORECAST_WINDOW` valid same-weekday samples strictly before `beforeDate`. */
export function sameWeekdayForecast(
  history: ForecastDay[],
  weekday: number,
  beforeDate: string
): { avg: number | null; n: number; dates: string[]; values: number[] } {
  const samples = history
    .filter((d) => d.date < beforeDate && dowOf(d.date) === weekday && isValidSample(d))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
    .slice(-FORECAST_WINDOW);
  const values = samples.map((d) => d.total);
  const avg = values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
  return { avg, n: values.length, dates: samples.map((d) => d.date), values };
}

export interface ForecastInput {
  tenantId: string;
  bizId: string;
  targetMonth: string; // "YYYY-MM"
  businessTimezone?: string; // default Asia/Jerusalem
  today?: string; // business-local YYYY-MM-DD; if absent derived from nowMs+tz
  nowMs?: number;
  history: ForecastDay[]; // all known days (this month + prior months, any weekday)
}

export function computeRevenueForecast(input: ForecastInput): RevenueForecastResult {
  const tz = input.businessTimezone || "Asia/Jerusalem";
  const nowMs = input.nowMs ?? Date.now();
  const today = input.today ?? businessLocalDate(nowMs, tz);
  const warnings = new Set<ForecastWarning>();
  const evidence: string[] = [];

  // Duplicate-date detection (Formula Bible: do not double-count; do not pick silently).
  const byDate = new Map<string, ForecastDay[]>();
  for (const d of input.history) {
    if (!byDate.has(d.date)) byDate.set(d.date, []);
    byDate.get(d.date)!.push(d);
  }
  const duplicateDates = new Set<string>();
  for (const [date, arr] of byDate) if (arr.length > 1) duplicateDates.add(date);
  if (duplicateDates.size) warnings.add("duplicate_dates");

  // Canonical per-date view: first-by-input-order (deterministic), duplicates flagged
  // and excluded from baselines; each calendar date is counted at most once.
  const dayOf = (date: string): ForecastDay | undefined => byDate.get(date)?.[0];
  const dupClean = (d: ForecastDay | undefined): ForecastDay | undefined =>
    d && duplicateDates.has(d.date) ? undefined : d;
  const baselineHistory = input.history.filter((d) => !duplicateDates.has(d.date));

  const dates = datesInMonth(input.targetMonth);
  const weekdayMap = new Map<number, WeekdayBreakdown>();
  const ensureWk = (wd: number): WeekdayBreakdown => {
    if (!weekdayMap.has(wd))
      weekdayMap.set(wd, {
        weekday: wd,
        calendarOccurrencesInMonth: 0,
        actualOccurrences: 0,
        futureOrPartialOccurrences: 0,
        validHistoricalSamples: 0,
        sampleDates: [],
        sampleValues: [],
        sampleAverage: null,
        forecastContribution: 0,
        status: "insufficient_history",
      });
    return weekdayMap.get(wd)!;
  };

  let actualCompletedRevenue = 0;
  let enteredCompletedDays = 0;
  let completedCalendarDays = 0;
  const missingCompletedDates: string[] = [];
  let remainingForecastRevenue = 0;
  let remainingDays = 0;
  let partialTodayRevenue: number | null = null;
  let anyExceptionExcluded = false;

  for (const date of dates) {
    const wd = dowOf(date);
    const wk = ensureWk(wd);
    wk.calendarOccurrencesInMonth++;

    if (date < today) {
      // completed calendar day
      completedCalendarDays++;
      const entry = dupClean(dayOf(date));
      if (entry && entry.had_entry === true) {
        enteredCompletedDays++;
        wk.actualOccurrences++;
        actualCompletedRevenue += Number.isFinite(entry.total) ? entry.total : 0; // exception days INCLUDED in actual
        if (entry.is_exception === true) anyExceptionExcluded = true; // it's in actual but out of baseline
        if (entry.stale === true) warnings.add("stale_source_data");
      } else {
        missingCompletedDates.push(date); // missing != zero
      }
    } else {
      // remaining: current partial day (date===today) or future day
      remainingDays++;
      wk.futureOrPartialOccurrences++;
      if (date === today) {
        warnings.add("partial_current_day");
        const t = dupClean(dayOf(date));
        partialTodayRevenue = t && t.had_entry === true && Number.isFinite(t.total) ? t.total : null;
      }
      const s = sameWeekdayForecast(baselineHistory, wd, date);
      if (s.n >= MIN_SAMPLES && s.avg !== null) {
        wk.status = "ready";
        wk.validHistoricalSamples = s.n;
        wk.sampleDates = s.dates;
        wk.sampleValues = s.values;
        wk.sampleAverage = s.avg;
        wk.forecastContribution += s.avg;
        remainingForecastRevenue += s.avg;
      } else {
        // insufficient — do not fabricate; contribute nothing, disclose
        wk.validHistoricalSamples = s.n;
        wk.sampleDates = s.dates;
        wk.sampleValues = s.values;
        warnings.add("insufficient_weekday_history");
      }
    }
  }

  const missingCompletedDays = missingCompletedDates.length;
  if (missingCompletedDays > 0) warnings.add("missing_completed_days");
  if (anyExceptionExcluded) warnings.add("exception_days_excluded");

  // Suppress the month number if NO remaining weekday reached sufficiency.
  const remainingWeekdays = [...weekdayMap.values()].filter((w) => w.futureOrPartialOccurrences > 0);
  const anyReady = remainingWeekdays.some((w) => w.status === "ready");
  const allInsufficient = remainingWeekdays.length > 0 && !anyReady;
  const monthEndForecastRevenue = allInsufficient
    ? null
    : round0(actualCompletedRevenue + remainingForecastRevenue);

  // Completeness = entered/completed calendar days, weighted by weekday sufficiency.
  const dataCompleteness = completedCalendarDays > 0 ? enteredCompletedDays / completedCalendarDays : 1;
  const sufficientWk = remainingWeekdays.filter((w) => w.status === "ready").length;
  const weekdayCompleteness = remainingWeekdays.length > 0 ? sufficientWk / remainingWeekdays.length : 1;
  const completeness = round4(Math.min(dataCompleteness, weekdayCompleteness));

  // CONFIDENCE/v1: clamp(0.30 + 0.05*n_effective, 0.30, 0.95) * completeness_factor.
  const readySamples = remainingWeekdays.filter((w) => w.status === "ready").map((w) => w.validHistoricalSamples);
  const nEffective = readySamples.length ? Math.min(...readySamples) : 0;
  const base = Math.min(MAX_CONFIDENCE, Math.max(0.3, 0.3 + 0.05 * nEffective));
  const confidence = allInsufficient ? 0 : round4(Math.min(MAX_CONFIDENCE, base * completeness));
  const confidenceBand: "high" | "medium" | "low" =
    confidence >= 0.75 ? "high" : confidence >= 0.5 ? "medium" : "low";

  for (const w of weekdayMap.values()) {
    if (w.sampleAverage !== null)
      evidence.push(
        `יום ${w.weekday}: ממוצע ${round0(w.sampleAverage)} מתוך ${w.validHistoricalSamples} דגימות (${w.sampleDates.join(", ")})`
      );
  }
  if (missingCompletedDays > 0) evidence.push(`ימים שהסתיימו וטרם הוזנו: ${missingCompletedDates.join(", ")}`);

  return {
    formulaId: REV_FORECAST_FORMULA_ID,
    confidenceFormulaId: CONFIDENCE_FORMULA_ID,
    tenantId: input.tenantId,
    bizId: input.bizId,
    targetMonth: input.targetMonth,
    businessTimezone: tz,
    today,
    generatedAt: nowMs,
    actualCompletedRevenue: round0(actualCompletedRevenue),
    partialTodayRevenue: partialTodayRevenue === null ? null : round0(partialTodayRevenue),
    remainingForecastRevenue: round0(remainingForecastRevenue),
    monthEndForecastRevenue,
    completedCalendarDays,
    enteredCompletedDays,
    missingCompletedDays,
    missingCompletedDates,
    remainingDays,
    weekdayBreakdown: [...weekdayMap.values()].sort((a, b) => a.weekday - b.weekday),
    completeness,
    confidence,
    confidenceBand,
    warnings: [...warnings],
    evidence,
  };
}

function round0(n: number): number {
  return Math.round(n);
}
function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

// ── Presenter: exact Hebrew card model the dashboard binds to ────────────────
const ILS = (n: number) => "₪" + Math.round(n).toLocaleString("en-US");
const BAND_HE: Record<string, string> = { high: "גבוה", medium: "בינוני", low: "נמוך" };

export function buildForecastCardModel(r: RevenueForecastResult): {
  title: string;
  actualLine: string;
  remainingLine: string;
  monthEndLine: string;
  completenessLine: string;
  confidenceLine: string;
  missingWarning: string | null;
  partialNote: string | null;
  suppressed: boolean;
} {
  const suppressed = r.monthEndForecastRevenue === null;
  return {
    title: "תחזית מחזור לסוף החודש",
    actualLine: `בפועל מימים שהושלמו: ${ILS(r.actualCompletedRevenue)}`,
    remainingLine: `תחזית לימים שנותרו: ${ILS(r.remainingForecastRevenue)}`,
    monthEndLine: suppressed
      ? "אין מספיק היסטוריה לתחזית אמינה"
      : `תחזית סוף חודש: ${ILS(r.monthEndForecastRevenue as number)}`,
    completenessLine: `שלמות נתונים: ${r.enteredCompletedDays} מתוך ${r.completedCalendarDays} ימים שהסתיימו`,
    confidenceLine: `ביטחון: ${BAND_HE[r.confidenceBand]}`,
    missingWarning:
      r.missingCompletedDays > 0
        ? `התחזית מבוססת על נתונים חלקיים — ${r.missingCompletedDays} ימים טרם הוזנו`
        : null,
    partialNote:
      r.partialTodayRevenue !== null
        ? `היום טרם הסתיים: ${ILS(r.partialTodayRevenue)} עד כה; בתחזית החודש חושב לפי ממוצע יום השבוע`
        : null,
    suppressed,
  };
}
