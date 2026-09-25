# TEST RESULTS — Canary Tooling R1 (candidate parent `875fe9c5`, default environment, `TMPDIR` untouched)

## Focused (in the required order)
1. expected-revision — `canary-cli.test.mjs` "R1-F1" (6 families × missing / malformed ×6 / stale ±1 / exact / plan-read-but-omitted / token N vs N+1; migrate + activate families end-to-end) ✔; CT-E05, CT-E16 ✔
2. evidence mode/symlink — `canary-evidence.test.mjs` "R1-F2" tamper matrix A–G ✔ (+ existing symlink/permission tests updated to the root-scoped API)
3. drain binding — contract "R1-F3 helpers" ✔, CLI "R1-F3" A–G ✔, CT-E18 ✔, CT-E04/E05 updated ✔
4. monitoring calendar — contract "R1-F4" A–I (+ sparse, trailing STOP) ✔
5. macOS path canonicalisation — `canary-evidence.test.mjs` "R1-F5" A–F ✔; secondary parity under an aliased `TMPDIR` ✔ (44/44)

## Suites
| gate | result |
|---|---|
| Canary unit (`test/storage-v2/canary-*.test.mjs`: cli 18, contract 12, evidence 6, transport 5, readers 3) | **44/44** default env; **44/44** with aliased `TMPDIR` |
| Canary emulator operator matrix `canary-operator-matrix.mjs` (CT-E01…E18) | **18/18 × 3 rounds** (54/54) |
| Version Fence matrix | 27/27 |
| Rules-guard mutations | 26/26 proven |
| parser↔Rules parity | 708/708 |
| Admin maintenance gate | 8/8 |
| historical rendered page | 5/5 |
| Storage V2 matrix | 46/46 |
| authorization matrix | 128/128 (41 allow / 87 deny) |
| entries Rules validation | 30/30 |
| server-readers convergence | 12/12 |
| remote atomic (R10) | 19/19 |
| VAT/S0 guards (inside the full suite) + S0 added-line regex over `index.html api lib src` | green / 0 hits (no lines added there) |
| full unit suite `test/**/*.test.mjs` + production-readiness | **880/880** (0 cancelled, 0 skipped; 836 baseline + 44 canary) |
| `tsc -p . --noEmit` | exit 2, exactly 22 pre-existing `TS2742` |
| `git diff --check` | clean |
| prohibited-files diff vs `875fe9c5` | empty; Rules blob `1e5dea2f…`; reader pins `a327186c 301f9599 33a646e9 6a3f9be2 e36df4d8` |
