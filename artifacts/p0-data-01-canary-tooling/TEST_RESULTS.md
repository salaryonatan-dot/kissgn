# TEST RESULTS — Canary Tooling (worktree `kissgn-p0-data-01-canary-tooling`, base `5afb2754…`, node v22.23.2)

## New unit suites (part of the full suite) — 39/39
| file | tests | covers |
|---|---|---|
| `test/storage-v2/canary-contract.test.mjs` | 11 | CT-01 manifest (wildcards, placeholders, URLs, four-eyes), CT-07 digest, CT-02/03/04/05/06/35 enhanced preflight over fixtures (clean, malformed ×N, duplicate id, duplicate date + acceptance, numeric maps, absent, V2, siblings, non-finite, cap, foreign operation, wrong phase, identity, Rules mismatch/unknown, tool identity prod/emu, read failure, held conditions), CT-14/15/17 structural + logical mutants (row loss, new row, value change, Hebrew, swapped ids, unknown field, type change, `_v` edit/missing, generation, `_gen`, key/id, phase, marker, unreported normalisation), CT-24 classification, CT-26 tokens, CT-23/34 window arithmetic + DST + equation + cycle records, CT-11 drain vocabulary, CT-20 live diffs, CT-32 reconciliation |
| `test/storage-v2/canary-evidence.test.mjs` | 4 | bundle layout/permissions/COMPLETE-last, no overwrite/symlink/too-open dir/bad name/partial ⇒ no COMPLETE/NaN refused, CT-33 tamper (file, extra, edited COMPLETE), raw `_v` bytes, CT-23 receipts + ledger idempotency/corrections |
| `test/storage-v2/canary-transport.test.mjs` | 5 | CT-25 every environment row, read surface / dry-run / one-business scope / denied reads, CT-08/12/13/31 source-bound transaction (drift, absent, cold cache, exactly one core call) + policy io round trip + listeners, Rules fingerprint without git, REST probe form (query on emulator, Bearer in production, no entries write) |
| `test/storage-v2/canary-readers.test.mjs` | 3 | CT-36 deny-write/no-send/offline + no job imports, CT-16 legacy ≡ V2 with full-precision strings, CT-22 poisoned `_v` unchanged / malformed V2 typed error ⇒ STOP |
| `test/storage-v2/canary-cli.test.mjs` | 16 | CT-21 inert import + no clear-all/force, usage, CT-25 gates, CT-01 identity ⇒ 14 ×11 commands, CT-02/26 plan+preflight+tokens, CT-26 dry-run/15, transitions, CT-11/12 drain, CT-08/33 capture, CT-09/10/30 migrate refusals + dry-run, CT-08/12 drift (pre-check and in-transaction) + HOLD status, CT-13/14/15/17/31/28/18/27 happy path → verify ×2 → activate → STOP recommendation → explicit hold/resume, CT-32 unknown outcome A2/B, CT-20/21 live-check + generation STOP, CT-23 monitor ledger/window, Option-B probe dry-run |

## Emulator operator matrix — `test/emulator/canary-operator-matrix.mjs`: 17/17 × 3 rounds (51/51)
CT-E01 identity ⇒ 14 (8 commands + plan) · E02 plan/preflight PASS, Rules `byte` · E03 enroll→quiesce→drain→capture · E04 out-of-band drift ⇒ abort, HOLD status · E05 not quiesced / stale revision / stale token refused · E06 unstable drain ⇒ 10 · E07 MIGRATED_HELD, `runs=1 coreRuns=1`, second migrate `reconcile_required` · E08 verify post repeatable + reader parity + no `_v` fallback · E09 activate gates (checkpoint, invalid checkpoint, ack) ⇒ v2_active rev 4 protocol 2 flag false · E10 Option-B probe (READABLE + control DENIED; intruder INCONCLUSIVE; zero changes) + test-only Rules evidence (4 legacy shapes × {v2_active, quiesced} denied via `?auth=`, same-value `_v` denied under quiesced, positive and intruder controls) · E11 create/edit/delete through the real `index.html` blocks over the SDK reconcile; clear-all ⇒ STOP, no transition · E12 poisoned `_v` ⇒ STOP by structure (readers unchanged); malformed V2 ⇒ verify + monitor STOP · E13 monitor COMPLETE / INCOMPLETE / idempotent / correction, window not met · E14 STOP ⇒ recommendation only; hold/resume explicit (rev 4→5→6) · E15 A2 ⇒ `reconcile_required`; B ⇒ verify post OK · E16 production-shaped manifest ⇒ 14; no/wrong token ⇒ 15; zero writes · E17 cold SDK cache per command: `coreRuns=1 nullRuns=0`.

## Regression (all unchanged suites re-run on this worktree)
| gate | result |
|---|---|
| Version Fence matrix `storage-v2-version-fence` | 27/27 |
| Rules-guard mutation probe | 26/26 proven |
| parser↔Rules parity | 708/708 |
| Admin maintenance gate | 8/8 |
| historical rendered page proof | 5/5 |
| Storage V2 matrix | 46/46 |
| authorization matrix | 128/128 (41 allow / 87 deny) |
| entries Rules validation | 30/30 |
| server-readers convergence | 12/12 |
| remote atomic (R10) | 19/19 |
| full unit suite (`test/**/*.test.mjs` + production-readiness) | **875/875** (836 baseline + 39 new) |
| `tsc -p . --noEmit` | exit 2, exactly 22 pre-existing `TS2742` (unchanged) |
| `git diff --check` | clean |
| S0 anti-migration regex over added lines in `index.html api lib src` | 0 hits (no lines added there) |
| prohibited-files diff vs base (`index.html database.rules.json api src lib preflight.mjs upgrade.mjs policy.mjs package*.json vercel.json`) | empty |
| Rules blob | `1e5dea2f9b1eac037c766b325b927c20285c0eec` (unchanged) |
| reader pins | `a327186c 301f9599 33a646e9 6a3f9be2 e36df4d8` (unchanged) |
