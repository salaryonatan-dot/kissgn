# Release Delta Inventory (Phase 2)

26 commits: `origin/main` (`0130e66`) → HEAD (`a499c8d`). API function count **12**,
unchanged; **no new Vercel function** (only `api/admin.js` modified among `api/*`).

## Commit classification
| Commit | Subject | Area(s) |
|---|---|---|
| a499c8d | test: add Firebase RTDB authorization matrix | tooling/tests only |
| 53ad81b | chore: add local Firebase emulator tooling | tooling/tests only (devDep) |
| b540cae | fix: close canonical TypeScript findings | API/server mediation (+ tooling) |
| 6681108 | chore: add canonical npm lockfile | tooling/tests only |
| fdf5a5a | fix: prioritize unsupported hourly sales response | analytics/forecast (agent) |
| 42cbeb8 | fix: close final async and hourly classification gaps | checklist + frontend/UI + analytics |
| 171a9a8 | fix: retire unsupported hourly analytics workflow | analytics/forecast |
| 85e5ee5 | fix: guard checklist async state and template fallback | checklist + frontend/UI |
| 434a53d | security: close remaining checklist and analytics gaps | security + Rules + checklist + analytics |
| 9b90897 | fix: add checklist concurrency control | checklist + API/server mediation |
| 0454f7b | security: server-mediate parameterized business data | security + API/server mediation + Rules |
| f8c2320 | security: isolate all business-scoped data | security + data isolation + Rules |
| 47a6399 | fix: close local release behavior blockers | frontend/UI + analytics |
| 48d4e98 | security: isolate legacy entries by business | security + data isolation + Rules |
| 85b19bc | fix: close entry exception review blockers | entry exceptions |
| 5669284 | security: deny direct entry exception access | security + entry exceptions + Rules |
| 8a291cb | feat: integrate structured entry exceptions | entry exceptions + frontend/UI |
| 4fffd8d | feat: add server-managed entry exceptions | entry exceptions + API/server mediation |
| 91f0ad5 | fix: guard super_owner deletion | security |
| a8d1100 | fix: close owner deletion and guard recovery gaps | security |
| c1396f5 | fix: enforce concurrency-safe owner invariant | security |
| 9759f23 | fix: harden biz_access create/roles/backfill (Codex P0) | security + data isolation + API |
| f58cfdd | feat: add server-managed business access index | security + data isolation + API (biz_access) |
| dd42d53 | feat: wire revenue forecast and exception-day UI | frontend/UI + analytics/forecast |
| d1fd8f8 | feat: add weekday revenue forecast and exception days | analytics/forecast + entry exceptions |
| 677cf20 | fix: harden revenue insight eligibility | analytics/forecast |

## Changed files by deployment surface
### Firebase Rules (1) — restrictive; deploy coordinated with frontend
- `database.rules.json` (M) — full biz isolation, parameterized deny, legacy analytics lock, PIN deny.

### Frontend static (1)
- `index.html` (M) — checklist async-context guards, template fallback, forecast/exception UI, server-mediated client cutover.

### Vercel serverless API runtime (1 handler + bundled modules)
- `api/admin.js` (M) — the only changed handler (server-mediated parameterized biz data + biz_access).
- Bundled runtime modules imported by the 12 functions (build-time bundled, affect Production server behavior):
  - `lib/`: `bizAccess.js`, `checklistVersion.js`, `entryDelta.js`, `entryExceptions.js`, `repositories/bizDataRepo.js`, `repositories/entryExceptionsRepo.js`, `helpers*`, `verifyToken*`, `adminSdk*`, `sendEmail*`, `analytics/sources*`, `analytics/hourlySalesQuestion.js`, `analytics/strictDailyMetrics.js`, `memoryInsightType.js`, `llmResponse.js`, `ownerGuard.js`.
  - `src/`: `alerts/checkers.ts` (strict analytics validation), `analytics/dailyBuilder.ts`, `services/{analyticsService,forecastService,llmService}.ts`, `agent/*` (hourly retirement, memory map, response), `firebase/{admin,refs}.ts`, `forecast/revenueForecast.ts`, `insights/*`, `repositories/analytics/hourlyMetricsRepo.ts` (inert stub).
  - `.d.ts` files are **type-only** (no deployed runtime effect).

### Migration/backfill utility (2) — operator-run, NOT deployed as functions
- `scripts/backfill-biz-access.mjs`, `scripts/init-owner-guard.mjs`.

### Local test/tooling only (25) — NOT deployed
- `test/**` (security, typescript, forecast, insights, analytics, **emulator**), and dependency/tooling:
  - `package.json`/`package-lock.json` — adds `firebase-tools` as a **devDependency**.

## Production-runtime impact confirmations
- **API function count remains 12**; no unexpected new function (verified: `find api -type f` = 12; `git diff --name-status 0130e66..HEAD -- api/` shows only `M api/admin.js`).
- **`test/emulator/*` and `test/**` do not affect Production** (not imported by any `api/*` function; not part of the deployed bundle).
- **Dev-dependency `firebase-tools`** must not be needed at Production build/runtime. Confirm the Vercel build command does not require devDependencies for the deployed functions (the functions import only `firebase-admin`/`nodemailer` runtime deps + repo modules). `typescript`/`@vercel/node`/`@types/node`/`firebase-tools` are dev/build-only.
- **`.d.ts` additions** change nothing at runtime.
