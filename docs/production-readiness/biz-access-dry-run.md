# biz_access Read-Only Dry-Run (Phase 3, hardened)

## Why this matters
The new Rules deny biz-scoped reads/writes unless the caller is `owner`/`super_owner`
OR has an explicit `tenants/{tid}/biz_access/{bizId}/{uid} === true` grant
(`manager`/`shift_manager`/`viewer`). If Production users lack these grants when the
restrictive Rules go live, they will be **locked out**. This dry-run measures coverage
BEFORE any Rules deploy. It **never writes to Production**.

## Canonical model (mirrors the app, not a guess)
- `app/users` = `{_v:"<JSON array>"}` (or a JSON string / raw array) parsed exactly like
  `lib/bizAccess.js::parseAppUsers`. Each record: `{ firebaseUid|uid, email, role, allowedBizIds?[] }`.
- `app/business` = `{_v:"<JSON array>"}` of `{id, name}`. The business id is `item.id`
  (a string) — **array indexes are never treated as ids**.
- Grant: `tenants/{tid}/biz_access/{bizId}/{uid} === true`; membership `members/{uid}===true`;
  role `roles/{uid}`.
- owner/super_owner: implicit all-business scope per the actual Rules; they hold NO
  `biz_access` entries and their `allowedBizIds` is ignored.

Pure logic lives in `lib/biz-access-model.mjs` (`classifyBizAccess`), unit-tested in
`test/biz-access-audit.test.mjs`. The CLI `biz-access-audit.mjs` is a thin read-only wrapper.

## Classifications (fail-closed: malformed data can NEVER be READY)
| Category | Meaning |
|---|---|
| READY | grant present (or owner/super implicit) + valid membership |
| NEEDS_BACKFILL | scoped member with `allowedBizIds` but missing `biz_access` grant → additive proposed grant |
| AMBIGUOUS_MAPPING | malformed source, duplicate record, conflicting authoritative(role)/advisory(app/users), invalid/empty allowedBizIds |
| ORPHANED_ACCESS | `biz_access` grant without membership |
| INVALID_ROLE | role missing or not in the valid set |
| UNKNOWN_BUSINESS | grant/desire pointing at a business absent from the registry |
| MISSING_MEMBERSHIP | role/user present without a `members` entry |

Proposed grants are **additive only** (no removal recommendations), each carrying redacted
evidence (`userRef`, `businessRef`, `appUsersIndex`, `role`, `reason`).

## Redaction & output safety
- Output is redacted by default: **no raw uid/email/name/tenantId/bizId** — only
  non-reversible hashes + `appUsersIndex` source indexes for reconciliation.
- A file is written only with an explicit `--out`, and only under
  `docs/production-readiness/output/` or `/tmp`; it is a DRY-RUN artifact, **not directly
  executable** as a Production write payload.
- The CLI performs only `.once("value")` reads — no set/update/push/remove/transaction.

## How to run (operator, READ-ONLY)
```
GOOGLE_APPLICATION_CREDENTIALS=/path/to/readonly-sa.json \
FIREBASE_DATABASE_URL="https://<project>.firebaseio.com" \
node docs/production-readiness/biz-access-audit.mjs --tenant <tenantId> \
    --out docs/production-readiness/output/biz-access-dry-run.json
```
Exit 0 = all READY; exit 3 = attention (backfill/review) needed; exit 2 = access/error.

## Planning-environment status
Not executed here (no Production read credentials). Operator must run before Go; any
non-empty NEEDS_BACKFILL/AMBIGUOUS/ORPHANED/UNKNOWN/MISSING set holds the Rules+frontend window.
