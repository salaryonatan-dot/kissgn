# Daily builder to delivery contract, proposed R3

Owner of this interface: Agent/Daily builder consumer. The delivery route is owned separately. This proposal requires independent review and reconciliation with the eventual approved M1 registry module; it grants no delivery or release approval.

## Exported TypeScript surface

`src/snapshot/snapshotBuilder.ts` exports `buildSnapshotRun(opts?: {readonly nowMs?: number}): Promise<SnapshotBuildRun>`, `buildSnapshotForBiz(tenantId, bizId, opts?)`, and the legacy `buildSnapshotForAll(): Promise<SnapshotData[]>` adapter. The adapter drops accounting and cannot be used by a route reporting run completion.

`SnapshotBuildRun` has version `MARJIN_SNAPSHOT_BUILD_RUN/1`, Israel `businessDate`, `status: complete | incomplete`, `discovery: {status: complete | failed, failures: SnapshotDiscoveryFailure[]}`, `expectedBusinesses: SnapshotBusinessIdentity[]`, `snapshots: SnapshotData[]`, `failedBuilds: SnapshotBuildFailure[]`, and `exclusions: SnapshotExclusion[]`. Every identity has `tenantId`, `bizId`, and `businessDate`. Failure codes are `snapshot_build_failed`, `business_name_unavailable`, `ambiguous_business_identity`, `invalid_business_identity`, `business_not_registered`, `registry_unreadable`, or `registry_unavailable`. Discovery sources are `proactive_biz_index` or `app_business`; their codes are `read_failed`, `malformed_source`, or `malformed_entry`. Exclusion reasons are `explicit_inactive`, `index_only`, or `legacy_self`.

Exactly one successful snapshot or failed build must exist for every expected identity, with the same date. `snapshot_accounting_invariant` throws before returning an inconsistent run. That fail-closed exception means the route must report a failed run and must not deliver partial results from the aborted call. A successful return can be partial: complete snapshots may coexist with failed builds or discovery failures. No financial figures or synthetic snapshot are produced for a failed build. Raw exceptions, addresses, tokens, and provider details are not included in handoff rows or builder logs. Tenant and business IDs remain scoped identifiers, not anonymous data.

Discovery accepts the runtime `{_v:"[...]"}` registry envelope. An unrelated bare null is non-identifying and cannot block a unique valid target. A list consisting only of null entries is an unreadable registry, not an empty one. Unsupported raw arrays or JSON strings and identities rejected by the shared predicates are discovery failures. A sole padded business ID is an exact supported identity; a padded or coerced twin makes the target ambiguous. Duplicate target identity is a failed expected build in either record order; the builder never uses the first record's name. This carry-forward calls the approved M1 R5 registry module directly.

The carried Builder keeps the `/1` handoff fields. The manual builder and scheduled failed-build rows use the delivery coordination contract §3 codes: `invalid_business_identity`, `business_not_registered`, `ambiguous_business_identity`, `registry_unreadable`, `registry_unavailable`, `business_name_unavailable`, and `snapshot_build_failed`. Registry transport/read failure is `registry_unavailable`; a readable empty list is `business_not_registered`; a malformed or absent registry node is `registry_unreadable`. No raw parser or database error is exposed. An absent tenant list, an object tenant without `app/business`, or `{_v:"[]"}` is a clean empty registry. A **present** `app/business` scalar, raw array or undecodable envelope, and a primitive tenant or `app` node, are `app_business/malformed_source` discovery failures, never clean emptiness. The carried Builder uses the approved shared `isValidId` tenant predicate and `isRegistryBizId` business predicate. They preserve exact padded identities; a business ID with `:` or an RTDB-forbidden character is unsafe, while a tenant ID with `:` is addressable. No trim, coercion or alias forms a business-scoped path. An exact registered ID with a padded or numeric twin is `ambiguous_business_identity` in either order; the twin cannot grant registration. Pair keys are collision-free. An unrelated malformed non-null entry remains a discovery failure while a valid target may still build; whether such a run can later be classified more narrowly is an unresolved owner policy. The Builder composes the approved M1 R5 predicates with the owner-decided RTDB control-character exclusion (U+0000–U+001F and U+007F), without trimming or aliasing. Refused discovery ids produce `malformed_entry`, and the manual builder refuses before a database reference. The shared M1 predicates themselves still require an owning-layer transition for global consistency; this Builder does not edit those protected modules. The legacy-self product question remains open.

