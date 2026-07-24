# SECURITY.md - Marjin Dashboard

This document describes the current repository architecture as of this source
tree. Statements that depend on Firebase Console, Vercel project settings,
deployed aliases, cron runtime headers, or production data are marked
`UNKNOWN - REQUIRES RUNTIME VERIFICATION`.

## Architecture Overview

```text
Browser (index.html)
  |  Firebase Email/Password authentication
  |  Firebase ID token in Authorization: Bearer header for server endpoints
  v
Vercel Functions (/api/*)
  |  verify Firebase ID token with Admin SDK where auth is required
  |  re-read roles/membership/business access from RTDB where applicable
  |  use Admin SDK for server-authoritative writes and protected reads
  v
Firebase RTDB
  tenants/{tenantId}/...
  tenants/{tenantId}/biz:{bizId}:...
```

Current primary business-data ingestion is manual entry in the application.
No active Beecomm or Tabit ingestion endpoint currently feeds production data
from POS into the business metrics pipeline.

## Runtime Verification Required

The following cannot be proven from this repository alone:

- Firebase App Check enforcement: UNKNOWN - REQUIRES RUNTIME VERIFICATION.
- Currently deployed Firebase RTDB rules: UNKNOWN - REQUIRES RUNTIME VERIFICATION.
- Current production Vercel deployment commit: UNKNOWN - REQUIRES RUNTIME VERIFICATION.
- Production environment variable presence/values: UNKNOWN - REQUIRES RUNTIME VERIFICATION.
- Current Vercel cron request headers: UNKNOWN - REQUIRES RUNTIME VERIFICATION.
- Production backup configuration: UNKNOWN - REQUIRES RUNTIME VERIFICATION.

App Check support exists in the client, but enforcement status is UNKNOWN -
REQUIRES RUNTIME VERIFICATION.

## Authentication Model

- The active login path uses Firebase Email/Password authentication through
  `signInWithEmailAndPassword`.
- First-user setup creates a Firebase Email/Password user with
  `createUserWithEmailAndPassword`, then calls
  `POST /api/admin?action=bootstrap-self`.
- `window.apiFetch` sends Firebase ID tokens to server endpoints in the
  `Authorization: Bearer <token>` header when a logged-in user exists.
- Server endpoints that require user auth call `requireAuth`, which verifies
  Firebase ID tokens with the Admin SDK and `checkRevoked=true`.
- Roles are not trusted from JWT custom claims. The server re-reads membership
  and role state from RTDB through `requireTenantAccess`.
- Business-scoped server endpoints use `requireBizContext` or the established
  equivalent to validate `tenantId`, `bizId`, role policy, and `biz_access`.

## Role Model

Canonical role hierarchy in `lib/helpers.js`:

| Role | Current meaning in source |
|---|---|
| `viewer` | Lowest canonical RTDB role. Included in read-mode `requireBizContext`. |
| `shift_manager` | Canonical RTDB role above viewer. Included in read-mode `requireBizContext`; can write selected shift/checklist data through specific server actions. |
| `manager` | Canonical RTDB role above shift_manager. Included in read and write-mode `requireBizContext`. |
| `owner` | Owner-level canonical RTDB role. Has implicit all-business access in `biz_access` checks. |
| `super_owner` | Top owner-level role. Accepted by access checks and seeded by first-owner/bootstrap/client-admin flows, but not assignable to sub-users through `VALID_ROLES`. |
| `admin` | Not a canonical RTDB role. It appears as an admin screen/action concept gated by `super_owner`; do not infer a separate `admin` permission set. |

`VALID_ROLES` for assignable sub-user roles is:
`owner`, `manager`, `shift_manager`, `viewer`.

`requireBizContext` explicit role sets:

- Read: `viewer`, `shift_manager`, `manager`, `owner`, `super_owner`
- Write: `manager`, `owner`, `super_owner`

Other legacy/UI labels such as `staff` may appear in frontend code, but they are
not canonical server-side RTDB roles.

## RTDB Path Model

### Active Tenant And Identity Paths

- `tenants/{tenantId}/members/{uid}`
- `tenants/{tenantId}/roles/{uid}`
- `tenants/{tenantId}/biz_access/{bizId}/{uid}`
- `tenants/{tenantId}/access_meta/owner_guard`
- `tenants/{tenantId}/audit/roles/{auditId}`
- `tenants/{tenantId}/app/users`
- `tenants/{tenantId}/app/business`
- `tenants/{tenantId}/lookup/{username}`
- `user_tenants/{uid}`
- `user_active_biz/{uid}`
- `username_index/{username}`

