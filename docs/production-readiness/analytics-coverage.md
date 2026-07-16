# Analytics Coverage Validation (Phase 4)

## What the release needs
The forecast engine (`src/services/forecastService.ts`) and alert checkers
(`src/alerts/checkers.ts`) read the **flat per-business** source
`tenants/{tid}/biz:{bizId}:analytics:daily:{YYYY-MM-DD}` with `revenue.{total, payroll,
food_cost, ...}`. The legacy tenant-wide `tenants/{tid}/analytics/*` node is Rules-locked
and no active reader remains (`getHourlyMetrics`/`dailyMetricsRef` removed; hourly workflow retired).

## Safety already built into the release (reduces coverage risk)
- **Strict validation** (`lib/analytics/strictDailyMetrics.js`): a daily doc enters
  alert math only if `total`, `payroll`, `food_cost` are all finite numerics; otherwise
  the whole date is **skipped** — malformed/missing data cannot create a false alert.
- **Forecast fail-closed**: `forecastService` needs ≥5 valid daily docs; fewer → returns
  `null` (UI shows insufficient-data, never a fabricated forecast). Missing business id → `null`.
- **Hourly-sales questions**: return the deterministic `unsupported_hourly` response (no fabrication).

## How to run (operator, READ-ONLY)
```
GOOGLE_APPLICATION_CREDENTIALS=/path/to/readonly-sa.json \
FIREBASE_DATABASE_URL="https://<project>.firebaseio.com" \
node docs/production-readiness/analytics-audit.mjs --tenant <tenantId> --days 90
```
Reads only; no POS/external calls; no regeneration. Emits per-business coverage +
latest business date + 30/60/90-day valid-doc counts + classification.

## Classifications (filled in by the operator run)
| Category | Meaning |
|---|---|
| READY | ≥5 valid daily docs; forecast will compute; checkers get valid data |
| INSUFFICIENT_HISTORY | <5 valid docs; forecast returns insufficient-data (safe) |
| MALFORMED_DATA | docs exist but revenue objects invalid (skipped by strict validation) |
| MISSING_METRIC | docs missing total/payroll/food_cost (skipped) |
| LEGACY_ONLY | only legacy tenant-wide analytics present (locked; no flat data) |
| NO_DATA | no analytics docs for the business |

## Acceptance guidance
- `READY` / `INSUFFICIENT_HISTORY` are acceptable to ship (both fail safe: forecast null,
  checkers emit no false alerts).
- `MALFORMED_DATA` / `MISSING_METRIC` in significant volume → investigate the daily-builder
  before relying on alerts, but they do **not** break the release (invalid days are skipped).
- `LEGACY_ONLY` for an active business → that business has no flat analytics yet; forecast/alerts
  will be inert for it until the daily-builder cron populates flat docs (no regeneration in this task).

## Planning-environment status
Not executed here — no Production read credentials. Operator must run before Go.
