# Codex Finding Closure — Slice A Remediation R1

| Finding (Codex 2026-09-29) | Status | Evidence |
|---|---|---|
| **P1 employer-cost boundary** — gross `monthlySalary` relabelled as employer cost | **CLOSED** | `configCompat.ts` emits `gross_salary` entries; `costTimeline.accrueDay` counts only `authoritative_employer_cost`; `MARJIN_LABOR/1` required source (`labor.ts`, `policy/laborSource.ts`); tests R1-F, R1-G, R1-H, G-01, labor-contract test (gross/net meaning rejected, `monthlySalary` field rejected, future source same numbers); R1.4 amended (01/02 corrected, 08 added) |
| **P1 incomplete profit** — numeric profit with missing/partial/invalid components | **CLOSED** | `TypedAmount` in `report.ts`; R1-A…R1-P, G-X3/G-X4, TI-18 projection/presenter/policy tests; the two Codex adversarial inputs (revenue-only day → `incomplete_components`; purchases 100 + invalid → `invalid_components`) are R1-A/R1-C2 |
| **P1 EV-1** — regex date check, no id census, collapsed categories, non-array accepted | **CLOSED** (contract + classifier) | `tools/finance-core/ev1-classifier.mjs` EV1/2; `test/finance/ev1-classifier.test.mjs` 9/9; `EV1_CONTRACT_R2.md`. Execution remains gated (collector review + CTO authorization) |
| P1 test gap: labor invariant test proved only labelling | CLOSED | labor-contract test + R1-F/G/H |
| P1 test gap: G-X4 accepted numeric profit; partial purchases without flag | CLOSED | G-X4 rewritten (typed incomplete); R1-C2 |
| P1 test gap: EV-1 impossible dates, duplicate/malformed ids, negative/offsetting, legacy-only | CLOSED | EV-1 tests |
| Note: property iterations below 10,000 | CLOSED | G-P1 = 2,500 datasets × 4 permutations |
| R1.4 editorial: "flagged for CTO confirmation" in BD-3 | CLOSED | 03 updated |
| **P2** trailing EOF blank lines | CLOSED | `git diff --check` clean |
| **P2** seven stale `*.lock.*` ref files | **RECOMMENDATION_ONLY** | HOUSEKEEPING_ANALYSIS.md (not valid refs, not in packed-refs, not referenced by any worktree; move command provided; not performed) |
| Codex caution: projection month-end pct rate | DEFERRED (Slice E) | unchanged, flagged `pct_rate_from_month_end_version` |
| G-34 | DEFERRED (B1) | needs migrated repository |

Items raised by the remediation self-review and left open by design: VD-28 runtime gross-salary addition in `snapshotBuilder`/`index.html` (DEFERRED to B2/C1); MTD profit incomplete until today's entries (owner decision); A-1/A-2 labor-field scope confirmations (owner).
