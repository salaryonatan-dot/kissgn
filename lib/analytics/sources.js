/**
 * Analytics upstream fetchers.
 * All return structured feature objects or throw { source, reason }.
 * Never log raw payloads. Never store raw data.
 */

const BEECOMM_BASE = "https://api.beecomm.co.il";
const TABIT_BASE   = "https://api.tabit.cloud";
const WEATHER_BASE = "https://api.open-meteo.com";
const OREF_URL     = "https://www.oref.org.il/WarningMessages/History/AlertsHistory.json";

async function fetchWithTimeout(url, options, ms) {
  const ctrl  = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { ...options, signal: ctrl.signal });
    clearTimeout(timer);
    return res;
  } catch (e) {
    clearTimeout(timer);
    throw e;
  }
}

const numOrNull = v => (v != null && !isNaN(Number(v))) ? Number(v) : null;

// ── Beecomm daily-summary ─────────────────────────────────────────────────────
export async function fetchBeecommDaily(date) {
  let res;
  try {
    res = await fetchWithTimeout(
      `${BEECOMM_BASE}/v1/reports/daily-summary?date=${encodeURIComponent(date)}`,
      {
        headers: {
          Authorization: `Bearer ${process.env.BEECOMM_API_KEY}`,
          Accept: "application/json",
          "User-Agent": "MarjinAnalytics/1.0",
        },
      }, 8_000);
  } catch (e) {
    throw { source: "beecomm", reason: e?.name === "AbortError" ? "timeout" : "network" };
  }
  if (!res.ok) throw { source: "beecomm", reason: `http_${res.status}` };

  const raw = await res.json();

  return {
    revenue_total:    numOrNull(raw.total_sales      ?? raw.totalSales),
    tickets:          numOrNull(raw.transaction_count ?? raw.transactionCount),
    revenue_dine_in:  numOrNull(raw.dine_in_sales    ?? raw.dineInSales    ?? null),
    revenue_delivery: numOrNull(raw.delivery_sales   ?? raw.deliverySales  ?? null),
    revenue_takeaway: numOrNull(raw.takeaway_sales   ?? raw.takeawaySales  ?? null),
    hourly:           extractHourly(raw.hourly ?? raw.hourlyBreakdown ?? null),
  };
}

function extractHourly(hourlyRaw) {
  const HOURS = ["08","09","10","11","12","13","14","15","16","17","18","19","20","21"];
  const out = {};
  for (const h of HOURS) {
    const val = hourlyRaw?.[h] ?? hourlyRaw?.[`${h}:00`] ?? hourlyRaw?.[parseInt(h,10)];
    out[h] = numOrNull(val) ?? 0;
  }
  return out;
}

// ── Tabit labor (optional) ────────────────────────────────────────────────────
export async function fetchTabitHours(date) {
  if (!process.env.TABIT_API_KEY) return null;
  let res;
  try {
    res = await fetchWithTimeout(
      `${TABIT_BASE}/v1/labor/daily?date=${encodeURIComponent(date)}`,
      {
        headers: {
          Authorization: `Bearer ${process.env.TABIT_API_KEY}`,
          "X-Tabit-Org":  process.env.TABIT_ORG_ID || "",
          Accept: "application/json",
          "User-Agent": "MarjinAnalytics/1.0",
        },
      }, 8_000);
  } catch (e) {
    console.error("[analytics/tabit]", e?.name === "AbortError" ? "timeout" : "network");
    return null; // soft fail — staffing is optional
  }
  if (!res.ok) { console.error("[analytics/tabit] http", res.status); return null; }
  const raw = await res.json();
  return { total_hours: numOrNull(raw.total_hours ?? raw.totalHours) };
}

// ── Open-Meteo weather ────────────────────────────────────────────────────────
const LAT = 32.434; // Hadera — pilot single-branch coords
const LON = 34.919;

