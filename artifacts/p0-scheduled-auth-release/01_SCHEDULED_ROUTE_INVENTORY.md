# 01 — Scheduled-route inventory (approved P0 tip `f5d0a8ed` → release candidate)

**Method.** I read every file under `api/**` (12 Vercel functions), `vercel.json`, `lib/securityContext.js`, `lib/alertsCore.js`, `lib/apiScope.js` and the job implementations they call. The `src/api/**` directory does not exist.

**`CRON_SECRET` is the only machine credential in the runtime.** Searching for `process.env.*SECRET|KEY|TOKEN` finds only provider keys (Anthropic, Beecomm, Tabit, Upstash, GreenAPI, Firebase SA) plus `CRON_SECRET` in `lib/securityContext.js`.

**Vercel platform facts** (docs.vercel.com "Managing Cron Jobs", last updated 2026-08-11):
- Vercel invokes the path with **GET**.
- It sends `Authorization: Bearer <CRON_SECRET>` when that env var exists.
- Every invocation carries `x-vercel-cron-schedule`.
- It does **not** retry failures.
- Delivery is best-effort: a run can be **missed** or **delivered more than once**.
- Overlapping runs are possible.
- On Hobby, a run fires anywhere within the scheduled hour.
- Instant Rollback does **not** update cron jobs.

## Scheduled routes (declared in `vercel.json`, identical in `origin/main` and the release)

### R1 — `/api/analytics/daily-builder`, `0 23 * * *` UTC (02:00 IST summer, 01:00 winter)

| Branch | Method | Caller | Auth at `f5d0a8ed` | Auth in the release | Side effects | Prod read | Prod write |
|---|---|---|---|---|---|---|---|
| Scheduled scan | GET | Vercel Cron | `x-vercel-cron` present **OR** `split(" ")` Bearer compare (`:51-63`, used `:450`) | `requireCron` (Bearer `CRON_SECRET`, constant-time, fail-closed); 405 for other methods before auth | For every discovered business: read entries/config/business (server readers), external weather (open-meteo) and oref; write `biz:{b}:analytics:daily:{D-1}` and `biz:{b}:insights:daily:{D-1}` | yes | yes |
| Operator backfill | POST `{tenantId,bizId,date?}` | Operator (curl) | same as above | `requireCron` | Same build/write for one business and date | yes | yes |
| POS diagnostic | POST `{action:"beecomm_diagnose",date}` | Operator | own `authHeader === "Bearer "+secret` (not constant-time) | `requireCron` | External Beecomm read only; no RTDB | no | no |
| User rebuild | POST `{action:"rebuild_after_entry_save",…}` | Dashboard (`index.html:5127`) | Firebase user + tenant role (≥ shift_manager) + business registry + access; rate limited | unchanged | Same build/write for one business and date | yes | yes |
| Preflight | OPTIONS | Browser | none (200, no body) | unchanged | none | no | no |

- **Idempotency:** yes, as overwrite. The per-date path is written with `set`, so a replay rewrites the same doc from current data. The last writer wins, so a slower overlapping run can leave a doc built from older data until the next rebuild (J-05).
- **Retry:** none by Vercel. Per-business failures go to the 200 response (`failures[]`) and the logs. Insight-build failures are swallowed (log only).

### R2 — `/api/proactive/run`, `0 3 * * *` UTC

| Branch | Method | Caller | Auth at `f5d0a8ed` | Auth in the release | Side effects | Prod read | Prod write |
|---|---|---|---|---|---|---|---|
| Scheduled full scan | GET (no `action`) | Vercel Cron | `x-vercel-cron` present **OR** `authHeader === "Bearer "+CRON_SECRET`. The secret was captured **at module load** (`:15`, `:80-92`). | `requireCron` (secret read per request) | `runProactiveJob`: all businesses; detectors over analytics; writes insights, cooldown/memory, `proactive_digests/{b}/daily/{date}`, `proactive_biz_index` | yes | yes |
| Manual scan | POST `{tenantId,bizId,branchId?}` | Owner (no current UI caller) | **same header-only gate**; **POST without body ⇒ full scan** (`:96-104`) | `requireBizContext(write)` + owner/super_owner; the full scan is unreachable by POST | `runForBiz` (one business) | yes | yes |
| Dashboard reads | GET `?action=insights\|digest\|weekly` | Dashboard | `requireBizContext(read)` via `handleProactiveRead` | unchanged | none | yes | no |
| Other methods | PUT/PATCH/DELETE/HEAD… | — | fell into the header-only gate | 405 before auth or side effect | — | — | — |

