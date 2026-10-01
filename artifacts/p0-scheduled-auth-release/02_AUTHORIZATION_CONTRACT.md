# 02 — Scheduled-job authorization contract (release candidate)

## Contract
| # | Requirement | How the release meets it | Evidence |
|---|---|---|---|
| 1 | No spoofable header is sufficient | `x-vercel-cron`, `x-vercel-cron-schedule`, `x-vercel-id` and `user-agent` are never read for authorization. The repo-wide scan finds `x-vercel-cron` in zero runtime code conditions. | matrix "SPOOFED … ONLY"; `cron-auth-source-invariants` |
| 2 | Explicit machine auth | `Authorization: Bearer <CRON_SECRET>` via the single primitive `requireCron` (`lib/securityContext.js:64-73`). This is the header Vercel sends automatically. | matrix "CORRECT MACHINE AUTH" |
| 3 | Safe comparison | `crypto.timingSafeEqual` on UTF-8 buffers with a length guard. Only the length is observable. | `security-context.test.mjs` |
| 4 | Missing auth fails closed | No header, or `CRON_SECRET` unset or empty ⇒ 401 before any side effect | matrix "NO AUTH", "EMPTY / MISSING CRON_SECRET" |
| 5 | Wrong auth fails closed | A wrong, truncated, extended, case-changed or space-padded secret ⇒ 401 | matrix "WRONG AUTH", "MALFORMED" |
| 6 | User auth cannot reach machine-only paths | A valid owner Firebase token in `Authorization` is ≠ `CRON_SECRET` ⇒ 401 on every scheduled GET, the backfill and the diagnostic | matrix "USER AUTH ONLY" |
| 7 | Machine auth grants no more than the job | The cron secret opens only the scheduled job of each route plus the operator backfill/diagnostic on daily-builder. It is **not** a user identity: POST manual flows (snapshot, proactive) and alerts user branches reject it (401). No admin or data-mutation capability beyond the job's own derived outputs. | matrix "the cron secret cannot …" tests |
| 8 | Error paths cannot bypass | Authorization precedes every `try` that runs a job. A throwing job returns 500 only after a successful auth. A denied request with a throwing job is still 401 with zero calls. | matrix "ERROR PATH" |
| 9 | OPTIONS / alternate methods | OPTIONS ⇒ 200/204 with no side effect. PUT, PATCH, DELETE, HEAD, TRACE, CONNECT and non-canonical-case methods ⇒ 405 (alerts: 405/400) before auth and side effects, even with the correct secret. | matrix "WRONG / ALTERNATE HTTP METHODS", "OPTIONS" |
| 10 | No query-string secret | Never read. Alerts treats any unknown query shape as 400 (never cron). The others ignore the query for authorization. | matrix "QUERY-STRING secret" |

## User-facing branches on the same routes
| Branch | Rule |
|---|---|
| daily-builder `rebuild_after_entry_save` | verified Firebase user → tenant role ≥ shift_manager → business exists/active → server-read business access |
| daily-snapshot POST / proactive POST | verified user → `requireBizContext(write)` → **owner/super_owner** only; tenant/business are server-authorized. Client role, membership or `allowedBizIds` can never widen access. |
| proactive `?action=insights\|digest\|weekly` GET, alerts user GET/POST | `requireBizContext` read (viewer+) / write (manager+) |

## Configuration half (not in code)
- **Vercel Production** must define `CRON_SECRET`: a random value of at least 16 characters, per Vercel guidance. This work did not inspect or change it.
- Without it, **all four crons return 401** (fail closed), including alerts, which already requires it at `f5d0a8ed`.
- A changed value takes effect only for a new deployment.
- Any non-Vercel caller (operator backfill, monitoring) must send the same Bearer header. Whether any such caller relies on `x-vercel-cron` today is unknown; the operator must confirm (see 06).

## Provenance of the fix
- The route changes are byte-identical to Codex-**APPROVED** SYS-P0-001 commit `4ce7c8423d4a36c931123ec9ba548d336c069670` (review 2026-07-29, verdict APPROVED, blocking findings none).
- That commit was not in the approved P0 lineage (its base is R5 `088310c3`).
- It was not applied blindly. The three route files and `test/analytics/rebuild-rate-limiter.test.mjs` are **byte-identical** between `088310c3` and `f5d0a8ed`, as are the helpers they import (`lib/securityContext.js`/`.d.ts`, `lib/bizAccess.js`, `lib/verifyToken.js`, `lib/helpers.js`, `lib/proactiveCore.js`, `lib/alertsCore.js`, `lib/apiScope.js`, `lib/adminSdk.js`, `src/firebase/admin.ts`, `src/agent/proactive/**`, `lib/analytics/sources.js`).
- Only `src/analytics/dailyBuilder.ts` and `src/snapshot/snapshotBuilder.ts` differ (the server-reader convergence). Their exported signatures used by the routes are unchanged (typecheck unchanged, tests green).
- The resulting route blobs equal `4ce7c84`'s exactly:

  | File | Blob |
  |---|---|
  | daily-builder | `c918d892…` |
  | snapshot | `cf8fde71…` |
  | proactive | `6762e571…` |
