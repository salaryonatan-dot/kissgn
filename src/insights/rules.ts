/**
 * Insight Engine v1 — deterministic rules (Phase 1, INERT).
 *
 * Pure functions. No network/DB/LLM. Each rule:
 *  - enforces a minimum-sample guard,
 *  - returns null when there is not enough data (never invents an insight),
 *  - includes numeric evidence,
 *  - sets a deterministic confidence from sample size,
 *  - sets severity from clear thresholds.
 * Only analytics:daily fields are used. No hourly/item/checklist/POS.
 */

import type { AnalyticsDailyInput, Insight, InsightSeverity } from "./types.js";
import {
  condRevenueAvg,
  confidenceForSamples,
  deltaPct,
  round,
  sameWeekdayAvg,
  sameWeekdayRecentAvg,
  trailingRatioAvg,
} from "./baselines.js";

// ── Tunable thresholds (documented; deterministic) ───────────────────────────
export const THRESHOLDS = {
  MIN_TREND_SAMPLES: 3, // min valid days for a trailing-average rule
  MIN_WEEKDAY_SAMPLES: 3, // min same-weekday valid days
  MIN_CONTEXT_SAMPLES: 5, // min baseline days for weather/alert/war/ratio rules
  SAMEDOW_WINDOW: 4, // P0: compare a day only to its last N same-weekday days
  MIN_SAMEDOW_SAMPLES: 3, // P0: need >=3 valid same-weekday samples, else suppress
  DROP_WARN: -0.15,
  DROP_CRIT: -0.3,
  SPIKE_FIRE: 0.2,
  WEEKDAY_WARN: -0.15,
  WEEKDAY_CRIT: -0.3,
  CONTEXT_FIRE: -0.1, // revenue this-context vs baseline to flag impact
  WEATHER_FIRE_ABS: 0.12,
  RATIO_GAP_WARN: 0.03, // +3 percentage points over baseline ratio
  RATIO_GAP_CRIT: 0.06, // +6 pp
};

const ILS = (n: number) => "₪" + Math.round(n).toLocaleString("en-US");
const PCT = (frac: number) => (frac >= 0 ? "+" : "") + Math.round(frac * 100) + "%";
const PP = (frac: number) => (frac * 100).toFixed(1) + "%"; // percentage-point value
const DOW_HE = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];
const dowName = (dow: number): string => DOW_HE[dow] ?? String(dow);

function idFor(t: AnalyticsDailyInput, type: string): string {
  return `${t.bizId}_${t.date}_${type}`;
}

function base(
  t: AnalyticsDailyInput,
  type: Insight["type"],
  now: number
): Pick<Insight, "id" | "date" | "bizId" | "type" | "source" | "createdAt"> {
  return { id: idFor(t, type), date: t.date, bizId: t.bizId, type, source: "analytics:daily", createdAt: now };
}

// ── Shared revenue-target eligibility (P0 hardening) ─────────────────────────
// A revenue anomaly (spike OR drop) may only be evaluated for a TARGET day that
// is itself a valid, completed, real-selling day. This guards the target day
// directly (not just the baseline): a supplier-only day (had_entry=true,
// total=0, has_sales=false) must never yield a drop / -100% / any anomaly.
// Legacy docs without `has_sales` remain eligible on total>0 (Formula Bible §2).
// Exception / outlier / stale days are excluded where such metadata is present.
function isValidRevenueTarget(t: AnalyticsDailyInput): boolean {
  if (!t.revenue?.had_entry || !t.calendar) return false;
  if (!(t.revenue.total > 0)) return false; // real selling day only (excludes total<=0 supplier-only)
  if ((t.revenue as { has_sales?: boolean }).has_sales === false) return false;
  const meta = t as {
    is_exception?: boolean;
    exception?: boolean;
    is_outlier?: boolean;
    outlier?: boolean;
    stale?: boolean;
  };
  if (meta.is_exception === true || meta.exception === true) return false;
  if (meta.is_outlier === true || meta.outlier === true) return false;
  if (meta.stale === true) return false;
  return true;
}

