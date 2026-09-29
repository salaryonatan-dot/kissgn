# Review Guide — Slice A Remediation R1

Diff: `git diff a8fdf2c8f1e13fa9ec6461a848e9f1f584415ff4..<remediation commit>`.

1. `src/finance/labor.ts`, `src/policy/laborSource.ts` — labor source contract and the evidence comment for the manual input path.
2. `src/metrics/costTimeline.ts`, `src/metrics/adapters/configCompat.ts` — gross salary as datum; `missing_rate` / `missing_fixed_amount`.
3. `src/metrics/report.ts` — `metricIssues`, `typedAmount(() => …)`, `required(...)`, completeness table, labor section, `employerCostPct` denominator rule.
4. `src/metrics/projected.ts`, `src/policy/evaluate.ts`, `src/presenters/money.ts`, `src/metrics/adapters/legacyNumber.ts` — no path turns a non-complete result into a number.
5. `tools/finance-core/ev1-classifier.mjs` + `test/finance/ev1-classifier.test.mjs`.
6. Goldens: `test/finance/golden/author_goldens.py` (literal values) → JSON; R1-A…R1-P; changed expectations listed in CHANGE_SUMMARY.
7. `fincore/v1/**` regenerated (G-B1).
8. R1.4 package: `financial-core-r1-4-owner-decisions/08_LABOR_EMPLOYER_COST_AMENDMENT.md` and amended 00/01/02/03/05/06.

Checklist: gross salary never in arithmetic; no uplift/fallback; labor source required; profit numeric only when complete; explicit 0 complete; EV-1 real calendar + identity census + fail-closed; browser parity; no consumer switched; no schema/Rules/package change.

Reproduce: focused command and full suite in TEST_RESULTS.md; `node tools/finance-core/gen-browser.mjs` then `git status` clean.
