# SYS-P0-001 — Route Authorization Matrix

`requireCron` = Bearer `CRON_SECRET` only; constant-time; fail-closed; ignores
`x-vercel-cron`. `requireBizContext(write)` = verified Firebase identity →
id validation → tenant membership + role floor (manager) → explicit
WRITE_ROLE_SET gate → business access (`biz_access`, Admin SDK). "owner-tier
gate" = in-route `role ∈ {owner, super_owner}` after requireBizContext.

## api/analytics/daily-builder.ts
| Method / selector | Kind | Authorization | On failure |
|---|---|---|---|
| OPTIONS | preflight | none | 200 |
| POST `action=beecomm_diagnose` | operator diagnostic (read-only) | `requireCron` | 401; no `fetchBeecommDaily` |
| POST `action=rebuild_after_entry_save` | manual authenticated | `requireAuth` + `requireTenantAccess("shift_manager")` + server `biz_access` via `hasBusinessAccess` (server role + server `allowedBizIds`) + rate limit | 401 / 403 / 429; no build |
| GET | scheduled cron (all businesses) | `requireCron` | 401; no build |
| POST (no/other action, backfill) | operator backfill | `requireCron` | 401; no build |
| other methods | — | rejected first | 405 |

## api/daily-snapshot/run.ts
| Method | Kind | Authorization | On failure |
|---|---|---|---|
| OPTIONS | preflight | none | 200 |
| GET | scheduled cron (all businesses, emails) | `requireCron` | 401; no build/email |
| POST | manual single-business email | `requireBizContext(write)` + owner-tier gate; uses server-authorized tenant/biz | 401 / 403; no email |
| other methods | — | rejected first | 405 |

## api/proactive/run.ts
| Method / selector | Kind | Authorization | On failure |
|---|---|---|---|
| OPTIONS | preflight | none | 200 |
| GET `action=insights\|digest\|weekly` | authenticated dashboard read | `requireBizContext` (via `handleProactiveRead`) — unchanged | per core |
| GET (no action) | scheduled full scan (cron) | `requireCron` | 401; no job |
| POST `{tenantId,bizId}` | manual single-business scan | `requireBizContext(write)` + owner-tier gate; uses server-authorized tenant/biz | 401 / 403; no job |
| other methods | — | rejected first | 405 |

## Cross-cutting guarantees
- No path treats `x-vercel-cron` as authorization.
- No client-supplied tenant / biz / uid / role / membership / `allowedBizIds`
  can grant or widen access; all are validated/derived server-side.
- Every authorization failure returns before any write / email / job.
