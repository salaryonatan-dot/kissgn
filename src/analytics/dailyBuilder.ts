/**
 * Daily research-data builder.
 *
 * For each active business, captures a per-day "feature doc" that combines:
 * - Revenue (from manual entries in Firebase, NOT a POS API)
 * - Weather (Open-Meteo, no API key — using business's lat/lon)
 * - Oref alerts (count + minutes — filtered by business's areas)
 * - Calendar (holiday / holiday-eve / weekend, derived locally)
 * - Operational classification (auto: war_day = "no" | "partial" | "full")
 *
 * The intent is research, not real-time alerting: building a multi-month
 * dataset so future ML can find correlations like "rain → +12% delivery"
 * or "alert day → -30% sit-down" without us hand-crafting heuristics.
 *
 * Soft-fails on optional upstreams: if Open-Meteo is down, weather is null.
 * Hard-fails only if Firebase is unreachable (so the cron loops correctly).
 */

import { getDb } from "../firebase/admin.js";
import { classifyRegistryTarget, decodeRegistryNode, isRegistryBizId, resolveRegistryTarget } from "../../lib/businessRegistry.js";
import { loadCanonicalInputs } from "../finance-server/canonicalInputs.js";
import { canonicalDayRecord, toAnalyticsFinancials } from "../finance-server/canonicalMetrics.js";
import type { AnalyticsFinBlock } from "../finance-server/canonicalMetrics.js";
import { resolveOrefAreas, type RegionSelection } from "./regionResolver.js";
import { buildInsights } from "../insights/buildInsights.js";
import type { AnalyticsDailyInput, InsightsDailyDoc } from "../insights/types.js";

// ── Types ─────────────────────────────────────────────────────────────────────

// Non-financial view of a stored entry row: the embedded (legacy) exception metadata only.
// Financial values are read exclusively through the canonical API (Financial Core B1).
interface EntryExceptionFields {
  date?: string;
  // Exception-day model (Formula Bible §7). Legacy entries omit these and are
  // treated as non-exception. An exception day still counts in ACTUAL revenue
  // but is excluded from forecast/anomaly baselines.
  is_exception?: boolean;
  exception_reason?: string;
  exception_note?: string;
  exception_set_at?: number;
  exception_set_by?: string;
}

interface BusinessConfig {
  businessName?: string;
  lat?: number | string;
  lon?: number | string;
  // Legacy: a flat list of Oref-area substrings. Still honored for
  // backward compatibility with any business that pre-dated the
  // region taxonomy.
  oref_areas?: string[];
  // New: hierarchical region selection. The builder prefers this
  // when present and falls back to oref_areas / Hadera defaults.
  region_ids?: string[];
  subregion_ids?: string[];
  custom_oref_areas?: string[];
}

export interface AnalyticsDoc {
  date: string;
  tenantId: string;
  bizId: string;
  bizName: string;

  // Exception-day signal read by the forecast engine and the revenue anomaly
  // rules. `is_exception=false` for legacy/normal days.
  is_exception: boolean;
  exception: {
    reason: string | null;
    note: string | null;
    set_at: number | null;
    set_by: string | null;
  } | null;

  // Financial Core B1: a legacy numeric field is present ONLY when its canonical fact is
  // complete (Actual, D-1); an unavailable fact is omitted, never written as a plausible 0.
  // `payroll` = canonical daily labor (`payroll` + global calendar-day allocation).
  revenue: {
    sales?: number;
    deliveries?: number;
    other_income?: number;
    total?: number;
    food_cost?: number;
    payroll?: number;
    // presence of the business date (an explicit zero is an entered day).
    had_entry: boolean;
    // P0: explicit "this day actually had sales/revenue" signal. Distinct from
    // had_entry (which is also true for a supplier-payment-only day). Revenue
    // baselines require has_sales !== false so supplier-only / zero days never
    // pollute same-weekday averages. Legacy docs without this field fall back to
    // total>0 in the insight baselines (backward compatible).
    has_sales: boolean;
  };

