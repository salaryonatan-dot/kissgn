# M1 Financial Core — B1 canonical server metrics: executive status

**STATUS: B1_IMPLEMENTED_LOCAL — CODEX_READY** (one local commit, parent `213fb350`; not pushed, not deployed)

| Item | Result |
|---|---|
| Base | `213fb350019c3e212156eb032e34f4da8c179d6f` (EV-1 collector; descends from Slice A `0bcd1753`; runtime/core tree identical to Slice A) |
| Branch | `claude/m1-financial-core-b1` |
| EV-1 evidence | accepted bundle `20260929T153417Z` consumed read-only (digests re-verified; not re-run) |
| AMEND-01 (one pure product composition, server ≡ browser) | CLOSED |
| AMEND-02 (per-slice core-consumer allowlist, data-driven G-B2) | CLOSED |
| AMEND-03 (R-17: missing fixed list = 0; unreadable = invalid; missing amount/rate = incomplete) | CLOSED |
| AMEND-04 (month projection composition for B2) | CLOSED |
| Explicit zero (EV-1: 282 supplier explicit-zero rows, 2 zero-only rows) | preserved as a real, present zero |
| Negative / refund (EV-1: 2 rows) | kept, never clamped, flagged `negative_amount` |
| Missing IDs (EV-1: 520 of 520 rows) | informational only: deterministic fingerprints, every row counted, no repair / no mutation |
| `hourly_payroll` (EV-1: 0 rows) | never counted; legacy compatibility contract-tested |
| Purchase future-proofing | PASS (A150 + A220 + B90 = 460, A 370 / B 90; storage-independent) |
| Performance (EV-1 `maxRowsTotal` 213) | API-24 with 213 rows over ≥ 3 years + 1,100-row stress; report-only timings |
| New tests | 97 (exactly the packet matrix) |
| Focused | 146/146 (97 new + modified/guard files) |
| Full suite (cloud) | 1295/1295 = BASE 1198 + 97 |
| tsc | 22 × TS2742 (`src/firebase/refs.ts`), 0 other — identical to BASE |
| Emulator (cloud, local RTDB emulator, demo project) | `server-readers-matrix` 13/13 (incl. new SR-13); `canary-operator-matrix` 18/18 |
| Production accessed / modified | NO / NO |

## What B1 does
- `src/policy/productFinance.ts` (core, compiled into `fincore/v1`): the ONE product composition of the approved Slice A functions under the bound product policies (`PB_NET/BD-1`, `LABOR_SRC/shiftorganizer-hourly-manual/2026-09-29`, no declared closures).
- `src/finance-server/canonicalInputs.ts`: the only server I/O seam and only clock read of the financial read path.
- `src/finance-server/canonicalMetrics.ts`: thin server wrappers + persisted-doc encoding + provenance.
- The analytics repositories and the daily builder now serve every financial value from that API; their private engines are retired.

## Deviations from the packet (each justified in 02/03/04)
| ID | Deviation | Why |
|---|---|---|
| DD-16 | `productMonthReport` limits the dataset flag `row_without_id` to rows dated in the month | provenance only; no arithmetic reads flags; keeps month reports independent of other months' id-less rows |
| DD-17 | `loadCanonicalInputs` has no `need.exceptions`; the daily builder keeps its single-date structured-exception read and passes `exceptionsByDate` | the only B1 consumer needs one date; a ledger-wide read (up to 128 operations per date) would add I/O with no consumer. `need` can gain the key later without a call-site change |
| DD-18 | the loader applies the approved client contract R2-B3 (`canonicalMapField`): for `supplier_payments` / `hourly_payroll` ONLY, an RTDB array readback equals the map `{index: element}` | found by the real RTDB emulator (SR-02): without it a converted V2 business reads its numeric-key maps back as arrays and the core flags `invalid_map_shape` (purchases would become invalid). Pre-B1 readers were array-tolerant. Non-mutating; no amount is interpreted there. **C1 must apply the same rule in the browser loader** |
| DD-19 | `fin` omits empty lists (`bySource`, `flagCodes`, `inputIssues`, `configurationBasis`) | RTDB drops empty arrays; the in-memory doc is then exactly the persisted-and-read-back doc (emulator SR-13) |
| FILES | 47 files instead of 45 | + `test/support/core-consumer-allowlist.mjs` (the AMEND-02 validator as a pure module, so G-B2 and the G2-* mutation tests use one implementation); + VERIFY file `test/analytics/entry-exception-parity.test.mjs` (red: its compile harness did not copy the new `src/finance-server` / core directories) |
| ORDER | the product composition and loader were prototyped before the test files were written; red was then proven by running every new/changed test against a pristine BASE checkout (05) | disclosed, not hidden |

## Not done (out of scope, unchanged)
B2 (snapshot/e-mail), C1/C2 (browser, rebuild trigger), F (cost versions), Agent/Daily, purchases P1/P2, supplier-credit storage/UI; `api/**`, `index.html`, `lib/**`, `tools/**`, `database.rules.json`, `vercel.json`, packages — byte-identical to BASE.

**NEXT_ACTION: Codex independent B1 review** (`10_REVIEW_GUIDE.md`).
