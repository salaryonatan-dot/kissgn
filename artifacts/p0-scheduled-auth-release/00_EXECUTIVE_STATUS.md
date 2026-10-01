# 00 — Executive status: P0 scheduled-job authorization + release manifest

**Status: COMPLETED (local).** One local commit on `claude/p0-scheduled-auth-release` (parent `f5d0a8ed`). Nothing pushed, deployed or read from Production.

## What was wrong
- The approved P0 tip `f5d0a8ed` still trusted the spoofable `x-vercel-cron` header on 3 of the 4 scheduled routes:
  - analytics daily-builder;
  - daily-snapshot email;
  - proactive scan.
- The SYS-P0-001 fix (`4ce7c842`, Codex-APPROVED 2026-07-29) was never integrated into the P0 lineage.
- Anyone could trigger all-business analytics writes, send every owner's snapshot email (or any single business's), and run the proactive scan.
- `origin/main` carries the same code, so any pre-P0 deployment carries this exposure today. The deployed identity is unverified.

## What changed
- The approved fix is ported **byte-identically**: the three route files and their dependencies are unchanged between the fix's base and `f5d0a8ed` (verified blob by blob).
- A committed full adversarial matrix (54 tests) covers all four cron routes, including the already-hardened alerts route. Its negative control fails 12 cases on `f5d0a8ed`.

| Metric | Value |
|---|---|
| Scheduled routes | 4 (`vercel.json`); 12 functions total, none added |
| P0 auth blockers | 3 found / 3 closed locally (SA-01 daily-builder, SA-02 daily-snapshot, SA-03 proactive) |
| Config-only gates | `CRON_SECRET` present in Vercel Production (else all jobs 401, fail-closed); Production-only scope; no `x-vercel-cron`-only external caller |
| Job reliability | No release blocker. P1 before pilot: snapshot duplicate email on duplicate cron delivery, no durable run receipts, non-atomic alert dedup under overlap. Deferred to the Daily Intelligence package. |
| Release manifest | READY (06); Production facts explicitly unverified |
| Coordinated deploy plan | READY (07): biz_access → promote → Rules ≤ 5 min → entry-ID apply → smoke → D1 → reopen; outside cron hours |
| Gate 0 remaining | entry IDs (509/509 missing); `biz_access` (7 users); served Rules unknown; deployed identity unknown; D1 incomplete; scheduled-auth config half |
| Tests | full 965/965 (baseline 880); focused 138/138; tsc 22×TS2742 identical to baseline |

**Next action:** Codex focused review of this commit (10).
