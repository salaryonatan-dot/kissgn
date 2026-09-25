# MIGRATION WRAPPER (`migrate`) — around the UNCHANGED `tools/storage-v2/upgrade.mjs`

`upgrade.mjs` is not modified (empty diff vs base). It is invoked exactly as approved: `createStorageV2Upgrader({preflightLegacyNode, isV2Node, stampRow, generationFirst})` from the production window helpers, through `createStoragePolicyControl(io).createFencedConversion({upgradeBusinessToV2, entriesIo})` from the unchanged `policy.mjs`.

Ordered gates before any write:
1. identity (`biz config` businessName) — else exit 14
2. environment (production: tool at `approved.repoSha`, clean tree; Rules fingerprint not mismatch)
3. a COMPLETE evidence bundle for this operation (`--bundle` or latest); its preflight not BLOCKER and no unresolved OPERATOR_ACTION_REQUIRED
4. control record valid, phase `quiesced`, operation owned by `operation.{operator,id}`
5. no prior attempt: entries not V2 and `conversionAttempted` false — else `reconcile_required` (exit 13, run `status`)
6. `--expected-revision` (if given) equals the current revision
7. warm listener on the entries node; its digest equals `sourceManifest.sourceDigest` — else `source_drift_before_transaction`
8. fresh held preflight over the warmed node — a new BLOCKER refuses
9. dry-run stops here and prints the intent + token; `--execute` needs the token (identity:command:revision:sourceDigest) and `--ack` bound to the bundleId

Execution: receipt "attempting" → `runConversion` = policy CAS (`conversionAttempted:true`, revision+1, cold-cache probe handled by `policy.mjs`) → core exactly once through **`boundTransactNode`**: on EVERY callback the current node's `digestV1` must equal the evidence digest before the core callback runs; `null` ⇒ abort (`UNEXPECTED_ABSENT`), mismatch ⇒ abort (`SOURCE_DRIFT`), no retry. Then readback: `MIGRATED_HELD` iff the core committed and the node digest equals `expected-v2.json.digest`; policy stays `quiesced`.

Outcomes / exits: `MIGRATED_HELD` 0 · definite refusal (policy error, drift pre-check) 10 · `COMMITTED_BUT_UNEXPECTED_NODE` 12 · `SOURCE_DRIFT` / `UNEXPECTED_ABSENT` / `NOT_COMMITTED` / `UNKNOWN_OR_REFUSED` (transport exception) 13. After any attempt the marker is set and a second `migrate` is refused; the operator runs `status` (A2 source intact / B converted-held / HOLD unrecognised) and decides.
