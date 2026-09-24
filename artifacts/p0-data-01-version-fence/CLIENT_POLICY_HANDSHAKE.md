# CLIENT POLICY HANDSHAKE — `index.html` (composition seam only)

All additions sit at the seam the Storage V2 hardening left: the coordinator binding, the storage adapter, and the selection/listener blocks. `createEntriesWriteCoordinator`, `createEntriesStorageRouter`, `createV2EntriesMutator`, `createRemoteEntriesMutator` bodies are unchanged (source pins in `test/dashboard/entries-version-fence.test.mjs` "source pins" + `[H10]`).

## Pieces
1. **Transport** (`window.storage`): `subscribePolicy(tenantId, bizId, cb, onError)` (`onValue` on `storage_v2_control/{t}/{b}`, delivers `null` for absence) and `getPolicy`.
2. **Contract mirror** `window.MarjinStoragePolicy` = `{ STORAGE_PROTOCOL (=2), POLICY_CONTRACT_VERSION (=1), MARJIN_RELEASE_ID, POLICY_PHASES, parsePolicyRecord, decideEntriesAccess, createPolicyLane, gatePolicyDispatch, describePolicyState }` — parity with `lib/storagePolicy.js` is pinned by test (every policy × mode cell decides identically).
3. **Policy lane** (`createPolicyLane`): per selection; tracks the max `policyRevision` seen (a lower revision later ⇒ `policy_rollback`, fail closed); subscription error ⇒ `policy_unavailable`; combines the parsed record with the hydrated raw storage mode into one `decision` `{state, writable, reason?, revision, initialization?}`.
4. **Binding**: `storageBinding()` now returns `{ mode, generation, policyRevision }`. The coordinator captures it per intent exactly as it captured `generation`.
5. **Gate** in the adapter: `mutate(intent, ctx, binding)` → `gatePolicyDispatch(lane.decision(), binding)`; if not writable ⇒ `{status:"blocked_policy", reason}`; if `binding.policyRevision !== lane.revision()` ⇒ `{status:"blocked_policy", reason:"policy_changed"}` (an intent bound under an older policy never dispatches); else forwards the ORIGINAL binding to the unchanged router.
6. **Selection reset**: the business-selection effect nulls `entriesPolicyRef` and the UI state before subscribing; a business switch can never reuse the previous lane, revision or binding (VF-08: a late callback for the previous business is discarded).
7. **Re-check**: `visibilitychange` (visible) and `online` trigger `__policyRefresh` (fresh `getPolicy`), so a policy changed while the socket was silent is applied before the next save (unit test "foreground / reconnect").
8. **UI**: banner (`data-policy-state`) from `describePolicyState` — `update_required` (reload button), `maintenance_read_only` (quiesced / recovery_hold texts), `initialization_not_enabled`, blocked family (`policy_malformed`, `policy_rollback`, `v2_without_policy`, `conversion_pending`, `storage_malformed`, `policy_unavailable`). `describeSaveOutcome` renders `blocked_policy` as "not saved" Hebrew texts — a fenced write is never reported as saved.

## States (typed, fail-closed)
`policy_unresolved` · `policy_unavailable` · `policy_malformed` · `update_required` · `maintenance_read_only` · `initialization_not_enabled` · `storage_unresolved` · `storage_malformed` · `v2_without_policy` · `conversion_pending` · `policy_rollback` · `legacy` (writable) · `v2` (writable, `initialization:true` when the first create may initialise).

## Race the client cannot close (and does not need to)
Between the gate and the server commit the policy may change. The server is authoritative: VF-26 / unit test "a write the SERVER denies (fence race)" — the V2 lane surfaces `blocked/rules_rejected`, the legacy lane `failed` with the permission error; neither is reported as saved. The lane then reflects the new policy.
