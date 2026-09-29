# 05 — Red / green log

## Honest authoring order
1. EV-1 evidence frozen (verify + gate, read-only) — first.
2. The product composition (`productFinance.ts`), the loader and the wrappers were **prototyped before** the test files were written (exploratory runs against the regenerated `fincore` to confirm PF 460 / A 370 / B 90, AMEND-03 invalid, projection null on insufficient history).
3. Tests were then written against the packet matrix, and **red was proven afterwards** by running every new and changed test against a pristine BASE checkout (`git worktree add --detach … 213fb350`, test files copied in, no runtime file). This deviates from "tests first" in time; the red evidence below is mechanical.

## RED at BASE `213fb350` (pristine runtime; B1 test files copied in)
| File | Result at BASE | Reason |
|---|---|---|
| `b1-canonical-server-api` | file fails to load (0/28) | `ERR_MODULE_NOT_FOUND src/finance-server/canonicalInputs.js` |
| `b1-daily-builder` | file fails (0/12) | `ERR_MODULE_NOT_FOUND src/finance-server/canonicalMetrics.js` |
| `b1-product-finance` | file fails (0/19) | `ERR_MODULE_NOT_FOUND src/policy/productFinance.js` |
| `b1-purchase-aggregation` | file fails (0/6) | `ERR_MODULE_NOT_FOUND src/policy/productFinance.js` |
| `b1-repositories` | 0/10 pass | old repositories: no `presence` / `partial` / `fin`, binary per-row engine, `hourly_payroll` counted, no typed contract-error rethrow |
| `b1-guards` | 5/14 pass | GUARD-01…08 and G2-06 fail (no `src/finance-server`, old pins, old closure). **G2-01…05 pass at BASE by design**: they exercise the new pure validator module on synthetic inputs (pure-contract tests, like the packet's API-13 allowance) |
| `b1-downstream-compat` | 2/8 pass | COMPAT-01…05, 08 fail (no `fin`, NaN-prone insight paths, no non-Actual doc). **COMPAT-06 and COMPAT-07 pass at BASE by design**: they compare "current code" with the BASE code on non-VD fixtures; at BASE both sides are BASE |
| E5 `entries-reader-dailybuilder` | 2/6 pass | duplicate date still throws `EntriesAmbiguityError`; payroll includes `hourly_payroll`; missing date writes 0 |
| E6 `entries-reader-repos` | 3/5 pass | old coercion / per-row purchase records / hourly labor |
| E7 `entries-reader-d1-downstream` | 4/5 pass | old labor (payroll + hourly) and binary ratios |
| E8 `entries-reader-decimal-aggregation` | 4/8 pass | old binary within-row sums and non-finite propagation |
| E10 `false-insights-p0` | fails | its compile harness copies `src/finance-server` (absent at BASE) — the B1 dailyBuilder dependency |
| VERIFY `entry-exception-parity` | fails | same (absent `src/finance-server`) |

Raw logs were produced under the session scratch directory; counts above are copied from their `# tests / # pass / # fail` lines.

## GREEN at the B1 candidate
- New tests 97/97; focused set (new + modified + guards) 146/146.
- Full suite (cloud, fresh `TMPDIR`) 1295/1295 = 1198 + 97; tsc 22 × TS2742 only.
- Emulator `server-readers-matrix` 13/13; `canary-operator-matrix` 18/18.

## Defects found and fixed during green
| Found by | Defect | Fix |
|---|---|---|
| real RTDB emulator SR-02 | converted V2 business: numeric-key `supplier_payments` / `hourly_payroll` read back as arrays ⇒ core `invalid_map_shape` (legacy ≢ V2) | DD-18 `mapFieldReadback` in the loader (client contract R2-B3); REPO-01 / API-03 cover it |
| real RTDB emulator SR-13 | empty `fin` lists vanish on RTDB readback (doc ≠ read-back doc) | DD-19: empty lists omitted at encoding |
| E5 / DB-08 review | legacy exception metadata could come from a winner row | DD-08: metadata only when exactly one exception row and no explicit `is_exception:false` row; core flags `exception_rows_disagree` |
| GUARD-06 | a re-typed decimal contract id in the `fin.derived.conversion` label | built from `DECIMAL_CONTRACT_VERSION` |

## B1 R1 (remediation of the Codex review of `658cd05`)
RED — the R1 test files run against the B1 `658cd05` runtime (detached cloud worktree of `658cd05`, only the R1 test files and `b1-fixtures.mjs` copied in):

| Test | At `658cd05` | Reason |
|---|---|---|
| PRJ-01 | fail | `projectedRevenue` is a binary number, not the exact string (FC-04) |
| API-01 | fail | provenance has no `exceptionsState` |
| API-03 | fail | the loader rewrites map-field arrays (rows not raw); no `need.exceptions` read |
| B1R1-01 | fail | no `decodeExceptionLedger`; the projection does not require / use the ledger (FC-04) |
| B1R1-02 | fail | the same raw V2 rows give different results on server and browser (FC-05 / AR-05) |
| G2-04 (R1 assertions) with the `658cd05` validator module | fail (`errors: []`) | cross-category / cross-slice duplicate paths accepted (FC-02 / AR-10) |
| AT-16, AT-18 | pass at `658cd05` **by design** | these close EVIDENCE gaps (Codex: "no executable scenario located"); the behaviour they prove was already correct at `658cd05` and is unchanged |

Totals at `658cd05`: 65 tests in the three files, 60 pass, 5 fail; G2-04 with the old validator 0/1. VERIFY `entry-exception-parity`: its BASE bytes against the R1 tree fail (`ERR_MODULE_NOT_FOUND src/finance-server/canonicalInputs.js`) — red-first for the harness change.

GREEN at R1: B1 101/101; focused 150/150; cloud full suite 1299/1299; tsc 22 × TS2742; `fincore/v1` regenerated byte-identical (G-B1/G-B1b); emulator `server-readers-matrix` 13/13, `canary-operator-matrix` 18/18. Raw logs: R1 handoff `raw-logs/`.

R1 fixes found during green: B1R1-01 first used a Monday exception day that is not a remaining weekday of the September 2026 month at asOf 29 Sep (no effect on the forecast by construction) — moved to Tuesday 22 Sep; API-01 declares `exceptionsState:"absent"` because the projection now requires a loaded ledger; s0-guard needle E re-anchored to the `exceptions:false` call.