  // Additive canonical block (exact amounts, presence, provenance); old readers ignore it.
  fin?: AnalyticsFinBlock;

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
  // - "regular": no alerts that day
  // - "partial": alerts AND a real entry (open but disrupted)
  // - "full": alerts AND no entry (closed for the day)
  // - "unknown": alerts source failed → can't classify
  operational: {
    war_day: "regular" | "partial" | "full" | "unknown";
  };

  calendar: {
    dow: number; // 0 = Sunday … 6 = Saturday
    weekend: boolean; // Friday/Saturday in Israel
    month: number; // 1–12
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
      // The flat substrings actually used for filtering — denormalized
      // from regions for efficient querying without re-running resolver.
      oref_areas: string[];
      // Which selection layer produced the areas, for traceability.
      // "regions" = new hierarchical taxonomy; "legacy" = pre-existing
      // flat oref_areas array; "default" = Hadera fallback.
      areas_source: "regions" | "legacy" | "default";
      region_ids?: string[];
      subregion_ids?: string[];
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

// M1 R3 — the shared target-scoped registry rule (lib/businessRegistry.js: the rule of the Core cost-history writer, the
// P1 supplier-credit routes and the analytics endpoint) is applied to the STORED registry node itself, never to a list
// re-wrapped after a lenient parse: only the runtime `{ _v: "<JSON array>" }` node can establish a target. A raw array, a
// bare JSON string, an object map or an invalid envelope is unreadable here exactly as in rebuild, backfill, Core and P1.
// An unrelated element (a bare null, a primitive, a malformed record) is never dereferenced; duplicated or colliding
// records establish NO record — never a first match.
//
// A nightly target id is EXACT: a string the shared rule can address, with no surrounding whitespace (the analytics
// endpoint refuses padded ids with 400; discovery never trims a stored id into another business's id).
function isExactNightlyBizId(id: unknown): id is string {
  return typeof id === "string" && isRegistryBizId(id) && id === id.trim();
}

// Report-only: the ids a NON-runtime registry node appears to name (a raw array, a bare JSON string, an object map), so a
// rejected target stays visible in the run's failures. Never used to select, build or persist anything.
function unreadableRegistryIds(node: unknown): string[] {
  let v: unknown = node;
  if (typeof v === "string") { try { v = JSON.parse(v); } catch { return []; } }
  if (v && typeof v === "object" && !Array.isArray(v) && typeof (v as { _v?: unknown })._v === "string") {
    try { v = JSON.parse((v as { _v: string })._v); } catch { return []; }
  }
  const items = Array.isArray(v) ? v : v && typeof v === "object" ? Object.values(v as Record<string, unknown>) : [];
  const ids: string[] = [];
  for (const e of items) {
    const id = e && typeof e === "object" && !Array.isArray(e) ? (e as { id?: unknown }).id : undefined;
    if (typeof id === "string" && id && !ids.includes(id)) ids.push(id);
  }
  return ids;
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
    // Cast to any: under Vercel's strict TS settings, res.json() resolves to
    // unknown, which makes the optional-chained reads below trigger TS2339.
    // We're already inside a try/catch and num() handles every malformed
    // value, so the cast is safe.
    const raw = await res.json() as any;
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

/**
 * Canonical structured-first effective-exception resolution (mirror of
 * lib/entryExceptions.js resolveEffectiveException; kept in parity by
 * test/analytics/entry-exception-parity.test.mjs). Structured active/cleared
 * WINS; structured absent falls back to the narrow legacy embedded field.
 */
export function resolveEffectiveException(
  structuredEnvelope: { state?: { status?: string; reasonCode?: string; reasonText?: string; updatedAt?: number; updatedBy?: string } } | null | undefined,
  legacyEntry: { is_exception?: boolean } | null | undefined
): { isException: boolean; origin: "structured" | "legacy" | "none"; state: { status?: string; reasonCode?: string; reasonText?: string; updatedAt?: number; updatedBy?: string } | null } {
  const state = structuredEnvelope && structuredEnvelope.state ? structuredEnvelope.state : null;
  if (state) return { isException: state.status === "active", origin: "structured", state };
  if (legacyEntry && legacyEntry.is_exception === true) return { isException: true, origin: "legacy", state: null };
  return { isException: false, origin: "none", state: null };
}

export async function buildAnalyticsForBiz(
  tenantId: string,
  bizId: string,
  date: string,
  opts?: { nowMs?: number; requireRegistered?: boolean }
): Promise<AnalyticsDoc> {
  const db = getDb();

  // Financial Core B1: the entries node and the business config are read ONCE through the
  // canonical server loader (shared dual-mode entries reader: a malformed node throws a
  // typed EntriesStorageError before any external fetch or derived write, CTO D3). A
  // business date carried by several rows is one canonical day (every row contributes; no
  // winner row, VD-04). A duplicate row id throws a typed FinanceContractError. Both
  // propagate: buildAnalyticsForAll records the business failure and continues.
  // `need.exceptions:false`: this builder reads the ONE date's structured envelope itself
  // (below) because the doc also carries that envelope's reason/note metadata.
  const [inputs, businessSnap, exceptionSnap] = await Promise.all([
    loadCanonicalInputs(db, tenantId, bizId, { site: "dailyBuilder", nowMs: opts?.nowMs, need: { config: true, fixed: false, exceptions: false } }),
    db.ref(`tenants/${tenantId}/app/business`).once("value"),
    db.ref(`tenants/${tenantId}/entry_exceptions/${bizId}/${date}`).once("value"),
  ]);
  const structuredExceptionEnvelope = exceptionSnap.val() as
    { state?: { status?: string; reasonCode?: string; reasonText?: string; updatedAt?: number; updatedBy?: string } } | null;

  // Location / region selection only (non-financial): the decoded config when readable.
  const config = (inputs.config.state === "present" ? inputs.config.value : {}) as BusinessConfig;
  // M1 R3: the stored registry node itself (no lenient parse, no re-wrap). The nightly run re-checks the identity at build
  // time (`requireRegistered`): a registry that no longer establishes the target fails this business before any write, with
  // a code naming the build-time state (`business_registry_changed_<state>`), distinct from the discovery refusals.
  const target = resolveRegistryTarget(businessSnap.val(), bizId);
  if (opts?.requireRegistered && target.state !== "registered") throw new Error(`business_registry_changed_${target.state}`);
  const registered = target.record;

  const bizName =
    (registered && typeof registered.name === "string" && registered.name) ||
    config.businessName ||
    "Unknown";

  // Embedded (legacy) exception metadata of this date's rows (non-financial).
  const dateRows = (inputs.rows as EntryExceptionFields[]).filter((r) => !!r && typeof r === "object" && r.date === date);
  const exceptionRows = dateRows.filter((r) => r.is_exception === true);
  const explicitNonException = dateRows.some((r) => r.is_exception === false);
  // DD-08: legacy exception metadata is used only when exactly ONE contributing row carries
  // it and no row explicitly disagrees (no winner row among several; the core flags
  // exception_rows_disagree). The structured envelope still wins.
  const legacyEntry: EntryExceptionFields | undefined = exceptionRows.length === 1 && !explicitNonException ? exceptionRows[0] : undefined;
  const effectiveException = resolveEffectiveException(structuredExceptionEnvelope, legacyEntry);
  const exceptionsByDate: Record<string, boolean> | undefined =
    effectiveException.origin === "structured" ? { [date]: effectiveException.isException } : undefined;

  const record = canonicalDayRecord({ ...inputs, exceptionsByDate }, date);
  const { revenue, fin } = toAnalyticsFinancials(record);
  const isException = effectiveException.origin === "structured"
    ? effectiveException.isException
    : record.inActual ? record.day.exception.isException : exceptionRows.length > 0;

  // Resolve location with sane defaults (Hadera) until the user sets it
  // explicitly through the map picker in SetupWizard.
  const lat = num(config.lat) || 32.4342;
  const lon = num(config.lon) || 34.9194;

  // Three layers of precedence for which Oref areas to filter alerts by:
  // 1. NEW: hierarchical region selection (region_ids / subregion_ids /
  //    custom_oref_areas) — resolved through the resolver, which de-dupes
  //    and returns a flat list of substrings.
  // 2. LEGACY: a pre-existing flat oref_areas list (config saved before
  //    we introduced the taxonomy).
  // 3. DEFAULT: the Hadera-area fallback, kept identical to what we had
  //    before so a brand-new biz still gets *something* useful until the
  //    owner picks a region.
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

  // Optional sources — soft-fail so one outage doesn't kill the whole doc.
  const [weather, alerts] = await Promise.all([
    fetchWeather(lat, lon, date),
    fetchOrefAlerts(orefAreas, date),
  ]);

  // Presence of the business date (VD-14/23): an explicit zero is an entered day.
  const hadEntry = revenue.had_entry;
  const calendar = buildCalendar(date);
  const war_day = classifyOperationalStatus(alerts, hadEntry);

  return {
    date,
    tenantId,
    bizId,
    bizName,
    is_exception: isException,
    exception: isException
      ? (effectiveException.origin === "structured" && effectiveException.state
          ? {
              reason: effectiveException.state.reasonCode ?? null,
              note: effectiveException.state.reasonText ?? null,
              set_at: effectiveException.state.updatedAt ?? null,
              set_by: effectiveException.state.updatedBy ?? null,
            }
          : legacyEntry
            ? {
                reason: legacyEntry.exception_reason ?? null,
                note: legacyEntry.exception_note ?? null,
                set_at: legacyEntry.exception_set_at ?? null,
                set_by: legacyEntry.exception_set_by ?? null,
              }
            : { reason: null, note: null, set_at: null, set_by: null })
      : null,
    revenue,
    fin,
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

// ── Persist to Firebase ───────────────────────────────────────────────────────

export async function saveAnalyticsDoc(doc: AnalyticsDoc): Promise<void> {
  const db = getDb();
  // Per-day path so backfills are idempotent and queries are cheap.
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
    // A current-day / future-date doc is a non-Actual context doc (D-1, VD-30): the empty
    // insights path, saved under the date so the browser readback contract holds.
    if (todayDoc.fin && todayDoc.fin.inActual === false) {
      const emptyDoc = buildInsights({ ...(todayDoc as unknown as AnalyticsDailyInput), revenue: { ...(todayDoc.revenue as unknown as AnalyticsDailyInput["revenue"]), had_entry: false } }, []);
      await saveInsightsDoc(tenantId, bizId, emptyDoc);
      return;
    }
    const history = await loadAnalyticsHistory(tenantId, bizId, date, 45);
    const insightsDoc = buildInsights(todayDoc as unknown as AnalyticsDailyInput, history as unknown as AnalyticsDailyInput[]);
    await saveInsightsDoc(tenantId, bizId, insightsDoc);
  } catch (err) {
    console.error(
      `[insights] ${tenantId}:${bizId} ${date} failed:`,
      (err as Error)?.message ?? "unknown"
    );
  }
}

// ── Iterate active businesses (mirrors snapshotBuilder discovery) ────────────

/** One failed business (or, with `bizId: null`, a tenant registry / the discovery itself) of a nightly run. */
export type AnalyticsRunFailure = { tenantId: string | null; bizId: string | null; error: string };

export async function buildAnalyticsForAll(
  date: string
): Promise<{ docs: AnalyticsDoc[]; failures: AnalyticsRunFailure[] }> {
  const db = getDb();
  const docs: AnalyticsDoc[] = [];
  const failures: AnalyticsRunFailure[] = [];

  // ── Hardened business discovery ────────────────────────────────────────────
  // Merges BOTH sources on every run — proactive_biz_index AND
  // tenants/*/app/business — then de-dupes by (tenantId, bizId).
  // Previous behavior consulted app/business only when the index yielded zero
  // entries, so a single stale/partial index entry silently excluded every
  // business missing from it. Inclusion is default-on: a business is skipped
  // ONLY when an explicit inactive/disabled/deleted/archived flag is present.
  // Missing optional fields never exclude a business.

  type DiscoveredBusiness = {
    tenantId: string;
    bizId: string;
    fromIndex: boolean;
    fromAppBusiness: boolean;
  };

  const discovered = new Map<string, DiscoveredBusiness>();
  const addBiz = (source: "index" | "appBusiness", tenantId: unknown, bizId: unknown): boolean => {
    if (typeof tenantId !== "string" || typeof bizId !== "string") return false;
    const t = tenantId.trim();
    const b = bizId.trim();
    if (!t || !b) return false;
    if (t === b) {
      legacySelfSkipped++;
      console.warn(`[analytics/discovery] skipping legacy self business ${t}:${b}`);
      return false;
    }

    const key = `${t}|${b}`;
    const existing = discovered.get(key);
    if (existing) {
      if (source === "index") existing.fromIndex = true;
      else existing.fromAppBusiness = true;
      return true;
    }

    discovered.set(key, {
      tenantId: t,
      bizId: b,
      fromIndex: source === "index",
      fromAppBusiness: source === "appBusiness",
    });
    return true;
  };

  // True only when an EXPLICIT negative flag exists. `active === undefined`
  // (missing field) must NOT exclude a business. Also honors a string
  // `status` field ("inactive" | "disabled" | "deleted" | "archived"),
  // compared lowercase/trimmed.
  const INACTIVE_STATUSES = new Set(["inactive", "disabled", "deleted", "archived"]);
  const isExplicitlyInactive = (v: Record<string, unknown>): boolean =>
    v.active === false ||
    v.inactive === true ||
    v.disabled === true ||
    v.deleted === true ||
    v.archived === true ||
    (typeof v.status === "string" && INACTIVE_STATUSES.has(v.status.trim().toLowerCase()));

  // Lightweight discovery telemetry — sanitized counts only, no payloads.
  let fromIndex = 0;
  let fromAppBusiness = 0;
  let malformedSkipped = 0;
  let inactiveSkipped = 0;
  let legacySelfSkipped = 0;
  let indexOnlySkipped = 0;
  // M1 R2: a business whose registry identity is AMBIGUOUS (duplicated / colliding records) is not built — no analytics or
  // insights doc for an identity the registry cannot establish — and is reported as a failure of the run, never omitted.
  const ambiguousTargets = new Map<string, { tenantId: string; bizId: string }>();
  // M1 R3: registry failures are reported, never a clean empty run — an unreadable registry node (not the runtime
  // `{ _v: "<JSON array>" }` envelope), a non-empty registry in which no element names a business, a stored id that is not
  // exact, and a failed tenants read. None of them is built: no analytics or insights doc is persisted for them.
  const registryFailures: AnalyticsRunFailure[] = [];
  const unreadableTenants = new Set<string>();
  const reportRegistryFailure = (f: AnalyticsRunFailure) => {
    if (!registryFailures.some((x) => x.tenantId === f.tenantId && x.bizId === f.bizId)) registryFailures.push(f);
  };

  // Source 1: proactive_biz_index (optional — absence is not an error).
  try {
    const indexSnap = await db.ref("proactive_biz_index").once("value");
    const indexData = indexSnap.val();
    if (indexData && typeof indexData === "object") {
      for (const [key, rawValue] of Object.entries(indexData)) {
        // Primitive legacy entries: `"tenantId:bizId": true | false`.
        // `false` is an EXPLICIT inactive marker — skip it. Only `true` is
        // accepted as legacy-active (ids come from the colon key below);
        // any other primitive is malformed.
        if (rawValue === false) {
          inactiveSkipped++;
          console.log(
            `[analytics/discovery] skipping explicitly inactive index entry key="${key}" (false)`
          );
          continue;
        }
        const value =
          rawValue && typeof rawValue === "object"
            ? (rawValue as Record<string, unknown>)
            : null;
        if (value === null && rawValue !== true) {
          malformedSkipped++;
          console.warn(
            `[analytics/discovery] ignoring malformed proactive_biz_index entry key="${key}"`
          );
          continue;
        }

        // Prefer explicit ids stored in the value.
        let tenantId = value && typeof value.tenantId === "string" ? value.tenantId : "";
        let bizId = value && typeof value.bizId === "string" ? value.bizId : "";

        // Legacy colon keys "tenantId:bizId" — exact 2-part keys only.
        // No underscore-key reverse engineering: the ids themselves contain
        // underscores, so splitting on "_" would be ambiguous.
        if (!tenantId || !bizId) {
          const parts = key.split(":");
          if (parts.length === 2 && parts[0] && parts[1]) {
            tenantId = parts[0];
            bizId = parts[1];
          }
        }

        if (!tenantId || !bizId) {
          // Sanitized: key + ids only, never the value payload.
          malformedSkipped++;
          console.warn(
            `[analytics/discovery] ignoring malformed proactive_biz_index entry key="${key}"`
          );
          continue;
        }

        if (value && isExplicitlyInactive(value)) {
          inactiveSkipped++;
          console.log(
            `[analytics/discovery] skipping explicitly inactive index entry ${tenantId}:${bizId}`
          );
          continue;
        }

        if (addBiz("index", tenantId, bizId)) fromIndex++;
      }
    }
  } catch (err) {
    console.error("[analytics] proactive_biz_index read failed:", err);
  }

  // Source 2: ALWAYS scan tenants/*/app/business (merged, not fallback-only).
  // M1 R3: each tenant's STORED registry node is decoded by the shared rule. An absent node is a tenant with no registry
  // (nothing to build, as before); any other node that is not the runtime envelope is unreadable and reported.
  try {
    const tenantsSnap = await db.ref("tenants").once("value");
    const tenantsData = tenantsSnap.val();
    if (tenantsData && typeof tenantsData === "object") {
      for (const [tenantId, tenantData] of Object.entries(tenantsData)) {
        const app = typeof tenantData === "object" && tenantData !== null ? (tenantData as any).app : undefined;
        const node: unknown = app && typeof app === "object" ? app.business : undefined;
        if (node === undefined || node === null) continue;
        const decoded = decodeRegistryNode(node);
        if (!decoded.ok) {
          unreadableTenants.add(tenantId);
          console.warn(`[analytics/discovery] unreadable app/business registry under tenant ${tenantId} (${decoded.reason})`);
          const ids = unreadableRegistryIds(node);
          if (ids.length === 0) reportRegistryFailure({ tenantId, bizId: null, error: "business_registry_unreadable" });
          for (const id of ids) reportRegistryFailure({ tenantId, bizId: id, error: "business_registry_unreadable" });
          continue;
        }
        let named = 0;
        for (const biz of decoded.list as unknown[]) {
          if (!biz || typeof biz !== "object" || Array.isArray(biz) || typeof (biz as { id?: unknown }).id !== "string" || !(biz as { id: string }).id) {
            malformedSkipped++;
            console.warn(
              `[analytics/discovery] ignoring malformed app/business entry under tenant ${tenantId}`
            );
            continue;
          }
          named++;
          const id = (biz as { id: string }).id;
          if (!isExactNightlyBizId(id)) {
            reportRegistryFailure({ tenantId, bizId: id, error: "business_id_not_exact" });
            continue;
          }
          const state = classifyRegistryTarget(node, id).state;
          if (state === "ambiguous") {
            const key = `${tenantId.trim()}|${id}`;
            if (!ambiguousTargets.has(key)) {
              ambiguousTargets.set(key, { tenantId: tenantId.trim(), bizId: id });
              console.warn(`[analytics/discovery] refusing ambiguous registry identity ${tenantId}:${id}`);
            }
            continue;
          }
          if (state !== "registered") {
            reportRegistryFailure({ tenantId, bizId: id, error: `business_registry_${state}` });
            continue;
          }
          if (isExplicitlyInactive(biz as Record<string, unknown>)) {
            inactiveSkipped++;
            console.log(
              `[analytics/discovery] skipping explicitly inactive business ${tenantId}:${id}`
            );
            continue;
          }
          if (addBiz("appBusiness", tenantId, id)) fromAppBusiness++;
        }
        // a non-empty registry in which NO element names a business (only bare nulls / id-less records) is not
        // "no businesses": it is reported, exactly as the page refuses to treat it as a first-business setup
        if (decoded.list.length > 0 && named === 0) {
          reportRegistryFailure({ tenantId, bizId: null, error: "business_registry_no_valid_record" });
        }
      }
    }
  } catch (err) {
    console.error("[analytics] tenant discovery failed:", (err as Error)?.message ?? "unknown");
    // M1 R3: a failed tenants read is a failed discovery, never a clean empty run. Index-only businesses are never built
    // (below), so nothing is built from this run.
    reportRegistryFailure({ tenantId: null, bizId: null, error: "business_discovery_failed" });
  }

  const afterDedupe = discovered.size;
  const activeBusinesses: Array<{ tenantId: string; bizId: string }> =
    Array.from(discovered.values()).filter((candidate) => {
      if (ambiguousTargets.has(`${candidate.tenantId}|${candidate.bizId}`)) return false;
      if (candidate.fromAppBusiness) return true;
      // M1 R3: an indexed business of a tenant whose registry is unreadable is a reported failure, not a silent skip
      if (unreadableTenants.has(candidate.tenantId)) {
        reportRegistryFailure({ tenantId: candidate.tenantId, bizId: candidate.bizId, error: "business_registry_unreadable" });
        return false;
      }
      indexOnlySkipped++;
      console.warn(
        `[analytics/discovery] skipping index-only business ${candidate.tenantId}:${candidate.bizId}`
      );
      return false;
    });
  console.log(
    `[analytics/discovery] summary fromIndex=${fromIndex} fromAppBusiness=${fromAppBusiness} ` +
      `afterDedupe=${afterDedupe} eligibleAfterValidation=${activeBusinesses.length} ` +
      `malformedSkipped=${malformedSkipped} inactiveSkipped=${inactiveSkipped} ` +
      `legacySelfSkipped=${legacySelfSkipped} indexOnlySkipped=${indexOnlySkipped}`
  );

  for (const { tenantId, bizId } of activeBusinesses) {
    try {
      const doc = await buildAnalyticsForBiz(tenantId, bizId, date, { requireRegistered: true });
      await saveAnalyticsDoc(doc);
      // Insight Engine v1 — isolated, never throws (see buildAndSaveInsights).
      await buildAndSaveInsights(doc.tenantId, doc.bizId, doc.date, doc);
      docs.push(doc);
    } catch (err) {
      console.error(`[analytics] biz ${tenantId}:${bizId} failed:`, err);
      failures.push({ tenantId, bizId, error: String((err as Error)?.message ?? err) });
    }
  }
  for (const { tenantId, bizId } of ambiguousTargets.values()) {
    failures.push({ tenantId, bizId, error: "business_registry_ambiguous" });
  }
  failures.push(...registryFailures);

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
