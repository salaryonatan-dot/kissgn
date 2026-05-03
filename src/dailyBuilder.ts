/**
 * Daily research-data builder.
 *
 * For each active business, captures a per-day "feature doc" that combines:
 *   - Revenue (from manual entries in Firebase, NOT a POS API)
 *   - Weather  (Open-Meteo, no API key — using business's lat/lon)
 *   - Oref alerts (count + minutes — filtered by business's areas)
 *   - Calendar (holiday / holiday-eve / weekend, derived locally)
 *   - Operational classification (auto: war_day = "no" | "partial" | "full")
 *
 * The intent is research, not real-time alerting: building a multi-month
 * dataset so future ML can find correlations like "rain → +12% delivery"
 * or "alert day → -30% sit-down" without us hand-crafting heuristics.
 *
 * Soft-fails on optional upstreams: if Open-Meteo is down, weather is null.
 * Hard-fails only if Firebase is unreachable (so the cron loops correctly).
 */

import { getDb } from "../firebase/admin.js";

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
    temp_avg: number | null;
    rain_mm: number | null;
    is_rain_day: boolean | null;
    wind_avg: number | null;
  } | null;

  alerts: {
    alert_count: number;
    alert_minutes: number;
    is_alert_day: boolean;
    matched_areas: string[];
  } | null;

  // Auto-classified operational status. The user explicitly chose "automatic
  // from alerts + revenue" over a manual toggle, so this is derived:
  //   - "regular":  no alerts that day
  //   - "partial":  alerts AND a real entry (open but disrupted)
  //   - "full":     alerts AND no entry (closed for the day)
  //   - "unknown":  alerts source failed → can't classify
  operational: {
    war_day: "regular" | "partial" | "full" | "unknown";
  };

  calendar: {
    dow: number;          // 0 = Sunday … 6 = Saturday
    weekend: boolean;     // Friday/Saturday in Israel
    month: number;        // 1–12
    holiday: boolean;
    holiday_eve: boolean;
    new_year_eve: boolean;
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
    };
  };
}

// ── Coercion helper (same pattern as snapshotBuilder.ts) ──────────────────────

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
    const res = await fetchWithTimeout(url, { headers: { Accept: "application/json" } }, 6_000);
    if (!res.ok) return null;
    const raw = await res.json();
    const rain = num(raw?.daily?.precipitation_sum?.[0]);
    return {
      rain_mm: rain,
      is_rain_day: rain > 1,
      temp_avg: num(raw?.daily?.temperature_2m_mean?.[0]),
      wind_avg: num(raw?.daily?.windspeed_10m_max?.[0]),
    };
  } catch (err) {
    console.error("[analytics/weather] failed:", (err as Error)?.message ?? err);
    return null;
  }
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
      4_000
    );
    if (!res.ok) return null;
    const text = await res.text();
    if (!text || !text.trim().startsWith("[")) {
      // Oref sometimes returns HTML when their service is degraded —
      // never feed that into JSON.parse.
      return null;
    }
    const alerts = JSON.parse(text);
    if (!Array.isArray(alerts)) return null;

    const matched = new Set<string>();
    const dayAlerts = alerts.filter((a: any) => {
      const d = String(a?.alertDate ?? a?.date ?? "").slice(0, 10);
      const area = String(a?.data ?? a?.area ?? "");
      if (d !== date) return false;
      const hit = areas.find((h) => area.includes(h));
      if (hit) {
        matched.add(hit);
        return true;
      }
      return false;
    });

    return {
      alert_count: dayAlerts.length,
      // Heuristic: 10 minutes of operational disruption per alert (siren +
      // shelter time + return-to-work). Not exact — refine later.
      alert_minutes: dayAlerts.length * 10,
      is_alert_day: dayAlerts.length > 0,
      matched_areas: Array.from(matched),
    };
  } catch (err) {
    console.error("[analytics/oref] failed:", (err as Error)?.message ?? err);
    return null;
  }
}

// ── Calendar (Israeli holidays for 2024–2026) ─────────────────────────────────
// Mirror of lib/analytics/sources.js — kept inline so this module is
// self-contained for serverless cold starts.

const IL_HOLIDAYS = new Set<string>([
  // 2024
  "2024-10-02", "2024-10-03", "2024-10-11", "2024-10-16", "2024-10-17",
  "2024-10-23", "2024-10-24",
  "2024-12-25", "2024-12-26", "2024-12-27", "2024-12-28",
  "2024-12-29", "2024-12-30", "2024-12-31", "2025-01-01",
  // 2025
  "2025-03-13", "2025-03-14",
  "2025-04-12", "2025-04-13", "2025-04-14", "2025-04-15",
  "2025-04-16", "2025-04-17", "2025-04-18", "2025-04-19",
  "2025-05-05", "2025-05-12", "2025-05-13", "2025-05-16",
  "2025-06-01", "2025-06-02", "2025-08-03",
  "2025-09-22", "2025-09-23", "2025-10-01",
  "2025-10-06", "2025-10-07", "2025-10-08", "2025-10-09",
  "2025-10-10", "2025-10-11", "2025-10-12", "2025-10-13", "2025-10-14",
  "2025-12-14", "2025-12-15", "2025-12-16", "2025-12-17",
  "2025-12-18", "2025-12-19", "2025-12-20", "2025-12-21",
  // 2026
  "2026-03-02", "2026-03-03",
  "2026-03-31", "2026-04-01", "2026-04-02", "2026-04-03",
  "2026-04-04", "2026-04-05", "2026-04-06", "2026-04-07",
  "2026-04-20", "2026-04-28", "2026-04-29",
  "2026-05-19", "2026-05-20", "2026-07-23",
  "2026-09-10", "2026-09-11", "2026-09-19",
  "2026-09-24", "2026-09-25", "2026-09-26", "2026-09-27",
  "2026-09-28", "2026-09-29", "2026-09-30",
  "2026-10-01", "2026-10-02",
]);

