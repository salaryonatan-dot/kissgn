/**
 * Daily research-data builder.
 *
 * For each active business, captures a per-day "feature doc" that combines:
 * - Revenue (from manual entries in Firebase, NOT a POS API)
 * - Weather (Open-Meteo, no API key — using business's lat/lon)
 * - Oref alerts (count + minutes — filtered by business's areas)
 * - Calendar (holiday / holiday-eve / weekend, computed via @hebcal/core)
 * - Operational classification (auto: war_day = "no" | "partial" | "full")
 *
 * The intent is research, not real-time alerting: building a multi-month
 * dataset so future ML can find correlations like "rain → +12% delivery"
 * or "alert day → -30% sit-down" without us hand-crafting heuristics.
 *
 * Soft-fails on optional upstreams: if Open-Meteo is down, weather is null.
 * Hard-fails only if Firebase is unreachable (so the cron loops correctly).
 *
 * 2026-05 update:
 * - Replaced hard-coded IL_HOLIDAYS table with @hebcal/core lookup so we
 *   don't have to re-edit this file every year.
 * - Weather fields now return null on missing data instead of 0 (0°C is
 *   a valid temperature, so the previous behavior was silently lying).
 * - Magic numbers promoted to named constants.
 * - alert_minutes heuristic refined to collapse alerts within a 30-min
 *   window into one disruption.
 * - yesterdayInIsrael computes "yesterday" inside the IL timezone
 *   directly, avoiding the DST edge case.
 */

import { HDate, HebrewCalendar, Event, flags } from "@hebcal/core";
import { getDb } from "../firebase/admin.js";
import { resolveOrefAreas, type RegionSelection } from "./regionResolver.js";
import { buildInsights } from "../insights/buildInsights.js";
import type { InsightsDailyDoc } from "../insights/types.js";

// ── Tunables (documented constants instead of magic numbers) ─────────────────

/** A day with > this much rain (mm) is flagged is_rain_day=true. */
const RAIN_THRESHOLD_MM = 1;

/** Operational disruption minutes attributed to one alert cluster. */
const MINUTES_PER_ALERT_CLUSTER = 30;

/** Alerts within this many milliseconds of each other count as one cluster. */
const ALERT_CLUSTER_WINDOW_MS = 30 * 60 * 1000; // 30 min

/** Open-Meteo request timeout. */
const WEATHER_TIMEOUT_MS = 6_000;

/** Oref alerts history request timeout. */
const OREF_TIMEOUT_MS = 4_000;

// ── Types ─────────────────────────────────────────────────────────────────────

interface DailyEntry {
  date: string;
  sales: number | string;
  deliveries?: number | string;
  food_cost?: number | string;
  payroll?: number | string;
  other_income?: number | string;
  other_expense?: number | string;
  hourly_payroll?: Record<string, number | string>;
  supplier_payments?: Record<string, number | string>;
}

interface BusinessConfig {
  businessName?: string;
  lat?: number | string;
  lon?: number | string;
  oref_areas?: string[];
  region_ids?: string[];
  subregion_ids?: string[];
  custom_oref_areas?: string[];
}

export interface AnalyticsDoc {
  date: string;
  tenantId: string;
  bizId: string;
  bizName: string;
  revenue: {
    sales: number;
    deliveries: number;
    other_income: number;
    total: number;
    food_cost: number;
    payroll: number;
    had_entry: boolean;
  };
  weather: {
    /** Mean daily temperature in °C, or null if Open-Meteo returned no value. */
    temp_avg: number | null;
    /** Total daily precipitation in mm, or null if missing. */
    rain_mm: number | null;
    /** True iff rain_mm strictly greater than RAIN_THRESHOLD_MM. Null if rain_mm null. */
    is_rain_day: boolean | null;
    /** Max daily wind speed (km/h), or null if missing. */
    wind_avg: number | null;
  } | null;
  alerts: {
    alert_count: number;
    /** Operational disruption minutes — clustered, not raw count×10. */
    alert_minutes: number;
    is_alert_day: boolean;
    matched_areas: string[];
  } | null;
  operational: {
    war_day: "regular" | "partial" | "full" | "unknown";
  };
  calendar: {
    dow: number;
    weekend: boolean;
    month: number;
    holiday: boolean;
    holiday_eve: boolean;
    new_year_eve: boolean;
    /** Names of Hebrew calendar events on this date, for traceability. */
    holiday_names: string[];
  };
  meta: {
    createdAt: number;
    builtAt: string;
    version: string;
    sources: {
      entry: "ok" | "missing";
      weather: "ok" | "missing";
      alerts: "ok" | "missing";
    };
    location: {
      lat: number;
      lon: number;
      oref_areas: string[];
      areas_source: "regions" | "legacy" | "default";
      region_ids?: string[];
      subregion_ids?: string[];
    };
  };
}

