# biz_access Read-Only Dry-Run (Phase 3)

## Why this matters
The new Rules deny biz-scoped reads/writes unless the caller is `owner`/`super_owner`
OR has an explicit `tenants/{tid}/biz_access/{bizId}/{uid} === true` grant
(`manager`/`shift_manager`/`viewer`). If Production users lack these grants when the
restrictive Rules go live, they will be **locked out** of their business data. This
dry-run measures coverage BEFORE any Rules deploy.

## Authoritative model (from the code)
- Membership: `tenants/{tid}/members/{uid} === true`
- Role: `tenants/{tid}/roles/{uid}` ∈ {owner, super_owner, manager, shift_manager, viewer}
- Grant: `tenants/{tid}/biz_access/{bizId}/{uid} === true`
- Desired scope for scoped roles: `app/users` record `allowedBizIds: string[]`
- owner/super_owner: implicit scope (no per-business grant required)

## How to run (operator, READ-ONLY)
```
GOOGLE_APPLICATION_CREDENTIALS=/path/to/readonly-sa.json \
FIREBASE_DATABASE_URL="https://<project>.firebaseio.com" \
node docs/production-readiness/biz-access-audit.mjs --tenant <tenantId> \
    --out docs/production-readiness/biz-access-dry-run.json
```
The script performs only `.once("value")` reads, writes **no** Firebase data, redacts
uids/emails to salted hashes, and emits a `biz-access-dry-run.json` proposal that is
explicitly labeled **DRY-RUN ONLY — not a Production write payload**. Exit 0 = all READY;
exit 3 = attention (backfill/review) needed; exit 2 = access/error.

## Result categories (counts filled in by the operator run)
| Category | Meaning | Count |
|---|---|---|
| READY | grant present (or owner/super implicit) + valid membership | _pending run_ |
| NEEDS_BACKFILL | member with `allowedBizIds` but missing `biz_access` grant | _pending run_ |
| AMBIGUOUS_MAPPING | grant desired but membership/role inconsistent | _pending run_ |
| ORPHANED_ACCESS | `biz_access` grant without membership | _pending run_ |
| INVALID_ROLE | role missing or not in the valid set | _pending run_ |
| UNKNOWN_BUSINESS | grant/desire pointing at a nonexistent business | _pending run_ |
| MISSING_MEMBERSHIP | role/user present without `members` entry | _pending run_ |

## Proposed backfill input format (dry-run; NOT executed here)
```json
{
  "note": "DRY-RUN ONLY — NOT A PRODUCTION WRITE PAYLOAD. Review + separate authorization required.",
  "tenantId": "<tenantId>",
  "proposedGrants": [
    { "tenantId": "<tenantId>", "bizId": "<bizId>", "uid": "<uid>", "role": "<role>", "grant": true }
  ]
}
```
The existing operator tool `scripts/backfill-biz-access.mjs` (dry-run by default) is the
ONLY sanctioned applier, and only under separate written authorization (Phase 5 step 4).

## Planning-environment status
Not executed here — no Production read credentials. Operator must run before Go; a
non-empty NEEDS_BACKFILL/AMBIGUOUS/ORPHANED/UNKNOWN/MISSING set blocks the frontend+Rules
window until reconciled.
