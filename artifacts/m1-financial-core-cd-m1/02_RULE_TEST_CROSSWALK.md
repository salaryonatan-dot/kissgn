# 02 — Rule → test crosswalk

Tests are in `test/finance/cd-m1-closed-days.test.mjs` unless named otherwise. "parity" means the result is asserted equal on server, compiled browser and committed `fincore`.

| Rule | Tests |
|---|---|
| CDA-01 closure source only from the exception domain | CD-AT01; "CDA-01 / CD-AT23 / CD-AT24"; CD-AT29 (loader → decode) |
| CDA-02 closure with nonzero revenue is invalid | CD-AT10 (contradiction); golden O-14 |
| CDA-03 completed closure = known zero, excluded from expected coverage, never subtracted again | CD-AT01, CD-AT05, KEY TIMING |
| CDA-04 future closure: 0 forecast immediately, Actual unchanged | CD-AT05/06/28, KEY TIMING, CD boundary |
| CDA-05 forecast = Actual + remaining eligible forecasts | CD-AT05 |
| CDA-06 newest six eligible same-weekday; explicit zero eligible; min 3 | CD-AT02, CD-AT03, CD-AT04 |
| CDA-07 closure skipped, not a zero sample | CD-AT02, CD-AT04 (negative control: entered zero is sampled) |
| CDA-08 recorded daily costs stay on their date | CD-AT11, CD-AT21 (purchase kept) |
| CDA-09 exact entitlement over allocation-eligible dates | CD-AT07, CD-AT15, Leap Feb 2028; goldens O-02/O-20 |
| CDA-10 future closure stays in denominator until completed; then recompute | KEY TIMING, CD boundary, CD-AT05 (afterActual identical) |
| CDA-11 entitlement per effective segment first | CD-AT15, CD-AT16; golden G-11-mid |
| CDA-12 uncovered segment stays unavailable | CD-AT17 |
| CDA-13 percentage rent / royalty = rate × revenue | CD-AT19 |
| CDA-14 no eligible dates: typed, no division / fallback / zero, entitlement kept | CD-AT21, CD-AT22 |
| CDA-15 aggregate profit determinable when aggregate inputs complete | CD-AT21 |
| CDA-16 retroactive closure / reopen recomputes only its month | CD-AT10 |
| CDA-18 missing revenue: exact dates, partial, never imputed (core part) | CD-AT25, CD-AT01 |
| CDA-20 calendar vs allocation / forecast counters | CDA-20, KEY TIMING |
| CDA-21 one shared implementation | CD-AT29 + parity in CD-AT01/02/07/21/25; PFN-01 |
| CDA-22 exact rationals, reconciliation, canonical aggregate presentation | CD-AT20, CD-AT07, KEY TIMING |
| TD-CDM1-2 / TD-CDM1-8 ledger wiring, unreadable ledger | "TD-CDM1-2" |

Scenario owners outside CD-M1:
- CD-AT12, CD-AT13 and CD-AT14 (UI flow; the core reopen part is covered in CD-AT10) belong to **CD-M2**.
- The warning placement and email text of CD-AT25 belong to **C1** and **B2**.
- CD-AT26 and CD-AT27 belong to **B2**.
- CD-AT30 belongs to the **B2** guard work.