`app-users` and `app-businesses` are client storage aliases in `index.html`;
they map to `tenants/{tenantId}/app/users` and
`tenants/{tenantId}/app/business`. Top-level `/app-users` and
`/app-businesses` are denied by RTDB rules.

### Active Business-Scoped Pattern

The active business-scoped pattern is:

```text
tenants/{tenantId}/biz:{bizId}:...
```

Current active examples include:

- `tenants/{tenantId}/biz:{bizId}:entries`
- `tenants/{tenantId}/biz:{bizId}:config`
- `tenants/{tenantId}/biz:{bizId}:suppliers`
- `tenants/{tenantId}/biz:{bizId}:fixed`
- `tenants/{tenantId}/biz:{bizId}:lastyear`
- `tenants/{tenantId}/biz:{bizId}:credits`
- `tenants/{tenantId}/biz:{bizId}:pettycash`
- `tenants/{tenantId}/biz:{bizId}:customer_compensations`
- `tenants/{tenantId}/biz:{bizId}:tasks`
- `tenants/{tenantId}/biz:{bizId}:logs`
- `tenants/{tenantId}/biz:{bizId}:active-log`
- `tenants/{tenantId}/biz:{bizId}:checklist_templates`
- `tenants/{tenantId}/biz:{bizId}:checklist_template`
- `tenants/{tenantId}/biz:{bizId}:checklist_template_items:{templateId}`
- `tenants/{tenantId}/biz:{bizId}:checklist_runs:{YYYY-MM-DD}`
- `tenants/{tenantId}/biz:{bizId}:checklist_simple_runs:{YYYY-MM-DD}:{templateId}`
- `tenants/{tenantId}/biz:{bizId}:analytics:daily:{YYYY-MM-DD}`
- `tenants/{tenantId}/biz:{bizId}:insights:daily:{YYYY-MM-DD}`

Direct client access to parameterized server-mediated keys such as checklist
items/runs and daily analytics/insights is denied by rules; `/api/admin` reads
or writes them with Admin SDK after auth and `biz_access` checks.

### Legacy Or Dormant Paths Still Present

- Top-level tenant keys such as `tenants/{tenantId}/entries`,
  `config`, `suppliers`, `fixed`, `tasks`, `logs`, `active-log`, and `pin`
  remain in rules/code for legacy compatibility but are not the active
  business-scoped model.
- `tenants/{tenantId}/analytics/daily/{branchId}/{date}` is present in rules
  and legacy code, but the active daily builder writes
  `tenants/{tenantId}/biz:{bizId}:analytics:daily:{date}`.
- `tenants/{tenantId}/analytics/hourly`, `labor`, `products`, `purchases`,
  `baselines`, and `anomalies` are referenced by older analytics repository
  helpers and should not be described as the current primary daily analytics
  storage path without fresh implementation review.

## Agent And Analytics Data Sources

- `src/analytics/dailyBuilder.ts` builds daily analytics documents from manual
  entries at `tenants/{tenantId}/biz:{bizId}:entries`, plus weather/Oref/calendar
  context, then writes `biz:{bizId}:analytics:daily:{date}` and
  `biz:{bizId}:insights:daily:{date}`.
- Some surfaces read built analytics/insights documents through server-mediated
  daily range actions.
- The agent analytics repository currently may recompute metrics directly from
  raw manual entries instead of reading only built `analytics:daily` documents.
  This divergence is a known Core-Hardening issue pending a shared KPI engine.

Do not claim that the agent reads only from `analytics/daily`.

## POS And External Data Sources

- There is no active `/api/beecomm` route.
- There is no active `/api/tabit` route.
- No active Beecomm or Tabit ingestion endpoint currently feeds production
  business metrics.
- `api/analytics/daily-builder.ts` contains a read-only
  `action: "beecomm_diagnose"` diagnostic branch. It requires Bearer
  `CRON_SECRET`, calls `fetchBeecommDaily`, returns a normalized preview, and
  does not persist analytics, raw payloads, import logs, or business data.