- **Idempotency:** partial.
  - Insights are deduplicated by fingerprint and cooldown.
  - The digest is overwritten per date.
  - A duplicate run bumps occurrence counters (J-03-like counter drift, P2).
  - No email.
- **Retry:** none. Per-business errors are in the summary and logs.

### R3 — `/api/alerts/run`, `0 4 * * *` UTC — already hardened before P0 (PR #2A)

| Branch | Method | Auth at `f5d0a8ed` and in the release | Side effects | Prod read | Prod write |
|---|---|---|---|---|---|
| Scheduled | GET, **exactly zero query keys** (`lib/apiScope.js:68-107`) | `requireCron` (`lib/alertsCore.js:39-60`) | `runAlertsForAll`: checkers per business; `saveAlert` for alerts not yet present today; **email digest to the owner** (or `ALERT_FALLBACK_EMAIL`) only for newly fired alerts | yes | yes + email |
| User read | GET `{tenantId,bizId[,config=1]}` | `requireBizContext(read)` | none | yes | no |
| User write | POST `run\|config\|dismiss` | `requireBizContext(write)` (manager+) | one business | yes | yes |
| Other | OPTIONS 204; other methods 405; any other query shape 400 | — | none | — | — |

- **Idempotency:** sequential replays skip existing alert ids, so there is no second email. `alertExistsToday` → `saveAlert` is check-then-act, not atomic, so two **overlapping** deliveries can both fire and both email (J-03).
- **Retry:** none.

### R4 — `/api/daily-snapshot/run`, `5 4 * * *` UTC

| Branch | Method | Auth at `f5d0a8ed` | Auth in the release | Side effects | Prod read | Prod write |
|---|---|---|---|---|---|---|
| Scheduled | GET | `x-vercel-cron` present **OR** `split(" ")` Bearer compare (`:16-38`, used `:100`) | `requireCron`; 405 for other methods before auth | `buildSnapshotForAll` (reads via server readers) → **one email per business** to the owner (Gmail SMTP) | yes | **email** (no RTDB write) |
| Manual | POST `{tenantId,bizId}` | **same header-only gate** ⇒ email for **any** tenant/business | `requireBizContext(write)` + owner/super_owner, server-scoped ids | One email | yes | email |
| Preflight | OPTIONS | 200 | unchanged | none | — | — |

- **Idempotency: none.** There is no receipt or dedup, so a duplicate delivery **re-sends every owner email** (J-01).
- **Retry:** none. Failures go to the response (`failures[]`, echoing `String(error)`) and the logs.

## Non-scheduled functions (listed for completeness; none accepts machine auth)
- `api/admin.js` — Firebase user, super_owner/owner-gated actions, maintenance gate.
- `api/agent/ask.ts`, `api/ai-chat.js` — user.
- `api/bootstrap-owner.js`, `api/create-tenant.js` — user onboarding.
- `api/config.js` — public config.
- `api/oref.js` — public proxy.
- `api/whatsapp.js` — 410.

The function count is **12** (the Hobby cap). This release adds no function.

## Test coverage (after this change)
| Route | Tests |
|---|---|
| daily-builder | `test/security/cron-auth-hardening.test.mjs` (Codex-approved SYS-P0-001 proofs); `test/security/scheduled-auth-matrix.test.mjs` (full matrix + backfill + diagnostic); `test/analytics/rebuild-rate-limiter.test.mjs`; source invariants |
| proactive | cron-auth-hardening; matrix; `test/security/proactive-read-scope.test.mjs` (user reads) |
| alerts | `test/security/alerts-dispatch.test.mjs` (core, 36 `requireCron` refs); `pr2a-endpoint-hardening`; matrix (real route compile) |
| daily-snapshot | cron-auth-hardening; matrix |
| primitive | `test/security/security-context.test.mjs` (`requireCron`) |
| config | `test/security/vercel-cron-routes.test.mjs`; matrix asserts exactly these four cron paths |