export async function fetchWeather(date) {
  const url = `${WEATHER_BASE}/v1/archive?` + new URLSearchParams({
    latitude: LAT, longitude: LON,
    start_date: date, end_date: date,
    daily: "precipitation_sum,temperature_2m_mean,windspeed_10m_max",
    timezone: "Asia/Jerusalem",
  });
  let res;
  try {
    res = await fetchWithTimeout(url, { headers: { Accept: "application/json" } }, 6_000);
  } catch (e) {
    throw { source: "weather", reason: e?.name === "AbortError" ? "timeout" : "network" };
  }
  if (!res.ok) throw { source: "weather", reason: `http_${res.status}` };
  const raw  = await res.json();
  const rain = numOrNull(raw.daily?.precipitation_sum?.[0]) ?? 0;
  return {
    rain_mm:     rain,
    is_rain_day: rain > 1,
    temp_avg:    numOrNull(raw.daily?.temperature_2m_mean?.[0]) ?? 0,
    wind_avg:    numOrNull(raw.daily?.windspeed_10m_max?.[0])   ?? 0,
  };
}

// ── Oref alert history ────────────────────────────────────────────────────────
const HADERA_AREAS = [
  "חדרה","קרית ים","קרית ביאליק","בנימינה","זכרון יעקב","עמיקם","עין עירון","קציר",
];

export async function fetchOrefAlerts(date) {
  let res;
  try {
    res = await fetchWithTimeout(OREF_URL, {
      headers: { Referer: "https://www.oref.org.il/", Accept: "application/json" },
    }, 4_000);
  } catch (e) {
    throw { source: "oref", reason: e?.name === "AbortError" ? "timeout" : "network" };
  }
  if (!res.ok) throw { source: "oref", reason: `http_${res.status}` };
  const alerts = Array.isArray(await res.json()) ? await res.json() : [];
  // count only, never store raw
  const day = alerts.filter(a => {
    const d = (a.alertDate ?? a.date ?? "").slice(0,10);
    const area = a.data ?? a.area ?? "";
    return d === date && HADERA_AREAS.some(h => area.includes(h));
  });
  return {
    alert_count:   day.length,
    alert_minutes: day.length * 10,
    is_alert_day:  day.length > 0,
  };
}

// ── Calendar (pure, no upstream) ──────────────────────────────────────────────
//
// IL_HOLIDAYS  = יום חג עצמו (יו"ט / חול המועד / יום עצמאות / שבועות וכו')
// IL_HOLIDAY_EVES = ערב חג (בדרך כלל מוקדם — עסקים סוגרים מוקדם)
// NEW_YEAR_EVE = 31/12 — כניסה לשנה הלועזית, ערב חג חברתי
//
// מכסה: 2024 · 2025 · 2026

