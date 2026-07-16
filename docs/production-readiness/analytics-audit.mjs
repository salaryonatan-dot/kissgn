// READ-ONLY analytics coverage audit for the Marjin Foundation Release.
//
// NEVER writes. Only .once("value") reads. Verifies the flat per-business
// analytics source biz:{bizId}:analytics:daily:{YYYY-MM-DD} required by the
// forecast engine and the alert checkers. Does NOT call POS/external services
// and does NOT regenerate analytics.
//
// Usage (operator, read-only creds):
//   GOOGLE_APPLICATION_CREDENTIALS=/path/to/readonly-sa.json \
//   FIREBASE_DATABASE_URL="https://<project>.firebaseio.com" \
//   node docs/production-readiness/analytics-audit.mjs --tenant <tenantId> [--days 90]
//
// Classifications per business: READY, INSUFFICIENT_HISTORY, MALFORMED_DATA,
// MISSING_METRIC, LEGACY_ONLY, NO_DATA.

import admin from "firebase-admin";

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const TENANT = arg("--tenant");
const WINDOW = Number(arg("--days", "90"));
const FORECAST_MIN = 5;   // forecastService requires >=5 daily docs to forecast
if (!TENANT) { console.error("ERROR: --tenant <tenantId> required"); process.exit(2); }
if (!process.env.GOOGLE_APPLICATION_CREDENTIALS && !process.env.FIREBASE_DATABASE_EMULATOR_HOST) {
  console.error("ERROR: provide read-only GOOGLE_APPLICATION_CREDENTIALS (or FIREBASE_DATABASE_EMULATOR_HOST). Read-only.");
  process.exit(2);
}

// Strict finite parse — mirrors lib/analytics/strictDailyMetrics.js semantics.
function finite(v) {
  if (typeof v === "number") return Number.isFinite(v) ? v : undefined;
  if (typeof v === "string") { const t = v.trim(); if (t === "") return undefined; const n = Number(t); return Number.isFinite(n) ? n : undefined; }
  return undefined;
}
function isoDaysAgo(n) { const d = new Date(); d.setUTCDate(d.getUTCDate() - n); return d.toISOString().slice(0, 10); }

async function main() {
  admin.initializeApp({
    databaseURL: process.env.FIREBASE_DATABASE_URL ||
      (process.env.FIREBASE_DATABASE_EMULATOR_HOST ? `http://${process.env.FIREBASE_DATABASE_EMULATOR_HOST}?ns=demo` : undefined),
  });
  const db = admin.database();
  const t = (await db.ref(`tenants/${TENANT}`).once("value")).val() || {};

  // Discover businesses + collect their flat analytics daily docs.
  const bizIds = new Set();
  const dailyByBiz = {};        // bizId -> { date -> doc }
  let legacyPresent = false;
  for (const [k, v] of Object.entries(t)) {
    const m = k.match(/^biz:([^:]+):analytics:daily:(\d{4}-\d{2}-\d{2})$/);
    if (m) { bizIds.add(m[1]); (dailyByBiz[m[1]] ||= {})[m[2]] = v; continue; }
    const b = k.match(/^biz:([^:]+):/); if (b) bizIds.add(b[1]);
  }
  if (t.analytics && t.analytics.daily) legacyPresent = true; // legacy tenant-wide node (should be orphaned/locked)

  const cutoff = { d30: isoDaysAgo(30), d60: isoDaysAgo(60), d90: isoDaysAgo(90) };
  const results = {};
  const cats = { READY: 0, INSUFFICIENT_HISTORY: 0, MALFORMED_DATA: 0, MISSING_METRIC: 0, LEGACY_ONLY: 0, NO_DATA: 0 };

  for (const biz of bizIds) {
    const docs = dailyByBiz[biz] || {};
    const dates = Object.keys(docs).sort();
    let valid = 0, malformed = 0, missingMetric = 0;
    let v30 = 0, v60 = 0, v90 = 0;
    for (const date of dates) {
      const rev = docs[date] && typeof docs[date] === "object" ? docs[date].revenue : null;
      if (!rev || typeof rev !== "object" || Array.isArray(rev)) { malformed++; continue; }
      const total = finite(rev.total), payroll = finite(rev.payroll), food = finite(rev.food_cost);
      if (total === undefined || payroll === undefined || food === undefined) { missingMetric++; continue; }
      valid++;
      if (date >= cutoff.d30) v30++;
      if (date >= cutoff.d60) v60++;
      if (date >= cutoff.d90) v90++;
    }
    const latest = dates.length ? dates[dates.length - 1] : null;
    let category;
    if (dates.length === 0) category = legacyPresent ? "LEGACY_ONLY" : "NO_DATA";
    else if (malformed > 0 && valid === 0) category = "MALFORMED_DATA";
    else if (missingMetric > 0 && valid === 0) category = "MISSING_METRIC";
    else if (valid < FORECAST_MIN) category = "INSUFFICIENT_HISTORY";
    else category = "READY";
    cats[category]++;
    results[biz] = {
      latestBusinessDate: latest, totalDocs: dates.length, valid, malformed, missingMetric,
      validLast30: v30, validLast60: v60, validLast90: v90,
      forecast: valid >= FORECAST_MIN ? "will-forecast" : "insufficient-data (UI returns null, safe)",
      alertCheckerInput: valid > 0 ? "receives valid days only (invalid days skipped)" : "no valid days — checkers produce no alerts (safe, not false)",
      category,
    };
  }

  console.log(JSON.stringify({
    tenantId: TENANT, generatedAt: new Date().toISOString(), windowDays: WINDOW,
    legacyTenantWideAnalyticsPresent: legacyPresent,
    businessesDiscovered: bizIds.size, categories: cats, perBusiness: results,
  }, null, 2));

  await admin.app().delete().catch(() => {});
  const attention = cats.INSUFFICIENT_HISTORY + cats.MALFORMED_DATA + cats.MISSING_METRIC + cats.NO_DATA;
  process.exit(attention > 0 ? 3 : 0);
}
main().catch((e) => { console.error("AUDIT ERROR:", e && (e.message || e)); process.exit(2); });
