# 04 — Test changes

## New test cases: 97 (exactly the packet matrix)
| File | IDs | Count |
|---|---|---:|
| `test/finance/b1-canonical-server-api.test.mjs` | API-01 … API-28 | 28 |
| `test/finance/b1-repositories.test.mjs` | REPO-01 … REPO-10 | 10 |
| `test/finance/b1-daily-builder.test.mjs` | DB-01 … DB-12 | 12 |
| `test/finance/b1-downstream-compat.test.mjs` | COMPAT-01 … COMPAT-08 | 8 |
| `test/finance/b1-guards.test.mjs` | GUARD-01 … GUARD-08, G2-01 … G2-06 | 14 |
| `test/finance/b1-product-finance.test.mjs` | PFN-01 … 04, R17-01 … 10, PRJ-01 … 05 | 19 |
| `test/finance/b1-purchase-aggregation.test.mjs` | PF-01 … PF-06 | 6 |
| **Total** | | **97** |

Support: `test/support/b1-fixtures.mjs` (synthetic builders; EV-1 counts as parameters only; `purchaseOnlyNormalizedRow(date, source, amount, id)`; envelope matrix; injected clock `NOW_MS` ⇒ asOf 2026-09-29), `test/support/core-consumer-allowlist.mjs`, `test/finance/core-consumers/b1.json`.

Notes per mandatory disclosure:
- Explicit zero: API-08/18/19, REPO-04/05/07, DB-06, SR-13 (zero is present and complete; a zero-only day is entered).
- Negative / refund: PF-05, REPO-07 (kept, flagged, never clamped; not a credit).
- Missing IDs: API-07 (fingerprints `noid:`, identical id-less rows both counted, input never mutated, result independent of ids).
- `hourly_payroll`: API-11/12, REPO-06, DB-07, E5/E6/E7/E9 (never counted, flagged).
- Performance: API-24 (213 rows over ≥ 3 years + 1,100-row stress; `t.diagnostic`, no threshold).
- Storage independence: PF-01…06; RTDB numeric-key readback REPO-01 (+ API-03 unit), emulator SR-02/SR-13.

## Modified existing tests (each changed expectation annotated in-file)
| File | Change | VD |
|---|---|---|
| E1 `test/support/server-reader-authorized-delta.mjs` | 4 blobs re-pinned; snapshot pin unchanged; still exactly 5 files | — (08) |
| E2 `test/finance/s0-guard-server-reader-mutations.test.mjs` | mutation needles A–F re-anchored to B1 bytes; every class kept; the pre-B1 bytes of the 4 files now denied; snapshot pin proven unchanged | — (08) |
| E3 `test/finance/fincore-guards.test.mjs` | G-B2 data-driven (AMEND-02); G-S2 + the one edge; G-S4 single caller with bound policies | — |
| E4 `test/finance/consumer-manifest.json` | SV1/SV2, dispositions, H5–H7, S44a → D | — |
| E5 `test/analytics/entries-reader-dailybuilder.test.mjs` | clock injected; duplicate date ⇒ aggregated doc; payroll excludes `hourly_payroll`; missing date omits totals; D3 loop: duplicate-date business builds | VD-04, VD-31, VD-23 |
| E6 `test/analytics/entries-reader-repos.test.mjs` | clock injected; one engine (`"1,234"` strictly grouped, supplier map wins, labor = payroll); ratios null on zero revenue; purchases per (date, source); labor one per day, head count null | VD-10, VD-16r, VD-31, VD-08, DD-15 |
| E7 `test/analytics/entries-reader-d1-downstream.test.mjs` | the duplicate "most recent day" is the last COMPLETED day (D-1); labor = payroll; exact ratios at 10 dp | VD-30, VD-31, VD-19, VD-08 |
| E8 `test/analytics/entries-reader-decimal-aggregation.test.mjs` | order-independence proofs unchanged; within-row sums exact; out-of-contract / non-finite cells INVALID (partial, never Infinity/NaN); ratios null on non-positive revenue | VD-19, VD-20, VD-10, VD-16r, VD-08 |
| E9 `test/emulator/server-readers-matrix.mjs` | SR-01/03 labor; SR-06/07 aggregated duplicate date; NEW SR-13 (presence, duplicate, current/future, `hourly_payroll`, omitted facts, RTDB-safe readback, legacy ≡ V2); EXPECTED 12 → 13 | VD-04, VD-31, VD-23, VD-30 |
| E10 `test/insights/false-insights-p0.test.mjs` | copies the core + server API into its compile dir; case 34: totals omitted for a missing date (still not a baseline day) | VD-23 |
| VERIFY `test/analytics/entry-exception-parity.test.mjs` | copies the core + server API into its compile dir (no expectation changed) | — |

## Emulator suites
`test/emulator/*.mjs` are deliberately outside the `*.test.mjs` glob. Run in the cloud against the local RTDB emulator: `server-readers-matrix` 13/13, `canary-operator-matrix` 18/18 (09).
