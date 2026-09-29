# 10 — Review guide (Codex independent B1 review; R1 re-review)

R1 re-review: start with `git diff 658cd05bdae7d236ece221203c0700523e188c9e` (the remediation commit only) and 00 "B1 R1 — findings closed".

## Read in this order
1. `src/policy/productFinance.ts` — the one composition (bound policies, envelope decoding, AMEND-03 flag, AMEND-04 projection). Check: no new rule, only Slice A calls; `decodeEnvelope` states; D-1 clamp; DD-16 flag scoping.
2. `src/finance-server/canonicalInputs.ts` — single I/O seam, single clock read, raw rows (R1), `need.exceptions` ledger read (R1).
3. `src/finance-server/canonicalMetrics.ts` — wrappers only; `toAnalyticsFinancials` omission rules (DD-04), `payroll` completeness, DD-19 empty lists, no free text.
4. The four pinned reader files (`dailyMetricsRepo`, `laborRepo`, `purchasesRepo`, `dailyBuilder`) — no arithmetic left; DD-08 exception metadata; non-Actual insights path.
5. `analyticsService` (4 predicates), insights guards (`baselines`, `rules`, `types`).
6. Guards: `fincore-guards` (G-B2/G-S2/G-S4), the validator in `b1-fixtures.mjs` + `b1.json`, `server-reader-authorized-delta` pins, `s0-guard` needles.
7. Tests: 101 new (04; R1: B1R1-01/02, AT-16, AT-18), E5–E10 changes with VD annotations, emulator SR-13.

## Suggested adversarial checks
- Any path where a missing / invalid input still yields a plausible complete number (doc fields, series, labor, purchases).
- Any clock read other than `canonicalInputs` (`Date.now` spy tests: API-03, REPO-10, PRJ-04).
- Any second financial engine (`Number(v)||0`, `hourly_payroll` sums, supplier sums) left in a consumer (REPO-08, GUARD-04).
- Purchases keyed as one value per supplier per date (PF-01…06).
- RTDB readback shape (DD-18/19) on a converted V2 business (emulator SR-02/13).
- The current-day rebuild after an entry save (COMPAT-08, DB-02) — readback contract.
- Mixed deployment (COMPAT-01/04) and rollback (07).

## Known limits / follow-ups (not B1)
- R1: C1 has nothing to mirror (the map-field readback rule is in the core).
- The agent series keeps the legacy numeric fields for D; a `partial` day still carries the valid-cell number with `partial.*=true` (Slice A `toDailyMetric` contract). D decides how detectors use `partial` / `null` ratios.
- R1: `need.exceptions` is implemented (DD-17 withdrawn); B2 calls `canonicalMonthProjection` with inputs loaded with `exceptions:true`.
- Config prevalence (global employees without amounts, fixed list, rent/royalty) is not sized by EV-1.

## Commands
```
node --test test/finance/b1-*.test.mjs
node --test --test-concurrency=8 test/**/*.test.mjs docs/production-readiness/test/*.test.mjs
node node_modules/typescript/bin/tsc -p tsconfig.json --noEmit   # expect 22 × TS2742 only
```