// ── 1. revenue_drop ──────────────────────────────────────────────────────────
export function ruleRevenueDrop(t: AnalyticsDailyInput, history: AnalyticsDailyInput[], now: number): Insight | null {
  // P0: compare only against the last few VALID same-weekday days (never a
  // generic trailing mix and never stale total<=0 days). If there are fewer
  // than MIN_SAMEDOW_SAMPLES, suppress — do not fall back to a generic average.
  // Target must itself be a valid real-selling day (guards supplier-only/exception
  // days from producing a false -100% drop).
  if (!isValidRevenueTarget(t) || !t.calendar) return null;
  const sw = sameWeekdayRecentAvg(history, t.calendar.dow, THRESHOLDS.SAMEDOW_WINDOW);
  if (sw.n < THRESHOLDS.MIN_SAMEDOW_SAMPLES || sw.avg === null) return null;
  const d = deltaPct(t.revenue.total, sw.avg);
  if (d === null || d > THRESHOLDS.DROP_WARN) return null; // not a drop
  const severity: InsightSeverity = d <= THRESHOLDS.DROP_CRIT ? "critical" : "warning";
  const dname = dowName(t.calendar.dow);
  return {
    ...base(t, "revenue_drop", now),
    severity,
    title: `ירידה במחזור (${PCT(d)})`,
    summary: `המחזור נמוך מהממוצע של ימי ${dname} האחרונים.`,
    // evidence[0] MUST be the numeric revenue summary (the dashboard shows only
    // evidence[0]); the audit details follow it and are preserved.
    evidence: [
      `מחזור: ${ILS(t.revenue.total)}`,
      `תאריך יעד: ${t.date}`,
      `ממוצע בסיס (ימי ${dname}): ${ILS(sw.avg)}`,
      `מספר דגימות: ${sw.n}`,
      `יום בשבוע: ${dname}`,
      `שינוי: ${PCT(d)}`,
    ],
    recommendation: "בדוק גורמים אפשריים (מזג אוויר, אירוע, תמחור, איוש).",
    metric: "revenue_total",
    currentValue: round(t.revenue.total, 0),
    baselineValue: round(sw.avg, 0),
    deltaPct: d,
    confidence: confidenceForSamples(sw.n),
  };
}

// ── 2. revenue_spike ─────────────────────────────────────────────────────────
export function ruleRevenueSpike(t: AnalyticsDailyInput, history: AnalyticsDailyInput[], now: number): Insight | null {
  // P0: a positive spike may only fire on a real selling day (total>0) and only
  // against the last few VALID same-weekday days. This prevents the previous
  // false surges (e.g. +76%/+340%) that came from a baseline dragged toward zero
  // by stale total=0 analytics days. No generic fallback: too few samples => no
  // insight.
  if (!isValidRevenueTarget(t) || !t.calendar) return null;
  const sw = sameWeekdayRecentAvg(history, t.calendar.dow, THRESHOLDS.SAMEDOW_WINDOW);
  if (sw.n < THRESHOLDS.MIN_SAMEDOW_SAMPLES || sw.avg === null) return null;
  const d = deltaPct(t.revenue.total, sw.avg);
  if (d === null || d < THRESHOLDS.SPIKE_FIRE) return null;
  const dname = dowName(t.calendar.dow);
  return {
    ...base(t, "revenue_spike", now),
    severity: "positive",
    title: `זינוק במחזור (${PCT(d)})`,
    summary: `המחזור גבוה מהממוצע של ימי ${dname} האחרונים.`,
    // evidence[0] MUST be the numeric revenue summary (dashboard shows only [0]).
    evidence: [
      `מחזור: ${ILS(t.revenue.total)}`,
      `תאריך יעד: ${t.date}`,
      `ממוצע בסיס (ימי ${dname}): ${ILS(sw.avg)}`,
      `מספר דגימות: ${sw.n}`,
      `יום בשבוע: ${dname}`,
      `שינוי: ${PCT(d)}`,
    ],
    recommendation: "זהה מה עבד (יום/מבצע/אירוע) לשחזור.",
    metric: "revenue_total",
    currentValue: round(t.revenue.total, 0),
    baselineValue: round(sw.avg, 0),
    deltaPct: d,
    confidence: confidenceForSamples(sw.n),
  };
}