- `src/pos/adapters/beecomm.ts` and `src/pos/adapters/tabit.ts` are inert
  placeholder connectors that throw `not_implemented`.
- `lib/analytics/sources.js` contains Beecomm/Tabit fetch helpers used by
  diagnostic or legacy/dormant code paths. Credentials may exist in
  configuration, but that does not mean an active production integration exists.
- Pikud HaOref (`/api/oref`) and Open-Meteo weather context are active source
  concepts in analytics code; production behavior still depends on deployed
  runtime configuration and upstream availability.

## Branch Model

- `bizId` is the effective business scope.
- `branchId` is currently vestigial or constrained to `bizId` in guarded
  request parsing.
- Real multi-branch support is not implemented.
- Do not claim the application has working multi-branch readiness through
  `branchId="main"`.

## Audit Coverage

- Role/member changes are partially audited under
  `tenants/{tenantId}/audit/roles`.
- Owner-level role/delete operations also use the owner guard in
  `tenants/{tenantId}/access_meta/owner_guard`.
- Full destructive-action audit and full business-data audit are not yet
  complete.

## Active API Inventory

Actual route files under `api/`:

| Route file | Current status |
|---|---|
| `/api/admin` | Active unified dispatcher. Includes client/user/admin actions, first-owner `bootstrap-self`, role changes, entry exceptions, checklist docs, and daily analytics/insights reads. |
| `/api/agent/ask` | Active authenticated agent endpoint with tenant/business scope checks. |
| `/api/ai-chat` | Present route file; review behavior before treating as a hardened business-scoped endpoint. |
| `/api/alerts/run` | Active alerts endpoint. User reads/writes are business-authorized; cron branch uses Bearer `CRON_SECRET` only. |
| `/api/analytics/daily-builder` | Active analytics builder endpoint. Cron/manual builder paths plus read-only Beecomm diagnostic branch. |
| `/api/bootstrap-owner` | Disabled legacy endpoint; returns HTTP 410 for non-OPTIONS. |
| `/api/config` | Active config endpoint serving client Firebase config and optional App Check site key from environment. |
| `/api/create-tenant` | Disabled legacy endpoint; returns HTTP 410 for non-OPTIONS. |
| `/api/daily-snapshot/run` | Active daily snapshot endpoint. Cron/manual behavior still needs runtime verification for production auth headers. |
| `/api/oref` | Active Oref proxy/cache endpoint. |
| `/api/proactive/run` | Active proactive endpoint. Authenticated read actions use business scope; cron/manual branch auth is unchanged from prior behavior. |
| `/api/whatsapp` | Disabled legacy endpoint; returns HTTP 410 for non-OPTIONS. |

Nonexistent routes that must not be described as active:

- `/api/beecomm`
- `/api/tabit`
- `/api/admin-roles`
- `/api/analytics/backfill`
- `/api/analytics/check`
- `/api/whatsapp-daily`

Equivalent behavior may exist as an action on an active dispatcher, for example
`/api/admin?action=roles` or `POST /api/analytics/daily-builder` manual build.

## Cron Auth Inventory

Current source behavior:

- `/api/analytics/daily-builder`: accepts Vercel cron header or Bearer
  `CRON_SECRET` for normal cron/manual builder paths; diagnostic
  `beecomm_diagnose` accepts Bearer `CRON_SECRET` only.
- `/api/proactive/run`: cron/manual branch accepts Vercel cron header or Bearer
  `CRON_SECRET`; authenticated read actions use `requireBizContext`.
- `/api/alerts/run`: cron branch accepts Bearer `CRON_SECRET` only through
  `requireCron`; `x-vercel-cron` alone is not accepted.
- `/api/daily-snapshot/run`: accepts Vercel cron header or Bearer
  `CRON_SECRET`.

Whether Vercel Production sends `x-vercel-cron`, sends `Authorization`, or has
`CRON_SECRET` configured is UNKNOWN - REQUIRES RUNTIME VERIFICATION.

## Security Controls

- No POS provider secret should be placed in `index.html`.
- `/api/config` serves client Firebase configuration from Vercel environment
  variables; actual production values are UNKNOWN - REQUIRES RUNTIME
  VERIFICATION.
- Server endpoints should verify Firebase ID tokens before user-specific access.
- Server endpoints should validate untrusted RTDB path identifiers before path
  construction.