// ── Coercion helpers ─────────────────────────────────────────────────────────

function num(value: any): number {
  if (value === null || value === undefined || value === "") return 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") {
    const cleaned = value.replace(/,/g, "").trim();
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : 0;
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Like num(), but preserves null/undefined so callers can distinguish
 * "missing" from "zero". Used for weather metrics where 0 is a valid
 * reading and shouldn't be conflated with "API didn't return this".
 */
function numOrNull(value: any): number | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const cleaned = value.replace(/,/g, "").trim();
    if (cleaned === "") return null;
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : null;
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function parseFirebaseData<T>(value: any, fallback: T): T {
  if (!value) return fallback;
  if (typeof value === "string") {
    try { return JSON.parse(value); } catch { return fallback; }
  }
  if (value._v) {
    try { return JSON.parse(value._v); } catch { return fallback; }
  }
  return value as T;
}

// ── Upstream fetchers (timeouts + soft-fail) ─────────────────────────────────

async function fetchWithTimeout(
  url: string,
  options: RequestInit,
  ms: number
): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...options, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchWeather(
  lat: number,
  lon: number,
  date: string
): Promise<AnalyticsDoc["weather"]> {
  const url =
    `https://api.open-meteo.com/v1/archive?` +
    new URLSearchParams({
      latitude: String(lat),
      longitude: String(lon),
      start_date: date,
      end_date: date,
      daily: "precipitation_sum,temperature_2m_mean,windspeed_10m_max",
      timezone: "Asia/Jerusalem",
    });

  try {
    const res = await fetchWithTimeout(
      url,
      { headers: { Accept: "application/json" } },
      WEATHER_TIMEOUT_MS
    );
    if (!res.ok) return null;
    const raw = (await res.json()) as any;

    const rain_mm = numOrNull(raw?.daily?.precipitation_sum?.[0]);
    const temp_avg = numOrNull(raw?.daily?.temperature_2m_mean?.[0]);
    const wind_avg = numOrNull(raw?.daily?.windspeed_10m_max?.[0]);

    return {
      rain_mm,
      is_rain_day: rain_mm === null ? null : rain_mm > RAIN_THRESHOLD_MM,
      temp_avg,
      wind_avg,
    };
  } catch (err) {
    console.error("[analytics/weather] failed:", (err as Error)?.message ?? err);
    return null;
  }
}

/**
 * Cluster alert timestamps so multiple sirens within ALERT_CLUSTER_WINDOW_MS
 * of each other count as one operational disruption. For a restaurant, this
 * is closer to reality than "10 minutes per siren" — back-to-back alerts
 * during one barrage shouldn't multiply.
 */
function clusterAlertMinutes(timestamps: number[]): number {
  if (timestamps.length === 0) return 0;
  const sorted = [...timestamps].sort((a, b) => a - b);
  let clusters = 1;
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] - sorted[i - 1] > ALERT_CLUSTER_WINDOW_MS) clusters++;
  }
  return clusters * MINUTES_PER_ALERT_CLUSTER;
}

async function fetchOrefAlerts(
  areas: string[],
  date: string
): Promise<AnalyticsDoc["alerts"]> {
  if (!areas || areas.length === 0) {
    return { alert_count: 0, alert_minutes: 0, is_alert_day: false, matched_areas: [] };
  }
  try {
    const res = await fetchWithTimeout(
      "https://www.oref.org.il/WarningMessages/History/AlertsHistory.json",
      {
        headers: { Referer: "https://www.oref.org.il/", Accept: "application/json" },
      },
      OREF_TIMEOUT_MS
    );
    if (!res.ok) return null;

    const text = await res.text();
    if (!text || !text.trim().startsWith("[")) {
      // Oref sometimes returns HTML when degraded.
      return null;
    }
    const alerts = JSON.parse(text);
    if (!Array.isArray(alerts)) return null;

    const matched = new Set<string>();
    const timestamps: number[] = [];

    for (const a of alerts) {
      const dRaw = String(a?.alertDate ?? a?.date ?? "");
      const d = dRaw.slice(0, 10);
      if (d !== date) continue;
      const area = String(a?.data ?? a?.area ?? "");
      const hit = areas.find((h) => area.includes(h));
      if (!hit) continue;
      matched.add(hit);
      const ts = Date.parse(dRaw);
      if (Number.isFinite(ts)) timestamps.push(ts);
    }

    const alert_count = timestamps.length;
    return {
      alert_count,
      alert_minutes: clusterAlertMinutes(timestamps),
      is_alert_day: alert_count > 0,
      matched_areas: Array.from(matched),
    };
  } catch (err) {
    console.error("[analytics/oref] failed:", (err as Error)?.message ?? err);
    return null;
  }
}

