# CD-M1 — shared financial core and closure-state semantics: executive status

**STATUS: CD-M1 implemented locally — candidate for Codex review.** One local commit on top of the approved B1 R1 `4675eb20a97e8750429fad3e2ebda94f42f187b5`. Not pushed, not deployed. The external handoff, with SHA-bound, environment-labelled evidence, is `~/Documents/marjin-reviews/2026-09-30/cd-m1/`.

| Item | Value |
|---|---|
| Base / parent | `4675eb20` (B1 R1, APPROVED). B2 checkpoint `c16ac110` and HF-1 `9dea13f5` are untouched |
| Authority | `2026-09-30/closed-days-contract-amendment/` 01, 03, 04, 05, 07 (IMPLEMENTATION_READY) |
| Identifiers | `MARJIN_FIN/3`, `MARJIN_LABOR/3`, `REV_FORECAST/v2`, `MARJIN_PRODUCT/2` (new); NORM/3, DEC/1, PB/1, the D-1 rule, R-17, PROJ/2 and FIN_SERVER/1 unchanged |
| Closure source | the existing exception ledger only: structured active `reasonCode:"closure"`; a structured state blocks the legacy fallback; the legacy fallback is one row with `is_exception:true` and `exception_reason:"closure"` |
| Two eligibility sets | revenue-forecast eligibility excludes every declared closure immediately. Cost-allocation eligibility excludes only closures already completed under D-1. Both use the one captured business date |
| Allocation | the entitlement is computed per month and effective segment first, then placed on the eligible dates in exact rationals. A segment with no eligible date is typed `no_eligible_allocation_days`; its entitlement is kept and nothing is divided or falls back |
| Forecast | REV_FORECAST/v2 (new core `src/metrics/revenueForecast.ts`, exact):<br>• newest six eligible same-weekday observations, including an explicit operating zero, skipping closures, missing and invalid dates;<br>• minimum 3 samples, unchanged;<br>• a future closure gets 0 immediately;<br>• month forecast = Actual through D-1 + the other remaining forecasts |
| Missing revenue | exact missing and invalid completed dates plus a `partial` state on the forecast, never zero-imputed. Report coverage is unchanged |
| New tests | `test/finance/cd-m1-closed-days.test.mjs` (24) |
| Superseded B1 / Slice A expectations | listed in `03_SUPERSEDED_EXPECTATIONS.md` (owner-authorized) |
| Not in scope | revenue-entry UI (CD-M2), B2, C1, F1, Agent D/E, `index.html`, `src/forecast/**`, pinned readers, Rules, migrations |

**NEXT_ACTION:** Codex review of the CD-M1 candidate (`02_RULE_TEST_CROSSWALK.md`, `01_SCOPE_AND_DECISIONS.md`).
