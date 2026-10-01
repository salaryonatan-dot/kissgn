# 03 — Findings and classification

## P0_RELEASE_BLOCKER — all closed locally in this commit

| id | Route | Finding at `f5d0a8ed` (approved P0 tip) | Impact | Fix | Proof |
|---|---|---|---|---|---|
| SA-01 | `/api/analytics/daily-builder` | GET scan and POST backfill authorized by the mere presence of `x-vercel-cron` (`:52`). Secret compare via `split(" ")` accepts `"Bearer <secret> "` and is not constant-time. | Anyone can trigger an all-business analytics rebuild, or build and write analytics for any tenant/business | `requireCron` on GET and backfill POST; diagnostic uses `requireCron`; 405 before auth for other methods | matrix + cron-auth-hardening. Negative control: the matrix run against `f5d0a8ed` fails 12 cases. |
| SA-02 | `/api/daily-snapshot/run` | GET and POST authorized by `x-vercel-cron` (`:18`). POST `{tenantId,bizId}` sends the snapshot email of **any** business. | Unauthenticated email to every owner (GET) or to any chosen business (POST); a spam/abuse and information-disclosure channel | GET: `requireCron`. POST: verified owner/super_owner with server-scoped ids. | same |
| SA-03 | `/api/proactive/run` | Scan authorized by `x-vercel-cron` (`:83`). POST without a body runs the **full** scan. The secret is captured at module load (`:15`). | Anyone can run the all-business proactive job or any single-business scan | GET: `requireCron` (read per request). POST: owner/super_owner single business only; full scan unreachable by POST. | same |

These three were the SYS-P0-001 vulnerability. It was fixed and Codex-approved on `claude/p0-cron-auth-r1` (`4ce7c842`) but **never integrated into the P0 lineage**, so the approved P0 tip `f5d0a8ed`, and `origin/main`, still carry it. `/api/alerts/run` was already correct (NO_ISSUE).

**Production exposure today.** Whatever is deployed now was built from a pre-P0 tree, and every such tree examined carries SA-01…03. This is a present, pre-existing exposure, not one the release introduces. Deployed identity is unverified (see 08). The release closes it at Vercel promote. Whether to hotfix earlier is a CTO decision outside this package, because the Vercel artifact ships client and API together.

## P1_PRE_PILOT
| id | Finding | Why not P0 | Where it goes |
|---|---|---|---|
| J-01 | The daily snapshot has no send receipt or dedup, so a duplicate cron delivery (documented as possible by Vercel) re-emails every owner | Behaviour already exists in Production. Needs a new durable receipt node, i.e. a data-model decision. | Daily Intelligence package (04) |
| J-02 | No durable run receipt for any scheduled job. Success or failure is visible only in Vercel runtime logs and the response JSON. Missed deliveries leave no trace (Vercel does not retry). | Operability, not safety. Canary monitoring can use logs plus output presence. | Daily Intelligence package. Canary monitoring must use Vercel cron logs plus output checks as the receipt (07). |
| J-03 | Alerts dedup is check-then-save (`alertExistsToday` → `saveAlert`). Two **overlapping** deliveries can both fire and both email. | Rare (needs overlapping delivery); sequential replays are already safe | Daily Intelligence package |
| C-01 | `CRON_SECRET` presence in Vercel Production is unverified. Missing ⇒ all four jobs 401 (fail closed ⇒ no analytics, digest, alerts or snapshot). | Configuration, not code | Release manifest operator gate (06) |

## P2_POST_PILOT
| id | Finding |
|---|---|
| P2-01 | The backfill POST (cron-secret holders only) does not validate `tenantId`/`bizId` shape (the `date` regex only). A secret holder could write analytics to an unexpected path. |
| P2-02 | 500 responses on daily-builder, proactive and snapshot echo `error.message`/`String(error)` to the (authorized) caller. Alerts already redacts. |
| P2-03 | Proactive POST passes an unvalidated `branchId` to `runForBiz` (owner-only). |
| P2-04 | The owner-tier gate is duplicated in two routes; an `allowedRoles` option on `requireBizContext` would centralize it (Codex residual). |
| J-04 | On Hobby, alerts (04:xx) and snapshot (04:xx) may fire in either order within the hour. Neither depends on the other. Proactive (03:xx) depends only on analytics (23:xx the previous UTC day). |
| J-05 | Analytics docs are last-writer-wins. An overlapping cron run and a user rebuild for the same date may leave a doc built from slightly older entries until the next rebuild. |
| J-06 | Insight-build failures are swallowed (log only). The user rebuild path verifies the read-back; the cron path does not. |
| J-07 | A duplicate proactive run can bump insight occurrence counters twice (counter drift, no duplicate insight). |
| C-02 | If `CRON_SECRET` is also defined for Preview deployments, Preview functions (same Firebase project) accept it. Scope it to Production only. |

## NO_ISSUE
- `/api/alerts/run` (strict since PR #2A).
- `requireCron` primitive.
- OPTIONS handling.
- Query-string secrets (never read).
- The eight non-scheduled functions (no machine auth).
- `vercel.json` cron inventory (four paths, all resolving).
- No function added (12/12).
