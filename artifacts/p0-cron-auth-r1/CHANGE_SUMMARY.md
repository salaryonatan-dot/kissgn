# SYS-P0-001 — Cron Authorization Hardening R1 — Change Summary

Commit: `fix: secure scheduled job authorization`
Base (R5): `088310c3bd2d597cc9ed0f6e2e8bcf38568f7d10`
Branch: `claude/p0-cron-auth-r1`

## The vulnerability
Three active production job routes authorized scheduled execution by trusting
the client-supplied `x-vercel-cron` request header. Any caller could set that
header and invoke privileged jobs (analytics rebuild for all businesses,
owner-snapshot emails, proactive scans) with no secret and no identity:

- `api/analytics/daily-builder.ts` — `verifyAuth()`: `if (req.headers["x-vercel-cron"]) return true;`
- `api/daily-snapshot/run.ts`      — `verifyAuth()`: `if (verelCron) return true;`
- `api/proactive/run.ts`           — `handleCronScan()`: `if (vercelCron) { /* allowed */ }`

`x-vercel-cron` is an ordinary forwarded HTTP header; it is attacker-controlled
and MUST NOT be an authorization signal.

## The fix
Scheduled authorization now flows exclusively through the centralized, strict
`requireCron` helper in `lib/securityContext.js` (Bearer `CRON_SECRET` only;
constant-time compare; fail-closed when the secret is missing; `x-vercel-cron`
ignored entirely). The three local, duplicated `verifyAuth` copies are deleted.
Manual (human-triggered) executions are separated from scheduled execution and
each is bound to a verified identity with canonical server-side scope.

### Per route
- **daily-builder** — GET (cron, all businesses) and the legacy operator
  backfill POST are gated by `requireCron`. The isolated read-only
  `beecomm_diagnose` branch (already strict, but with an inline hand-rolled
  Bearer check) now also uses `requireCron` for constant-time centralized
  verification. The authenticated `rebuild_after_entry_save` branch keeps its
  existing verified-Firebase-user + server-side tenant/RBAC + business-access
  authorization (it never used `verifyAuth`; it already reads role and
  `allowedBizIds` from the server, never the client). Unsupported methods are
  rejected (405) before the cron gate.
- **daily-snapshot** — GET (cron, all businesses) gated by `requireCron`.
  The manual single-business email POST now requires a VERIFIED
  owner/super_owner via `requireBizContext(mode:"write")` plus an explicit
  owner-tier role gate, with the caller-supplied `tenantId`/`bizId` authorized
  server-side (tenant membership + `biz_access`). Unsupported methods → 405
  before any authorization or side effect.
- **proactive** — GET (full scan, cron) gated by `requireCron`. The manual
  single-business scan POST requires a VERIFIED owner/super_owner via
  `requireBizContext(mode:"write")` + owner-tier gate + server-side scope. The
  stale module-level `const CRON_SECRET` copy was removed. The authenticated
  dashboard read path (`?action=insights|digest|weekly`) is unchanged. The
  former "POST without body ⇒ full scan under cron secret" path is removed;
  the scheduled full scan is the GET cron only.

No client-supplied tenant, business, UID, role, or membership field can
establish authorization on any path.

## Files changed
- `api/analytics/daily-builder.ts`  (runtime)
- `api/daily-snapshot/run.ts`        (runtime)
- `api/proactive/run.ts`             (runtime)
- `test/security/cron-auth-hardening.test.mjs`         (new — executable route-auth proof)
- `test/security/cron-auth-source-invariants.test.mjs` (new — regression guards)
- `test/analytics/rebuild-rate-limiter.test.mjs`       (updated cron-path case for strict Bearer)
- `artifacts/p0-cron-auth-r1/*`                        (new)

`lib/securityContext.js` was NOT modified — `requireCron`, `requireBizContext`,
and `requireBizAccess` already provided everything required; the owner-tier gate
is enforced in-route. Consequently `lib/securityContext.d.ts` and its
js/.d.ts export-parity guard are untouched.
