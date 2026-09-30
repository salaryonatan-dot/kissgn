# M1 Financial Core — B2 morning snapshot / e-mail (successor on CD-M1): executive status

**STATUS: CODEX_READY — local candidate for independent review.** One local commit on top of the approved CD-M1 `6d54e36752a5e04891127e2f62c8ea2571c61511`, which carries the approved B1 R1 `4675eb20`. Not pushed and not deployed. The external handoff (SHA, environment-labelled logs, gate and scenario ledgers) is `~/Documents/marjin-reviews/2026-09-30/b2-successor/`.

This candidate reuses the paused checkpoint `c16ac110` (which is itself unchanged) and adapts it to the closed-days core.

| Item | Result |
|---|---|
| Snapshot source | ONE `canonicalMonthReport(open_month)` + the EXISTING `canonicalMonthProjection` (REV_FORECAST/v2), via the server API, on ONE captured clock |
| Loader | `loadCanonicalInputs(…, {site:"snapshotBuilder", nowMs, need:{config:true, fixed:true, exceptions:true}})` |
| B2-R01 | `src/finance-server/canonicalSnapshot.ts` is **not** added. The view encoding, `kpiShares` (core `ratioOfTotals`) and the retained insights live in `snapshotEmail.ts`, B2's only core consumer. The builder is B2's only server-API consumer: it orchestrates and copies values, with no core import and no arithmetic. GUARD-02 / AMEND-02 allow one owner category per path, so neither file can hold both roles. |
| B2-R02 | Revenue's share is revenue ÷ revenue through `ratioOfTotals`, so a zero revenue shows "—", never 100%. |
| B2-R03 | Ten full normalized subject + HTML goldens (`test/finance/goldens/b2-email/`). |
| Rent / target | Fixed rent and percentage rent are shown as the core's two values (no B2 sum). Projected revenue and the sales target are shown side by side; the B2 target-percentage formula is removed. |
| Closures / missing data | Completed closures are shown as a known 0, not as missing. Monthly costs are placed on eligible days and the counters are disclosed. Future closures are forecast-only, and "תחזית חלקית" carries its dates. The exact missing, invalid or contradicted revenue dates appear in text directly below MTD revenue. |
| Partial values | Marked "חלקי". Legacy `number` fields carry complete values only. The revenue-pace insight needs a complete forecast. |
| Calendar | `daysLeft` and progress are calendar measures (`datesInRange` and core `ratioOfTotals`), unchanged by closures. VD-41: no daily-average row. VD-45: neutral short e-mail on the 1st. |
| Production accessed / modified | NO / NO |