// ── ימי חג ────────────────────────────────────────────────────────────────────
const IL_HOLIDAYS = new Set([
  // ── 2024 ──────────────────────────────────────────────────────────────────
  // ראש השנה תשפ"ה
  "2024-10-02", "2024-10-03",
  // יום כיפור
  "2024-10-11",
  // סוכות (א' + ב')
  "2024-10-16", "2024-10-17",
  // שמיני עצרת + שמחת תורה
  "2024-10-23", "2024-10-24",
  // חנוכה (לא יו"ט, אך כלול כהשפעת מכירות)
  "2024-12-25","2024-12-26","2024-12-27","2024-12-28",
  "2024-12-29","2024-12-30","2024-12-31","2025-01-01",

  // ── 2025 ──────────────────────────────────────────────────────────────────
  // פורים (תענית אסתר: 13/3, פורים: 13/3 ירושלים / 14/3 שאר הארץ)
  "2025-03-13", "2025-03-14",
  // פסח (א' + ב' + חול המועד + ז' + ח')
  "2025-04-12", "2025-04-13",
  "2025-04-14", "2025-04-15", "2025-04-16", "2025-04-17",
  "2025-04-18", "2025-04-19",
  // יום השואה
  "2025-05-05",
  // יום הזיכרון
  "2025-05-12",
  // יום העצמאות
  "2025-05-13",
  // ל"ג בעומר
  "2025-05-16",
  // שבועות
  "2025-06-01", "2025-06-02",
  // ט' באב
  "2025-08-03",
  // ראש השנה תשפ"ו
  "2025-09-22", "2025-09-23",
  // יום כיפור
  "2025-10-01",
  // סוכות (א' + ב')
  "2025-10-06", "2025-10-07",
  // חול המועד סוכות
  "2025-10-08","2025-10-09","2025-10-10","2025-10-11","2025-10-12",
  // שמיני עצרת + שמחת תורה
  "2025-10-13", "2025-10-14",
  // חנוכה תשפ"ו
  "2025-12-14","2025-12-15","2025-12-16","2025-12-17",
  "2025-12-18","2025-12-19","2025-12-20","2025-12-21",

  // ── 2026 ──────────────────────────────────────────────────────────────────
  // פורים
  "2026-03-02", "2026-03-03",
  // פסח
  "2026-03-31", "2026-04-01",
  "2026-04-02","2026-04-03","2026-04-04","2026-04-05",
  "2026-04-06", "2026-04-07",
  // יום השואה
  "2026-04-20",
  // יום הזיכרון + יום העצמאות
  "2026-04-28", "2026-04-29",
  // שבועות
  "2026-05-19", "2026-05-20",
  // ט' באב
  "2026-07-23",
  // ראש השנה תשפ"ז
  "2026-09-10", "2026-09-11",
  // יום כיפור
  "2026-09-19",
  // סוכות
  "2026-09-24", "2026-09-25",
  "2026-09-26","2026-09-27","2026-09-28","2026-09-29","2026-09-30",
  // שמיני עצרת + שמחת תורה
  "2026-10-01", "2026-10-02",
]);

// ── ערבי חג (יום לפני — עסקים סוגרים מוקדם, תנועה שונה) ────────────────────
const IL_HOLIDAY_EVES = new Set([
  // ── 2024 ──────────────────────────────────────────────────────────────────
  "2024-10-01",  // ערב ראש השנה
  "2024-10-10",  // ערב יום כיפור
  "2024-10-15",  // ערב סוכות
  "2024-10-22",  // ערב שמיני עצרת

  // ── 2025 ──────────────────────────────────────────────────────────────────
  "2025-03-12",  // ערב פורים (תענית אסתר)
  "2025-04-11",  // ערב פסח
  "2025-04-17",  // ערב שביעי של פסח
  "2025-05-11",  // ערב יום הזיכרון
  "2025-05-31",  // ערב שבועות
  "2025-08-02",  // ערב ט' באב
  "2025-09-21",  // ערב ראש השנה
  "2025-09-30",  // ערב יום כיפור
  "2025-10-05",  // ערב סוכות
  "2025-10-12",  // ערב שמיני עצרת

  // ── 2026 ──────────────────────────────────────────────────────────────────
  "2026-03-01",  // ערב פורים
  "2026-03-30",  // ערב פסח
  "2026-04-05",  // ערב שביעי של פסח
  "2026-04-27",  // ערב יום הזיכרון
  "2026-05-18",  // ערב שבועות
  "2026-07-22",  // ערב ט' באב
  "2026-09-09",  // ערב ראש השנה
  "2026-09-18",  // ערב יום כיפור
  "2026-09-23",  // ערב סוכות
  "2026-09-30",  // ערב שמיני עצרת
]);

// ── ערב שנה חדשה לועזית ───────────────────────────────────────────────────────
const NEW_YEAR_EVES = new Set([
  "2024-12-31",
  "2025-12-31",
  "2026-12-31",
]);

export function buildCalendar(date) {
  const d = new Date(date + "T12:00:00Z");
  const dow = d.getUTCDay();
  return {
    dow,
    weekend:      dow === 5 || dow === 6,
    month:        d.getUTCMonth() + 1,
    holiday:      IL_HOLIDAYS.has(date),
    holiday_eve:  IL_HOLIDAY_EVES.has(date) || NEW_YEAR_EVES.has(date),
    new_year_eve: NEW_YEAR_EVES.has(date),
  };
}
