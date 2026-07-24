# Cron Auth Inventory

Source of truth inspected: `vercel.json`, `api/analytics/daily-builder.ts`, `api/proactive/run.ts`, `api/alerts/run.ts`, `lib/alertsCore.js`, `lib/securityContext.js`, and `api/daily-snapshot/run.ts`.

## Configured Crons

| Cron path | Schedule | Matching route | Accepts `Authorization: Bearer CRON_SECRET` | Accepts `x-vercel-cron` | Notes |
|---|---:|---|---|---|---|
| `/api/analytics/daily-builder` | `0 23 * * *` | `api/analytics/daily-builder.ts` | yes | yes | `verifyAuth` accepts either for normal GET cron and legacy manual/backfill paths. Separate `beecomm_diagnose` branch uses Bearer only and does not honor `x-vercel-cron`. |
| `/api/proactive/run` | `0 3 * * *` | `api/proactive/run.ts` | yes | yes | Cron/manual branch unchanged in this slice. Authenticated read actions now use `requireBizContext`; cron auth was not redesigned. |
| `/api/alerts/run` | `0 4 * * *` | `api/alerts/run.ts` | yes | no | Delegates cron branch to `lib/securityContext.js` `requireCron`, which explicitly ignores `x-vercel-cron` and requires Bearer `CRON_SECRET`. Existing tests assert this behavior. |
| `/api/daily-snapshot/run` | `5 4 * * *` | `api/daily-snapshot/run.ts` | yes | yes | `verifyAuth` accepts either Vercel cron header or Bearer `CRON_SECRET`. |

## Removed Phantom Cron

`/api/whatsapp-daily` was removed from `vercel.json`.

Evidence:

- No `api/whatsapp-daily.js`, `api/whatsapp-daily.ts`, `api/whatsapp-daily/index.js`, or `api/whatsapp-daily/index.ts` route exists.
- `api/whatsapp.js` remains disabled with HTTP 410.
- Static test `test/security/vercel-cron-routes.test.mjs` now asserts every configured cron path resolves to an API route and asserts `/api/whatsapp-daily` remains absent.

## Inconsistencies

- Analytics, proactive, and daily-snapshot cron endpoints accept both `x-vercel-cron` and Bearer `CRON_SECRET`.
- Alerts cron accepts only Bearer `CRON_SECRET` through the canonical `requireCron` primitive.
- The codebase therefore has two cron-auth contracts today. This slice records that inconsistency but does not change it.

## Claims Requiring Real Vercel Runtime Evidence

- Whether Vercel Production cron invocations currently include `x-vercel-cron`.
- Whether Vercel Production cron invocations include any `Authorization` header.
- Whether `CRON_SECRET` is configured in the Production environment.
- Whether Vercel cron requests reach the functions exactly as represented by local route files and rewrite behavior.
- Whether any external production monitor or manual operator still invokes removed `/api/whatsapp-daily`.

