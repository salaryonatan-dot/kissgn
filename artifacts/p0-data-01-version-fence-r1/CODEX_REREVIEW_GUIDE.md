# CODEX RE-REVIEW GUIDE — Version Fence R1 (one child commit of `09370d49`)

**Where:** worktree `~/Documents/marjin/kissgn-p0-data-01-version-fence`, branch `claude/p0-data-01-version-fence`, `git diff 09370d49`. Not pushed, not deployed. `index.html`, Server Reader runtime/pins, coordinator/router/mutator, `upgrade.mjs`, `vercel.json`, `api/version.js`, package files: unchanged.

## Reading order (≈ 45 min)
1. **F1** `POLICY_CONTRACT_PARITY.md` → `git diff 09370d49 -- database.rules.json` (only `VALID` grew) → `test/support/policy-fixtures.mjs` → `test/emulator/storage-policy-parity.mjs`. Attack: find a record the parser rejects that Rules admit (or vice versa) on a server-deliverable shape — the generated-mutant matrix already covers every required field × {string, number 0.5, boolean, object, array, negative, unsafe, fraction, empty, missing}; add yours to the fixture file and re-run both sides. `MALFORMED_POLICY_PROOF.md` maps your six cases.
2. **F2** `ADMIN_MUTATION_INVENTORY.md` (12 paths, classification) → `git diff 09370d49 -- api/admin.js` (`tenantMaintenanceHold`, the `delete-client` gate + `storage_v2_control/{t} = null` in the same atomic update) → `test/emulator/admin-maintenance-gate.mjs` (real handler, real transport, whole-database byte comparison). Note the deliberate non-gate for checklist documents (inventory item 11) — argue if you consider them authoritative.
3. **F3** `REVISION_BOUNDARY.md` → `git diff 09370d49 -- lib/storagePolicy.js tools/storage-v2/policy.mjs` (`nextPolicyRevision`, `assertValidNextRecord`, no bare `+ 1` left: `grep -n "policyRevision + 1"` is empty) → `test/storage-v2/policy-revision-boundary.test.mjs`, VF-27.
4. **F4** `HISTORICAL_RENDERED_PAGE_PROOF.md` → `test/historical/historical-page-harness.mjs` (what is substituted: exactly the four CDN import lines; everything else is the historical bytes) → `test/emulator/historical-page-version-fence.mjs`. Attack: any write path of the historical page that the sequence does not exercise after activation.
5. `RULES_GUARD_UPDATE.md` — the guard is re-pinned to the exact R1 bytes; 6 new load-bearing mutations. `KNOWN_LIMITATIONS.md` — item 1 records your non-blocking finding and the canary evidence requirement.

## Re-run
```
node --test test/security/storage-policy-parity.test.mjs test/security/delete-client-maintenance.test.mjs test/storage-v2/policy-revision-boundary.test.mjs
shopt -s globstar; node --test --test-concurrency=8 test/**/*.test.mjs docs/production-readiness/test/*.test.mjs   # 836/836
bash test/historical/install-deps.sh                        # once; installs the page's pinned CDN builds + jsdom outside package.json
# emulator (Temurin 21), one at a time — see test/emulator/README.md:
firebase emulators:exec --only database --project demo-marjin-rules --config test/emulator/firebase.json "node test/emulator/storage-policy-parity.mjs"
… "node test/emulator/admin-maintenance-gate.mjs"
… "node test/emulator/historical-page-version-fence.mjs"
… "node test/emulator/storage-v2-version-fence.mjs"
… "node test/emulator/storage-v2-rules-guard-mutations.mjs"
```