// ── Calendar (Hebcal — replaces previous hard-coded tables) ─────────────────

const HOLIDAY_FLAGS =
  flags.CHAG | flags.MAJOR_FAST | flags.MINOR_HOLIDAY | flags.MODERN_HOLIDAY;

const EVE_FLAGS = flags.EREV;

function buildCalendar(date: string): AnalyticsDoc["calendar"] {
  // Parse the YMD components directly to avoid any UTC↔IL shifts. The
  // local Date constructor uses the host's timezone, which on Vercel is
  // UTC — that's fine here because we only care about Y/M/D and DOW.
  const [yStr, mStr, dStr] = date.split("-");
  const y = Number(yStr), m = Number(mStr), d = Number(dStr);

  const jsDate = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  const dow = jsDate.getUTCDay(); // 0 = Sun … 6 = Sat
  const weekend = dow === 5 || dow === 6;

  // Hebcal day-level events.
  const hd = new HDate(d, m, y);
  let events: Event[] = [];
  try {
    events = HebrewCalendar.getHolidaysOnDate(hd, false) ?? [];
  } catch {
    events = [];
  }

  const holiday_names: string[] = [];
  let holiday = false;
  let holiday_eve = false;

  for (const ev of events) {
    const f = ev.getFlags();
    holiday_names.push(ev.getDesc());
    if (f & HOLIDAY_FLAGS) holiday = true;
    if (f & EVE_FLAGS) holiday_eve = true;
  }

  // Gregorian New Year's Eve is a notable evening-out night for restaurants
  // but isn't in Hebcal as a holiday. Keep it as a separate flag.
  const new_year_eve = m === 12 && d === 31;

  return {
    dow,
    weekend,
    month: m,
    holiday,
    holiday_eve: holiday_eve || new_year_eve,
    new_year_eve,
    holiday_names,
  };
}

// ── Operational classification ──────────────────────────────────────────────

function classifyOperationalStatus(
  alertsDoc: AnalyticsDoc["alerts"],
  hadEntry: boolean
): AnalyticsDoc["operational"]["war_day"] {
  if (alertsDoc === null) return "unknown";
  if (!alertsDoc.is_alert_day) return "regular";
  return hadEntry ? "partial" : "full";
}

// ── Main builder ─────────────────────────────────────────────────────────────

