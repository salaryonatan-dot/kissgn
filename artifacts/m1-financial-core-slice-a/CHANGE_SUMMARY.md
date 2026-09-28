# M1 Financial Core — Slice A — Change Summary

Branch `claude/m1-financial-core-slice-a`, base `f5d0a8edffc216f0b6ad342f8bd1bb0d630276ab` (approved P0 tip).
Planning: `financial-core-r1-2/`, `financial-core-r1-3/` (Codex-accepted) as amended by the owner decisions in `financial-core-r1-4-owner-decisions/`.

## Base verification (DAG result A)
- `git merge-base --is-ancestor b16f5567 f5d0a8ed` → **0 (true)**; `git merge-base b16f5567 f5d0a8ed` = `b16f5567…`.
- The accepted S0 VAT invariant is already an ancestor of P0 (first-parent chain `686b435 → b16f556 → 7415053 → … → f5d0a8e`). No carry-forward or cherry-pick was needed.

## What this commit adds (new files only; no existing file modified)
| Area | Files | Contract |
|---|---|---|
| Exact arithmetic | `src/finance/decimal.ts` | `MARJIN_DEC/1`: `Dec` (BigInt coefficient/scale), reduced `Rat`, canonical `AmountString` (terminating decimal or `n/d`), half-away-from-zero rounding used only by presenters/legacy adapter |
| Input grammar + presence | `src/finance/cells.ts`, `src/finance/types.ts` | `Cell` = absent / present (explicit 0 is present) / invalid(reason); strict grammar; thousands groups flagged; 15/6 digit limits |
| Business dates | `src/finance/businessDate.ts` | Israel business dates, calendar arithmetic without `Date` parsing, injected instant |
| Normalization | `src/finance/normalize.ts` | `MARJIN_NORM/2`: presence from state only (TI-14), presence-based purchase representation (supplier map incl. `0`/`"skip"` wins over legacy `food_cost`, collision flagged), future rows quarantined, duplicate row id rejected, explicit missing-day objects, same-date exact fold, exception ledger precedence |
| Purchase basis | `src/finance/purchaseBasis.ts`, `src/policy/purchaseBasis.ts` | `MARJIN_PB/1` amended by BD-1: only `net_of_vat`; product policy `PB_NET/BD-1` covers all dates; required argument; non-net kinds are contract errors |
| Cost timeline | `src/metrics/costTimeline.ts`, `src/metrics/adapters/configCompat.ts` | effective-dated versions (BD-2), day-weighted calendar accrual, corrections by `(recordedAt, versionId)`, compatibility version `current_applied_retrospectively` |
| Actual report | `src/metrics/report.ts` | `MARJIN_FIN/1`: open/closed month windows (BD-3: through the current business date, today open), coverage per metric, ratio of totals with typed states, averages per present day, profit `null` when no revenue recorded, provenance/version block, byte-stable serializer |
| Projection | `src/metrics/projected.ts` | separate `ProjectedFinancials` object; never touches Actual |
| Legacy adapters | `src/metrics/adapters/legacyNumber.ts` | the only binary-number conversion site; `DailyMetric`-shaped + presence/basis; `REV_FORECAST` input day |
| Policy | `src/policy/registry.ts`, `evaluate.ts`, `intelligence.ts` | compatibility defaults with `ownerApproved:false`; `config.targets.*` precedence; exact goal comparison; BD-4 intelligence/recoverability types only |
| Presenters | `src/presenters/{money,percent,labels}.ts` | ₪ integer and % 1-dp half-away-from-zero; Hebrew provenance labels (net basis, configuration basis, "לא הוזן") |
| Browser artifact | `src/browser/marjinFinanceGlobal.ts`, `tsconfig.finance-browser.json`, `tools/finance-core/gen-browser.mjs`, `fincore/v1/**` | one TypeScript source compiled by pinned tsc 5.9.3 into committed ES modules + `MANIFEST.json` (source digest); regeneration byte-test |
| Tests | `test/finance/fincore-{golden,contract,guards}.test.mjs`, `test/finance/golden/*`, `test/finance/consumer-manifest.json`, `test/support/fincore-load.mjs` | 179 new tests; each golden/contract case runs against the freshly compiled source and the committed artifact |

## What this commit does NOT do
No consumer is switched (index.html, api, lib and existing src are untouched — guard G-B2). No schema, Rules, package.json, vercel.json or data change. No Preview/Production deploy (A-G6 deferred). No Production access.

## Results
Focused: 179/179. Full suite: 1059/1059 (baseline 880/880 + 179). `tsc -p tsconfig.json --noEmit`: 22 × TS2742, identical to baseline.

## Post-implementation self-review (Part 3) — findings fixed before commit
An independent read-only review of the full diff (12 checks) found and this commit fixes:
- **HIGH** missing labor rendered as `0 %` (and "at or below goal") when nothing was recorded and no salaried employee exists → `fullyLoadedLabor` is now `null` / `numerator_missing` (G-X4).
- **HIGH** absent stored config treated as zero cost → the compatibility adapter now returns an empty timeline for a missing config, every day raises `cost_config_absent` and profit is `null` (G-X3).
- **MEDIUM** projection omitted other expense and re-implemented profit/ratio/percentage-rent formulas → `applyProjection` now reuses `ratioOfTotals`, `contributionOf`, `operatingProfitOf` and `revenueLinkedCharges` from the report/cost-timeline modules; `legacyNumber` reuses `ratioOfTotals` (one formula each).
- **LOW** partially invalid days reported `complete` → `MetricTotal.complete` accounts for partial days; `Coverage.partialDays` added (G-X5).
- **LOW** duplicate day objects silently replaced → `duplicate_day` contract error.
- **LOW** stale generator comment fixed.
Retained by design and documented (KNOWN_LIMITATIONS L-13/L-14/L-15): profit remains a sum of recorded facts with `profit_components_incomplete` when a revenue day lacks purchases/labor; float-noise stored numbers beyond 6 decimals are invalid (flagged, counted by EV-1); the bundled REV_FORECAST/v1 engine is unchanged (Slice E).
