# 07 — Coordinated deployment plan (revalidated; nothing executed)

**Sources:**
- runbook `2026-09-25/production-canary-runbook/02` and `13`;
- Gate 0 result 2026-09-25 (509/509 rows without ids, `biz_access` absent for 7 restricted users);
- remediation plan `2026-09-25/gate0-remediation` and tooling `aaef1213`;
- the gap-audit P0 path (2026-09-29);
- the code of the release candidate.

## Revalidation against the current candidate
| Premise | Still true? | Evidence |
|---|---|---|
| Client, API and crons are one atomic Vercel artifact; Rules are separate | yes | 12 functions + `index.html` in one deployment; Rules published via Console/CLI |
| New client + old Rules ⇒ fail-closed banner, no writes | yes | client unchanged from `f5d0a8ed` (policy lane `policy_unavailable`) |
| Old client + new Rules ⇒ `.validate` denies id-less rows, no designed fail-closed | yes | Rules `1e5dea2f…` unchanged |
| Runbook precondition "ids green before deploy" | **cannot hold** | 100% of rows lack ids. The July client does not preserve ids, so ids may only be assigned **after** the new client and Rules are live (remediation plan). |
| Scheduled auth changes deploy order? | **no** | Same artifact. The only new dependency is `CRON_SECRET` present **before** promote (C-01). Crons are not client/Rules coupled. |
| Server readers need ids for legacy rows? | no | `lib/analytics/entriesReader.js` requires canonical ids only for V2 rows, so crons keep working on id-less legacy nodes during the window |
| Vercel Instant Rollback resets crons? | no (docs) | cron config is identical in both deployments, so no effect. Rolling back re-opens SA-01…03, though. |

## Pre-deploy gates (all required)
1. Codex approval of this release candidate. Re-pin the SHA; `git diff f5d0a8ed -- api` shows exactly the three route files.
2. **D1 complete** with `aaef1213`: served Rules classified, deployed commit recorded, `biz_access` expected pairs, entry-ID baseline equal to the plan snapshot.
3. Entry-ID `plan` bundle COMPLETE for the five businesses (fingerprint and mapping digest frozen).
4. `biz_access` grant set reviewed (who gets which business).
5. C-01: `CRON_SECRET` present in Production (presence only). Otherwise, an authorized secret creation.
6. Rollback targets recorded: previous Vercel deployment id and previous Rules text blob.
7. Businesses told data entry pauses for the window. Canary owner acknowledgement. CTO GATE A signed.
8. **Window placed outside cron hours**, UTC, Hobby hour-level jitter:
   - not in 22:45–00:15 (daily-builder 23:xx);
   - not in 02:45–05:15 (proactive 03:xx, alerts 04:xx, snapshot 04:xx).
   - Suggested: a morning Israel slot, e.g. 06:00–09:00 UTC, with the full window, including D1 re-run, finished before 22:45 UTC.

## Deploy order (one maintenance window)
| # | Step | Verify immediately | Stop if |
|---|---|---|---|
| 0 | Announce; data entry stops (T) | owners acknowledge | — |
| 1 | Build the release candidate on Vercel (not promoted); read-only Preview smoke | commit/tree = candidate; 12 functions; 4 crons; `/app` loads | build error, wrong commit, counts differ |
| 2 | **Apply `biz_access` grants** (Admin; before Rules depend on them) | read back every expected pair | any pair missing/extra |
| 3 | **Promote** the candidate to Production | `/app` serves the fenced client; function and cron inventory; unauthenticated/spoofed probe of the 4 cron paths ⇒ 401 | promotion failed, wrong commit, any cron path ≠ 401 without credentials |
| 4 | **Publish Rules** `1e5dea2f…` within **≤ 5 min** of step 3 | served fingerprint byte/structural match (`canary.mjs plan --env production`, read-only) | mismatch ⇒ re-publish once, else STOP |
| 5 | **Apply entry-ID mapping** (`entry-id-remediation.mjs apply`, one guarded transaction per business, token + attestation + observer) | `verify`: 509 rows, all ids valid/unique, order and every non-id field unchanged | partial/unknown outcome ⇒ stop, reconcile via `status` (never blind retry) |
| 6 | Authenticated smoke across roles; legacy write on a **non-canary** business | writes commit; no cross-business exposure; financial read outputs identical | PERMISSION_DENIED for legitimate users; exposure |
| 7 | Re-run D1 (read-only) | GATE 0 clean | any blocker |
| 8 | Reopen data entry | — | — |
| 9 | First cron cycle (next 23:xx / 03:xx / 04:xx UTC) | four 200s in Vercel cron logs; analytics docs for D-1 per business; digests; alerts summary; snapshot success count | any 401 (C-01), `EntriesStorageError`, missing outputs ⇒ Gate B not signed |

## Maximum unsafe window
| Window | State | Nature |
|---|---|---|
| Promote → Rules publish | new client + old Rules | Writes blocked fail-closed (banner). **Target ≤ 5 min.** Safe (no data change), unavailable. |
| Rules publish → entry-ID apply | new Rules require ids | Legacy writes of id-less nodes denied. Entry is already paused. Safe, unavailable. **Minutes** per business. |
| Before step 3 | status quo | Production keeps today's scheduled-route exposure (SA-01…03). The candidate closes it at promote. |
| After step 3 | — | No security unsafe window from this change: missing `CRON_SECRET` fails **closed** (jobs 401), never open. |

## Stop conditions (any ⇒ stop, keep entry paused, decide rollback)
- Wrong commit or tree promoted.
- Function count ≠ 12 or cron count ≠ 4.
- Any cron path returns anything but 401 without credentials.
- Rules fingerprint mismatch after one re-publish.
- `biz_access` read-back mismatch.
- Entry-ID apply partial/unknown.
- Row count ≠ 509 or any non-id field changed.
- Legitimate-user PERMISSION_DENIED.
- Cross-business exposure.
- `EntriesStorageError`/`EntriesAmbiguityError` in logs.
- D1 re-run not clean.

## Rollback conditions and method
- **Before any `storage_v2_control` record exists** (this whole window): both surfaces are simply reversible.
  - Re-promote the recorded previous Vercel deployment **and** re-publish the recorded previous Rules text, quickly (the same two-sided incompatibility applies in reverse).
  - Rolling Vercel back **re-opens SA-01…03**. Acceptable only as a short emergency measure.
- Entry ids already applied are **not reverted** on rollback. Do not attempt to strip them. But Gate 0 (2026-09-25) found that the July client drops unrecognized fields and re-saves on edit, so after a rollback **id coverage decays** with every July-client edit. A later re-release therefore needs a fresh D1 and a new entry-ID plan. This is why rollback after step 5 is a last resort.
- `biz_access` grants are kept. They are additive and remain valid data under the previous Rules.

## Point of no (simple) return
- This window creates **no** `storage_v2_control` record and performs **no** V2 conversion, so the Storage V2 point of no return is **not** reached here.
- It is reached only in the separately authorized canary:
  - after `migrate` commits there is no simple rollback, only reconciliation;
  - after the first consequential V2 mutation, the frozen `_v` is historical evidence, never current truth, and only CTO-authorized reconciliation can return to legacy (runbook 13).
- For the entry-ID step: after step 5, a Vercel/Rules rollback remains possible. Ids are never reverted, and under the July client they decay. The practical point of no simple return for this window is therefore **step 5 (entry-ID apply)**.
