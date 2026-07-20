// PURE analytics-coverage classification model (no Firebase, no network).
// Enumerates active businesses from the canonical app/business registry UNION the
// discovered biz:*:analytics:daily:* keys, validates the flat per-business source
// biz:{bizId}:analytics:daily:{YYYY-MM-DD} with strict finite metrics, excludes
// future-dated / invalid-date documents, and classifies coverage.

import { parseAppBusiness } from "./biz-access-model.mjs";
import { makeRedactor } from "./redact.mjs";

// Strict finite parse -- mirrors lib/analytics/strictDailyMetrics.js.
// zero (number or numeric string) is VALID; missing/empty/NaN/Infinity/text/bool/obj invalid.
export function finiteMetric(v) {
  if (typeof v === "number") return Number.isFinite(v) ? v : undefined;
  if (typeof v === "string") { const t = v.trim(); if (t === "") return undefined; const n = Number(t); return Number.isFinite(n) ? n : undefined; }
  return undefined;
}

// Real calendar validation for a YYYY-MM-DD key (round-trips through UTC Date).
export function isRealDateKey(s) {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

const daysAgo = (todayIso, n) => {
  const [y, m, d] = todayIso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d)); dt.setUTCDate(dt.getUTCDate() - n);
  return dt.toISOString().slice(0, 10);
};

// Deterministic calendar-day difference between two normalized YYYY-MM-DD dates
// (fromIso - laterIso), using the supplied audit date — NOT the machine clock/timezone.
export function dataAgeDays(latestIso, todayIso) {
  if (!isRealDateKey(latestIso) || !isRealDateKey(todayIso)) return null;
  const toUTC = (iso) => { const [y, m, d] = iso.split("-").map(Number); return Date.UTC(y, m - 1, d); };
  return Math.round((toUTC(todayIso) - toUTC(latestIso)) / 86400000);
}

// Locale-independent, stable code-point string comparator (PR-005).
export const byCodePoint = (a, b) => (String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0);

// Strict metric check for one daily doc's revenue object.
// Structural non-object revenue -> MALFORMED. A required key ABSENT -> MISSING_METRIC
// ("missing is not zero"). A key PRESENT but non-finite (string/null/NaN/Infinity/
// bool/object) -> MALFORMED (present-but-invalid). Zero (number or numeric string) is VALID.
export function validDailyDoc(doc) {
  const rev = doc && typeof doc === "object" && !Array.isArray(doc) ? doc.revenue : null;
  if (!rev || typeof rev !== "object" || Array.isArray(rev)) return { valid: false, reason: "MALFORMED" };
  let missing = false, malformed = false;
  for (const key of ["total", "payroll", "food_cost"]) {
    const present = Object.prototype.hasOwnProperty.call(rev, key) && rev[key] !== undefined;
    if (!present) { missing = true; continue; }
    if (finiteMetric(rev[key]) === undefined) malformed = true;
  }
  if (malformed) return { valid: false, reason: "MALFORMED" };
  if (missing) return { valid: false, reason: "MISSING_METRIC" };
  return { valid: true };
}

