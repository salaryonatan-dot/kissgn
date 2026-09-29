# 06 — Visible differences and release note

B1 changes **server** outputs only: the AI agent's daily / labor / purchase series, the proactive detectors, the persisted analytics docs (read by alerts, insights and the browser's insights readback). **No UI number changes in B1** (`index.html` untouched; C1 moves the browser).

## Visible differences (all owner-accepted VDs; sized with the accepted EV-1 counts — counts only)
| VD | Change | EV-1 sizing (5 tenants, 10 businesses, 520 rows) |
|---|---|---|
| VD-23 / VD-14 | explicit-zero and zero-only days count as entered (`had_entry:true`, present in the series); an explicit 0 is a complete fact | **282** supplier explicit-zero rows; **2** zero-only rows ("present but not entered today") |
| VD-17 | negative supplier amounts (refunds) are kept and reduce purchases; flagged `negative_amount` | **2** supplier-negative rows |
| — (informational) | id-less rows get deterministic fingerprint ids; every row counts; nothing is repaired | **520** of 520 rows have no id |
| VD-31 | labor = `payroll` (+ global calendar-day allocation); `hourly_payroll` never counted | **0** `hourly_payroll` rows — no Production value changes from this rule today |
| VD-28 revised / C-14 | daily labor includes the global employees' calendar-day allocation; a missing / invalid global amount or absent config makes labor unavailable (`payroll` omitted in docs, `laborPct:null`), never 0 | not sized by EV-1 (config is not read by EV-1) |
| C-14 (missing payroll) | a completed day without a `payroll` cell has incomplete labor (`laborPct:null`, doc `payroll` omitted) — previously 0 | **439** of 520 rows carry a payroll cell; up to 81 rows do not (EV-1 does not break this down further) |
| C-14 (purchases-only) | a purchases-only day is present (purchases complete) but revenue is absent ⇒ doc `total` omitted (previously 0) | **16** purchases-only rows |
| VD-08 | ratios `null` (not 0) on zero / negative / missing revenue or a missing component | follows the rows above |
| VD-19 | exact decimals within and across rows; one 10-dp legacy conversion | last-digit differences only |
| VD-10 | strictly grouped thousands separators accepted | not observed as a separate EV-1 counter (0 invalid cells) |
| VD-20 | invalid cells are flagged, the metric is partial / invalid, never a silent 0 | **0** invalid cells observed |
| VD-16 revised | a recorded supplier map (incl. 0 / skip) wins over legacy `food_cost` | **0** collisions, **0** legacy `food_cost` rows |
| VD-04 | a duplicate business date is ONE aggregated day (dailyBuilder no longer refuses it) | **0** duplicate dates observed |
| VD-03 / VD-30 | future rows quarantined; the current day is never Actual (non-Actual context doc, empty insights) | **0** future rows; the current day depends on the run date |
| DD-15 | purchase records are one per (date, source) aggregate | 478 supplier-map rows |
| DD-18 | RTDB numeric-key map readback accepted as the map (no V2 regression) | **0** Storage V2 businesses today |

## Release note (for the owner / Codex; no Production values)
1. **Explicit zeros are real.** A day recorded as 0 (including supplier `0` or `skip`) is an entered day with a real zero; it is never treated as missing, and a missing value is never shown as 0.
2. **Refunds reduce purchases.** Negative supplier amounts are kept and flagged; they are not supplier credits (credits are a P1 feature by issue date).
3. **Labor is the owner contract.** Hourly labor is the manually entered ShiftOrganizer full employer cost (`payroll`); global employees add their monthly full employer cost allocated by calendar day. `hourly_payroll` is never counted. When the global amount or the config is missing, labor is unavailable ("—"), not 0.
4. **Actual is D-1.** The current day never enters any Actual amount; the post-save rebuild of the current day writes a context doc and an empty insights doc (the save flow's readback still succeeds).
5. **Missing ids are informational.** All 520 observed rows lack ids; B1 fingerprints them deterministically and changes nothing in storage (entry-ID repair stays under the separate Gate 0 / P0 process).
6. **Alerts / insights** consume the new docs safely: an omitted field skips the date (never a false alert); identical results on fully specified data (COMPAT-01…08).
7. Mixed deployment and rollback are safe (07).