// ── 3. weak_weekday ──────────────────────────────────────────────────────────
export function ruleWeakWeekday(t: AnalyticsDailyInput, history: AnalyticsDailyInput[], now: number): Insight | null {
  if (!t.revenue?.had_entry || !t.calendar) return null;
  const sw = sameWeekdayAvg(history, t.calendar.dow);
  if (sw.n < THRESHOLDS.MIN_WEEKDAY_SAMPLES || sw.avg === null) return null;
  const d = deltaPct(t.revenue.total, sw.avg);
  if (d === null || d > THRESHOLDS.WEEKDAY_WARN) return null;
  const severity: InsightSeverity = d <= THRESHOLDS.WEEKDAY_CRIT ? "critical" : "warning";
  const DOW = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];
  const dname = DOW[t.calendar.dow] ?? String(t.calendar.dow);
  return {
    ...base(t, "weak_weekday", now),
    severity,
    title: `יום ${dname} חלש (${PCT(d)})`,
    summary: `המחזור נמוך מהממוצע ההיסטורי של ימי ${dname}.`,
    evidence: [`מחזור: ${ILS(t.revenue.total)}`, `ממוצע ימי ${dname}: ${ILS(sw.avg)}`, `שינוי: ${PCT(d)} (n=${sw.n})`],
    recommendation: `בדוק דפוס חוזר בימי ${dname}.`,
    metric: "revenue_total",
    currentValue: round(t.revenue.total, 0),
    baselineValue: round(sw.avg, 0),
    deltaPct: d,
    confidence: confidenceForSamples(sw.n),
  };
}

// ── 4. weather_impact ────────────────────────────────────────────────────────
export function ruleWeatherImpact(t: AnalyticsDailyInput, history: AnalyticsDailyInput[], now: number): Insight | null {
  if (!t.revenue?.had_entry || !t.weather || t.weather.is_rain_day !== true) return null;
  const dry = condRevenueAvg(history, (d) => d.weather?.is_rain_day === false);
  if (dry.n < THRESHOLDS.MIN_CONTEXT_SAMPLES || dry.avg === null) return null;
  const d = deltaPct(t.revenue.total, dry.avg);
  if (d === null || Math.abs(d) < THRESHOLDS.WEATHER_FIRE_ABS) return null;
  const severity: InsightSeverity = d < 0 ? (d <= THRESHOLDS.DROP_CRIT ? "warning" : "info") : "info";
  const mm = t.weather.rain_mm ?? null;
  return {
    ...base(t, "weather_impact", now),
    severity,
    title: `השפעת גשם (${PCT(d)})`,
    summary: `יום גשום — המחזור שונה מיום יבש טיפוסי.`,
    evidence: [
      `מחזור: ${ILS(t.revenue.total)}`,
      `ממוצע ימים יבשים: ${ILS(dry.avg)}`,
      mm !== null ? `גשם: ${mm} מ״מ` : `יום גשום`,
      `שינוי: ${PCT(d)} (n=${dry.n})`,
    ],
    recommendation: null,
    metric: "revenue_total",
    currentValue: round(t.revenue.total, 0),
    baselineValue: round(dry.avg, 0),
    deltaPct: d,
    confidence: confidenceForSamples(dry.n),
  };
}

// ── 5. alert_impact ──────────────────────────────────────────────────────────
export function ruleAlertImpact(t: AnalyticsDailyInput, history: AnalyticsDailyInput[], now: number): Insight | null {
  if (!t.revenue?.had_entry || !t.alerts) return null;
  const isAlert = t.alerts.is_alert_day === true || (t.alerts.alert_minutes || 0) > 0;
  if (!isAlert) return null;
  const calm = condRevenueAvg(history, (d) => !!d.alerts && d.alerts.is_alert_day === false);
  if (calm.n < THRESHOLDS.MIN_CONTEXT_SAMPLES || calm.avg === null) return null;
  const d = deltaPct(t.revenue.total, calm.avg);
  if (d === null || d > THRESHOLDS.CONTEXT_FIRE) return null;
  const severity: InsightSeverity = d <= THRESHOLDS.DROP_CRIT ? "critical" : "warning";
  return {
    ...base(t, "alert_impact", now),
    severity,
    title: `השפעת אזעקות (${PCT(d)})`,
    summary: `יום עם אזעקות — מחזור נמוך מיום רגיל.`,
    evidence: [
      `מחזור: ${ILS(t.revenue.total)}`,
      `ממוצע ימים רגילים: ${ILS(calm.avg)}`,
      `אזעקות: ${t.alerts.alert_count} · ${t.alerts.alert_minutes} דק׳`,
      `שינוי: ${PCT(d)} (n=${calm.n})`,
    ],
    recommendation: null,
    metric: "revenue_total",
    currentValue: round(t.revenue.total, 0),
    baselineValue: round(calm.avg, 0),
    deltaPct: d,
    confidence: confidenceForSamples(calm.n),
  };
}

