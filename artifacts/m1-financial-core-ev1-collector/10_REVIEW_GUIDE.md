# 10 — Review guide (Codex focused re-review)

| Item | Value |
|---|---|
| Branch | `claude/m1-financial-core-ev1-collector` |
| Parent | `0bcd1753c1cc4bf40c7dbaf432fab57bb2999cd6` (approved Slice A) |
| Commit | one commit on top of the parent |
| Worktree | `~/Documents/marjin/kissgn-m1-financial-core-ev1-collector` |

## Scope of the diff
```
git diff --stat 0bcd1753 HEAD
```
The expected paths are:
- `tools/finance-core/ev1-collector.mjs`
- `tools/finance-core/ev1-transport.mjs`
- `tools/finance-core/ev1-preflight.mjs`
- `test/finance/ev1-collector.test.mjs`
- `artifacts/m1-financial-core-ev1-collector/*`

No change to `src/`, `fincore/`, `lib/`, `api/`, `index.html`, Rules, `package*.json`, or `tools/finance-core/ev1-classifier.mjs`.

## Suggested order
1. `01_SCOPE_ENUMERATION_CONTRACT.md`: verify every cited `index.html`, `api/admin.js` and `src/**` line. Challenge the union rule and the exclusion of `proactive_biz_index`.
2. `ev1-collector.mjs`:
   - `collect()`: discovery, the one-read-per-business loop and classification;
   - `evaluateReport()`: I01–I19;
   - `sanitizeClassification()`, `writeBundle()`, `verifyBundle()`.
3. `ev1-transport.mjs`: token/IAM before any GET; typed outcomes; `null` versus failure.
4. `ev1-preflight.mjs`: every refusal runs before the transport exists.
5. Tests: try your own mutations. The eight in 08 are each caught.
6. `07_OPERATOR_RUNBOOK.md`: success and stop markers.

## Questions for the reviewer
- **Tenant authority:** is the shallow `tenants` listing acceptable as the tenant authority, given that all entries live under it?
- **Row ids:** is dropping EV1/3's capped row-id lists acceptable for the gate? The B1 STOP rules only need counts.
- **Env refusal:** `GCLOUD_PROJECT` / `GOOGLE_CLOUD_PROJECT` are refused as a precaution. Should they be allowed?
