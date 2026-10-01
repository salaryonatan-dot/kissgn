# 04 — Daily / nightly job reliability contract

Platform facts (Vercel, 2026-08 docs): runs are best-effort (can be missed), can be delivered twice, can overlap, are **not retried**, and on Hobby fire anywhere inside the scheduled hour.

| Question | Analytics (23:xx UTC) | Proactive (03:xx) | Alerts (04:xx) | Snapshot (04:xx) |
|---|---|---|---|---|
| Can the same job run twice? | yes | yes | yes | yes |
| Idempotent? | **yes** — per-date `set` overwrite | **mostly** — fingerprint dedup/cooldown; digest overwrite; counters may bump (J-07) | **sequential yes / overlapping no** (J-03) | **no** — re-sends all emails (J-01) |
| Failure halfway visible? | Per-business `failures[]` in the 200 body + logs; insights failures log-only (J-06) | per-business errors in summary + logs | per-business `errors[]` + logs; generic 500 on total failure | `failures[]` + logs |
| Durable success/failure receipt? | **no** (output doc presence + `meta.builtAt` is indirect evidence) | **no** (digest doc presence is indirect) | **no** (alerts docs indirect) | **no** (nothing persisted) |
| Can a retry duplicate persisted output or email? | output: no (overwrite) | output: no; counters: slightly | email: only on overlap | **email: yes** |
| Can a stale execution overwrite newer output? | yes, narrowly (J-05, last-writer-wins) | digest overwrite with same-date recomputation | no (existing alerts skipped) | n/a |
| Missed run | no trace, no retry; next day's run is independent; a missed analytics day stays missing until backfill or rebuild | same | same | email not sent |

## What must be true for a safe release
1. All four jobs authorize only via `Bearer CRON_SECRET` (done in code; this commit).
2. `CRON_SECRET` is present in Vercel **Production** (operator gate C-01), otherwise every job 401s.
3. The release window avoids the cron hours, so no job runs while entries are quiesced or storage is mid-transition. Avoid 22:45–00:15, 02:45–05:15 UTC and the D-1 build (see 07).
4. The first cron cycle after promote is observed (Gate B):
   - four 200 responses in the Vercel cron logs;
   - analytics docs for D-1 exist for every active business;
   - no `EntriesStorageError`/`EntriesAmbiguityError`;
   - digest docs exist;
   - alert run summary;
   - snapshot `successCount` matches the business count.
5. For canary monitoring, the **receipt source** is Vercel cron logs (response status and body) **plus** output presence per business and date. A missing log or output is `UNKNOWN`, never PASS (consistent with the canary monitoring ledger).

## Deferred to the Daily Intelligence package (not release-blocking)
- **J-01/J-02:** durable per-job, per-date run receipt and email send receipt.
  - Keyed `(job, businessDate, bizId)`, written atomically before send, checked before re-send.
  - Needs a new Admin-only node plus Rules, i.e. a data-model decision.
- **J-03:** atomic alert fire (transaction on the alert id).
- **J-05:** compare-and-set on `meta.builtAt` / source digest.
- **J-06:** a read-back check in the cron path.
- **Alerting on a missed run:** a watchdog that checks yesterday's receipts.
