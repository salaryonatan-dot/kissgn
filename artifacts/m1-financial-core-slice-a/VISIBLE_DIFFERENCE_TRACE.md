# Visible-Difference Trace (VD-01 … VD-27)

Slice A has **no runtime consumer**, so no user-visible number changes in this commit. For each VD the table states the core contract that now exists (with the proving test) and the slice where the visible change will land.

| VD | Status (BD-5) | Core contract in Slice A | Test | Visible change |
|---|---|---|---|---|
| VD-01 salary by calendar days, not rows | accepted | `accrueWindow` | G-02, G-11 | DEFERRED TO C1 (dashboard/P&L), B2 (email) |
| VD-02 P&L month uses its own day count | accepted | `monthBounds`/`daysInMonthOf` | G-29 | DEFERRED TO C1 |
| VD-03 future rows excluded | accepted | `normalizeRows` quarantine | G-08, G-07m | DEFERRED TO B1, B2, C1, D, E |
| VD-04 duplicate-date days aggregated | accepted | `groupByDate` exact fold | G-05, G-P2 | DEFERRED TO B1 (dailyBuilder), E (forecast) |
| VD-05 purchase proxy per row | accepted | per-row selection | G-18 (P3) | DEFERRED TO B2 |
| VD-06 fixed costs pro-rata by calendar day | accepted (BD-3) | `accrueDay` | G-02, G-03 | DEFERRED TO C1, B2 |
| VD-07 ratio of totals everywhere | accepted | `computePeriodReport` ratios | G-07e, G-25 | DEFERRED TO D, C1 |
| VD-08 non-positive revenue ⇒ "—" | accepted | `RatioResult` states + presenter | G-15, G-16, G-20-pres | DEFERRED TO C1, B2, D |
| VD-09 configured goals applied | accepted | `resolvePolicy` reads `config.targets.*` | G-33 | DEFERRED TO C1, D |
| VD-10 strict thousands separators accepted | accepted | `parseAmount` | G-21 | DEFERRED TO B1, C1 (all consumers) |
| VD-11 negative ties away from zero | accepted | `formatShekel` | G-20-pres | DEFERRED TO C1, B2 |
| VD-12 forecast profit from actual ratios | accepted | `applyProjection` | BD-3 projection test | DEFERRED TO C1, E |
| VD-13 history card incl. legacy food_cost/other_income | accepted | `normalizeRows` revenue/purchases | G-18, G-05 | DEFERRED TO C1 |
| VD-14 had_entry for other_income/payroll-only days | accepted | `presence.day`; `toForecastDay` (revenue presence) | G-07h, G-07l | DEFERRED TO B1 (analytics docs), E |
| VD-15 hourly edits trigger rebuild | accepted | map cells normalized per key (fingerprint function itself not in A) | G-05 | DEFERRED TO C2 |
| VD-16 recorded supplier map (incl. 0/"skip") wins over legacy food_cost, flagged | accepted — **R1.3 revised** | presence-based selection + `supplier_and_legacy_food_both` | G-18 (P6, P7), G-17 | DEFERRED TO B1 (EV-1 read-only evidence first) |
| VD-17 refunds included in purchase repository | accepted | negatives preserved, `negative_amount` flag | G-17, G-18 (P9) | DEFERRED TO B1 |
| VD-18 effective-dated history from activation; no fabricated past | accepted — **revised wording** | `CostVersion.basis`, `configurationBasis` | G-10, G-11…G-14 | persistence DEFERRED TO F; labels DEFERRED TO C1/B2 |
| VD-19 within-row exact decimals | accepted | `Dec` sums | G-20 | DEFERRED TO B1 |
| VD-20 invalid cells flagged, not 0 | accepted | `Cell.invalid` + `invalid_cell` | G-22, G-07i | DEFERRED TO B1, C1, D |
| VD-21 averages/completeness over present days | accepted | `coverage`, `averages` | G-07a | DEFERRED TO C1, D |
| VD-22 alerts compare exact ratios | accepted | `evaluatePolicy` exact | G-P6 | DEFERRED TO D |
| VD-23 explicit-zero days count as entered | accepted | TI-14 presence | G-07a…G-07n | DEFERRED TO B1, C1, D, E |
| VD-24 absent shown "לא הוזן" | accepted | `value:null` + `LABELS.presence.absent` | G-07a, G-07i | DEFERRED TO C1 |
| VD-25 interim "basis unknown" label | **SUPERSEDED by BD-1** | no unknown/compat state exists; provenance states `net_of_vat` | G-40, G-41 | none (C1 shows net label) |
| VD-26 zero-cost days in alert windows | accepted | presence-based totals | G-07e | DEFERRED TO D |
| VD-27 no recorded revenue ⇒ profit "—"; recorded 0 revenue ⇒ real loss | accepted — **clarified** | `operatingProfit` null vs value | G-07n, G-15 | DEFERRED TO C1, B2 |
