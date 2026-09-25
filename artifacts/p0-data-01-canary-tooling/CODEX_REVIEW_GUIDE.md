# CODEX REVIEW GUIDE — P0-DATA-01 Canary Tooling

Candidate: ONE commit, parent `5afb27543cb3d81c2ff23905af5b4ceeff706203`. Review in this order.

1. **Boundary** — `git diff --stat 5afb2754 -- index.html database.rules.json api src lib tools/storage-v2/preflight.mjs tools/storage-v2/upgrade.mjs tools/storage-v2/policy.mjs package.json package-lock.json vercel.json` must be empty. `git hash-object database.rules.json` = `1e5dea2f…`. The two test-support edits are pure moves: compare `tools/storage-v2/production-window.mjs` and `reader-sandbox.mjs` with the removed harness lines.
2. **No forbidden capability** — grep `tools/storage-v2/canary*.mjs` for `clearAll|submitClearAll|remove(|--force|restore|repair|rollback|retry`; the only REST PUT targets `storage_v2_control/{t}/{b}/phase` with the CURRENT value; no `Bearer` header is ever used on the emulator; no credential env var is read.
3. **Write gating** — `canary.mjs`: every write command passes `confirmOrDryRun` (token from `C.confirmationToken`) and `migrate`/`activate` pass `requireAck` bound to the bundle/checkpoint; `createTransport` has no write method unless `writable`, and throws `dry_run` before any write unless `--execute`.
4. **Source-bound transaction** — `canary-transport.mjs#boundTransactNode`: digest check precedes the core callback on every run; `null` ⇒ abort; stats are reported. `migrate` warms the listener first and refuses on any pre-check drift.
5. **Unchanged core usage** — `migrate` builds `createLegacyPreflight`/`createStorageV2Upgrader` from the production window and calls `createFencedConversion` from the unchanged `policy.mjs`; the core is invoked exactly once (CT-E07/E17 `coreRuns=1`).
6. **Never automatic hold** — grep `enterRecoveryHold` in `canary.mjs`: only inside the `hold` command. `classify` returns `automaticTransition:false`; CT-27 / CT-E14.
7. **Evidence integrity** — `canary-evidence.mjs`: `O_EXCL`, 0600/0700, symlink refusal, re-hash before `COMPLETE.json`, `verifyBundle` refuses extra/changed files and an edited COMPLETE; `exactReplacer` refuses NaN/undefined.
8. **Environment gates** — `resolveEnvironment` rows vs `ENVIRONMENT_SAFETY.md`; `canary-transport.test.mjs` covers every row; CT-E16 on the emulator.
9. **Option B** — `probe-legacy-denial` report content; `OLD_CLIENT_PROOF.md`; CT-E10 (tool probe + test-only Rules evidence with intruder/positive controls).
10. **Tests** — run `node --test test/storage-v2/canary-*.test.mjs` (39) and the emulator matrix (17, ×3 documented); then the regression list in `TEST_RESULTS.md`.

Suggested probes for an adversarial pass: a manifest with `bizId: "biz*"`; `--execute` with a token from a previous revision; a bundle whose `entries.raw-v.utf8` was edited by one byte; a V2 node with `generation: 2` at `verify --phase active`; `monitor` with receipts claiming a create that did not happen; `activate` after an Admin edit to the node post-checkpoint.
