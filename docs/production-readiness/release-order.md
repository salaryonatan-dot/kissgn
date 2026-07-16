# Release Order (Phase 5)

## Incompatibility analysis (where things break if ordered wrong)
| Scenario | Breaks? | Why |
|---|---|---|
| New frontend + OLD Rules | Mostly OK | New client uses server-mediated `/api/admin` for parameterized checklist/analytics; old permissive Rules still allow legacy direct paths. Low risk. |
| OLD frontend + NEW (restrictive) Rules | **BREAKS** | Old client writes biz-scoped data via direct RTDB; new Rules require `biz_access`. Without grants → PERMISSION_DENIED for managers/shift/viewers. |
| New API + OLD data model | OK | `api/admin.js` reads/writes the same biz-scoped keys; version-token CAS + strict validation are backward-tolerant. |
| **New Rules before biz_access backfill** | **LOCKOUT** | managers/shift_managers/viewers without `biz_access` grants lose access to their business data. |

The two hard constraints: (a) do **not** deploy restrictive Rules until `biz_access`
coverage is READY (no NEEDS_BACKFILL for active users); (b) deploy Rules and the new
frontend **together** (old frontend cannot live under new Rules).

## Recommended exact sequence
1. **API/server + alert checkers first.** Promote the new Vercel deployment (build from
   HEAD `a499c8d`) that contains `api/admin.js` + bundled server modules. This is
   backward-compatible with the current frontend and current (permissive) Rules.
2. **Verify new APIs while old frontend still live.** Authenticated read/write smoke of
   `/api/admin` server-mediation, entry-exception ops, analytics reads (see smoke-tests.md,
   API section). Confirm crons (proactive/run, alerts/run, daily-builder, daily-snapshot)
   run without errors and send no unexpected mail.
3. **biz_access dry-run approval.** Run `biz-access-audit.mjs` (read-only). Require READY
   (or an explicitly approved backfill list). Do NOT proceed to Rules until coverage is green.
4. **Approved biz_access backfill (only if separately authorized).** Run
   `scripts/backfill-biz-access.mjs` — dry-run first, then apply ONLY under written
   authorization. Re-run the audit to confirm READY.
5. **Coordinated frontend + restrictive Rules window (maintenance window).** In one window:
   deploy `database.rules.json` (Firebase) AND promote the new frontend (`index.html`)
   together. Keep the window short; announce brief maintenance.
6. **Post-deploy authenticated smoke tests** (smoke-tests.md) across roles + isolation.
7. **Monitoring period** (≥24–48h): watch auth-denial rates, `/api/admin` 4xx/409, cron
   logs, alert email volume, forecast insufficient-data rate.
8. **Rollback criteria** (rollback-plan.md): trip on cross-tenant/business exposure,
   mass PERMISSION_DENIED for legitimate users, cron failures, or unexpected mail/mutation.

## Safe-window notes
- Steps 1–2 have no user-facing lockout risk.
- The only lockout-risk step is 5; it is gated by 3–4 being green.
- If backfill is NOT authorized, stop after step 2 and hold Rules+frontend (steps 5+).
