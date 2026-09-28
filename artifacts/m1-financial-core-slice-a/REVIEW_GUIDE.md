# Review Guide — Financial Core Slice A

Review the whole diff from its true base: `git diff f5d0a8edffc216f0b6ad342f8bd1bb0d630276ab..claude/m1-financial-core-slice-a` (all files are new).

Suggested order:
1. `src/finance/decimal.ts` — exactness, normalization, rounding, canonical strings (`MARJIN_DEC/1`).
2. `src/finance/cells.ts`, `types.ts` — grammar and the TI-14 presence states.
3. `src/finance/normalize.ts` — presence-based purchase selection (R1.3 §1.4), duplicate id rejection, future quarantine, same-date fold, missing-day objects, exception ledger.
4. `src/finance/purchaseBasis.ts`, `src/policy/purchaseBasis.ts` — BD-1 net-only contract, required argument.
5. `src/metrics/costTimeline.ts`, `adapters/configCompat.ts` — BD-2 accrual and compatibility label.
6. `src/metrics/report.ts` — BD-3 windows, coverage, ratio states, profit null-vs-zero (VD-27).
7. `src/metrics/projected.ts` — separation from Actual.
8. `src/metrics/adapters/legacyNumber.ts` — only binary conversion site.
9. `src/policy/*`, `src/presenters/*` — no owner-approved numbers invented; rounding only here.
10. `tools/finance-core/gen-browser.mjs`, `tsconfig.finance-browser.json`, `fincore/v1/**` — determinism; the artifact must equal compiler output (G-B1).
11. Tests: goldens are literal (`test/finance/golden/author_goldens.py` → JSON); every golden/contract test runs against compiled source **and** committed artifact.

Checklist for the reviewer:
- [ ] no magnitude-based presence (`G-S3`), no `|| 0` on amounts
- [ ] no VAT literal/arithmetic, no `Math.*`/`Number(` outside the legacy adapter (`G-S1`)
- [ ] future rows never Actual; projection never mixed into Actual
- [ ] labor = recorded employer cost; no payroll formula
- [ ] no consumer switched (`G-B2`); no schema/Rules/package/vercel change
- [ ] VD trace and deferrals honest (`VISIBLE_DIFFERENCE_TRACE.md`, `DEFERRED_GATES.md`)
- [ ] A-G6 preview proof remains deferred

Reproduce: `node --test test/finance/fincore-golden.test.mjs test/finance/fincore-contract.test.mjs test/finance/fincore-guards.test.mjs`; full suite as in TEST_RESULTS.md; regenerate the artifact with `node tools/finance-core/gen-browser.mjs` and expect `git status` clean.
