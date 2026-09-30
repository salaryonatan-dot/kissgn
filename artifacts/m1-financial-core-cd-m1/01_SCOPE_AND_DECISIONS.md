# 01 — Scope and technical decisions

## Files
| Class | Files |
|---|---|
| Core (compiled into `fincore/v1`) | `src/finance/labor.ts` (LABOR/3, allocation ids), `src/metrics/costTimeline.ts` (entitlement → placement, `allocateMonth`, `dayPlacement`, `accrueWindow` with an allocation context; `accrueDay` retired), `src/metrics/report.ts` (FIN/3, `costAllocation`, completed-closure placement, revenue-only closure contradiction), `src/metrics/projected.ts` (the month entitlement and `afterActual` use the report's completed closures), `src/metrics/adapters/legacyNumber.ts` (the daily placement comes from the one month/segment allocation), **NEW** `src/metrics/revenueForecast.ts` (REV_FORECAST/v2), `src/policy/productFinance.ts` (PRODUCT/2, reason-aware ledger decode, `productClosureCalendar`, v2 projection), `src/browser/marjinFinanceGlobal.ts` (exports v2; `versions.forecast` = v2, `versions.forecastLegacy` = v1) |
| Server API | `src/finance-server/canonicalInputs.ts` (ledger read coupled to monthly-cost needs; `exceptionStates`, `exceptionLedgerState`), `src/finance-server/canonicalMetrics.ts` (typed unavailable forecast shape) |
| Generated | `fincore/v1/**` by `node tools/finance-core/gen-browser.mjs` (24 files; +`metrics/revenueForecast.js`) |
| Tests | NEW `test/finance/cd-m1-closed-days.test.mjs`. Updated for superseded expectations: `test/finance/{b1-canonical-server-api,b1-guards,b1-product-finance,fincore-guards}.test.mjs`, `test/finance/golden/{author_goldens.py,financial-core-goldens.json}` |
| Not touched | `index.html`, `api/**`, `lib/**`, `tools/**`, `src/forecast/**`, `src/analytics/**`, `src/repositories/**`, `src/snapshot/**`, `src/agent/**`, Rules, packages, the S0 pin table |

## Technical decisions (for Codex to confirm)

**TD-CDM1-1 — REV_FORECAST/v2 is a new core file, not an edit of `src/forecast/revenueForecast.ts`.** Three things prevent editing that file in CD-M1:
1. `src/forecast/` is an S0-protected root, and `isPlainAuthorizedFile` never authorizes it (`test/support/server-reader-authorized-delta.mjs`). Any change would fail GUARD-05, s0-guard and vat-invariant Layer B.
2. `index.html` mirrors v1 verbatim, and `test/forecast/revenue-forecast-ui.test.mjs` pins that mirror; `index.html` is outside CD-M1.
3. The core exactness guard G-S1 requires exact arithmetic, and v2 is exact.

v1 stays untouched (E-owned, used by the page mirror). The product composition, and therefore every server/browser product consumer, now uses v2 only. It is one shared forecast for the product, not a competing engine; retiring the v1 mirror remains E's.

**TD-CDM1-2 — the loader reads the ledger whenever monthly costs are read (`need.config || need.fixed || need.exceptions`).**
- Under MARJIN_LABOR/3, placement depends on the declared closures.
- The four S0-pinned B1 callers declare `exceptions:false` and may not change.
- Coupling the read keeps them byte-identical and gives every cost consumer the same decoded ledger.
- Superseded: B1 API-03 "ledger only when asked" and `exceptionsState:"not_loaded"` for cost-reading callers.
- I/O: one more read per cost-reading call.

**TD-CDM1-3 — `ProductInputs` gains optional `exceptionStates` and `exceptionLedgerState`.**
- `exceptionsByDate` (booleans) is kept, because the pinned `dailyBuilder` spreads it.
- When omitted, it is derived from the states.
- A date listed only as a boolean is structured with an unknown reason: it blocks the legacy fallback and is not a closure.

**TD-CDM1-4 — the narrow legacy fallback requires exactly one row on the date.** This is the same ambiguity rule as `lib/entryExceptions.js#buildEffectiveRecord`: several rows mean `legacy_ambiguous`, which is normal.

**TD-CDM1-5 — the closed-day contradiction is now nonzero revenue only.** CD-AT11 and CDA-08: payroll recorded on a closed day stays and is not a contradiction. Before, nonzero `payroll` on a closed day was invalid.

**TD-CDM1-6 — `MARJIN_PROJ/2` is not bumped.**
- The projection formula is unchanged: ratios of complete Actual totals × projected revenue + the month entitlement.
- Its `formulaIds` carry `REV_FORECAST/v2` and `actualReport: MARJIN_FIN/3`.
- The packet's required-id list does not include PROJ. Codex may require a bump.

**TD-CDM1-7 — v2 has no CONFIDENCE output.** No product consumer reads it; v1 keeps CONFIDENCE/v1.

**TD-CDM1-8 — an unreadable ledger makes the closure calendar unknown.**
- The open-window monthly-cost placement is `invalid` (`closure_calendar_unreadable`).
- Daily placements are unavailable.
- The product projection refuses (`closure_calendar_unknown`), and the server wrapper returns `state:"unavailable"`.
- A closed month's global and fixed totals stay determinable, because they equal the entitlement whatever the closures.

**TD-CDM1-9 — the existing sample rules are kept.**
- Samples still exclude generic exception days (the v1 rule, CD-AT23) and negative totals (v1 required > 0; the amendment admits only an explicit zero).
- v1's `is_outlier` and `stale` have no canonical source, so they do not apply.

**TD-CDM1-10 — the current business date is a remaining date, as in v1.**
- It is forecast by its weekday average; its partial revenue is not Actual.
- A closed current day gets 0 and no `partial_current_day` warning.
