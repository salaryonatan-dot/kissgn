# Analytics Coverage Validation (Phase 4, hardened)

## What the release needs
The forecast engine (`src/services/forecastService.ts`, threshold **5** valid days) and
alert checkers (`src/alerts/checkers.ts`) read the **flat per-business** source
`tenants/{tid}/biz:{bizId}:analytics:daily:{YYYY-MM-DD}` with `revenue.{total, payroll,
food_cost}`. The legacy tenant-wide `tenants/{tid}/analytics/*` node is Rules-locked; no
active reader remains. This audit **never writes to Production** and makes no POS/external calls.

## Hardened semantics (pure `lib/analytics-model.mjs`, tested in `test/analytics-audit.test.mjs`)
- **Complete enumeration:** active businesses = canonical `app/business` registry ∪ discovered
  `biz:*:analytics:daily:*` keys ∪ other `biz:*` keys. **No business is silently omitted.**
- **Unknown analytics businesses** (analytics data for a business not in the registry) are
  surfaced separately (`inRegistry:false`, `unknownAnalyticsBusinessCount`).
- **Strict metrics** (mirrors `strictDailyMetrics.js`): zero is valid; **missing key ≠ zero**
  (→ MISSING_METRIC); present-but-non-finite (string/null/NaN/±Infinity/bool/object) → MALFORMED.
- **Future-dated docs excluded**: "today" is computed in the business timezone
  (default Asia/Jerusalem, injectable via `--today` for determinism). Future dates are excluded
  from valid coverage, the 30/60/90-day counts, and the latest-valid-date — and reported as
  suspicious evidence (`futureDated`). Invalid calendar dates are likewise excluded (`invalidDate`).
- **Latest valid business date** is the newest VALID PAST date only.

## Classifications
| Category | Meaning |
|---|---|
| READY | ≥5 valid past daily docs; forecast computes; checkers get valid data |
| INSUFFICIENT_HISTORY | 1–4 valid docs; forecast returns null (safe) |
| MALFORMED_DATA | docs exist but present metrics are non-finite / only future/invalid-dated |
| MISSING_METRIC | docs exist but a required metric key is absent |
| LEGACY_ONLY | only the legacy tenant-wide node present; no flat data |
| NO_DATA | no analytics docs for an active business |

## Acceptance guidance
- READY / INSUFFICIENT_HISTORY are safe to ship (both fail safe).
- MALFORMED_DATA / MISSING_METRIC in volume → investigate the daily-builder; invalid days are
  skipped by the runtime and cannot create false alerts.
- LEGACY_ONLY / NO_DATA for an active business → no flat analytics yet; forecast/alerts are
  inert for it (no regeneration performed here).

## How to run (operator, READ-ONLY)
```
GOOGLE_APPLICATION_CREDENTIALS=/path/to/readonly-sa.json \
FIREBASE_DATABASE_URL="https://<project>.firebaseio.com" \
node docs/production-readiness/analytics-audit.mjs --tenant <tenantId> [--today YYYY-MM-DD] [--tz Asia/Jerusalem]
```

## Planning-environment status
Not executed here (no Production read credentials). Operator must run before Go.
