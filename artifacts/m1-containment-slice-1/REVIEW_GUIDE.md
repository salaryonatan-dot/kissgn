# Review Guide

## Exact Changed Files

Implementation and docs:

- `SECURITY.md`
- `api/bootstrap-owner.js`
- `api/proactive/run.ts`
- `docs/production-readiness/production-baseline.md`
- `index.html`
- `lib/proactiveCore.js`
- `lib/proactiveCore.d.ts`
- `vercel.json`

Tests:

- `test/forecast/revenue-forecast-ui.test.mjs`
- `test/security/pr2a-endpoint-hardening.test.mjs`
- `test/security/proactive-read-scope.test.mjs`
- `test/security/vercel-cron-routes.test.mjs`
- `test/typescript/js-declaration-parity.test.mjs`

Artifacts:

- `artifacts/m1-containment-slice-1/CHANGE_SUMMARY.md`
- `artifacts/m1-containment-slice-1/SECURITY_SCOPE_MATRIX.md`
- `artifacts/m1-containment-slice-1/CRON_AUTH_INVENTORY.md`
- `artifacts/m1-containment-slice-1/TEST_RESULTS.md`
- `artifacts/m1-containment-slice-1/KNOWN_LIMITATIONS.md`
- `artifacts/m1-containment-slice-1/REVIEW_GUIDE.md`

## Behavior Before

- `/api/bootstrap-owner` accepted authenticated callers, trusted caller-supplied `tenantId`, and performed Admin SDK root updates for tenant bootstrap data.
- Proactive authenticated read routes verified tenant membership but did not enforce canonical business-level `biz_access`, allowing a scoped user from one business to potentially read another business in the same tenant.
- `ForecastScreen` referenced `tenantId` and `bizId` without lexical bindings in the forecast calculation path, causing a runtime `ReferenceError`.
- `vercel.json` scheduled `/api/whatsapp-daily`, but no matching route existed.
- Cron endpoints had mixed auth behavior, but that inconsistency was not explicitly inventoried in the repo.

## Behavior After

- `/api/bootstrap-owner` returns HTTP 410 for every non-OPTIONS request before auth, Admin SDK, DB read, or DB write.
- Proactive `GET action=insights`, `GET action=digest`, and `GET action=weekly` validate query scope and call `requireBizContext` in read mode before any repository read.
- `ForecastScreen` receives `tenantId` and `bizId` from the selected app context and uses those lexical props in the existing forecast computation.
- `/api/whatsapp-daily` is removed from `vercel.json`; WhatsApp remains disabled and no placeholder route was added.
- `test/security/vercel-cron-routes.test.mjs` prevents configured Vercel cron paths from pointing at missing API route files.
- Cron-auth behavior is documented in `CRON_AUTH_INVENTORY.md`; no speculative auth redesign was made.

## Reproduce Tests

Install dependencies from lockfile:

```sh
npm ci
```

Run focused slice tests:

```sh
node --test test/security/pr2a-endpoint-hardening.test.mjs test/security/proactive-read-scope.test.mjs test/security/vercel-cron-routes.test.mjs test/forecast/revenue-forecast-ui.test.mjs test/typescript/js-declaration-parity.test.mjs
```

Run TypeScript:

```sh
./node_modules/.bin/tsc --noEmit
```

Run broader local tests:

```sh
node --test test/**/*.test.mjs docs/production-readiness/test/*.test.mjs
```

Run patch sanity:

```sh
git diff --check
```

Lint: no lint script is configured in `package.json`.

## Remaining Unknowns

- Actual Vercel Production cron request headers were not verified.
- Production `CRON_SECRET` presence was not verified.
- External monitors or manual operators invoking removed `/api/whatsapp-daily` were not verified.
- Dependency audit findings remain out of scope.

## Formula And Data-Model Confirmation

No forecast formula, KPI formula, VAT logic, data schema, RTDB data model, migration, or data-write model was changed in this slice.

