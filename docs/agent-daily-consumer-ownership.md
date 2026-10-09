# Agent/Daily consumer ownership and dependencies

Baseline: `8511d7b2d3e4c89659b1ae006f6bdb1e9670b826`. This map was made before editing runtime code. The independent integration review is `CHANGES_REQUIRED`; this branch is provisional.

| Owned consumer | Existing source and dependency | Allowed work |
|---|---|---|
| `src/services/analyticsService.ts`, `src/agent/analysis/*`, `src/agent/planner/*`, `src/agent/validation/*` | `dailyMetricsRepo` uses `canonicalDailySeries`; `purchasesRepo` uses `canonicalPurchaseRecords`. Month reporting is `canonicalMonthReport`. | Carry financial availability and period report into Agent analysis; remove local financial ratios. |
| `src/agent/proactive/detectors/*`, `prioritization.ts`, `digestBuilder.ts`, `runProactiveJob.ts` | `fetchPlannedData` feeds detectors; `runForBiz` persists insights then calls `buildDailyDigest`, whose `pickTopInsights` takes three. | Gate each financial conclusion on trusted source, use policy values, preserve provenance and deterministic ordering. |
| `src/alerts/*`, `src/insights/*`, `src/snapshot/snapshotEmail.ts` | Alert/insight docs and snapshot financial report. | Correct consumer interpretations without changing the canonical producer. |
| Scoped tests and this document | Test pure detectors and the real orchestration boundary. | Independent financial expectations and negative controls. |

## Protected dependencies

`src/finance*`, `src/metrics/*`, `src/policy/productFinance.ts`, `src/policy/registry.ts`, `src/finance-server/*`, `src/repositories/analytics/*`, Core/P1 writers and validators, generated `fincore/*`, `index.html`, Rules, deployment pins, and VAT guards are outside this branch's ownership. Any required change there must be carried as an explicit dependency for the integration author. Receipt and email transport redesign is follow-up work.

## Source contracts observed

`canonicalDailySeries` returns only present completed days and attaches `presence`, `partial`, and `fin`, but excludes gross-absent credit dates from daily food cost. `canonicalMonthReport` is authoritative for complete month Food Cost including credits on those dates and exposes typed `purchasesPct`, coverage, and credit state. Consequently, a period financial ratio cannot be reconstructed from daily percentages or daily amounts. The policy registry resolves `config.targets.*` before compatibility defaults; the compatibility defaults are not owner-approved targets.
