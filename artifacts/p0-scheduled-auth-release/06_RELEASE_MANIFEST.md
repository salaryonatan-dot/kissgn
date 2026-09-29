# 06 — P0 release manifest (decision-ready; nothing here is Production-verified)

## Code identity
| Item | Value | Status |
|---|---|---|
| **Release candidate commit** | the commit that adds this file: branch `claude/p0-scheduled-auth-release`, **parent `f5d0a8edffc216f0b6ad342f8bd1bb0d630276ab`**. The exact SHA is recorded in the external handoff (`~/Documents/marjin-reviews/2026-09-29/p0-scheduled-auth-release/`) and must be re-pinned after Codex review. | LOCAL CODE COMPLETE, pending Codex |
| Delta vs `f5d0a8ed` (runtime) | exactly `api/analytics/daily-builder.ts`, `api/daily-snapshot/run.ts`, `api/proactive/run.ts` (blobs `c918d892…`, `cf8fde71…`, `6762e571…` = Codex-approved `4ce7c842`) | — |
| Delta vs `f5d0a8ed` (non-runtime) | tests (`test/security/cron-auth-hardening`, `cron-auth-source-invariants`, `scheduled-auth-matrix`, `test/analytics/rebuild-rate-limiter`), `artifacts/p0-cron-auth-r1/` (approved SYS-P0-001 package), `artifacts/p0-scheduled-auth-release/` | — |
| Approved milestones in the lineage | Storage V2 `8cac71c1`; server readers `47f7f888`; version fence `5afb2754`; canary tooling `f5d0a8ed` | APPROVED (Codex) |
| Scheduled auth | SYS-P0-001 `4ce7c842` (APPROVED 2026-07-29), ported byte-identically | port pending Codex |
| **Expected client** | `index.html` blob **`b9c5f2205c70604899717b508c07d7f5212602dc`** (unchanged from `f5d0a8ed`); `MARJIN_RELEASE_ID = "2026-09-24-version-fence-p0"`; `STORAGE_PROTOCOL = 2` | — |
| **Expected server/API** | the release candidate commit: 12 functions, 4 crons (`vercel.json` blob `bcd3a3b3…` unchanged) | — |
| **Expected Rules** | `database.rules.json` blob **`1e5dea2f9b1eac037c766b325b927c20285c0eec`** (= `APPROVED_FENCE_RULES_BLOB`); byte or structural match acceptable per runbook 02 step 5 | — |
| Prior Rules in the repository baseline | `1b323059c9b52eb5b97881e8ff29e3fff3927fb7` (`origin/main` `0243123`, and R5) | **served Rules unverified** |
| **Expected storage version** | legacy `{_v}` for every business at release. Storage V2 `{schemaVersion:2, generation, rows}` only after a CTO-authorized canary migration. Readers accept both. | — |
| **Expected version fence** | `storage_v2_control/{t}/{b}` absent ⇒ legacy; `POLICY_CONTRACT_VERSION = 1`; `FENCE_GUARD` in the Rules above; Admin gate in `api/admin.js` | — |
| **Expected scheduled-job auth** | contract in 02: Bearer `CRON_SECRET` only on all four crons; `x-vercel-cron` never; owner-only manual POSTs | LOCAL CODE COMPLETE |
| **Expected canary tooling** | `tools/storage-v2/*` byte-identical to `f5d0a8ed`. The canary manifest's `approved.repoSha` must equal the operator checkout HEAD: use **the release candidate SHA** (same tool blobs; `repoIdentity` pins unaffected). | — |
| Gate 0 remediation tooling | `aaef12134ad43513d8a88b8d220ab7bc2b78411b` (branch `claude/gate0-entry-id-remediation`, child of `8757854` → `f5d0a8ed`). Operator-side only; never deployed. | tooling ready; never run |

## Operator actions before Production, by category
### LOCAL CODE COMPLETE
- P0 storage, readers, fence and canary tooling (approved).
- Scheduled auth (this commit; awaiting Codex).
- Gate 0 tooling `aaef1213`.

### CONFIGURATION REQUIRED (no code)
1. **C-01**: confirm `CRON_SECRET` exists in Vercel **Production** env. Check presence only; never print it. Random, at least 16 characters. If absent, create it before promote (a secret creation, separately authorized). A change requires a redeploy.
2. **C-02**: scope `CRON_SECRET` to Production only (not Preview).
3. Inventory non-Vercel callers of the four routes (operator scripts, monitors). Each must send `Authorization: Bearer`; any `x-vercel-cron`-only caller will get 401 after promote.
4. Confirm the Vercel plan (Hobby: hour-level jitter, 12-function cap = current count) and that the project deploys `vercel.json` crons unchanged.

### PRODUCTION READ REQUIRED (separately authorized, read-only)
1. D1 complete run with `aaef1213`, using a **valid** Rules response body. The 2026-09-28 capture was an error page, so no valid body exists yet. D1 covers:
   - served Rules classification;
   - entry-ID coverage;
   - `biz_access`;
   - users/roles/business registry;
   - `storage_v2_control` absence;
   - Vercel identity.
2. Record the currently deployed Vercel deployment (commit and tree) as the rollback target.
3. Record the served Rules text blob as the Rules rollback target.
4. Entry-ID `plan` (dry-run mapping) for the five affected businesses.

### PRODUCTION WRITE / DEPLOY AUTHORIZATION REQUIRED (CTO, one combined window; see 07)
1. Apply `biz_access` grants.
2. Promote the Vercel release candidate.
3. Publish Rules `1e5dea2f…`.
4. Apply entry-ID mapping (five businesses, one guarded transaction each).
5. Secret creation, only if C-01 finds none.

### POST-DEPLOY VERIFICATION (Gate B)
- Promoted commit equals the release candidate: 12 functions, 4 crons.
- Served Rules fingerprint equals `1e5dea2f…` (byte or structural).
- Unauthenticated probe of each cron path returns 401. The operator may send one GET **without** credentials and **with only** `x-vercel-cron: 1` to each of the four paths: a request that fails authorization performs no side effect.
- Authenticated smoke across roles.
- Legacy read and write on a non-canary business.
- 509 rows preserved with valid unique ids.
- D1 re-run clean.
- First complete cron cycle: four 200s in the Vercel cron logs plus outputs (04 §"what must be true").

### CANARY MONITORING (separate CTO gates)
- One-business Storage V2 canary per runbook 04–12.
- 168 h plus seven adjacent complete cycles.
- Receipts are Vercel cron logs plus output presence; missing ⇒ `UNKNOWN`.

## Explicitly unverified (do not claim)
- Deployed Vercel commit.
- Served Rules.
- `CRON_SECRET` presence.
- `biz_access` repair.
- Entry-ID coverage after 2026-09-25.
- Whether any Production caller depends on `x-vercel-cron`.
