# Known Limitations (Slice A)

- **L-1 Legacy numeric shape cannot express absence.** `toDailyMetric` writes an absent amount as `0` for old readers only; `presence` is authoritative and ratios are `null`. Consumers migrate to presence in B1/D.
- **L-2 Compatibility rent semantics preserved, not changed.** Today's product counts `config.rentFixed` and a regular fixed item keyed `rent` separately; the compatibility adapter reproduces that and raises `rent_fixed_and_rent_item_both` when both are non-zero. Changing it would be an unregistered visible difference.
- **L-3 BD-3 reading.** Recognised accrual days for an open month include the current business date (today is live/open). If the CTO reads BD-3 as "overhead through yesterday", only `recognizedDates` in `src/metrics/report.ts` changes.
- **L-4 Projection of percentage rent/royalty** uses the rate of the version in force on the month's last day (`pct_rate_from_month_end_version` warning).
- **L-5 Id-less legacy rows** receive deterministic content-fingerprint ids (`noid:<fnv64>`), flagged `row_without_id`; identical id-less rows are distinguished by an occurrence suffix (values are unaffected by order).
- **L-6 Input range.** Cells beyond 15 integer / 6 fractional digits are `invalid(out_of_range)` and flagged, including numbers like `1e21`.
- **L-7 Presenter format.** Negative money renders `₪-1,234` (mirrors today's `fmt`); RTL control characters are not added.
- **L-8 No `package.json` script.** The generator runs as `node tools/finance-core/gen-browser.mjs`; `package.json` and `scripts/` are protected by the VAT guard, so R1.2's "npm script" was replaced by a tools entry point (no authorized-delta change needed).
- **L-9 `unresolved` purchase basis** is reachable only through a malformed/partial policy input; the product policy covers all dates.
- **L-10 G-34** (108-representation D-R2 parity through a migrated `getDailyMetrics`) needs the consumer and is deferred to B1; G-35 covers only the forecast input adapter.
- **L-11 Browser requirements.** The artifact is ES2020 ES modules using BigInt (Safari ≥ 14, Chrome ≥ 67). It is not loaded by `index.html` in this slice.
- **L-12 Intl dependency.** `israelBusinessDate` needs time-zone data (Node full-icu / browser Intl); G-30 covers DST boundaries.
- **L-13 Profit completeness.** `profit_components_incomplete` is raised when a revenue-present day lacks purchases or direct labor; other-expense absence is not flagged (rarely entered).
- **L-14 Profit with missing cost facts.** Operating profit is the sum of recorded facts (R1.3 §1.5 "missing contributes nothing, never imputed"); when a revenue-present day lacks purchases or direct labor the report carries `ratio_numerator_incomplete` per day and `profit_components_incomplete`. Profit becomes `null` only when no revenue is recorded (VD-27) or the cost configuration is missing for a recognised day. Presenters (C1) must surface the flag.
- **L-15 Stored float noise.** A stored number such as `0.30000000000000004` exceeds the 6-fractional-digit input limit and is `invalid(out_of_range)` (flagged, never coerced). EV-1 counts invalid cells by reason so B1 can size this before any consumer switches.
- **L-16 Bundled forecast engine.** `src/forecast/revenueForecast.ts` (REV_FORECAST/v1) is included unchanged in the browser artifact; it aggregates in binary floating point internally. Its output enters only the separate projection object. Canonical input and any version bump belong to Slice E.
- **L-17 `ownerApproved`** refers to Marjin product policy approved by the owner; business-configured goals are the business's own settings and are marked `source: "business_config"`, `ownerApproved: false`.
