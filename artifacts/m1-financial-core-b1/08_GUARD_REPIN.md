# 08 — Guard re-pins and structural guards

## Server-reader pins (`test/support/server-reader-authorized-delta.mjs`) — exactly 5 files
| File | Previous pin (P0-DATA-01 R2) | B1 pin (`658cd05`) | B1 R1 pin |
|---|---|---|---|
| `src/analytics/dailyBuilder.ts` | `a327186c90e957a44aeeb40a023734e2f0c027c1` | `ecaa53337fd2ba60fc8abd8a0cae708a87ba8cdc` | `6b70d03c245d163264f1bad2cefa71c0d85ff761` |
| `src/repositories/analytics/dailyMetricsRepo.ts` | `301f95993258f75051e4a4ee91ca22a1e8839207` | `b04e0193196f50057cb1214f05c0cb47078af0ee` | `4a5cb8f8ee234520f0db1f8c2c4b7b5f7f8e978a` |
| `src/repositories/analytics/laborRepo.ts` | `33a646e92523f758d70b1707652cf39fc36c4605` | `78f35d558a40a23719124b22c9ad26561fab8da0` | `14eff463d08c612b6e5c7e5de355b0b95d67bcd9` |
| `src/repositories/analytics/purchasesRepo.ts` | `6a3f9be2a5c4ceec7d5339cbda50d61fd28513af` | `d5f0a1eeeac9c0999a71cf91cdb6647c11ac572b` | `7916308f20e0a3f8a639c6fad5c63ecda7f3cde4` |
| `src/snapshot/snapshotBuilder.ts` | `e36df4d83d945d16e158dacc82b12ce2500f9956` | unchanged (B2 owns it) | unchanged |

R1 delta in the four files (vs `658cd05`): each `loadCanonicalInputs` call adds `exceptions: false` to `need` (the contract signature makes the key required); `dailyBuilder` also gains a two-line comment (it keeps its single-date envelope read for reason/note metadata). No other byte changed.
Each B1 pin equals `git hash-object` of the committed bytes (GUARD-05). `SERVER_READER_BASE` stays `8cac71c1`. No other protected path (`src/analytics|repositories|agent|snapshot|forecast`, Rules, `vercel.json`, packages, scripts) changed (GUARD-05, `vat-invariant`).

## S0 mutation proofs re-anchored (`s0-guard-server-reader-mutations`)
A relocated `const record = canonicalDayRecord(…)` after its use (compiled mutant throws `ReferenceError`) · B moved `parseLegacyListEnvelope` block / swapped repo functions · C swapped statements (independent and use-before-declaration) · D extra statement / export / comment / whitespace · E VAT division in the doc, presence rule, dropped config read (global labor), snapshot gross-up · F restored winner row, dropped explicit-zero days, bypassed labor contract, full revert to the core, R1 bytes, **the pre-B1 bytes of each of the 4 files**, **the B1 `658cd05` bytes of each of the 4 files** (R1) — all `approved_content_mismatch`; G/H unchanged; I positive control passes.

## `fincore-guards`
- G-B1 regeneration byte-identical (pinned tsc 5.9.3); G-B1b closure = core dirs + forecast (now includes `src/policy/productFinance.ts`).
- G-B2 → data-driven (AMEND-02).
- G-S1 unchanged (productFinance passes it).
- G-S2 + exactly one edge `src/policy/productFinance.ts → src/forecast/revenueForecast.js` (AMEND-04).
- G-S4 → one runtime caller of `computePeriodReport(` / `toDailyMetric(`: `src/policy/productFinance.ts`, with `productPurchaseBasis()` / `productLaborSource()` / `NO_DECLARED_CLOSURES` bound.
- G-S3, G-A1, G-M1 unchanged (G-M1 now covers SV1/SV2).

## Pre-check (GUARD-07)
The B1 runtime diff (index.html, api, lib, src) adds no line matching `/\b(?:migration|migrate|_rtdbSet|storage\.set|set\(ref|remove\(ref|persist\(|entries\s*=)\b/i`.
