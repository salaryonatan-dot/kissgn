# CHANGE SUMMARY — P0-DATA-01 Version Fence (child of `47f7f888`)

**Worktree** `~/Documents/marjin/kissgn-p0-data-01-version-fence`, branch `claude/p0-data-01-version-fence`, base `47f7f8882846b4b0c90fba2947ca3053eb90a9f0` (Storage V2 core + server readers, both independently approved). Not pushed, not deployed, no Production access. The approved server-reader worktree was not touched.

## Invariant delivered
An old or incompatible client can no longer mutate authoritative Storage V2 data. Running historical JS cannot be rewritten; instead the **server** (RTDB Rules) rejects every write such a client can produce, from the moment a business is quiesced, and forever after it is V2. Compatibility is decided by **phase × write-result shape × the existing V2 invariants × the existing auth** — never by a client-supplied version label.

## Files (16 modified, 8 new — `git diff --stat 47f7f888`: 579+/64−; new files 1,636 lines)

| area | file | change |
|---|---|---|
| Rules | `database.rules.json`, `test/emulator/database.rules.json` (byte-identical, blob `11799bd7…`) | entries `.write` becomes `(<core> && CUTOVER_GUARD && FENCE_GUARD)`; new root `storage_v2_control` (member-scoped read, `.write:false` at every level), inserted before `$other`. Nothing else changed (`authorizedVersionFenceRulesDelta` proves it). |
| contract | `lib/storagePolicy.js` (new, pure) + `lib/storagePolicy.d.ts` | record parser (whole-record absence vs malformed), `decideEntriesAccess`, `decideAdminAdmission`, transition table, `planTransition`, typed `StoragePolicyError`. |
| control plane | `tools/storage-v2/policy.mjs` (new, inert) | Admin-SDK transitions with `policyRevision` CAS + operation ownership; `createFencedConversion` gates the UNCHANGED `upgradeBusinessToV2`. No new HTTP API. |
| client | `index.html` (+203/−2, composition seam only) | policy transport, browser mirror of the contract, policy lane bound to the selected business, gate in the storage adapter, `policyRevision` captured in the coordinator binding, reconnect/foreground re-check, typed banner, `blocked_policy` save outcome. Coordinator/router/mutator/legacy engine bodies untouched (source-pinned). |
| server | `api/admin.js` (+11) | entry-exception writes check the policy record after authorization; quiesced/held/malformed/unreadable ⇒ `423 maintenance`, nothing written. (Only server path that mutates a business's ledgers through the Admin SDK.) |
| guard | `test/support/rules-authorized-delta.mjs`, `test/finance/vat-invariant.test.mjs`, `test/dashboard/entries-storage-v2-hardening.test.mjs` [H10], `test/finance/s0-guard-server-reader-mutations.test.mjs` | two-layer S0 Layer A (base→core entries delta, core→live exact fence delta + exact blob pin); reader Layer B projects `database.rules.json` out only after the fence delta validates. No permanent broad exemption. |
| tests | `test/security/storage-policy.test.mjs`, `test/storage-v2/policy-control.test.mjs`, `test/dashboard/entries-version-fence.test.mjs`, `test/security/entry-exceptions-maintenance.test.mjs`, `test/emulator/storage-v2-version-fence.mjs` (new); `storage-v2-rules-guard-mutations.mjs` (+8 fence mutations, two-layer guard), `storage-v2-matrix.mjs` (policies seeded, conversions via the Admin lane, client conversion asserted denied), `rtdb-authorization-matrix.mjs` (+20 control-root cases), wiring/harness/parity updates, `test/emulator/README.md`. |

## Not changed (verified)
`vercel.json`, `api/version.js` (no `/api/version` — D-VF3), `tools/storage-v2/upgrade.mjs`, `package*.json`, `src/**` (five S0 reader pins byte-identical: `a327186c`, `301f9599`, `33a646e9`, `6a3f9be2`, `e36df4d8`), Storage V2 coordinator/router/mutator/legacy engine, generation/clear_all architecture. `git diff 47f7f888 -- src vercel.json api/version.js tools/storage-v2/upgrade.mjs package.json package-lock.json` is empty.

## Decisions applied
D-VF1 absent business ⇒ legacy behaviour, no auto-V2; native V2 only with `v2_active` ∧ `allowV2Initialization=true` set by Admin tooling. D-VF2 narrow reviewed Rules delta; a malformed EXISTING record fails closed (only whole-record absence means legacy). D-VF3 no `/api/version`. D-VF4 `vercel.json` untouched. Codex convergence corrections adopted (whole-record absence, full validity predicate, phase-only fixtures are malformed, no `v2_active→quiesced`, explicit native activation, exact blob pin, fence-first guard ordering, `api/admin.js` admission, conversion core unchanged).
