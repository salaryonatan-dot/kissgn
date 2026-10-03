# 03 — Sensitive File Review (no secret value printed)

**Method:**
- A pattern scan over all 543 tracked files at `05bf5a59`: private-key blocks, `"private_key"`, Google API keys, `sk-…`/`gh?_…`/`xox…` tokens, long bearer literals, secret-looking assignments, e-mail addresses, the Firebase project id, the Production alias, tenant/business ids, local user paths.
- Every hit was inspected **with the matched token redacted**. Counts only below.
- Binary files were not opened.

## Credentials and secrets
| Pattern | Hits | Location | Verdict |
|---|---|---|---|
| Private-key block / `"private_key"` | 3 | `docs/production-readiness/test/redaction.test.mjs`, `test/storage-v2/canary-transport.test.mjs` | **synthetic** fixtures (`SYNTH`, `x`) that test redaction |
| Bearer literal ≥ 24 chars | 2 | the same redaction test; `test/security/scheduled-auth-matrix.test.mjs` | synthetic (`synthT…`, a fake JWT `…sig`) |
| Secret-looking assignment | 6 | tests (`"test-c…"`, `"fixtur…"`, `"rl-tes…"`), one redaction test, one false positive in `tools/storage-v2/canary-transport.mjs` (URL builder) | synthetic / not a secret |
| Google / OpenAI / GitHub / Slack token formats | 0 | — | — |
| Firebase project id (`kissgn-1227b`) | 0 | — | — |

**Result: no real credential value was found in any tracked text file.** The scan covers known formats only; it is not a guarantee.

**UNKNOWN — one binary.** `api לבינה מלאכותית.png` ("API for AI", 2880×1800, 1.4 MB, since the initial commit `2820fa7`, referenced by nothing). The name suggests an AI-API setup screenshot. It was **not opened**, because this task forbids inspecting secrets. It is also in `origin/main`. Owner action: review it privately. If it shows a key, treat that key as potentially exposed (see doc 08) and rotate it, whatever this hardening does.

## Operational, security and Production-state material (would be public without the hardening)

| Category | Where | Why sensitive |
|---|---|---|
| Security architecture and access model | `database.rules.json` (the full RTDB authorization model), `SECURITY.md`, `test/security/**` (attack matrices: spoofed cron headers, token forms, role tiers), `artifacts/*/0*_*SECURITY*`, `*ATTACK*`, `*AUTHORIZATION*` | maps every authorization decision and its tested edge cases |
| Open security posture | `artifacts/p0-scheduled-auth-release/03_RELEASE_BLOCKERS.md`, `04_JOB_RELIABILITY_REVIEW.md`, `08_GATE0_DEPENDENCY_MAP.md`, `artifacts/p0-data-01-*` | lists **still-open** gaps: 509 entry rows without ids; `biz_access` missing for 7 restricted users; non-atomic alert dedupe; duplicate snapshot emails; served Rules and deployed commit unknown |
| Operator runbooks and deployment plans | `artifacts/*/07_COORDINATED_DEPLOYMENT_PLAN.md`, `docs/production-readiness/{release-order,rollback-plan,go-no-go-checklist,smoke-tests,production-baseline}.md`, `tools/storage-v2/CANARY_OPERATOR.md` | window timing, maintenance holds, rollback boundaries, cron hours |
| Production-read and migration tooling | `tools/storage-v2/**` (canary, preflight, upgrade/migration, Production REST transport), `scripts/backfill-biz-access.mjs`, `scripts/init-owner-guard.mjs`, `docs/production-readiness/*-audit.mjs` | code that reads or mutates Production data under operator credentials |
| Historical evidence and logs | `artifacts/**/*.log` (test/emulator runs), review packages | noise, but also local paths |
| Local identifiers | `/Users/<name>/…` paths: 54 occurrences (53 in `artifacts/`, 1 in `docs/`) | username and folder layout |
| Stale server source | root `admin.js` (an older copy of the admin endpoint; differs from `api/admin.js`) | code no longer reviewed |

A redacted dry-run template exists (`docs/production-readiness/biz-access-dry-run.json`). It carries redacted references (`hhhhhh_<hhhh>`), not Production ids.

## Observation outside this change (runtime file, not addressed)
`index.html`, a required public runtime file, contains a hard-coded user map with an owner e-mail address, a tenant id and a full name (line ~3080). It is served by design and was out of scope; it needs separate owner review (**P2**).
