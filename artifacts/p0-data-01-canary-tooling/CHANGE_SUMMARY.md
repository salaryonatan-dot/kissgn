# P0-DATA-01 — Canary Tooling — CHANGE SUMMARY

Base: `5afb27543cb3d81c2ff23905af5b4ceeff706203` (Version Fence R1, approved). Branch `claude/p0-data-01-canary-tooling`. ONE child commit.

## What was added (operator tooling + tests only)

| path | kind | purpose |
|---|---|---|
| `tools/storage-v2/canary.mjs` | NEW, operator CLI | inert dispatcher for 16 commands; dry-run by default; tokens + observer acks; reports/receipts/evidence to a private directory |
| `tools/storage-v2/canary-contract.mjs` | NEW, pure | manifest validation, `digestV1`, enhanced preflight (composes the unchanged core preflight), expected-V2 (via `stampRow`), structural/logical/reader comparisons, classification, drain verdict, cycle records, window arithmetic, reconciliation |
| `tools/storage-v2/canary-evidence.mjs` | NEW, local FS | exclusive-create bundles (0700/0600, symlink refusal, COMPLETE.json LAST with every hash), receipts, append-only ledger with corrections |
| `tools/storage-v2/canary-transport.mjs` | NEW | fail-closed environment gate, one-business Admin transport (read surface / dry-run / writable), warm listener, **source-bound** entries transaction, REST probe (Option B), Rules fingerprint (no git needed), repo identity |
| `tools/storage-v2/canary-readers.mjs` | NEW | the approved server readers over a captured snapshot in a deny-write, no-send, offline sandbox |
| `tools/storage-v2/production-window.mjs` | NEW (verbatim extraction) | `HTML` + `loadProductionWindow()` moved out of `test/support/dashboard-wiring-harness.mjs` (harness re-exports; no behaviour change) |
| `tools/storage-v2/reader-sandbox.mjs` | NEW (verbatim extraction) | `ROOT`, `compileServer`, `makeDb`, `offlineFetch` moved out of `test/support/server-reader-harness.mjs` (harness re-exports) |
| `tools/storage-v2/CANARY_OPERATOR.md` | NEW | operator runbook |
| `test/support/canary-fixtures.mjs` | NEW | manifests, in-memory RTDB with listeners + transaction hooks, fake Admin app, Rules-serving fetch stub, in-process CLI runner |
| `test/storage-v2/canary-{contract,evidence,transport,readers,cli}.test.mjs` | NEW | 39 tests (CT-01…CT-36 mapping in TEST_RESULTS.md) |
| `test/emulator/canary-operator-matrix.mjs` | NEW | CT-E01…CT-E17 against the real emulator, real CLI, real dashboard blocks |
| `test/emulator/README.md` | edited | eleventh script documented |
| `test/support/dashboard-wiring-harness.mjs`, `test/support/server-reader-harness.mjs` | edited | import + re-export from the two extractions (−99/+26 lines, verbatim moves) |

## What was NOT changed (verified by `git diff --stat 5afb2754 -- …` = empty)
`index.html`, `database.rules.json` (blob `1e5dea2f…` unchanged), `api/**`, `src/**`, `lib/**` (incl. `lib/storagePolicy.js`), `tools/storage-v2/preflight.mjs`, `tools/storage-v2/upgrade.mjs`, `tools/storage-v2/policy.mjs`, `package.json`, `package-lock.json`, `vercel.json`. Reader pins `a327186c 301f9599 33a646e9 6a3f9be2 e36df4d8` unchanged. No new dependency.

## Decisions implemented
* **D-CT-1 = Option B**: no legacy-shape write probe exists anywhere in `tools/`; `probe-legacy-denial` performs an authenticated read and a same-value control-record PUT only.
* CLEAR_ALL: no command, no action value, no code path (asserted by test).
* `hold` is a separate explicit command; `verify`/`monitor`/`status`/`live-check` only print `RECOVERY_HOLD_RECOMMENDED`.
* Unknown migration outcome ⇒ exit 13 + `status` reconciliation (A1/A2/B/C/HOLD); a second `migrate` after any attempt is refused (`reconcile_required`).
* Emulator-mode relaxations (documented, production stays strict): tool identity/dirty tree are WARNING (BLOCKER in production); drain floor `max(1, W+1)` s (`max(120, W+60)` s in production).
