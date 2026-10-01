# SYS-P0-001 — Review Guide

For an independent re-review of `fix: secure scheduled job authorization`
(parent `088310c3`, branch `claude/p0-cron-auth-r1`).

## 1. Containment
```
git diff --name-status 088310c3 HEAD
# M api/analytics/daily-builder.ts · M api/daily-snapshot/run.ts
# M api/proactive/run.ts · M test/analytics/rebuild-rate-limiter.test.mjs
# A test/security/cron-auth-hardening.test.mjs
# A test/security/cron-auth-source-invariants.test.mjs · A artifacts/p0-cron-auth-r1/*
git diff --check 088310c3 HEAD                                   # clean
git diff 088310c3 HEAD -- lib/ package.json package-lock.json vercel.json database.rules.json
#   (empty — securityContext + config untouched)
```

## 2. The authorization boundary (read these first)
- `lib/securityContext.js` `requireCron` — Bearer CRON_SECRET only; constant-time
  `safeEqual`; fail-closed; `x-vercel-cron` never read. (Unchanged this task.)
- Each route: search for `requireCron(` (scheduled gate) and, in snapshot +
  proactive, `requireBizContext(` followed by `role !== "owner" && role !== "super_owner"`.
- Confirm NO route contains `function verifyAuth` or an `x-vercel-cron` code
  condition (comments that say it is *not* accepted are fine).

## 3. Per-route trace
- `api/analytics/daily-builder.ts`: OPTIONS → beecomm_diagnose (`requireCron`)
  → rebuild_after_entry_save (`requireAuth`+`requireTenantAccess`+`hasBusinessAccess`)
  → method guard (405) → `requireCron` → GET cron / POST backfill.
- `api/daily-snapshot/run.ts`: OPTIONS → method guard (405) → GET `requireCron`;
  POST `requireBizContext(write)` + owner gate → shared body uses `snapshotCtx`.
- `api/proactive/run.ts`: OPTIONS → dashboard read (`?action=`) unchanged →
  `handleCronScan`: method guard (405) → GET `requireCron` scan; POST
  `requireBizContext(write)` + owner gate scan.

## 4. Reproduce
```
node --test test/security/cron-auth-hardening.test.mjs          # 24/0
node --test test/security/cron-auth-source-invariants.test.mjs  # 7/0
node test/analytics/rebuild-rate-limiter.test.mjs               # 35/0
node --test test/**/*.test.mjs docs/production-readiness/test/*.test.mjs  # 425/0
./node_modules/.bin/tsc --noEmit                                # 22 TS2742 (refs.ts), exit 2
./node_modules/.bin/tsc --noEmit --preserveSymlinks             # exit 0
```
(Do NOT run bare `node --test` — it invokes the guarded RTDB emulator test.)

## 5. What the executable proof establishes
`cron-auth-hardening.test.mjs` compiles the REAL route `.ts` with the project's
own `tsc`, imports the REAL `requireCron`/`requireBizContext`, and mocks only
terminal deps. For each route it asserts spoofed/random/missing/wrong creds →
401 with the scheduled job NOT run, correct Bearer → 200 with the job run,
manual flows → verified owner/super_owner + server scope, and client-supplied
role/`allowedBizIds` cannot expand authorization. This is why the finding is not
closed on source strings alone.

## 6. Not changed
`lib/securityContext.js`/`.d.ts`, `lib/bizAccess.js`, `api/alerts/run.ts`,
`lib/alertsCore.js`, the proactive dashboard read path, RTDB schema/paths/Rules,
`vercel.json` cron declarations, dependencies, secrets. See `SCOPE_COMPLIANCE.md`.