The manual Builder's bounded registry and identity refusals have `name === "SnapshotIdentityRefusal"`, an own `code` equal to `message`, and a message in the six-code §3 set. The delivery route must require all three before mapping a thrown value to a refusal. An unrelated loader or financial error whose message equals a code remains `snapshot_build_failed`. The class stays private to the Builder. This is a provenance refinement of §3; it changes no code or owner policy.

## Example result shapes

Examples omit financial fields of `SnapshotData`.

Complete: `{version:"MARJIN_SNAPSHOT_BUILD_RUN/1",businessDate:"2026-09-29",status:"complete",discovery:{status:"complete",failures:[]},expectedBusinesses:[{tenantId:"t",bizId:"a",businessDate:"2026-09-29"}],snapshots:[{tenantId:"t",bizId:"a",date:"2026-09-29", ...financials}],failedBuilds:[],exclusions:[]}`.

Partial failure: the same version and date, expected `a` and `b`, one snapshot for `a`, `failedBuilds:[{tenantId:"t",bizId:"b",businessDate:"2026-09-29",code:"snapshot_build_failed"}]`, and `status:"incomplete"`.

Total failure: expected `a` and `b`, zero snapshots, one failed-build row for each, `status:"incomplete"`. A complete zero-eligible run has zero expected identities, snapshots and failed builds, no discovery failure, and `status:"complete"`. A discovery failure with zero expected identities remains `incomplete`.

## Delivery consumption and G1-G9 reconciliation

| Gap | Required delivery behavior |
| --- | --- |
| G1 | Call `buildSnapshotRun`, not `buildSnapshotForAll`; derive overall status from builder and delivery outcomes. |
| G2 | Include discovery failures in run accounting. A failed discovery is `completed_with_failures`/HTTP 500 even with zero known businesses. |
| G3 | Emit each failed build as `{tenantId,bizId,businessDate,outcome:"failed",code,settlement:"failed"}`. Bound the new ambiguity code too; never mark it accepted, skipped or no-send. |
| G4 | Per owner decision D-G4, a registered record with no nonblank string name fails before financial reads as `business_name_unavailable`. A literal `"Unknown"` is a valid name. No placeholder or synthetic snapshot is produced. The later delivery route must record the failed row and owner notice; scheduled end-to-end closure remains pending. |
| G5 | Report legitimate exclusions as non-deliverable counts or rows. They do not imply success and do not make the run incomplete. An invalid registry shape is not an exclusion. |
| G6 | Successful receipt identity uses `snapshot.date`; failure rows use `businessDate` and create no receipt. |
| G7 | An accounting invariant exception fails the entire build run before delivery. Do not catch it as an empty successful run. |
| G8 | Reconcile the shared `test/finance/b2-snapshot.test.mjs` edits with Claude's email branch by hand, without silently replacing either ownership assertion. |
| G9 | Remove the `todo` from DR1-C1 only after the real route passes the combined builder-delivery scenario on the reconciled SHA. |

**G10 integration remains open with the delivery owner:** this Builder emits the exact §3 codes listed above. The future delivery route must map each to the owner-approved bounded refusal. This branch does not edit that route; its independent owner-decisions review identified a separate source-classification defect in the route. X1 (one build failure), X2 (all fail), and X3 (discovery failure) likewise remain open until the route consumes this structured result on one approved combined SHA.

A clean completed response requires complete discovery, zero failed builds, and every required delivery outcome successfully settled under the email contract. Provider acceptance is distinct from inbox delivery. Retried/unknown receipts follow the separately reviewed delivery contract. Partial business outcomes must remain visible in status and rows.

## Combined acceptance (X1-X3 and control)

For one Israel run date seed two eligible businesses. Make the second authoritative entries read fail. Invoke the real authenticated GET route with a local fake provider: the first snapshot is sent, the second has a failed-build row with tenant, business, and date, no send, and the overall response is incomplete. Repeat with both builds failing (no provider call, incomplete) and discovery failing with zero expected identities (incomplete). A clean zero-eligible run may complete; a clean two-business run must preserve financial bytes and delivery semantics. Also test both duplicate record orders, unrelated null, invalid registry shapes and padded IDs on the combined SHA. This candidate does not edit the delivery route, so X1-X3 remain pending.
