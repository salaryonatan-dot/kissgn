/**
 * Builds a complete daily feature doc for one date + branchId.
 * Throws if required upstream (Beecomm) fails.
 * Soft-fails on optional upstreams (Tabit, Oref, Weather → logged, nulls used).
 */

import {
  fetchBeecommDaily,
  fetchTabitHours,
  fetchWeather,
  fetchOrefAlerts,
  buildCalendar,
} from "./sources.js";

const BRANCH_ID = "main"; // pilot: fixed. Future: param passed in.

// ── Schema changelog — update when making breaking changes ───────────────────
// v1.0.0  initial schema: revenue, hourly, weather, oref, calendar, staffing, meta
// v1.1.0+ document here: what changed, whether backfill needed, model compatibility

/**
 * @param {string} tenantId
 * @param {string} date  YYYY-MM-DD
 * @returns {Promise<{ path: string, doc: object }>}
 * @throws {{ source: string, reason: string }} if required source fails
 */
export async function buildDailyDoc(tenantId, date) {
  // ── Required: Beecomm (throws on failure → caller skips this date) ─────────
  const beecomm = await fetchBeecommDaily(date);

  // ── Optional: soft-fail, use null ─────────────────────────────────────────
  const [tabit, weather, oref] = await Promise.allSettled([
    fetchTabitHours(date),
    fetchWeather(date),
    fetchOrefAlerts(date),
  ]);

  const staffing = tabit.status === "fulfilled"
    ? (tabit.value ?? { total_hours: null })
    : (() => { console.error("[analytics/tabit] skipped:", tabit.reason?.reason); return { total_hours: null }; })();

  const weatherDoc   = weather.status === "fulfilled" ? weather.value : null;
  const alertsDoc    = oref.status    === "fulfilled" ? oref.value    : null;

  if (!weatherDoc) console.error("[analytics/weather] skipped:", weather.reason?.reason);
  if (!alertsDoc)  console.error("[analytics/oref] skipped:",    oref.reason?.reason);

  const calendar = buildCalendar(date);

  const revenue_total = beecomm.revenue_total ?? 0;
  const tickets       = beecomm.tickets       ?? 0;

  const doc = {
    // ── Core revenue ─────────────────────────────────────────────────────────
    revenue_total,
    tickets,
    avg_check: tickets > 0 ? Math.round((revenue_total / tickets) * 100) / 100 : 0,

    // ── Channel split ─────────────────────────────────────────────────────────
    revenue_dine_in:  beecomm.revenue_dine_in,
    revenue_delivery: beecomm.revenue_delivery,
    revenue_takeaway: beecomm.revenue_takeaway,

    // ── Hourly breakdown ──────────────────────────────────────────────────────
    hourly: beecomm.hourly,

    // ── Context ───────────────────────────────────────────────────────────────
    weather:  weatherDoc,
    alerts:   alertsDoc,
    // calendar includes: dow, weekend, month, holiday, holiday_eve, new_year_eve
    calendar,
    staffing,

    // ── Meta ──────────────────────────────────────────────────────────────────
    meta: {
      createdAt:    Date.now(),
      builtAt:      new Date().toISOString(),  // human-readable timestamp
      version:      "1.0.0",                   // bump when schema changes — see changelog above
      tenantId,                                // portable: survives export to BigQuery/CSV/S3
      branchId:     BRANCH_ID,                 // portable: no need to parse path
      // "ok" = data present, "missing" = upstream failed (null fields above)
      // Never mix missing data with "zero" — consumers must check status first
      sources: {
        beecomm: "ok",                                           // always ok here (throws otherwise)
        weather: weather.status === "fulfilled" ? "ok" : "missing",
        oref:    oref.status    === "fulfilled" ? "ok" : "missing",
        tabit:   tabit.status   === "fulfilled" && tabit.value ? "ok" : "missing",
      },
      sourceVersions: {
        beecomm: "v1",
        oref:    "v1",
        weather: "open-meteo",
      },
    },
  };

  return {
    path: `tenants/${tenantId}/analytics/daily/${BRANCH_ID}/${date}`,
    doc,
  };
}