export async function buildAnalyticsForBiz(
  tenantId: string,
  bizId: string,
  date: string
): Promise<AnalyticsDoc> {
  const db = getDb();

  const [entriesSnap, configSnap, businessSnap] = await Promise.all([
    db.ref(`tenants/${tenantId}/biz:${bizId}:entries`).once("value"),
    db.ref(`tenants/${tenantId}/biz:${bizId}:config`).once("value"),
    db.ref(`tenants/${tenantId}/app/business`).once("value"),
  ]);

  const entries = parseFirebaseData<DailyEntry[]>(entriesSnap.val(), []);
  const config = parseFirebaseData<BusinessConfig>(configSnap.val(), {});
  const businesses = parseFirebaseData<Array<{ id: string; name: string }>>(
    businessSnap.val(),
    []
  );

  const bizName =
    businesses.find((b) => b.id === bizId)?.name || config.businessName || "Unknown";
  const todayEntry = entries.find((e) => e.date === date);

  // Hadera fallback until the user picks a location through the map picker.
  const lat = num(config.lat) || 32.4342;
  const lon = num(config.lon) || 34.9194;

  const hasNewSelection =
    (config.region_ids?.length ?? 0) > 0 ||
    (config.subregion_ids?.length ?? 0) > 0 ||
    (config.custom_oref_areas?.length ?? 0) > 0;

  let orefAreas: string[];
  let areasSource: "regions" | "legacy" | "default";

  if (hasNewSelection) {
    orefAreas = resolveOrefAreas({
      region_ids: config.region_ids,
      subregion_ids: config.subregion_ids,
      custom_areas: config.custom_oref_areas,
    } satisfies RegionSelection);
    areasSource = "regions";
  } else if (Array.isArray(config.oref_areas) && config.oref_areas.length > 0) {
    orefAreas = config.oref_areas;
    areasSource = "legacy";
  } else {
    orefAreas = ["חדרה", "בנימינה", "זכרון יעקב", "עמיקם", "עין עירון", "קציר"];
    areasSource = "default";
  }

  const [weather, alerts] = await Promise.all([
    fetchWeather(lat, lon, date),
    fetchOrefAlerts(orefAreas, date),
  ]);

  const sales = num(todayEntry?.sales);
  const deliveries = num(todayEntry?.deliveries);
  const other_income = num(todayEntry?.other_income);
  const food_cost = num(todayEntry?.food_cost);
  const payroll_manual = num(todayEntry?.payroll);
  const hourly_payroll = todayEntry?.hourly_payroll
    ? Object.values(todayEntry.hourly_payroll).reduce<number>(
        (sum, v) => sum + num(v),
        0
      )
    : 0;
  const total_payroll = payroll_manual + hourly_payroll;
  const hadEntry =
    !!todayEntry && (sales > 0 || deliveries > 0 || food_cost > 0);

  const calendar = buildCalendar(date);
  const war_day = classifyOperationalStatus(alerts, hadEntry);

  return {
    date,
    tenantId,
    bizId,
    bizName,
    revenue: {
      sales,
      deliveries,
      other_income,
      total: sales + deliveries + other_income,
      food_cost,
      payroll: total_payroll,
      had_entry: hadEntry,
    },
    weather,
    alerts,
    operational: { war_day },
    calendar,
    meta: {
      createdAt: Date.now(),
      builtAt: new Date().toISOString(),
      version: "1.1.0",
      sources: {
        entry: hadEntry ? "ok" : "missing",
        weather: weather ? "ok" : "missing",
        alerts: alerts ? "ok" : "missing",
      },
      location: {
        lat,
        lon,
        oref_areas: orefAreas,
        areas_source: areasSource,
        region_ids: config.region_ids,
        subregion_ids: config.subregion_ids,
      },
    },
  };
}

// ── Persist to Firebase ──────────────────────────────────────────────────────

export async function saveAnalyticsDoc(doc: AnalyticsDoc): Promise<void> {
  const db = getDb();
  const path = `tenants/${doc.tenantId}/biz:${doc.bizId}:analytics:daily:${doc.date}`;
  await db.ref(path).set(doc);
}

// ── Insight Engine v1 wiring (Phase 2) ───────────────────────────────────────
// Reads the trailing analytics:daily history, runs the deterministic insight
// engine, and persists insights:daily:{date}. Fully isolated: buildAndSaveInsights
// NEVER throws, so a failure here can never break the analytics flow (the
// analytics doc is already saved before this runs).

/**
 * Load prior analytics:daily docs for the window BEFORE `date` (excludes `date`
 * itself). Reads analytics:daily only — never insights:daily. Missing days are
 * filtered out. Date math is pure UTC on the YYYY-MM-DD parts (no TZ drift).
 */
export async function loadAnalyticsHistory(
  tenantId: string,
  bizId: string,
  date: string,
  windowDays = 45
): Promise<AnalyticsDoc[]> {
  const db = getDb();
  const [y, m, d] = date.split("-").map(Number);
  const anchor = Date.UTC(y, (m || 1) - 1, d || 1);
  const keys: string[] = [];
  for (let i = 1; i <= windowDays; i++) {
    keys.push(new Date(anchor - i * 86_400_000).toISOString().slice(0, 10));
  }
  const snaps = await Promise.all(
    keys.map((k) =>
      db
        .ref(`tenants/${tenantId}/biz:${bizId}:analytics:daily:${k}`)
        .once("value")
        .catch(() => null)
    )
  );
  const out: AnalyticsDoc[] = [];
  for (const snap of snaps) {
    const val = snap && typeof snap.val === "function" ? snap.val() : null;
    if (val && typeof val === "object") out.push(val as AnalyticsDoc);
  }
  return out;
}

