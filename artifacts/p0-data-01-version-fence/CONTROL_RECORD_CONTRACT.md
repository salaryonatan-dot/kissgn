# CONTROL RECORD CONTRACT — `/storage_v2_control/{tenantId}/{bizId}`

Server-owned. Written ONLY by Admin tooling (`tools/storage-v2/policy.mjs`). Rules: `.write:false` at the root, the tenant and the business level; `.read` for authenticated members of the tenant who are owner/super_owner or have `biz_access` to that business; no listing of a tenant's records (`storage_v2_control/{tenant}` read denied).

```
{
  contractVersion: 1,                       // exactly 1 (a newer value is "unsupported_contract" for honest clients — update required)
  phase: "legacy" | "quiesced" | "v2_active" | "recovery_hold",
  policyRevision: integer ≥ 1,              // monotonic, +1 per transition, never reused or rolled back
  allowV2Initialization: boolean,           // true ONLY while phase === "v2_active" (tooling + parser reject otherwise)
  minStorageProtocol: integer ≥ 1,          // honest-client floor; raised to 2 on v2_active / recovery_hold, never lowered
  operation: null | { id, kind: "cutover" | "recovery", owner, startedAt },   // set in quiesced / recovery_hold
  conversionAttempted: boolean,             // set true by the fenced conversion BEFORE the core runs; blocks abort afterwards
  updatedAt?, updatedBy?, approvedReleaseId? // diagnostic only — never authorization
}
```

## Parse semantics (`lib/storagePolicy.js#parsePolicyRecord`, mirrored byte-for-byte in `index.html`)
| raw | status |
|---|---|
| `null` / `undefined` (WHOLE record absent) | `absent` → legacy behaviour |
| not an object, or `contractVersion` not a number | `malformed` |
| `contractVersion` a number other than 1 | `unsupported_contract` (client: `update_required`; admin/tooling: refuse) |
| `phase` missing / not one of the four | `malformed` (`phase_missing` / `phase_invalid`) — **never legacy** |
| `policyRevision` not a safe integer ≥ 1 | `malformed` |
| `allowV2Initialization` not boolean, or `true` outside `v2_active` | `malformed` |
| `minStorageProtocol` not a safe integer ≥ 1 | `malformed` |
| `operation` present but not `{id,kind,owner,startedAt}` with a known kind | `malformed` |
| `conversionAttempted` present but not boolean | `malformed` |

## Rules-side validity (`VALID` in `RULES_FENCE.md`)
Rules evaluate a slightly weaker predicate than the parser (they cannot test integer-ness): `contractVersion === 1 ∧ policyRevision.isNumber() ∧ ≥ 1 ∧ allowV2Initialization.isBoolean() ∧ minStorageProtocol.isNumber() ∧ ≥ 1 ∧ phase ∈ {legacy, quiesced, v2_active, recovery_hold}`. Anything present that fails `VALID` denies **every** entries write (VF-19/VF-20, mutation "malformed record fails OPEN" proves the conjunct is load-bearing). The tooling only ever writes records that satisfy both predicates (`invalid_next_record` otherwise).

## What the record is NOT
- Not a client capability claim. `STORAGE_PROTOCOL`, `POLICY_CONTRACT_VERSION`, `MARJIN_RELEASE_ID` in the client are honest/diagnostic; `minStorageProtocol` only lets an honest client refuse early (`update_required`). A dishonest client gains nothing: Rules never read client metadata (VF-06).
- Not a Rules-enforced migration state. Admin bypasses Rules; "conversion only in quiesced" is an application-level invariant of `tools/storage-v2/policy.mjs` (see `MIGRATION_WRAPPER.md`).