// ── 6. war_day_impact ────────────────────────────────────────────────────────
export function ruleWarDayImpact(t: AnalyticsDailyInput, history: AnalyticsDailyInput[], now: number): Insight | null {
  if (!t.revenue?.had_entry || !t.operational) return null;
  const wd = t.operational.war_day;
  if (wd !== "partial" && wd !== "full") return null;
  const regular = condRevenueAvg(history, (d) => d.operational?.war_day === "regular");
  if (regular.n < THRESHOLDS.MIN_CONTEXT_SAMPLES || regular.avg === null) return null;
  const d = deltaPct(t.revenue.total, regular.avg);
  if (d === null || d > THRESHOLDS.CONTEXT_FIRE) return null;
  const severity: InsightSeverity = wd === "full" ? "critical" : d <= THRESHOLDS.DROP_CRIT ? "critical" : "warning";
  return {
    ...base(t, "war_day_impact", now),
    severity,
    title: `יום מלחמה (${wd === "full" ? "סגור" : "חלקי"})`,
    summary: `יום מבצע/מלחמה — מחזור נמוך מיום רגיל.`,
    evidence: [`מחזור: ${ILS(t.revenue.total)}`, `ממוצע ימים רגילים: ${ILS(regular.avg)}`, `שינוי: ${PCT(d)} (n=${regular.n})`],
    recommendation: null,
    metric: "revenue_total",
    currentValue: round(t.revenue.total, 0),
    baselineValue: round(regular.avg, 0),
    deltaPct: d,
    confidence: confidenceForSamples(regular.n),
  };
}

// ── 7. labor_risk (payroll / revenue) ────────────────────────────────────────
export function ruleLaborRisk(t: AnalyticsDailyInput, history: AnalyticsDailyInput[], now: number): Insight | null {
  if (!t.revenue?.had_entry || !(t.revenue.total > 0)) return null;
  const b = trailingRatioAvg(history, (d) => d.revenue.payroll, 30);
  if (b.n < THRESHOLDS.MIN_CONTEXT_SAMPLES || b.avg === null) return null;
  const cur = t.revenue.payroll / t.revenue.total;
  const gap = cur - b.avg;
  if (gap < THRESHOLDS.RATIO_GAP_WARN) return null;
  const severity: InsightSeverity = gap >= THRESHOLDS.RATIO_GAP_CRIT ? "critical" : "warning";
  return {
    ...base(t, "labor_risk", now),
    severity,
    title: `עלות שכר גבוהה (${PP(cur)})`,
    summary: `אחוז השכר מהמחזור גבוה מהממוצע האחרון.`,
    evidence: [`שכר/מחזור: ${PP(cur)}`, `ממוצע: ${PP(b.avg)}`, `פער: +${PP(gap)} (n=${b.n})`],
    recommendation: "בדוק איוש מול מחזור באותו יום.",
    metric: "labor_pct",
    currentValue: round(cur, 4),
    baselineValue: round(b.avg, 4),
    deltaPct: round(gap, 4),
    confidence: confidenceForSamples(b.n),
  };
}

// ── 8. supplier_spend_risk (food_cost / revenue) ─────────────────────────────
export function ruleSupplierSpendRisk(t: AnalyticsDailyInput, history: AnalyticsDailyInput[], now: number): Insight | null {
  // P0: SUPPRESSED. A single day's supplier payments divided by that day's
  // revenue is NOT Food Cost. Supplier payments are lumpy purchases (a whole
  // delivery paid on one day), not same-day COGS, so this ratio swung 4%..103%
  // and produced false "high supplier cost" criticals (e.g. 60.0% on 2026-07-10).
  //
  // True Food Cost requires inventory accounting:
  //   food_cost = opening_inventory + purchases - closing_inventory
  // A future, correctly-labeled "purchases / revenue" insight must aggregate
  // over a PERIOD (e.g. trailing month) and be labeled as "purchases", not
  // "Food Cost". Until then this rule emits nothing. The underlying
  // revenue.food_cost analytics field is intentionally left intact for
  // compatibility and for that future period insight.
  return null;
}

/** All v1 rules, in a stable order (used as a deterministic tie-breaker). */
export const ALL_RULES = [
  ruleRevenueDrop,
  ruleRevenueSpike,
  ruleWeakWeekday,
  ruleWeatherImpact,
  ruleAlertImpact,
  ruleWarDayImpact,
  ruleLaborRisk,
  ruleSupplierSpendRisk,
];
