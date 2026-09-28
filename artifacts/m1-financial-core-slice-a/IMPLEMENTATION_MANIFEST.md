# Implementation Manifest — Slice A (all files new; no existing file modified)

| File | Lines | Purpose |
|---|---|---|
| `src/finance/decimal.ts` | 279 | MARJIN_DEC/1 exact Dec/Rat, canonical AmountString, rounding |
| `src/finance/types.ts` | 118 | Cell/Presence/MetricValue/Flag/NormalizedRow/CanonicalDay, FinanceContractError |
| `src/finance/cells.ts` | 58 | parseAmount grammar, limits, skip |
| `src/finance/businessDate.ts` | 137 | Israel business dates, calendar arithmetic, dowOf, israelBusinessDate |
| `src/finance/normalize.ts` | 355 | MARJIN_NORM/2 normalizeRows, groupByDate, dayToJson, latestPresentDate |
| `src/finance/purchaseBasis.ts` | 101 | MARJIN_PB/1 (BD-1 net only) validation and resolution |
| `src/metrics/costTimeline.ts` | ~140 | effective-dated versions, accrual |
| `src/metrics/report.ts` | 286 | MARJIN_FIN/1 computePeriodReport, serializeReport |
| `src/metrics/projected.ts` | ~85 | MARJIN_PROJ/1 applyProjection (separate object) |
| `src/metrics/adapters/configCompat.ts` | 78 | compatibility cost timeline |
| `src/metrics/adapters/legacyNumber.ts` | 85 | only binary conversion; DailyMetric and forecast-day adapters |
| `src/policy/purchaseBasis.ts` | 19 | product policy PB_NET/BD-1 |
| `src/policy/registry.ts` | 59 | compatibility defaults (ownerApproved:false), config.targets precedence |
| `src/policy/evaluate.ts` | 37 | exact goal comparison |
| `src/policy/intelligence.ts` | 53 | BD-4 types only |
| `src/presenters/money.ts`, `percent.ts`, `labels.ts` | 44 | display rounding and Hebrew labels |
| `src/browser/marjinFinanceGlobal.ts` | ~50 | browser entry (globalThis.MarjinFinance) |
| `tsconfig.finance-browser.json` | 20 | browser compilation config |
| `tools/finance-core/gen-browser.mjs` | 64 | deterministic generator + MANIFEST |
| `fincore/v1/**` (20 files + MANIFEST.json) | generated | committed browser artifact (never hand-edited) |
| `test/support/fincore-load.mjs` | 37 | loads compiled source and committed artifact |
| `test/finance/fincore-golden.test.mjs` | 112 | golden runner |
| `test/finance/fincore-contract.test.mjs` | 284 | property/contract tests |
| `test/finance/fincore-guards.test.mjs` | 145 | structural guards |
| `test/finance/golden/author_goldens.py` | 258 | literal authoring source of the golden JSON |
| `test/finance/golden/financial-core-goldens.json` | generated from the literal source | 67 golden cases |
| `test/finance/consumer-manifest.json` | — | 82-entry consumer manifest (R1.2 + R1.3 + R1.4 re-scan) |
| `artifacts/m1-financial-core-slice-a/*.md` | — | this package |

Not touched: `index.html`, `api/**`, `lib/**`, every pre-existing `src/**` file, `database.rules.json`, `vercel.json`, `package.json`, `package-lock.json`, `scripts/**`, Gate 0 tooling.

Manifest re-scan additions beyond R1.3: **S46** `src/agent/proactive/suppressionRules.ts` Rule 8 treats `currentValue === 0` as a closed day (explicit-zero consumer, DEFERRED TO D); **S47** keyword-only classifiers; **S48** endpoint wrappers.
