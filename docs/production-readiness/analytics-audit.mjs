// READ-ONLY analytics coverage audit — THIN CLI wrapper over the pure model in
// ./lib/analytics-model.mjs. NEVER writes to Production: performs only
// .once("value") reads. No POS/external calls, no analytics regeneration. No
// set/update/push/remove/transaction anywhere.
//
// Usage (operator, read-only Firebase credentials):
//   GOOGLE_APPLICATION_CREDENTIALS=/path/to/readonly-sa.json \
//   FIREBASE_DATABASE_URL="https://<project>.firebaseio.com" \
//   node docs/production-readiness/analytics-audit.mjs --tenant <tenantId> [--days 90] [--today YYYY-MM-DD] [--tz Asia/Jerusalem]

import admin from "firebase-admin";
import { pathToFileURL } from "node:url";
import { classifyAnalytics, isRealDateKey } from "./lib/analytics-model.mjs";
import { formatSafeError } from "./lib/redaction.mjs";

const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };

// "today" in the intended business timezone (default Asia/Jerusalem), injectable for determinism.
function businessToday(tz) {
  return new Date().toLocaleDateString("en-CA", { timeZone: tz }); // YYYY-MM-DD
}

async function main() {
  const TENANT = arg("--tenant");
  const TZ = arg("--tz", "Asia/Jerusalem");
  const TODAY = arg("--today", businessToday(TZ));
  const FORECAST_MIN = 5; // matches forecastService runtime threshold
  const MAX_DATA_AGE_DAYS = Number(arg("--max-data-age-days", "3")); // PR-001 staleness threshold
  if (!TENANT) { console.error("ERROR: --tenant <tenantId> required"); process.exit(2); }
  if (!isRealDateKey(TODAY)) { console.error(`ERROR: --today must be a real YYYY-MM-DD date (got ${TODAY})`); process.exit(2); }
  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS && !process.env.FIREBASE_DATABASE_EMULATOR_HOST) {
    console.error("ERROR: provide read-only GOOGLE_APPLICATION_CREDENTIALS (or FIREBASE_DATABASE_EMULATOR_HOST). This audit only reads.");
    process.exit(2);
  }

  admin.initializeApp({
    databaseURL: process.env.FIREBASE_DATABASE_URL ||
      (process.env.FIREBASE_DATABASE_EMULATOR_HOST ? `http://${process.env.FIREBASE_DATABASE_EMULATOR_HOST}?ns=demo` : undefined),
  });
  const db = admin.database();

  // Single READ-ONLY snapshot of the tenant subtree.
  const t = (await db.ref(`tenants/${TENANT}`).once("value")).val() || {};

  const dailyByBiz = {}; const dataKeyBizIds = new Set();
  for (const [k, v] of Object.entries(t)) {
    const m = k.match(/^biz:([^:]+):analytics:daily:(.+)$/);
    if (m) { (dailyByBiz[m[1]] ||= {})[m[2]] = v; dataKeyBizIds.add(m[1]); continue; }
    const b = k.match(/^biz:([^:]+):/); if (b) dataKeyBizIds.add(b[1]);
  }
  const legacyPresent = !!(t.analytics && t.analytics.daily);

  const result = classifyAnalytics({
    tenantId: TENANT,
    appBusinessRaw: t.app?.business ?? null,
    dailyByBiz,
    dataKeyBizIds: [...dataKeyBizIds],
    legacyPresent,
    today: TODAY,
    forecastMin: FORECAST_MIN,
    maxDataAgeDays: Number.isFinite(MAX_DATA_AGE_DAYS) && MAX_DATA_AGE_DAYS >= 0 ? MAX_DATA_AGE_DAYS : 3,
    salt: process.env.AUDIT_SALT,
  });

  console.log(JSON.stringify({ generatedAt: new Date().toISOString(), timezone: TZ, ...result }, null, 2));
  await admin.app().delete().catch(() => {});
  process.exit(result.needsAttention ? 3 : 0);
}

// main() runs ONLY on direct execution — never on import.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(formatSafeError(e)); process.exit(2); });
}