const IL_HOLIDAY_EVES = new Set<string>([
  "2024-10-01", "2024-10-10", "2024-10-15", "2024-10-22",
  "2025-03-12", "2025-04-11", "2025-04-17", "2025-05-11",
  "2025-05-31", "2025-08-02", "2025-09-21", "2025-09-30",
  "2025-10-05", "2025-10-12",
  "2026-03-01", "2026-03-30", "2026-04-05", "2026-04-27",
  "2026-05-18", "2026-07-22", "2026-09-09", "2026-09-18",
  "2026-09-23", "2026-09-30",
]);

const NEW_YEAR_EVES = new Set<string>([
  "2024-12-31", "2025-12-31", "2026-12-31",
]);

function buildCalendar(date: string): AnalyticsDoc["calendar"] {
  const d = new Date(date + "T12:00:00Z");
  const dow = d.getUTCDay();
  const newYearEve = NEW_YEAR_EVES.has(date);
  return {
    dow,
    weekend: dow === 5 || dow === 6,
    month: d.getUTCMonth() + 1,
    holiday: IL_HOLIDAYS.has(date),
    holiday_eve: IL_HOLIDAY_EVES.has(date) || newYearEve,
    new_year_eve: newYearEve,
  };
}

// ── Operational classification (auto from alerts + revenue) ───────────────────

function classifyOperationalStatus(
  alertsDoc: AnalyticsDoc["alerts"],
  hadEntry: boolean
): AnalyticsDoc["operational"]["war_day"] {
  if (alertsDoc === null) return "unknown";
  if (!alertsDoc.is_alert_day) return "regular";
  return hadEntry ? "partial" : "full";
}

// ── Main builder ──────────────────────────────────────────────────────────────

export async function buildAnalyticsForBiz(
  tenantId: string,
  bizId: string,
  date: string
): Promise<AnalyticsDoc> {
  const db = getDb();

  // Read entry + config in parallel.
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
    businesses.find((b) => b.id === bizId)?.name ||
    config.businessName ||
    "Unknown";

  const todayEntry = entries.find((e) => e.date === date);

  // Resolve location with sane defaults (Hadera) until the user sets it
  // explicitly through the map picker we'll add to SetupWizard.
  const lat = num(config.lat) || 32.4342;
  const lon = num(config.lon) || 34.9194;
  const orefAreas = Array.isArray(config.oref_areas) && config.oref_areas.length > 0
    ? config.oref_areas
    : ["חדרה", "בנימינה", "זכרון יעקב", "עמיקם", "עין עירון", "קציר"];

  // Optional sources — soft-fail so one outage doesn't kill the whole doc.
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

  const hadEntry = !!todayEntry && (sales > 0 || deliveries > 0 || food_cost > 0);
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
      version: "1.0.0",
      sources: {
        entry: hadEntry ? "ok" : "missing",
        weather: weather ? "ok" : "missing",
        alerts: alerts ? "ok" : "missing",
      },
      location: { lat, lon, oref_areas: orefAreas },
    },
  };
}

// ── Persist to Firebase ───────────────────────────────────────────────────────

export async function saveAnalyticsDoc(doc: AnalyticsDoc): Promise<void> {
  const db = getDb();
  // Per-day path so backfills are idempotent and queries are cheap.
  const path = `tenants/${doc.tenantId}/biz:${doc.bizId}:analytics:daily:${doc.date}`;
  await db.ref(path).set(doc);
}

// ── Iterate active businesses (mirrors snapshotBuilder discovery) ────────────

export async function buildAnalyticsForAll(
  date: string
): Promise<{ docs: AnalyticsDoc[]; failures: Array<{ tenantId: string; bizId: string; error: string }> }> {
  const db = getDb();
  const docs: AnalyticsDoc[] = [];
  const failures: Array<{ tenantId: string; bizId: string; error: string }> = [];

  let activeBusinesses: Array<{ tenantId: string; bizId: string }> = [];

  // Preferred discovery: proactive_biz_index.
  try {
    const indexSnap = await db.ref("proactive_biz_index").once("value");
    const indexData = indexSnap.val();
    if (indexData && typeof indexData === "object") {
      for (const [key, value] of Object.entries(indexData)) {
        if (typeof value === "object" && value !== null && (value as any).active === true) {
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

  // Fallback: discover via tenants list.
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
            const businesses = parseFirebaseData<Array<{ id: string; name: string }>>(
              (tenantData as any).app.business,
              []
            );
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
      docs.push(doc);
    } catch (err) {
      console.error(`[analytics] biz ${tenantId}:${bizId} failed:`, err);
      failures.push({ tenantId, bizId, error: String((err as Error)?.message ?? err) });
    }
  }

  return { docs, failures };
}

// ── Date helpers ──────────────────────────────────────────────────────────────

/**
 * Returns yesterday's date in Israel timezone, formatted YYYY-MM-DD.
 * The cron runs at 02:00 IST, so "yesterday" is the day that just ended.
 */
export function yesterdayInIsrael(now: Date = new Date()): string {
  const israelMs = now.getTime();
  const israel = new Date(israelMs - 24 * 60 * 60 * 1000);
  return israel.toLocaleDateString("en-CA", { timeZone: "Asia/Jerusalem" });
}
