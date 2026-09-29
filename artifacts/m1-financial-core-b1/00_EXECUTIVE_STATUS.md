# M1 Financial Core — B1 canonical server metrics: executive status

**STATUS: B1 R1 (remediation of Codex review of `658cd05`) — candidate for Codex re-review** (one local commit on top of B1 `658cd05bdae7d236ece221203c0700523e188c9e`, which descends from `213fb350`; not pushed, not deployed). The Mac results for this commit are recorded in the handoff `~/Documents/marjin-reviews/2026-09-29/b1-remediation-r1/`.

## B1 R1 — findings closed (Codex `b1-codex-review-658cd05`)
| Finding / gate | Fix | Evidence |
|---|---|---|
| P1 projection shape (FC-04) | `ProductProjection.forecast = {formulaId: "REV_FORECAST/v1" (literal type, re-exported `REV_FORECAST_FORMULA_ID`), projectedRevenue: AmountString \| null, warnings}`; the engine number is converted once (`serializeDec(decFromNumber(·))`), the projection uses that exact string; formula-id mismatch throws | PRJ-01 (string, equal to `projection.revenue`), PRJ-02…05, B1R1-01 |
| P1 exception ledger (FC-04) | `loadCanonicalInputs(…, {need:{config, fixed, exceptions}})` (contract signature, all required): `need.exceptions` reads `tenants/{t}/entry_exceptions/{b}` once and decodes it with the core `decodeExceptionLedger` (same meaning as `lib/entryExceptions.js` `resolveEffectiveException`, structured origin) into `exceptionsByDate`; `exceptionsState` present/absent/unreadable/not_loaded in provenance; `canonicalMonthProjection` throws `exceptions_required` when not loaded and returns no projection (`exception_ledger_unreadable`) when unreadable. DD-17 is withdrawn | B1R1-01, API-03, API-01 |
| P1 raw-storage parity (FC-05, AR-05) | the RTDB numeric-key map readback (`mapFieldReadback`, R2-B3) moved from the server loader into the shared core composition (`normalized()` in `productFinance.ts`, compiled into `fincore/v1`): server and browser receive the SAME raw rows and produce the same result. The loader passes rows unmodified. C1 needs no mirror (DD-18 is now a core rule) | B1R1-02 (same raw V2 node: server loader+API ≡ generated browser ≡ committed `fincore`), API-03, emulator SR-02/SR-13 |
| P2 cross-category / cross-slice ownership (FC-02, AR-10) | the allowlist validator keys duplicates on the PATH alone: one path has exactly one owner across every category and every slice file | G2-04 (same path as `consumers` + `serverApiConsumers`; same path in `b1.json` and a `c1.json`) |
| P2 scope (FC-20, RR-02) | the extra helper `test/support/core-consumer-allowlist.mjs` is removed; its validator lives in the manifested fixtures module D1 `test/support/b1-fixtures.mjs`. Diff vs `213fb350` = the 45 manifest files + the one VERIFY file `entry-exception-parity` (red-first reproduced; harness-only; registered in 04) | 01, 04, `git diff --name-only 213fb350` |
| AT-16 (FC-12) | test: February 2028 (29 days), global 29,000 and fixed 2,900 ⇒ 1,000 / 100 per calendar day; closed month 29,000 / 2,900; open month at 11 Feb 10,000 / 1,000; at 29 Feb 28,000 / 2,800; sparse entries same; server ≡ browser | AT-16 |
| AT-18 | test: a future `costVersions` field (and any unknown field) on the inputs leaves every B1 output byte-identical, keeps `compat_current_config`; a `tsc --strict` probe of `interface F1Inputs extends ProductInputs {costVersions?}` calling every product function compiles with no call-site change | AT-18 |
| kept | missing payroll ⇒ labor unavailable; a purchases-only day never persists `revenue.total=0` | DB-05, COMPAT-01/03/07 (unchanged, green) |

New tests: 4 (B1R1-01, B1R1-02, AT-16, AT-18) ⇒ 101 B1 tests; focused 150/150; cloud full suite 1299/1299 = 1295 + 4; tsc 22 × TS2742 only; emulator 13/13 + 18/18.

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
| New tests | 97 packet matrix + 4 R1 = 101 |
| Focused | 150/150 (101 new + modified/guard files) |
| Full suite (cloud) | 1299/1299 = BASE 1198 + 101 |
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
| ~~DD-17~~ (WITHDRAWN in R1: `need.exceptions` implemented per the contract) | was: `loadCanonicalInputs` has no `need.exceptions`; the daily builder keeps its single-date structured-exception read and passes `exceptionsByDate` | the only B1 consumer needs one date; a ledger-wide read (up to 128 operations per date) would add I/O with no consumer. `need` can gain the key later without a call-site change |
| DD-18 (R1: now a CORE rule in `productFinance.ts`, shared by server and browser) | the product composition applies the approved client contract R2-B3 (`canonicalMapField`): for `supplier_payments` / `hourly_payroll` ONLY, an RTDB array readback equals the map `{index: element}` | found by the real RTDB emulator (SR-02): without it a converted V2 business reads its numeric-key maps back as arrays and the core flags `invalid_map_shape` (purchases would become invalid). Pre-B1 readers were array-tolerant. Non-mutating; no amount is interpreted there. R1: the rule runs inside the shared core, so C1 has nothing to mirror |
| DD-19 | `fin` omits empty lists (`bySource`, `flagCodes`, `inputIssues`, `configurationBasis`) | RTDB drops empty arrays; the in-memory doc is then exactly the persisted-and-read-back doc (emulator SR-13) |
| FILES | R1: 46 files = the 45 manifest files + one VERIFY file (B1 `658cd05` had 47: the extra helper `test/support/core-consumer-allowlist.mjs` is removed in R1 and its validator moved into D1 `b1-fixtures.mjs`) | VERIFY file `test/analytics/entry-exception-parity.test.mjs` (red: its compile harness did not copy the new `src/finance-server` / core directories) |
| ORDER | the product composition and loader were prototyped before the test files were written; red was then proven by running every new/changed test against a pristine BASE checkout (05) | disclosed, not hidden |

## Not done (out of scope, unchanged)
B2 (snapshot/e-mail), C1/C2 (browser, rebuild trigger), F (cost versions), Agent/Daily, purchases P1/P2, supplier-credit storage/UI; `api/**`, `index.html`, `lib/**`, `tools/**`, `database.rules.json`, `vercel.json`, packages — byte-identical to BASE.

**NEXT_ACTION: Codex re-review of B1 R1** (`10_REVIEW_GUIDE.md`, handoff `b1-remediation-r1/`).
