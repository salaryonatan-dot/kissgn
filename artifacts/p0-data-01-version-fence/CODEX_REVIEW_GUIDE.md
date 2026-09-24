# CODEX REVIEW GUIDE — Version Fence P0 (candidate = one child commit of `47f7f888`)

**Where:** worktree `~/Documents/marjin/kissgn-p0-data-01-version-fence`, branch `claude/p0-data-01-version-fence`, `git diff 47f7f888` (16 modified, 8 new). Not pushed, not deployed. Design packets: `~/Documents/marjin-reviews/2026-09-24/version-fence-implementation-prep/` and `…/version-fence-convergence-review/` (all its corrections are implemented — see `CHANGE_SUMMARY.md`).

## Reading order (≈ 40 min)
1. `RULES_FENCE.md` then `git diff 47f7f888 -- database.rules.json` — attack the predicate: can any client-producible write on a quiesced/held/V2 business satisfy `LEGACY_BRANCH || ACTIVE_BRANCH`? (`$dataKey.replace` derivation, `_v` freeze on delete, absent-node init, malformed record.) Then `storage-v2-rules-guard-mutations.mjs` — each conjunct has a mutation proving it load-bearing.
2. `OLD_CLIENT_PROOF.md` + `test/emulator/storage-v2-version-fence.mjs` VF-03/04/18/19/26 — the six legacy shapes, ordinary auth, byte-identical node afterwards; the pre-fence negative control (VF-18) shows the delta is what denies.
3. `CONTROL_RECORD_CONTRACT.md` + `lib/storagePolicy.js` — whole-record absence vs malformed; `decideEntriesAccess` cells; `test/security/storage-policy.test.mjs`.
4. `CLIENT_POLICY_HANDSHAKE.md` + `git diff 47f7f888 -- index.html` — verify additions are seam-only (the "source pins" test asserts the engine bodies) and that `blocked_policy` is never rendered as saved (`describeSaveOutcome`).
5. `TRANSITION_SERIALIZATION.md` / `MIGRATION_WRAPPER.md` + `tools/storage-v2/policy.mjs` — CAS, ownership, cold-cache probe, wrapper before the unchanged core; VF-21…23 on the real Admin SDK.
6. `GUARD_ADAPTATION.md` — no broad exemption: `[H10]` asserts `authorizedEntriesRulesDelta(BASE, live).ok === false`; `vat-invariant` pins the blob; the reader layer projects Rules out only after the fence validated.
7. `api/admin.js` (+11) + `test/security/entry-exceptions-maintenance.test.mjs` — admission after authorization, 423, nothing written.
8. `KNOWN_LIMITATIONS.md`.

## Claims NOT made
Rules do not enforce Admin migration state; the client gate is convenience, the server is truth; client version constants are diagnostic; `minStorageProtocol` is honest-client-only; no `/api/version`; no new admin API.

## Re-run
```
node --test test/security/storage-policy.test.mjs test/storage-v2/policy-control.test.mjs test/dashboard/entries-version-fence.test.mjs test/security/entry-exceptions-maintenance.test.mjs
shopt -s globstar; node --test --test-concurrency=8 test/**/*.test.mjs docs/production-readiness/test/*.test.mjs   # 820/820
# emulator (Temurin 21), one at a time, see test/emulator/README.md:
firebase emulators:exec --only database --project demo-marjin-rules --config test/emulator/firebase.json "node test/emulator/storage-v2-version-fence.mjs"
firebase emulators:exec … "node test/emulator/storage-v2-rules-guard-mutations.mjs"
firebase emulators:exec … "node test/emulator/storage-v2-matrix.mjs"
firebase emulators:exec … "node test/emulator/rtdb-authorization-matrix.mjs"
```