// input: { tenantId, appBusinessRaw, dailyByBiz:{biz:{date:doc}}, dataKeyBizIds:[],
//          legacyPresent:boolean, today:"YYYY-MM-DD", forecastMin=5, salt }
export function classifyAnalytics(input) {
  const { appBusinessRaw = null, dailyByBiz = {}, dataKeyBizIds = [], legacyPresent = false, today, forecastMin = 5, maxDataAgeDays = 3, salt } = input;
  const redact = makeRedactor(salt);
  if (!isRealDateKey(today)) throw new Error("classifyAnalytics requires an injected 'today' as a real YYYY-MM-DD date");

  const biz = parseAppBusiness(appBusinessRaw);
  const registry = biz.businesses;                 // authoritative "active" set
  const registryMalformed = !biz.ok;

  // Complete enumeration: registry UNION analytics-key businesses UNION discovered biz keys.
  const universe = new Set([...registry, ...Object.keys(dailyByBiz), ...dataKeyBizIds]);

  const cutoff = { d30: daysAgo(today, 30), d60: daysAgo(today, 60), d90: daysAgo(today, 90) };
  const cats = { READY: 0, STALE_DATA: 0, INSUFFICIENT_HISTORY: 0, MALFORMED_DATA: 0, MISSING_METRIC: 0, LEGACY_ONLY: 0, NO_DATA: 0 };
  const perBusiness = {};

  for (const b of [...universe].sort(byCodePoint)) {
    const docs = dailyByBiz[b] || {};
    const dates = Object.keys(docs);
    let valid = 0, malformed = 0, missingMetric = 0, futureDated = 0, invalidDate = 0;
    let v30 = 0, v60 = 0, v90 = 0;
    let latestValid = null;
    for (const date of dates) {
      if (!isRealDateKey(date)) { invalidDate++; continue; }        // excluded + reported
      if (date > today) { futureDated++; continue; }                 // future excluded + reported (suspicious)
      const chk = validDailyDoc(docs[date]);
      if (!chk.valid) { if (chk.reason === "MISSING_METRIC") missingMetric++; else malformed++; continue; }
      valid++;
      if (!latestValid || date > latestValid) latestValid = date;    // latest VALID PAST date only
      if (date >= cutoff.d30) v30++;
      if (date >= cutoff.d60) v60++;
      if (date >= cutoff.d90) v90++;
    }

    const ageDays = latestValid ? dataAgeDays(latestValid, today) : null;
    const isStale = latestValid != null && ageDays != null && ageDays > maxDataAgeDays;

    let category;
    if (dates.length === 0) category = legacyPresent ? "LEGACY_ONLY" : "NO_DATA";
    else if (valid === 0 && malformed > 0) category = "MALFORMED_DATA";
    else if (valid === 0 && missingMetric > 0) category = "MISSING_METRIC";
    else if (valid === 0 && (futureDated > 0 || invalidDate > 0)) category = "MALFORMED_DATA"; // only future/invalid-dated docs
    else if (valid === 0) category = legacyPresent ? "LEGACY_ONLY" : "NO_DATA";
    else if (valid < forecastMin) category = "INSUFFICIENT_HISTORY";
    else if (isStale) category = "STALE_DATA";   // PR-001: enough valid days, but latest is too old
    else category = "READY";
    cats[category]++;

    const forecastActive = category === "READY";
    const alertsActive = category === "READY";
    perBusiness[b] = {
      inRegistry: registry.has(b),                 // false -> non-registry namespace (surfaced separately)
      totalDateKeys: dates.length,
      valid, malformed, missingMetric, futureDated, invalidDate,
      validLast30: v30, validLast60: v60, validLast90: v90,
      latestValidBusinessDate: latestValid,
      auditDate: today,
      dataAgeDays: ageDays,
      maxDataAgeDays,
      forecastActive, forecastSuppressed: !forecastActive,
      alertsActive, alertsSuppressed: !alertsActive,
      forecast: category === "READY" ? "will-forecast"
        : category === "STALE_DATA" ? "suppressed (STALE_DATA: latest valid date older than threshold)"
        : "insufficient-data / no-data (UI returns null, safe)",
      alertCheckerInput: category === "READY" ? "valid recent days feed checkers"
        : category === "STALE_DATA" ? "suppressed (stale) — do not rely on alerts"
        : (valid > 0 ? "valid past days only (invalid/future/malformed skipped)" : "no valid days -> no alerts (safe, not false)"),
      stale: category === "STALE_DATA" ? { latestValidBusinessDate: latestValid, auditDate: today, dataAgeDays: ageDays, maxDataAgeDays } : undefined,
      category,
      suspiciousEvidence: (futureDated || invalidDate) ? { futureDated, invalidDate } : undefined,
    };
  }

  // PR-002: a non-registry biz namespace is only an UNKNOWN ANALYTICS business when it
  // actually contains analytics date keys. Namespaces with zero analytics date keys are
  // reported separately (they are not "unknown analytics businesses").
  const nonRegistry = [...universe].filter((b) => !registry.has(b));
  const hasAnalyticsKeys = (b) => Object.keys(dailyByBiz[b] || {}).length > 0;
  const unknownAnalyticsBusinesses = nonRegistry.filter(hasAnalyticsKeys);
  const emptyNonRegistryBizNamespaces = nonRegistry.filter((b) => !hasAnalyticsKeys(b));
  // PR-005: deterministic, redacted, code-point-sorted alias lists (no raw namespace IDs).
  const unknownAnalyticsBusinessRefs = unknownAnalyticsBusinesses.map((b) => redact("biz", b)).sort(byCodePoint);
  const emptyNonRegistryBizNamespaceRefs = emptyNonRegistryBizNamespaces.map((b) => redact("biz", b)).sort(byCodePoint);

  const attention = cats.STALE_DATA + cats.INSUFFICIENT_HISTORY + cats.MALFORMED_DATA + cats.MISSING_METRIC + cats.NO_DATA;
  return {
    today, forecastMin, maxDataAgeDays,
    legacyTenantWideAnalyticsPresent: legacyPresent,
    registryMalformed,
    businessesDiscovered: universe.size,
    registrySize: registry.size,
    unknownAnalyticsBusinessCount: unknownAnalyticsBusinesses.length,
    unknownAnalyticsBusinessRefs,
    emptyNonRegistryBizNamespaceCount: emptyNonRegistryBizNamespaces.length,
    emptyNonRegistryBizNamespaceRefs,
    categories: cats,
    perBusiness,
    needsAttention: attention > 0 || registryMalformed,
  };
}
