# 08 — Gate 0 dependency map (from current evidence; Gate 0 not run)

Evidence used:
- Gate 0 read-only audit of 2026-09-25 (`GATE_0_ENTRY_ID_BLOCKED`);
- the D1 attempt of 2026-09-28 (no valid Rules body; the captured "response" is a Console error text);
- remediation tooling `aaef1213` (not run);
- the 2026-09-29 gap audit;
- this change.

| Blocker | State | Evidence | What clears it | Type |
|---|---|---|---|---|
| **Entry IDs** | **OPEN**: 509/509 legacy rows without `id` across 5 businesses (0 malformed, 0 duplicate dates) | Gate 0 2026-09-25 | D1 baseline → `plan` bundle → `apply` inside the release window after promote + Rules → `verify` | Production read + write (window) |
| **`biz_access`** | **OPEN**: absent for all 7 restricted users | Gate 0 2026-09-25 | Reviewed grant set applied before Rules publish, read back | Production write (window) |
| **Served Rules identity** | **UNKNOWN** | The SA read returned 401 on Rules. The 2026-09-28 D1 Rules capture is an error page, not Rules JSON. | D1 with a valid Console Rules response body (classify PRE_JULY/JULY/R10_1/P0_APPROVED) | Production read (operator) |
| **Deployed client/server identity** | **UNKNOWN** | No Vercel deployment metadata recorded. Local evidence: none of the P0 chain was pushed or deployed. `origin/main` = `0243123` (2026-07-22). | D1 Vercel identity step, or operator reads the Production deployment commit in the dashboard | Production read (operator) |
| **Scheduled-route authorization** | **LOCAL CODE CLOSED** in this commit (pending Codex). Config half open: `CRON_SECRET` presence in Production unverified. | 03 / 05 | Codex approval + C-01 presence check (+ creation if absent, separately authorized) | Local review + configuration |
| **Complete D1 run** | **OPEN**: no complete run found | gap audit 2026-09-29 | run `aaef1213` D1 end to end | Production read |

## Already closed — not repeated
- Storage V2 core.
- Server-reader convergence (legacy `_v` readers, duplicate-date fail-closed).
- Version fence and Rules blob `1e5dea2f…` (approved).
- Canary tooling (approved).
- Gate 0 remediation tooling built (`8757854` → `aaef1213`).
- `storage_v2_control` absent in Production (expected state; "absent ⇒ legacy").
- 0 malformed or duplicate rows (2026-09-25).

## Other proven items that gate later stages (not Gate 0)
- A known product behaviour (entering today's revenue; future-dated rows) must be baselined on a non-canary business before canary GATE C (runbook 16).
- Canary business selection and owner attestation.
- A read-only Production service account was used for Gate 0 on 2026-09-25. Its current state was not re-checked (this task did not touch credentials).