/** Persist an insights doc to tenants/{tenantId}/biz:{bizId}:insights:daily:{date}. */
export async function saveInsightsDoc(
  tenantId: string,
  bizId: string,
  insightsDoc: InsightsDailyDoc
): Promise<void> {
  const db = getDb();
  const path = `tenants/${tenantId}/biz:${bizId}:insights:daily:${insightsDoc.date}`;
  await db.ref(path).set(insightsDoc);
}

/**
 * Build + persist insights for one biz/date. Isolated & non-throwing: any error
 * is swallowed with a SANITIZED log (no payload, no revenue figures, no PII) so
 * the analytics flow is never affected.
 */
export async function buildAndSaveInsights(
  tenantId: string,
  bizId: string,
  date: string,
  todayDoc: AnalyticsDoc
): Promise<void> {
  try {
    const history = await loadAnalyticsHistory(tenantId, bizId, date, 45);
    const insightsDoc = buildInsights(todayDoc, history);
    await saveInsightsDoc(tenantId, bizId, insightsDoc);
  } catch (err) {
    console.error(
      `[insights] ${tenantId}:${bizId} ${date} failed:`,
      (err as Error)?.message ?? "unknown"
    );
  }
}

// ── Iterate active businesses ───────────────────────────────────────────────

export async function buildAnalyticsForAll(
  date: string
): Promise<{
  docs: AnalyticsDoc[];
  failures: Array<{ tenantId: string; bizId: string; error: string }>;
}> {
  const db = getDb();
  const docs: AnalyticsDoc[] = [];
  const failures: Array<{ tenantId: string; bizId: string; error: string }> = [];

  let activeBusinesses: Array<{ tenantId: string; bizId: string }> = [];

  try {
    const indexSnap = await db.ref("proactive_biz_index").once("value");
    const indexData = indexSnap.val();
    if (indexData && typeof indexData === "object") {
      for (const [key, value] of Object.entries(indexData)) {
        if (
          typeof value === "object" &&
          value !== null &&
          (value as any).active === true
        ) {
          const parts = key.split(":");
          if (parts.length === 2) {
            activeBusinesses.push({ tenantId: parts[0], bizId: parts[1] });
          }
        }
      }
    }
  } catch (err) {
    console.error("[analytics] proactive_biz_index read failed:", err);
  }

  if (activeBusinesses.length === 0) {
    try {
      const tenantsSnap = await db.ref("tenants").once("value");
      const tenantsData = tenantsSnap.val();
      if (tenantsData && typeof tenantsData === "object") {
        for (const [tenantId, tenantData] of Object.entries(tenantsData)) {
          if (
            typeof tenantData === "object" &&
            tenantData !== null &&
            (tenantData as any).app?.business
          ) {
            const businesses = parseFirebaseData<
              Array<{ id: string; name: string }>
            >((tenantData as any).app.business, []);
            for (const biz of businesses) {
              activeBusinesses.push({ tenantId, bizId: biz.id });
            }
          }
        }
      }
    } catch (err) {
      console.error("[analytics] tenant discovery failed:", err);
      return { docs, failures };
    }
  }

  for (const { tenantId, bizId } of activeBusinesses) {
    try {
      const doc = await buildAnalyticsForBiz(tenantId, bizId, date);
      await saveAnalyticsDoc(doc);
      // Insight Engine v1 — isolated, never throws (see buildAndSaveInsights).
      await buildAndSaveInsights(doc.tenantId, doc.bizId, doc.date, doc);
      docs.push(doc);
    } catch (err) {
      console.error(`[analytics] biz ${tenantId}:${bizId} failed:`, err);
      failures.push({
        tenantId,
        bizId,
        error: String((err as Error)?.message ?? err),
      });
    }
  }

  return { docs, failures };
}

// ── Date helpers ────────────────────────────────────────────────────────────

/**
 * Returns yesterday's date in Israel timezone (YYYY-MM-DD). Computed by
 * formatting `now` in IL TZ first, then subtracting one day from the
 * resulting Y/M/D components — sidesteps the UTC↔IL DST edge case the
 * old implementation had.
 */
export function yesterdayInIsrael(now: Date = new Date()): string {
  const todayIL = now.toLocaleDateString("en-CA", { timeZone: "Asia/Jerusalem" });
  // todayIL = "YYYY-MM-DD"
  const [y, m, d] = todayIL.split("-").map(Number);
  const prev = new Date(Date.UTC(y, m - 1, d - 1));
  const yy = prev.getUTCFullYear();
  const mm = String(prev.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(prev.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}
