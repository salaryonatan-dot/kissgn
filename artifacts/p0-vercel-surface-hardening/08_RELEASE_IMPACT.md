# 08 — Release Impact

## Classification: **P0_RELEASE_BLOCKER** (for the approved P0 release candidate)
**Scope of the claim:** local evidence shows that the approved P0 candidate `05bf5a59`, deployed under the documented contract, would **newly** place 330 non-runtime files in the public static output, compared with `origin/main` (doc 02):
- `artifacts/` (255): security reviews, attack matrices, open Gate 0 posture (509 rows without ids, 7 users without `biz_access`), deployment windows, rollback boundaries;
- `tools/` (11): Production-read and migration tooling plus the operator runbook;
- 64 more security and storage tests.

The release would publish, at the moment it goes live, a map of the controls and of the gaps that are still being remediated during the same window. Preventing this costs one config file, and no runtime byte changes.

**What is NOT claimed:**
- No credential value was found in any text file (doc 03).
- Current Production exposure is **unverified**: the deployed commit and Project Settings are unknown, and nothing was requested over HTTP.
- If the deployed commit is `origin/main`, the same model says 58 non-runtime files (docs, 31 tests, Rules, `SECURITY.md`, stale `admin.js`, scripts, the unreviewed image) are statically deployed today. On its own, that would be **P1_PRE_PILOT**.
- If P-BEFORE (doc 07) shows these files are **not** served, the whole item drops to **P2_HARDENING**.
- **Separate owner action regardless:** privately review the image `api לבינה מלאכותית.png`. If it shows an API key, rotate the key. The key's exposure would not depend on this change.

## Manifest delta if this candidate is approved (draft; the approved manifest is not modified)
| Field | Approved P0 | With surface hardening |
|---|---|---|
| Release candidate commit | `05bf5a59…` | this commit (parent `05bf5a59`), SHA in the handoff |
| Runtime delta | 3 cron route files vs `f5d0a8ed` | unchanged + **deployment config `.vercelignore`** (blob `c7140b012034e18f47e652950ee90ad4dec18112`) |
| Expected client `index.html` | `b9c5f220…` | **unchanged** |
| Rules / `vercel.json` | `1e5dea2f…` / `bcd3a3b3…` | **unchanged** |
| Functions / crons | 12 / 4 | **unchanged**; must be re-attested from the build (`vercel inspect`) |
| Canary `approved.repoSha` | `05bf5a59` | this commit (`tools/storage-v2/*` unchanged) |
| Gate B additions | — | (1) excluded-file probes return the catch-all `index.html`; (2) `/app` and `/` OK; (3) 12 functions and 4 crons built; (4) the Git-integration Preview of the release commit passes the same probes **before** promote |
| Rollback | pre-release deployment | unchanged. Redeploying `05bf5a59` restores the old upload set; there is no data effect |

**Integration with HF-1** (`95d20d86`, also a child of `05bf5a59`): the file sets are disjoint (`index.html` vs `.vercelignore`/tests/artifacts). If both are approved, one integration commit or a cherry-pick of one onto the other forms the release candidate. That is a separately authorized Git operation; the combined manifest then takes both deltas.

## Later (not in this candidate)
- **P2 structural:** a build-output boundary (`outputDirectory` + a copy step) so `src/**`/`lib/**` stop being statically downloadable.
- **P2:** separate owner review of the hard-coded user map in `index.html` (doc 03).