- Server-side business access should use `biz_access` for scoped roles;
  `owner`/`super_owner` retain implicit all-business behavior in current
  canonical primitives.
- CORS origin behavior is route-specific and must be reviewed per route before
  making production claims.
- CSP still allows `unsafe-inline` and `unsafe-eval` because the app uses inline
  scripts/Babel-era patterns. Removing that requires a frontend build pipeline
  change outside this slice.

## Environment Variables Referenced By Source

These names appear in source/configuration. Their production presence and values
are UNKNOWN - REQUIRES RUNTIME VERIFICATION.

- `FIREBASE_API_KEY`
- `FIREBASE_AUTH_DOMAIN`
- `FIREBASE_DATABASE_URL`
- `FIREBASE_PROJECT_ID`
- `FIREBASE_STORAGE_BUCKET`
- `FIREBASE_MESSAGING_SENDER_ID`
- `FIREBASE_APP_ID`
- `RECAPTCHA_SITE_KEY`
- `FIREBASE_SA_JSON` or equivalent Firebase service account variables
- `ALLOWED_ORIGIN`
- `APP_BASE_URL`
- `CRON_SECRET`
- `SMTP_EMAIL`
- `SMTP_APP_PASSWORD`
- `BEECOMM_API_KEY`
- `TABIT_API_KEY`
- `TABIT_ORG_ID`
- `UPSTASH_REDIS_REST_URL`
- `UPSTASH_REDIS_REST_TOKEN`
- `ANTHROPIC_API_KEY`

## Pre-Production Checklist

- Verify the production Vercel deployment commit:
  UNKNOWN - REQUIRES RUNTIME VERIFICATION.
- Verify Firebase RTDB rules currently deployed:
  UNKNOWN - REQUIRES RUNTIME VERIFICATION.
- Verify Firebase Email/Password sign-in is enabled:
  UNKNOWN - REQUIRES RUNTIME VERIFICATION.
- Verify App Check enforcement status:
  UNKNOWN - REQUIRES RUNTIME VERIFICATION.
- Verify production environment variables by name only; do not print secret
  values.
- Create first owner via `POST /api/admin?action=bootstrap-self` using a
  Firebase ID token from the intended first-owner Email/Password account.
- Confirm legacy `/api/bootstrap-owner` returns `410 unsupported_action`.
- Confirm disabled `/api/create-tenant` and `/api/whatsapp` return 410.
- Confirm no active `/api/beecomm`, `/api/tabit`, or `/api/whatsapp-daily`
  production dependency exists before removing any external monitor.
- Run RTDB Rules tests/Playground checks for the active
  `tenants/{tenantId}/biz:{bizId}:...` paths.
- Review Vercel logs for accidental `Authorization`, `Bearer`, API key, SMTP,
  Firebase service account, or provider payload leakage.

## QA Checks

| Check | Expected result |
|---|---|
| Top-level `/app-users` or `/app-businesses` read/write | Denied by rules. |
| `tenants/{tenantId}/app/users` read by tenant member | Allowed by rules. |
| Direct client write to `tenants/{tenantId}/roles` | Denied; roles are server-managed. |
| Scoped user reads a different business's `biz:{bizId}:entries` without `biz_access` | Denied. |
| `/api/bootstrap-owner`, `/api/create-tenant`, `/api/whatsapp` non-OPTIONS request | HTTP 410. |
| `/api/beecomm`, `/api/tabit`, `/api/whatsapp-daily` route lookup | No active route file exists. |

## Known Limitations

| Limitation | Current risk | Required follow-up |
|---|---|---|
| App Check enforcement not verified from source | Runtime protection may be assumed incorrectly | Verify in Firebase Console. |
| POS integrations dormant | Metrics are manual-entry based, not live POS-backed | Separate approved POS integration slice. |
| Agent/KPI data-source divergence | Agent may recompute from raw manual entries while other surfaces read built docs | Shared KPI engine hardening. |
| Real multi-branch unsupported | `branchId` assumptions can create false security/product claims | Dedicated branch-model design. |
| Partial audit coverage | Some role/member changes audited, but destructive/business-data audit incomplete | Audit design and implementation slice. |
| CSP permits inline/eval patterns | Weaker browser hardening | Frontend build pipeline and CSP hardening. |
| Production environment and backup state unknown | Operational readiness cannot be inferred from repo | Runtime verification by an authenticated operator. |
